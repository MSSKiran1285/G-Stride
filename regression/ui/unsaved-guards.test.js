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
      await page.getByRole('button', { name: 'Compose New Test' }).click();
      await page.getByLabel('Test name').fill('Unsaved Test');
      await page.getByRole('button', { name: 'Create Test' }).click();
      await page.getByLabel('Test name').fill('Unsaved Test edited locally');
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
      await page.getByRole('button', { name: 'New dataset' }).click();
      await page.getByLabel('New dataset file name').fill('unsaved-data');
      await page.getByLabel('New dataset column names').fill('value');
      await page.getByRole('button', { name: 'Create' }).click();

      // The dataset opens as a pop-out, so its backdrop covers the shell — you cannot navigate
      // past an unsaved dataset without first dismissing it, and dismissing is what asks. The
      // guard did not weaken when the editor became modal; it moved to the way out.
      const editor = page.locator('.pop-dialog.data-dialog');
      await editor.waitFor();
      await expectDiscardGuard(page, () => page.getByRole('button', { name: 'Close dataset' }).click());
      await editor.waitFor();
      assert.equal(await page.getByLabel('New dataset file name').count(), 0, 'the create dialog should be gone');

      // Confirming does close it, and the workspace is still Test Data.
      page.once('dialog', (dialog) => dialog.accept());
      await page.getByRole('button', { name: 'Close dataset' }).click();
      await editor.waitFor({ state: 'detached' });
      await page.getByRole('heading', { name: 'Test Data' }).waitFor();
    });
  });
});

test('unsaved new group is protected from shell navigation', async () => {
  await withBrowser(async (browser) => {
    await withPage(browser, 'unsaved-group-guard', async (page) => {
      await page.goto(BASE_URL);
      await page.getByRole('button', { name: /Processes & Packs/ }).first().click();
      await page.getByRole('button', { name: 'Create New' }).click();
      await page.getByRole('radio', { name: /Business Process/ }).check();
      await page.getByLabel('File name').fill('unsaved-group');
      await page.getByRole('button', { name: 'Create', exact: true }).click();
      // The scenario composes in a modal, so the shell is unreachable behind it by design.
      // Leaving the modal is now the boundary that has to protect the unsaved draft.
      await expectDiscardGuard(page, () => page.getByRole('button', { name: 'Close this scenario' }).click());
      await page.getByRole('heading', { name: 'Processes & Packs' }).waitFor();
    });
  });
});

test('browser Back cannot discard an unsaved route-selected artifact without confirmation', async () => {
  await withBrowser(async (browser) => {
    await withPage(browser, 'unsaved-browser-back-guard', async (page) => {
      await page.goto(BASE_URL);
      await page.getByRole('button', { name: /Compose/ }).first().click();
      await page.getByRole('button', { name: 'Compose New Test' }).click();
      await page.getByLabel('Test name').fill('Unsaved Back Route');
      await page.getByRole('button', { name: 'Create Test' }).click();
      await page.waitForURL('**/compose/tests/unsaved-back-route.json');
      assert.equal(new URL(page.url()).pathname, '/compose/tests/unsaved-back-route.json');
      await page.getByLabel('Test name').fill('Unsaved Back Route edited locally');
      await page.getByText(/unsaved changes/i).waitFor();

      const dialogPromise = page.waitForEvent('dialog');
      const backAttempt = page.goBack({ timeout: 3000 }).catch(() => null);
      const dialog = await dialogPromise;
      assert.match(dialog.message(), /unsaved changes/i);
      await dialog.dismiss();
      await backAttempt;
      await page.waitForURL('**/compose/tests/unsaved-back-route.json');
      assert.equal(new URL(page.url()).pathname, '/compose/tests/unsaved-back-route.json');
      await page.getByLabel('Test name').waitFor();
    });
  });
});
