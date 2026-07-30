'use strict';

const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const { api, assertServerReachable } = require('../lib/apiClient');

before(assertServerReachable);

const validPack = {
  version: 1,
  name: 'Quarterly Regression',
  description: 'Independent synthetic smoke coverage.',
  lifecycle: 'draft',
  members: [
    {
      id: 'cleanup-test',
      kind: 'test',
      file: 'cleanup-abandoned-drafts.json',
      appId: 'syntheticApp',
      dataFile: 'synthetic.csv',
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
};

test('GET /api/packs lists the published isolated Pack fixture', async () => {
  const { status, body } = await api.get('/api/packs');
  assert.equal(status, 200);
  assert.deepEqual(body, ['published-mixed-pack.json']);
});

test('PUT then GET /api/packs/:file persists independent member bindings', async () => {
  const put = await api.put('/api/packs/quarterly-regression.json', validPack);
  assert.equal(put.status, 200);
  assert.deepEqual(put.body, { ok: true });

  const get = await api.get('/api/packs/quarterly-regression.json');
  assert.equal(get.status, 200);
  assert.deepEqual(get.body, validPack);

  const list = await api.get('/api/packs');
  assert.deepEqual(list.body, ['published-mixed-pack.json', 'quarterly-regression.json']);
});

test('PUT /api/packs/:file rejects duplicate member IDs', async () => {
  const duplicate = {
    ...validPack,
    members: validPack.members.map((member) => ({ ...member, id: 'duplicate' })),
  };
  const { status, body } = await api.put('/api/packs/invalid-duplicate.json', duplicate);
  assert.equal(status, 400);
  assert.match(body.error, /uniquely identified/i);
});

test('PUT /api/packs/:file rejects sequential or unknown member types', async () => {
  const invalid = {
    ...validPack,
    members: [{ ...validPack.members[0], kind: 'chain' }],
  };
  const { status } = await api.put('/api/packs/invalid-kind.json', invalid);
  assert.equal(status, 400);
});

test('PUT /api/packs/:file rejects incompatible Test session policies', async () => {
  const invalid = {
    ...validPack,
    members: [{ ...validPack.members[0], sessionPolicy: 'reuse-within-process' }],
  };
  const { status, body } = await api.put('/api/packs/invalid-test-session.json', invalid);
  assert.equal(status, 400);
  assert.match(body.error, /cannot reuse a Process session/i);
});

test('PUT /api/packs/:file rejects orphaned artifact and data references', async () => {
  const missingArtifact = {
    ...validPack,
    members: [{ ...validPack.members[0], file: 'not-found.json' }],
  };
  const artifactResult = await api.put('/api/packs/invalid-artifact.json', missingArtifact);
  assert.equal(artifactResult.status, 400);
  assert.match(artifactResult.body.error, /missing test artifact/i);

  const missingData = {
    ...validPack,
    members: [{ ...validPack.members[0], dataFile: 'not-found.csv' }],
  };
  const dataResult = await api.put('/api/packs/invalid-data.json', missingData);
  assert.equal(dataResult.status, 400);
  assert.match(dataResult.body.error, /missing dataset/i);
});

test('GET /api/packs/:file rejects traversal and missing artifacts safely', async () => {
  const traversal = await api.get('/api/packs/%2e%2e%2fpackage.json');
  assert.equal(traversal.status, 400);
  const missing = await api.get('/api/packs/not-found.json');
  assert.equal(missing.status, 404);
});
