import { Command } from 'commander';
import { chromium } from 'playwright';
import { inspectUi5Controls } from '@taf/adapter-fiori';
import { writeFileSync } from 'node:fs';

export function registerInspectCommand(program: Command): void {
  program
    .command('inspect')
    .description('Open a URL and dump discovered UI5 controls as a seed for the object repository')
    .requiredOption('--url <url>', 'URL to open')
    .option('--headless <bool>', 'run headless', 'false')
    .option('--out <path>', 'output JSON path', 'inspect-output.json')
    .action(async (opts) => {
      const browser = await chromium.launch({ headless: opts.headless === 'true' });
      const page = await browser.newPage();
      await page.goto(opts.url, { waitUntil: 'domcontentloaded' });
      console.log('Browser opened. Log in and navigate to the screen you want to capture, then press Enter here...');
      await new Promise<void>((resolve) => process.stdin.once('data', () => resolve()));

      console.log(`Scanning ${page.frames().length} frame(s): ${page.frames().map((f) => f.url()).join(', ')}`);
      const controls = await inspectUi5Controls(page);
      writeFileSync(opts.out, JSON.stringify(controls, null, 2), 'utf-8');
      console.log(`Wrote ${controls.length} discovered controls to ${opts.out}`);

      await browser.close();
    });
}
