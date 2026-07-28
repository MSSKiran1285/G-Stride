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

      // Create a new, clearly-marked throwaway test case — overwritten idempotently on every run.
      await page.locator('input[placeholder="my-new-scenario"]').fill('regression-sample');
      await page.getByRole('button', { name: 'Create' }).click();

      await page.getByRole('button', { name: '+ Add step' }).click();
      await page.getByRole('button', { name: 'Module' }).click();
      await page.getByText('Wait', { exact: true }).last().click();
      await page.locator('div:has(> label:text-is("Milliseconds")) input').fill('250');
      await page.getByRole('button', { name: 'Save step' }).click();
      await page.getByRole('button', { name: 'Save test case' }).click();

      await page.locator('text=/Saved at/').waitFor({ timeout: 5000 });

      // Reload to prove it actually persisted server-side, not just in React state.
      await page.reload();
      await page.getByRole('button', { name: /Compose/ }).first().click();
      await page.getByRole('button', { name: 'Open test case' }).click();
      await page.getByText('(untagged)', { exact: true }).click();
      await page.getByText('regression-sample.json', { exact: true }).last().click();

      await page.locator('.step-module', { hasText: 'Wait' }).waitFor({ timeout: 5000 });
      const stepParams = await page.locator('.step-params').first().innerText();
      assert.ok(stepParams.includes('ms=250'), `expected "ms=250" in step params, got "${stepParams}"`);
    });
  });
});
