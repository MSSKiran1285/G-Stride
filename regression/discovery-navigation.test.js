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

test('unknown archetype with no AI resolver configured needsFallback, never guesses', async () => {
  const decision = await decideNextAction(
    [{ controlId: '__view1--randomThing', controlType: 'sap.m.Text', category: 'informational' }],
    { anything: 'value' },
    { modulesRunOnThisScreen: [] },
    APP_ID,
  );
  assert.equal(decision.kind, 'needsFallback');
  assert.match(decision.reason, /needs an AI resolver/i);
});

// Modeled on the real "Process Purchase Requisitions" screen reached live on 4 Aug 2026 — a
// Fiori Elements screen whose control ids carry a different template namespace than the
// classic sap.suite.ui.generic.template.* markers decideListReportAction targets (confirmed
// live: only 1 of 1260 captured controls even contained "ListReport" in its id), so it
// correctly falls through every fixed archetype to 'unknown'. Field/button/table labels here
// are the real, observed ones from that screen.
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

test('Unrecognized screen: needsFallback with no AI resolver, even with real fields/buttons/tables present', async () => {
  const decision = await decideNextAction(unknownScreenControls, { prNumber: '1000123' }, { modulesRunOnThisScreen: [] }, 'createPurchaseRequisition');
  assert.equal(decision.kind, 'needsFallback');
  assert.match(decision.reason, /needs an AI resolver/i);
});

test('Unrecognized screen: needsFallback (without calling the model) when nothing fillable/clickable/selectable was captured', async () => {
  const resolver = fakeResolver('NONE');
  const decision = await decideNextAction(
    [{ controlId: '__text1', controlType: 'sap.m.Text', text: 'Some heading', category: 'informational' }],
    {},
    { modulesRunOnThisScreen: [] },
    'createPurchaseRequisition',
    resolver
  );
  assert.equal(decision.kind, 'needsFallback');
  assert.equal(resolver.calls.length, 0, 'expected no model call when there is nothing to act on at all');
});

test('Unrecognized screen: fills the field the model matches to a reference-data key', async () => {
  const resolver = fakeResolver('FILL 1 prNumber');
  const decision = await decideNextAction(unknownScreenControls, { prNumber: '1000123' }, { modulesRunOnThisScreen: [] }, 'createPurchaseRequisition', resolver);
  assert.equal(decision.kind, 'action');
  assert.equal(decision.call.module, 'EnterHeaderField');
  assert.equal(decision.call.params.field, '__field1');
  assert.equal(decision.call.params.value, '1000123');
  assert.equal(decision.historyKey, 'fill:__field1');
  assert.match(resolver.calls[0], /Purchase Requisition Number/);
  assert.match(resolver.calls[0], /prNumber: 1000123/);
});

test('Unrecognized screen: clicks the button the model picks', async () => {
  const resolver = fakeResolver('CLICK 1');
  const decision = await decideNextAction(unknownScreenControls, {}, { modulesRunOnThisScreen: [] }, 'createPurchaseRequisition', resolver);
  assert.equal(decision.kind, 'action');
  assert.equal(decision.call.module, 'ClickButton');
  assert.equal(decision.call.params.control, '__btnGo');
  assert.equal(decision.historyKey, 'click:__btnGo');
});

test('Unrecognized screen: selects the first row via the table the model picks', async () => {
  const resolver = fakeResolver('SELECT 1');
  const decision = await decideNextAction(unknownScreenControls, {}, { modulesRunOnThisScreen: [] }, 'createPurchaseRequisition', resolver);
  assert.equal(decision.kind, 'action');
  assert.equal(decision.call.module, 'SelectTableRow');
  assert.equal(decision.call.params.field, '__col1');
  assert.equal(decision.call.params.rowIndex, '0');
  assert.equal(decision.historyKey, 'select:__col1');
});

test('Unrecognized screen: needsFallback when the model replies NONE', async () => {
  const resolver = fakeResolver('NONE');
  const decision = await decideNextAction(unknownScreenControls, {}, { modulesRunOnThisScreen: [] }, 'createPurchaseRequisition', resolver);
  assert.equal(decision.kind, 'needsFallback');
});

test('Unrecognized screen: needsFallback on a reply that is not one of the four accepted shapes', async () => {
  const resolver = fakeResolver('Sure, fill the first field with the requisition number');
  const decision = await decideNextAction(unknownScreenControls, { prNumber: '1000123' }, { modulesRunOnThisScreen: [] }, 'createPurchaseRequisition', resolver);
  assert.equal(decision.kind, 'needsFallback');
});

test('Unrecognized screen: needsFallback on an out-of-range field number', async () => {
  const resolver = fakeResolver('FILL 99 prNumber');
  const decision = await decideNextAction(unknownScreenControls, { prNumber: '1000123' }, { modulesRunOnThisScreen: [] }, 'createPurchaseRequisition', resolver);
  assert.equal(decision.kind, 'needsFallback');
});

test('Unrecognized screen: needsFallback when the model names a reference-data key that does not exist', async () => {
  const resolver = fakeResolver('FILL 1 madeUpKey');
  const decision = await decideNextAction(unknownScreenControls, { prNumber: '1000123' }, { modulesRunOnThisScreen: [] }, 'createPurchaseRequisition', resolver);
  assert.equal(decision.kind, 'needsFallback');
});

test('Unrecognized screen: needsFallback when the chosen field was already filled once on this screen', async () => {
  const resolver = fakeResolver('FILL 1 prNumber');
  const decision = await decideNextAction(
    unknownScreenControls,
    { prNumber: '1000123' },
    { modulesRunOnThisScreen: ['fill:__field1'] },
    'createPurchaseRequisition',
    resolver
  );
  assert.equal(decision.kind, 'needsFallback');
  assert.match(decision.reason, /already filled/);
});

test('Unrecognized screen: needsFallback when the chosen button was already clicked once without navigating away', async () => {
  const resolver = fakeResolver('CLICK 1');
  const decision = await decideNextAction(
    unknownScreenControls,
    {},
    { modulesRunOnThisScreen: ['click:__btnGo'] },
    'createPurchaseRequisition',
    resolver
  );
  assert.equal(decision.kind, 'needsFallback');
  assert.match(decision.reason, /already clicked/);
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

// The exact real screen this rule failed on live: asked to match "Create Purchase
// Requisition", the model initially refused every tile because none said "Create" — the
// correct tile ("Process Purchase Requisitions") uses a different generic verb for the same
// business object. Locks in the prompt guidance added after that live finding.
const realProcurementLaunchpadControls = [
  { controlId: '__tile20', controlType: 'sap.m.GenericTile', text: 'Process Purchase Requisitions', category: 'actionable' },
  { controlId: '__tile21', controlType: 'sap.m.GenericTile', text: 'Manage Purchase Orders', category: 'actionable' },
  { controlId: '__tile22', controlType: 'sap.m.GenericTile', text: 'Post Goods Receipt for Purchasing Document', category: 'actionable' },
  { controlId: '__tile23', controlType: 'sap.m.GenericTile', text: 'Create Supplier Invoice', category: 'actionable' },
  { controlId: '__tile24', controlType: 'sap.m.GenericTile', text: 'Supplier Invoices List', category: 'actionable' },
  { controlId: '__tile25', controlType: 'sap.m.GenericTile', text: 'Monitor Purchase Requisition Items', category: 'actionable' },
];

test('Launchpad shell: the tile-selection prompt tells the model tiles use generic verbs, not literal wording', async () => {
  const resolver = fakeResolver('1');
  await decideNextAction(realProcurementLaunchpadControls, {}, { modulesRunOnThisScreen: [] }, 'createPurchaseRequisition', resolver);
  assert.match(resolver.calls[0], /Process Purchase Requisitions.*Manage Purchase Requisitions/);
  assert.match(resolver.calls[0], /business object/i);
  assert.match(resolver.calls[0], /do not pick.*Monitor Purchase Requisition Items/i);
});

test('Launchpad shell: matches "Process Purchase Requisitions" for a Create Purchase Requisition request once the model picks it', async () => {
  const resolver = fakeResolver('1');
  const decision = await decideNextAction(realProcurementLaunchpadControls, {}, { modulesRunOnThisScreen: [] }, 'createPurchaseRequisition', resolver);
  assert.equal(decision.kind, 'action');
  assert.equal(decision.call.params.control, '__tile20');
});

// The exact real "My Home" landing screen this rule failed on next: broad department/category
// tiles, not specific app tiles, so nothing literally or even loosely names the target
// process — the model needs to be told picking "Procurement" to drill into is itself the
// correct move, not a failure to find a match.
const realHomeCategoryLaunchpadControls = [
  { controlId: '__tile30', controlType: 'sap.f.Card', text: 'Finance', category: 'actionable' },
  { controlId: '__tile31', controlType: 'sap.f.Card', text: 'Manufacturing and Supply Chain', category: 'actionable' },
  { controlId: '__tile32', controlType: 'sap.f.Card', text: 'Procurement', category: 'actionable' },
  { controlId: '__tile33', controlType: 'sap.f.Card', text: 'Project Management', category: 'actionable' },
  { controlId: '__tile34', controlType: 'sap.f.Card', text: 'Sales', category: 'actionable' },
  { controlId: '__tile35', controlType: 'sap.f.Card', text: 'Other', category: 'actionable' },
];

test('Launchpad shell: the tile-selection prompt tells the model a category tile is a valid pick when no specific app tile exists', async () => {
  const resolver = fakeResolver('3');
  await decideNextAction(realHomeCategoryLaunchpadControls, {}, { modulesRunOnThisScreen: [] }, 'createPurchaseRequisition', resolver);
  assert.match(resolver.calls[0], /department\/category tiles/i);
  assert.match(resolver.calls[0], /"Procurement" for anything about purchase requisitions/i);
});

test('Launchpad shell: picks the "Procurement" category tile to drill into for a Create Purchase Requisition request', async () => {
  const resolver = fakeResolver('3');
  const decision = await decideNextAction(realHomeCategoryLaunchpadControls, {}, { modulesRunOnThisScreen: [] }, 'createPurchaseRequisition', resolver);
  assert.equal(decision.kind, 'action');
  assert.equal(decision.call.params.control, '__tile32');
});

// The exact real third finding: after drilling into Procurement, the loop stopped on its own
// safety check ("already clicked the matching tile once without navigating away") because the
// model picked "Procurement" again instead of the now-visible specific tile "Process Purchase
// Requisitions" — a persistent quick-nav "Procurement" tile and the tab's own specific app
// tiles were both present in the same capture, and the prompt had no priority order between
// them. Locks in the fix: a specific app tile must outrank a category tile when both appear.
const bothCategoryAndSpecificTileControls = [
  { controlId: '__tile32', controlType: 'sap.f.Card', text: 'Procurement', category: 'actionable' },
  { controlId: '__tile40', controlType: 'sap.m.GenericTile', text: 'Process Purchase Requisitions', category: 'actionable' },
  { controlId: '__tile41', controlType: 'sap.m.GenericTile', text: 'Manage Purchase Orders', category: 'actionable' },
];

test('Launchpad shell: the tile-selection prompt says a specific app tile always outranks a category tile', async () => {
  const resolver = fakeResolver('2');
  await decideNextAction(bothCategoryAndSpecificTileControls, {}, { modulesRunOnThisScreen: [] }, 'createPurchaseRequisition', resolver);
  assert.match(resolver.calls[0], /a specific app tile always outranks a broader department\/category tile/i);
});

test('Launchpad shell: prefers the specific "Process Purchase Requisitions" tile over the "Procurement" category tile when both are present', async () => {
  const resolver = fakeResolver('2');
  const decision = await decideNextAction(bothCategoryAndSpecificTileControls, {}, { modulesRunOnThisScreen: [] }, 'createPurchaseRequisition', resolver);
  assert.equal(decision.kind, 'action');
  assert.equal(decision.call.params.control, '__tile40');
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
