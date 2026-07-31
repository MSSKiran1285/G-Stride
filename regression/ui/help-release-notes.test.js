'use strict';

const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const { assertServerReachable, BASE_URL } = require('../lib/apiClient');
const { withBrowser, withPage } = require('../lib/browserSession');

before(assertServerReachable);

test('Help drawer shows 2.1.0 candidate and 2.0.0 GA release notes with the accessibility caveat', async () => {
  await withBrowser(async (browser) => {
    await withPage(browser, 'help-release-notes', async (page) => {
      await page.goto(BASE_URL);
      await page.locator('.account-trigger').click();
      await page.getByRole('menuitem', { name: 'Help' }).click();
      await page.getByRole('heading', { name: 'Release notes' }).waitFor();

      const drawer = page.locator('#authoring-reference');
      const candidate = drawer.locator('.release-note-entry', { hasText: '2.1.0' });
      await candidate.getByText('Candidate — not yet released').waitFor();
      await candidate.getByText(/Manual NVDA screen-reader verification and live-SAP/).waitFor();

      const ga = drawer.locator('.release-note-entry', { hasText: '2.0.0' });
      await ga.getByText('Released — General Availability').waitFor();
      await ga.getByText(/completed manual NVDA 2026\.1\.1 screen-reader journey/).waitFor();
    });
  });
});
