import {
  BusinessProcessSpec,
  BusinessProcessStage,
  DataBinding,
  ExecutionPlan,
  InputBinding,
  JsonValue,
  ObjectRepository,
  RunResult,
  RunStage,
  SingleTestSpec,
  SystemContextKey,
  TestAssetSnapshot,
  TestCase,
  applyDataSelection,
  validateExecutionPlan,
} from '@taf/core';
import { IAutomationAdapter } from './adapter';
import { executeTestCaseChain, ExecutionProgress } from './executionEngine';
import { ModuleRegistry } from './moduleRegistry';

export interface OrchestrationUnitContext {
  planId: string;
  memberId: string;
  memberName: string;
  iterationId: string;
  iterationIndex: number;
  dataBindingId?: string;
}

export interface OrchestrationArtifacts {
  screenshotDir: string;
  evidenceDir?: string;
}

export type ExecutionOrchestrationEvent =
  | { type: 'execution-started'; planId: string; totalMembers: number }
  | { type: 'member-started'; memberId: string; memberName: string; plannedIterations: number }
  | { type: 'iteration-started'; context: OrchestrationUnitContext }
  | { type: 'stage-progress'; context: OrchestrationUnitContext; stageId: string; progress: ExecutionProgress }
  | {
      type: 'iteration-completed';
      context: OrchestrationUnitContext;
      status: 'passed' | 'failed';
      completedSteps: number;
      completedStages: number;
    }
  | { type: 'member-completed'; memberId: string; status: 'passed' | 'failed' | 'cancelled'; completedIterations: number }
  | { type: 'execution-completed'; planId: string; status: 'passed' | 'failed' | 'cancelled' };

export interface ExecutionOrchestratorDependencies {
  objectRepository: ObjectRepository;
  registry: ModuleRegistry;
  loadTest(asset: TestAssetSnapshot): Promise<TestCase> | TestCase;
  loadData(
    binding: DataBinding,
    qualifiedBindingId: string
  ): Promise<JsonValue[]> | JsonValue[];
  createAdapter(context: OrchestrationUnitContext): Promise<IAutomationAdapter> | IAutomationAdapter;
  artifactsFor(context: OrchestrationUnitContext): OrchestrationArtifacts;
  systemContext: Record<SystemContextKey, string>;
  onEvent?: (event: ExecutionOrchestrationEvent) => void | Promise<void>;
  /** Checked only at safe orchestration boundaries; an active transaction is allowed to finish. */
  isCancellationRequested?: () => boolean;
}

export interface PlanIterationResult {
  iterationId: string;
  iterationIndex: number;
  dataBindingId?: string;
  status: 'passed' | 'failed';
  inputRecord: Record<string, JsonValue>;
  result?: RunResult;
  stageOutputs: Record<string, Record<string, JsonValue>>;
  error?: string;
}

export interface PlanMemberResult {
  memberId: string;
  name: string;
  kind: 'singleTest' | 'businessProcess';
  status: 'passed' | 'failed' | 'cancelled';
  plannedIterations: number;
  iterations: PlanIterationResult[];
  error?: string;
}

export interface ExecutionPlanResult {
  planId: string;
  name: string;
  kind: ExecutionPlan['kind'];
  status: 'passed' | 'failed' | 'cancelled';
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  members: PlanMemberResult[];
}

interface ExecutableMember {
  memberId: string;
  name: string;
  executable: SingleTestSpec | BusinessProcessSpec;
  qualifiedBindingPrefix?: string;
}

interface StageRun {
  stage: BusinessProcessStage;
  testCase: TestCase;
}

function asRecord(value: JsonValue, path: string): Record<string, JsonValue> {
  if (value === null || Array.isArray(value) || typeof value !== 'object') {
    throw new Error(`${path} must be a transaction object.`);
  }
  return value;
}

function readPath(record: Record<string, JsonValue>, path: string): JsonValue {
  const segments = path.split('.').filter(Boolean);
  let current: JsonValue = record;
  for (const segment of segments) {
    if (current === null || Array.isArray(current) || typeof current !== 'object' || !(segment in current)) {
      throw new Error(`Process data path "${path}" is unresolved at "${segment}".`);
    }
    current = current[segment];
  }
  return current;
}

function toRuntimeString(value: JsonValue): string {
  if (value === null) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function outputValue(value: unknown): JsonValue {
  if (value === undefined) return null;
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  return JSON.parse(JSON.stringify(value)) as JsonValue;
}

async function emit(
  dependencies: ExecutionOrchestratorDependencies,
  event: ExecutionOrchestrationEvent
): Promise<void> {
  if (!dependencies.onEvent) return;
  await Promise.resolve(dependencies.onEvent(event)).catch(() => undefined);
}

function resolveBinding(
  binding: InputBinding,
  inputRecord: Record<string, JsonValue>,
  stageOutputs: Record<string, Record<string, JsonValue>>,
  systemContext: Record<SystemContextKey, string>
): JsonValue {
  switch (binding.source) {
    case 'literal':
      return binding.value;
    case 'processData':
      return readPath(inputRecord, binding.path);
    case 'stageOutput': {
      const stage = stageOutputs[binding.stageId];
      if (!stage || !(binding.output in stage)) {
        throw new Error(`Required output "stages.${binding.stageId}.outputs.${binding.output}" is unavailable.`);
      }
      return stage[binding.output];
    }
    case 'systemContext': {
      const value = systemContext[binding.key];
      if (!value) throw new Error(`Required system context "${binding.key}" is unavailable.`);
      return value;
    }
  }
}

function stageInputRow(
  stage: BusinessProcessStage,
  inputRecord: Record<string, JsonValue>,
  stageOutputs: Record<string, Record<string, JsonValue>>,
  systemContext: Record<SystemContextKey, string>
): Record<string, string> {
  const row: Record<string, string> = {};
  for (const [name, binding] of Object.entries(stage.inputBindings)) {
    const contractInput = stage.test.contract?.inputs.find((input) => input.name === name);
    row[contractInput?.runtimeKey ?? name] = toRuntimeString(
      resolveBinding(binding, inputRecord, stageOutputs, systemContext)
    );
  }
  return row;
}

function extractStageOutputs(
  stage: BusinessProcessStage,
  capturedValues: Record<string, unknown>
): Record<string, JsonValue> {
  const outputs: Record<string, JsonValue> = {};
  for (const output of stage.test.contract?.outputs ?? []) {
    const runtimeKey = output.runtimeKey ?? output.name;
    if (runtimeKey in capturedValues) outputs[output.name] = outputValue(capturedValues[runtimeKey]);
  }
  return outputs;
}

function withoutLogin(testCase: TestCase): TestCase {
  return {
    ...testCase,
    steps: testCase.steps.filter((step) => step.module !== 'Login'),
  };
}

function aggregateStageResults(
  planName: string,
  startedAt: string,
  startedMs: number,
  stages: RunStage[],
  capturedValues: Record<string, unknown>
): RunResult {
  const lastStage = stages[stages.length - 1];
  return {
    testCaseName: planName,
    status: stages.some((stage) => stage.status === 'failed') ? 'failed' : 'passed',
    startedAt,
    durationMs: Date.now() - startedMs,
    steps: stages.flatMap((stage) => stage.steps),
    capturedValues,
    fieldEvidence: stages.flatMap((stage) => stage.fieldEvidence),
    finalScreenshotPath: lastStage?.finalScreenshotPath,
    stages,
  };
}

function stagesFor(executable: SingleTestSpec | BusinessProcessSpec): BusinessProcessStage[] {
  if (executable.kind === 'businessProcess') return executable.stages;
  return [
    {
      stageId: executable.testExecution.test.assetId,
      ...executable.testExecution,
    },
  ];
}

async function loadRecords(
  member: ExecutableMember,
  dependencies: ExecutionOrchestratorDependencies
): Promise<{ qualifiedBindingId?: string; records: Record<string, JsonValue>[] }> {
  const bindings = member.executable.dataBindings;
  if (bindings.length === 0) return { records: [{}] };
  if (bindings.length > 1) {
    throw new Error(
      `Executable member "${member.memberId}" has ${bindings.length} data bindings; Stage 2 supports one transaction source per executable.`
    );
  }
  const binding = bindings[0];
  const qualifiedBindingId = member.qualifiedBindingPrefix
    ? `${member.qualifiedBindingPrefix}:${binding.bindingId}`
    : binding.bindingId;
  const records = applyDataSelection((await dependencies.loadData(binding, qualifiedBindingId)).map((record, index) =>
    asRecord(record, `${qualifiedBindingId}[${index}]`)
  ), binding.selection);
  if (records.length === 0) {
    throw new Error(`Data binding "${qualifiedBindingId}" contains no executable transaction records.`);
  }
  return { qualifiedBindingId, records };
}

async function runIteration(
  plan: ExecutionPlan,
  member: ExecutableMember,
  inputRecord: Record<string, JsonValue>,
  iterationIndex: number,
  dataBindingId: string | undefined,
  dependencies: ExecutionOrchestratorDependencies,
  sharedAdapter?: IAutomationAdapter
): Promise<PlanIterationResult> {
  const iterationId = `${member.memberId}-iteration-${iterationIndex + 1}`;
  const context: OrchestrationUnitContext = {
    planId: plan.planId,
    memberId: member.memberId,
    memberName: member.name,
    iterationId,
    iterationIndex,
    dataBindingId,
  };
  const stageOutputs: Record<string, Record<string, JsonValue>> = {};
  const capturedValues: Record<string, unknown> = {};
  const completedStages: RunStage[] = [];
  const startedAt = new Date().toISOString();
  const startedMs = Date.now();
  let adapter = sharedAdapter;
  const ownsAdapter = !adapter;

  await emit(dependencies, { type: 'iteration-started', context });
  try {
    adapter ??= await dependencies.createAdapter(context);
    const artifacts = dependencies.artifactsFor(context);
    const stageRuns: StageRun[] = [];
    for (const stage of stagesFor(member.executable)) {
      stageRuns.push({ stage, testCase: await dependencies.loadTest(stage.test) });
    }

    for (const [stageIndex, { stage, testCase }] of stageRuns.entries()) {
      const dataRow = stageInputRow(stage, inputRecord, stageOutputs, dependencies.systemContext);
      const shouldSkipLogin = stageIndex > 0 || Boolean(sharedAdapter && iterationIndex > 0);
      const executableTest = shouldSkipLogin ? withoutLogin(testCase) : testCase;
      const stageResult = await executeTestCaseChain(
        [executableTest],
        adapter,
        dependencies.objectRepository,
        dependencies.registry,
        {
          appId: stage.test.appId,
          dataRow,
          screenshotDir: artifacts.screenshotDir,
          evidenceDir: artifacts.evidenceDir,
          onProgress: (progress) =>
            emit(dependencies, { type: 'stage-progress', context, stageId: stage.stageId, progress }),
        }
      );
      const runStage = stageResult.stages[0];
      if (runStage) completedStages.push({ ...runStage, testCaseName: stage.test.name, stageId: stage.stageId });
      Object.assign(capturedValues, stageResult.capturedValues);
      stageOutputs[stage.stageId] = extractStageOutputs(stage, stageResult.capturedValues);
      if (stageResult.status === 'failed') {
        break;
      }
    }

    const result = aggregateStageResults(member.name, startedAt, startedMs, completedStages, capturedValues);
    await emit(dependencies, {
      type: 'iteration-completed',
      context,
      status: result.status,
      completedSteps: result.steps.length,
      completedStages: result.stages.length,
    });
    return {
      iterationId,
      iterationIndex,
      dataBindingId,
      status: result.status,
      inputRecord,
      result,
      stageOutputs,
    };
  } catch (error) {
    await emit(dependencies, {
      type: 'iteration-completed',
      context,
      status: 'failed',
      completedSteps: completedStages.reduce((total, stage) => total + stage.steps.length, 0),
      completedStages: completedStages.length,
    });
    return {
      iterationId,
      iterationIndex,
      dataBindingId,
      status: 'failed',
      inputRecord,
      stageOutputs,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    if (ownsAdapter && adapter) await adapter.close().catch(() => undefined);
  }
}

async function runMember(
  plan: ExecutionPlan,
  member: ExecutableMember,
  dependencies: ExecutionOrchestratorDependencies
): Promise<PlanMemberResult> {
  const { qualifiedBindingId, records } = await loadRecords(member, dependencies);
  const iterations: PlanIterationResult[] = [];
  let sharedAdapter: IAutomationAdapter | undefined;
  if (member.executable.iterationPolicy.session === 'reuse-within-process') {
    const initialContext: OrchestrationUnitContext = {
      planId: plan.planId,
      memberId: member.memberId,
      memberName: member.name,
      iterationId: `${member.memberId}-iteration-1`,
      iterationIndex: 0,
      dataBindingId: qualifiedBindingId,
    };
    sharedAdapter = await dependencies.createAdapter(initialContext);
  }

  await emit(dependencies, {
    type: 'member-started',
    memberId: member.memberId,
    memberName: member.name,
    plannedIterations: records.length,
  });
  try {
    for (const [index, record] of records.entries()) {
      if (dependencies.isCancellationRequested?.()) break;
      const iteration = await runIteration(
        plan,
        member,
        record,
        index,
        qualifiedBindingId,
        dependencies,
        sharedAdapter
      );
      iterations.push(iteration);
      if (dependencies.isCancellationRequested?.()) break;
      if (
        iteration.status === 'failed' &&
        member.executable.iterationPolicy.onIterationFailure === 'stop-execution'
      ) {
        break;
      }
    }
  } finally {
    if (sharedAdapter) await sharedAdapter.close().catch(() => undefined);
  }
  const status: PlanMemberResult['status'] = dependencies.isCancellationRequested?.()
    ? 'cancelled'
    : iterations.length === records.length && iterations.every((iteration) => iteration.status === 'passed')
      ? 'passed'
      : 'failed';
  await emit(dependencies, {
    type: 'member-completed',
    memberId: member.memberId,
    status,
    completedIterations: iterations.length,
  });
  return {
    memberId: member.memberId,
    name: member.name,
    kind: member.executable.kind,
    status,
    plannedIterations: records.length,
    iterations,
  };
}

function membersFor(plan: ExecutionPlan): ExecutableMember[] {
  if (plan.kind === 'regressionPack') {
    return plan.members.map((member) => ({
      memberId: member.memberId,
      name: member.name,
      executable: member.executable,
      qualifiedBindingPrefix: member.memberId,
    }));
  }
  return [
    {
      memberId: 'execution',
      name: plan.name,
      executable: plan,
    },
  ];
}

export async function executeExecutionPlan(
  plan: ExecutionPlan,
  dependencies: ExecutionOrchestratorDependencies
): Promise<ExecutionPlanResult> {
  const validationIssues = validateExecutionPlan(plan);
  if (validationIssues.length > 0) {
    throw new Error(validationIssues.map((issue) => `${issue.path}: ${issue.message}`).join('\n'));
  }

  const startedAt = new Date().toISOString();
  const startedMs = Date.now();
  const members: PlanMemberResult[] = [];
  const executableMembers = membersFor(plan);
  await emit(dependencies, { type: 'execution-started', planId: plan.planId, totalMembers: executableMembers.length });

  for (const member of executableMembers) {
    if (dependencies.isCancellationRequested?.()) break;
    let result: PlanMemberResult;
    try {
      result = await runMember(plan, member, dependencies);
    } catch (error) {
      result = {
        memberId: member.memberId,
        name: member.name,
        kind: member.executable.kind,
        status: 'failed',
        plannedIterations: 0,
        iterations: [],
        error: error instanceof Error ? error.message : String(error),
      };
      await emit(dependencies, {
        type: 'member-completed',
        memberId: member.memberId,
        status: 'failed',
        completedIterations: 0,
      });
    }
    members.push(result);
    if (
      result.status === 'failed' &&
      plan.kind === 'regressionPack' &&
      plan.onMemberFailure === 'stop-pack'
    ) {
      break;
    }
  }

  const status: ExecutionPlanResult['status'] = dependencies.isCancellationRequested?.()
    ? 'cancelled'
    : members.length === executableMembers.length && members.every((member) => member.status === 'passed')
      ? 'passed'
      : 'failed';
  await emit(dependencies, { type: 'execution-completed', planId: plan.planId, status });
  return {
    planId: plan.planId,
    name: plan.name,
    kind: plan.kind,
    status,
    startedAt,
    finishedAt: new Date().toISOString(),
    durationMs: Date.now() - startedMs,
    members,
  };
}
