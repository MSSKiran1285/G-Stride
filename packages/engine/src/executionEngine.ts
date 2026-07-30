import { performance } from 'node:perf_hooks';
import { ObjectRepository, TestCase, RunResult, RunStage, StepResult, FieldEvidence, resolveParams } from '@taf/core';
import { IAutomationAdapter } from './adapter';
import { ModuleRegistry } from './moduleRegistry';
import type { ChildWorkProgress } from './module';

export interface ExecutionOptions {
  appId: string;
  dataRow: Record<string, string>;
  screenshotDir: string;
  /** When set, fill-related modules capture annotated "field = value" evidence screenshots here. */
  evidenceDir?: string;
  /** Optional live observer. Reporting failures are isolated from the business run. */
  onProgress?: (progress: ExecutionProgress) => void | Promise<void>;
}

export interface ExecutionProgress {
  completedSteps: number;
  totalSteps: number;
  completedStages: number;
  totalStages: number;
  currentStage: string;
  currentStep: string;
  latestStepStatus?: 'passed' | 'failed';
  childWork?: ChildWorkProgress;
}

interface ProgressTracker {
  completedSteps: number;
  totalSteps: number;
  completedStages: number;
  totalStages: number;
  onProgress?: ExecutionOptions['onProgress'];
}

async function emitProgress(tracker: ProgressTracker | undefined, progress: Omit<ExecutionProgress, 'completedSteps' | 'totalSteps' | 'completedStages' | 'totalStages'>): Promise<void> {
  if (!tracker?.onProgress) return;
  await Promise.resolve(
    tracker.onProgress({
      completedSteps: tracker.completedSteps,
      totalSteps: tracker.totalSteps,
      completedStages: tracker.completedStages,
      totalStages: tracker.totalStages,
      ...progress,
    })
  ).catch(() => undefined);
}

/** Reserved runState key fill-related modules append {label, screenshotPath} entries to — see ModuleContext.evidenceDir. */
export const FIELD_EVIDENCE_KEY = '__fieldEvidence';

/** Module.describe.narrate, with fallbacks — a module without one (or whose narrate throws) still gets a sensible label. */
function describeStep(module: { name: string; describe?: { label: string; narrate?: (ctx: { params: Record<string, string>; runState: Record<string, unknown> }) => string } }, params: Record<string, string>, runState: Record<string, unknown>): string {
  try {
    return module.describe?.narrate?.({ params, runState }) ?? module.describe?.label ?? module.name;
  } catch {
    return module.describe?.label ?? module.name;
  }
}

/** Runs one flat list of module calls against a shared runState, stopping at the first failure. */
async function runSteps(
  calls: TestCase['steps'],
  adapter: IAutomationAdapter,
  objectRepository: ObjectRepository,
  registry: ModuleRegistry,
  options: ExecutionOptions,
  runState: Record<string, unknown>,
  progressTracker?: ProgressTracker,
  currentStage = ''
): Promise<{ steps: StepResult[]; status: 'passed' | 'failed'; finalScreenshotPath?: string }> {
  const steps: StepResult[] = [];
  let status: 'passed' | 'failed' = 'passed';

  for (const call of calls) {
    const module = registry.get(call.module);
    const stepStartedAt = new Date().toISOString();
    const stepStart = performance.now();
    const stepId = `step-${steps.length}`;
    let resolvedParams: Record<string, string> = {};
    let lastChildWork: ChildWorkProgress | undefined;
    try {
      resolvedParams = resolveParams(call.params, options.dataRow, runState);
      await module.execute({
        adapter,
        objectRepository,
        appId: call.appId ?? options.appId,
        params: resolvedParams,
        runState,
        evidenceDir: options.evidenceDir,
        onChildProgress: (childWork) => {
          lastChildWork = childWork;
          return emitProgress(progressTracker, {
            currentStage,
            currentStep: describeStep(module, resolvedParams, runState),
            childWork,
          });
        },
      });
      steps.push({
        module: call.module,
        description: describeStep(module, resolvedParams, runState),
        status: 'passed',
        startedAt: stepStartedAt,
        durationMs: performance.now() - stepStart,
        stepId,
        childWork: lastChildWork,
      });
      if (progressTracker) progressTracker.completedSteps++;
      await emitProgress(progressTracker, {
        currentStage,
        currentStep: describeStep(module, resolvedParams, runState),
        latestStepStatus: 'passed',
      });
    } catch (err) {
      const screenshotPath = `${options.screenshotDir}/${call.module}-${Date.now()}.png`;
      await adapter.screenshot(screenshotPath).catch(() => undefined);
      steps.push({
        module: call.module,
        description: describeStep(module, resolvedParams, runState),
        status: 'failed',
        startedAt: stepStartedAt,
        durationMs: performance.now() - stepStart,
        error: err instanceof Error ? err.message : String(err),
        screenshotPath,
        stepId,
        childWork: lastChildWork,
      });
      if (progressTracker) progressTracker.completedSteps++;
      await emitProgress(progressTracker, {
        currentStage,
        currentStep: describeStep(module, resolvedParams, runState),
        latestStepStatus: 'failed',
      });
      status = 'failed';
      break;
    }
  }

  // A failed run already has the failing step's own screenshot covering that exact
  // moment — this is specifically proof-of-completion for a passed run, so an audit
  // reader isn't left with zero evidence just because nothing went wrong.
  let finalScreenshotPath: string | undefined;
  if (status === 'passed') {
    finalScreenshotPath = `${options.screenshotDir}/final-${Date.now()}.png`;
    await adapter.screenshot(finalScreenshotPath).catch(() => {
      finalScreenshotPath = undefined;
    });
  }

  return { steps, status, finalScreenshotPath };
}

function currentFieldEvidence(runState: Record<string, unknown>): FieldEvidence[] {
  return (runState[FIELD_EVIDENCE_KEY] as FieldEvidence[] | undefined) ?? [];
}

/**
 * Runs one test case's calls and wraps the result as a RunStage, slicing off just the
 * field-evidence entries captured DURING this call (by comparing the shared runState's
 * evidence log length before/after) — the log itself stays one flat array for the whole
 * chain (modules pushing into it have no notion of "stage"), so this is the only point
 * that can attribute each screenshot back to the stage that produced it.
 */
async function runStage(
  testCase: TestCase,
  calls: TestCase['steps'],
  adapter: IAutomationAdapter,
  objectRepository: ObjectRepository,
  registry: ModuleRegistry,
  options: ExecutionOptions,
  runState: Record<string, unknown>,
  progressTracker?: ProgressTracker,
  /** The orchestrator overwrites this with the plan's own stageId for a Business Process or
   *  Single Test — this positional fallback only matters when runStage is exercised directly
   *  (e.g. a bare chain with no plan-level stage identity available). */
  stageId = 'stage-0'
): Promise<RunStage> {
  const stageStartedAt = new Date().toISOString();
  const stageStart = performance.now();
  const evidenceBefore = currentFieldEvidence(runState).length;
  const { steps, status, finalScreenshotPath } = await runSteps(
    calls,
    adapter,
    objectRepository,
    registry,
    options,
    runState,
    progressTracker,
    testCase.name
  );
  return {
    stageId,
    testCaseName: testCase.name,
    status,
    startedAt: stageStartedAt,
    durationMs: performance.now() - stageStart,
    steps,
    finalScreenshotPath,
    fieldEvidence: currentFieldEvidence(runState).slice(evidenceBefore),
    objective: testCase.objective,
    preconditions: testCase.preconditions,
    learningObjectives: testCase.learningObjectives,
    commonErrorsAndTips: testCase.commonErrorsAndTips,
  };
}

/**
 * Runs several test cases back to back in one browser session, sharing a
 * single runState so later stages can reference values earlier ones
 * captured (e.g. a PO number) via the normal ${placeholder} resolution.
 * Each stage's own Login step is kept for stage 0 (so a stage file is still
 * independently runnable on its own) but dropped for every later stage —
 * the session from stage 0 is already authenticated, so re-running Login
 * mid-chain is redundant. Fails fast on the first failing stage (which
 * itself fails fast on the first failing step within it), exactly like a
 * single test case would.
 */
export async function executeTestCaseChain(
  testCases: TestCase[],
  adapter: IAutomationAdapter,
  objectRepository: ObjectRepository,
  registry: ModuleRegistry,
  options: ExecutionOptions
): Promise<RunResult> {
  const runStartedAt = new Date().toISOString();
  const runStart = performance.now();
  const runState: Record<string, unknown> = {};
  const stages: RunStage[] = [];
  let status: 'passed' | 'failed' = 'passed';
  const progressTracker: ProgressTracker = {
    completedSteps: 0,
    totalSteps: testCases.reduce(
      (total, testCase, index) => total + (index === 0 ? testCase.steps.length : testCase.steps.filter((call) => call.module !== 'Login').length),
      0
    ),
    completedStages: 0,
    totalStages: testCases.length,
    onProgress: options.onProgress,
  };

  for (const [stageIndex, testCase] of testCases.entries()) {
    const calls = stageIndex === 0 ? testCase.steps : testCase.steps.filter((call) => call.module !== 'Login');
    const stage = await runStage(testCase, calls, adapter, objectRepository, registry, options, runState, progressTracker, `stage-${stageIndex}`);
    stages.push(stage);
    progressTracker.completedStages++;
    await emitProgress(progressTracker, {
      currentStage: testCase.name,
      currentStep: stage.status === 'passed' ? 'Scenario completed' : 'Scenario failed',
      latestStepStatus: stage.status,
    });
    if (stage.status === 'failed') {
      status = 'failed';
      break;
    }
  }

  const { [FIELD_EVIDENCE_KEY]: _ignored, ...capturedValues } = runState;
  const lastStage = stages[stages.length - 1];

  return {
    testCaseName: testCases.map((testCase) => testCase.name).join(' → '),
    status,
    startedAt: runStartedAt,
    durationMs: performance.now() - runStart,
    steps: stages.flatMap((s) => s.steps),
    capturedValues,
    fieldEvidence: stages.flatMap((s) => s.fieldEvidence),
    finalScreenshotPath: lastStage?.finalScreenshotPath,
    stages,
  };
}

export type GroupStageResult = RunStage;

export interface GroupResult {
  status: 'passed' | 'failed';
  startedAt: string;
  durationMs: number;
  /** One entry per test case actually attempted — stops at the first failure, so this can be shorter than the input. */
  stages: RunStage[];
  /** How many test cases the group has, regardless of how many were attempted before a failure. */
  totalTestCases: number;
  capturedValues: Record<string, unknown>;
  fieldEvidence: FieldEvidence[];
}

/**
 * Like executeTestCaseChain — one shared session/runState across all test
 * cases — but tracks pass/fail per test case (not just per step), and stops
 * at the first failing test case rather than the first failing step. This is
 * what a "Group" needs: fail-fast within the group, but with enough
 * granularity to report which named test case broke it.
 */
export async function executeGroup(
  testCases: TestCase[],
  adapter: IAutomationAdapter,
  objectRepository: ObjectRepository,
  registry: ModuleRegistry,
  options: ExecutionOptions
): Promise<GroupResult> {
  const runStartedAt = new Date().toISOString();
  const runStart = performance.now();
  const runState: Record<string, unknown> = {};
  const stages: RunStage[] = [];
  let status: 'passed' | 'failed' = 'passed';
  const progressTracker: ProgressTracker = {
    completedSteps: 0,
    totalSteps: testCases.reduce(
      (total, testCase, index) => total + (index === 0 ? testCase.steps.length : testCase.steps.filter((call) => call.module !== 'Login').length),
      0
    ),
    completedStages: 0,
    totalStages: testCases.length,
    onProgress: options.onProgress,
  };

  for (const [stageIndex, testCase] of testCases.entries()) {
    const calls = stageIndex === 0 ? testCase.steps : testCase.steps.filter((call) => call.module !== 'Login');
    const stage = await runStage(testCase, calls, adapter, objectRepository, registry, options, runState, progressTracker, `stage-${stageIndex}`);
    stages.push(stage);
    progressTracker.completedStages++;
    await emitProgress(progressTracker, {
      currentStage: testCase.name,
      currentStep: stage.status === 'passed' ? 'Scenario completed' : 'Scenario failed',
      latestStepStatus: stage.status,
    });
    if (stage.status === 'failed') {
      status = 'failed';
      break;
    }
  }

  const { [FIELD_EVIDENCE_KEY]: _ignored, ...capturedValues } = runState;

  return {
    status,
    startedAt: runStartedAt,
    durationMs: performance.now() - runStart,
    stages,
    totalTestCases: testCases.length,
    capturedValues,
    fieldEvidence: stages.flatMap((s) => s.fieldEvidence),
  };
}

/** Runs a single test case's steps in order against the given adapter, stopping at the first failure. */
export async function executeTestCase(
  testCase: TestCase,
  adapter: IAutomationAdapter,
  objectRepository: ObjectRepository,
  registry: ModuleRegistry,
  options: ExecutionOptions
): Promise<RunResult> {
  return executeTestCaseChain([testCase], adapter, objectRepository, registry, options);
}
