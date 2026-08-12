/**
 * Diagnoses why "Open scan session" launches no browser in one environment but works in another.
 *
 * Run it from the SAME place you start the server. If you start the server from Google
 * Antigravity's terminal, run this from that terminal - the whole point is that it inherits the
 * identical environment, because that environment is the variable, not the code:
 *
 *   node scripts/diagnose-scan-browser.mjs
 *
 * It reproduces exactly what scanSession.ts does (chromium.launch({ headless: false })) and
 * reports what actually happened, rather than leaving a silent failure behind a button.
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';

const line = (k, v) => console.log(`  ${String(k).padEnd(26)} ${v}`);
const section = (t) => console.log(`\n=== ${t} ===`);

section('runtime');
line('platform', `${process.platform} ${process.arch}`);
line('node', process.version);
line('cwd', process.cwd());
line('os release', os.release());

// A headed browser needs a real desktop session. A process launched as a service, inside a
// container, or under WSL without an X server can call launch() and still show nobody a window.
section('is there a desktop to draw on?');
const isWsl = Boolean(process.env.WSL_DISTRO_NAME) || /microsoft/i.test(os.release());
line('WSL_DISTRO_NAME', process.env.WSL_DISTRO_NAME ?? '(unset)');
line('looks like WSL', isWsl ? 'YES - a Windows-side window will NOT appear from here' : 'no');
line('DISPLAY', process.env.DISPLAY ?? '(unset)');
line('SESSIONNAME', process.env.SESSIONNAME ?? '(unset - often means no interactive desktop)');
line('in container', fs.existsSync('/.dockerenv') ? 'YES' : 'no');

// These are the environment variables that most often silently change Playwright's behaviour.
section('environment that affects playwright');
for (const k of [
  'CI',
  'PLAYWRIGHT_BROWSERS_PATH',
  'PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD',
  'PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH',
  'PW_TEST_CONNECT_WS_ENDPOINT',
  'HEADLESS',
  'NODE_OPTIONS',
  'PORT',
]) {
  line(k, process.env[k] ?? '(unset)');
}

section('browser binary');
let exe = null;
try {
  exe = chromium.executablePath();
  line('executablePath', exe);
  line('exists on disk', fs.existsSync(exe) ? 'PRESENT' : 'MISSING - run: npx playwright install chromium');
} catch (e) {
  line('executablePath', `ERROR: ${e.message}`);
}

// Headless proves the binary and permissions are fine. If this passes and headed fails, the
// problem is the desktop session, not Playwright.
section('launch test 1 of 2 - headless');
try {
  const b = await chromium.launch({ headless: true });
  line('result', 'OK');
  await b.close();
} catch (e) {
  line('result', `FAILED: ${e.message.split('\n')[0]}`);
}

section('launch test 2 of 2 - headed, exactly as the scan session does');
try {
  const b = await chromium.launch({ headless: false, args: ['--start-maximized'] });
  const ctx = await b.newContext({ viewport: null });
  const page = await ctx.newPage();
  await page.goto('about:blank');
  line('result', 'OK - a Chrome window should be visible NOW');
  console.log('\n  Look at your screen. Is a Chrome window actually visible?');
  console.log('  - visible      -> the browser works here; the problem is elsewhere');
  console.log('  - NOT visible  -> this process has no desktop session (service/WSL/container)');
  await new Promise((r) => setTimeout(r, 12000));
  await b.close();
} catch (e) {
  line('result', `FAILED: ${e.message.split('\n').slice(0, 4).join(' | ')}`);
}

console.log('\nDone. Compare this output against the same script run from a normal terminal.');
