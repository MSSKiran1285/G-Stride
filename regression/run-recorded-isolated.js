'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const repoRoot = path.resolve(__dirname, '..');
const rawRoot = path.join(__dirname, 'results', 'raw');
const kind = process.argv[2];
const configurations = {
  api: {
    script: path.join('regression', 'run-isolated-api.js'),
    label: 'Isolated API regression',
    mode: 'API',
    idPrefix: 'ISOLATED-API',
  },
  ui: {
    script: path.join('regression', 'run-isolated-ui.js'),
    label: 'Isolated UI regression',
    mode: 'Headless UI',
    idPrefix: 'ISOLATED-UI',
  },
};
const configuration = configurations[kind];

if (!configuration) {
  console.error('Usage: node regression/run-recorded-isolated.js <api|ui>');
  process.exit(1);
}

fs.mkdirSync(rawRoot, { recursive: true });
const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const resultFile = process.env.REGRESSION_RESULT_FILE
  || path.join(rawRoot, `${kind}-${timestamp}.ndjson`);
const runId = process.env.REGRESSION_RUN_ID
  || `${configuration.idPrefix}-${timestamp}`;

const run = spawnSync(
  process.execPath,
  [configuration.script],
  {
    cwd: repoRoot,
    env: {
      ...process.env,
      REGRESSION_RESULT_FILE: resultFile,
      REGRESSION_RUN_ID: runId,
      REGRESSION_RUN_LABEL: process.env.REGRESSION_RUN_LABEL || configuration.label,
      REGRESSION_RUN_MODE: process.env.REGRESSION_RUN_MODE || configuration.mode,
      REGRESSION_TARGET_CLASS: process.env.REGRESSION_TARGET_CLASS || 'Isolated',
    },
    stdio: 'inherit',
  },
);

process.exitCode = run.status ?? 1;
