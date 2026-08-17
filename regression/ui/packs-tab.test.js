'use strict';

const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const { assertServerReachable, BASE_URL } = require('../lib/apiClient');
const { withBrowser, withPage } = require('../lib/browserSession');

before(assertServerReachable);

test('Regression Packs: create, bind independent members, save, reload and reopen', async () => {
  await withBrowser(async (browser) => {
    await withPage(browser, 'packs-create-save-reopen', async (page) => {
      await page.goto(BASE_URL);
      await page.getByRole('button', { name: /Processes & Packs/ }).first().click();
      await page.getByRole('button', { name: 'Regression Packs' }).click();
      assert.equal(new URL(page.url()).pathname, '/process-suites/packs');

      await page.getByRole('button', { name: 'Create New' }).click();
      await page.getByRole('radio', { name: /Regression Pack/ }).check();
      await page.getByLabel('File name').fill('regression-sample-pack');
      await page.getByRole('button', { name: 'Create', exact: true }).click();
      await page.getByLabel('Pack name').fill('Release Regression Pack');
      await page.getByLabel('Member 1 ID').fill('cleanup');
      await page.getByLabel('Member 1 artifact').selectOption('cleanup-abandoned-drafts.json');
      await page.getByLabel('Member 1 data').selectOption('synthetic.csv');

      await page.getByRole('button', { name: 'Add member' }).click();
      await page.getByLabel('Member 2 ID').fill('p2p-process');
      await page.getByLabel('Member 2 type').selectOption('process');
      await page.getByLabel('Member 2 artifact').selectOption('synthetic-process.json');
      await page.getByLabel('Member 2 failure policy').selectOption('stop-execution');
      await page.getByRole('button', { name: 'Save Regression Pack' }).click();
      await page.getByText(/Saved at/).waitFor();

      const detailPath = '/process-suites/packs/regression-sample-pack.json';
      assert.equal(new URL(page.url()).pathname, detailPath);
      await page.reload();
      await page.getByLabel('Pack name').waitFor();
      assert.equal(await page.getByLabel('Pack name').inputValue(), 'Release Regression Pack');
      assert.equal(await page.getByLabel('Member 1 data').inputValue(), 'synthetic.csv');
      assert.equal(await page.getByLabel('Member 2 type').inputValue(), 'process');
      assert.equal(await page.getByLabel('Member 2 failure policy').inputValue(), 'stop-execution');
    });
  });
});

test('unsaved Regression Pack changes are protected from shell navigation', async () => {
  await withBrowser(async (browser) => {
    await withPage(browser, 'pack-unsaved-guard', async (page) => {
      await page.goto(`${BASE_URL}/process-suites/packs`);
      await page.getByRole('button', { name: 'Create New' }).click();
      await page.getByRole('radio', { name: /Regression Pack/ }).check();
      await page.getByLabel('File name').fill('unsaved-pack');
      await page.getByRole('button', { name: 'Create', exact: true }).click();

      const dialogPromise = page.waitForEvent('dialog');
      const navigation = page.getByRole('button', { name: /Execution Center/ }).first().click();
      const dialog = await dialogPromise;
      assert.match(dialog.message(), /unsaved changes/i);
      await dialog.dismiss();
      await navigation;
      assert.equal(new URL(page.url()).pathname, '/process-suites/packs/unsaved-pack.json');
    });
  });
});
