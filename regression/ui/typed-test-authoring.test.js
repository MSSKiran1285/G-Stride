'use strict';

const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const { assertServerReachable, BASE_URL } = require('../lib/apiClient');
const { withBrowser, withPage } = require('../lib/browserSession');

before(assertServerReachable);

async function createBlankTest(page, name) {
  await page.goto(`${BASE_URL}/compose`);
  await page.getByRole('button', { name: 'New Test' }).click();
  await page.getByLabel('Business name').fill(name);
  await page.getByRole('button', { name: 'Create Test' }).click();
  await page.getByLabel('Test case name').waitFor();
}

test('typed Test publishes with a dataset binding and round-trips executable ModuleCall JSON', async () => {
  await withBrowser(async (browser) => {
    await withPage(browser, 'typed-test-publish', async (page) => {
      await createBlankTest(page, 'Typed Publish Regression');

      await page.getByRole('button', { name: '+ Add input' }).click();
      await page.getByLabel('Input 1 name').fill('delayMs');
      await page.getByLabel('Input 1 type').selectOption('number');
      await page.getByLabel('Input 1 sensitivity').selectOption('public');

      await page.getByRole('button', { name: '+ Add step' }).click();
      await page.getByRole('button', { name: 'Module' }).click();
      await page.getByText('Wait', { exact: true }).last().click();

      const source = page.getByLabel('Value source for Milliseconds');
      assert.deepEqual(await source.locator('option').allTextContents(), [
        'Literal value',
        'Dataset input',
        'System context',
        'Prior step output',
      ]);
      await source.selectOption('dataset');
      assert.equal(await page.getByLabel('Dataset input for Milliseconds').inputValue(), 'delayMs');
      await page.getByRole('button', { name: 'Save step' }).click();

      await page.getByRole('button', { name: 'Publish Test' }).click();
      await page.locator('.test-lifecycle-bar').getByText('Published', { exact: true }).first().waitFor();
      assert.equal(new URL(page.url()).pathname, '/compose/tests/typed-publish-regression.json');

      const persisted = await page.request.get(`${BASE_URL}/api/testcases/typed-publish-regression.json`);
      assert.equal(persisted.status(), 200);
      const body = await persisted.json();
      assert.equal(body.lifecycle, 'published');
      assert.equal(body.contract.inputs[0].type, 'number');
      assert.equal(body.contract.inputs[0].sensitivity, 'public');
      assert.equal(body.steps[0].params.ms, '${delayMs}');
      assert.deepEqual(body.steps[0].valueBindings.ms, { source: 'dataset', key: 'delayMs' });

      await page.reload();
      await page.locator('.test-lifecycle-bar').getByText('Published', { exact: true }).first().waitFor();
      await page.getByRole('button', { name: 'Edit step 1: Wait' }).click();
      assert.equal(await page.getByLabel('Value source for Milliseconds').inputValue(), 'dataset');
    });
  });
});

test('publishing is blocked by required parameters, missing objects and output collisions', async () => {
  await withBrowser(async (browser) => {
    await withPage(browser, 'typed-test-publish-blocked', async (page) => {
      await createBlankTest(page, 'Blocked Publish Regression');

      await page.getByRole('button', { name: '+ Add output' }).click();
      await page.getByLabel('Output 1 runtime key').fill('collision');
      await page.getByRole('button', { name: '+ Add output' }).click();
      await page.getByLabel('Output 2 runtime key').fill('collision');

      await page.getByRole('button', { name: '+ Add step' }).click();
      await page.getByRole('button', { name: 'Module' }).click();
      await page.getByText('Click Button', { exact: true }).last().click();
      await page.getByLabel('App ID override').fill('missingApp');
      await page.getByPlaceholder('e.g. CreateButton').fill('MissingButton');
      await page.getByRole('button', { name: 'Save step' }).click();

      await page.getByRole('button', { name: 'Publish Test' }).click();
      const findings = page.getByRole('alert');
      await findings.getByText(/publishing issues?/i).waitFor();
      const findingText = await findings.innerText();
      assert.match(findingText, /Runtime key "collision" is used by more than one output/);
      assert.match(findingText, /Object "MissingButton" does not exist/);
      assert.match(findingText, /no step produces that value/);
      await page.locator('.test-lifecycle-bar').getByText('Draft', { exact: true }).first().waitFor();
    });
  });
});
