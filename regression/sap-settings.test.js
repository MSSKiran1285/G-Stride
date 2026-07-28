'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, mkdirSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');

test('SAP Settings saves encrypted credentials and exposes only non-secret status', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'qa4hana-sap-settings-'));
  process.env.TAF_DISABLE_OS_CREDENTIAL_STORE = '1';
  process.env.TAF_CREDENTIAL_STORE_PATH = path.join(root, 'credentials.enc.json');
  process.env.TAF_CREDENTIAL_KEY_PATH = path.join(root, 'credential-key');

  const { createStudioServer } = require('../packages/studio-server/dist/server.js');
  const { getCredentials } = require('../packages/core/dist');
  for (const directory of ['testcases', 'testgroups', 'data', 'reports', 'audit-evidence']) {
    mkdirSync(path.join(root, directory), { recursive: true });
  }

  const app = createStudioServer({
    objectDbPath: path.join(root, 'objects.db'),
    documentDbPath: path.join(root, 'documents.db'),
    tagDbPath: path.join(root, 'tags.db'),
    runHistoryDbPath: path.join(root, 'run-history.db'),
    authConfigPath: path.join(root, 'auth.json'),
    webDistPath: path.resolve(__dirname, '../packages/studio-web/dist'),
    testCasesDir: path.join(root, 'testcases'),
    groupsDir: path.join(root, 'testgroups'),
    dataDir: path.join(root, 'data'),
    reportsDir: path.join(root, 'reports'),
    evidenceArchiveDir: path.join(root, 'audit-evidence'),
    executionEnabled: false,
  });
  const server = app.listen(0, '127.0.0.1');

  try {
    await new Promise((resolve, reject) => {
      server.once('listening', resolve);
      server.once('error', reject);
    });
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    const baseUrl = `http://127.0.0.1:${address.port}`;

    const response = await fetch(`${baseUrl}/api/settings/integrations/sap`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: 'https://example.invalid',
        username: 'tester@example.com',
        password: 'synthetic-secret',
      }),
    });
    assert.equal(response.status, 200);
    const status = await response.json();
    assert.equal(status.configured, true);
    assert.equal(status.username, 'tester@example.com');
    assert.equal(Object.hasOwn(status, 'password'), false);

    const credentials = await getCredentials('default');
    assert.equal(credentials.url, 'https://example.invalid/');
    assert.equal(credentials.username, 'tester@example.com');
    assert.equal(credentials.password, 'synthetic-secret');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    app.locals.closeStudioStores();
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
