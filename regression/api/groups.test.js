'use strict';

const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const { api, assertServerReachable } = require('../lib/apiClient');

before(assertServerReachable);

test('GET /api/groups lists known fixtures', async () => {
  const { status, body } = await api.get('/api/groups');
  assert.equal(status, 200);
  assert.ok(Array.isArray(body));
  assert.ok(body.includes('cleanup-drafts.json'));
  assert.ok(body.includes('po-gr-invoice.json'));
});

test('GET /api/groups/:file returns the parsed group', async () => {
  const { status, body } = await api.get('/api/groups/cleanup-drafts.json');
  assert.equal(status, 200);
  assert.equal(body.name, 'Cleanup Drafts');
  assert.equal(body.appId, 'createPurchaseOrder');
  assert.deepEqual(body.testCaseFiles, ['cleanup-abandoned-drafts.json']);
});

test('GET /api/groups/:file 404s for an unknown file', async () => {
  const { status } = await api.get('/api/groups/does-not-exist.json');
  assert.equal(status, 404);
});

test('PUT /api/groups/:file rejects an empty testCaseFiles array', async () => {
  const { status } = await api.put('/api/groups/regression-invalid.json', {
    name: 'Invalid',
    appId: 'createPurchaseOrder',
    testCaseFiles: [],
  });
  assert.equal(status, 400);
});

test('PUT /api/groups/:file rejects a missing appId', async () => {
  const { status } = await api.put('/api/groups/regression-invalid.json', {
    name: 'Invalid',
    testCaseFiles: ['cleanup-abandoned-drafts.json'],
  });
  assert.equal(status, 400);
});

test('PUT then GET /api/groups/:file round-trips (Groups positive)', async () => {
  const group = {
    name: 'Regression Sample Group',
    appId: 'createPurchaseOrder',
    testCaseFiles: ['cleanup-abandoned-drafts.json'],
  };
  const put = await api.put('/api/groups/regression-sample-group.json', group);
  assert.equal(put.status, 200);
  assert.deepEqual(put.body, { ok: true });

  const get = await api.get('/api/groups/regression-sample-group.json');
  assert.equal(get.status, 200);
  assert.deepEqual(get.body, group);
});
