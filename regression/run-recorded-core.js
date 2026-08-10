'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const repoRoot = path.resolve(__dirname, '..');
const rawRoot = path.join(__dirname, 'results', 'raw');
fs.mkdirSync(rawRoot, { recursive: true });
const resultFile = process.env.REGRESSION_RESULT_FILE
  || path.join(rawRoot, `core-${new Date().toISOString().replace(/[:.]/g, '-')}.ndjson`);
const testFiles = fs.readdirSync(__dirname)
  .filter((file) => file.endsWith('.test.js'))
  .sort()
  .map((file) => path.join('regression', file));
const runId = process.env.REGRESSION_RUN_ID
  || `CORE-${new Date().toISOString().replace(/[:.]/g, '-')}`;

const catalogScript = path.join('apps', 'test-operations', 'scripts', 'generate-catalog.mjs');
const generateCatalog = () => spawnSync(process.execPath, [catalogScript], { cwd: repoRoot, stdio: 'inherit' });

// The catalogue has to be regenerated BEFORE the suite as well as after it, because one of the
// tests in the suite (quality-catalog.test.js) asserts that the committed test-catalog.json
// matches a fresh scan of the test sources. Generating it only afterwards meant that suite was
// always checking the PREVIOUS run's catalogue: any commit that added, renamed or removed a test
// failed on its first run and passed on the second, having regenerated the file in between.
// That is an ordering bug, not a flaky test, and it repeatedly produced false failures in
// release evidence — the kind of noise that trains people to re-run rather than read a failure.
//
// Running it twice is correct rather than redundant: this pass fixes the inventory half (which
// depends only on the test sources, and is what a test-name change breaks), and the pass after
// the run fixes the status half (which depends on results that do not exist yet at this point).
const preGenerated = generateCatalog();

const testRun = spawnSync(
  process.execPath,
  [
    '--test',
    '--test-concurrency=1',
    '--test-reporter=./regression/reporters/result-capture.js',
    ...testFiles,
  ],
  {
    cwd: repoRoot,
    env: {
      ...process.env,
      REGRESSION_RESULT_FILE: resultFile,
      REGRESSION_RUN_ID: runId,
      REGRESSION_RUN_LABEL: process.env.REGRESSION_RUN_LABEL || 'Core regression',
      REGRESSION_RUN_MODE: process.env.REGRESSION_RUN_MODE || 'Unit / Integration',
      REGRESSION_TARGET_CLASS: process.env.REGRESSION_TARGET_CLASS || 'Isolated',
    },
    stdio: 'inherit',
  },
);

const recorded = spawnSync(
  process.execPath,
  [
    path.join('regression', 'record-quality-run.mjs'),
    '--input',
    path.relative(repoRoot, resultFile),
  ],
  { cwd: repoRoot, stdio: 'inherit' },
);
const generated = generateCatalog();

process.exitCode = preGenerated.status || testRun.status || recorded.status || generated.status || 0;
