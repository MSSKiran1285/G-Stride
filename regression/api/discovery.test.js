'use strict';

const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const { api, assertServerReachable } = require('../lib/apiClient');

before(assertServerReachable);

test('POST /api/discovery/:appId/start requires a non-empty instruction in the body', async () => {
  const empty = await api.post('/api/discovery/regressionDiscoveryApp/start', {});
  assert.equal(empty.status, 400);
  assert.match(empty.body.error, /instruction/);

  const blank = await api.post('/api/discovery/regressionDiscoveryApp/start', { instruction: '   ' });
  assert.equal(blank.status, 400);
  assert.match(blank.body.error, /instruction/);
});

test('POST /api/discovery/:appId/start requires an open scan session (BL-047 Phase 2)', async () => {
  const res = await api.post('/api/discovery/regressionDiscoveryApp/start', { instruction: 'Create a purchase requisition' });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /No active scan session/);
});

test('GET /api/discovery/state reports inactive when no discovery run has been started', async () => {
  const res = await api.get('/api/discovery/state');
  assert.equal(res.status, 200);
  assert.equal(res.body.active, false);
});

test('POST /api/discovery/step requires a discovery run to already be in progress', async () => {
  const res = await api.post('/api/discovery/step', {});
  assert.equal(res.status, 400);
  assert.match(res.body.error, /No discovery run in progress/);
});

test('POST /api/discovery/stop is always safe to call, even with nothing running', async () => {
  const res = await api.post('/api/discovery/stop', {});
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { ok: true });
});
