import { ObjectRepository, getAiCredentialStatus } from '@taf/core';
import {
  ModuleRegistry,
  classifyScreenArchetype,
  decideNextAction,
  deriveControlName,
  CapturedControl,
  NavigationHistory,
  NavigationDecision,
  ScreenArchetype,
} from '@taf/engine';
import { FioriPlaywrightAdapter } from '@taf/adapter-fiori';
import { captureScan, getActivePage, startRecording, stopRecording } from './scanSession';
import { AnthropicResolver, AI_PROVIDER } from './anthropicResolver';

/** Only constructs a resolver when a key is actually configured — decideNextAction's own
 *  needsFallback for "no resolver" already handles this cleanly, so an unconfigured POC never
 *  crashes, it just can't decide anything beyond dismissing a dialog yet. */
async function resolveAiResolver(): Promise<AnthropicResolver | undefined> {
  const status = await getAiCredentialStatus(AI_PROVIDER);
  return status.configured ? new AnthropicResolver() : undefined;
}

/**
 * BL-047 Phase 2's live orchestration loop: ties the model-driven decision policy
 * (discoveryNavigation.ts) to a real, open scan session.
 *
 * This started as strictly one step per HTTP call, on the owner's early "initially let the
 * process have human in the loop" decision — the right call while a single decision at a time
 * still needed watching. The owner retired it on 4 Aug 2026 with the question that answers
 * itself: "If I am going to sit there and click run next step, I might as well add the controls
 * myself, where is the AI here?" Exactly right — a human pressing a button between every action
 * is not autonomy, it is a slower manual capture. runDiscovery() now drives the instruction to
 * completion on its own, and the human-in-the-loop guarantee moved to where it belongs: a Stop
 * that takes effect between steps, a step budget so a confused run cannot spin forever, and the
 * mandatory review gate before anything discovered is treated as final. Single-stepping stays
 * available (runDiscoveryStep) for diagnosing one decision, which is what it was always good at.
 *
 * Only one discovery run at a time, same invariant as scanSession's own single active session
 * — there is exactly one live window to drive.
 */

export interface DiscoveredStep {
  module: string;
  appId: string;
  params: Record<string, string>;
  narrate?: string;
  /** True for a step a human performed by hand in the live window while the run was handed
   *  over to them, rather than one the model decided. Both kinds go into the same ordered list
   *  and the same step log on purpose — the composed Test has to replay the whole process, and
   *  the model has to be able to see what the human did before deciding what comes next. */
  byHuman?: boolean;
}

/** Why an autonomous run is no longer going. Kept on the state (rather than only returned from
 *  the request that started the run) because the run outlives that request — the UI polls. */
export type DiscoveryOutcome =
  | { kind: 'done' }
  | { kind: 'needsHuman'; reason: string }
  | { kind: 'budgetReached'; reason: string }
  | { kind: 'stopped' }
  | { kind: 'error'; reason: string };

/** Enough to keep a confused run from driving a real SAP tenant indefinitely. Deliberately a
 *  plain count rather than a time limit: each step is one capture + one model call + one real
 *  UI action, so steps — not seconds — are what actually bound the damage. */
export const DEFAULT_MAX_STEPS = 15;

export interface RegisteredControl {
  name: string;
  controlId: string;
  isNew: boolean;
}

export interface DiscoveryState {
  appId: string;
  /** The plain-English goal for this run — the single source of intent decideNextAction
   *  reasons over on every screen (replaces the earlier abstract key-value reference data,
   *  which gave the model no memory of an overall goal — see discoveryNavigation.ts's module
   *  comment for why that failed in real testing on 4 Aug 2026). */
  instruction: string;
  /** A running, human-readable log of every completed step this run — the model's own memory
   *  of its progress on the instruction, shown back to it on every subsequent decision. Grows
   *  for the whole run, unlike `history`, which is scoped to just the current screen. */
  stepLog: string[];
  history: NavigationHistory;
  lastArchetype: ScreenArchetype | null;
  steps: DiscoveredStep[];
  startedAt: string;
  /** True while the autonomous loop is actually mid-flight. The loop outlives the HTTP request
   *  that started it, so this is what the UI polls to know whether to keep watching. */
  running: boolean;
  /** Set by Stop; the loop checks it between steps and never mid-action, so stopping can never
   *  leave a half-executed UI interaction behind. */
  stopRequested: boolean;
  outcome?: DiscoveryOutcome;
  /** True once the run has handed control back and is waiting for a human to act in the live
   *  window, with their actions being recorded — see recordHumanStep. */
  awaitingHuman: boolean;
}

let state: DiscoveryState | null = null;

export function startDiscovery(appId: string, instruction: string): DiscoveryState {
  // Requires an open scan session up front so the caller gets a clear, immediate error rather
  // than discovering it only on the first step.
  getActivePage();
  state = {
    appId,
    instruction,
    stepLog: [],
    history: { modulesRunOnThisScreen: [] },
    lastArchetype: null,
    steps: [],
    startedAt: new Date().toISOString(),
    running: false,
    stopRequested: false,
    awaitingHuman: false,
  };
  return state;
}

export function getDiscoveryState(): DiscoveryState | null {
  return state;
}

/**
 * Stop means two different things depending on what is happening, and conflating them loses
 * work: mid-run it means "stop taking actions but keep everything you found", and only once
 * nothing is running does it mean "discard this run". Without the distinction, stopping a
 * runaway loop also threw away the steps that had already succeeded.
 */
export function stopDiscovery(): DiscoveryState | null {
  if (state?.running) {
    state.stopRequested = true;
    return state;
  }
  state = null;
  return null;
}

function requireState(): DiscoveryState {
  if (!state) {
    throw Object.assign(new Error('No discovery run in progress — start one first.'), { status: 400 });
  }
  return state;
}

export interface DiscoveryStepResult {
  decision: NavigationDecision;
  registeredControl?: RegisteredControl;
  step?: DiscoveredStep;
}

/**
 * Resolves the raw controlId a decision names to a real Object Repository logical name —
 * reusing an existing row for this exact controlId, or registering a brand-new one through
 * upsert(), the SAME path a human capture uses (real createdAt/updatedAt, real duplicate/
 * unstable-id detection). This is the one rule the whole of BL-047 exists to enforce after the
 * original trust violation (see docs/ui-ux/AUTONOMOUS_TEST_AUTHORING_DESIGN.md) — a discovered
 * control is never handed to a Module as a raw, unregistered id.
 */
function resolveControlName(
  objectRepository: ObjectRepository,
  appId: string,
  controlId: string,
  controls: CapturedControl[],
  updatedBy?: string
): RegisteredControl {
  const existing = objectRepository.listByApp(appId);
  const alreadyRegistered = existing.find((c) => c.controlId === controlId);
  if (alreadyRegistered) {
    return { name: alreadyRegistered.name, controlId, isNew: false };
  }

  const captured = controls.find((c) => c.controlId === controlId);
  if (!captured) {
    throw new Error(`Discovery decided to act on "${controlId}", but it is not present in the current live capture.`);
  }
  const name = deriveControlName(captured, existing.map((c) => c.name));
  objectRepository.upsert(
    {
      appId,
      name,
      controlId: captured.controlId,
      controlType: captured.controlType,
      bindingPath: captured.bindingPath,
      parentControlId: captured.parentId,
      tableId: captured.tableId,
      scope: 'app',
    },
    updatedBy
  );
  return { name, controlId, isNew: true };
}

/** Which of a ModuleCall's params holds the raw controlId decideNextAction named — the only
 *  two shapes the built-in Modules discoveryNavigation.ts emits calls for actually use. */
function controlParamKey(moduleName: string): 'field' | 'control' {
  return moduleName === 'ClickButton' ? 'control' : 'field';
}

export async function runDiscoveryStep(
  objectRepository: ObjectRepository,
  registry: ModuleRegistry,
  updatedBy?: string
): Promise<DiscoveryStepResult> {
  const current = requireState();
  const page = getActivePage();
  const capture = await captureScan();
  const controls = capture.controls as unknown as CapturedControl[];

  const archetype = classifyScreenArchetype(controls);
  if (current.lastArchetype !== null && archetype !== current.lastArchetype) {
    // A genuinely new screen — history is scoped to "what have I already done on THIS
    // screen," so it means nothing carried over from wherever we were before.
    current.history = { modulesRunOnThisScreen: [] };
  }
  current.lastArchetype = archetype;

  const aiResolver = await resolveAiResolver();
  const decision = await decideNextAction(controls, current.instruction, current.stepLog, current.history, current.appId, aiResolver);
  if (decision.kind !== 'action') {
    return { decision };
  }

  const paramKey = controlParamKey(decision.call.module);
  const rawControlId = decision.call.params[paramKey];
  const registeredControl = resolveControlName(objectRepository, current.appId, rawControlId, controls, updatedBy);

  const resolvedParams = { ...decision.call.params, [paramKey]: registeredControl.name };
  const adapter = FioriPlaywrightAdapter.attach(page);
  const module = registry.get(decision.call.module);
  const runState: Record<string, unknown> = {};
  await module.execute({
    adapter,
    objectRepository,
    appId: current.appId,
    params: resolvedParams,
    runState,
  });

  current.history.modulesRunOnThisScreen.push(decision.historyKey);
  let narrate: string | undefined;
  try {
    narrate = module.describe?.narrate?.({ params: resolvedParams, runState });
  } catch {
    narrate = undefined;
  }
  current.stepLog.push(narrate ?? `Ran ${decision.call.module}`);
  const step: DiscoveredStep = { module: decision.call.module, appId: current.appId, params: resolvedParams, narrate };
  current.steps.push(step);

  return { decision, registeredControl, step };
}

/**
 * Drives the instruction to completion without a human pressing anything between steps — the
 * point of the whole feature, and what the owner rightly pushed back for on 4 Aug 2026.
 *
 * Runs detached from the request that started it (a real run is many captures, model calls and
 * UI interactions, far longer than any sensible HTTP timeout), so progress is read by polling
 * getDiscoveryState(). Every exit is recorded as an explicit outcome — including a thrown error,
 * which must be caught here rather than escaping as an unhandled rejection that would take the
 * whole server down and lose the run's findings with it.
 */
export async function runDiscovery(
  objectRepository: ObjectRepository,
  registry: ModuleRegistry,
  maxSteps: number = DEFAULT_MAX_STEPS,
  updatedBy?: string
): Promise<void> {
  const current = requireState();
  if (current.running) return;
  current.running = true;
  current.stopRequested = false;
  current.awaitingHuman = false;
  current.outcome = undefined;
  // The model is driving again, so stop attributing what happens in the window to a human —
  // otherwise the loop's own clicks would be recorded a second time as human steps.
  await stopRecording();

  /** Hands the window back to a human and starts recording what they do with it, so the run can
   *  resume knowing what happened while it was stopped. */
  const handOver = async (outcome: DiscoveryOutcome) => {
    current.outcome = outcome;
    current.awaitingHuman = true;
    await startRecording((interaction) => {
      try {
        recordHumanStep(objectRepository, interaction, updatedBy);
      } catch {
        // A human can click anywhere, including on something with no stable id worth saving —
        // never let that take the recorder (or the process) down.
      }
    }).catch(() => undefined);
  };

  try {
    let stepsTaken = 0;
    while (stepsTaken < maxSteps) {
      // Checked between steps only, never mid-action — a stop must not be able to interrupt a
      // half-applied UI interaction on a real tenant.
      if (current.stopRequested) {
        current.outcome = { kind: 'stopped' };
        return;
      }

      const result = await runDiscoveryStep(objectRepository, registry, updatedBy);
      if (result.decision.kind === 'done') {
        current.outcome = { kind: 'done' };
        return;
      }
      if (result.decision.kind === 'needsFallback') {
        await handOver({ kind: 'needsHuman', reason: result.decision.reason });
        return;
      }
      stepsTaken += 1;
    }
    await handOver({
      kind: 'budgetReached',
      reason: `Stopped after ${maxSteps} steps without the instruction reporting itself complete.`,
    });
  } catch (error) {
    await handOver({ kind: 'error', reason: error instanceof Error ? error.message : String(error) });
  } finally {
    current.running = false;
  }
}

/**
 * Records one action a human took by hand in the live window while the run was handed over to
 * them — the owner's second point on 4 Aug 2026: "When asking human to take over, the steps
 * performed by human should be recorded."
 *
 * Two things have to happen for that to be worth anything, and this does both: the control the
 * human touched goes into the Object Repository through the exact same upsert path everything
 * else uses (never a fabricated definition — the rule the whole of BL-047 exists to enforce),
 * and the action joins the run's own step log, so when the model picks the run back up it can
 * see what the human did and carry on from there instead of repeating it.
 */
export function recordHumanStep(
  objectRepository: ObjectRepository,
  interaction: { controlId: string; controlType: string; text?: string; bindingPath?: string; parentId?: string; value?: string },
  updatedBy?: string
): { step: DiscoveredStep; registeredControl: RegisteredControl } {
  const current = requireState();
  const captured: CapturedControl = {
    controlId: interaction.controlId,
    controlType: interaction.controlType,
    text: interaction.text,
    bindingPath: interaction.bindingPath,
    parentId: interaction.parentId,
    category: 'actionable',
  };
  const registeredControl = resolveControlName(objectRepository, current.appId, interaction.controlId, [captured], updatedBy);

  const isFill = interaction.value !== undefined;
  const label = interaction.text?.trim() || registeredControl.name;
  const step: DiscoveredStep = {
    module: isFill ? 'EnterHeaderField' : 'ClickButton',
    appId: current.appId,
    params: isFill
      ? { field: registeredControl.name, value: interaction.value as string }
      : { control: registeredControl.name },
    narrate: isFill ? `Human entered "${interaction.value}" into "${label}"` : `Human clicked "${label}"`,
    byHuman: true,
  };
  current.steps.push(step);
  current.stepLog.push(step.narrate as string);
  // Whatever the human just did almost certainly changed the screen, so what the model had
  // already tried *here* no longer describes where it now is.
  current.history = { modulesRunOnThisScreen: [] };
  return { step, registeredControl };
}
