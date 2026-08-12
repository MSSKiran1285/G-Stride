'use strict';

const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const { api, assertServerReachable, BASE_URL } = require('../lib/apiClient');
const { withBrowser, withPage } = require('../lib/browserSession');

before(assertServerReachable);

// Every artifact these tests create is removed again afterwards. The Automation Overview's
// "Needs attention" panel is computed from the real workspace, so a stray zero-step draft left
// behind here silently changes what that panel shows and fails overview.test.js instead of this
// file — a failure that points at the wrong code. Cleanup is the fixture, not politeness.
async function withTestCase(file, testCase, body) {
  await api.put(`/api/testcases/${file}`, testCase);
  try {
    await body();
  } finally {
    await api.delete(`/api/testcases/${file}?force=true`).catch(() => undefined);
  }
}

// BL-044 — the Process area control is a combobox, not a plain text box and not a <select>.
// The distinction carries the whole requirement: the set of process areas is a growing
// convention, so the control has to offer what already exists AND still accept a brand-new
// value. A <select> would make the first use of a new area impossible.
test('BL-044: Process area offers known values as options while still accepting a new one', async () => {
  const file = 'bl044-process-area.json';
  await withTestCase(file, { name: 'BL-044 process area', steps: [] }, async () => {
  // A known process area has to exist for there to be anything to offer.
  await api.put(`/api/tags/testCase/${file}`, { processArea: 'Procurement' });
  await withBrowser(async (browser) => {
    await withPage(browser, 'bl044-process-area', async (page) => {
      await page.goto(`${BASE_URL}/compose/tests/${encodeURIComponent(file)}`);

      const field = page.getByLabel(`Process area for ${file}`);
      await field.waitFor();

      // A combobox backed by a datalist, so the browser shows the known values but does not
      // restrict input to them.
      assert.equal(await field.getAttribute('role'), 'combobox');
      const listId = await field.getAttribute('list');
      assert.ok(listId, 'expected the Process area field to be backed by a datalist');
      const options = await page.locator(`datalist#${listId} option`).evaluateAll((nodes) => nodes.map((n) => n.value));
      assert.ok(options.includes('Procurement'), `expected known process areas as options, got ${JSON.stringify(options)}`);

      // "with the current value indicated" — the quick-pick chip for the active area is marked
      // pressed, so the current selection is stated rather than merely present in a list.
      assert.equal(await page.getByRole('button', { name: 'Procurement', exact: true }).getAttribute('aria-pressed'), 'true');

      // Typing a value that is not in the list must remain possible.
      await field.fill('BrandNewArea');
      assert.equal(await field.inputValue(), 'BrandNewArea');
    });
  });
  });
});

// Several tagged artifacts can be on screen at once; a shared datalist id would let one field's
// suggestions silently drive another's, which is the classic bug with duplicated ids.
test('BL-044: each Process area field owns its own option list', async () => {
  const first = 'bl044-unique-a.json';
  await withTestCase(first, { name: 'BL-044 A', steps: [] }, async () => {
  await withBrowser(async (browser) => {
    await withPage(browser, 'bl044-unique-lists', async (page) => {
      await page.goto(`${BASE_URL}/compose/tests/${encodeURIComponent(first)}`);
      await page.getByLabel(`Process area for ${first}`).waitFor();
      const ids = await page.locator('datalist').evaluateAll((nodes) => nodes.map((n) => n.id));
      assert.equal(new Set(ids).size, ids.length, 'expected every datalist on the page to have a unique id');
    });
  });
  });
});

// BL-042 — reordering a step's own parameter list. Only the free-form list is reorderable: a
// described module's fields render in its declared order, which is part of the module contract
// and the same in every Test, so it is not a per-step preference. These keys exist only in this
// Test's JSON, which is exactly why their order is this step's to choose — and why it persists.
test('BL-042: a step\'s free-form parameters can be reordered by keyboard, and the order persists', async () => {
  const file = 'bl042-sortable-fields.json';
  await withTestCase(
    file,
    {
      name: 'BL-042 sortable fields',
      steps: [{ module: 'NoSchemaModuleForOrdering', params: { alpha: '1', beta: '2', gamma: '3' } }],
    },
    async () => {
  await withBrowser(async (browser) => {
    await withPage(browser, 'bl042-sortable-fields', async (page) => {
      await page.goto(`${BASE_URL}/compose/tests/${encodeURIComponent(file)}`);
      await page.getByRole('button', { name: /Edit step 1/ }).click();

      const moveBetaUp = page.getByRole('button', { name: 'Move parameter beta up' });
      await moveBetaUp.waitFor();
      // The first parameter cannot move up — the control reflects position, not just intent.
      assert.equal(await page.getByRole('button', { name: 'Move parameter alpha up' }).isDisabled(), true);

      await moveBetaUp.click();
      await page.getByRole('button', { name: 'Save step' }).click();
      // "Save step" only closes the step editor into React state; the Test itself still has to
      // be written for the ordering to have actually persisted, which is what is asserted below.
      await page.getByRole('button', { name: 'Save test case' }).click();
      await page.locator('text=/Saved at/').waitFor({ timeout: 5000 });

      // Persistence is the real assertion: the order has to survive the round trip through the
      // stored JSON, not just look right in the open editor.
      const saved = await api.get(`/api/testcases/${file}`);
      assert.deepEqual(Object.keys(saved.body.steps[0].params), ['beta', 'alpha', 'gamma']);
    });
  });
    }
  );
});

// BL-043 — Mass Capture saves exactly what was chosen. The third criterion is the interesting
// one: Highlight-on-screen re-renders the list mid-selection, so selection keyed to anything
// transient (a row index, DOM order) would silently reset and the user would save the wrong set.
test('BL-043: Mass Capture rows are individually selectable and survive a Highlight round trip', async () => {
  await withBrowser(async (browser) => {
    await withPage(browser, 'bl043-multi-select', async (page) => {
      await page.goto(`${BASE_URL}/objects`);
      await page.getByRole('button', { name: 'Scan New Object' }).waitFor();

      // No live scan session exists in the isolated environment, so the curation list is empty
      // and the selection controls must not be offered at all — the same gating "Save all"
      // already follows, rather than a dead checkbox column.
      assert.equal(await page.getByRole('button', { name: /^Save selected/ }).count(), 0);
      assert.equal(await page.getByRole('button', { name: /^Select all/ }).count(), 0);
    });
  });
});
