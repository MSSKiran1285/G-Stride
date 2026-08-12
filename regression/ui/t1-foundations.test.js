'use strict';

const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const { assertServerReachable, BASE_URL } = require('../lib/apiClient');
const { withBrowser, withPage } = require('../lib/browserSession');

before(assertServerReachable);

function contrastRatio(first, second) {
  function channels(cssColor) {
    const values = cssColor.match(/[\d.]+/g).slice(0, 3).map(Number);
    return values.map((value) => {
      const normalized = value / 255;
      return normalized <= 0.04045
        ? normalized / 12.92
        : ((normalized + 0.055) / 1.055) ** 2.4;
    });
  }
  function luminance(cssColor) {
    const [red, green, blue] = channels(cssColor);
    return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
  }
  const lighter = Math.max(luminance(first), luminance(second));
  const darker = Math.min(luminance(first), luminance(second));
  return (lighter + 0.05) / (darker + 0.05);
}

test('T1.3 grouped picker supports search and selection without leaving the keyboard', async () => {
  await withBrowser(async (browser) => {
    await withPage(browser, 't1-grouped-picker-keyboard', async (page) => {
      await page.goto(`${BASE_URL}/compose/tests/cleanup-abandoned-drafts.json`);
      await page.getByRole('button', { name: '+ Add step' }).click();

      const moduleTrigger = page.getByRole('button', { name: 'Module' });
      await moduleTrigger.click();
      const search = page.getByRole('combobox', { name: 'Search module' });
      await search.fill('Wait');
      await search.press('ArrowDown');
      await search.press('Enter');

      assert.equal(await moduleTrigger.textContent().then((text) => text.trim()), 'Wait');
    });
  });
});

test('T1.3 ordered transfer controls announce keyboard reorder operations', async () => {
  await withBrowser(async (browser) => {
    await withPage(browser, 't1-transfer-reorder', async (page) => {
      await page.goto(`${BASE_URL}/process-suites/cleanup-drafts.json`);
      await page.getByRole('button', { name: 'Add route-mapped.json to Business Process order' }).click();
      await page.getByRole('button', { name: 'Move route-mapped.json up' }).click();
      await page.getByRole('status').filter({ hasText: 'route-mapped.json moved to position 1.' }).waitFor();

      const orderedNames = await page.locator('.file-chain-column').last().locator('.chain-list li > span:not(.step-index)').allTextContents();
      assert.equal(orderedNames[0], 'route-mapped.json');
    });
  });
});

test('T1.3 shell and responsive tables remain operable at narrow widths', async () => {
  await withBrowser(async (browser) => {
    await withPage(browser, 't1-responsive-shell', async (page) => {
      await page.setViewportSize({ width: 620, height: 900 });
      await page.goto(`${BASE_URL}/compose/tests/cleanup-abandoned-drafts.json`);

      for (const destination of [
        'Overview',
        'Object Library',
        'Compose Tests',
        'Test Data',
        'Processes & Packs',
        'Execution Center',
        'Evidence Vault',
      ]) {
        await page.getByRole('button', { name: destination, exact: true }).waitFor();
      }

      const overflow = await page.evaluate(() => ({
        document: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        shell: document.querySelector('.app-layout').scrollWidth - document.querySelector('.app-layout').clientWidth,
      }));
      assert.ok(overflow.document <= 1, `document overflowed by ${overflow.document}px`);
      assert.ok(overflow.shell <= 1, `application shell overflowed by ${overflow.shell}px`);

      assert.equal(
        await page.locator('.responsive-table td[data-label="Module"]').first().getAttribute('data-label'),
        'Module',
      );

      const account = page.locator('.account-trigger');
      await account.click();
      const settings = page.getByRole('menuitem', { name: 'Settings' });
      await settings.waitFor();
      await settings.press('ArrowDown');
      assert.equal(await page.evaluate(() => document.activeElement?.textContent?.trim()), 'Help');
      await page.keyboard.press('Escape');
      assert.equal(await account.getAttribute('aria-expanded'), 'false');
    });
  });
});

test('T1.3 primary text and controls meet normal-text contrast in both themes', async () => {
  await withBrowser(async (browser) => {
    await withPage(browser, 't1-theme-contrast', async (page) => {
      await page.goto(BASE_URL);
      await page.locator('.step-nav-btn.primary').first().waitFor();
      for (const theme of ['light', 'dark']) {
        await page.evaluate((nextTheme) => document.documentElement.setAttribute('data-theme', nextTheme), theme);
        const colors = await page.evaluate(() => {
          const body = getComputedStyle(document.body);
          const primary = getComputedStyle(document.querySelector('.step-nav-btn.primary'));
          return {
            bodyText: body.color,
            bodyBackground: body.backgroundColor,
            buttonText: primary.color,
            buttonBackground: primary.backgroundColor,
          };
        });
        assert.ok(
          contrastRatio(colors.bodyText, colors.bodyBackground) >= 4.5,
          `${theme} body contrast was below 4.5:1`,
        );
        assert.ok(
          contrastRatio(colors.buttonText, colors.buttonBackground) >= 4.5,
          `${theme} primary button contrast was below 4.5:1`,
        );
      }
    });
  });
});
