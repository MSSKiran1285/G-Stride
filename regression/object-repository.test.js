'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ObjectRepository, isLikelyUnstableId, findLikelyDuplicates } = require('../packages/core/dist');

function freshRepo() {
  return new ObjectRepository(':memory:');
}

test('upsert stamps createdAt/updatedAt/updatedBy and preserves createdAt across a second upsert', async () => {
  const repo = freshRepo();
  try {
    repo.upsert({ appId: 'app1', name: 'Field', controlId: 'id1', controlType: 'sap.m.Input' }, 'alice');
    const first = repo.get('app1', 'Field');
    assert.equal(first.updatedBy, 'alice');
    assert.ok(first.createdAt);
    assert.equal(first.createdAt, first.updatedAt);

    await new Promise((resolve) => setTimeout(resolve, 5));
    repo.upsert({ appId: 'app1', name: 'Field', controlId: 'id1-changed', controlType: 'sap.m.Input' }, 'bob');
    const second = repo.get('app1', 'Field');
    assert.equal(second.createdAt, first.createdAt, 'createdAt must not change on update');
    assert.notEqual(second.updatedAt, first.updatedAt, 'updatedAt must change on update');
    assert.equal(second.updatedBy, 'bob');
    assert.equal(second.controlId, 'id1-changed');
  } finally {
    repo.close();
  }
});

test('rename preserves createdAt and migrates verification history to the new name', async () => {
  const repo = freshRepo();
  try {
    repo.upsert({ appId: 'app1', name: 'OldName', controlId: 'id1', controlType: 'sap.m.Button' }, 'alice');
    const original = repo.get('app1', 'OldName');
    repo.recordVerification({ appId: 'app1', name: 'OldName', verifiedAt: new Date().toISOString(), outcome: 'verified', verifiedBy: 'alice' });

    repo.rename('app1', 'OldName', 'NewName', 'bob');
    const renamed = repo.get('app1', 'NewName');
    assert.equal(renamed.createdAt, original.createdAt);
    assert.equal(renamed.updatedBy, 'bob');
    assert.throws(() => repo.get('app1', 'OldName'));

    const history = repo.listVerifications('app1', 'NewName');
    assert.equal(history.length, 1);
    assert.equal(history[0].outcome, 'verified');
    assert.deepEqual(repo.listVerifications('app1', 'OldName'), []);
  } finally {
    repo.close();
  }
});

test('recordVerification appends history and updates the denormalized last-verified snapshot', () => {
  const repo = freshRepo();
  try {
    repo.upsert({ appId: 'app1', name: 'Field', controlId: 'id1', controlType: 'sap.m.Input' });
    assert.equal(repo.get('app1', 'Field').verificationStatus, 'never');

    repo.recordVerification({ appId: 'app1', name: 'Field', verifiedAt: '2026-01-01T00:00:00.000Z', outcome: 'drifted', liveControlId: 'id1-live', liveControlType: 'sap.m.Input' });
    repo.recordVerification({ appId: 'app1', name: 'Field', verifiedAt: '2026-01-02T00:00:00.000Z', outcome: 'verified' });

    const control = repo.get('app1', 'Field');
    assert.equal(control.verificationStatus, 'verified');
    assert.equal(control.lastVerifiedAt, '2026-01-02T00:00:00.000Z');

    const history = repo.listVerifications('app1', 'Field');
    assert.equal(history.length, 2);
    assert.equal(history[0].outcome, 'verified', 'most recent event must come first');
    assert.equal(history[1].outcome, 'drifted');
    assert.equal(history[1].liveControlId, 'id1-live');
  } finally {
    repo.close();
  }
});

test('isLikelyUnstableId flags clone segments and all-generated ids, not ordinary view ids', () => {
  assert.equal(isLikelyUnstableId('__xmlview1--RegionField'), false);
  assert.equal(isLikelyUnstableId('someTable-rows-row2-col1--ColumnListItem-__clone178-selectMulti'), true);
  assert.equal(isLikelyUnstableId('__field0--__clone12-__field1'), true);
});

test('findLikelyDuplicates groups same-appId controls sharing type + label under different names', () => {
  const groups = findLikelyDuplicates([
    { name: 'A', controlType: 'sap.m.Button', label: 'Create' },
    { name: 'B', controlType: 'sap.m.Button', label: 'Create' },
    { name: 'C', controlType: 'sap.m.Button', label: 'Save' },
    { name: 'D', controlType: 'sap.m.Input', label: undefined },
  ]);
  assert.deepEqual(groups.get('A'), ['B']);
  assert.deepEqual(groups.get('B'), ['A']);
  assert.equal(groups.get('C'), undefined);
  assert.equal(groups.get('D'), undefined);
});
