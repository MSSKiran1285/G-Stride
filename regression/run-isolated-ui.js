'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { fork, spawn } = require('node:child_process');

const REPO_ROOT = path.resolve(__dirname, '..');

function writeJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function main() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sap-studio-ui-'));
  const testCasesDir = path.join(tempRoot, 'testcases');
  const groupsDir = path.join(tempRoot, 'testgroups');
  const dataDir = path.join(tempRoot, 'data');
  const reportsDir = path.join(tempRoot, 'reports');
  const evidenceArchiveDir = path.join(tempRoot, 'audit-evidence');
  for (const dir of [testCasesDir, groupsDir, dataDir, reportsDir, evidenceArchiveDir]) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // Synthetic fixtures only: no customer data, SAP URLs, credentials, or document numbers.
  writeJson(path.join(testCasesDir, 'cleanup-abandoned-drafts.json'), {
    name: 'Synthetic wait test',
    steps: [{ module: 'Wait', params: { ms: '1' } }],
  });
  writeJson(path.join(groupsDir, 'cleanup-drafts.json'), {
    name: 'Synthetic cleanup group',
    appId: 'syntheticApp',
    testCaseFiles: ['cleanup-abandoned-drafts.json'],
  });
  writeJson(path.join(groupsDir, 'po-gr-invoice.json'), {
    name: 'Synthetic process group',
    appId: 'syntheticApp',
    testCaseFiles: ['cleanup-abandoned-drafts.json'],
  });
  fs.writeFileSync(path.join(dataDir, 'synthetic.csv'), 'value\nexample\n', 'utf8');

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

  const uiTests = [
    path.join('regression', 'ui', 'overview.test.js'),
    path.join('regression', 'ui', 'compose.test.js'),
    path.join('regression', 'ui', 'data-tab.test.js'),
    path.join('regression', 'ui', 'groups-tab.test.js'),
    path.join('regression', 'ui', 'run-tab.test.js'),
    path.join('regression', 'ui', 'audit-library.test.js'),
    path.join('regression', 'ui', 'unsaved-guards.test.js'),
  ];

  try {
    const exitCode = await new Promise((resolve, reject) => {
      const child = spawn(
        process.execPath,
        ['--test', '--test-concurrency=1', ...uiTests],
        {
          cwd: REPO_ROOT,
          env: {
            ...process.env,
            REGRESSION_BASE_URL: baseUrl,
            REGRESSION_ISOLATED: '1',
          },
          stdio: 'inherit',
        },
      );
      child.once('error', reject);
      child.once('exit', (code) => resolve(code ?? 1));
    });
    if (exitCode !== 0) process.exitCode = exitCode;
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
