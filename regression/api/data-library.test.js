'use strict';

const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const { api, assertServerReachable } = require('../lib/apiClient');

before(assertServerReachable);

test('GET /api/data/library lists search/format/process-area facets without a full dataset load (BL-025 AC1)', async () => {
  const put = await api.put('/api/data/regression-library.csv', {
    format: 'csv',
    headers: ['supplier', 'quantity'],
    rows: [{ supplier: 'ACME', quantity: '5' }, { supplier: 'Globex', quantity: '3' }],
  });
  assert.equal(put.status, 200);
  await api.put('/api/tags/dataFile/regression-library.csv', { processArea: 'Procurement' });

  const library = await api.get('/api/data/library');
  assert.equal(library.status, 200);
  const entry = library.body.find((item) => item.file === 'regression-library.csv');
  assert.ok(entry, 'expected regression-library.csv in the library');
  assert.equal(entry.format, 'csv');
  assert.equal(entry.processArea, 'Procurement');
  assert.equal(entry.rowCount, 2);
});

test('GET/PUT /api/data/:file/schema declares column name, type, sensitivity and example (BL-025 AC2)', async () => {
  await api.put('/api/data/regression-schema.csv', {
    format: 'csv',
    headers: ['supplier', 'amount'],
    rows: [{ supplier: 'ACME', amount: '1000' }],
  });

  const emptySchema = await api.get('/api/data/regression-schema.csv/schema');
  assert.equal(emptySchema.status, 200);
  assert.deepEqual(emptySchema.body, []);

  const setType = await api.put('/api/data/regression-schema.csv/schema/amount', {
    type: 'number',
    sensitivity: 'business',
    example: '1000000123',
  });
  assert.equal(setType.status, 200);

  const schema = await api.get('/api/data/regression-schema.csv/schema');
  assert.equal(schema.status, 200);
  assert.equal(schema.body.length, 1);
  assert.equal(schema.body[0].column, 'amount');
  assert.equal(schema.body[0].type, 'number');
  assert.equal(schema.body[0].sensitivity, 'business');
  assert.equal(schema.body[0].example, '1000000123');

  const rejected = await api.put('/api/data/regression-schema.csv/schema/amount', {
    type: 'currency',
    sensitivity: 'business',
  });
  assert.equal(rejected.status, 500);
});

test('dataset usage, dependency-aware rename and delete blocking (BL-025 AC3)', async () => {
  await api.put('/api/data/regression-used.csv', {
    format: 'csv',
    headers: ['supplier'],
    rows: [{ supplier: 'ACME' }],
  });

  const emptyUsage = await api.get('/api/data/regression-used.csv/usage');
  assert.equal(emptyUsage.status, 200);
  assert.deepEqual(emptyUsage.body, { groups: [], packs: [], relations: [] });

  const groupFile = 'regression-data-usage-group.json';
  const createGroup = await api.put(`/api/groups/${groupFile}`, {
    name: 'Regression Data Usage Group',
    appId: 'createPurchaseOrder',
    testCaseFiles: ['cleanup-abandoned-drafts.json'],
    dataFile: 'regression-used.csv',
  });
  assert.equal(createGroup.status, 200);

  const usage = await api.get('/api/data/regression-used.csv/usage');
  assert.deepEqual(usage.body, { groups: [groupFile], packs: [], relations: [] });

  // Delete must be blocked while referenced, and say so.
  const blockedDelete = await api.delete('/api/data/regression-used.csv');
  assert.equal(blockedDelete.status, 409);
  assert.deepEqual(blockedDelete.body.usage.groups, [groupFile]);

  // Rename propagates into the referencing Process rather than leaving it broken.
  const rename = await api.put('/api/data/regression-used.csv/rename', { newName: 'regression-used-renamed.csv' });
  assert.equal(rename.status, 200);
  assert.deepEqual(rename.body.updatedGroups, [groupFile]);

  const persistedGroup = await api.get(`/api/groups/${groupFile}`);
  assert.equal(persistedGroup.body.dataFile, 'regression-used-renamed.csv');

  const usageAfterRename = await api.get('/api/data/regression-used-renamed.csv/usage');
  assert.deepEqual(usageAfterRename.body.groups, [groupFile]);

  const reopened = await api.get('/api/data/regression-used-renamed.csv');
  assert.equal(reopened.status, 200);
  assert.equal(reopened.body.format, 'csv');

  // Now delete anyway (force=true) — usage no longer blocks it.
  const forcedDelete = await api.delete('/api/data/regression-used-renamed.csv?force=true');
  assert.equal(forcedDelete.status, 200);
  assert.deepEqual(forcedDelete.body.usage.groups, [groupFile]);
});

test('DELETE /api/data/:file with no references succeeds without force', async () => {
  await api.put('/api/data/regression-unused.csv', {
    format: 'csv',
    headers: ['supplier'],
    rows: [],
  });
  const del = await api.delete('/api/data/regression-unused.csv');
  assert.equal(del.status, 200);
  assert.deepEqual(del.body.usage, { groups: [], packs: [], relations: [] });

  const list = await api.get('/api/data');
  assert.ok(!list.body.includes('regression-unused.csv'));
});
