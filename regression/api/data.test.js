'use strict';

const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const { api, assertServerReachable } = require('../lib/apiClient');

before(assertServerReachable);

test('GET /api/data lists known fixtures', async () => {
  const { status, body } = await api.get('/api/data');
  assert.equal(status, 200);
  assert.ok(Array.isArray(body));
  assert.ok(body.includes('suppliers.csv'));
});

test('GET /api/data/:file parses an existing CSV', async () => {
  const { status, body } = await api.get('/api/data/suppliers.csv');
  assert.equal(status, 200);
  assert.ok(body.headers.includes('supplier'));
  assert.ok(body.rows.length >= 1);
});

test('GET /api/data/:file for an unknown file returns an empty dataset, not 404', async () => {
  const { status, body } = await api.get('/api/data/does-not-exist.csv');
  assert.equal(status, 200);
  assert.deepEqual(body, { headers: [], rows: [] });
});

test('PUT /api/data/:file rejects a non-.csv file name', async () => {
  const { status } = await api.put('/api/data/regression-sample.txt', { headers: ['a'], rows: [] });
  assert.equal(status, 400);
});

test('PUT /api/data/:file rejects a body missing rows', async () => {
  const { status } = await api.put('/api/data/regression-sample.csv', { headers: ['a'] });
  assert.equal(status, 400);
});

test('PUT then GET /api/data/:file round-trips (Data positive)', async () => {
  const dataset = {
    headers: ['col1', 'col2'],
    rows: [
      { col1: 'a', col2: 'b' },
      { col1: 'c', col2: 'd' },
    ],
  };
  const put = await api.put('/api/data/regression-sample.csv', dataset);
  assert.equal(put.status, 200);
  assert.deepEqual(put.body, { ok: true });

  const get = await api.get('/api/data/regression-sample.csv');
  assert.equal(get.status, 200);
  assert.deepEqual(get.body, dataset);

  const list = await api.get('/api/data');
  assert.ok(list.body.includes('regression-sample.csv'));
});
