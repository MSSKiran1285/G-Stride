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
