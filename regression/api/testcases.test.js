'use strict';

const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const { api, assertServerReachable } = require('../lib/apiClient');

before(assertServerReachable);

test('GET /api/testcases lists known fixtures', async () => {
  const { status, body } = await api.get('/api/testcases');
  assert.equal(status, 200);
  assert.ok(Array.isArray(body));
  assert.ok(body.includes('create-po.json'), 'expected create-po.json in the list');
});

test('GET /api/testcases/:file returns the parsed test case', async () => {
  const { status, body } = await api.get('/api/testcases/create-po.json');
  assert.equal(status, 200);
  assert.equal(body.name, 'Create Purchase Order - Happy Path');
  assert.ok(Array.isArray(body.steps) && body.steps.length > 0);
});

test('GET /api/testcases/:file 404s for an unknown file', async () => {
  const { status } = await api.get('/api/testcases/does-not-exist.json');
  assert.equal(status, 404);
});

test('PUT /api/testcases/:file rejects a non-.json file name', async () => {
  const { status } = await api.put('/api/testcases/evil', { name: 'x', steps: [] });
  assert.equal(status, 400);
});

test('PUT /api/testcases/:file rejects a body missing required fields', async () => {
  const { status } = await api.put('/api/testcases/regression-sample.json', { name: 'no steps field' });
  assert.equal(status, 400);
});

test('PUT then GET /api/testcases/:file round-trips (Compose positive)', async () => {
  const testCase = {
    name: 'Regression Sample',
    steps: [{ module: 'Wait', params: { ms: '100' } }],
  };
  const put = await api.put('/api/testcases/regression-sample.json', testCase);
  assert.equal(put.status, 200);
  assert.deepEqual(put.body, { ok: true });

  const get = await api.get('/api/testcases/regression-sample.json');
  assert.equal(get.status, 200);
  assert.deepEqual(get.body, testCase);

  const list = await api.get('/api/testcases');
  assert.ok(list.body.includes('regression-sample.json'));
});
