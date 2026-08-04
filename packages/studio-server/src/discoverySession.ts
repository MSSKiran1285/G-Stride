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
import { captureScan, getActivePage } from './scanSession';
import { AnthropicResolver, AI_PROVIDER } from './anthropicResolver';

/** Only constructs a resolver when a key is actually configured — decideNextAction's own
 *  needsFallback for "no resolver" already handles this cleanly, so an unconfigured POC never
 *  crashes, it just can't decide anything beyond dismissing a dialog yet. */
async function resolveAiResolver(): Promise<AnthropicResolver | undefined> {
  const status = await getAiCredentialStatus(AI_PROVIDER);
  return status.configured ? new AnthropicResolver() : undefined;
}

/**
 * BL-047 Phase 2's live orchestration loop: ties the rules-first decision policy
 * (discoveryNavigation.ts) to a real, open scan session. Deliberately one step per call, not
 * an internal loop that runs to completion unattended — per the owner's explicit decision
 * ("initially let the process have human in the loop"), the caller (the UI, today) decides
 * whether to take the next step, matching this single scan session's own "a human is watching
 * a real browser window" nature.
 *
 * Only one discovery run at a time, same invariant as scanSession's own single active session
 * — there is exactly one live window to drive.
 */

export interface DiscoveredStep {
  module: string;
  appId: string;
  params: Record<string, string>;
  narrate?: string;
}

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
  };
  return state;
}

export function getDiscoveryState(): DiscoveryState | null {
  return state;
}

export function stopDiscovery(): void {
  state = null;
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
