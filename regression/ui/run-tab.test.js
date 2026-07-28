'use strict';

const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const { assertServerReachable, BASE_URL } = require('../lib/apiClient');
const { withBrowser, withPage } = require('../lib/browserSession');

before(assertServerReachable);

const LIVE = { skip: !process.env.REGRESSION_LIVE && 'set REGRESSION_LIVE=1 to run — this creates real documents in the SAP tenant' };
const EXECUTION = { skip: !process.env.REGRESSION_ALLOW_EXECUTION && 'set REGRESSION_ALLOW_EXECUTION=1 to allow an execution test' };

async function pollCompletionBanner(page, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const text = await page.locator('.completion-banner').innerText().catch(() => '');
    if (text && !text.includes('Running')) return text;
    await page.waitForTimeout(3000);
  }
  throw new Error(`Run did not complete within ${timeoutMs}ms`);
}

// --- Cheap rendering checks — no live execution ---

test('Run tab: mode switching renders the right labels/hints, no page errors', async () => {
  await withBrowser(async (browser) => {
    await withPage(browser, 'run-mode-switching', async (page) => {
      await page.goto(BASE_URL);
      await page.getByRole('button', { name: /Execution Center/ }).first().click();
      await page.getByText('Evidence is generated automatically and shared with Audit and Evidence.').waitFor();
      assert.equal(await page.getByLabel(/Generate evidence PDF/).count(), 0);

      await page.getByRole('button', { name: 'No SAP target configured' }).click();
      await page.getByRole('heading', { name: 'Settings' }).waitFor();
      const sapUrlInput = page.locator('.integration-editor input[type="url"]');
      assert.equal(await sapUrlInput.count(), 1, 'expected SAP target settings to expose one URL field');
      await page.getByRole('button', { name: 'Close settings' }).click();

      await page.locator('.account-trigger').click();
      await page.getByRole('menuitem', { name: 'Help' }).click();
      await page.getByRole('heading', { name: 'Help and reference' }).waitFor();
      await page.getByRole('button', { name: 'Close help' }).click();

      await page.getByRole('button', { name: 'Suite', exact: true }).click();
      await page.locator("text=Independent scenarios that shouldn't affect each other").waitFor({ timeout: 3000 });
      await page.locator('text=Suite members').waitFor({ timeout: 3000 });

      await page.getByRole('button', { name: 'Batch', exact: true }).click();
      await page.locator('text=Independent, named business scenarios').waitFor({ timeout: 3000 });
      await page.locator('text=Available groups').waitFor({ timeout: 3000 });
      await page.locator('text=Batch members').waitFor({ timeout: 3000 });

      await page.getByRole('button', { name: 'Chain', exact: true }).click();
      await page.locator('text=Run order').waitFor({ timeout: 3000 });
    });
  });
});

test('Run tab: the file/group filter box narrows the available list', async () => {
  await withBrowser(async (browser) => {
    await withPage(browser, 'run-filter-box', async (page) => {
      await page.goto(BASE_URL);
      await page.getByRole('button', { name: /Execution Center/ }).first().click();
      await page.getByRole('button', { name: 'Batch', exact: true }).click();

      await page.locator('li:has-text("po-gr-invoice.json")').first().waitFor({ timeout: 5000 });
      await page.locator('input[placeholder="Filter…"]').fill('cleanup');

      assert.equal(await page.locator('text=po-gr-invoice.json').count(), 0, 'expected po-gr-invoice.json to be filtered out');
      assert.ok((await page.locator('text=cleanup-drafts.json').count()) > 0, 'expected cleanup-drafts.json to still be visible');
    });
  });
});

test('Run tab: review can be cancelled and isolated execution remains blocked', async () => {
  await withBrowser(async (browser) => {
    await withPage(browser, 'run-review-safety', async (page) => {
      await page.goto(BASE_URL);
      await page.getByRole('button', { name: /Execution Center/ }).first().click();
      await page.locator('li:has-text("cleanup-abandoned-drafts.json") button:has-text("+ Add")').click();

      await page.getByRole('button', { name: 'Review and run' }).click();
      await page.getByRole('heading', { name: 'Review execution impact' }).waitFor();
      await page.getByText('This execution may create or change real SAP business documents.').waitFor();
      await page.getByRole('button', { name: 'Cancel', exact: true }).click();
      assert.equal(await page.getByRole('heading', { name: 'Review execution impact' }).count(), 0);

      await page.getByRole('button', { name: 'Review and run' }).click();
      await page.getByRole('button', { name: 'Confirm and start run' }).click();
      await page.getByText(/Execution is disabled in this isolated Studio session/).waitFor();
    });
  });
});

// --- Required Run positive: always executes, deliberately cheap (single, fast, no-PO group) ---

test('Run tab: Batch mode runs "Cleanup Drafts" to completion (execution opt-in)', EXECUTION, async () => {
  await withBrowser(async (browser) => {
    await withPage(browser, 'run-batch-cleanup-drafts', async (page) => {
      await page.goto(BASE_URL);
      await page.getByRole('button', { name: /Execution Center/ }).first().click();
      await page.getByRole('button', { name: 'Batch', exact: true }).click();

      await page.locator('li:has-text("cleanup-drafts.json") button:has-text("+ Add")').click();
      await page.getByLabel('Headless').check();
      await page.locator('button.primary', { hasText: 'Run' }).click();

      const bannerText = await pollCompletionBanner(page, 3 * 60 * 1000);
      assert.ok(bannerText.includes('passed'), `expected banner to report a pass, got: "${bannerText}"`);

      const groupRow = page.locator('tr', { hasText: 'Cleanup Drafts' });
      await groupRow.waitFor({ timeout: 5000 });
      // The .badge CSS class uppercases its text (text-transform: uppercase) — compare case-insensitively.
      const rowText = (await groupRow.innerText()).toLowerCase();
      assert.ok(rowText.includes('passed'), `expected the group row to show passed, got: "${rowText}"`);
    });
  });
});

// --- Gated live cases — real SAP execution via the actual UI, real wall-clock time ---

test('live: Run tab Chain mode — full PO -> GR -> Invoice via the UI', LIVE, async () => {
  await withBrowser(async (browser) => {
    await withPage(browser, 'run-chain-full-po-gr-invoice', async (page) => {
      await page.goto(BASE_URL);
      await page.getByRole('button', { name: /Execution Center/ }).first().click();

      for (const file of ['create-po.json', 'post-goods-receipt.json', 'post-supplier-invoice.json']) {
        await page.locator(`li:has-text("${file}") button:has-text("+ Add")`).click();
      }
      await page.locator('div:has(> label:text-is("App ID")) input').fill('createPurchaseOrder');
      await page.locator('div:has(> label:text-is("Data file")) select').selectOption('suppliers.csv');
      await page.getByLabel('Headless').check();
      await page.locator('button.primary', { hasText: 'Run' }).click();

      const bannerText = await pollCompletionBanner(page, 6 * 60 * 1000);
      assert.ok(bannerText.includes('passed'), `expected the full P2P chain to pass, got: "${bannerText}"`);
      await page.locator('text=Open evidence PDF').waitFor({ timeout: 5000 });
    });
  });
});

test('live: Run tab Batch mode — two groups, both pass', LIVE, async () => {
  await withBrowser(async (browser) => {
    await withPage(browser, 'run-batch-two-groups', async (page) => {
      await page.goto(BASE_URL);
      await page.getByRole('button', { name: /Execution Center/ }).first().click();
      await page.getByRole('button', { name: 'Batch', exact: true }).click();

      for (const file of ['cleanup-drafts.json', 'po-gr-invoice.json']) {
        await page.locator(`li:has-text("${file}") button:has-text("+ Add")`).click();
      }
      await page.getByLabel('Headless').check();
      await page.locator('button.primary', { hasText: 'Run' }).click();

      const bannerText = await pollCompletionBanner(page, 8 * 60 * 1000);
      assert.ok(bannerText.includes('All 2 groups passed'), `expected both groups to pass, got: "${bannerText}"`);
    });
  });
});
