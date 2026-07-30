'use strict';

const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const { assertServerReachable, BASE_URL } = require('../lib/apiClient');
const { withBrowser, withPage } = require('../lib/browserSession');

before(assertServerReachable);

test('artifact detail routes restore Compose, Data, Process, Object, and Audit context after refresh', async () => {
  await withBrowser(async (browser) => {
    await withPage(browser, 'stable-artifact-routes', async (page) => {
      const cases = [
        {
          path: '/compose/tests/regression-sample.json',
          ready: () => page.getByLabel('Test case name'),
          value: async () => page.getByLabel('Test case name').inputValue(),
          expected: 'regression-sample',
        },
        {
          path: '/data/regression-sample.csv',
          ready: () => page.getByRole('button', { name: 'Save dataset' }),
          value: async () => page.locator('tbody tr').first().locator('input').first().inputValue(),
          expected: 'a',
        },
        {
          path: '/process-suites/regression-sample-group.json',
          ready: () => page.getByLabel('Group name'),
          value: async () => page.getByLabel('Group name').inputValue(),
          expected: 'regression-sample-group',
        },
      ];

      for (const route of cases) {
        await page.goto(`${BASE_URL}${route.path}`);
        await route.ready().waitFor();
        assert.equal(new URL(page.url()).pathname, route.path);
        assert.equal(await route.value(), route.expected);
        await page.reload();
        await route.ready().waitFor();
        assert.equal(await route.value(), route.expected);
      }

      await page.goto(`${BASE_URL}/objects/routeApp/SubmitButton`);
      await page.getByLabel('Select object SubmitButton').waitFor();
      assert.equal(await page.getByLabel('Select object SubmitButton').isChecked(), true);
      await page.reload();
      await page.getByLabel('Select object SubmitButton').waitFor();
      await page.waitForFunction(() => document.querySelector('input[aria-label="Select object SubmitButton"]')?.checked === true);
      assert.equal(await page.getByLabel('Select object SubmitButton').isChecked(), true);

      await page.goto(`${BASE_URL}/audit/runs/route-audit-run`);
      const auditDetail = page.getByLabel('Selected audit record');
      await auditDetail.getByRole('heading', { name: 'Stable Route Test' }).waitFor();
      await auditDetail.getByText('route-owner@example.invalid', { exact: true }).waitFor();
      await page.reload();
      await page.getByLabel('Selected audit record').getByRole('heading', { name: 'Stable Route Test' }).waitFor();
      assert.equal(new URL(page.url()).pathname, '/audit/runs/route-audit-run');
    });
  });
});

test('browser back and forward restore route-selected artifacts', async () => {
  await withBrowser(async (browser) => {
    await withPage(browser, 'stable-route-history', async (page) => {
      await page.goto(BASE_URL);
      await page.getByRole('button', { name: /Compose/ }).first().click();
      await page.getByRole('button', { name: 'Open test case' }).click();
      await page.getByText('(untagged)', { exact: true }).click();
      await page.getByText('regression-sample.json', { exact: true }).last().click();
      assert.equal(new URL(page.url()).pathname, '/compose/tests/regression-sample.json');

      await page.getByRole('button', { name: /Test Data/ }).first().click();
      await page.getByRole('button', { name: 'Open dataset' }).click();
      await page.getByText('(untagged)', { exact: true }).click();
      await page.getByRole('listbox', { name: 'Open dataset' }).getByRole('option', { name: 'regression-sample.csv', exact: true }).click();
      assert.equal(new URL(page.url()).pathname, '/data/regression-sample.csv');

      await page.goBack();
      assert.equal(new URL(page.url()).pathname, '/data');
      await page.goBack();
      await page.getByLabel('Test case name').waitFor();
      assert.equal(new URL(page.url()).pathname, '/compose/tests/regression-sample.json');
      await page.goForward();
      await page.getByRole('button', { name: 'Open dataset' }).waitFor();
      assert.equal(new URL(page.url()).pathname, '/data');
    });
  });
});
