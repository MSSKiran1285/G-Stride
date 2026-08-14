'use strict';

/**
 * Raises a throwaway Studio for a HUMAN timed run of the 16-step Sales Order build.
 *
 * Why not just author in the real Studio on :3000 — two reasons:
 *   1. Nothing you do here can touch testcases/, the object repository, or the tag store.
 *      The workspace is a temp directory that is deleted when you Ctrl+C.
 *   2. Comparability. It is seeded with exactly what compose-authoring-timing.js measured
 *      against — the 12 captured createSalesOrder controls and the real o2c-e2e.csv columns
 *      — so your observed time can be put next to the recorded floor without an asterisk.
 *
 * Usage:
 *   node regression/compose-timing-stage.js
 *
 * Leave it running, author in the browser, then Ctrl+C. It prints the Test it found on the
 * way out so the result is not lost with the temp directory.
 */

const fs = require('node:fs');
const path = require('node:path');
const { seedWorkspace, startServer } = require('./compose-authoring-timing');

const REPO_ROOT = path.resolve(__dirname, '..');

async function main() {
  const tempRoot = seedWorkspace();
  const { child, url } = startServer(tempRoot);
  const baseUrl = await url;

  console.log('');
  console.log('='.repeat(72));
  console.log('  COMPOSE TIMED RUN — staged workspace ready');
  console.log('='.repeat(72));
  console.log('');
  console.log(`  Author here:  ${baseUrl}`);
  console.log('');
  console.log('  Seeded with:  12 createSalesOrder controls, o2c-e2e.csv (9 columns)');
  console.log('  Isolated:     your real testcases/ and object repository are untouched');
  console.log('');
  console.log('  Recorded floor to beat (modelled, expert, error-free):');
  console.log('    scratch    162 interactions   6m 53s');
  console.log('    duplicate  153 interactions   6m 27s');
  console.log('');
  console.log('  Start the clock when you click "Compose New Test".');
  console.log('  Stop it when "Saved at" appears.');
  console.log('');
  console.log('  Ctrl+C when done — the authored Test is printed before cleanup.');
  console.log('');

  const shutdown = () => {
    const dir = path.join(tempRoot, 'testcases');
    console.log('\n' + '='.repeat(72));
    try {
      const files = fs.readdirSync(dir);
      if (files.length === 0) {
        console.log('  No Test was saved.');
      } else {
        for (const f of files) {
          const parsed = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
          console.log(`  ${f} — ${parsed.steps?.length ?? 0} steps`);
          const out = path.join(REPO_ROOT, 'regression', 'results', 'compose-timing', `observed-${f}`);
          fs.mkdirSync(path.dirname(out), { recursive: true });
          fs.copyFileSync(path.join(dir, f), out);
          console.log(`    saved to ${path.relative(REPO_ROOT, out)}`);
        }
      }
    } catch (error) {
      console.log(`  Could not read the staged testcases dir: ${error.message}`);
    }
    console.log('='.repeat(72) + '\n');

    child.kill('SIGTERM');
    setTimeout(() => {
      try {
        fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
      } catch {
        console.log(`  (temp workspace left at ${tempRoot})`);
      }
      process.exit(0);
    }, 1200);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
