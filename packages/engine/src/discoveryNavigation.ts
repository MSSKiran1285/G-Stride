import { ModuleCall } from '@taf/core';
import { AiResolver } from './aiResolver';

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
  /** Set only for a captured table Column (sap.ui.table.Column/sap.m.Column) — its enclosing
   *  table's own control id. SelectTableRow (packages/engine/src/modules/selectTableRow.ts)
   *  needs a captured *column*, not the table control itself, to resolve which table to act
   *  on; a table row can never be selected via the table control's own id. */
  tableId?: string;
}

export type ScreenArchetype = 'list-report' | 'object-page' | 'dialog' | 'shell' | 'unknown';

/** A Fiori Launchpad home screen's tiles render as sap.m.GenericTile (or the newer sap.f.Card
 *  layout) — already a real, verified signal in this codebase: ui5Inspector.ts's
 *  ACTIONABLE_TYPES/AUTO_ID_EXEMPT_TYPES/BORROWS_CHILD_TEXT entries for these two types were
 *  each added after a real capture on this tenant's own Launchpad (see their comments), not
 *  guessed up front. No app screen (List Report/Object Page/dialog) renders either type. */
const SHELL_TILE_TYPES = new Set(['sap.m.GenericTile', 'sap.f.Card']);

/** Fiori elements template screens embed which generator built them directly in every one of
 *  their controls' ids (e.g. "...::sap.suite.ui.generic.template.ListReport.view.ListReport::...")
 *  — the same real, verified signal already visible in every createOutboundDelivery control id
 *  inspected during BL-047's design review. This is a far more reliable signal than counting
 *  control types, and needs no heuristic tuning as new screens are seen. */
export function classifyScreenArchetype(controls: CapturedControl[]): ScreenArchetype {
  if (controls.some((c) => /^sap\.m\.(Dialog|MessageBox|Popover)$/.test(c.controlType))) return 'dialog';
  if (controls.some((c) => c.controlId.includes('sap.suite.ui.generic.template.ListReport.'))) return 'list-report';
  if (controls.some((c) => c.controlId.includes('sap.suite.ui.generic.template.ObjectPage.'))) return 'object-page';
  if (controls.some((c) => SHELL_TILE_TYPES.has(c.controlType))) return 'shell';
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
  | { kind: 'action'; call: ModuleCall; historyKey: string }
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
  // SelectTableRow needs a captured *column* (tableId set), never the table control itself —
  // see CapturedControl.tableId.
  const resultsColumn = controls.find((c) => Boolean(c.tableId));
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
      historyKey: 'search',
    };
  }
  if (resultsColumn && !history.modulesRunOnThisScreen.includes('select-row')) {
    return {
      kind: 'action',
      call: { module: 'SelectTableRow', appId, params: { field: resultsColumn.controlId, rowIndex: '0' } },
      historyKey: 'select-row',
    };
  }
  if (primaryAction) {
    return {
      kind: 'action',
      call: { module: 'ClickButton', appId, params: { control: primaryAction.controlId } },
      historyKey: `click:${primaryAction.controlId}`,
    };
  }
  return { kind: 'needsFallback', reason: 'List Report screen: could not find a search field, a captured results column, or an unexercised primary action.' };
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
        historyKey: fillKey,
      };
    }
  }
  const headerAction = controls.find(
    (c) => c.category === 'actionable' && c.controlType === 'sap.m.Button' && /Save|Post|Create|Submit/i.test(c.text ?? c.controlId)
  );
  if (headerAction) {
    return {
      kind: 'action',
      call: { module: 'ClickButton', appId, params: { control: headerAction.controlId } },
      historyKey: `click:${headerAction.controlId}`,
    };
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
    return {
      kind: 'action',
      call: { module: 'ClickButton', appId, params: { control: primaryButton.controlId } },
      historyKey: `click:${primaryButton.controlId}`,
    };
  }
  return { kind: 'needsFallback', reason: 'Dialog screen: no actionable button found to dismiss or confirm it.' };
}

/** "createPurchaseRequisition" -> "Create Purchase Requisition" — the same camelCase App ID
 *  convention BL-037's Process Intent Router already derives text into (GlobalSearchPanel.tsx's
 *  deriveAppId), run in reverse so the model gets a readable phrase to match tile labels
 *  against. Every discovery run has an App ID by construction (it's a required parameter), so
 *  this is available even before BL-047's natural-language entry point exists. */
export function humanizeAppId(appId: string): string {
  const withSpaces = appId.replace(/([a-z0-9])([A-Z])/g, '$1 $2');
  return withSpaces.charAt(0).toUpperCase() + withSpaces.slice(1);
}

/** A tile with no readable text can never be matched against a process description — excluded
 *  before the model ever sees the list, not left for it to guess at. */
function namedTiles(controls: CapturedControl[]): CapturedControl[] {
  return controls.filter((c) => SHELL_TILE_TYPES.has(c.controlType) && c.text);
}

function buildTileSelectionPrompt(processDescription: string, tiles: CapturedControl[]): string {
  const list = tiles.map((tile, i) => `${i + 1}. ${tile.text}`).join('\n');
  return [
    `A test automation engine is looking at a SAP Fiori Launchpad home screen and needs to open the app for this process:`,
    `"${processDescription}"`,
    ``,
    `Here are the tiles visible on the screen:`,
    list,
    ``,
    `SAP Fiori app tiles are usually named after the business object and a generic verb (Process, Manage, Post, Monitor, Track, ...) rather than the exact action requested — e.g. a request to "Create Purchase Requisition" is correctly handled by a tile named "Process Purchase Requisitions" or "Manage Purchase Requisitions", not only one that literally says "Create". Match on the business object and overall intent, not literal wording, but do not pick a tile for a clearly different object or a different lifecycle stage (e.g. do not pick "Monitor Purchase Requisition Items" or "Supplier Invoices List" for a Create request).`,
    ``,
    `Some Launchpad screens show broad department/category tiles instead of specific app tiles — e.g. "Finance", "Procurement", "Sales" rather than any single named app. If none of the tiles is a specific app for this process, but one is the department/category that would normally contain it (e.g. "Procurement" for anything about purchase requisitions, purchase orders, goods receipt, or supplier invoices), pick that category tile — navigating into it first is a normal, expected step, not a failure. Only reply NONE when nothing visible, at either level, plausibly leads toward this process.`,
    ``,
    `IMPORTANT: a specific app tile always outranks a broader department/category tile when both are visible in the same list — e.g. if both "Procurement" and "Process Purchase Requisitions" are present, pick "Process Purchase Requisitions", not "Procurement" again. A department/category tile is only ever the right pick when no specific app tile for this process is visible at all yet.`,
    ``,
    `Reply with ONLY the number of the single tile that best matches this process, or reply with exactly NONE if no tile is a good match. Do not explain your answer.`,
  ].join('\n');
}

/** Parses the model's reply back to one of the offered tiles — never trusts it blindly: an
 *  out-of-range number, extra words around a number, or anything that isn't a clean match all
 *  resolve to "no match" rather than guessing which tile was meant. */
function parseTileSelectionResponse(response: string, tiles: CapturedControl[]): CapturedControl | undefined {
  const trimmed = response.trim();
  if (/^none$/i.test(trimmed)) return undefined;
  const match = trimmed.match(/^(\d+)$/);
  if (!match) return undefined;
  const index = Number(match[1]) - 1;
  return tiles[index];
}

/** Fiori Launchpad home screens have no fixed structural signal linking a tile's label to an
 *  arbitrary process description the way a List Report/Object Page's own control ids do —
 *  matching free-form text to the right tile is a language task, not a rules one, so this is
 *  the one archetype that calls the model instead of a fixed decision tree (per the owner's
 *  "rules first, model as fallback" choice). Requires an AiResolver to be supplied at all —
 *  with none configured, this is an immediate, clearly-worded needsFallback rather than a
 *  crash or a guess. */
async function decideShellAction(
  controls: CapturedControl[],
  appId: string,
  history: NavigationHistory,
  aiResolver: AiResolver | undefined,
): Promise<NavigationDecision> {
  if (!aiResolver) {
    return {
      kind: 'needsFallback',
      reason: 'Launchpad home screen: matching a tile to this process needs an AI resolver, and none is configured — add an API key in Settings.',
    };
  }
  const tiles = namedTiles(controls);
  if (tiles.length === 0) {
    return { kind: 'needsFallback', reason: 'Launchpad home screen: no tiles with visible text were captured to choose from.' };
  }

  const processDescription = humanizeAppId(appId);
  const response = await aiResolver.complete(buildTileSelectionPrompt(processDescription, tiles));
  const chosen = parseTileSelectionResponse(response, tiles);
  if (!chosen) {
    return {
      kind: 'needsFallback',
      reason: `Launchpad home screen: no tile confidently matched "${processDescription}" — needs a human to navigate manually.`,
    };
  }
  const historyKey = `click:${chosen.controlId}`;
  if (history.modulesRunOnThisScreen.includes(historyKey)) {
    return {
      kind: 'needsFallback',
      reason: `Launchpad home screen: already clicked the matching tile ("${chosen.text}") once without navigating away — needs a human to check what happened.`,
    };
  }
  return { kind: 'action', call: { module: 'ClickButton', appId, params: { control: chosen.controlId } }, historyKey };
}

const FILLABLE_TYPE_PATTERN = /Input|Field|TextArea|ComboBox|DatePicker|Select|MultiInput/i;
const BUTTON_TYPE_PATTERN = /Button/i;

function fillableFields(controls: CapturedControl[]): CapturedControl[] {
  return controls.filter((c) => c.category === 'actionable' && FILLABLE_TYPE_PATTERN.test(c.controlType));
}

function clickableButtons(controls: CapturedControl[]): CapturedControl[] {
  return controls.filter((c) => c.category === 'actionable' && BUTTON_TYPE_PATTERN.test(c.controlType));
}

/** One representative captured column per distinct table — SelectTableRow needs any single
 *  captured column to identify which table to act on (see CapturedControl.tableId), so showing
 *  every column of the same table as a separate candidate would just be redundant noise. */
function selectableTables(controls: CapturedControl[]): CapturedControl[] {
  const seenTableIds = new Set<string>();
  const representatives: CapturedControl[] = [];
  for (const c of controls) {
    if (!c.tableId || seenTableIds.has(c.tableId)) continue;
    seenTableIds.add(c.tableId);
    representatives.push(c);
  }
  return representatives;
}

function buildUnknownScreenPrompt(
  processDescription: string,
  processContext: Record<string, string>,
  fields: CapturedControl[],
  buttons: CapturedControl[],
  tables: CapturedControl[]
): string {
  const contextLines =
    Object.keys(processContext).length > 0
      ? Object.entries(processContext).map(([key, value]) => `- ${key}: ${value}`).join('\n')
      : '(none provided)';
  const fieldLines = fields.length > 0 ? fields.map((f, i) => `${i + 1}. "${f.text ?? f.controlId}"`).join('\n') : '(none)';
  const buttonLines = buttons.length > 0 ? buttons.map((b, i) => `${i + 1}. "${b.text ?? b.controlId}"`).join('\n') : '(none)';
  const tableLines = tables.length > 0 ? tables.map((t, i) => `${i + 1}. "${t.text ?? t.controlId}" (column)`).join('\n') : '(none)';

  return [
    `A test automation engine is looking at a SAP Fiori screen that doesn't match any of its known page layouts (not a recognized List Report, Object Page, dialog, or Launchpad shell) and needs to decide the single next action to advance this process:`,
    `"${processDescription}"`,
    ``,
    `Available reference data for this process:`,
    contextLines,
    ``,
    `Fields that can be filled with reference data:`,
    fieldLines,
    ``,
    `Buttons that can be clicked:`,
    buttonLines,
    ``,
    `Tables whose first row can be selected (each one represents a whole table, by one of its columns):`,
    tableLines,
    ``,
    `Decide the SINGLE next action that best advances this process, using the reference data where its business meaning clearly matches a field (e.g. a "supplier" reference value into a "Supplier" or "Vendor" field). Reply with ONLY one line in exactly one of these formats, with no explanation:`,
    `FILL <field number> <reference data key>`,
    `CLICK <button number>`,
    `SELECT <table number>`,
    `NONE`,
  ].join('\n');
}

type UnknownScreenChoice =
  | { kind: 'fill'; control: CapturedControl; contextKey: string }
  | { kind: 'click'; control: CapturedControl }
  | { kind: 'select'; control: CapturedControl }
  | undefined;

/** Parses the model's reply back to one specific candidate — never trusts it blindly: an
 *  out-of-range index, an unknown reference-data key, or anything not in exactly one of the
 *  four accepted shapes all resolve to "no match" rather than guessing. */
function parseUnknownScreenResponse(
  response: string,
  fields: CapturedControl[],
  buttons: CapturedControl[],
  tables: CapturedControl[],
  processContext: Record<string, string>
): UnknownScreenChoice {
  const trimmed = response.trim();
  if (/^none$/i.test(trimmed)) return undefined;

  const fillMatch = trimmed.match(/^FILL\s+(\d+)\s+(\S+)$/i);
  if (fillMatch) {
    const control = fields[Number(fillMatch[1]) - 1];
    const contextKey = fillMatch[2];
    if (!control || !(contextKey in processContext)) return undefined;
    return { kind: 'fill', control, contextKey };
  }

  const clickMatch = trimmed.match(/^CLICK\s+(\d+)$/i);
  if (clickMatch) {
    const control = buttons[Number(clickMatch[1]) - 1];
    return control ? { kind: 'click', control } : undefined;
  }

  const selectMatch = trimmed.match(/^SELECT\s+(\d+)$/i);
  if (selectMatch) {
    const control = tables[Number(selectMatch[1]) - 1];
    return control ? { kind: 'select', control } : undefined;
  }

  return undefined;
}

/**
 * BL-047 Phase 2's second model-driven archetype: a screen that matches none of the fixed
 * Fiori elements templates (e.g. a Fiori Elements V4 app, whose control ids carry a different
 * namespace than the classic sap.suite.ui.generic.template.* markers decideListReportAction/
 * decideObjectPageAction target — confirmed via a real live capture where only 1 of 1260
 * captured controls even contained "ListReport" in its id). There is no fixed structural
 * signal linking an arbitrary field/button/table's label to an arbitrary process the way a
 * classic template's own control ids do, so — same reasoning as decideShellAction — this is a
 * model decision, not a rules one. Deliberately narrower in scope than a general "drive any
 * screen" agent: one action per call (fill one field, click one button, or select one table's
 * first row), always through the exact same review-and-registration path every other decision
 * in this module already goes through.
 */
async function decideUnknownAction(
  controls: CapturedControl[],
  processContext: Record<string, string>,
  history: NavigationHistory,
  appId: string,
  aiResolver: AiResolver | undefined,
): Promise<NavigationDecision> {
  if (!aiResolver) {
    return {
      kind: 'needsFallback',
      reason: 'Unrecognized screen: deciding what to do here needs an AI resolver, and none is configured — add an API key in Settings.',
    };
  }

  const fields = fillableFields(controls);
  const buttons = clickableButtons(controls);
  const tables = selectableTables(controls);
  if (fields.length === 0 && buttons.length === 0 && tables.length === 0) {
    return { kind: 'needsFallback', reason: 'Unrecognized screen: no fillable field, clickable button, or selectable table was captured.' };
  }

  const processDescription = humanizeAppId(appId);
  const response = await aiResolver.complete(buildUnknownScreenPrompt(processDescription, processContext, fields, buttons, tables));
  const choice = parseUnknownScreenResponse(response, fields, buttons, tables, processContext);
  if (!choice) {
    return {
      kind: 'needsFallback',
      reason: `Unrecognized screen: no confident next action found for "${processDescription}" — needs a human to take over.`,
    };
  }

  if (choice.kind === 'fill') {
    const historyKey = `fill:${choice.control.controlId}`;
    if (history.modulesRunOnThisScreen.includes(historyKey)) {
      return { kind: 'needsFallback', reason: `Unrecognized screen: already filled "${choice.control.text}" once — needs a human to check what happened.` };
    }
    return {
      kind: 'action',
      call: { module: 'EnterHeaderField', appId, params: { field: choice.control.controlId, value: processContext[choice.contextKey] } },
      historyKey,
    };
  }

  const historyKey = choice.kind === 'select' ? `select:${choice.control.controlId}` : `click:${choice.control.controlId}`;
  if (history.modulesRunOnThisScreen.includes(historyKey)) {
    return { kind: 'needsFallback', reason: `Unrecognized screen: already ${choice.kind === 'select' ? 'selected a row in' : 'clicked'} "${choice.control.text}" once without navigating away — needs a human to check what happened.` };
  }
  if (choice.kind === 'select') {
    return { kind: 'action', call: { module: 'SelectTableRow', appId, params: { field: choice.control.controlId, rowIndex: '0' } }, historyKey };
  }
  return { kind: 'action', call: { module: 'ClickButton', appId, params: { control: choice.control.controlId } }, historyKey };
}

/**
 * The single entry point BL-047 Phase 2's navigation loop calls once per screen visit. Never
 * throws for "couldn't decide" — that's a `needsFallback` result, not an exception, since not
 * being able to decide is an expected, handleable outcome (fall back to a model, or stop and
 * hand off to the mandatory review gate), not a bug. Async because the shell/Launchpad
 * archetype needs a real model call; every other archetype resolves synchronously underneath
 * but still returns through this same Promise so callers have one uniform entry point.
 */
export async function decideNextAction(
  controls: CapturedControl[],
  processContext: Record<string, string>,
  history: NavigationHistory,
  appId: string,
  aiResolver?: AiResolver,
): Promise<NavigationDecision> {
  const archetype = classifyScreenArchetype(controls);
  switch (archetype) {
    case 'list-report':
      return decideListReportAction(controls, processContext, history, appId);
    case 'object-page':
      return decideObjectPageAction(controls, processContext, history, appId);
    case 'dialog':
      return decideDialogAction(controls, appId);
    case 'shell':
      return decideShellAction(controls, appId, history, aiResolver);
    case 'unknown':
      return decideUnknownAction(controls, processContext, history, appId, aiResolver);
  }
}
