'use strict';

const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const { assertServerReachable, BASE_URL } = require('../lib/apiClient');
const { withBrowser, withPage } = require('../lib/browserSession');

before(assertServerReachable);

test('Settings: saving and removing the AI provider API key round-trips the configured badge (BL-047 Phase 2 POC)', async () => {
  await withBrowser(async (browser) => {
    await withPage(browser, 'ai-provider-settings', async (page) => {
      await page.goto(BASE_URL);
      await page.locator('.account-trigger').click();
      await page.getByRole('menuitem', { name: 'Settings' }).click();
      await page.getByRole('heading', { name: 'Settings', level: 2 }).waitFor();

      const aiSection = page.locator('.settings-section', { has: page.getByRole('heading', { name: 'AI provider (BL-047 POC)' }) });
      await aiSection.waitFor();
      const apiKeyField = page.getByLabel('Anthropic API key');
      await apiKeyField.fill('sk-ant-ui-regression-key');
      await aiSection.getByRole('button', { name: 'Save API key' }).click();

      await page.getByText('API key saved securely.').waitFor();
      await aiSection.locator('.settings-connected').getByText('Configured').waitFor();

      await aiSection.getByRole('button', { name: 'Remove' }).click();
      await page.getByText('API key removed.').waitFor();
      assert.equal(
        await aiSection.locator('.settings-connected').count(),
        0,
        'expected the Configured badge to disappear after removal'
      );
    });
  });
});
