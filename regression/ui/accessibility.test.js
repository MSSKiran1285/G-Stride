'use strict';

const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const AxeBuilder = require('@axe-core/playwright').default;
const { assertServerReachable, BASE_URL } = require('../lib/apiClient');
const { withBrowser, withPage } = require('../lib/browserSession');

before(assertServerReachable);
const nvdaSettleMs = process.env.REGRESSION_NVDA === '1' ? 1200 : 0;

const workspaces = [
  { name: 'Automation Overview', path: '/' },
  { name: 'Control Object Repository', path: '/objects' },
  { name: 'Compose', path: '/compose' },
  { name: 'Test Data', path: '/data' },
  { name: 'Processes & Packs', path: '/process-suites' },
  { name: 'Execution Center', path: '/execute/new' },
  { name: 'Audit and Evidence', path: '/audit-evidence' },
];

async function openWorkspace(page, workspace) {
  await page.goto(new URL(workspace.path, BASE_URL).toString(), { waitUntil: 'domcontentloaded' });
  const main = page.locator('#main-content');
  await main.waitFor({ state: 'visible' });
  await page.waitForFunction(() => {
    const workspaceMain = document.querySelector('#main-content');
    return Boolean(
      workspaceMain
      && workspaceMain.querySelector('button,a,input,select,textarea,summary,[tabindex]')
    );
  });
  // Axe must inspect the settled visual state, not a partially transparent
  // frame from the workspace's 200ms entry transition.
  await page.waitForTimeout(250);
}

function formatViolations(workspace, violations) {
  return violations.map((violation) => {
    const nodes = violation.nodes
      .slice(0, 5)
      .map((node) => `${node.target.join(' ')} — ${node.failureSummary ?? node.html}`)
      .join('\n      ');
    return `${workspace}: [${violation.impact}] ${violation.id} — ${violation.help}\n      ${nodes}`;
  }).join('\n');
}

test('Axe reports no serious or critical violations in every primary workspace', async () => {
  await withBrowser(async (browser) => {
    await withPage(browser, 'accessibility-axe-primary-workspaces', async (page) => {
      const failures = [];
      for (const workspace of workspaces) {
        await openWorkspace(page, workspace);
        const results = await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
          .analyze();
        const severe = results.violations.filter((violation) =>
          violation.impact === 'serious' || violation.impact === 'critical'
        );
        if (severe.length > 0) failures.push(formatViolations(workspace.name, severe));
      }
      assert.deepEqual(failures, [], `Unapproved Axe findings:\n${failures.join('\n')}`);
    });
  });
});

test('skip navigation and keyboard focus enter every primary workspace', async () => {
  await withBrowser(async (browser) => {
    await withPage(browser, 'accessibility-keyboard-primary-workspaces', async (page) => {
      for (const workspace of workspaces) {
        await openWorkspace(page, workspace);
        if (nvdaSettleMs) await page.waitForTimeout(nvdaSettleMs);
        await page.keyboard.press('Tab');
        const skipLink = page.getByRole('link', { name: 'Skip to main content' });
        await skipLink.waitFor();
        assert.equal(await skipLink.evaluate((element) => element === document.activeElement), true);
        await page.keyboard.press('Enter');
        if (nvdaSettleMs) await page.waitForTimeout(nvdaSettleMs);
        assert.equal(
          await page.locator('#main-content').evaluate((element) => element === document.activeElement),
          true,
          `${workspace.name} did not receive focus after skip navigation`
        );
        await page.keyboard.press('Tab');
        if (nvdaSettleMs) await page.waitForTimeout(nvdaSettleMs);
        const focus = await page.evaluate(() => {
          const active = document.activeElement;
          const main = document.querySelector('#main-content');
          return {
            interactive: Boolean(active?.matches('a,button,input,select,textarea,summary,[tabindex]')),
            inWorkspace: Boolean(active && main?.contains(active)),
            label: active?.getAttribute('aria-label') || active?.textContent?.trim() || active?.tagName,
          };
        });
        assert.equal(focus.interactive, true, `${workspace.name} did not expose a keyboard control after main focus`);
        assert.equal(focus.inWorkspace, true, `${workspace.name} moved focus outside the workspace: ${focus.label}`);
      }
    });
  });
});

test('primary workspaces reflow at 320 CSS pixels (640px viewport at 200% zoom equivalent)', async () => {
  await withBrowser(async (browser) => {
    await withPage(browser, 'accessibility-reflow-primary-workspaces', async (page) => {
      await page.setViewportSize({ width: 320, height: 800 });
      for (const workspace of workspaces) {
        await openWorkspace(page, workspace);
        const overflow = await page.evaluate(() =>
          document.documentElement.scrollWidth - document.documentElement.clientWidth
        );
        assert.ok(overflow <= 1, `${workspace.name} overflowed 320 CSS pixels by ${overflow}px`);
        if (workspace.name === 'Execution Center') {
          await page.getByRole('button', { name: 'Run preflight' }).waitFor();
        }
      }
    });
  });
});
