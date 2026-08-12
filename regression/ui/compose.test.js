'use strict';

const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const { assertServerReachable, BASE_URL } = require('../lib/apiClient');
const { withBrowser, withPage } = require('../lib/browserSession');

before(assertServerReachable);

test('Compose: create a test case, add a step, save, reload, reopen (required Compose positive)', async () => {
  await withBrowser(async (browser) => {
    await withPage(browser, 'compose-create-save-reopen', async (page) => {
      await page.goto(BASE_URL);
      await page.getByRole('button', { name: /Compose/ }).first().click();

      // Create a new, clearly-marked throwaway Test through the guided library flow.
      await page.getByRole('button', { name: 'New Test' }).click();
      await page.getByLabel('Business name').fill('Regression Sample');
      await page.getByLabel('Test process area').fill('Quality Engineering');
      await page.getByRole('button', { name: 'Create Test' }).click();
      await page.waitForURL('**/compose/tests/regression-sample.json');

      await page.getByRole('button', { name: '+ Add step' }).click();
      await page.getByRole('button', { name: 'Module' }).click();
      await page.getByText('Wait', { exact: true }).last().click();
      await page.locator('div:has(> label:text-is("Milliseconds")) input').fill('250');
      await page.getByRole('button', { name: 'Save step' }).click();
      await page.getByRole('button', { name: 'Save test case' }).click();

      await page.locator('text=/Saved at/').waitFor({ timeout: 5000 });
      assert.equal(new URL(page.url()).pathname, '/compose/tests/regression-sample.json');

      // Reload to prove it actually persisted server-side, not just in React state.
      await page.reload();
      await page.locator('.step-module', { hasText: 'Wait' }).waitFor({ timeout: 5000 });
      assert.equal(await page.getByLabel('Test application').inputValue(), 'SAP');
      const stepParams = await page.locator('.step-params').first().innerText();
      assert.ok(stepParams.includes('ms=250'), `expected "ms=250" in step params, got "${stepParams}"`);
    });
  });
});

test("Compose: contextual capture opens over an object field and returns without losing the in-progress step (BL-023 AC4)", { skip: "Deprecated 12 Aug 2026 (G-Stride rebrand): the contextual-capture dialog no longer exposes the For: Control name contract. BL-023 AC4 is UNCOVERED until re-pointed." }, async () => {
  await withBrowser(async (browser) => {
    await withPage(browser, 'compose-contextual-capture', async (page) => {
      await page.goto(BASE_URL);
      await page.getByRole('button', { name: /Compose/ }).first().click();

      await page.getByRole('button', { name: 'New Test' }).click();
      await page.getByLabel('Business name').fill('Regression Contextual Capture');
      await page.getByRole('button', { name: 'Create Test' }).click();
      await page.waitForURL('**/compose/tests/regression-contextual-capture.json');

      await page.getByRole('button', { name: '+ Add step' }).click();
      await page.getByRole('button', { name: 'Module' }).click();
      await page.getByText('Click Button', { exact: true }).last().click();
      await page.getByLabel('App ID override').fill('createPurchaseOrder');

      const controlField = page.getByPlaceholder('e.g. CreateButton');
      await page.getByRole('button', { name: '+ Capture' }).click();

      // The overlay is a sibling panel, not a route change — the Compose route underneath
      // must stay exactly where the in-progress step edit is.
      const overlay = page.getByRole('dialog', { name: 'For: Control name' });
      await overlay.waitFor({ timeout: 5000 });
      await overlay.getByText('Capturing for').waitFor();
      await overlay.getByText('App ID: createPurchaseOrder').waitFor();
      assert.equal(new URL(page.url()).pathname, '/compose/tests/regression-contextual-capture.json');

      await overlay.getByRole('button', { name: 'Close capture and return to Compose without a change' }).click();
      await overlay.waitFor({ state: 'hidden', timeout: 5000 });

      // Closing without capturing anything must not have discarded the step being edited —
      // no navigation ever happened, so nothing was ever at risk.
      assert.equal(await page.getByLabel('App ID override').inputValue(), 'createPurchaseOrder');
      await controlField.fill('CreateButton');
      await page.getByRole('button', { name: 'Save step' }).click();
      await page.locator('.step-module', { hasText: 'ClickButton' }).waitFor({ timeout: 5000 });
      const stepParams = await page.locator('.step-params').first().innerText();
      assert.ok(stepParams.includes('control=CreateButton'), `expected "control=CreateButton" in step params, got "${stepParams}"`);
    });
  });
});
