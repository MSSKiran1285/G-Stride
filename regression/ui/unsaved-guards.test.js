'use strict';

const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const { assertServerReachable, BASE_URL } = require('../lib/apiClient');
const { withBrowser, withPage } = require('../lib/browserSession');

before(assertServerReachable);

async function expectDiscardGuard(page, navigate) {
  const dialogPromise = page.waitForEvent('dialog');
  const navigationAttempt = navigate();
  const dialog = await dialogPromise;
  assert.match(dialog.message(), /unsaved changes/i);
  await dialog.dismiss();
  await navigationAttempt;
}

test('unsaved new test case is protected from shell navigation', async () => {
  await withBrowser(async (browser) => {
    await withPage(browser, 'unsaved-test-case-guard', async (page) => {
      await page.goto(BASE_URL);
      await page.getByRole('button', { name: /Compose/ }).first().click();
      await page.getByLabel('New test case file name').fill('unsaved-test');
      await page.getByRole('button', { name: 'Create' }).click();
      await expectDiscardGuard(page, () => page.getByRole('button', { name: /Test Data/ }).first().click());
      await page.getByRole('heading', { name: 'Compose' }).waitFor();
    });
  });
});

test('unsaved new dataset is protected from shell navigation', async () => {
  await withBrowser(async (browser) => {
    await withPage(browser, 'unsaved-dataset-guard', async (page) => {
      await page.goto(BASE_URL);
      await page.getByRole('button', { name: /Test Data/ }).first().click();
      await page.getByLabel('New dataset file name').fill('unsaved-data');
      await page.getByLabel('New dataset column names').fill('value');
      await page.getByRole('button', { name: 'Create' }).click();
      await expectDiscardGuard(page, () => page.getByRole('button', { name: /Process Suites/ }).first().click());
      await page.getByRole('heading', { name: 'Test Data' }).waitFor();
    });
  });
});

test('unsaved new group is protected from shell navigation', async () => {
  await withBrowser(async (browser) => {
    await withPage(browser, 'unsaved-group-guard', async (page) => {
      await page.goto(BASE_URL);
      await page.getByRole('button', { name: /Process Suites/ }).first().click();
      await page.getByLabel('New group file name').fill('unsaved-group');
      await page.getByRole('button', { name: 'Create' }).click();
      await expectDiscardGuard(page, () => page.getByRole('button', { name: /Execution Center/ }).first().click());
      await page.getByRole('heading', { name: 'Process Suites' }).waitFor();
    });
  });
});
