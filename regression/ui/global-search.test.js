'use strict';

const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const { api, assertServerReachable, BASE_URL } = require('../lib/apiClient');
const { withBrowser, withPage } = require('../lib/browserSession');

before(assertServerReachable);

async function openSearch(page) {
  await page.getByRole('button', { name: 'Search' }).click();
  await page.getByRole('heading', { name: /Find any Test, Object, Dataset, Process, Pack or Run/ }).waitFor();
}

test('Global search finds a Test by name, shows typed domain/App ID/lifecycle, and opens its exact route (BL-037 AC1)', async () => {
  const testFile = 'global-search-nav-test.json';
  await api.put(`/api/testcases/${testFile}`, {
    name: 'Global Search Navigation Test',
    steps: [{ module: 'Wait', appId: 'globalSearchNavApp', params: { ms: '1' } }],
  });
  await api.put(`/api/tags/testCase/${testFile}`, { processArea: 'Global Search Domain' });

  await withBrowser(async (browser) => {
    await withPage(browser, 'global-search-navigate', async (page) => {
      await page.goto(BASE_URL);
      await openSearch(page);

      await page.getByRole('searchbox').fill('Global Search Navigation');
      const row = page.locator('.search-result-row', { hasText: 'Global Search Navigation Test' });
      await row.waitFor();
      assert.equal(await row.locator('.search-kind').textContent(), 'Test');
      const meta = await row.locator('.search-result-meta').textContent();
      assert.match(meta, /Global Search Domain/);
      assert.match(meta, /globalSearchNavApp/);
      assert.match(meta, /ready/);

      await row.getByRole('button', { name: 'Global Search Navigation Test' }).click();
      assert.equal(new URL(page.url()).pathname, `/compose/tests/${testFile}`);
    });
  });
});

test('Global search "Show usage" reports incoming Process/Pack dependencies and outgoing Object references for a Test (BL-037 AC2)', async () => {
  const testFile = 'global-search-usage-test.json';
  await api.put(`/api/objects/globalSearchUsageApp/GlobalSearchUsageButton`, {
    controlId: '__xmlview1--GlobalSearchUsageButton',
    controlType: 'sap.m.Button',
  });
  await api.put(`/api/testcases/${testFile}`, {
    name: 'Global Search Usage Test',
    steps: [{ module: 'ClickButton', appId: 'globalSearchUsageApp', params: { control: 'GlobalSearchUsageButton' } }],
  });
  const groupFile = 'global-search-usage-group.json';
  await api.put(`/api/groups/${groupFile}`, {
    name: 'Global Search Usage Group',
    appId: 'globalSearchUsageApp',
    testCaseFiles: [testFile],
  });

  await withBrowser(async (browser) => {
    await withPage(browser, 'global-search-usage', async (page) => {
      await page.goto(BASE_URL);
      await openSearch(page);

      await page.getByRole('searchbox').fill('Global Search Usage Test');
      const row = page.locator('.search-result-row', { hasText: 'Global Search Usage Test' });
      await row.waitFor();
      await row.getByRole('button', { name: 'Show usage' }).click();

      const usagePanel = row.locator('.search-usage-panel');
      await usagePanel.getByText(`Process: ${groupFile}`).waitFor();
      await usagePanel.getByText('Object: globalSearchUsageApp/GlobalSearchUsageButton').waitFor();
    });
  });
});

test('Global search delete asks for confirmation naming the referencing Process, then removes the Test (BL-037 AC3)', async () => {
  const testFile = 'global-search-delete-test.json';
  await api.put(`/api/testcases/${testFile}`, {
    name: 'Global Search Delete Test',
    steps: [{ module: 'Wait', params: { ms: '1' } }],
  });
  const groupFile = 'global-search-delete-group.json';
  await api.put(`/api/groups/${groupFile}`, {
    name: 'Global Search Delete Group',
    appId: 'globalSearchDeleteApp',
    testCaseFiles: [testFile],
  });

  await withBrowser(async (browser) => {
    await withPage(browser, 'global-search-delete', async (page) => {
      await page.goto(BASE_URL);
      await openSearch(page);

      await page.getByRole('searchbox').fill('Global Search Delete Test');
      const row = page.locator('.search-result-row', { hasText: 'Global Search Delete Test' });
      await row.waitFor();

      const dialogPromise = page.waitForEvent('dialog');
      const clicked = row.getByRole('button', { name: 'Delete', exact: true }).click();
      const dialog = await dialogPromise;
      assert.match(dialog.message(), /Global Search Delete Test/);
      assert.match(dialog.message(), new RegExp(`Process.*${groupFile}`));
      await dialog.accept();
      await clicked;

      await row.waitFor({ state: 'detached' });
    });
  });

  const gone = await api.get(`/api/testcases/${testFile}`);
  assert.equal(gone.status, 404, 'expected the Test to actually be deleted via the confirmed force delete');
});

test('Global search deletes an unreferenced artifact without a dependency warning (BL-037 AC3)', async () => {
  const testFile = 'global-search-delete-unreferenced.json';
  await api.put(`/api/testcases/${testFile}`, { name: 'Global Search Delete Unreferenced', steps: [] });

  await withBrowser(async (browser) => {
    await withPage(browser, 'global-search-delete-unreferenced', async (page) => {
      await page.goto(BASE_URL);
      await openSearch(page);

      await page.getByRole('searchbox').fill('Global Search Delete Unreferenced');
      const row = page.locator('.search-result-row', { hasText: 'Global Search Delete Unreferenced' });
      await row.waitFor();

      const dialogPromise = page.waitForEvent('dialog');
      const clicked = row.getByRole('button', { name: 'Delete', exact: true }).click();
      const dialog = await dialogPromise;
      assert.match(dialog.message(), /can't be undone/);
      await dialog.accept();
      await clicked;

      await row.waitFor({ state: 'detached' });
    });
  });

  const gone = await api.get(`/api/testcases/${testFile}`);
  assert.equal(gone.status, 404);
});
