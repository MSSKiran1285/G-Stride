'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, mkdirSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { createStudioServer } = require('../packages/studio-server/dist/server.js');

test('execution APIs require preflight and return no-store security headers plus retention policy', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'qa4hana-release-hardening-'));
  for (const directory of ['testcases', 'testgroups', 'data', 'reports', 'audit-evidence']) {
    mkdirSync(path.join(root, directory), { recursive: true });
  }
  const app = createStudioServer({
    objectDbPath: path.join(root, 'objects.db'),
    documentDbPath: path.join(root, 'documents.db'),
    tagDbPath: path.join(root, 'tags.db'),
    runHistoryDbPath: path.join(root, 'run-history.db'),
    authConfigPath: path.join(root, 'auth.json'),
    governancePath: path.join(root, 'workspace-governance.json'),
    testCasesDir: path.join(root, 'testcases'),
    groupsDir: path.join(root, 'testgroups'),
    dataDir: path.join(root, 'data'),
    reportsDir: path.join(root, 'reports'),
    evidenceArchiveDir: path.join(root, 'audit-evidence'),
    executionEnabled: true,
  });
  const server = app.listen(0, '127.0.0.1');
  try {
    await new Promise((resolve, reject) => {
      server.once('listening', resolve);
      server.once('error', reject);
    });
    const address = server.address();
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const start = await fetch(`${baseUrl}/api/runs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mode: 'suite',
        executionKind: 'regressionPack',
        testCaseFiles: ['synthetic.json'],
        groupFiles: [],
        appId: 'synthetic',
        headless: true,
        sessionPolicy: 'fresh-per-iteration',
        iterationFailurePolicy: 'continue-next-iteration',
      }),
    });
    assert.equal(start.status, 409);
    assert.equal(start.headers.get('cache-control'), 'no-store');
    assert.equal(start.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(start.headers.get('x-powered-by'), null);
    assert.match((await start.json()).error, /preflight is required/i);

    const retention = await fetch(`${baseUrl}/api/execution-retention`);
    assert.equal(retention.status, 200);
    assert.deepEqual(await retention.json(), {
      policy: 'retain-until-workspace-owner-deletes',
      automaticDeletion: false,
      executionSnapshots: 'retained with the Studio run',
      executionEvents: 'retained with the Studio run',
      canonicalEvidence: 'retained in the audit evidence archive',
      rationale: 'Automatic deletion remains disabled until the workspace owner approves and implements a time-based retention period.',
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
    app.locals.closeStudioStores();
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
