'use strict';

const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const { api, assertServerReachable } = require('../lib/apiClient');

before(assertServerReachable);

test('GET /api/groups lists known fixtures', async () => {
  const { status, body } = await api.get('/api/groups');
  assert.equal(status, 200);
  assert.ok(Array.isArray(body));
  assert.ok(body.includes('o2c-e2e.json'));
  assert.ok(body.includes('po-gr-invoice.json'));
});

test('GET /api/groups/:file returns the parsed group', async () => {
  const { status, body } = await api.get('/api/groups/po-gr-invoice.json');
  assert.equal(status, 200);
  assert.equal(body.name, 'Create PO - GR - Invoice');
  assert.equal(body.appId, 'createPurchaseOrder');
  assert.deepEqual(body.testCaseFiles, ['create-po.json', 'post-goods-receipt.json', 'post-supplier-invoice.json']);
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

test('GET inferred Test contract exposes typed authoring metadata', async () => {
  const { status, body } = await api.get('/api/testcases/contract-consumer.json/contract');
  assert.equal(status, 200);
  assert.deepEqual(body.inputs, [
    { name: 'documentId', type: 'string', required: true, sensitivity: 'business' },
  ]);
});

test('versioned Business Process persists a typed prior-stage hand-off', async () => {
  const process = {
    version: 1,
    lifecycle: 'published',
    name: 'Contract hand-off process',
    appId: 'syntheticApp',
    testCaseFiles: ['contract-producer.json', 'contract-consumer.json'],
    stages: [
      { stageId: 'produce-document', testCaseFile: 'contract-producer.json', inputBindings: {} },
      {
        stageId: 'consume-document',
        testCaseFile: 'contract-consumer.json',
        inputBindings: {
          documentId: { source: 'stageOutput', stageId: 'produce-document', output: 'documentId' },
        },
      },
    ],
  };
  const put = await api.put('/api/groups/contract-handoff.json', process);
  assert.equal(put.status, 200);
  const get = await api.get('/api/groups/contract-handoff.json');
  assert.deepEqual(get.body, process);
});

test('Business Process rejects forward references and cycles', async () => {
  const invalid = {
    version: 1,
    lifecycle: 'draft',
    name: 'Invalid forward reference',
    appId: 'syntheticApp',
    testCaseFiles: ['contract-consumer.json', 'contract-producer.json'],
    stages: [
      {
        stageId: 'consume-first',
        testCaseFile: 'contract-consumer.json',
        inputBindings: {
          documentId: { source: 'stageOutput', stageId: 'produce-later', output: 'documentId' },
        },
      },
      { stageId: 'produce-later', testCaseFile: 'contract-producer.json', inputBindings: {} },
    ],
  };
  const { status, body } = await api.put('/api/groups/invalid-cycle.json', invalid);
  assert.equal(status, 400);
  assert.match(body.error, /forward reference or cycle/i);
});
