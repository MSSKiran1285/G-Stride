'use strict';

const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const { api, assertServerReachable, BASE_URL } = require('../lib/apiClient');
const { withBrowser, withPage } = require('../lib/browserSession');

before(assertServerReachable);

test('Test Library filters by name, process area, application and readiness', async () => {
  await api.put('/api/tags/testCase/create-po.json', { processArea: 'Procurement' });

  await withBrowser(async (browser) => {
    await withPage(browser, 'test-library-filters', async (page) => {
      await page.goto(`${BASE_URL}/compose`);
      await page.getByRole('heading', { name: 'Test Library' }).waitFor();

      await page.getByLabel('Filter by process area').selectOption('Procurement');
      await page.getByLabel('Filter by application').selectOption('SAP');
      await page.getByLabel('Filter by status').selectOption('ready');
      await page.getByLabel('Search').fill('purchase order');

      const results = page.getByRole('region', { name: 'Test Library results' });
      const createPoRow = results.locator('tr', { hasText: 'create-po.json' });
      await createPoRow.waitFor();
      assert.match(await createPoRow.innerText(), /Create Purchase Order - Happy Path/);
      assert.match(await createPoRow.innerText(), /Procurement/);
      assert.match(await createPoRow.innerText(), /ready/i);

      await page.getByLabel('Filter by status').selectOption('draft');
      await results.getByText('No Tests match the current filters.').waitFor();
    });
  });
});

test('guided creation copies a template and restores the stable Test route', async () => {
  await withBrowser(async (browser) => {
    await withPage(browser, 'test-library-template-create', async (page) => {
      await page.goto(`${BASE_URL}/compose`);
      await page.getByRole('button', { name: 'New Test' }).click();
      await page.getByLabel('Business name').fill('Template Clone Regression');
      await page.getByLabel('Test application').selectOption('Oracle');
      await page.getByLabel('Test process area').fill('Finance');
      await page.getByLabel('Starting point').selectOption('template');
      await page.getByLabel('Template Test').selectOption('cleanup-abandoned-drafts.json');
      await page.getByRole('button', { name: 'Create Test' }).click();

      await page.waitForURL('**/compose/tests/template-clone-regression.json');
      assert.equal(await page.getByLabel('Test case name').inputValue(), 'Template Clone Regression');
      assert.equal(await page.getByLabel('Test application').inputValue(), 'Oracle');
      await page.locator('.step-module', { hasText: 'Wait' }).waitFor();

      await page.reload();
      await page.getByLabel('Test case name').waitFor();
      assert.equal(await page.getByLabel('Test application').inputValue(), 'Oracle');
      await page.getByRole('button', { name: 'Back to Test Library' }).click();

      await page.getByLabel('Filter by application').selectOption('Oracle');
      await page.getByLabel('Filter by process area').selectOption('Finance');
      const results = page.getByRole('region', { name: 'Test Library results' });
      const cloneRow = results.locator('tr', { hasText: 'template-clone-regression.json' });
      await cloneRow.waitFor();
      assert.match(await cloneRow.innerText(), /draft/i);
    });
  });
});
