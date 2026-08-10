'use strict';

const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const { api, assertServerReachable, BASE_URL } = require('../lib/apiClient');
const { withBrowser, withPage } = require('../lib/browserSession');

before(assertServerReachable);

test('Reconcile all checks every Object for an App ID against the live screen instead of capturing new ones (BL-047 Phase 1)', async () => {
  const appId = 'uiReconcileApp';
  await api.put(`/api/objects/${appId}/ReconcileFieldOne`, {
    controlId: '__xmlview1--ReconcileFieldOne',
    controlType: 'sap.m.Input',
  });
  await api.put(`/api/objects/${appId}/ReconcileFieldTwo`, {
    controlId: '__xmlview1--ReconcileFieldTwo',
    controlType: 'sap.m.Input',
  });

  await withBrowser(async (browser) => {
    await withPage(browser, 'object-repository-reconcile', async (page) => {
      await page.goto(`${BASE_URL}/objects`);
      await page.getByLabel('Object repository process area').selectOption('(untagged)');
      await page.getByLabel('Object repository App ID').selectOption(appId);

      const reconcileButton = page.getByRole('button', { name: 'Reconcile all (2)' });
      await reconcileButton.waitFor();
      await reconcileButton.click();

      // No scan session is open in this isolated environment, so reconciling must fail with
      // the same clear error Reverify already gives for the same underlying reason — not a
      // silent no-op, and not a fresh capture created to paper over it.
      const alert = page.getByRole('alert');
      await alert.waitFor();
      assert.match(await alert.textContent(), /No active scan session/);
    });
  });
});

test('Reconcile all count tracks the current Object list, not a stale snapshot', async () => {
  const appId = 'uiReconcileCountApp';
  await api.put(`/api/objects/${appId}/CountFieldOne`, { controlId: '__xmlview1--CountFieldOne', controlType: 'sap.m.Input' });
  await api.put(`/api/objects/${appId}/CountFieldTwo`, { controlId: '__xmlview1--CountFieldTwo', controlType: 'sap.m.Input' });

  await withBrowser(async (browser) => {
    await withPage(browser, 'object-repository-reconcile-count', async (page) => {
      await page.goto(`${BASE_URL}/objects`);
      await page.getByLabel('Object repository process area').selectOption('(untagged)');
      await page.getByLabel('Object repository App ID').selectOption(appId);
      await page.getByRole('button', { name: 'Reconcile all (2)' }).waitFor();

      await page.getByLabel('Select object CountFieldOne').check();
      const dialogPromise = page.waitForEvent('dialog');
      const clicked = page.getByRole('button', { name: 'Delete' }).click();
      const dialog = await dialogPromise;
      await dialog.accept();
      await clicked;

      await page.getByRole('button', { name: 'Reconcile all (1)' }).waitFor();
    });
  });
});
