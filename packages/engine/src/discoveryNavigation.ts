import { ModuleCall } from '@taf/core';

/**
 * BL-047 Phase 2's live-navigation decision policy: given whatever screen the engine is
 * currently looking at (as a plain capture, not tied to any one adapter's own type — see the
 * note on CapturedControl below) and the reference master data extracted by
 * QueryReferenceDocument, decide the single next action to take, or say plainly that it can't.
 *
 * Design (per the owner's explicit choice, "rules first, model as fallback"): try a small,
 * fixed decision tree per Fiori elements archetype first — auditable, deterministic, and
 * testable with plain synthetic control lists, no live model calls. Only when the archetype
 * can't be classified, or the rule for that archetype can't find what it needs, does the
 * caller get a `needsFallback` result instead of an action — deciding what to do with that
 * (call a model, or stop and hand off to the mandatory review gate) is the caller's job, not
 * this module's. No model integration is wired up here yet — see
 * docs/ui-ux/AUTONOMOUS_TEST_AUTHORING_DESIGN.md for why that's a separate decision (provider,
 * credentials, cost) rather than an assumption baked into this module.
 */

/** Deliberately narrower than adapter-fiori's own DiscoveredControl (which this package must
 *  not depend on — adapter-fiori depends on engine, not the other way around) and deliberately
 *  structural rather than a re-export, so this module works against a live capture, a synthetic
 *  test fixture, or any future adapter's own shape without a new package dependency either way. */
export interface CapturedControl {
  controlId: string;
  controlType: string;
  text?: string;
  bindingPath?: string;
  parentId?: string;
  category: 'actionable' | 'informational' | 'structural';
}

export type ScreenArchetype = 'list-report' | 'object-page' | 'dialog' | 'unknown';

/** Fiori elements template screens embed which generator built them directly in every one of
 *  their controls' ids (e.g. "...::sap.suite.ui.generic.template.ListReport.view.ListReport::...")
 *  — the same real, verified signal already visible in every createOutboundDelivery control id
 *  inspected during BL-047's design review. This is a far more reliable signal than counting
 *  control types, and needs no heuristic tuning as new screens are seen. */
export function classifyScreenArchetype(controls: CapturedControl[]): ScreenArchetype {
  if (controls.some((c) => /^sap\.m\.(Dialog|MessageBox|Popover)$/.test(c.controlType))) return 'dialog';
  if (controls.some((c) => c.controlId.includes('sap.suite.ui.generic.template.ListReport.'))) return 'list-report';
  if (controls.some((c) => c.controlId.includes('sap.suite.ui.generic.template.ObjectPage.'))) return 'object-page';
  return 'unknown';
}

/** What the navigation loop has already done on the current screen — a plain history of module
 *  names already executed here, so a stateless call can still tell "have I already searched?"
 *  apart from "have I already selected a row?" without the caller tracking archetype-specific
 *  state of its own. */
export interface NavigationHistory {
  modulesRunOnThisScreen: string[];
}

export type NavigationDecision =
  | { kind: 'action'; call: ModuleCall }
  | { kind: 'done' }
  | { kind: 'needsFallback'; reason: string };

/** List Report screens follow the same three-step shape create-delivery.json's hand-written
 *  flow already uses: fill the search field from reference data, run the search, select the
 *  first (most likely only, for a filtered search) result row, then fire the toolbar action
 *  that advances the process. Field/control names are supplied by the caller (findControl),
 *  not guessed here, since which named control plays "the search field" vs "the toolbar
 *  action" is itself an Object Repository lookup, not something this module should know. */
function decideListReportAction(
  controls: CapturedControl[],
  processContext: Record<string, string>,
  history: NavigationHistory,
  appId: string,
): NavigationDecision {
  const searchField = controls.find((c) => /SearchField|SDDocument|ReferenceDocument/i.test(c.controlId) && c.category !== 'structural');
  const goButton = controls.find((c) => /btnGo|GoButton/i.test(c.controlId));
  const resultsTable = controls.find((c) => c.controlType === 'sap.m.Table' || c.controlType === 'sap.ui.table.Table');
  const primaryAction = controls.find(
    (c) =>
      c.category === 'actionable' &&
      c.controlType === 'sap.m.Button' &&
      c.controlId !== goButton?.controlId &&
      !history.modulesRunOnThisScreen.includes(`click:${c.controlId}`)
  );

  const searchValue = Object.values(processContext)[0];
  if (searchField && goButton && searchValue && !history.modulesRunOnThisScreen.includes('search')) {
    return {
      kind: 'action',
      call: { module: 'EnterHeaderField', appId, params: { field: searchField.controlId, value: searchValue, pressKey: 'Enter' } },
    };
  }
  if (resultsTable && !history.modulesRunOnThisScreen.includes('select-row')) {
    return { kind: 'action', call: { module: 'SelectTableRow', appId, params: { field: resultsTable.controlId, rowIndex: '0' } } };
  }
  if (primaryAction) {
    return { kind: 'action', call: { module: 'ClickButton', appId, params: { control: primaryAction.controlId } } };
  }
  return { kind: 'needsFallback', reason: 'List Report screen: could not find a search field, results table, or an unexercised primary action.' };
}

/** Object Page screens: fill every fillable field this process context has a value for, then
 *  fire the header-level action that commits the page (Save, Post, Create, ...). Reference
 *  fields are matched to on-screen inputs by control id substring against the process
 *  context's own keys — the same "camelCase key names the field" convention QueryReferenceDocument
 *  already establishes, not a new naming scheme. */
function decideObjectPageAction(
  controls: CapturedControl[],
  processContext: Record<string, string>,
  history: NavigationHistory,
  appId: string,
): NavigationDecision {
  const fillableInputs = controls.filter((c) => c.category === 'actionable' && /Input|Field/i.test(c.controlType));
  for (const input of fillableInputs) {
    const matchingKey = Object.keys(processContext).find((key) => input.controlId.toLowerCase().includes(key.toLowerCase()));
    const fillKey = `fill:${input.controlId}`;
    if (matchingKey && !history.modulesRunOnThisScreen.includes(fillKey)) {
      return {
        kind: 'action',
        call: { module: 'EnterHeaderField', appId, params: { field: input.controlId, value: processContext[matchingKey] } },
      };
    }
  }
  const headerAction = controls.find(
    (c) => c.category === 'actionable' && c.controlType === 'sap.m.Button' && /Save|Post|Create|Submit/i.test(c.text ?? c.controlId)
  );
  if (headerAction) {
    return { kind: 'action', call: { module: 'ClickButton', appId, params: { control: headerAction.controlId } } };
  }
  return { kind: 'needsFallback', reason: 'Object Page screen: every process-context field is already filled, but no Save/Post/Create/Submit action was found.' };
}

/** A confirmation dialog reads its own message and takes the primary (rightmost/first
 *  actionable) button — the same "read message -> primary action" shape every dialog in this
 *  product's existing Tests already follows (e.g. create-delivery.json's own confirmation
 *  steps), just made an explicit rule instead of hand-authored per Test. */
function decideDialogAction(controls: CapturedControl[], appId: string): NavigationDecision {
  const primaryButton = controls.find((c) => c.controlType === 'sap.m.Button' && c.category === 'actionable');
  if (primaryButton) {
    return { kind: 'action', call: { module: 'ClickButton', appId, params: { control: primaryButton.controlId } } };
  }
  return { kind: 'needsFallback', reason: 'Dialog screen: no actionable button found to dismiss or confirm it.' };
}

/**
 * The single entry point BL-047 Phase 2's navigation loop calls once per screen visit. Never
 * throws for "couldn't decide" — that's a `needsFallback` result, not an exception, since not
 * being able to decide is an expected, handleable outcome (fall back to a model, or stop and
 * hand off to the mandatory review gate), not a bug.
 */
export function decideNextAction(
  controls: CapturedControl[],
  processContext: Record<string, string>,
  history: NavigationHistory,
  appId: string,
): NavigationDecision {
  const archetype = classifyScreenArchetype(controls);
  switch (archetype) {
    case 'list-report':
      return decideListReportAction(controls, processContext, history, appId);
    case 'object-page':
      return decideObjectPageAction(controls, processContext, history, appId);
    case 'dialog':
      return decideDialogAction(controls, appId);
    case 'unknown':
      return { kind: 'needsFallback', reason: 'Screen did not match any known Fiori elements archetype (List Report, Object Page, or dialog).' };
  }
}
