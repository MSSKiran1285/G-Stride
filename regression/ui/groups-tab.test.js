'use strict';

const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const { assertServerReachable, BASE_URL } = require('../lib/apiClient');
const { withBrowser, withPage } = require('../lib/browserSession');

before(assertServerReachable);

test('Groups: create a group, save, reload, reopen (required Groups positive)', async () => {
  await withBrowser(async (browser) => {
    await withPage(browser, 'groups-create-save-reopen', async (page) => {
      await page.goto(BASE_URL);
      await page.getByRole('button', { name: /Process Suites/ }).first().click();

      await page.locator('input[placeholder="po-gr-invoice"]').fill('regression-sample-group');
      await page.getByRole('button', { name: 'Create' }).click();

      await page.locator('div:has(> label:text-is("App ID")) input').fill('createPurchaseOrder');
      await page.locator('li:has-text("cleanup-abandoned-drafts.json") button:has-text("+ Add")').click();
      await page.getByRole('button', { name: 'Save group' }).click();

      await page.locator('text=/Saved at/').waitFor({ timeout: 5000 });
      assert.equal(new URL(page.url()).pathname, '/process-suites/regression-sample-group.json');

      await page.reload();
      await page.locator('li:has-text("cleanup-abandoned-drafts.json")').first().waitFor({ timeout: 5000 });
      const appIdValue = await page.locator('div:has(> label:text-is("App ID")) input').inputValue();
      assert.equal(appIdValue, 'createPurchaseOrder');
    });
  });
});
