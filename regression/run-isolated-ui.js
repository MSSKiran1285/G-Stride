'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { fork, spawn, spawnSync } = require('node:child_process');

const REPO_ROOT = path.resolve(__dirname, '..');

function writeJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function main() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sap-studio-ui-'));
  const testCasesDir = path.join(tempRoot, 'testcases');
  const groupsDir = path.join(tempRoot, 'testgroups');
  const packsDir = path.join(tempRoot, 'testpacks');
  const dataDir = path.join(tempRoot, 'data');
  const reportsDir = path.join(tempRoot, 'reports');
  const evidenceArchiveDir = path.join(tempRoot, 'audit-evidence');
  for (const dir of [testCasesDir, groupsDir, packsDir, dataDir, reportsDir, evidenceArchiveDir]) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // Synthetic fixtures only: no customer data, SAP URLs, credentials, or document numbers.
  writeJson(path.join(testCasesDir, 'cleanup-abandoned-drafts.json'), {
    name: 'Synthetic wait test',
    steps: [{ module: 'Wait', params: { ms: '1' } }],
  });
  writeJson(path.join(testCasesDir, 'synthetic-second-stage.json'), {
    name: 'Synthetic second stage',
    steps: [{ module: 'Wait', params: { ms: '1' } }],
  });
  // Starting a Chain/Suite with exactly this file name deterministically fails via
  // synthetic-run-service.js's FORCE_FAIL_FILE sentinel — its content is never read by the
  // synthetic service (only its file name matters), so its own steps are unreachable filler.
  writeJson(path.join(testCasesDir, 'regression-force-fail.json'), {
    name: 'Regression Force Fail',
    steps: [{ module: 'Wait', params: { ms: '1' } }],
  });
  writeJson(path.join(testCasesDir, 'contract-producer.json'), {
    name: 'Contract Producer',
    contract: {
      version: 1,
      inputs: [],
      outputs: [{ name: 'documentId', type: 'string' }],
    },
    steps: [{ module: 'Wait', params: { ms: '1' } }],
  });
  writeJson(path.join(testCasesDir, 'contract-consumer.json'), {
    name: 'Contract Consumer',
    contract: {
      version: 1,
      inputs: [{ name: 'documentId', type: 'string', required: true, sensitivity: 'business' }],
      outputs: [],
    },
    steps: [{ module: 'Wait', params: { ms: '1' } }],
  });
  writeJson(path.join(testCasesDir, 'create-po.json'), {
    name: 'Create Purchase Order - Happy Path',
    steps: [{ module: 'Wait', params: { ms: '1' } }],
  });
  writeJson(path.join(testCasesDir, 'route-mapped.json'), {
    name: 'Route correction test',
    steps: [{ module: 'Wait', params: { ms: '${missingValue}' } }],
  });
  writeJson(path.join(groupsDir, 'cleanup-drafts.json'), {
    name: 'Cleanup Drafts',
    appId: 'syntheticApp',
    testCaseFiles: ['cleanup-abandoned-drafts.json'],
  });
  writeJson(path.join(groupsDir, 'po-gr-invoice.json'), {
    name: 'Create PO - GR - Invoice',
    appId: 'createPurchaseOrder',
    testCaseFiles: ['create-po.json', 'post-goods-receipt.json', 'post-supplier-invoice.json'],
  });
  writeJson(path.join(groupsDir, 'synthetic-process.json'), {
    name: 'Synthetic Process',
    appId: 'syntheticApp',
    testCaseFiles: ['cleanup-abandoned-drafts.json', 'synthetic-second-stage.json'],
  });
  writeJson(path.join(groupsDir, 'o2c-e2e.json'), {
    name: 'Synthetic O2C process group',
    appId: 'syntheticApp',
    testCaseFiles: ['cleanup-abandoned-drafts.json'],
  });
  writeJson(path.join(packsDir, 'published-mixed-pack.json'), {
    version: 1,
    name: 'Published Mixed Pack',
    description: 'Synthetic Test and Business Process members.',
    lifecycle: 'published',
    members: [
      {
        id: 'cleanup-test',
        kind: 'test',
        file: 'cleanup-abandoned-drafts.json',
        appId: 'syntheticApp',
        sessionPolicy: 'fresh-per-iteration',
        iterationFailurePolicy: 'continue-next-iteration',
      },
      {
        id: 'synthetic-process',
        kind: 'process',
        file: 'synthetic-process.json',
        sessionPolicy: 'fresh-per-iteration',
        iterationFailurePolicy: 'stop-execution',
      },
    ],
  });
  fs.writeFileSync(path.join(dataDir, 'synthetic.csv'), 'value\nexample\n', 'utf8');
  fs.writeFileSync(path.join(dataDir, 'p2p-e2e.csv'), 'supplier\n10000001\n', 'utf8');

  const { ObjectRepository, RunHistoryStore } = require('../packages/core/dist');
  const objectRepository = new ObjectRepository(path.join(tempRoot, 'objects.db'));
  objectRepository.upsert({
    appId: 'routeApp',
    name: 'SubmitButton',
    controlId: 'route-submit',
    controlType: 'sap.m.Button',
    bindingPath: undefined,
    tableId: undefined,
    label: 'Submit',
    parentControlId: undefined,
  });
  objectRepository.close();

  const routeEvidenceDir = path.join(evidenceArchiveDir, 'route-audit-run');
  fs.mkdirSync(routeEvidenceDir, { recursive: true });
  fs.writeFileSync(path.join(routeEvidenceDir, 'evidence.pdf'), 'synthetic route evidence', 'utf8');
  const runHistory = new RunHistoryStore(path.join(tempRoot, 'run-history.db'));
  runHistory.record({
    id: 'route-audit-run',
    startedAt: '2026-07-29T08:00:00.000Z',
    finishedAt: '2026-07-29T08:00:01.000Z',
    status: 'passed',
    executedBy: 'route-owner@example.invalid',
    mode: 'chain',
    appId: 'routeApp',
    testCaseNames: ['Stable Route Test'],
    dataFile: 'synthetic.csv',
    result: { status: 'passed' },
    evidencePdfPath: path.join('audit-evidence', 'route-audit-run', 'evidence.pdf'),
  });
  runHistory.close();

  const serverChild = fork(
    path.join(__dirname, 'isolated-studio-server.js'),
    [],
    {
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        ISOLATED_STUDIO_ROOT: tempRoot,
        ISOLATED_STUDIO_WEB_DIST: path.join(REPO_ROOT, 'packages', 'studio-web', 'dist'),
        TAF_DISABLE_OS_CREDENTIAL_STORE: '1',
        TAF_CREDENTIAL_STORE_PATH: path.join(tempRoot, 'credentials.enc.json'),
        TAF_CREDENTIAL_KEY_PATH: path.join(tempRoot, 'credential-key'),
      },
      stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
    },
  );
  const baseUrl = await new Promise((resolve, reject) => {
    serverChild.once('error', reject);
    serverChild.once('exit', (code) => reject(new Error(`Isolated Studio server exited before startup (${code ?? 'unknown'}).`)));
    serverChild.once('message', (message) => {
      if (message && typeof message.url === 'string') resolve(message.url);
      else reject(new Error('Isolated Studio server sent an invalid startup message.'));
    });
  });
  const savedTarget = await fetch(`${baseUrl}/api/settings/integrations/sap`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      url: 'https://synthetic.non-production.invalid',
      username: 'isolated-execution-user',
      password: 'isolated-execution-secret',
      safetyClass: 'non-production',
    }),
  });
  if (!savedTarget.ok) {
    throw new Error(`Could not configure the isolated synthetic target: ${await savedTarget.text()}`);
  }
  const verifiedTarget = await fetch(`${baseUrl}/api/settings/integrations/sap/verify`, { method: 'POST' });
  if (!verifiedTarget.ok) {
    throw new Error(`Could not verify the isolated synthetic target: ${await verifiedTarget.text()}`);
  }

  const allUiTests = [
    path.join('regression', 'ui', 'overview.test.js'),
    path.join('regression', 'ui', 'compose.test.js'),
    path.join('regression', 'ui', 'test-library.test.js'),
    path.join('regression', 'ui', 'typed-test-authoring.test.js'),
    path.join('regression', 'ui', 'data-tab.test.js'),
    path.join('regression', 'ui', 'groups-tab.test.js'),
    path.join('regression', 'ui', 'packs-tab.test.js'),
    path.join('regression', 'ui', 'stable-routes.test.js'),
    path.join('regression', 'ui', 'run-tab.test.js'),
    path.join('regression', 'ui', 'audit-library.test.js'),
    path.join('regression', 'ui', 'unsaved-guards.test.js'),
    path.join('regression', 'ui', 't1-foundations.test.js'),
    path.join('regression', 'ui', 'accessibility.test.js'),
  ];
  const requestedFiles = new Set(process.argv.slice(2));
  const uiTests = requestedFiles.size === 0
    ? allUiTests
    : allUiTests.filter((file) => requestedFiles.has(path.basename(file)));
  if (uiTests.length === 0) {
    throw new Error(`No UI test files matched: ${[...requestedFiles].join(', ')}`);
  }

  try {
    const exitCode = await new Promise((resolve, reject) => {
      const child = spawn(
        process.execPath,
        [
          '--test',
          '--test-concurrency=1',
          ...(process.env.REGRESSION_RESULT_FILE
            ? ['--test-reporter=./regression/reporters/result-capture.js']
            : []),
          ...uiTests,
        ],
        {
          cwd: REPO_ROOT,
          env: {
            ...process.env,
            REGRESSION_BASE_URL: baseUrl,
            REGRESSION_ISOLATED: '1',
            // Lets a regression test seed the audit ledger directly (there is no HTTP write
            // path into it) and then exercise the isolated server's own Audit and Evidence UI
            // against those exact rows.
            REGRESSION_RUN_HISTORY_DB: path.join(tempRoot, 'run-history.db'),
            REGRESSION_DOCUMENT_LOG_DB: path.join(tempRoot, 'documents.db'),
          },
          stdio: 'inherit',
        },
      );
      child.once('error', reject);
      child.once('exit', (code) => resolve(code ?? 1));
    });
    if (exitCode !== 0) process.exitCode = exitCode;
    if (process.env.REGRESSION_RESULT_FILE) {
      const recorded = spawnSync(
        process.execPath,
        [
          path.join('regression', 'record-quality-run.mjs'),
          '--input',
          path.relative(REPO_ROOT, process.env.REGRESSION_RESULT_FILE),
        ],
        { cwd: REPO_ROOT, stdio: 'inherit' },
      );
      if (recorded.status !== 0) process.exitCode = recorded.status ?? 1;
      const generated = spawnSync(
        process.execPath,
        [path.join('apps', 'test-operations', 'scripts', 'generate-catalog.mjs')],
        { cwd: REPO_ROOT, stdio: 'inherit' },
      );
      if (generated.status !== 0) process.exitCode = generated.status ?? 1;
    }
  } finally {
    if (serverChild.exitCode === null) {
      serverChild.kill();
      await new Promise((resolve) => serverChild.once('exit', resolve));
    }
    fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
