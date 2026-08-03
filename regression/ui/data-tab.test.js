'use strict';

const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const { assertServerReachable, BASE_URL } = require('../lib/apiClient');
const { withBrowser, withPage } = require('../lib/browserSession');

before(assertServerReachable);

test('Data: create a dataset, add a row, save, reload, reopen (required Data positive)', async () => {
  await withBrowser(async (browser) => {
    await withPage(browser, 'data-create-save-reopen', async (page) => {
      await page.goto(BASE_URL);
      await page.getByRole('button', { name: /Test Data/ }).first().click();

      await page.locator('input[placeholder="my-new-dataset"]').fill('regression-sample');
      await page.locator('input[placeholder*="columns, e.g."]').fill('col1,col2');
      await page.getByRole('button', { name: 'Create' }).click();

      // Scoped to the dataset's own table region (BL-025 added a Test Data Library results
      // table above it, which also renders "tbody tr" — an unscoped locator would match that
      // table's empty-state row instead, which has no input at all).
      const datasetRegion = page.getByRole('region', { name: 'regression-sample.csv dataset' });
      await page.getByRole('button', { name: '+ Add row' }).click();
      const firstRow = datasetRegion.locator('tbody tr').first().locator('input');
      await firstRow.nth(0).fill('a');
      await firstRow.nth(1).fill('b');
      await page.getByRole('button', { name: 'Save dataset' }).click();

      await page.locator('text=/Saved at/').waitFor({ timeout: 5000 });
      assert.equal(new URL(page.url()).pathname, '/data/regression-sample.csv');

      await page.reload();
      const reopenedRow = page.getByRole('region', { name: 'regression-sample.csv dataset' }).locator('tbody tr').first().locator('input');
      await reopenedRow.first().waitFor({ timeout: 5000 });
      assert.equal(await reopenedRow.nth(0).inputValue(), 'a');
      assert.equal(await reopenedRow.nth(1).inputValue(), 'b');
    });
  });
});

test('Data: author and preview nested JSON transactions before save', async () => {
  await withBrowser(async (browser) => {
    await withPage(browser, 'data-nested-json-authoring', async (page) => {
      await page.goto(BASE_URL);
      await page.getByRole('button', { name: /Test Data/ }).first().click();

      await page.getByLabel('New dataset format').selectOption('json');
      await page.getByLabel('New dataset file name').fill('nested-orders');
      await page.getByRole('button', { name: 'Create' }).click();
      await page.getByLabel('Nested transaction JSON').fill(JSON.stringify([
        { scenarioKey: 'A', items: [{ material: 'M1' }, { material: 'M2' }] },
        { scenarioKey: 'B', items: [{ material: 'M3' }] },
      ], null, 2));
      await page.getByRole('button', { name: 'Validate and preview' }).click();
      const summary = page.locator('.data-preview-summary');
      await summary.getByText('2 transactions', { exact: true }).waitFor();
      await summary.getByText('3 child records', { exact: true }).waitFor();
      await page.getByRole('button', { name: 'Save dataset' }).click();
      await page.locator('text=/Saved at/').waitFor();
      assert.equal(new URL(page.url()).pathname, '/data/nested-orders.json');

      await page.reload();
      const value = await page.getByLabel('Nested transaction JSON').inputValue();
      assert.match(value, /"scenarioKey": "A"/);
      assert.match(value, /"material": "M3"/);
    });
  });
});

test('Data: relate header and child CSVs, preview counts, and persist the relationship', async () => {
  await withBrowser(async (browser) => {
    await withPage(browser, 'data-relational-authoring', async (page) => {
      const headers = { 'Content-Type': 'application/json' };
      await page.request.put(`${BASE_URL}/api/data/ui-orders.csv`, {
        headers,
        data: {
          format: 'csv',
          headers: ['scenarioKey', 'customer'],
          rows: [
            { scenarioKey: 'A', customer: 'C1' },
            { scenarioKey: 'B', customer: 'C2' },
          ],
        },
      });
      await page.request.put(`${BASE_URL}/api/data/ui-items.csv`, {
        headers,
        data: {
          format: 'csv',
          headers: ['scenarioKey', 'material'],
          rows: [
            { scenarioKey: 'A', material: 'M1' },
            { scenarioKey: 'A', material: 'M2' },
            { scenarioKey: 'B', material: 'M3' },
          ],
        },
      });

      await page.goto(BASE_URL);
      await page.getByRole('button', { name: /Test Data/ }).first().click();
      await page.getByLabel('Relationship name').fill('ui-orders-with-items');
      await page.getByLabel('Header CSV').selectOption('ui-orders.csv');
      await page.getByLabel('Header key').fill('scenarioKey');
      await page.getByLabel('Child CSV').selectOption('ui-items.csv');
      await page.getByLabel('Child foreign key').fill('scenarioKey');
      await page.getByLabel('Child collection name').fill('items');
      await page.getByRole('button', { name: 'Validate relationship' }).click();
      const summary = page.locator('.data-preview-summary');
      await summary.getByText('2 transactions', { exact: true }).waitFor();
      await summary.getByText('3 child records', { exact: true }).waitFor();
      await page.getByRole('button', { name: 'Save relationship' }).click();
      await page.waitForFunction(() => {
        const select = document.querySelector('#saved-relation');
        return select instanceof HTMLSelectElement
          && [...select.options].some((option) => option.value === 'ui-orders-with-items.json');
      });
      assert.equal(await page.getByLabel('Open relationship').inputValue(), 'ui-orders-with-items.json');
    });
  });
});

test('Dataset Library search actually filters by file name and does not silently look like a load failure (HC-023)', async () => {
  await withBrowser(async (browser) => {
    await withPage(browser, 'data-library-search', async (page) => {
      await page.goto(`${BASE_URL}/data`);
      await page.getByRole('heading', { name: 'Dataset Library' }).waitFor();

      // Baseline: the library must actually load real rows before search is exercised. Before
      // the async listDataLibrary() fetch resolves, libraryItems starts as [] and genuinely
      // renders "0 of 0 datasets" for one frame — a plain /^\d+ of \d+ datasets$/ wait can
      // match that transient state just as validly as the real one and read it right back with
      // .textContent() before the re-render lands, especially under load (a real race caught
      // here, not the fixture data): waiting specifically for a non-zero denominator only
      // matches once the real fetch has actually settled.
      await page.getByText(/^\d+ of [1-9]\d* datasets$/).waitFor();
      const baseline = await page.getByText(/^\d+ of [1-9]\d* datasets$/).textContent();
      const totalBefore = Number(baseline.match(/^\d+ of (\d+) datasets$/)[1]);
      assert.ok(totalBefore > 0, `expected the Dataset Library to load at least one real dataset, got "${baseline}"`);

      const search = page.getByLabel('Search', { exact: true });
      await search.fill('synthetic');
      await page.locator('tbody tr', { hasText: 'synthetic.csv' }).waitFor();
      await page.locator('tbody tr', { hasText: 'p2p-e2e.csv' }).waitFor({ state: 'detached' });

      await search.fill('this-file-does-not-exist');
      await page.getByText('No datasets match the current filters.').waitFor();
      // Distinguish "found nothing" from "loaded nothing": the denominator must still reflect
      // every real dataset, not have collapsed to 0 the way a failed load would.
      const afterMiss = await page.getByText(/^0 of \d+ datasets$/).textContent();
      assert.notEqual(afterMiss, '0 of 0 datasets', 'a no-match search must not look identical to a failed load');
    });
  });
});
