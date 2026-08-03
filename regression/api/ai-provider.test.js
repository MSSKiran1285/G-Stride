'use strict';

const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const { api, assertServerReachable } = require('../lib/apiClient');

before(assertServerReachable);

test('GET /api/settings/ai-provider reports not configured before any key is saved', async () => {
  const res = await api.get('/api/settings/ai-provider');
  assert.equal(res.status, 200);
  assert.equal(res.body.provider, 'anthropic');
  assert.equal(res.body.configured, false);
  assert.equal(res.body.source, 'none');
});

test('PUT /api/settings/ai-provider rejects an empty apiKey', async () => {
  const res = await api.put('/api/settings/ai-provider', { apiKey: '   ' });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /apiKey/);
});

test('PUT then GET /api/settings/ai-provider round-trips configured status without ever returning the key', async () => {
  const saved = await api.put('/api/settings/ai-provider', { apiKey: 'sk-ant-synthetic-regression-key' });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.configured, true);
  assert.equal(saved.body.source, 'credential-store');
  assert.equal('apiKey' in saved.body, false, 'the API key itself must never be returned');

  const fetched = await api.get('/api/settings/ai-provider');
  assert.deepEqual(fetched.body, { provider: 'anthropic', configured: true, source: 'credential-store' });
});

test('DELETE /api/settings/ai-provider removes the key, reverting status to not configured', async () => {
  await api.put('/api/settings/ai-provider', { apiKey: 'sk-ant-synthetic-to-be-removed' });
  const removed = await api.delete('/api/settings/ai-provider');
  assert.equal(removed.status, 200);
  assert.equal(removed.body.configured, false);

  const fetched = await api.get('/api/settings/ai-provider');
  assert.equal(fetched.body.configured, false);
});
