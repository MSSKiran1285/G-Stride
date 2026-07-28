'use strict';

const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const { assertServerReachable, BASE_URL } = require('../lib/apiClient');
const { withBrowser, withPage } = require('../lib/browserSession');

before(assertServerReachable);

test('Data: create a dataset, add a row, save, reload, reopen (required Data positive)', async () => {
  await withBrowser(async (browser) => {
    await withPage(browser, 'data-create-save-reopen', async (page) => {
      await page.goto(BASE_URL);
      await page.getByRole('button', { name: /Test Data/ }).first().click();

      await page.locator('input[placeholder="my-new-dataset"]').fill('regression-sample');
      await page.locator('input[placeholder*="columns, e.g."]').fill('col1,col2');
      await page.getByRole('button', { name: 'Create' }).click();

      await page.getByRole('button', { name: '+ Add row' }).click();
      const firstRow = page.locator('tbody tr').first().locator('input');
      await firstRow.nth(0).fill('a');
      await firstRow.nth(1).fill('b');
      await page.getByRole('button', { name: 'Save dataset' }).click();

      await page.locator('text=/Saved at/').waitFor({ timeout: 5000 });

      await page.reload();
      await page.getByRole('button', { name: /Test Data/ }).first().click();
      await page.getByRole('button', { name: 'Open dataset' }).click();
      await page.getByText('(untagged)', { exact: true }).click();
      await page.getByText('regression-sample.csv', { exact: true }).last().click();

      const reopenedRow = page.locator('tbody tr').first().locator('input');
      await reopenedRow.first().waitFor({ timeout: 5000 });
      assert.equal(await reopenedRow.nth(0).inputValue(), 'a');
      assert.equal(await reopenedRow.nth(1).inputValue(), 'b');
    });
  });
});
