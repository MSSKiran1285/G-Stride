import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const outputDir = path.join(root, 'docs', 'product-guides', 'screens');
const baseUrl = process.env.STUDIO_GUIDE_URL ?? 'http://127.0.0.1:4512';

const screens = [
  ['01-automation-overview.png', '/', 'Automation Overview'],
  ['02-control-object-repository.png', '/objects', 'Control Object Repository'],
  ['03-compose-test-library.png', '/compose', 'Compose'],
  ['04-compose-test-editor.png', '/compose/tests/create-po.json', 'Create Purchase Order'],
  ['05-test-data.png', '/data', 'Test Data'],
  ['06-business-processes.png', '/process-suites', 'Processes & Packs'],
  ['07-business-process-editor.png', '/process-suites/po-gr-invoice.json', 'Create PO - GR - Invoice'],
  ['08-regression-packs.png', '/process-suites/packs', 'Processes & Packs'],
  ['09-execution-center.png', '/execute/new', 'Execution Center'],
  ['10-audit-and-evidence.png', '/audit-evidence', 'Audit and Evidence'],
];

await fs.mkdir(outputDir, { recursive: true });
const browser = await chromium.launch({ headless: true });

try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    colorScheme: 'light',
  });
  const page = await context.newPage();

  for (const [file, route] of screens) {
    await page.goto(`${baseUrl}${route}`, { waitUntil: 'networkidle' });
    await page.locator('#main-content').waitFor({ state: 'visible' });
    await page.evaluate(() => {
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let node = walker.nextNode();
      while (node) {
        const value = node.nodeValue ?? '';
        node.nodeValue = value
          .replace(/[a-z0-9.-]+\.s4hana\.cloud\.sap/gi, 'configured-sap-target.example')
          .replace(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi, 'workspace.owner@example.com')
          .replace(/\bkiran\b/gi, 'Workspace owner');
        node = walker.nextNode();
      }
    });
    await page.screenshot({
      path: path.join(outputDir, file),
      fullPage: false,
      animations: 'disabled',
    });
    console.log(`Captured ${file}`);
  }
} finally {
  await browser.close();
}
