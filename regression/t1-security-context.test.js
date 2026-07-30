'use strict';

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, mkdirSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');

process.env.TAF_DISABLE_OS_CREDENTIAL_STORE = '1';
const credentialRoot = mkdtempSync(path.join(tmpdir(), 'qa4hana-t1-credentials-'));
process.env.TAF_CREDENTIAL_STORE_PATH = path.join(credentialRoot, 'credentials.enc.json');
process.env.TAF_CREDENTIAL_KEY_PATH = path.join(credentialRoot, 'credential-key');

const { createStudioServer } = require('../packages/studio-server/dist/server.js');
const {
  executionInitiator,
  executionTargetContext,
} = require('../packages/studio-server/dist/executionContext.js');

after(() => {
  rmSync(credentialRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

function fixtureRoot(prefix) {
  const root = mkdtempSync(path.join(tmpdir(), prefix));
  for (const directory of ['testcases', 'testgroups', 'data', 'reports', 'audit-evidence']) {
    mkdirSync(path.join(root, directory), { recursive: true });
  }
  return root;
}

function createFixtureApp(root, overrides = {}) {
  return createStudioServer({
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
    executionEnabled: false,
    ...overrides,
  });
}

async function listen(app) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  const address = server.address();
  return {
    server,
    baseUrl: `http://127.0.0.1:${address.port}`,
  };
}

async function close(app, server, root) {
  await new Promise((resolve) => server.close(resolve));
  app.locals.closeStudioStores();
  rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}

test('local bootstrap owner can access protected artifacts and safe workspace context', async () => {
  const root = fixtureRoot('qa4hana-t1-bootstrap-');
  const reportPath = path.join(root, 'reports', 'studio', 'run-1');
  const evidencePath = path.join(root, 'audit-evidence', 'evidence-1');
  mkdirSync(reportPath, { recursive: true });
  mkdirSync(evidencePath, { recursive: true });
  writeFileSync(path.join(reportPath, 'report.txt'), 'synthetic report');
  writeFileSync(path.join(evidencePath, 'evidence.pdf'), 'synthetic evidence');
  const app = createFixtureApp(root);
  const { server, baseUrl } = await listen(app);
  try {
    const report = await fetch(`${baseUrl}/reports/studio/run-1/report.txt`);
    assert.equal(report.status, 200);
    assert.equal(report.headers.get('cache-control'), 'private, no-store');
    assert.equal(await report.text(), 'synthetic report');

    const evidence = await fetch(`${baseUrl}/audit-evidence/evidence-1/evidence.pdf`);
    assert.equal(evidence.status, 200);
    assert.equal(evidence.headers.get('cache-control'), 'private, no-store');

    const missing = await fetch(`${baseUrl}/audit-evidence/evidence-1/missing.pdf`);
    assert.equal(missing.status, 404);
    assert.deepEqual(await missing.json(), { error: 'Artifact not found.' });

    const contextResponse = await fetch(`${baseUrl}/api/workspace-context`);
    assert.equal(contextResponse.status, 200);
    const context = await contextResponse.json();
    assert.equal(context.workspaceId, 'single-owner-workspace');
    assert.equal(context.owner.id, 'local-workspace-owner');
    assert.equal(context.target.configured, false);
    assert.equal(context.target.verificationStatus, 'not-configured');
    assert.equal(JSON.stringify(context).includes('password'), false);
    assert.equal(JSON.stringify(context).includes('username'), false);
  } finally {
    await close(app, server, root);
  }
});

test('registered workspace denies anonymous artifact and audit access without revealing existence', async () => {
  const root = fixtureRoot('qa4hana-t1-registered-');
  const evidencePath = path.join(root, 'audit-evidence', 'evidence-1');
  mkdirSync(evidencePath, { recursive: true });
  writeFileSync(path.join(evidencePath, 'evidence.pdf'), 'synthetic evidence');
  writeFileSync(
    path.join(root, 'auth.json'),
    JSON.stringify({
      owner: {
        id: 'google-owner-id',
        provider: 'google',
        name: 'Workspace Owner',
        email: 'owner@example.invalid',
      },
    })
  );
  const app = createFixtureApp(root);
  const { server, baseUrl } = await listen(app);
  try {
    const existing = await fetch(`${baseUrl}/audit-evidence/evidence-1/evidence.pdf`);
    const missing = await fetch(`${baseUrl}/audit-evidence/evidence-1/missing.pdf`);
    assert.equal(existing.status, 401);
    assert.equal(missing.status, 401);
    assert.deepEqual(await existing.json(), await missing.json());

    assert.equal((await fetch(`${baseUrl}/reports/studio/run-1/report.txt`)).status, 401);
    assert.equal((await fetch(`${baseUrl}/api/audit/runs`)).status, 401);
    assert.equal((await fetch(`${baseUrl}/api/workspace-context`)).status, 401);
    // BL-037: the global search endpoint spans every artifact kind, so it must sit behind
    // the same blanket auth gate as everything else rather than a bespoke check of its own.
    assert.equal((await fetch(`${baseUrl}/api/search?q=test`)).status, 401);
  } finally {
    await close(app, server, root);
  }
});

test('execution context captures owner and non-secret target metadata', () => {
  const initiator = executionInitiator({
    id: 'google-owner-id',
    provider: 'google',
    name: 'Workspace Owner',
    email: 'owner@example.invalid',
    picture: 'https://example.invalid/photo',
  });
  assert.deepEqual(initiator, {
    id: 'google-owner-id',
    provider: 'google',
    name: 'Workspace Owner',
    email: 'owner@example.invalid',
  });

  const context = executionTargetContext({
    configured: true,
    url: 'https://user:secret@example.invalid/sap/path?token=hidden',
    username: 'private-user',
    source: 'credential-store',
  }, '2026-07-29T10:00:00.000Z');
  assert.equal(context.hostname, 'example.invalid');
  assert.equal(context.origin, 'https://example.invalid');
  assert.equal(context.verificationStatus, 'saved-not-live-verified');
  assert.equal(context.safetyClass, 'unknown');
  assert.equal(JSON.stringify(context).includes('secret'), false);
  assert.equal(JSON.stringify(context).includes('private-user'), false);
});

test('owner classifies and safely verifies SAP without returning credentials', async () => {
  const root = fixtureRoot('qa4hana-t1-verification-');
  const verifiedAt = new Date().toISOString();
  const app = createFixtureApp(root, {
    verifySap: async (credentials) => {
      assert.equal(credentials.url, 'https://example.invalid/');
      assert.equal(credentials.username, 'verification-user');
      assert.equal(credentials.password, 'verification-secret');
      return {
        verified: true,
        verifiedAt,
        message: 'Synthetic non-transactional verification passed.',
      };
    },
  });
  const { server, baseUrl } = await listen(app);
  try {
    const saved = await fetch(`${baseUrl}/api/settings/integrations/sap`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: 'https://example.invalid',
        username: 'verification-user',
        password: 'verification-secret',
        safetyClass: 'non-production',
      }),
    });
    assert.equal(saved.status, 200);
    const savedBody = await saved.json();
    assert.equal(savedBody.safetyClass, 'non-production');
    assert.equal(savedBody.verificationStatus, 'saved-not-live-verified');
    assert.equal(JSON.stringify(savedBody).includes('verification-secret'), false);

    const verified = await fetch(`${baseUrl}/api/settings/integrations/sap/verify`, { method: 'POST' });
    assert.equal(verified.status, 200);
    const verifiedBody = await verified.json();
    assert.equal(verifiedBody.target.verificationStatus, 'live-verified');
    assert.equal(verifiedBody.target.verifiedAt, verifiedAt);

    const context = await (await fetch(`${baseUrl}/api/workspace-context`)).json();
    assert.equal(context.target.safetyClass, 'non-production');
    assert.equal(context.target.verificationStatus, 'live-verified');
    assert.equal(JSON.stringify(context).includes('verification-user'), false);
  } finally {
    await close(app, server, root);
  }
});

test('evidence governance exposes retention and enforced redaction without secrets', async () => {
  const root = fixtureRoot('qa4hana-t1-governance-');
  const app = createFixtureApp(root);
  const { server, baseUrl } = await listen(app);
  try {
    const response = await fetch(`${baseUrl}/api/evidence-governance`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      retentionPolicy: 'retain-until-workspace-owner-deletes',
      automaticDeletion: false,
      executionSnapshots: 'retained with the Studio run',
      executionEvents: 'retained with the Studio run',
      canonicalEvidence: 'retained in the audit evidence archive',
      redaction: {
        status: 'enforced',
        credentials: 'excluded',
        executionLogs: 'filtered',
        evidenceValues: 'policy-controlled',
      },
      rationale: 'Automatic deletion remains disabled until the workspace owner approves and implements a time-based retention period.',
    });
  } finally {
    await close(app, server, root);
  }
});
