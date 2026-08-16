'use strict';

const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const { assertServerReachable, BASE_URL } = require('../lib/apiClient');
const { withBrowser, withPage } = require('../lib/browserSession');

before(assertServerReachable);

async function createBlankTest(page, name) {
  await page.goto(`${BASE_URL}/compose`);
  await page.getByRole('button', { name: 'Compose New Test' }).click();
  await page.getByLabel('Test name').fill(name);
  await page.getByRole('button', { name: 'Create Test' }).click();
  await page.getByLabel('Test name').waitFor();
  // A Test with no declared contract shows the inputs/outputs panel collapsed, so that it does not
  // occupy the top of the screen to report two zeroes. Declaring one means opening it first.
  // Set `open` rather than clicking the summary: this is setup, not the behaviour under test.
  const contract = page.locator('details.contract-collapsed');
  await contract.waitFor({ timeout: 5000 }).catch(() => undefined);
  if (await contract.count()) await contract.evaluate((node) => { node.open = true; });
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

      // Source and value are one control now: opening the field lists everything bindable,
      // grouped by where it comes from, and PICKING one is what creates the binding. There is no
      // separate source to set first — that pair is what allowed a column name to be saved as a
      // literal (see 'literal-matches-dataset-column').
      const value = page.getByLabel('Milliseconds', { exact: true }).first();
      await value.click();
      // The dropdown is portaled and positions itself from a measured anchor, so it appears on
      // the render AFTER the click — assert on it only once it is actually there.
      await page.locator('.value-picker-dropdown').waitFor({ timeout: 5000 });
      const groups = await page.locator('.value-picker-group-label').allTextContents();
      assert.ok(groups.some((g) => /Dataset column/i.test(g)), `expected a dataset group, got ${groups.join(' | ')}`);
      assert.ok(groups.some((g) => /System value/i.test(g)), `expected a system group, got ${groups.join(' | ')}`);

      // Match the label span, not the option button: the button also contains the detail text
      // ("declared input, no dataset yet"), so an anchored regex never matches the whole button.
      await page.locator('.value-picker-option-label', { hasText: /^delayMs$/ }).first().click();
      // The tag is a readout of what the value now IS, so a binding is visible without opening
      // anything — the state that used to be silent.
      // innerText reflects the rendered casing (the tag is uppercased in CSS); the assertion is
      // about which state the value is in, not how it is styled.
      assert.equal((await page.locator('.value-picker-tag').first().innerText()).toLowerCase(), 'dataset');
      assert.equal(await value.inputValue(), 'delayMs');
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
      // Steps are picked with a radio and acted on from the toolbar, as in the Object Library.
      await page.getByRole('radio', { name: 'Select step 1: Wait' }).check();
      await page.getByRole('button', { name: 'EDIT' }).click();
      // Reopened from disk, the value still reads as a dataset binding rather than as the raw
      // "${delayMs}" text — inferValueBinding restoring it from the saved param.
      assert.equal((await page.locator('.value-picker-tag').first().innerText()).toLowerCase(), 'dataset');
      assert.equal(await page.getByLabel('Milliseconds', { exact: true }).first().inputValue(), 'delayMs');
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
