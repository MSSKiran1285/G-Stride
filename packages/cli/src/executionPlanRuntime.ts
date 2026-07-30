import path from 'node:path';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import {
  ObjectRepository,
  ExecutionPlan,
  ExecutionPlanSnapshot,
  EXECUTION_SNAPSHOT_SCHEMA_VERSION,
  JsonValue,
  TestCase,
  loadTransactionData,
} from '@taf/core';
import {
  ExecutionOrchestrationEvent,
  ExecutionPlanResult,
  ModuleRegistry,
  executeExecutionPlan,
} from '@taf/engine';
import { FioriPlaywrightAdapter } from '@taf/adapter-fiori';

export interface LegacyExecutionRuntimeOptions {
  plan: ExecutionPlan;
  tests: Map<string, TestCase>;
  objectRepository: ObjectRepository;
  registry: ModuleRegistry;
  reportDir: string;
  headless: boolean;
  credentials: {
    url: string;
    username: string;
    password: string;
  };
  onEvent?: (event: ExecutionOrchestrationEvent) => void | Promise<void>;
  dataSnapshots?: ReadonlyMap<string, JsonValue[]>;
  cancellationFile?: string;
}

export function loadExecutionSnapshot(file: string): {
  snapshot: ExecutionPlanSnapshot;
  dataSnapshots: ReadonlyMap<string, JsonValue[]>;
} {
  const snapshot = JSON.parse(readFileSync(file, 'utf8')) as ExecutionPlanSnapshot;
  if (
    snapshot.schemaVersion !== EXECUTION_SNAPSHOT_SCHEMA_VERSION
    || !snapshot.plan
    || !snapshot.planHash
    || !snapshot.snapshotHash
    || !Array.isArray(snapshot.data)
  ) {
    throw new Error('Execution snapshot is missing or has an unsupported format.');
  }
  return {
    snapshot,
    dataSnapshots: new Map(snapshot.data.map((entry) => [entry.bindingId, entry.records])),
  };
}

export function createExecutionProgressReporter(options: {
  plan: ExecutionPlan;
  tests: ReadonlyMap<string, TestCase>;
  reportDir: string;
  dataSnapshots?: ReadonlyMap<string, JsonValue[]>;
}): (event: ExecutionOrchestrationEvent) => void {
  const recordEvent = createExecutionEventRecorder(options.reportDir);
  const executableMembers = options.plan.kind === 'regressionPack'
    ? options.plan.members.map((member) => ({
        memberId: member.memberId,
        executable: member.executable,
      }))
    : [{ memberId: options.plan.planId, executable: options.plan }];
  let totalIterations = 0;
  let totalSteps = 0;
  let totalStages = 0;
  for (const member of executableMembers) {
    const binding = member.executable.dataBindings[0];
    const qualified = options.plan.kind === 'regressionPack' && binding
      ? `${member.memberId}:${binding.bindingId}`
      : binding?.bindingId;
    const iterations = qualified ? options.dataSnapshots?.get(qualified)?.length ?? 1 : 1;
    const executions = member.executable.kind === 'singleTest'
      ? [member.executable.testExecution]
      : member.executable.stages;
    const steps = executions.reduce((total, execution, index) => {
      const testCase = options.tests.get(normalizedKey(execution.test.file));
      if (!testCase) return total;
      return total + (index === 0
        ? testCase.steps.length
        : testCase.steps.filter((step) => step.module !== 'Login').length);
    }, 0);
    totalIterations += iterations;
    totalSteps += steps * iterations;
    totalStages += executions.length * iterations;
  }

  let completedIterations = 0;
  let completedSteps = 0;
  let completedStages = 0;
  let activeStepBase = 0;
  let activeStageBase = 0;
  let currentGroup = options.plan.name;
  const progressPath = path.join(options.reportDir, 'progress.json');
  const write = (change: Record<string, unknown> = {}) => {
    const activeSteps = Number(change.completedSteps ?? completedSteps);
    writeFileSync(progressPath, JSON.stringify({
      completedGroups: completedIterations,
      totalGroups: totalIterations,
      completedSteps: activeSteps,
      totalSteps,
      completedStages: Number(change.completedStages ?? completedStages),
      totalStages,
      currentGroup,
      currentStage: '',
      currentStep: 'Preparing execution',
      percent: totalSteps > 0 ? Math.min(100, Math.round((activeSteps / totalSteps) * 100)) : 0,
      ...change,
    }, null, 2));
  };
  write();
  return (event) => {
    recordEvent(event);
    if (event.type === 'member-started') {
      currentGroup = event.memberName;
      write({ currentGroup, currentStep: 'Preparing transactions' });
    } else if (event.type === 'iteration-started') {
      activeStepBase = completedSteps;
      activeStageBase = completedStages;
      write({ currentGroup: event.context.memberName, currentStep: `Starting transaction ${event.context.iterationIndex + 1}` });
    } else if (event.type === 'stage-progress') {
      write({
        completedSteps: activeStepBase + event.progress.completedSteps,
        completedStages: activeStageBase + event.progress.completedStages,
        currentGroup: event.context.memberName,
        currentStage: event.progress.currentStage,
        currentStep: event.progress.currentStep,
        childWork: event.progress.childWork,
      });
    } else if (event.type === 'iteration-completed') {
      completedIterations += 1;
      completedSteps += event.completedSteps;
      completedStages += event.completedStages;
      write({
        completedGroups: completedIterations,
        completedSteps,
        completedStages,
        currentGroup: event.context.memberName,
        currentStep: `Transaction ${event.context.iterationIndex + 1} ${event.status}`,
        childWork: undefined,
      });
    } else if (event.type === 'execution-completed') {
      write({
        completedGroups: completedIterations,
        completedSteps,
        completedStages,
        currentStep: `Execution ${event.status}`,
        percent: event.status === 'passed' ? 100 : undefined,
        childWork: undefined,
      });
    }
  };
}

export function createExecutionEventRecorder(
  reportDir: string
): (event: ExecutionOrchestrationEvent) => void {
  const eventPath = path.join(reportDir, 'execution-events.jsonl');
  let sequence = 0;
  return (event) => {
    appendFileSync(eventPath, `${JSON.stringify({
      sequence: ++sequence,
      recordedAt: new Date().toISOString(),
      event,
    })}\n`);
  };
}

export function reportInputFields(
  record: Record<string, JsonValue>
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(record).map(([key, value]) => [
      key,
      value !== null && typeof value === 'object' ? JSON.stringify(value) : String(value ?? ''),
    ])
  );
}

function normalizedKey(file: string): string {
  return file.replace(/\\/g, '/');
}

/**
 * CLI bridge for the immutable Execution Plan engine. Credentials are injected
 * as server/runtime context and never copied into the plan or its data records.
 */
export async function runExecutionPlan(
  options: LegacyExecutionRuntimeOptions
): Promise<ExecutionPlanResult> {
  const today = new Date();
  const runtimeToday =
    `${String(today.getMonth() + 1).padStart(2, '0')}/`
    + `${String(today.getDate()).padStart(2, '0')}/${today.getFullYear()}`;
  return executeExecutionPlan(options.plan, {
    objectRepository: options.objectRepository,
    registry: options.registry,
    loadTest: (asset) => {
      const test = options.tests.get(normalizedKey(asset.file));
      if (!test) throw new Error(`Execution Plan references an unavailable Test asset: ${asset.file}`);
      const contentHash = createHash('sha256').update(JSON.stringify(test)).digest('hex');
      if (contentHash !== asset.contentHash) {
        throw new Error(`Test asset "${asset.file}" changed after preflight; start a new preflight.`);
      }
      return test;
    },
    loadData: (binding, qualifiedBindingId) => {
      const snapshot = options.dataSnapshots?.get(qualifiedBindingId);
      if (snapshot) return snapshot;
      return loadTransactionData(binding.source).records;
    },
    createAdapter: () => new FioriPlaywrightAdapter({ headless: options.headless }),
    artifactsFor: (context) => {
      const unitDir = path.join(options.reportDir, context.memberId, context.iterationId);
      mkdirSync(path.join(unitDir, 'evidence'), { recursive: true });
      return {
        screenshotDir: unitDir,
        evidenceDir: path.join(unitDir, 'evidence'),
      };
    },
    systemContext: {
      'sap.url': options.credentials.url,
      'sap.urlBase': options.credentials.url.replace(/\/+$/, ''),
      'sap.username': options.credentials.username,
      'sap.password': options.credentials.password,
      'runtime.today': runtimeToday,
    },
    onEvent: options.onEvent,
    isCancellationRequested: options.cancellationFile
      ? () => existsSync(options.cancellationFile!)
      : undefined,
  });
}
