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
  assert.equal(res.body.ok, true);
  assert.equal(res.body.stillRunning, false);
});

// The autonomous loop the owner asked for on 4 Aug 2026 ("If I am going to sit there and click
// run next step, I might as well add the controls myself, where is the AI here?"). It answers
// straight away and keeps going in the background, so the guard it must get right is refusing to
// start at all when there is nothing to run.
test('POST /api/discovery/run requires a discovery run to already be in progress', async () => {
  const res = await api.post('/api/discovery/run', {});
  assert.equal(res.status, 400);
  assert.match(res.body.error, /No discovery run in progress/);
});

test('POST /api/discovery/human-step requires the control it is asked to record', async () => {
  const missing = await api.post('/api/discovery/human-step', {});
  assert.equal(missing.status, 400);
  assert.match(missing.body.error, /controlId/);

  const partial = await api.post('/api/discovery/human-step', { controlId: 'app--view--someButton' });
  assert.equal(partial.status, 400);
  assert.match(partial.body.error, /controlType/);
});

test('POST /api/discovery/human-step refuses to record anything when no run is in progress', async () => {
  const res = await api.post('/api/discovery/human-step', {
    controlId: 'app--view--someButton',
    controlType: 'sap.m.Button',
    text: 'Save',
  });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /No discovery run in progress/);
});
