import { ModuleCall } from '@taf/core';
import { AiResolver } from './aiResolver';

/**
 * BL-047 Phase 2's live-navigation decision policy: given whatever screen the engine is
 * currently looking at (as a plain capture, not tied to any one adapter's own type — see the
 * note on CapturedControl below), a plain-English instruction, and a log of what's already been
 * done this run, decide the single next action to take — or say plainly that it can't.
 *
 * Design history: this module originally tried a fixed decision tree per Fiori elements
 * archetype first, with a model only as a fallback for Launchpad tiles and unrecognized
 * screens, driven by an abstract `Record<string,string>` of reference values with no memory of
 * an overall goal. Live testing on 4 Aug 2026 showed exactly why that failed: on a real screen,
 * the model — given only "here are some buttons, pick one" with no instruction and no history —
 * clicked Save, Save As, Save, Save again, seven times, with no coherent progress. The owner's
 * direction after seeing that: switch entirely to a natural-language instruction as the single
 * source of intent, keep a running log of completed steps as the model's memory of its own
 * progress, and let the model decide every non-dialog screen this way — "the model should be
 * the foundation", not a last resort behind two now-dead fixed-rule paths (the old List
 * Report/Object Page rules depended on that same abstract key-value dictionary and have never
 * once fired correctly in real testing; every real screen hit has been Launchpad or
 * unrecognized). Dialogs stay a fixed rule — confirming/dismissing one is unambiguous and needs
 * no instruction interpretation.
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
 *  inspected during BL-047's design review. Still used to give the model a one-line hint about
 *  what kind of screen it's looking at, even though the decision itself is no longer a fixed
 *  rule for these two archetypes (see the module comment above). */
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
 *  state of its own. Screen-scoped (reset on archetype change) — separate from the run-wide
 *  step log, which is the model's memory of overall progress on the instruction. */
export interface NavigationHistory {
  modulesRunOnThisScreen: string[];
}

export type NavigationDecision =
  | { kind: 'action'; call: ModuleCall; historyKey: string }
  | { kind: 'done' }
  | { kind: 'needsFallback'; reason: string };

/** A confirmation dialog reads its own message and takes the primary (rightmost/first
 *  actionable) button — the same "read message -> primary action" shape every dialog in this
 *  product's existing Tests already follows (e.g. create-delivery.json's own confirmation
 *  steps), just made an explicit rule instead of hand-authored per Test. The one archetype that
 *  stays a fixed rule: confirming/dismissing a dialog needs no instruction interpretation. */
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

const FILLABLE_TYPE_PATTERN = /Input|Field|TextArea|ComboBox|DatePicker|Select|MultiInput/i;
const BUTTON_TYPE_PATTERN = /Button|ListItem/i;

/**
 * The one human-readable name for a control, or nothing at all — never its control id.
 *
 * A raw id ("...timesheetMain--copyBtn") is not a label: no model can reliably choose between a
 * list of them, and whatever it does pick then gets registered into the Object Repository under
 * a name derived from that same id. Both halves of that were seen for real on 4 Aug 2026 — the
 * loop clicked a text-less control, saved it as "Button", and then reported it back as
 * `Already clicked "undefined"`. So an unlabelled control is now simply not a candidate: it is
 * better to say plainly that there is nothing actionable here than to offer a choice that cannot
 * be made on merit. ui5Inspector's tooltip/icon fallback exists to make sure genuinely
 * meaningful icon-only buttons still arrive here with a label rather than being dropped.
 */
export function labelOf(control: CapturedControl): string | undefined {
  const text = control.text?.trim();
  return text ? text : undefined;
}

function fillableFields(controls: CapturedControl[]): CapturedControl[] {
  return controls.filter((c) => c.category === 'actionable' && FILLABLE_TYPE_PATTERN.test(c.controlType) && labelOf(c));
}

/** Ordinary buttons, list rows and Launchpad tiles — from the model's perspective, clicking any
 *  of them is the same kind of action (advance by clicking something), so they share one CLICK
 *  candidate list instead of needing separate archetype-specific decision paths. List rows are
 *  included because "select the task"/"open the order" is a click on a row, and on a real
 *  timesheet screen the rows were the only controls that could have satisfied the instruction. */
function clickableButtons(controls: CapturedControl[]): CapturedControl[] {
  const buttons = controls.filter((c) => c.category === 'actionable' && BUTTON_TYPE_PATTERN.test(c.controlType));
  const tiles = controls.filter((c) => SHELL_TILE_TYPES.has(c.controlType));
  return [...buttons, ...tiles].filter((c) => labelOf(c));
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

function archetypeHint(archetype: ScreenArchetype): string {
  switch (archetype) {
    case 'shell':
      return 'a Fiori Launchpad screen (a home page or a category page) showing navigation tiles';
    case 'list-report':
      return 'a List Report search/results screen';
    case 'object-page':
      return 'an Object Page detail/edit screen';
    case 'dialog':
      return 'a dialog';
    case 'unknown':
      return "a screen whose exact layout isn't recognized";
  }
}

function buildInstructionPrompt(
  instruction: string,
  stepLog: string[],
  archetype: ScreenArchetype,
  fields: CapturedControl[],
  buttons: CapturedControl[],
  tables: CapturedControl[]
): string {
  const stepLines = stepLog.length > 0 ? stepLog.map((s, i) => `${i + 1}. ${s}`).join('\n') : '(none yet)';
  const fieldLines = fields.length > 0 ? fields.map((f, i) => `${i + 1}. "${labelOf(f)}"`).join('\n') : '(none)';
  const buttonLines = buttons.length > 0 ? buttons.map((b, i) => `${i + 1}. "${labelOf(b)}"`).join('\n') : '(none)';
  const tableLines =
    tables.length > 0 ? tables.map((t, i) => `${i + 1}. "${labelOf(t) ?? 'unnamed table'}" (column)`).join('\n') : '(none)';

  return [
    `You are driving a live SAP Fiori UI, one action at a time, to carry out this instruction:`,
    `"${instruction}"`,
    ``,
    `Steps already completed so far:`,
    stepLines,
    ``,
    `You are now looking at ${archetypeHint(archetype)}.`,
    ``,
    `Fields that can be filled with a literal value:`,
    fieldLines,
    ``,
    `Buttons or tiles that can be clicked:`,
    buttonLines,
    ``,
    `Tables whose first row can be selected (each one represents a whole table, by one of its columns):`,
    tableLines,
    ``,
    `SAP Fiori tiles and buttons are often named after the business object and a generic verb (Process, Manage, Post, Monitor, ...) rather than the exact word used in the instruction — match on business meaning and intent, not literal wording. A broad department/category tile (e.g. "Procurement", "Finance") is a reasonable pick when no more specific tile or field is visible yet, but a specific one always outranks a broader category when both are visible together.`,
    ``,
    `Decide the SINGLE next action that makes progress on the instruction, given what's already been done. Extract any literal value to type (a number, a date, a name, ...) directly from the instruction's own wording. If the instruction is now fully carried out, reply DONE. If nothing here helps make progress, reply NONE. Reply with ONLY one line in exactly one of these formats, with no explanation:`,
    `FILL <field number> <literal value to type>`,
    `CLICK <button number>`,
    `SELECT <table number>`,
    `DONE`,
    `NONE`,
  ].join('\n');
}

type InstructionChoice =
  | { kind: 'fill'; control: CapturedControl; value: string }
  | { kind: 'click'; control: CapturedControl }
  | { kind: 'select'; control: CapturedControl }
  | { kind: 'done' }
  | { kind: 'none' };

/** Parses the model's reply back to one specific candidate — never trusts it blindly: an
 *  out-of-range index, an empty value, or anything not in exactly one of the five accepted
 *  shapes all resolve to "no match" rather than guessing. */
function parseInstructionResponse(
  response: string,
  fields: CapturedControl[],
  buttons: CapturedControl[],
  tables: CapturedControl[]
): InstructionChoice {
  const trimmed = response.trim();
  if (/^none$/i.test(trimmed)) return { kind: 'none' };
  if (/^done$/i.test(trimmed)) return { kind: 'done' };

  const fillMatch = trimmed.match(/^FILL\s+(\d+)\s+(.+)$/i);
  if (fillMatch) {
    const control = fields[Number(fillMatch[1]) - 1];
    const value = fillMatch[2].trim();
    if (!control || !value) return { kind: 'none' };
    return { kind: 'fill', control, value };
  }

  const clickMatch = trimmed.match(/^CLICK\s+(\d+)$/i);
  if (clickMatch) {
    const control = buttons[Number(clickMatch[1]) - 1];
    return control ? { kind: 'click', control } : { kind: 'none' };
  }

  const selectMatch = trimmed.match(/^SELECT\s+(\d+)$/i);
  if (selectMatch) {
    const control = tables[Number(selectMatch[1]) - 1];
    return control ? { kind: 'select', control } : { kind: 'none' };
  }

  return { kind: 'none' };
}

/**
 * The one model-driven decision every non-dialog archetype now goes through. There is no fixed
 * structural signal linking an arbitrary field/button/tile/table's label to an arbitrary
 * instruction the way a dialog's "one obvious button" is unambiguous — deciding this is a
 * language task, not a rules one. Requires an AiResolver to be supplied at all — with none
 * configured, this is an immediate, clearly-worded needsFallback rather than a crash or a guess.
 */
async function decideWithModel(
  controls: CapturedControl[],
  instruction: string,
  stepLog: string[],
  history: NavigationHistory,
  appId: string,
  aiResolver: AiResolver | undefined,
  archetype: ScreenArchetype
): Promise<NavigationDecision> {
  if (!aiResolver) {
    return {
      kind: 'needsFallback',
      reason: 'Deciding the next action needs an AI resolver, and none is configured — add an API key in Settings.',
    };
  }

  const fields = fillableFields(controls);
  const buttons = clickableButtons(controls);
  const tables = selectableTables(controls);
  if (fields.length === 0 && buttons.length === 0 && tables.length === 0) {
    return { kind: 'needsFallback', reason: 'No fillable field, clickable button/tile, or selectable table was captured on this screen.' };
  }

  const response = await aiResolver.complete(buildInstructionPrompt(instruction, stepLog, archetype, fields, buttons, tables));
  const choice = parseInstructionResponse(response, fields, buttons, tables);

  if (choice.kind === 'none') {
    return { kind: 'needsFallback', reason: `No confident next action found for "${instruction}" from this screen — needs a human to take over.` };
  }
  if (choice.kind === 'done') {
    return { kind: 'done' };
  }
  if (choice.kind === 'fill') {
    const historyKey = `fill:${choice.control.controlId}`;
    if (history.modulesRunOnThisScreen.includes(historyKey)) {
      return { kind: 'needsFallback', reason: `Already filled "${labelOf(choice.control)}" once on this screen — needs a human to check what happened.` };
    }
    return {
      kind: 'action',
      call: { module: 'EnterHeaderField', appId, params: { field: choice.control.controlId, value: choice.value } },
      historyKey,
    };
  }

  const historyKey = choice.kind === 'select' ? `select:${choice.control.controlId}` : `click:${choice.control.controlId}`;
  if (history.modulesRunOnThisScreen.includes(historyKey)) {
    return {
      kind: 'needsFallback',
      reason: `Already ${choice.kind === 'select' ? 'selected a row in' : 'clicked'} "${labelOf(choice.control) ?? choice.control.controlId}" once without making progress — needs a human to check what happened.`,
    };
  }
  if (choice.kind === 'select') {
    return { kind: 'action', call: { module: 'SelectTableRow', appId, params: { field: choice.control.controlId, rowIndex: '0' } }, historyKey };
  }
  return { kind: 'action', call: { module: 'ClickButton', appId, params: { control: choice.control.controlId } }, historyKey };
}

/**
 * The single entry point BL-047 Phase 2's navigation loop calls once per screen visit. Never
 * throws for "couldn't decide" — that's a `needsFallback` result, not an exception, since not
 * being able to decide is an expected, handleable outcome (stop and hand off to the mandatory
 * review gate), not a bug. Dialogs are the one fixed rule; every other archetype is decided by
 * the model, grounded in the plain-English instruction and the run's own step log.
 */
export async function decideNextAction(
  controls: CapturedControl[],
  instruction: string,
  stepLog: string[],
  history: NavigationHistory,
  appId: string,
  aiResolver?: AiResolver,
): Promise<NavigationDecision> {
  const archetype = classifyScreenArchetype(controls);
  if (archetype === 'dialog') return decideDialogAction(controls, appId);
  return decideWithModel(controls, instruction, stepLog, history, appId, aiResolver, archetype);
}
