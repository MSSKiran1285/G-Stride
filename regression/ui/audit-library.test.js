'use strict';

const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const { assertServerReachable, BASE_URL } = require('../lib/apiClient');
const { withBrowser, withPage } = require('../lib/browserSession');
const { RunHistoryStore } = require('../../packages/core/dist');

before(assertServerReachable);

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required — run this file through regression/run-isolated-ui.js, not node --test directly.`);
  return value;
}

test('Audit and Evidence uses a searchable run library instead of date accordions', async () => {
  await withBrowser(async (browser) => {
    await withPage(browser, 'audit-run-library', async (page) => {
      await page.goto(BASE_URL);
      await page.getByRole('button', { name: /Audit and Evidence/ }).first().click();

      await page.getByRole('heading', { name: 'Audit and Evidence', level: 2 }).waitFor();
      await page.getByText('Canonical evidence is owner-protected and redaction is enforced', { exact: true }).waitFor();
      await page.getByPlaceholder('Search process, App ID, run ID, or executor').waitFor();
      await page.getByLabel('Filter audit runs by status').waitFor();
      await page.getByLabel('Filter audit runs by mode').waitFor();
      await page.getByLabel('Filter audit runs by date range').waitFor();

      assert.equal(
        await page.locator('details').count(),
        0,
        'expected the evidence library not to group runs into date accordions',
      );
    });
  });
});

test('Audit and Evidence toolbar gives every filter a genuinely usable width, not a collapsed sliver (HC-003/HC-032)', async () => {
  await withBrowser(async (browser) => {
    await withPage(browser, 'audit-toolbar-widths', async (page) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(BASE_URL);
      await page.getByRole('button', { name: /Audit and Evidence/ }).first().click();
      await page.getByRole('heading', { name: 'Audit and Evidence', level: 2 }).waitFor();

      // .workspace-toolbar (display:flex, shared by every <Toolbar>) used to silently win the
      // cascade over .audit-toolbar's own display:grid, collapsing the search box to an
      // icon-only sliver — this asserts real, usable widths, not just that the fields exist.
      const searchBox = await page.getByPlaceholder('Search process, App ID, run ID, or executor').boundingBox();
      const envBox = await page.getByLabel('Filter audit runs by environment').boundingBox();
      const sortBox = await page.getByLabel('Sort audit runs').boundingBox();
      assert.ok(searchBox.width > 150, `expected the search box to be a usable width, got ${searchBox.width}px`);
      assert.ok(envBox.width > 150, `expected the environment field to be a usable width, got ${envBox.width}px`);
      assert.ok(sortBox.width > 100, `expected the sort control to be a usable width, got ${sortBox.width}px`);

      // All six controls must fit on one row at desktop width rather than wrapping onto a
      // second row — a wrap would show up as a large (tens of pixels) difference, well beyond
      // the few pixels of intrinsic height difference between an <input> and a <select>.
      assert.ok(
        Math.abs(searchBox.y - sortBox.y) < 20,
        `expected every toolbar control to sit on the same row at desktop width, got search.y=${searchBox.y} sort.y=${sortBox.y}`,
      );
    });
  });
});

test('Audit and Evidence: environment filter, rerun lineage, and a source-artifact link (BL-035 AC1/AC3/AC4)', async () => {
  const store = new RunHistoryStore(requireEnv('REGRESSION_RUN_HISTORY_DB'));
  try {
    store.record({
      id: 'lineage-source-run',
      startedAt: '2026-01-01T00:00:00.000Z',
      finishedAt: '2026-01-01T00:00:03.000Z',
      status: 'failed',
      executedBy: 'lineage-executor',
      mode: 'chain',
      appId: 'lineageApp',
      testCaseNames: ['Lineage Source Test'],
      testCaseFiles: ['cleanup-abandoned-drafts.json'],
      result: { status: 'failed' },
      studioRunId: 'lineage-exec-source',
      targetHostname: 'lineage-source.sap.example.invalid',
      targetSafetyClass: 'non-production',
    });
    store.record({
      id: 'lineage-rerun-run',
      startedAt: '2026-01-02T00:00:00.000Z',
      finishedAt: '2026-01-02T00:00:03.000Z',
      status: 'passed',
      executedBy: 'lineage-executor',
      mode: 'chain',
      appId: 'lineageApp',
      testCaseNames: ['Lineage Source Test'],
      testCaseFiles: ['cleanup-abandoned-drafts.json'],
      result: { status: 'passed' },
      studioRunId: 'lineage-exec-rerun',
      parentStudioRunId: 'lineage-exec-source',
      targetHostname: 'lineage-rerun.sap.example.invalid',
      targetSafetyClass: 'non-production',
    });

    await withBrowser(async (browser) => {
      await withPage(browser, 'audit-lineage-and-links', async (page) => {
        await page.goto(BASE_URL);
        await page.getByRole('button', { name: /Audit and Evidence/ }).first().click();

        await page.locator('.audit-run-card', { hasText: 'lineage-rerun-run' }).waitFor();
        await page.getByLabel('Filter audit runs by environment').fill('lineage-source');
        // Wait for a card that should be filtered OUT to actually leave the DOM — the matching
        // card can already be visible in the unfiltered list, so its mere presence doesn't prove
        // the filter has taken effect yet.
        await page.locator('.audit-run-card', { hasText: 'lineage-rerun-run' }).waitFor({ state: 'detached' });
        await page.locator('.audit-run-card', { hasText: 'lineage-source-run' }).waitFor();
        assert.equal(await page.locator('.audit-run-card').count(), 1, 'environment filter should narrow to only the matching run');

        await page.getByLabel('Filter audit runs by environment').fill('');
        await page.locator('.audit-run-card', { hasText: 'lineage-rerun-run' }).getByRole('button', { name: 'View record' }).click();

        const detail = page.locator('.audit-detail-panel');
        await detail.getByRole('button', { name: "View source execution (this was a rerun)" }).click();

        await page.locator('.audit-lineage-strip', { hasText: 'lineage-exec-source' }).waitFor();
        // The lineage banner appears as soon as the filter state is set, independently of the
        // (async) refetch it triggers — wait for the stale rerun card to actually leave the DOM
        // rather than just for the source card to be present (which was already true before the
        // filtered fetch resolved, since both runs show in the unfiltered list too).
        await page.locator('.audit-run-card', { hasText: 'lineage-rerun-run' }).waitFor({ state: 'detached' });
        await page.locator('.audit-run-card', { hasText: 'lineage-source-run' }).waitFor();
        assert.equal(await page.locator('.audit-run-card').count(), 1, 'lineage filter should show only the source execution\'s own runs');

        await page.locator('.audit-run-card', { hasText: 'lineage-source-run' }).getByRole('button', { name: 'View record' }).click();
        await page.locator('.audit-detail-panel .chip-link', { hasText: 'Lineage Source Test' }).click();
        assert.equal(new URL(page.url()).pathname, '/compose/tests/cleanup-abandoned-drafts.json');
      });
    });
  } finally {
    store.close();
  }
});
