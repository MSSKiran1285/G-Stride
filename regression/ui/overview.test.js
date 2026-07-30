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

test('Canvas First Overview presents the approved shell and real workspace data', async () => {
  await withBrowser(async (browser) => {
    await withPage(browser, 'canvas-first-overview', async (page) => {
      await page.goto(BASE_URL);
      await page.getByRole('heading', { name: 'Good morning' }).waitFor();

      const navigation = await page.locator('.lhs-nav-item .nav-item-label').allTextContents();
      assert.deepEqual(navigation, [
        'Automation Overview',
        'Control Object Repository',
        'Compose',
        'Test Data',
        'Processes & Packs',
        'Execution Center',
        'Audit and Evidence',
      ]);

      const summary = await page.locator('.canvas-summary button').allTextContents();
      assert.match(summary[0], /^\d+\s+Tests$/, 'expected a real test-case count');
      assert.match(summary[1], /^\d+\s+Business Processes$/, 'expected a real Business Process count');
      await page.getByRole('heading', { name: 'Cleanup Abandoned Drafts' }).waitFor();
      await page.getByText('cleanup-abandoned-drafts.json', { exact: true }).last().waitFor();
      await page.locator('.context-target').waitFor();
      await page.getByRole('heading', { name: 'Execution impact' }).waitFor();
      await page.locator('.impact-metric-label', { hasText: 'Total executions' }).waitFor();
      await page.locator('.impact-metric-label', { hasText: 'Plausible manual effort' }).waitFor();
      await page.locator('.impact-metric-label', { hasText: 'Potential cost saved' }).waitFor();

      await page.getByText('Calculation assumptions and model', { exact: true }).click();
      assert.equal(await page.getByLabel('Manual minutes per test').inputValue(), '12');
      assert.equal(await page.getByLabel('Manual slowdown factor').inputValue(), '3');
      assert.equal(await page.getByLabel('Manual hourly cost (USD)').inputValue(), '50');
      assert.equal(await page.getByLabel('Automation runtime cost/hour (USD)').inputValue(), '2');
      assert.equal(await page.getByLabel('Automation engineer cost/hour (USD)').inputValue(), '75');
      assert.equal(await page.getByLabel('Initial build and setup hours').inputValue(), '40');
      assert.equal(await page.getByLabel('Maintenance hours/month').inputValue(), '4');
      assert.equal(await page.getByLabel('License and tooling/month (USD)').inputValue(), '100');
      assert.equal(await page.getByLabel('Fixed infrastructure/month (USD)').inputValue(), '50');
      assert.equal(await page.getByLabel('Review minutes/execution').inputValue(), '3');
      assert.equal(await page.getByLabel('Failure triage minutes/failed run').inputValue(), '15');
      await page.getByText('What does the slowdown factor mean?', { exact: true }).waitFor();
      await page.getByRole('heading', { name: 'Automation cost included' }).waitFor();
      await page.getByText('Total automation TCO', { exact: true }).waitFor();

      const totalTco = page.locator('.impact-cost-breakdown .total dd');
      const initialTco = Number((await totalTco.textContent()).replace(/[^\d.-]/g, ''));
      await page.getByLabel('Other automation cost for period (USD)').fill('100');
      const revisedTco = Number((await totalTco.textContent()).replace(/[^\d.-]/g, ''));
      assert.equal(revisedTco, initialTco + 100, 'expected other period cost to be included in automation TCO');

      const logoVisible = await page.locator('img.brand-logo-light[src="/ai-elk-logo-transparent.png"]').isVisible();
      assert.equal(logoVisible, true, 'expected the AI ELK logo to remain visible in the persistent shell');

      await page.locator('.account-trigger').click();
      await page.getByRole('menuitem', { name: 'Settings' }).waitFor();
      await page.getByRole('menuitem', { name: 'Help' }).waitFor();
      assert.equal(
        await page.getByRole('menuitem', { name: 'Sign out' }).isDisabled(),
        true,
        'expected sign out to remain disabled until the local workspace is linked to Google',
      );
      await page.getByRole('menuitem', { name: 'Settings' }).click();
      await page.getByRole('heading', { name: 'Settings', level: 2 }).waitFor();
      assert.deepEqual(
        await page.getByLabel('Target classification').locator('option').allTextContents(),
        ['Select classification', 'Non-production', 'Production-like'],
      );
      assert.equal(
        await page.getByRole('button', { name: 'Verify connection' }).isDisabled(),
        false,
        'expected the configured isolated non-production target to remain verifiable',
      );
    });
  });
});

test('Canvas First Overview primary action opens Compose without execution', async () => {
  await withBrowser(async (browser) => {
    await withPage(browser, 'canvas-first-overview-create', async (page) => {
      await page.goto(BASE_URL);
      await page.getByRole('button', { name: 'Create test' }).click();
      await page.getByRole('heading', { name: 'Compose' }).waitFor();
    });
  });
});

test('Automation Overview: Needs attention surfaces real alerts, recent runs and tests open exact routes (BL-018 AC1/AC3)', async () => {
  const store = new RunHistoryStore(requireEnv('REGRESSION_RUN_HISTORY_DB'));
  try {
    store.record({
      id: 'overview-recent-failure',
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      status: 'failed',
      executedBy: 'overview-executor',
      mode: 'chain',
      appId: 'syntheticApp',
      testCaseNames: ['Cleanup Abandoned Drafts'],
      testCaseFiles: ['cleanup-abandoned-drafts.json'],
      result: { status: 'failed' },
    });

    await withBrowser(async (browser) => {
      await withPage(browser, 'overview-attention-and-routes', async (page) => {
        await page.goto(BASE_URL);
        await page.getByRole('heading', { name: 'Good morning' }).waitFor();

        const attention = page.locator('.canvas-attention');
        await attention.getByText(/execution.* failed in the last 7 days/).waitFor();
        await attention.getByText(/not yet published \(blocked from Regression Packs\)/).waitFor();

        // A recent execution row opens the exact audit detail route, not the general workspace.
        const failedRow = page.locator('.canvas-run-row', { hasText: 'Cleanup Abandoned Drafts' }).first();
        await failedRow.click();
        assert.equal(new URL(page.url()).pathname, '/audit/runs/overview-recent-failure');

        await page.goto(BASE_URL);
        await page.getByRole('heading', { name: 'Good morning' }).waitFor();

        // Selecting a test case and opening it in Compose lands on that exact Test's route.
        await page.getByRole('heading', { name: 'Cleanup Abandoned Drafts' }).click();
        await page.getByRole('button', { name: 'Open in Compose' }).click();
        assert.equal(new URL(page.url()).pathname, '/compose/tests/cleanup-abandoned-drafts.json');
      });
    });
  } finally {
    store.close();
  }
});

test('Automation Overview: execution impact filters, scope disclosure and weekly trend reflect real data (BL-019 AC1/AC3)', async () => {
  const store = new RunHistoryStore(requireEnv('REGRESSION_RUN_HISTORY_DB'));
  try {
    store.record({
      id: 'overview-impact-filter-a',
      startedAt: new Date().toISOString(),
      finishedAt: new Date(Date.now() + 1000).toISOString(),
      status: 'passed',
      executedBy: 'overview-executor',
      mode: 'chain',
      appId: 'overviewFilterAppA',
      testCaseNames: ['Overview Filter Test A'],
      result: { status: 'passed' },
    });
    store.record({
      id: 'overview-impact-filter-b',
      startedAt: new Date().toISOString(),
      finishedAt: new Date(Date.now() + 1000).toISOString(),
      status: 'passed',
      executedBy: 'overview-executor',
      mode: 'chain',
      appId: 'overviewFilterAppB',
      testCaseNames: ['Overview Filter Test B'],
      result: { status: 'passed' },
    });

    await withBrowser(async (browser) => {
      await withPage(browser, 'overview-impact-filters-and-trend', async (page) => {
        await page.goto(BASE_URL);
        await page.getByRole('heading', { name: 'Execution impact' }).waitFor();

        await page.locator('.impact-scope-disclosure').getByText(/Scope: /).waitFor();
        await page.getByRole('heading', { name: 'Weekly trend' }).waitFor();
        await page.locator('.impact-trend-table').waitFor();

        await page.getByLabel('App ID').selectOption('overviewFilterAppA');
        await page.locator('.impact-scope-disclosure', { hasText: 'overviewFilterAppA' }).waitFor();
        const totalCell = page.locator('.impact-metric', { hasText: 'Total executions' }).locator('.impact-metric-value');
        await page.waitForFunction(
          (expected) => document.querySelector('.impact-metric-value')?.textContent?.trim() === expected,
          '1',
        );
        assert.equal((await totalCell.textContent())?.trim(), '1', 'App ID filter should scope Total executions to exactly the matching run');
      });
    });
  } finally {
    store.close();
  }
});
