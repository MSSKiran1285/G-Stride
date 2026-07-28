'use strict';

const { chromium } = require('playwright');
const path = require('node:path');
const fs = require('node:fs');

const ARTIFACTS_DIR = path.join(__dirname, '..', '.artifacts');

async function withBrowser(fn) {
  const browser = await chromium.launch();
  try {
    await fn(browser);
  } finally {
    await browser.close();
  }
}

/**
 * Opens a page, runs fn(page), and fails the test if ANY uncaught error was thrown
 * during rendering — even if fn()'s own assertions all passed. This is what turns
 * every UI test in the pack into an implicit regression check for the blank-page-
 * class of bug (an unhandled render exception unmounting the whole tree), not just
 * one dedicated test for the one historical incident.
 */
async function withPage(browser, testName, fn) {
  const page = await browser.newPage();
  const pageErrors = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));

  try {
    await fn(page);
  } catch (err) {
    fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });
    const shotPath = path.join(ARTIFACTS_DIR, `${testName.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.png`);
    await page.screenshot({ path: shotPath, fullPage: true }).catch(() => undefined);
    throw err;
  } finally {
    await page.close();
  }

  if (pageErrors.length > 0) {
    throw new Error(`"${testName}" threw ${pageErrors.length} uncaught browser error(s):\n${pageErrors.join('\n')}`);
  }
}

module.exports = { withBrowser, withPage };
