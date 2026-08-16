'use strict';

/**
 * Compose authoring re-timing harness.
 *
 * Purpose: put a defensible number on "how long does it take to author a Test in Compose"
 * AFTER the six authoring fixes, so the ground-up-redesign decision is made against a
 * measurement rather than a memory. The subject is the real 16-step Sales Order build
 * (`testcases/create-so.json`) — the same shape of work that was timed at close to an hour
 * for four steps and rated 1/10.
 *
 * It runs against an ISOLATED Studio server on a temp workspace seeded to look like the
 * real one (the 12 captured createSalesOrder controls, the real o2c-e2e.csv columns), so
 * the object pickers and dataset suggestions have the same material to offer that they do
 * in production. The user's own testcases/ and object repository are never touched.
 *
 * What it reports, and why three numbers rather than one:
 *
 *   1. MACHINE WALL-CLOCK — Playwright driving the UI with zero thinking time. This is the
 *      irreducible mechanical floor: the cost of the widgets themselves. It is NOT a human
 *      authoring time and must never be quoted as one.
 *   2. KLM ESTIMATE — the same interaction trace costed with the Keystroke-Level Model
 *      (Card, Moran & Newell), the standard HCI operators: P=1.10s point, B=0.10s press,
 *      K=0.28s keystroke, H=0.40s hand homing, M=1.35s mental preparation. M is charged only
 *      where the author genuinely has to decide or recall something. This is the modelled
 *      human time for an author who already knows exactly what they want to build.
 *   3. KNOWLEDGE DEMANDS — every value the author must supply, split into RECALL (they must
 *      know it from outside the screen) and RECOGNISE (the UI offers it). This is the axis
 *      the six fixes actually moved, and the one that explains the original hour: recall is
 *      where an author stops, alt-tabs, and hunts.
 *
 * Usage:
 *   node regression/compose-authoring-timing.js            # headless
 *   REGRESSION_HEADED=1 node regression/compose-authoring-timing.js
 *
 * Writes a machine-readable trace to regression/results/compose-timing/<timestamp>.json
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { fork } = require('node:child_process');
const { chromium } = require('playwright');

const REPO_ROOT = path.resolve(__dirname, '..');
const RESULTS_DIR = path.join(__dirname, 'results', 'compose-timing');

/**
 * scratch   — every step authored from "+ Add step", the cost for an author who does not
 *             know the DUPLICATE shortcut. The conservative number.
 * duplicate — the consecutive EnterHeaderField run (steps 5-7) is cloned from step 4
 *             instead. The best case an experienced author can reach in this Test.
 */
const VARIANT = process.argv.includes('--duplicate') ? 'duplicate' : 'scratch';

/** Which Test to author: the 16-step Sales Order build, or the 7-step Purchase Order one. */
const BUILD = process.argv.includes('--po') ? 'po' : 'so';
/** Everything the report needs to describe whichever build is being timed. */
const REFERENCE_FILE = BUILD === 'po' ? 'create-po.json' : 'create-so.json';
const REFERENCE_LABEL = BUILD === 'po' ? '7-step Purchase Order build' : '16-step Sales Order build';
const STEP_COUNT = BUILD === 'po' ? 7 : 16;

// ---------------------------------------------------------------------------
// KLM operators (seconds). Card, Moran & Newell 1983.
// ---------------------------------------------------------------------------
const KLM = {
  P: 1.10, // point to a target with the mouse
  B: 0.10, // press or release a mouse button
  K: 0.28, // one keystroke, average skilled typist (~55wpm)
  H: 0.40, // home hands between keyboard and mouse
  M: 1.35, // mental preparation for a decision or recall
};

// ---------------------------------------------------------------------------
// The workspace the isolated server is seeded with — a faithful copy of the parts
// of the real workspace that Compose actually reads while authoring this Test.
// ---------------------------------------------------------------------------
const SALES_ORDER_OBJECTS = [
  ['salesOrderTypeField', 'APD_::SalesOrderType', 'sap.ui.mdc.Field', null, 'Sales Order Type'],
  ['SalesOrganizationField', 'APD_::SalesOrganization', 'sap.ui.mdc.Field', null, 'Sales Organization'],
  ['distributionChannelField', 'APD_::DistributionChannel', 'sap.ui.mdc.Field', null, 'Distribution Channel'],
  ['divisionField', 'APD_::OrganizationDivision', 'sap.ui.mdc.Field', null, 'Division'],
  ['continueButton', 'fe::APD_::CreateWithSalesOrderType::Action::Ok', 'sap.m.Button', null, 'Continue'],
  ['soldToPartyField', 'SalesOrderManageObjectPage--SoldToParty::Field-edit', 'sap.ui.mdc.Field', null, 'Sold-to Party'],
  ['createButton', 'SalesOrderManageObjectPage--FooterBar::StandardAction::Save', 'sap.m.Button', null, 'Create'],
  ['itemsTabButton', 'SalesOrderManageObjectPage--FacetSection::SalesOrderItems-anchor', 'sap.m.IconTabFilter', null, 'Items'],
  ['lineItemProductField', 'LineItem::C::Product-innerColumn', 'sap.ui.table.Column', 'LineItem-innerTable', 'Product'],
  ['lineItemQuantityField', 'LineItem::C::RequestedQuantity-innerColumn', 'sap.ui.table.Column', 'LineItem-innerTable', 'Requested Quantity'],
  ['saveDialogButton', '__mbox-btn-0', 'sap.m.Button', null, 'Save'],
  ['AddLineItemButton', 'LineItem::CreationRow-inner-applyBtn', 'sap.m.Button', null, 'Add Row'],
];

const O2C_CSV = [
  'orderType,salesOrg,distributionChannel,division,soldToParty,product,quantity,automationReferencePrefix,automationOwner',
  'OR,1710,10,00,USCU_S14,MZ-FG-EB01,10,Q4HO2C,kiran',
  '',
].join('\n');

const NAVIGATE_URL = '${urlBase}/ui#SalesOrder-manageSalesOrderV2?preferredMode=create&/SalesOrderManage(...)?i-action=create';

const PURCHASE_ORDER_OBJECTS = [
  ['CreateButton', 'PurchaseOrder::Create', 'sap.m.Button', null, 'Create'],
  ['SupplierField', 'PurchaseOrder::Supplier', 'sap.ui.comp.smartfield.SmartField', null, 'Supplier'],
  ['AddLineItemButton', 'PurchaseOrder::Items::CreationRow-applyBtn', 'sap.m.Button', null, 'Create'],
  ['LineItemMaterialField', 'PurchaseOrder::Items::C::Material-innerColumn', 'sap.ui.table.Column', 'PO-Items-innerTable', 'Material'],
  ['LineItemPlantField', 'PurchaseOrder::Items::C::Plant-innerColumn', 'sap.ui.table.Column', 'PO-Items-innerTable', 'Plant'],
  ['LineItemQuantityField', 'PurchaseOrder::Items::C::Quantity-innerColumn', 'sap.ui.table.Column', 'PO-Items-innerTable', 'Order Quantity'],
  ['LineItemNetPriceField', 'PurchaseOrder::Items::C::NetPrice-innerColumn', 'sap.ui.table.Column', 'PO-Items-innerTable', 'Net Order Price'],
  ['SaveButton', 'PurchaseOrder::FooterBar::Order', 'sap.m.Button', null, 'Order'],
  ['PoNumberDisplay', 'PurchaseOrder::ObjectPage::Title', 'sap.m.Title', null, 'PO Number'],
];

const P2P_CSV = [
  'supplier,material,plant,quantity,netPrice,deliveredQuantity,automationReferencePrefix,automationOwner',
  'USSU-TRL07,TR-TG-Y300,1710,10,15.00,10,Q4HP2P,kiran',
  '',
].join('\n');

const PO_NAVIGATE_URL = '${urlBase}/ui#PurchaseOrder-manage';

/** Entry points the App IDs would have learned from their own capture sessions, so a timed run
 *  exercises NavigateToApp's screen picker rather than a field that has never seen a scan. */
const SEEDED_ENTRY_POINTS = [
  ['createSalesOrder', 'https://tenant.example/ui#SalesOrder-manageSalesOrderV2?preferredMode=create&/SalesOrderManage(...)?i-action=create'],
  ['createPurchaseOrder', 'https://tenant.example/ui#PurchaseOrder-manage'],
];

// ---------------------------------------------------------------------------
// Interaction recorder
// ---------------------------------------------------------------------------
class Trace {
  constructor() {
    this.events = [];
    this.stepLabel = 'setup';
    this.lastModality = null; // 'mouse' | 'keyboard'
  }

  begin(label) {
    this.stepLabel = label;
  }

  /**
   * @param kind      click | fill | select | key
   * @param target    what was acted on, for the readable trace
   * @param opts.chars     characters typed
   * @param opts.mental    true when the author must decide or recall before acting
   * @param opts.knowledge 'recall' | 'recognise' | null — how the value was obtained
   * @param opts.value     the value supplied, for the knowledge inventory
   */
  record(kind, target, ms, opts = {}) {
    const modality = kind === 'fill' || kind === 'key' ? 'keyboard' : 'mouse';
    let klm = 0;
    const ops = [];

    if (opts.mental) { klm += KLM.M; ops.push('M'); }

    if (kind === 'click') {
      if (this.lastModality === 'keyboard') { klm += KLM.H; ops.push('H'); }
      klm += KLM.P + KLM.B; ops.push('P', 'B');
    } else if (kind === 'select') {
      // native <select>: point+press to open, point+press to choose
      if (this.lastModality === 'keyboard') { klm += KLM.H; ops.push('H'); }
      klm += 2 * (KLM.P + KLM.B); ops.push('P', 'B', 'P', 'B');
    } else if (kind === 'fill') {
      if (this.lastModality === 'mouse' || this.lastModality === null) { klm += KLM.H; ops.push('H'); }
      const chars = opts.chars ?? 0;
      klm += KLM.K * chars; ops.push(`${chars}K`);
    } else if (kind === 'key') {
      klm += KLM.K; ops.push('K');
    }

    this.lastModality = modality;
    this.events.push({
      step: this.stepLabel,
      kind,
      target,
      ms,
      klm: Number(klm.toFixed(2)),
      ops: ops.join('+'),
      mental: Boolean(opts.mental),
      knowledge: opts.knowledge ?? null,
      value: opts.value ?? null,
    });
  }
}

/** Instrumented wrappers. Every author-visible act goes through one of these. */
function makeUi(page, trace) {
  async function timed(fn) {
    const t = Date.now();
    await fn();
    return Date.now() - t;
  }

  return {
    async click(locator, target, opts = {}) {
      const ms = await timed(() => locator.click());
      trace.record('click', target, ms, opts);
    },
    async fill(locator, value, target, opts = {}) {
      const ms = await timed(() => locator.fill(value));
      trace.record('fill', target, ms, { ...opts, chars: value.length, value });
    },
    async select(locator, value, target, opts = {}) {
      const ms = await timed(() => locator.selectOption(value));
      trace.record('select', target, ms, { ...opts, value });
    },
    /** GroupedPicker / ObjectPicker: open, type a filter, click the row. */
    async pick(trigger, query, option, target, opts = {}) {
      await this.click(trigger, `${target} (open)`, { mental: opts.mental });
      if (query) {
        const ms = await timed(() => query.locator.fill(query.text));
        trace.record('fill', `${target} (filter)`, ms, { chars: query.text.length, value: query.text });
      }
      const ms = await timed(() => option.click());
      trace.record('click', `${target} (choose)`, ms, { knowledge: opts.knowledge ?? 'recognise', value: opts.value });
    },
  };
}

// ---------------------------------------------------------------------------
// Workspace seeding
// ---------------------------------------------------------------------------
function seedWorkspace() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gstride-compose-timing-'));
  for (const dir of ['testcases', 'testgroups', 'testpacks', 'data', 'reports', 'audit-evidence']) {
    fs.mkdirSync(path.join(tempRoot, dir), { recursive: true });
  }
  fs.writeFileSync(path.join(tempRoot, 'data', 'o2c-e2e.csv'), O2C_CSV, 'utf8');
  fs.writeFileSync(path.join(tempRoot, 'data', 'p2p-e2e.csv'), P2P_CSV, 'utf8');

  const { ObjectRepository } = require('../packages/core/dist');
  const repo = new ObjectRepository(path.join(tempRoot, 'objects.db'));
  const seed = (appId, objects) => {
    for (const [name, controlId, controlType, tableId, label] of objects) {
      repo.upsert({
        appId,
        name,
        controlId,
        controlType,
        bindingPath: undefined,
        tableId: tableId ?? undefined,
        label,
        parentControlId: undefined,
      });
    }
  };
  seed('createSalesOrder', SALES_ORDER_OBJECTS);
  seed('createPurchaseOrder', PURCHASE_ORDER_OBJECTS);
  for (const [appId, url] of SEEDED_ENTRY_POINTS) repo.recordEntryPoint(appId, url);
  repo.close();
  return tempRoot;
}

function startServer(tempRoot) {
  const child = fork(path.join(__dirname, 'isolated-studio-server.js'), [], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      ISOLATED_STUDIO_ROOT: tempRoot,
      ISOLATED_STUDIO_WEB_DIST: path.join(REPO_ROOT, 'packages', 'studio-web', 'dist'),
      TAF_DISABLE_OS_CREDENTIAL_STORE: '1',
      TAF_CREDENTIAL_STORE_PATH: path.join(tempRoot, 'credentials.enc.json'),
      TAF_CREDENTIAL_KEY_PATH: path.join(tempRoot, 'credential-key'),
      TAF_AI_CREDENTIAL_STORE_PATH: path.join(tempRoot, 'ai-credentials.enc.json'),
      TAF_AI_CREDENTIAL_KEY_PATH: path.join(tempRoot, 'ai-credential-key'),
    },
    stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
  });
  const url = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code) => reject(new Error(`Isolated server exited before startup (${code}).`)));
    child.once('message', (m) => (m && typeof m.url === 'string' ? resolve(m.url) : reject(new Error('bad startup message'))));
  });
  return { child, url };
}

// ---------------------------------------------------------------------------
// The authoring script — the 16 steps of create-so.json, in the real UI.
// ---------------------------------------------------------------------------

/** Chooses a module in the StepEditor's GroupedPicker. Always a recall+recognise act:
 *  the author must know roughly what the module is called to filter for it. */
async function chooseModule(page, ui, moduleLabel, query) {
  await ui.pick(
    page.getByRole('button', { name: 'Module' }),
    { locator: page.getByRole('combobox', { name: /Search module/i }), text: query },
    page.getByRole('option', { name: moduleLabel, exact: true }).first(),
    `Module = ${moduleLabel}`,
    { mental: true, knowledge: 'recall', value: moduleLabel },
  );
}

/**
 * Sets a param that renders a value control plus the source chip.
 *
 * The chip already reads "literal" on an untouched param, so an author entering a literal
 * value never touches it — they type straight into the box. Charging a select for that was a
 * measurement error in the first run of this harness (9 of the 16-step build's 18 source
 * selects were literal, so the recorded floor was ~34s too high). Only a genuine change of
 * source costs an interaction.
 */
const SYSTEM_OPTION_LABEL = {
  'sap.url': 'SAP target URL — exactly as configured',
  'sap.urlBase': 'SAP target URL — no trailing slash, for building a link',
  'sap.username': 'SAP username',
  'sap.password': 'SAP password',
  'runtime.today': 'Current date',
};

async function setSourcedParam(page, ui, label, source, value, opts = {}) {
  const input = page.getByLabel(label, { exact: true }).first();

  if (source === 'literal') {
    await ui.fill(input, value, `${label} = ${value}`, { knowledge: opts.knowledge ?? 'recall' });
    return;
  }

  // One control now: open the list, narrow it, pick. Picking IS the binding — there is no
  // separate source to set first, which is the whole point of the change.
  const optionLabel = source === 'systemContext' ? SYSTEM_OPTION_LABEL[value] : value;
  await ui.click(input, `${label} (open value list)`, { mental: true });
  const filter = optionLabel.slice(0, 10);
  await ui.fill(input, filter, `${label} (filter "${filter}")`);
  await ui.click(
    page.locator('.value-picker-option', { hasText: new RegExp(escapeRegExp(optionLabel)) }).first(),
    `${label} <- ${source}.${value}`,
    { knowledge: 'recognise' },
  );
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\—]/g, '\\$&');
}

/** Picks a suggested literal (a learned App-ID screen) out of the same list. */
async function pickSuggestedLiteral(page, ui, label, value) {
  const input = page.getByLabel(label, { exact: true }).first();
  await ui.click(input, `${label} (open value list)`, { mental: true });
  await ui.click(
    page.locator('.value-picker-option', { hasText: new RegExp(escapeRegExp(value)) }).first(),
    `${label} <- ${value}`,
    { knowledge: 'recognise' },
  );
}

/** Picks from an enum param's select. One act, no source chip — the descriptor's `options`
 *  are the whole value space. */
async function setEnumParam(page, ui, label, value) {
  await ui.select(page.getByLabel(label, { exact: true }), value, `${label} = ${value}`, { mental: true });
}

/** Opens a step's collapsed "Options" disclosure to reach an `advanced` param. */
async function openOptions(page, ui) {
  await ui.click(page.locator('details.step-advanced > summary').first(), 'Options (expand)');
}

/** Sets a param that renders a single box because the descriptor marks it literalOnly. */
async function setLiteralOnlyParam(page, ui, label, value) {
  await ui.fill(page.getByLabel(label, { exact: true }), value, `${label} = ${value}`, {
    mental: true,
    knowledge: 'recall',
  });
}

/** Picks a captured control through the ObjectPicker: focus to open, type a few
 *  characters to narrow, click the row. The author recognises the name in the list
 *  rather than having to remember it exactly — that is the point of the picker.
 *
 *  NOTE: ObjectPicker labels its input with the param's PLACEHOLDER, not its label
 *  (`aria-label={placeholder || 'Object name'}`), so the accessible name and the visible
 *  field name are different strings. `ariaLabel` addresses the control; `fieldName` is
 *  what goes in the readable trace. */
async function setObjectParam(page, ui, ariaLabel, fieldName, objectName, nth = 0) {
  const input = page.getByLabel(ariaLabel, { exact: true }).nth(nth);
  await ui.click(input, `${fieldName} (open)`, { mental: true });
  const filter = objectName.slice(0, 6);
  await ui.fill(input, filter, `${fieldName} (filter "${filter}")`);
  await ui.click(
    page.locator('div.panel span[title]', { hasText: new RegExp(`^${objectName}$`) }).first(),
    `${fieldName} = ${objectName}`,
    { knowledge: 'recognise', value: objectName },
  );
}

/** Accessible names for the object-picker fields used in this build. */
const OBJECT_FIELD = {
  headerField: ['e.g. SupplierField', 'Field (object repository name)'],
  clickControl: ['e.g. CreateButton', 'Control name'],
  tableColumn: ['column object name', 'Table column object'],
};

/**
 * The 7-step Purchase Order build (`testcases/create-po.json`).
 *
 * Shorter than the Sales Order one and differently shaped: one header field instead of five, but
 * a four-column line-item grid instead of two. Useful as a second data point precisely because
 * the mix is different — if the per-step cost holds across both, it is a property of the form
 * rather than of one Test.
 */
async function authorPurchaseOrder(page, ui, trace, addStep, saveStep) {
  // 1 — CreateAutomationRunReference. maxLength is advanced and defaults to the 16 the
  // reference Test spells out, so the streamlined form correctly steers past it.
  trace.begin('01 CreateAutomationRunReference');
  await addStep();
  await chooseModule(page, ui, 'Create Automation Run Reference', 'automation');
  await setSourcedParam(page, ui, 'Reference prefix', 'dataset', 'automationReferencePrefix');
  await setSourcedParam(page, ui, 'Run owner', 'dataset', 'automationOwner');
  await saveStep();

  // 2 — Login. The system-context key is now inferred per param, so choosing the source is the
  // whole interaction; there is no second dropdown to set url/username/password individually.
  trace.begin('02 Login');
  await addStep();
  await chooseModule(page, ui, 'Login', 'login');
  for (const [label, key] of [['Tenant URL', 'sap.url'], ['Username', 'sap.username'], ['Password', 'sap.password']]) {
    await setSourcedParam(page, ui, label, 'systemContext', key);
  }
  await saveStep();

  // 3 — NavigateToApp. The App ID has a learned entry point, so this is a pick, not 40 characters.
  trace.begin('03 NavigateToApp');
  await addStep();
  await chooseModule(page, ui, 'Navigate to App', 'navigate');
  await ui.fill(page.getByLabel('App ID override'), 'createPurchaseOrder', 'App ID override', {
    mental: true,
    knowledge: 'recall',
  });
  // The App ID has a learned entry point, so this is a pick out of the value list, not 40
  // characters of launchpad URL.
  await pickSuggestedLiteral(page, ui, 'App URL', PO_NAVIGATE_URL);
  await saveStep();

  // 4 — ClickButton CreateButton
  trace.begin('04 ClickButton CreateButton');
  await addStep();
  await chooseModule(page, ui, 'Click Button', 'click');
  await setObjectParam(page, ui, ...OBJECT_FIELD.clickControl, 'CreateButton');
  await saveStep();

  // 5 — EnterHeaderField SupplierField
  trace.begin('05 EnterHeaderField SupplierField');
  await addStep();
  await chooseModule(page, ui, 'Enter Header Field', 'header');
  await setObjectParam(page, ui, ...OBJECT_FIELD.headerField, 'SupplierField');
  await setSourcedParam(page, ui, 'Value', 'dataset', 'supplier');
  await saveStep();

  // 6 — AddLineItem, four columns
  trace.begin('06 AddLineItem');
  await addStep();
  await chooseModule(page, ui, 'Add Line Item(s)', 'line item');
  const columns = [
    ['LineItemMaterialField', '${material}'],
    ['LineItemPlantField', '${plant}'],
    ['LineItemQuantityField', '${quantity}'],
    ['LineItemNetPriceField', '${netPrice}'],
  ];
  for (const [index, [object]] of columns.entries()) {
    if (index > 0) await ui.click(page.getByRole('button', { name: '+ Col' }), '+ Col');
    await setObjectParam(page, ui, ...OBJECT_FIELD.tableColumn, object, index);
  }
  for (const [index, [, value]] of columns.entries()) {
    await ui.fill(
      page.getByLabel(`Table rows, row 1, column ${index + 1}`),
      value,
      `row 1 col ${index + 1} = ${value}`,
      { knowledge: 'recall' },
    );
  }
  await saveStep();

  // 7 — SaveAndCaptureDocumentNumber
  trace.begin('07 SaveAndCaptureDocumentNumber');
  await addStep();
  await chooseModule(page, ui, 'Save & Capture Document Number', 'save');
  await setSourcedParam(page, ui, 'Placeholder title to wait past', 'literal', 'New Purchase Order');
  await setLiteralOnlyParam(page, ui, 'Capture as (runState key)', 'poNumber');
  await saveStep();
}

async function main() {
  const tempRoot = seedWorkspace();
  const { child, url: urlPromise } = startServer(tempRoot);
  const baseUrl = await urlPromise;
  const trace = new Trace();
  const headed = process.env.REGRESSION_HEADED === '1';
  const browser = await chromium.launch({ headless: !headed });
  const startedAt = Date.now();
  let savedTest = null;

  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    const pageErrors = [];
    page.on('pageerror', (e) => pageErrors.push(e.message));
    const ui = makeUi(page, trace);

    await page.goto(baseUrl);

    // ---- Create the Test -------------------------------------------------
    trace.begin('00 create Test');
    const authoringStart = Date.now();
    await ui.click(page.getByRole('button', { name: /Compose/ }).first(), 'Compose tab');
    await ui.click(page.getByRole('button', { name: 'Compose New Test' }), 'Compose New Test');
    const testName = BUILD === 'po' ? 'Create Purchase Order - Happy Path' : 'Create Sales Order - Happy Path';
    const folder = BUILD === 'po' ? 'Procure to Pay' : 'Order to Cash';
    await ui.fill(page.getByLabel('Test name'), testName, 'Test name', { mental: true, knowledge: 'recall' });
    await ui.select(page.getByLabel('Process area'), '__new_process_area__', 'Process area = new folder', { mental: true });
    await ui.fill(page.getByLabel('New folder name'), folder, 'New folder name', { knowledge: 'recall' });
    await ui.click(page.getByRole('button', { name: 'Create Folder' }), 'Create Folder');
    await ui.click(page.getByRole('button', { name: 'Create Test' }), 'Create Test');
    await page.waitForURL(`**/compose/tests/${testName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.json`);

    // ---- The steps -------------------------------------------------------
    const addStep = () => ui.click(page.getByRole('button', { name: '+ Add step' }), '+ Add step');
    const saveStep = () => ui.click(page.getByRole('button', { name: 'Save step' }), 'Save step');

    if (BUILD === 'po') {
      await authorPurchaseOrder(page, ui, trace, addStep, saveStep);
    } else {

    // 1 — CreateAutomationRunReference
    trace.begin('01 CreateAutomationRunReference');
    await addStep();
    await chooseModule(page, ui, 'Create Automation Run Reference', 'automation');
    await setSourcedParam(page, ui, 'Reference prefix', 'dataset', 'automationReferencePrefix');
    await setSourcedParam(page, ui, 'Run owner', 'dataset', 'automationOwner');
    // maxLength is `advanced` now and its default IS 16 — the value create-so.json spells out.
    // Leaving it unset is behaviourally identical, so the streamlined form correctly steers the
    // author past it. See the fidelity note in report().
    await saveStep();

    // 2 — Login
    trace.begin('02 Login');
    await addStep();
    await chooseModule(page, ui, 'Login', 'login');
    await setSourcedParam(page, ui, 'Tenant URL', 'systemContext', 'sap.url');
    await setSourcedParam(page, ui, 'Username', 'systemContext', 'sap.username');
    await setSourcedParam(page, ui, 'Password', 'systemContext', 'sap.password');
    await saveStep();

    // 3 — NavigateToApp
    trace.begin('03 NavigateToApp');
    await addStep();
    await chooseModule(page, ui, 'Navigate to App', 'navigate');
    await setSourcedParam(page, ui, 'App URL', 'literal', NAVIGATE_URL);
    await saveStep();

    // 4..7, 9 — EnterHeaderField. Step 4 is the only one that must carry the App ID:
    // every later step inherits it (executionEngine.ts `call.appId ?? options.appId`).
    const headerFields = [
      ['04', 'salesOrderTypeField', 'orderType', true],
      ['05', 'SalesOrganizationField', 'salesOrg', false],
      ['06', 'distributionChannelField', 'distributionChannel', false],
      ['07', 'divisionField', 'division', false],
    ];
    for (const [n, object, column, needsAppId] of headerFields) {
      trace.begin(`${n} EnterHeaderField ${object}`);
      const stepIndex = Number(n); // 04 is step 4, and so on

      if (VARIANT === 'duplicate' && !needsAppId) {
        // DUPLICATE clones the selected step and immediately opens the clone for editing
        // (duplicateStep: splice at index+1, then setEditingIndex(index+1)). Because it
        // inserts directly AFTER the source, it is only usable without a follow-up reorder
        // when the source is the last step — i.e. for a consecutive run of the same module,
        // which steps 4-7 are and nothing else in this Test is.
        await ui.click(
          page.getByRole('radio', { name: `Select step ${stepIndex - 1}: EnterHeaderField` }),
          `select step ${stepIndex - 1}`,
        );
        await ui.click(page.getByRole('button', { name: 'DUPLICATE' }), 'DUPLICATE');
        // Module, App ID and both value sources arrive prefilled — only the two values change.
      } else {
        await addStep();
        await chooseModule(page, ui, 'Enter Header Field', 'header');
        if (needsAppId) {
          await ui.fill(page.getByLabel('App ID override'), 'createSalesOrder', 'App ID override', {
            mental: true,
            knowledge: 'recall',
          });
        }
      }

      await setObjectParam(page, ui, ...OBJECT_FIELD.headerField, object);
      if (VARIANT === 'duplicate' && !needsAppId) {
        // Value source is already "dataset" on the clone — only the column name is retyped.
        await ui.fill(page.getByLabel('Dataset input for Value'), column, `Value <- dataset.${column}`, {
          knowledge: 'recognise',
        });
      } else {
        await setSourcedParam(page, ui, 'Value', 'dataset', column);
      }
      await saveStep();
    }

    // 8 — ClickButton continueButton
    trace.begin('08 ClickButton continueButton');
    await addStep();
    await chooseModule(page, ui, 'Click Button', 'click');
    await setObjectParam(page, ui, ...OBJECT_FIELD.clickControl, 'continueButton');
    await saveStep();

    // 9 — EnterHeaderField soldToPartyField
    trace.begin('09 EnterHeaderField soldToPartyField');
    await addStep();
    await chooseModule(page, ui, 'Enter Header Field', 'header');
    await setObjectParam(page, ui, ...OBJECT_FIELD.headerField, 'soldToPartyField');
    await setSourcedParam(page, ui, 'Value', 'dataset', 'soldToParty');
    await saveStep();

    // 10 — ClickButton itemsTabButton
    trace.begin('10 ClickButton itemsTabButton');
    await addStep();
    await chooseModule(page, ui, 'Click Button', 'click');
    await setObjectParam(page, ui, ...OBJECT_FIELD.clickControl, 'itemsTabButton');
    await saveStep();

    // 11 — AddLineItem (TableRowsEditor: two column objects, one row)
    trace.begin('11 AddLineItem');
    await addStep();
    await chooseModule(page, ui, 'Add Line Item(s)', 'line item');
    await setObjectParam(page, ui, ...OBJECT_FIELD.tableColumn, 'lineItemProductField', 0);
    await ui.click(page.getByRole('button', { name: '+ Col' }), '+ Col');
    await setObjectParam(page, ui, ...OBJECT_FIELD.tableColumn, 'lineItemQuantityField', 1);
    await ui.fill(page.getByLabel('Table rows, row 1, column 1'), '${product}', 'row 1 product', { knowledge: 'recall' });
    await ui.fill(page.getByLabel('Table rows, row 1, column 2'), '${quantity}', 'row 1 quantity', { knowledge: 'recall' });
    await setEnumParam(page, ui, 'When to click Add relative to filling the row', 'after');
    await saveStep();

    // 12 — ClickButton createButton
    trace.begin('12 ClickButton createButton');
    await addStep();
    await chooseModule(page, ui, 'Click Button', 'click');
    await setObjectParam(page, ui, ...OBJECT_FIELD.clickControl, 'createButton');
    await saveStep();

    // 13 — Wait 5000
    trace.begin('13 Wait 5000');
    await addStep();
    await chooseModule(page, ui, 'Wait', 'wait');
    await setSourcedParam(page, ui, 'Milliseconds', 'literal', '5000');
    await saveStep();

    // 14 — DismissDialogIfPresent
    trace.begin('14 DismissDialogIfPresent');
    await addStep();
    await chooseModule(page, ui, 'Dismiss Dialog If Present', 'dismiss');
    await setSourcedParam(page, ui, 'Button text', 'literal', 'Save');
    // timeoutMs is `advanced`, and 15000 is NOT its default (8000) — so this one genuinely
    // costs the author a disclosure click. That is the trade the collapse makes.
    await openOptions(page, ui);
    await setSourcedParam(page, ui, 'Timeout (ms)', 'literal', '15000');
    await saveStep();

    // 15 — Wait 3000
    trace.begin('15 Wait 3000');
    await addStep();
    await chooseModule(page, ui, 'Wait', 'wait');
    await setSourcedParam(page, ui, 'Milliseconds', 'literal', '3000');
    await saveStep();

    // 16 — CaptureDocumentNumberFromSuccessDialog
    trace.begin('16 CaptureDocumentNumberFromSuccessDialog');
    await addStep();
    await chooseModule(page, ui, 'Capture Document Number from Success Dialog', 'capture document');
    await setLiteralOnlyParam(page, ui, 'Dialog title(s) to expect, ";"-separated', 'Success;Warning');
    await setLiteralOnlyParam(page, ui, 'Capture as (runState key)', 'soNumber');
    await setSourcedParam(page, ui, 'Evidence label', 'literal', 'Sales Order Number');
    await setSourcedParam(page, ui, 'Dismiss button text', 'literal', 'Close');
    await saveStep();
    }

    // ---- Save ------------------------------------------------------------
    trace.begin(`${BUILD === 'po' ? '08' : '17'} save Test`);
    await ui.click(page.getByRole('button', { name: 'Save Test' }), 'Save Test');
    await page.locator('text=/Saved at/').waitFor({ timeout: 10000 });
    const authoringMs = Date.now() - authoringStart;

    savedTest = JSON.parse(
      fs.readFileSync(
        path.join(tempRoot, 'testcases', `${testName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.json`),
        'utf8',
      ),
    );

    await context.close();
    if (pageErrors.length) {
      console.error(`\n!! ${pageErrors.length} uncaught browser error(s) during authoring:`);
      for (const e of pageErrors) console.error(`   ${e}`);
    }
    report(trace, savedTest, authoringMs, Date.now() - startedAt);
  } finally {
    await browser.close().catch(() => undefined);
    // The server child holds open SQLite handles; on Windows the temp tree cannot be
    // removed until it has actually exited. Cleanup is best-effort and must never mask
    // the real authoring failure.
    child.kill('SIGTERM');
    await new Promise((resolve) => {
      const done = setTimeout(resolve, 3000);
      child.once('exit', () => { clearTimeout(done); resolve(); });
    });
    try {
      fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch (cleanupError) {
      console.error(`  (temp workspace left behind at ${tempRoot}: ${cleanupError.code})`);
    }
  }
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------
function report(trace, savedTest, authoringMs, totalMs) {
  const byStep = new Map();
  for (const e of trace.events) {
    const s = byStep.get(e.step) ?? { step: e.step, interactions: 0, klm: 0, ms: 0, recall: 0, recognise: 0, mental: 0 };
    s.interactions += 1;
    s.klm += e.klm;
    s.ms += e.ms;
    if (e.knowledge === 'recall') s.recall += 1;
    if (e.knowledge === 'recognise') s.recognise += 1;
    if (e.mental) s.mental += 1;
    byStep.set(e.step, s);
  }

  const totals = [...byStep.values()].reduce(
    (a, s) => ({
      interactions: a.interactions + s.interactions,
      klm: a.klm + s.klm,
      recall: a.recall + s.recall,
      recognise: a.recognise + s.recognise,
      mental: a.mental + s.mental,
    }),
    { interactions: 0, klm: 0, recall: 0, recognise: 0, mental: 0 },
  );

  const fmt = (sec) => `${Math.floor(sec / 60)}m ${String(Math.round(sec % 60)).padStart(2, '0')}s`;

  console.log('\n' + '='.repeat(78));
  console.log(`COMPOSE AUTHORING RE-TIMING — ${REFERENCE_LABEL} [variant: ${VARIANT}]`);
  console.log('='.repeat(78));
  console.log('\nPer step:\n');
  console.log('  step                                    acts    KLM   recall  recog');
  console.log('  ' + '-'.repeat(70));
  for (const s of byStep.values()) {
    console.log(
      `  ${s.step.padEnd(38).slice(0, 38)} ${String(s.interactions).padStart(4)} ${String(Math.round(s.klm)).padStart(6)}s ${String(s.recall).padStart(6)} ${String(s.recognise).padStart(6)}`,
    );
  }
  console.log('  ' + '-'.repeat(70));
  console.log(
    `  ${'TOTAL'.padEnd(38)} ${String(totals.interactions).padStart(4)} ${String(Math.round(totals.klm)).padStart(6)}s ${String(totals.recall).padStart(6)} ${String(totals.recognise).padStart(6)}`,
  );

  console.log('\nHeadline numbers');
  console.log('  ' + '-'.repeat(70));
  console.log(`  UI interactions to author ${STEP_COUNT} steps  ${totals.interactions}`);
  console.log(`  KLM modelled human time ................... ${fmt(totals.klm)}  (author who knows what to build)`);
  console.log(`  Machine wall-clock (mechanical floor) ..... ${fmt(authoringMs / 1000)}  (NOT a human time)`);
  console.log(`  Values needing RECALL ..................... ${totals.recall}`);
  console.log(`  Values offered on screen (RECOGNISE) ...... ${totals.recognise}`);
  console.log(`  Decision points (KLM M charged) ........... ${totals.mental}`);
  console.log(`  Per-step average .......................... ${(totals.interactions / STEP_COUNT).toFixed(1)} acts, ${fmt(totals.klm / STEP_COUNT)}`);

  console.log('\nBaseline');
  console.log('  ' + '-'.repeat(70));
  const perStepKlm = totals.klm / STEP_COUNT;
  console.log(`  Owner's pre-fix run ....................... ~60m for 4 steps = ~15m/step`);
  console.log(`  This run, modelled (KLM) .................. ${fmt(totals.klm)} for ${STEP_COUNT} steps = ${fmt(perStepKlm)}/step`);
  console.log('');
  console.log('  These two are NOT the same measurement and their ratio is not a speedup.');
  console.log('  The pre-fix run was a FIRST-TIME author against a UI with six known defects:');
  console.log('  it contains learning, hunting for column names the UI did not offer, and error');
  console.log('  recovery. KLM models an EXPERT who already knows what to build and makes no');
  console.log('  mistakes, so it is a floor for the mechanism, not a prediction of wall-clock.');
  console.log('  The decision this feeds: if an observed human run lands near this floor, the');
  console.log('  mechanism is fine and the redesign is not justified on speed. If it stays far');
  console.log('  above, the cost is in learning/recall and a redesign has a target to aim at.');

  // Fidelity check against the real Test.
  //
  // Params whose value equals the module's own default are dropped from BOTH sides before
  // comparing. create-so.json spells out `maxLength: "16"`, but 16 is what the module uses when
  // the param is absent, so a Test that omits it behaves identically — and the streamlined form
  // deliberately steers the author past defaulted `advanced` params. Anything NOT in this table
  // still has to match exactly, so the check cannot quietly absorb a real divergence.
  const MODULE_DEFAULTS = {
    CreateAutomationRunReference: { maxLength: '16' },
  };
  const real = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'testcases', REFERENCE_FILE), 'utf8'));
  const dropped = [];
  const norm = (t, side) => t.steps.map((s) => {
    const defaults = MODULE_DEFAULTS[s.module] ?? {};
    const params = {};
    for (const [k, v] of Object.entries(s.params ?? {})) {
      if (defaults[k] === v) { dropped.push(`${side} ${s.module}.${k}=${v}`); continue; }
      params[k] = v;
    }
    return { module: s.module, params };
  });
  const a = JSON.stringify(norm(real, 'reference'));
  const b = JSON.stringify(norm(savedTest, 'authored'));
  console.log('\nFidelity');
  console.log('  ' + '-'.repeat(70));
  console.log(`  Steps authored ............................ ${savedTest.steps.length} (target ${STEP_COUNT})`);
  console.log(`  Equivalent to ${REFERENCE_FILE} .......... ${a === b ? 'YES' : 'NO — see trace file'}`);
  if (dropped.length) {
    console.log(`  Default-valued params normalised away ..... ${dropped.join(', ')}`);
  }

  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  const out = path.join(RESULTS_DIR, `${BUILD}-${VARIANT}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(
    out,
    JSON.stringify(
      {
        recordedAt: new Date().toISOString(),
        subject: BUILD === 'po' ? 'testcases/create-po.json — 7 steps' : 'testcases/create-so.json — 16 steps',
        variant: VARIANT,
        totals: { ...totals, klm: Number(totals.klm.toFixed(1)) },
        authoringWallClockMs: authoringMs,
        harnessWallClockMs: totalMs,
        perStep: [...byStep.values()].map((s) => ({ ...s, klm: Number(s.klm.toFixed(1)) })),
        fidelity: { steps: savedTest.steps.length, matchesReference: a === b },
        events: trace.events,
        savedTest,
      },
      null,
      2,
    ) + '\n',
    'utf8',
  );
  console.log(`\n  Trace written to ${path.relative(REPO_ROOT, out)}\n`);
}

// Exported so compose-timing-stage.js can raise an identically-seeded workspace for a
// human timed run — the observed number is only comparable to the recorded floor if the
// object repository and dataset columns on screen are the same ones the harness saw.
module.exports = { seedWorkspace, startServer, SALES_ORDER_OBJECTS, O2C_CSV, NAVIGATE_URL };

if (require.main !== module) return;

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
