'use strict';

const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const { assertServerReachable, BASE_URL } = require('../lib/apiClient');
const { withBrowser, withPage } = require('../lib/browserSession');

before(assertServerReachable);

const LIVE = {
  skip: !process.env.REGRESSION_LIVE
    && 'set REGRESSION_LIVE=1 to run the read-only matrix against the configured non-production SAP target',
};
const TRANSACTIONAL_LIVE = {
  skip: !process.env.REGRESSION_LIVE_TRANSACTIONAL
    && 'set REGRESSION_LIVE_TRANSACTIONAL=1 only after test-data ownership, fail-stop retention, and live-run approval are confirmed',
};
const EXECUTION = {
  skip: !process.env.REGRESSION_ISOLATED
    && !process.env.REGRESSION_ALLOW_EXECUTION
    && 'run through the isolated harness or set REGRESSION_ALLOW_EXECUTION=1',
};

async function pollCompletionBanner(page, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const text = await page.locator('.completion-banner').innerText().catch(() => '');
    if (text && !text.includes('Running')) return text;
    await page.waitForTimeout(3000);
  }
  throw new Error(`Run did not complete within ${timeoutMs}ms`);
}

async function confirmApprovedPreflight(page) {
  const acknowledgement = page.getByLabel(/reviewed the target warning/i);
  if (await acknowledgement.count()) await acknowledgement.check();
  await page.getByRole('button', { name: 'Confirm and start' }).click();
}

// --- Cheap rendering checks — no live execution ---

test('Run tab: execution type switching renders the approved business language', async () => {
  await withBrowser(async (browser) => {
    await withPage(browser, 'run-mode-switching', async (page) => {
      await page.goto(BASE_URL);
      await page.getByRole('button', { name: /Execution Center/ }).first().click();
      assert.equal(new URL(page.url()).pathname, '/execute/new');
      await page.reload();
      await page.getByText('Prepare a controlled SAP run').waitFor();
      await page.getByText('Evidence is generated automatically and shared with Audit and Evidence.').waitFor();
      assert.equal(await page.getByLabel(/Generate evidence PDF/).count(), 0);

      await page.locator('.context-target').click();
      await page.getByRole('heading', { name: 'Settings' }).waitFor();
      const sapUrlInput = page.locator('.integration-editor input[type="url"]');
      assert.equal(await sapUrlInput.count(), 1, 'expected SAP target settings to expose one URL field');
      await page.getByRole('button', { name: 'Close settings' }).click();

      await page.locator('.account-trigger').click();
      await page.getByRole('menuitem', { name: 'Help' }).click();
      await page.getByRole('heading', { name: 'Help and reference' }).waitFor();
      await page.getByRole('button', { name: 'Close help' }).click();

      await page.getByRole('button', { name: 'Pack · Tests', exact: true }).click();
      await page.locator("text=Independent scenarios that shouldn't affect each other").waitFor({ timeout: 3000 });
      await page.locator('text=Pack members').waitFor({ timeout: 3000 });

      await page.getByRole('button', { name: 'Pack · Processes', exact: true }).click();
      await page.locator('text=Independent, named business scenarios').waitFor({ timeout: 3000 });
      await page.locator('text=Available Business Processes').waitFor({ timeout: 3000 });
      await page.locator('text=Pack members').waitFor({ timeout: 3000 });

      await page.getByRole('button', { name: 'Business Process', exact: true }).click();
      await page.locator('text=Stage order').waitFor({ timeout: 3000 });

      await page.getByRole('button', { name: 'Single Test', exact: true }).click();
      await page.locator('text=Selected Test').waitFor({ timeout: 3000 });
    });
  });
});

test('Run tab: the file/group filter box narrows the available list', async () => {
  await withBrowser(async (browser) => {
    await withPage(browser, 'run-filter-box', async (page) => {
      await page.goto(BASE_URL);
      await page.getByRole('button', { name: /Execution Center/ }).first().click();
      await page.getByRole('button', { name: 'Pack · Processes', exact: true }).click();

      await page.locator('li:has-text("po-gr-invoice.json")').first().waitFor({ timeout: 5000 });
      await page.locator('input[placeholder="Filter…"]').fill('o2c');

      assert.equal(await page.locator('text=po-gr-invoice.json').count(), 0, 'expected po-gr-invoice.json to be filtered out');
      assert.ok((await page.locator('text=o2c-e2e.json').count()) > 0, 'expected o2c-e2e.json to still be visible');
    });
  });
});

test('Run tab: preflight impact review can be opened and cancelled without execution', async () => {
  await withBrowser(async (browser) => {
    await withPage(browser, 'run-review-safety', async (page) => {
      await page.goto(BASE_URL);
      await page.getByRole('button', { name: /Execution Center/ }).first().click();
      await page.locator('li:has-text("cleanup-abandoned-drafts.json") button:has-text("+ Add")').click();

      await page.getByRole('button', { name: 'Run preflight' }).click();
      await page.getByRole('heading', { name: 'Preflight and impact review' }).waitFor();
      await page.getByText('This execution may create or change real SAP business documents.').waitFor();
      await page.getByRole('button', { name: 'Cancel', exact: true }).click();
      assert.equal(await page.getByRole('heading', { name: 'Preflight and impact review' }).count(), 0);
    });
  });
});

test('Run tab: filter recalculates and previews the exact approved data snapshot', async () => {
  await withBrowser(async (browser) => {
    await withPage(browser, 'run-effective-data-preview', async (page) => {
      await page.goto(BASE_URL);
      await page.getByRole('button', { name: /Execution Center/ }).first().click();
      await page.locator('li:has-text("cleanup-abandoned-drafts.json") button:has-text("+ Add")').click();
      await page.getByLabel('Execution data file').selectOption('synthetic.csv');
      await page.getByLabel('Filter property').fill('value');
      await page.getByLabel('Filter rule').selectOption('equals');
      await page.getByLabel('Filter value').fill('example');

      await page.getByRole('button', { name: 'Run preflight' }).click();
      await page.getByRole('heading', { name: 'Preflight and impact review' }).waitFor();
      await page.getByText('Approved effective data').waitFor();
      await page.getByText('1 selected record', { exact: true }).waitFor();
      await page.getByLabel('Selected records for data').waitFor();
      assert.match(await page.getByLabel('Selected records for data').innerText(), /"value": "example"/);
      await page.getByText(/These exact selected records are sealed into snapshot/).waitFor();
      await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    });
  });
});

test('Run tab: a preflight data finding opens the exact dataset route', async () => {
  await withBrowser(async (browser) => {
    await withPage(browser, 'run-correction-route', async (page) => {
      await page.goto(BASE_URL);
      await page.getByRole('button', { name: /Execution Center/ }).first().click();
      await page.locator('li:has-text("route-mapped.json") button:has-text("+ Add")').click();
      await page.getByLabel('Execution data file').selectOption('synthetic.csv');

      await page.getByRole('button', { name: 'Run preflight' }).click();
      await page.getByRole('heading', { name: 'Preflight and impact review' }).waitFor();
      await page.getByText(/missing from 1 of 1 selected transaction records/).waitFor();

      page.once('dialog', (dialog) => dialog.accept());
      await page.getByRole('button', { name: 'Open dataset' }).click();
      await page.getByRole('button', { name: 'Save dataset' }).waitFor();
      assert.equal(new URL(page.url()).pathname, '/data/synthetic.csv');
    });
  });
});

test('Run tab: configuration remains usable at 320 CSS pixels and exposes keyboard focus', async () => {
  await withBrowser(async (browser) => {
    await withPage(browser, 'run-responsive-accessibility', async (page) => {
      await page.setViewportSize({ width: 320, height: 800 });
      await page.goto(BASE_URL);
      await page.getByRole('button', { name: /Execution Center/ }).first().click();
      await page.getByRole('heading', { name: 'Prepare a controlled SAP run' }).waitFor();
      await page.getByText('Execution health and planning metrics').waitFor();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      assert.ok(overflow <= 1, `expected no horizontal page overflow at 320px, found ${overflow}px`);
      await page.keyboard.press('Tab');
      const focused = await page.evaluate(() => {
        const element = document.activeElement;
        return Boolean(element && element !== document.body && element.matches('a,button,input,select,summary,[tabindex]'));
      });
      assert.equal(focused, true, 'expected keyboard navigation to land on an interactive element');
    });
  });
});

// --- Required isolated execution positives: complete UI -> preflight -> run -> progress journeys ---

test('Run tab: Business Process completes a synthetic multi-stage Chain', EXECUTION, async () => {
  await withBrowser(async (browser) => {
    await withPage(browser, 'run-chain-synthetic', async (page) => {
      await page.goto(BASE_URL);
      await page.getByRole('button', { name: /Execution Center/ }).first().click();
      await page.getByRole('button', { name: 'Business Process', exact: true }).click();

      for (const file of ['cleanup-abandoned-drafts.json', 'synthetic-second-stage.json']) {
        await page.locator(`li:has-text("${file}") button:has-text("+ Add")`).click();
      }
      await page.locator('div:has(> label:text-is("App ID")) input').fill('syntheticApp');
      await page.getByLabel(/headless/i).check();
      await page.getByRole('button', { name: 'Run preflight' }).click();
      await confirmApprovedPreflight(page);

      const bannerText = await pollCompletionBanner(page, 30_000);
      assert.ok(bannerText.toLowerCase().includes('passed'), `expected Chain to pass, got: "${bannerText}"`);
    });
  });
});

test('Run tab: a failed Chain shows a focused diagnosis with a link to the exact object (BL-032 AC1/AC3)', EXECUTION, async () => {
  await withBrowser(async (browser) => {
    await withPage(browser, 'run-chain-forced-failure', async (page) => {
      await page.goto(BASE_URL);
      await page.getByRole('button', { name: /Execution Center/ }).first().click();
      await page.getByRole('button', { name: 'Business Process', exact: true }).click();

      await page.locator('li:has-text("regression-force-fail.json") button:has-text("+ Add")').click();
      await page.locator('div:has(> label:text-is("App ID")) input').fill('syntheticApp');
      await page.getByLabel(/headless/i).check();
      await page.getByRole('button', { name: 'Run preflight' }).click();
      await confirmApprovedPreflight(page);

      const bannerText = await pollCompletionBanner(page, 30_000);
      assert.ok(bannerText.toLowerCase().includes('failed'), `expected Chain to fail, got: "${bannerText}"`);

      const diagnosis = page.locator('.failure-diagnosis');
      await diagnosis.getByText('Root failure · object').waitFor();
      await diagnosis.getByText(/no control named "SyntheticButton"/).waitFor();
      const correctionLink = diagnosis.getByRole('button', { name: 'Open "SyntheticButton" in the Control Object Repository' });
      await correctionLink.waitFor();
      await correctionLink.click();
      assert.equal(new URL(page.url()).pathname, '/objects/synthetic/SyntheticButton');
    });
  });
});

test('Run tab: Pack Tests completes a synthetic independent Suite', EXECUTION, async () => {
  await withBrowser(async (browser) => {
    await withPage(browser, 'run-suite-synthetic', async (page) => {
      await page.goto(BASE_URL);
      await page.getByRole('button', { name: /Execution Center/ }).first().click();
      await page.getByRole('button', { name: 'Pack · Tests', exact: true }).click();

      for (const file of ['cleanup-abandoned-drafts.json', 'synthetic-second-stage.json']) {
        await page.locator(`li:has-text("${file}") button:has-text("+ Add")`).click();
      }
      await page.locator('div:has(> label:text-is("App ID")) input').fill('syntheticApp');
      await page.getByLabel(/headless/i).check();
      await page.getByRole('button', { name: 'Run preflight' }).click();
      await confirmApprovedPreflight(page);

      const bannerText = await pollCompletionBanner(page, 30_000);
      assert.ok(bannerText.toLowerCase().includes('passed'), `expected Suite to pass, got: "${bannerText}"`);
    });
  });
});

test('Run tab: Batch mode runs "Cleanup Drafts" to completion (execution opt-in)', EXECUTION, async () => {
  await withBrowser(async (browser) => {
    await withPage(browser, 'run-batch-cleanup-drafts', async (page) => {
      await page.goto(BASE_URL);
      await page.getByRole('button', { name: /Execution Center/ }).first().click();
      await page.getByRole('button', { name: 'Pack · Processes', exact: true }).click();

      await page.locator('li:has-text("cleanup-drafts.json") button:has-text("+ Add")').click();
      await page.getByLabel(/headless/i).check();
      await page.getByRole('button', { name: 'Run preflight' }).click();
      await confirmApprovedPreflight(page);

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

test('Run tab: Pack Processes completes a synthetic multi-group Batch', EXECUTION, async () => {
  await withBrowser(async (browser) => {
    await withPage(browser, 'run-batch-synthetic-multiple-groups', async (page) => {
      await page.goto(BASE_URL);
      await page.getByRole('button', { name: /Execution Center/ }).first().click();
      await page.getByRole('button', { name: 'Pack · Processes', exact: true }).click();

      for (const file of ['cleanup-drafts.json', 'synthetic-process.json']) {
        await page.locator(`li:has-text("${file}") button:has-text("+ Add")`).click();
      }
      await page.getByLabel(/headless/i).check();
      await page.getByRole('button', { name: 'Run preflight' }).click();
      await confirmApprovedPreflight(page);

      const bannerText = await pollCompletionBanner(page, 30_000);
      assert.match(bannerText, /All 2 .* passed/i, `expected two Batch groups to pass, got: "${bannerText}"`);
      await page.locator('tr', { hasText: 'Cleanup Drafts' }).waitFor();
      await page.locator('tr', { hasText: 'Synthetic Process' }).waitFor();
    });
  });
});

test('Run tab: published Saved Pack preflights and executes mixed Test and Process members', EXECUTION, async () => {
  await withBrowser(async (browser) => {
    await withPage(browser, 'run-saved-mixed-pack', async (page) => {
      await page.goto(BASE_URL);
      await page.getByRole('button', { name: /Execution Center/ }).first().click();
      await page.getByRole('button', { name: 'Saved Pack', exact: true }).click();
      const packRow = page.getByText('published-mixed-pack.json', { exact: true }).first().locator('xpath=ancestor::li');
      await packRow.waitFor();
      await packRow.getByRole('button').click();
      await page.getByText(/policies come from the published Pack definition/).waitFor();
      await page.getByLabel(/headless/i).check();
      await page.getByRole('button', { name: 'Run preflight' }).click();
      await page.getByRole('heading', { name: 'Preflight and impact review' }).waitFor();
      const matrix = page.getByLabel('Calculated execution matrix');
      await matrix.getByText('2', { exact: true }).first().waitFor();
      await confirmApprovedPreflight(page);
      const bannerText = await pollCompletionBanner(page, 30000);
      assert.match(bannerText, /All 2 .* passed/i, 'expected the saved Pack to pass');
      await page.locator('tr', { hasText: 'Synthetic wait test' }).waitFor();
      await page.locator('tr', { hasText: 'Synthetic Process' }).waitFor();
    });
  });
});

test('Run tab: rerun review compares immutable inputs before creating lineage', EXECUTION, async () => {
  await withBrowser(async (browser) => {
    await withPage(browser, 'run-rerun-difference-review', async (page) => {
      await page.goto(BASE_URL);
      await page.getByRole('button', { name: /Execution Center/ }).first().click();
      await page.locator('li:has-text("cleanup-abandoned-drafts.json") button:has-text("+ Add")').click();
      await page.getByLabel(/headless/i).check();
      await page.getByRole('button', { name: 'Run preflight' }).click();
      await confirmApprovedPreflight(page);
      await pollCompletionBanner(page, 30_000);

      const failedScope = page.locator('select').filter({ has: page.locator('option[value="failed"]') });
      await failedScope.waitFor();
      assert.notEqual(
        await failedScope.locator('option[value="failed"]').getAttribute('disabled'),
        null,
        'failed-only scope should not be offered after a fully passed execution'
      );
      assert.equal(await failedScope.inputValue(), 'full');
      await page.getByPlaceholder('Why is this rerun required?').fill('Verify the reviewed recovery path');
      await page.getByRole('button', { name: 'Review differences' }).click();

      await page.getByRole('heading', { name: 'Compare source and rerun' }).waitFor();
      await page.getByText('Execution Plan', { exact: true }).waitFor();
      await page.getByText('Immutable data snapshot', { exact: true }).waitFor();
      await page.getByText('SAP target context', { exact: true }).waitFor();
      await page.getByText('Transaction scope', { exact: true }).waitFor();
      await page.getByRole('button', { name: 'Confirm safe rerun' }).click();

      await page.getByText(/Rerun of/).waitFor();
      await page.getByText(/full scope/).waitFor();
      await page.getByText(/Verify the reviewed recovery path/).waitFor();
    });
  });
});

// --- Gated live cases — real SAP execution via the actual UI, real wall-clock time ---

test('live: Run tab read-only Chain authenticates and opens Manage Purchase Orders', LIVE, async () => {
  await withBrowser(async (browser) => {
    await withPage(browser, 'run-chain-read-only-smoke', async (page) => {
      await page.goto(BASE_URL);
      await page.getByRole('button', { name: /Execution Center/ }).first().click();
      await page.getByRole('button', { name: 'Business Process', exact: true }).click();

      for (const file of ['verify-sap-login.json', 'open-manage-purchase-orders.json']) {
        await page.locator(`li:has-text("${file}") button:has-text("+ Add")`).click();
      }
      await page.locator('div:has(> label:text-is("App ID")) input').fill('createPurchaseOrder');
      await page.getByLabel(/headless/i).check();
      await page.getByRole('button', { name: 'Run preflight' }).click();
      await confirmApprovedPreflight(page);

      const bannerText = await pollCompletionBanner(page, 6 * 60 * 1000);
      assert.ok(bannerText.includes('passed'), `expected the full P2P chain to pass, got: "${bannerText}"`);
      await page.locator('text=Open evidence PDF').waitFor({ timeout: 5000 });
    });
  });
});

test('live: Run tab read-only Suite runs two independent SAP smoke tests', LIVE, async () => {
  await withBrowser(async (browser) => {
    await withPage(browser, 'run-suite-read-only-smoke', async (page) => {
      await page.goto(BASE_URL);
      await page.getByRole('button', { name: /Execution Center/ }).first().click();
      await page.getByRole('button', { name: 'Pack · Tests', exact: true }).click();

      for (const file of ['verify-sap-login.json', 'verify-procurement-navigation.json']) {
        await page.locator(`li:has-text("${file}") button:has-text("+ Add")`).click();
      }
      await page.locator('div:has(> label:text-is("App ID")) input').fill('createPurchaseOrder');
      await page.getByLabel(/headless/i).check();
      await page.getByRole('button', { name: 'Run preflight' }).click();
      await confirmApprovedPreflight(page);

      const bannerText = await pollCompletionBanner(page, 3 * 60 * 1000);
      assert.ok(bannerText.toLowerCase().includes('passed'), `expected Suite to pass, got: "${bannerText}"`);
    });
  });
});

test('live: Run tab read-only Batch runs two independent SAP smoke groups', LIVE, async () => {
  await withBrowser(async (browser) => {
    await withPage(browser, 'run-batch-read-only-smoke', async (page) => {
      await page.goto(BASE_URL);
      await page.getByRole('button', { name: /Execution Center/ }).first().click();
      await page.getByRole('button', { name: 'Pack · Processes', exact: true }).click();

      for (const file of ['sap-login-smoke.json', 'sap-procurement-navigation-smoke.json']) {
        await page.locator(`li:has-text("${file}") button:has-text("+ Add")`).click();
      }
      await page.getByLabel(/headless/i).check();
      await page.getByRole('button', { name: 'Run preflight' }).click();
      await confirmApprovedPreflight(page);

      const bannerText = await pollCompletionBanner(page, 8 * 60 * 1000);
      assert.match(
        bannerText,
        /All 2 (?:groups|process iterations) passed/i,
        `expected both groups to pass, got: "${bannerText}"`,
      );
    });
  });
});

test('live transactional: Run tab full PO -> GR -> Invoice via the UI', TRANSACTIONAL_LIVE, async () => {
  await withBrowser(async (browser) => {
    await withPage(browser, 'run-chain-full-po-gr-invoice', async (page) => {
      await page.goto(BASE_URL);
      await page.getByRole('button', { name: /Execution Center/ }).first().click();
      await page.getByRole('button', { name: 'Business Process', exact: true }).click();

      for (const file of ['create-po.json', 'post-goods-receipt.json', 'post-supplier-invoice.json']) {
        await page.locator(`li:has-text("${file}") button:has-text("+ Add")`).click();
      }
      await page.locator('div:has(> label:text-is("App ID")) input').fill('createPurchaseOrder');
      await page.locator('div:has(> label:text-is("Data file")) select').selectOption('suppliers.csv');
      await page.getByLabel(/headless/i).check();
      await page.getByRole('button', { name: 'Run preflight' }).click();
      await confirmApprovedPreflight(page);

      const bannerText = await pollCompletionBanner(page, 6 * 60 * 1000);
      assert.ok(bannerText.includes('passed'), `expected the full P2P chain to pass, got: "${bannerText}"`);
      await page.locator('text=Open evidence PDF').waitFor({ timeout: 5000 });
    });
  });
});
