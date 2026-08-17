'use strict';

const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const { assertServerReachable, BASE_URL } = require('../lib/apiClient');
const { withBrowser, withPage } = require('../lib/browserSession');

before(assertServerReachable);

test('Business Processes: create, save, reload and reopen a process', async () => {
  await withBrowser(async (browser) => {
    await withPage(browser, 'groups-create-save-reopen', async (page) => {
      await page.goto(BASE_URL);
      await page.getByRole('button', { name: /Processes & Packs/ }).first().click();

      await page.getByRole('button', { name: 'Create New' }).click();
      await page.getByRole('radio', { name: /Business Process/ }).check();
      await page.getByLabel('File name').fill('regression-sample-group');
      await page.getByRole('button', { name: 'Create', exact: true }).click();

      await page.locator('div:has(> label:text-is("App ID")) input').fill('createPurchaseOrder');
      await page.locator('li:has-text("cleanup-abandoned-drafts.json") button:has-text("+ Add")').click();
      await page.getByRole('button', { name: 'Save Business Process' }).click();

      await page.locator('text=/Saved at/').waitFor({ timeout: 5000 });
      assert.equal(new URL(page.url()).pathname, '/process-suites/regression-sample-group.json');

      await page.reload();
      await page.locator('li:has-text("cleanup-abandoned-drafts.json")').first().waitFor({ timeout: 5000 });
      const appIdValue = await page.locator('div:has(> label:text-is("App ID")) input').inputValue();
      assert.equal(appIdValue, 'createPurchaseOrder');
    });
  });
});

test('Business Process canvas authors and restores a typed stage hand-off', async () => {
  await withBrowser(async (browser) => {
    await withPage(browser, 'process-typed-handoff', async (page) => {
      await page.goto(`${BASE_URL}/process-suites`);
      // Creation now goes through the workspace tree: Create New asks which kind of scenario
      // before it asks for a name, because the two produce different artifacts.
      await page.getByRole('button', { name: 'Create New' }).click();
      await page.getByRole('radio', { name: /Business Process/ }).check();
      await page.getByLabel('File name').fill('visual-contract-process');
      await page.getByRole('button', { name: 'Create', exact: true }).click();
      await page.getByLabel('Business Process App ID').fill('syntheticApp');
      for (const file of ['contract-producer.json', 'contract-consumer.json']) {
        await page.locator(`li:has-text("${file}") button:has-text("+ Add")`).click();
      }
      await page.getByLabel('Business Process lifecycle').selectOption('published');
      await page.getByLabel('Stage 1 ID').fill('produce-document');
      await page.getByLabel('Stage 2 ID').fill('consume-document');
      await page.getByLabel('consume-document documentId source').selectOption('stageOutput:produce-document:documentId');
      await page.getByText(/Process topology is valid/).waitFor();
      await page.getByRole('button', { name: 'Save Business Process' }).click();
      await page.getByText(/Saved at/).waitFor();

      await page.reload();
      await page.getByLabel('consume-document documentId source').waitFor();
      assert.equal(
        await page.getByLabel('consume-document documentId source').inputValue(),
        'stageOutput:produce-document:documentId',
      );
      assert.equal(await page.getByLabel('Business Process lifecycle').inputValue(), 'published');
    });
  });
});
