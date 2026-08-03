'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { classifyScreenArchetype, decideNextAction, humanizeAppId } = require('../packages/engine/dist');

const APP_ID = 'createOutboundDelivery';

// Modeled on the real, live-captured control ids inspected for createOutboundDelivery during
// BL-047's design review (docs/ui-ux/AUTONOMOUS_TEST_AUTHORING_DESIGN.md) — genuine Fiori
// elements List Report technical ids, not invented shapes.
const listReportControls = [
  {
    controlId: 'i2d.le.st.delivery.create::sap.suite.ui.generic.template.ListReport.view.ListReport::C_OutboundDeliveryCreate--listReportFilter-filterItemControl_BASIC-SDDocument',
    controlType: 'sap.ui.comp.smartfilterbar.SFBMultiInput',
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
    // Real Fiori elements capture: a table's own columns are captured as their own controls,
    // each carrying tableId back to the enclosing table (see ui5Inspector.ts's
    // TABLE_CONTAINER_TYPES handling) — SelectTableRow needs one of these, never the table
    // control itself (packages/engine/src/modules/selectTableRow.ts requires control.tableId).
    controlId: 'i2d.le.st.delivery.create::sap.suite.ui.generic.template.ListReport.view.ListReport::C_OutboundDeliveryCreate--responsiveTable-DeliveryColumn',
    controlType: 'sap.m.Column',
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

const objectPageControls = [
  {
    controlId: '__xmlview11--S1SupplierField',
    controlType: 'sap.m.Input',
    category: 'actionable',
  },
  {
    controlId: '__xmlview11--S1SaveButton',
    controlType: 'sap.m.Button',
    text: 'Save',
    category: 'actionable',
  },
];
// Real Fiori elements namespace marker so classification actually exercises the template-id
// signal rather than the empty "unknown" fallback.
for (const c of objectPageControls) {
  c.controlId = `i2d.le.st.delivery.log::sap.suite.ui.generic.template.ObjectPage.view.Details::${c.controlId}`;
}

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

test('classifyScreenArchetype recognises a Fiori elements Object Page by its control-id template marker', () => {
  assert.equal(classifyScreenArchetype(objectPageControls), 'object-page');
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

test('humanizeAppId turns a camelCase App ID back into a readable phrase', () => {
  assert.equal(humanizeAppId('createPurchaseRequisition'), 'Create Purchase Requisition');
  assert.equal(humanizeAppId('createOutboundDelivery'), 'Create Outbound Delivery');
});

test('List Report: searches first, using the first process-context value, when nothing has run yet', async () => {
  const decision = await decideNextAction(listReportControls, { soNumber: '4500009999' }, { modulesRunOnThisScreen: [] }, APP_ID);
  assert.equal(decision.kind, 'action');
  assert.equal(decision.call.module, 'EnterHeaderField');
  assert.equal(decision.call.params.value, '4500009999');
  assert.match(decision.call.params.field, /SDDocument/);
  assert.equal(decision.historyKey, 'search');
});

test('List Report: selects the first results row via a captured column (never the table itself) once a search has already run', async () => {
  const decision = await decideNextAction(listReportControls, { soNumber: '4500009999' }, { modulesRunOnThisScreen: ['search'] }, APP_ID);
  assert.equal(decision.kind, 'action');
  assert.equal(decision.call.module, 'SelectTableRow');
  assert.equal(decision.call.params.rowIndex, '0');
  assert.match(decision.call.params.field, /DeliveryColumn$/);
  assert.equal(decision.historyKey, 'select-row');
});

test('List Report: clicks the primary action once search and row selection have both run', async () => {
  const decision = await decideNextAction(listReportControls, { soNumber: '4500009999' }, { modulesRunOnThisScreen: ['search', 'select-row'] }, APP_ID);
  assert.equal(decision.kind, 'action');
  assert.equal(decision.call.module, 'ClickButton');
  assert.match(decision.call.params.control, /createDelivery$/);
  assert.match(decision.historyKey, /^click:.*createDelivery$/);
});

test('List Report: needsFallback when no search field, table, or unexercised action can be found', async () => {
  const decision = await decideNextAction(
    [{ controlId: 'x::sap.suite.ui.generic.template.ListReport.view.ListReport::onlyText', controlType: 'sap.m.Text', category: 'informational' }],
    {},
    { modulesRunOnThisScreen: [] },
    APP_ID,
  );
  assert.equal(decision.kind, 'needsFallback');
  assert.match(decision.reason, /List Report/);
});

test('Object Page: fills a field whose control id matches a process-context key', async () => {
  const decision = await decideNextAction(objectPageControls, { supplier: 'USSU-TRL07' }, { modulesRunOnThisScreen: [] }, APP_ID);
  assert.equal(decision.kind, 'action');
  assert.equal(decision.call.module, 'EnterHeaderField');
  assert.equal(decision.call.params.value, 'USSU-TRL07');
  assert.match(decision.call.params.field, /SupplierField/);
  assert.match(decision.historyKey, /^fill:.*SupplierField$/);
});

test('Object Page: clicks Save once the matching field is already filled', async () => {
  const fillKey = `fill:i2d.le.st.delivery.log::sap.suite.ui.generic.template.ObjectPage.view.Details::__xmlview11--S1SupplierField`;
  const decision = await decideNextAction(objectPageControls, { supplier: 'USSU-TRL07' }, { modulesRunOnThisScreen: [fillKey] }, APP_ID);
  assert.equal(decision.kind, 'action');
  assert.equal(decision.call.module, 'ClickButton');
  assert.match(decision.call.params.control, /SaveButton$/);
  assert.match(decision.historyKey, /^click:.*SaveButton$/);
});

test('Object Page: needsFallback when nothing to fill and no recognisable commit action exists', async () => {
  const decision = await decideNextAction(
    [{ controlId: 'x::sap.suite.ui.generic.template.ObjectPage.view.Details::onlyText', controlType: 'sap.m.Text', category: 'informational' }],
    { supplier: 'USSU-TRL07' },
    { modulesRunOnThisScreen: [] },
    APP_ID,
  );
  assert.equal(decision.kind, 'needsFallback');
  assert.match(decision.reason, /Object Page/);
});

test('Dialog: clicks the actionable button', async () => {
  const decision = await decideNextAction([...dialogWithMessageBox, ...dialogControls], {}, { modulesRunOnThisScreen: [] }, APP_ID);
  assert.equal(decision.kind, 'action');
  assert.equal(decision.call.module, 'ClickButton');
  assert.match(decision.call.params.control, /confirmButton$/);
  assert.match(decision.historyKey, /^click:.*confirmButton$/);
});

test('Dialog: needsFallback when no actionable button is present', async () => {
  const decision = await decideNextAction(dialogWithMessageBox, {}, { modulesRunOnThisScreen: [] }, APP_ID);
  assert.equal(decision.kind, 'needsFallback');
  assert.match(decision.reason, /Dialog/);
});

test('unknown archetype always needsFallback, never guesses', async () => {
  const decision = await decideNextAction(
    [{ controlId: '__view1--randomThing', controlType: 'sap.m.Text', category: 'informational' }],
    { anything: 'value' },
    { modulesRunOnThisScreen: [] },
    APP_ID,
  );
  assert.equal(decision.kind, 'needsFallback');
  assert.match(decision.reason, /did not match any known Fiori elements archetype/);
});

test('Launchpad shell: needsFallback with no AI resolver configured, rather than guessing a tile', async () => {
  const decision = await decideNextAction(launchpadControls, {}, { modulesRunOnThisScreen: [] }, 'createPurchaseRequisition');
  assert.equal(decision.kind, 'needsFallback');
  assert.match(decision.reason, /no AI resolver is configured|Add an API key/i);
});

test('Launchpad shell: clicks the tile the model matches to the humanized App ID', async () => {
  const resolver = fakeResolver('2');
  const decision = await decideNextAction(launchpadControls, {}, { modulesRunOnThisScreen: [] }, 'createPurchaseRequisition', resolver);
  assert.equal(decision.kind, 'action');
  assert.equal(decision.call.module, 'ClickButton');
  assert.equal(decision.call.params.control, '__tile13');
  assert.equal(decision.historyKey, 'click:__tile13');
  assert.match(resolver.calls[0], /Create Purchase Requisition/);
  assert.match(resolver.calls[0], /1\. Manage Purchase Orders/);
  assert.match(resolver.calls[0], /2\. Create Purchase Requisition/);
});

test('Launchpad shell: needsFallback when the model replies NONE', async () => {
  const resolver = fakeResolver('NONE');
  const decision = await decideNextAction(launchpadControls, {}, { modulesRunOnThisScreen: [] }, 'createPurchaseRequisition', resolver);
  assert.equal(decision.kind, 'needsFallback');
  assert.match(decision.reason, /no tile confidently matched/);
});

test('Launchpad shell: needsFallback on an unparseable model reply, rather than guessing', async () => {
  const resolver = fakeResolver('The second one looks right');
  const decision = await decideNextAction(launchpadControls, {}, { modulesRunOnThisScreen: [] }, 'createPurchaseRequisition', resolver);
  assert.equal(decision.kind, 'needsFallback');
});

test('Launchpad shell: needsFallback on an out-of-range tile number', async () => {
  const resolver = fakeResolver('99');
  const decision = await decideNextAction(launchpadControls, {}, { modulesRunOnThisScreen: [] }, 'createPurchaseRequisition', resolver);
  assert.equal(decision.kind, 'needsFallback');
});

test('Launchpad shell: needsFallback when the matched tile was already clicked without navigating away', async () => {
  const resolver = fakeResolver('2');
  const decision = await decideNextAction(launchpadControls, {}, { modulesRunOnThisScreen: ['click:__tile13'] }, 'createPurchaseRequisition', resolver);
  assert.equal(decision.kind, 'needsFallback');
  assert.match(decision.reason, /already clicked the matching tile/);
});

test('Launchpad shell: needsFallback when no tile has visible text to match against', async () => {
  const resolver = fakeResolver('1');
  const decision = await decideNextAction(
    [{ controlId: '__tile1', controlType: 'sap.m.GenericTile', category: 'actionable' }],
    {},
    { modulesRunOnThisScreen: [] },
    'createPurchaseRequisition',
    resolver,
  );
  assert.equal(decision.kind, 'needsFallback');
  assert.match(decision.reason, /no tiles with visible text/);
});
