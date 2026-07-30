'use strict';

const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const { api, assertServerReachable } = require('../lib/apiClient');

before(assertServerReachable);

const APP_ID = 'regressionObjectsApp';

test('PUT /api/objects/:appId/:name saves scope and stamps created/updated metadata', async () => {
  const save = await api.put(`/api/objects/${APP_ID}/RegressionButton`, {
    controlId: '__xmlview1--RegressionButton',
    controlType: 'sap.m.Button',
    label: 'Regression Button',
    scope: 'app',
  });
  assert.equal(save.status, 200);

  const list = await api.get(`/api/objects/${APP_ID}`);
  assert.equal(list.status, 200);
  const saved = list.body.find((o) => o.name === 'RegressionButton');
  assert.ok(saved, 'expected RegressionButton in the list');
  assert.equal(saved.scope, 'app');
  assert.ok(saved.createdAt, 'expected createdAt to be stamped');
  assert.ok(saved.updatedAt, 'expected updatedAt to be stamped');
  assert.equal(saved.unstableId, false, 'a plain xmlview id should not be flagged unstable');
  assert.deepEqual(saved.likelyDuplicateOf, []);

  // Re-saving must not reset createdAt, only updatedAt.
  await new Promise((resolve) => setTimeout(resolve, 5));
  await api.put(`/api/objects/${APP_ID}/RegressionButton`, {
    controlId: '__xmlview1--RegressionButton',
    controlType: 'sap.m.Button',
    label: 'Regression Button (relabeled)',
    scope: 'app',
  });
  const relist = await api.get(`/api/objects/${APP_ID}`);
  const resaved = relist.body.find((o) => o.name === 'RegressionButton');
  assert.equal(resaved.createdAt, saved.createdAt, 'createdAt must survive a second upsert');
  assert.notEqual(resaved.updatedAt, saved.updatedAt, 'updatedAt must change on a second upsert');
});

test('GET /api/objects/:appId flags an auto-generated-looking id as unstable', async () => {
  await api.put(`/api/objects/${APP_ID}/RegressionCloneField`, {
    controlId: '__field0--__clone12-__field1',
    controlType: 'sap.m.Input',
  });
  const list = await api.get(`/api/objects/${APP_ID}`);
  const saved = list.body.find((o) => o.name === 'RegressionCloneField');
  assert.equal(saved.unstableId, true);
});

test('GET /api/objects/:appId flags likely duplicates by matching type + label', async () => {
  await api.put(`/api/objects/${APP_ID}/RegressionDup1`, {
    controlId: '__xmlview1--dup1',
    controlType: 'sap.m.Button',
    label: 'Duplicate Label',
  });
  await api.put(`/api/objects/${APP_ID}/RegressionDup2`, {
    controlId: '__xmlview1--dup2',
    controlType: 'sap.m.Button',
    label: 'Duplicate Label',
  });
  const list = await api.get(`/api/objects/${APP_ID}`);
  const dup1 = list.body.find((o) => o.name === 'RegressionDup1');
  const dup2 = list.body.find((o) => o.name === 'RegressionDup2');
  assert.deepEqual(dup1.likelyDuplicateOf, ['RegressionDup2']);
  assert.deepEqual(dup2.likelyDuplicateOf, ['RegressionDup1']);
});

test('object usage, dependency-aware rename and delete blocking (BL-022 AC3)', async () => {
  await api.put(`/api/objects/${APP_ID}/RegressionUsedButton`, {
    controlId: '__xmlview1--RegressionUsedButton',
    controlType: 'sap.m.Button',
  });

  const emptyUsage = await api.get(`/api/objects/${APP_ID}/RegressionUsedButton/usage`);
  assert.equal(emptyUsage.status, 200);
  assert.deepEqual(emptyUsage.body, []);

  const testFile = 'regression-object-usage.json';
  const create = await api.post(`/api/testcases/${testFile}`, {
    testCase: {
      name: 'Regression Object Usage',
      application: 'SAP',
      steps: [{ module: 'ClickButton', appId: APP_ID, params: { control: 'RegressionUsedButton' } }],
    },
    processArea: '',
  });
  assert.equal(create.status, 201);

  const usage = await api.get(`/api/objects/${APP_ID}/RegressionUsedButton/usage`);
  assert.deepEqual(usage.body, [testFile]);

  // Delete must be blocked while referenced, and say so.
  const blockedDelete = await api.delete(`/api/objects/${APP_ID}/RegressionUsedButton`);
  assert.equal(blockedDelete.status, 409);
  assert.deepEqual(blockedDelete.body.usedBy, [testFile]);

  // Rename propagates into the referencing Test rather than leaving it broken.
  const rename = await api.put(`/api/objects/${APP_ID}/RegressionUsedButton/rename`, { newName: 'RegressionUsedButtonRenamed' });
  assert.equal(rename.status, 200);
  assert.deepEqual(rename.body.updatedTests, [testFile]);

  const persisted = await api.get(`/api/testcases/${testFile}`);
  assert.equal(persisted.body.steps[0].params.control, 'RegressionUsedButtonRenamed');

  const usageAfterRename = await api.get(`/api/objects/${APP_ID}/RegressionUsedButtonRenamed/usage`);
  assert.deepEqual(usageAfterRename.body, [testFile]);

  // Now delete anyway (force=true) — usage no longer blocks it.
  const forcedDelete = await api.delete(`/api/objects/${APP_ID}/RegressionUsedButtonRenamed?force=true`);
  assert.equal(forcedDelete.status, 200);
  assert.deepEqual(forcedDelete.body.usedBy, [testFile]);
});

test('POST /api/objects/:appId/:name/reverify requires an open scan session', async () => {
  await api.put(`/api/objects/${APP_ID}/RegressionReverifyTarget`, {
    controlId: '__xmlview1--RegressionReverifyTarget',
    controlType: 'sap.m.Button',
  });
  const reverify = await api.post(`/api/objects/${APP_ID}/RegressionReverifyTarget/reverify`, {});
  assert.equal(reverify.status, 400);
  assert.match(reverify.body.error, /No active scan session/);

  // A failed reverify attempt (no session) must not be recorded as a verification event —
  // only an attempt that actually reached the live screen counts.
  const verifications = await api.get(`/api/objects/${APP_ID}/RegressionReverifyTarget/verifications`);
  assert.equal(verifications.status, 200);
  assert.deepEqual(verifications.body, []);
});
