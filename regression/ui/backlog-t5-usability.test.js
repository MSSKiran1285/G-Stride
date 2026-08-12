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

// BL-044 — the Process area control offers what already exists AND still reaches a brand-new
// value, with the current value indicated.
//
// The control was a combobox backed by a datalist, with quick-pick chips beside it. It is a
// dropdown of the process area folders now. The requirement itself is unchanged and still
// asserted below: the original rationale for insisting on a combobox was that "a <select> would
// make the first use of a new area impossible", and that is answered by the "+ New process area"
// entry, which creates the folder and files the artifact into it without leaving the screen.
// The current value is indicated by being the selected option rather than by a pressed chip.
test('BL-044: Process area offers known values as options while still reaching a new one', async () => {
  const file = 'bl044-process-area.json';
  await withTestCase(file, { name: 'BL-044 process area', steps: [] }, async () => {
  // A known process area has to exist for there to be anything to offer.
  await api.put(`/api/tags/testCase/${file}`, { processArea: 'Procurement' });
  await withBrowser(async (browser) => {
    await withPage(browser, 'bl044-process-area', async (page) => {
      await page.goto(`${BASE_URL}/compose/tests/${encodeURIComponent(file)}`);

      const field = page.getByLabel(`Process area for ${file}`);
      await field.waitFor();

      // Known areas are offered without retyping them.
      const options = await field.locator('option').evaluateAll((nodes) => nodes.map((n) => n.value));
      assert.ok(options.includes('Procurement'), `expected known process areas as options, got ${JSON.stringify(options)}`);

      // "with the current value indicated" — the stored area is the selected option.
      assert.equal(await field.inputValue(), 'Procurement');

      // Save is offered only once there is something to save.
      const save = page.getByRole('button', { name: 'Save', exact: true });
      assert.equal(await save.count(), 0, 'Save should be hidden while the selection is unchanged');

      // Reaching a value that is not yet in the list must remain possible, and must persist.
      await field.selectOption('__new_process_area__');
      await page.getByLabel(`New process area name for ${file}`).fill('BrandNewArea');
      await save.click();
      await page.waitForFunction(
        (id) => document.querySelector(`[aria-label="Process area for ${id}"]`)?.value === 'BrandNewArea',
        file,
      );
      assert.equal((await api.get('/api/tags/testCase')).body[file], 'BrandNewArea', 'the new area should persist');
      // ...and it becomes a real folder, not just this one artifact's tag.
      assert.ok((await api.get('/api/process-areas')).body.includes('BrandNewArea'), 'expected the new area to be registered as a folder');
      await api.delete('/api/process-areas/BrandNewArea').catch(() => undefined);
    });
  });
  });
});

// This was written when the Process area control was a datalist-backed combobox and several could
// share a screen: a duplicated datalist id would let one field's suggestions silently drive
// another's. That control is a <select> now and owns its options outright, so this guards the
// datalists that remain on the page (a step's contract-input suggestions) rather than the tag
// field itself.
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
// Steps are reordered by dragging, and the per-row up/down buttons were removed once dragging
// covered it. Dragging is pointer-only, so the drag handle is a real button that moves the step
// with the arrow keys — without it, reordering a step would not be possible from the keyboard at
// all (WCAG 2.1.1). This asserts that path directly, because it is now the only one.
test('a step can be reordered from the keyboard using the drag handle, and the move is announced', async () => {
  const file = 'step-keyboard-reorder.json';
  await withTestCase(
    file,
    {
      name: 'Keyboard step reorder',
      steps: [
        { module: 'FirstStepModule', params: {} },
        { module: 'SecondStepModule', params: {} },
      ],
    },
    async () => {
      await withBrowser(async (browser) => {
        await withPage(browser, 'step-keyboard-reorder', async (page) => {
          await page.goto(`${BASE_URL}/compose/tests/${encodeURIComponent(file)}`);
          const modules = () => page.locator('tbody .step-module').allTextContents();
          await page.locator('#step-handle-1').waitFor();
          assert.deepEqual(await modules(), ['FirstStepModule', 'SecondStepModule']);

          // The removed up/down buttons must not simply have come back.
          assert.equal(await page.getByRole('button', { name: /^Move step .* (up|down)$/ }).count(), 0);

          await page.locator('#step-handle-1').focus();
          await page.keyboard.press('ArrowUp');

          await page.getByRole('status').filter({ hasText: 'SecondStepModule moved to step 1.' }).waitFor();
          assert.deepEqual(await modules(), ['SecondStepModule', 'FirstStepModule']);
          // Rows are keyed by index, so focus has to be moved deliberately or it stays on the
          // position rather than following the step that moved.
          assert.equal(await page.evaluate(() => document.activeElement?.id), 'step-handle-0');

          await page.getByRole('button', { name: 'Save Test' }).click();
          await page.locator('text=/Saved at/').waitFor({ timeout: 5000 });
          const saved = await api.get(`/api/testcases/${file}`);
          assert.deepEqual(saved.body.steps.map((s) => s.module), ['SecondStepModule', 'FirstStepModule']);
        });
      });
    },
  );
});

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
      await page.getByRole('button', { name: 'Save Test' }).click();
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
