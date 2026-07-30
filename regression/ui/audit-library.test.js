'use strict';

const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const { assertServerReachable, BASE_URL } = require('../lib/apiClient');
const { withBrowser, withPage } = require('../lib/browserSession');

before(assertServerReachable);

test('Audit and Evidence uses a searchable run library instead of date accordions', async () => {
  await withBrowser(async (browser) => {
    await withPage(browser, 'audit-run-library', async (page) => {
      await page.goto(BASE_URL);
      await page.getByRole('button', { name: /Audit and Evidence/ }).first().click();

      await page.getByRole('heading', { name: 'Audit and Evidence', level: 2 }).waitFor();
      await page.getByText('Canonical evidence is owner-protected and redaction is enforced', { exact: true }).waitFor();
      await page.getByPlaceholder('Search process, App ID, run ID, or executor').waitFor();
      await page.getByLabel('Filter audit runs by status').waitFor();
      await page.getByLabel('Filter audit runs by mode').waitFor();
      await page.getByLabel('Filter audit runs by date range').waitFor();

      assert.equal(
        await page.locator('details').count(),
        0,
        'expected the evidence library not to group runs into date accordions',
      );
    });
  });
});
