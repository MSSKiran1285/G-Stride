'use strict';

const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const { api, assertServerReachable } = require('../lib/apiClient');
const { RunHistoryStore } = require('../../packages/core/dist');

before(assertServerReachable);

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required — run this file through regression/run-isolated-api.js, not node --test directly.`);
  return value;
}

test('GET /api/search returns [] for an empty or whitespace-only query', async () => {
  const empty = await api.get('/api/search?q=');
  assert.equal(empty.status, 200);
  assert.deepEqual(empty.body, []);

  const blank = await api.get('/api/search?q=%20%20');
  assert.equal(blank.status, 200);
  assert.deepEqual(blank.body, []);

  const missing = await api.get('/api/search');
  assert.equal(missing.status, 200);
  assert.deepEqual(missing.body, []);
});

test('GET /api/search finds a Test by name and reports domain/application/lifecycle/route (BL-037 AC1)', async () => {
  const testFile = 'search-regression-test.json';
  await api.put(`/api/testcases/${testFile}`, {
    name: 'Searchable Purchase Order Test',
    steps: [{ module: 'Wait', appId: 'searchRegressionTestApp', params: { ms: '1' } }],
  });
  await api.put(`/api/tags/testCase/${testFile}`, { processArea: 'Procure to Pay' });

  const { status, body } = await api.get('/api/search?q=Searchable+Purchase+Order');
  assert.equal(status, 200);
  const hit = body.find((r) => r.kind === 'test' && r.id === testFile);
  assert.ok(hit, 'expected the seeded Test in search results');
  assert.equal(hit.label, 'Searchable Purchase Order Test');
  assert.equal(hit.domain, 'Procure to Pay');
  assert.equal(hit.application, 'searchRegressionTestApp');
  assert.equal(hit.lifecycle, 'ready');
  assert.equal(hit.route, `/compose/tests/${testFile}`);
});

test('GET /api/search finds an Object, a Process and a Regression Pack, each typed by kind', async () => {
  await api.put('/api/objects/searchRegressionApp/SearchableButton', {
    controlId: '__xmlview1--SearchableButton',
    controlType: 'sap.m.Button',
    label: 'Findable Button',
  });
  const objectHit = (await api.get('/api/search?q=Findable+Button')).body.find((r) => r.kind === 'object');
  assert.ok(objectHit, 'expected the object in search results');
  assert.equal(objectHit.id, 'searchRegressionApp/SearchableButton');
  assert.equal(objectHit.application, 'searchRegressionApp');
  assert.equal(objectHit.route, '/objects/searchRegressionApp/SearchableButton');

  const processHit = (await api.get('/api/search?q=GR-Invoice')).body.find((r) => r.kind === 'process');
  assert.ok(processHit, 'expected po-gr-invoice.json in search results');
  assert.equal(processHit.id, 'po-gr-invoice.json');
  assert.equal(processHit.application, 'createPurchaseOrder');

  const packHit = (await api.get('/api/search?q=mixed-pack')).body.find((r) => r.kind === 'pack');
  assert.ok(packHit, 'expected published-mixed-pack.json in search results');
  assert.equal(packHit.id, 'published-mixed-pack.json');
});

test('GET /api/search finds a Dataset by file name', async () => {
  const { body } = await api.get('/api/search?q=.csv');
  const datasetHit = body.find((r) => r.kind === 'dataset');
  assert.ok(datasetHit, 'expected at least one dataset result');
  assert.equal(datasetHit.route, `/data/${datasetHit.id}`);
});

test('GET /api/search is case-insensitive and matches on file name as well as display name', async () => {
  const { body } = await api.get('/api/search?q=CREATE-PO.JSON');
  assert.ok(body.some((r) => r.kind === 'test' && r.id === 'create-po.json'));
});

test('GET /api/search finds a Run by App ID, typed with its status as lifecycle (BL-037 AC1)', async () => {
  const store = new RunHistoryStore(requireEnv('REGRESSION_RUN_HISTORY_DB'));
  try {
    store.record({
      id: 'search-regression-run',
      startedAt: '2026-01-01T00:00:00.000Z',
      finishedAt: '2026-01-01T00:00:05.000Z',
      status: 'failed',
      executedBy: 'regression-executor',
      mode: 'single',
      appId: 'searchRegressionRunApp',
      testCaseNames: ['Searchable Run Test'],
      testCaseFiles: ['searchable-run-test.json'],
      result: { ok: false },
    });
    const { status, body } = await api.get('/api/search?q=searchRegressionRunApp');
    assert.equal(status, 200);
    const runHit = body.find((r) => r.kind === 'run' && r.id === 'search-regression-run');
    assert.ok(runHit, 'expected the seeded run in search results');
    assert.equal(runHit.label, 'Searchable Run Test');
    assert.equal(runHit.application, 'searchRegressionRunApp');
    assert.equal(runHit.lifecycle, 'failed');
    assert.equal(runHit.route, '/audit/runs/search-regression-run');
  } finally {
    store.close();
  }
});
