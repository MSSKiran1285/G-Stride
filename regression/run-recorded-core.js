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
const generated = spawnSync(
  process.execPath,
  [path.join('apps', 'test-operations', 'scripts', 'generate-catalog.mjs')],
  { cwd: repoRoot, stdio: 'inherit' },
);

process.exitCode = testRun.status || recorded.status || generated.status || 0;
