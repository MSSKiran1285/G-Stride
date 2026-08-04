'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { classifyScreenArchetype, decideNextAction } = require('../packages/engine/dist');

const APP_ID = 'createOutboundDelivery';

// Modeled on the real, live-captured control ids inspected for createOutboundDelivery during
// BL-047's design review (docs/ui-ux/AUTONOMOUS_TEST_AUTHORING_DESIGN.md) — genuine Fiori
// elements List Report technical ids, not invented shapes.
const listReportControls = [
  {
    controlId: 'i2d.le.st.delivery.create::sap.suite.ui.generic.template.ListReport.view.ListReport::C_OutboundDeliveryCreate--listReportFilter-filterItemControl_BASIC-SDDocument',
    controlType: 'sap.ui.comp.smartfilterbar.SFBMultiInput',
    text: 'SD Document',
    category: 'actionable',
  },
  {
    controlId: 'i2d.le.st.delivery.create::sap.suite.ui.generic.template.ListReport.view.ListReport::C_OutboundDeliveryCreate--listReportFilter-btnGo',
    controlType: 'sap.m.Button',
    text: 'Go',
    category: 'actionable',
  },
  {
    controlId: 'i2d.le.st.delivery.create::sap.suite.ui.generic.template.ListReport.view.ListReport::C_OutboundDeliveryCreate--responsiveTable',
    controlType: 'sap.m.Table',
    category: 'structural',
  },
  {
    controlId: 'i2d.le.st.delivery.create::sap.suite.ui.generic.template.ListReport.view.ListReport::C_OutboundDeliveryCreate--responsiveTable-DeliveryColumn',
    controlType: 'sap.m.Column',
    text: 'Delivery',
    category: 'structural',
    tableId: 'i2d.le.st.delivery.create::sap.suite.ui.generic.template.ListReport.view.ListReport::C_OutboundDeliveryCreate--responsiveTable',
  },
  {
    controlId: 'i2d.le.st.delivery.create::sap.suite.ui.generic.template.ListReport.view.ListReport::C_OutboundDeliveryCreate--createDelivery',
    controlType: 'sap.m.Button',
    text: 'Create Deliveries (1)',
    category: 'actionable',
  },
];

const dialogControls = [{ controlId: '__dialog1--confirmButton', controlType: 'sap.m.Button', text: 'OK', category: 'actionable' }];
const dialogWithMessageBox = [{ controlId: '__box1', controlType: 'sap.m.MessageBox', category: 'informational' }];

// Modeled on real Launchpad tile captures (see ui5Inspector.ts's ACTIONABLE_TYPES/
// AUTO_ID_EXEMPT_TYPES comments — sap.m.GenericTile with a short auto-id is the genuine,
// verified shape a tile renders as on this tenant, not a per-row clone).
const launchpadControls = [
  { controlId: '__tile12', controlType: 'sap.m.GenericTile', text: 'Manage Purchase Orders', category: 'actionable' },
  { controlId: '__tile13', controlType: 'sap.m.GenericTile', text: 'Create Purchase Requisition', category: 'actionable' },
  { controlId: '__tile14', controlType: 'sap.f.Card', text: 'Track Purchase Order Items', category: 'actionable' },
  { controlId: 'application-Shell-home-shellHeader', controlType: 'sap.f.ShellBar', category: 'structural' },
];

// Modeled on the real Process Purchase Requisitions screen reached live on 4 Aug 2026 — a
// Fiori Elements screen whose control ids carry a different template namespace than the
// classic sap.suite.ui.generic.template.* markers this module used to key off of (confirmed
// live: only 1 of 1260 captured controls even contained "ListReport" in its id). Field/button/
// table labels here are the real, observed ones from that screen.
const unknownScreenControls = [
  { controlId: '__field1', controlType: 'sap.m.Input', text: 'Purchase Requisition Number', category: 'actionable' },
  { controlId: '__field2', controlType: 'sap.m.Input', text: 'Plant', category: 'actionable' },
  { controlId: '__field3', controlType: 'sap.m.Input', text: 'Material Group', category: 'actionable' },
  { controlId: '__btnGo', controlType: 'sap.m.Button', text: 'Go', category: 'actionable' },
  { controlId: '__btnCreatePO', controlType: 'sap.m.Button', text: 'Create Purchase Order', category: 'actionable' },
  { controlId: '__table1', controlType: 'sap.m.Table', category: 'structural' },
  { controlId: '__col1', controlType: 'sap.m.Column', text: 'Purchase Requisition', category: 'structural', tableId: '__table1' },
  { controlId: '__col2', controlType: 'sap.m.Column', text: 'Material ID', category: 'structural', tableId: '__table1' },
];

const INSTRUCTION = 'Create a purchase requisition';

function fakeResolver(response) {
  const calls = [];
  return {
    complete: async (prompt) => {
      calls.push(prompt);
      return typeof response === 'function' ? response(prompt) : response;
    },
    calls,
  };
}

test('classifyScreenArchetype recognises a Fiori elements List Report by its control-id template marker', () => {
  assert.equal(classifyScreenArchetype(listReportControls), 'list-report');
});

test('classifyScreenArchetype recognises a dialog by control type, regardless of namespace', () => {
  assert.equal(classifyScreenArchetype(dialogControls.map((c) => ({ ...c, controlId: '__dialog1' }))), 'unknown');
  assert.equal(classifyScreenArchetype(dialogWithMessageBox), 'dialog');
});

test('classifyScreenArchetype recognises a Fiori Launchpad home screen by its tile control types', () => {
  assert.equal(classifyScreenArchetype(launchpadControls), 'shell');
});

test('classifyScreenArchetype returns unknown for a screen matching no known archetype', () => {
  assert.equal(classifyScreenArchetype([{ controlId: '__view1--randomThing', controlType: 'sap.m.Text', category: 'informational' }]), 'unknown');
});

test('Dialog: clicks the actionable button without ever calling the model (no instruction interpretation needed)', async () => {
  const resolver = fakeResolver('should never be called');
  const decision = await decideNextAction([...dialogWithMessageBox, ...dialogControls], INSTRUCTION, [], { modulesRunOnThisScreen: [] }, APP_ID, resolver);
  assert.equal(decision.kind, 'action');
  assert.equal(decision.call.module, 'ClickButton');
  assert.match(decision.call.params.control, /confirmButton$/);
  assert.match(decision.historyKey, /^click:.*confirmButton$/);
  assert.equal(resolver.calls.length, 0, 'a dialog is a fixed rule and must never call the model');
});

test('Dialog: needsFallback when no actionable button is present', async () => {
  const decision = await decideNextAction(dialogWithMessageBox, INSTRUCTION, [], { modulesRunOnThisScreen: [] }, APP_ID);
  assert.equal(decision.kind, 'needsFallback');
  assert.match(decision.reason, /Dialog/);
});

test('Every non-dialog archetype needsFallback with no AI resolver configured, never guesses', async () => {
  for (const controls of [listReportControls, launchpadControls, unknownScreenControls, [{ controlId: '__x', controlType: 'sap.m.Text', category: 'informational' }]]) {
    const decision = await decideNextAction(controls, INSTRUCTION, [], { modulesRunOnThisScreen: [] }, APP_ID);
    assert.equal(decision.kind, 'needsFallback');
    assert.match(decision.reason, /needs an AI resolver/i);
  }
});

test('needsFallback (without calling the model) when nothing fillable/clickable/selectable was captured', async () => {
  const resolver = fakeResolver('NONE');
  const decision = await decideNextAction(
    [{ controlId: '__text1', controlType: 'sap.m.Text', text: 'Some heading', category: 'informational' }],
    INSTRUCTION,
    [],
    { modulesRunOnThisScreen: [] },
    APP_ID,
    resolver
  );
  assert.equal(decision.kind, 'needsFallback');
  assert.equal(resolver.calls.length, 0, 'expected no model call when there is nothing to act on at all');
});

test('Launchpad shell: clicks the tile the model matches to the instruction, and the prompt carries the instruction and step log', async () => {
  const resolver = fakeResolver('CLICK 2');
  const decision = await decideNextAction(launchpadControls, INSTRUCTION, ['Opened the Launchpad'], { modulesRunOnThisScreen: [] }, APP_ID, resolver);
  assert.equal(decision.kind, 'action');
  assert.equal(decision.call.module, 'ClickButton');
  assert.equal(decision.call.params.control, '__tile13');
  assert.equal(decision.historyKey, 'click:__tile13');
  assert.match(resolver.calls[0], /Create a purchase requisition/);
  assert.match(resolver.calls[0], /1\. Opened the Launchpad/);
  assert.match(resolver.calls[0], /2\. "Create Purchase Requisition"/);
});

test('Launchpad shell: needsFallback when the model replies NONE', async () => {
  const resolver = fakeResolver('NONE');
  const decision = await decideNextAction(launchpadControls, INSTRUCTION, [], { modulesRunOnThisScreen: [] }, APP_ID, resolver);
  assert.equal(decision.kind, 'needsFallback');
});

test('Launchpad shell: needsFallback when the matched tile was already clicked without navigating away', async () => {
  const resolver = fakeResolver('CLICK 2');
  const decision = await decideNextAction(launchpadControls, INSTRUCTION, [], { modulesRunOnThisScreen: ['click:__tile13'] }, APP_ID, resolver);
  assert.equal(decision.kind, 'needsFallback');
  assert.match(decision.reason, /already clicked/i);
});

test('List Report screen: the model can fill the search field with a literal value extracted from the instruction', async () => {
  const resolver = fakeResolver('FILL 1 4500009999');
  const decision = await decideNextAction(listReportControls, 'Search for SD document 4500009999 and create the delivery', [], { modulesRunOnThisScreen: [] }, APP_ID, resolver);
  assert.equal(decision.kind, 'action');
  assert.equal(decision.call.module, 'EnterHeaderField');
  assert.match(decision.call.params.field, /SDDocument$/);
  assert.equal(decision.call.params.value, '4500009999');
  assert.match(decision.historyKey, /^fill:/);
  assert.match(resolver.calls[0], /List Report/);
});

test('List Report screen: the model can select a row via a captured column, never the table control itself', async () => {
  const resolver = fakeResolver('SELECT 1');
  const decision = await decideNextAction(listReportControls, INSTRUCTION, ['Filled the search field', 'Ran the search'], { modulesRunOnThisScreen: [] }, APP_ID, resolver);
  assert.equal(decision.kind, 'action');
  assert.equal(decision.call.module, 'SelectTableRow');
  assert.match(decision.call.params.field, /DeliveryColumn$/);
  assert.equal(decision.call.params.rowIndex, '0');
});

test('Unrecognized screen: fills the field the model matches, with a value it extracted itself from the instruction', async () => {
  const resolver = fakeResolver('FILL 1 1000123');
  const decision = await decideNextAction(unknownScreenControls, 'Create purchase requisition number 1000123', [], { modulesRunOnThisScreen: [] }, 'createPurchaseRequisition', resolver);
  assert.equal(decision.kind, 'action');
  assert.equal(decision.call.module, 'EnterHeaderField');
  assert.equal(decision.call.params.field, '__field1');
  assert.equal(decision.call.params.value, '1000123');
  assert.equal(decision.historyKey, 'fill:__field1');
  assert.match(resolver.calls[0], /Purchase Requisition Number/);
  assert.match(resolver.calls[0], /literal value to type/);
});

test('Unrecognized screen: clicks the button the model picks', async () => {
  const resolver = fakeResolver('CLICK 1');
  const decision = await decideNextAction(unknownScreenControls, INSTRUCTION, [], { modulesRunOnThisScreen: [] }, 'createPurchaseRequisition', resolver);
  assert.equal(decision.kind, 'action');
  assert.equal(decision.call.module, 'ClickButton');
  assert.equal(decision.call.params.control, '__btnGo');
  assert.equal(decision.historyKey, 'click:__btnGo');
});

test('Unrecognized screen: selects the first row via the table the model picks', async () => {
  const resolver = fakeResolver('SELECT 1');
  const decision = await decideNextAction(unknownScreenControls, INSTRUCTION, [], { modulesRunOnThisScreen: [] }, 'createPurchaseRequisition', resolver);
  assert.equal(decision.kind, 'action');
  assert.equal(decision.call.module, 'SelectTableRow');
  assert.equal(decision.call.params.field, '__col1');
  assert.equal(decision.call.params.rowIndex, '0');
  assert.equal(decision.historyKey, 'select:__col1');
});

test('Unrecognized screen: reports DONE when the model judges the instruction fully carried out', async () => {
  const resolver = fakeResolver('DONE');
  const decision = await decideNextAction(
    unknownScreenControls,
    INSTRUCTION,
    ['Filled Purchase Requisition Number', 'Clicked Create Purchase Order'],
    { modulesRunOnThisScreen: [] },
    'createPurchaseRequisition',
    resolver
  );
  assert.equal(decision.kind, 'done');
});

test('Unrecognized screen: needsFallback when the model replies NONE', async () => {
  const resolver = fakeResolver('NONE');
  const decision = await decideNextAction(unknownScreenControls, INSTRUCTION, [], { modulesRunOnThisScreen: [] }, 'createPurchaseRequisition', resolver);
  assert.equal(decision.kind, 'needsFallback');
});

test('Unrecognized screen: needsFallback on a reply that is not one of the five accepted shapes', async () => {
  const resolver = fakeResolver('Sure, fill the first field with the requisition number');
  const decision = await decideNextAction(unknownScreenControls, INSTRUCTION, [], { modulesRunOnThisScreen: [] }, 'createPurchaseRequisition', resolver);
  assert.equal(decision.kind, 'needsFallback');
});

test('Unrecognized screen: needsFallback on an out-of-range field number', async () => {
  const resolver = fakeResolver('FILL 99 1000123');
  const decision = await decideNextAction(unknownScreenControls, INSTRUCTION, [], { modulesRunOnThisScreen: [] }, 'createPurchaseRequisition', resolver);
  assert.equal(decision.kind, 'needsFallback');
});

test('Unrecognized screen: needsFallback on a FILL reply with no value at all', async () => {
  const resolver = fakeResolver('FILL 1 ');
  const decision = await decideNextAction(unknownScreenControls, INSTRUCTION, [], { modulesRunOnThisScreen: [] }, 'createPurchaseRequisition', resolver);
  assert.equal(decision.kind, 'needsFallback');
});

test('Unrecognized screen: needsFallback when the chosen field was already filled once on this screen', async () => {
  const resolver = fakeResolver('FILL 1 1000123');
  const decision = await decideNextAction(
    unknownScreenControls,
    INSTRUCTION,
    [],
    { modulesRunOnThisScreen: ['fill:__field1'] },
    'createPurchaseRequisition',
    resolver
  );
  assert.equal(decision.kind, 'needsFallback');
  assert.match(decision.reason, /already filled/i);
});

test('Unrecognized screen: needsFallback when the chosen button was already clicked once without making progress', async () => {
  const resolver = fakeResolver('CLICK 1');
  const decision = await decideNextAction(
    unknownScreenControls,
    INSTRUCTION,
    [],
    { modulesRunOnThisScreen: ['click:__btnGo'] },
    'createPurchaseRequisition',
    resolver
  );
  assert.equal(decision.kind, 'needsFallback');
  assert.match(decision.reason, /already clicked/i);
});

// The exact real scenario that motivated this whole rewrite: seven consecutive live steps
// (ProcurementControl, ProcessPurchaseRequisitionsControl, InternalBtnButton, TriggerButton,
// SaveAsButton, SaveButton, SaveButton again) with no instruction and no step memory, each a
// plausible-looking but ultimately aimless click. With a real instruction and step log
// supplied, the model has what it needs to recognise "already saved" and stop instead of
// re-clicking Save a second time.
test('Unrecognized screen: the prompt includes the full step log so the model can recognise repeated saves are not progress', async () => {
  const resolver = fakeResolver('DONE');
  const stepLog = ['Filled "Purchase Requisition Number" with "1000123"', 'Clicked "Create Purchase Order"', 'Clicked "Save"'];
  await decideNextAction(unknownScreenControls, INSTRUCTION, stepLog, { modulesRunOnThisScreen: [] }, 'createPurchaseRequisition', resolver);
  assert.match(resolver.calls[0], /1\. Filled "Purchase Requisition Number" with "1000123"/);
  assert.match(resolver.calls[0], /3\. Clicked "Save"/);
  assert.match(resolver.calls[0], /instruction is now fully carried out, reply DONE/);
});

// The live My Timesheet screen (4 Aug 2026) that produced the next round of feedback. Its four
// tasks are sap.m.ObjectListItem rows — the only controls on screen that could satisfy "select
// the task" — alongside a toolbar of icon-only buttons whose captured text is genuinely empty.
const timesheetControls = [
  { controlId: 'app--timesheetMain--workList-0', controlType: 'sap.m.ObjectListItem', text: 'Administration Tasks', category: 'actionable' },
  { controlId: 'app--timesheetMain--workList-1', controlType: 'sap.m.ObjectListItem', text: 'Miscellaneous', category: 'actionable' },
  { controlId: 'app--timesheetMain--workList-2', controlType: 'sap.m.ObjectListItem', text: 'Training', category: 'actionable' },
  { controlId: 'app--timesheetMain--workList-3', controlType: 'sap.m.ObjectListItem', text: 'Travel Times', category: 'actionable' },
  { controlId: 'app--timesheetMain--alertBtn', controlType: 'sap.m.Button', category: 'actionable' },
  { controlId: 'app--timesheetMain--copyBtn', controlType: 'sap.m.Button', category: 'actionable' },
  { controlId: 'app--timesheetMain--saveSubmit', controlType: 'sap.m.Button', text: 'Save & Submit', category: 'actionable' },
];

const TIMESHEET_INSTRUCTION =
  'Go to Project Management, click on Manage My Timesheet and select the task. Enter 5 hours for today and save & submit.';

test('a list row is a click candidate — "select the task" could not be carried out otherwise', async () => {
  const resolver = fakeResolver((prompt) => {
    assert.match(prompt, /"Administration Tasks"/);
    return 'CLICK 1';
  });
  const decision = await decideNextAction(
    timesheetControls,
    TIMESHEET_INSTRUCTION,
    [],
    { modulesRunOnThisScreen: [] },
    'createTimesheet',
    resolver
  );
  assert.equal(decision.kind, 'action');
  assert.equal(decision.call.module, 'ClickButton');
  assert.equal(decision.call.params.control, 'app--timesheetMain--workList-0');
});

// A raw control id is not a label: the model cannot choose between a list of them on merit, and
// whatever it does pick registers into the Object Repository under a name derived from that same
// id. Live on 4 Aug 2026 this produced a step reading `ClickButton control=Button` followed by
// `Already clicked "undefined"`.
test('an unlabelled control is never offered to the model, and no control id ever appears in the prompt', async () => {
  const resolver = fakeResolver('CLICK 1');
  await decideNextAction(timesheetControls, TIMESHEET_INSTRUCTION, [], { modulesRunOnThisScreen: [] }, 'createTimesheet', resolver);
  const prompt = resolver.calls[0];

  assert.ok(!prompt.includes('alertBtn'), 'an unlabelled button must not be offered as a candidate');
  assert.ok(!prompt.includes('copyBtn'), 'an unlabelled button must not be offered as a candidate');
  for (const control of timesheetControls) {
    if (!control.text) assert.ok(!prompt.includes(control.controlId), `${control.controlId} leaked into the prompt`);
  }
  // The labelled ones are all still there — this filters noise, it does not lose real options.
  assert.match(prompt, /"Save & Submit"/);
  assert.match(prompt, /"Travel Times"/);
});

test('the candidate numbering the model replies against matches the filtered list, not the raw capture', async () => {
  // "Save & Submit" is the 5th labelled clickable (4 rows, then it) even though it is the 7th
  // control captured — an off-by-one here would click a completely unrelated control.
  const resolver = fakeResolver('CLICK 5');
  const decision = await decideNextAction(
    timesheetControls,
    TIMESHEET_INSTRUCTION,
    [],
    { modulesRunOnThisScreen: [] },
    'createTimesheet',
    resolver
  );
  assert.equal(decision.kind, 'action');
  assert.equal(decision.call.params.control, 'app--timesheetMain--saveSubmit');
});

test('needsFallback when every candidate on the screen is unlabelled — better to say so than to offer a blind choice', async () => {
  const resolver = fakeResolver('CLICK 1');
  const decision = await decideNextAction(
    timesheetControls.filter((c) => !c.text),
    TIMESHEET_INSTRUCTION,
    [],
    { modulesRunOnThisScreen: [] },
    'createTimesheet',
    resolver
  );
  assert.equal(decision.kind, 'needsFallback');
  assert.equal(resolver.calls.length, 0, 'with nothing nameable to choose between, the model should not be called at all');
});

test('a repeat-action fallback names the control the human will recognise, never "undefined"', async () => {
  const resolver = fakeResolver('CLICK 1');
  const decision = await decideNextAction(
    timesheetControls,
    TIMESHEET_INSTRUCTION,
    [],
    { modulesRunOnThisScreen: ['click:app--timesheetMain--workList-0'] },
    'createTimesheet',
    resolver
  );
  assert.equal(decision.kind, 'needsFallback');
  assert.match(decision.reason, /Administration Tasks/);
  assert.ok(!decision.reason.includes('undefined'), 'the reason must name the control, not interpolate an absent label');
});
