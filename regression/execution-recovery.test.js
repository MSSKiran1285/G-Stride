'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createExecutionPlanSnapshot } = require('../packages/core/dist');
const { createRerunSnapshot, redactExecutionLog } = require('../packages/studio-server/dist/runs');

const plan = {
  schemaVersion: 1,
  planId: 'recovery-plan',
  name: 'Recovery plan',
  target: { provider: 'sap', profileRef: 'default' },
  evidence: { enabled: true, canonical: true },
  kind: 'singleTest',
  testExecution: {
    test: {
      assetId: 'test-asset',
      file: 'testcases/test.json',
      name: 'Test',
      appId: 'app',
      contentHash: 'a'.repeat(64),
      contractMode: 'declared',
      contract: { version: 1, inputs: [], outputs: [] },
    },
    inputBindings: {},
  },
  dataBindings: [{
    bindingId: 'transactions',
    scope: 'test',
    source: { kind: 'file', format: 'json', files: ['data/transactions.json'] },
  }],
  iterationPolicy: {
    session: 'fresh-per-iteration',
    onIterationFailure: 'continue-next-iteration',
    sequential: true,
  },
};

const source = createExecutionPlanSnapshot(plan, [{
  bindingId: 'transactions',
  records: [{ id: 'A' }, { id: 'B' }, { id: 'C' }],
}], { executionId: 'source-execution' });

const hierarchy = {
  executionId: source.executionId,
  snapshotHash: source.snapshotHash,
  members: [{
    memberId: 'execution',
    name: 'Recovery plan',
    status: 'failed',
    iterations: [
      { iterationId: 'i-1', index: 0, status: 'passed', stages: [], evidencePdfUrl: null },
      { iterationId: 'i-2', index: 1, status: 'failed', stages: [], evidencePdfUrl: null },
      { iterationId: 'i-3', index: 2, status: 'cancelled', stages: [], evidencePdfUrl: null },
    ],
  }],
};

test('failed-scope rerun creates a new immutable snapshot containing only eligible transactions', () => {
  const rerun = createRerunSnapshot(source, hierarchy, 'failed');
  assert.notEqual(rerun.executionId, source.executionId);
  assert.deepEqual(rerun.data[0].records, [{ id: 'B' }, { id: 'C' }]);
  assert.equal(rerun.planHash, source.planHash);
  assert.notEqual(rerun.snapshotHash, source.snapshotHash);
});

test('full rerun preserves all source records while creating new execution lineage', () => {
  const rerun = createRerunSnapshot(source, hierarchy, 'full');
  assert.notEqual(rerun.executionId, source.executionId);
  assert.deepEqual(rerun.data[0].records, source.data[0].records);
  assert.equal(rerun.snapshotHash, source.snapshotHash);
});

test('failed-only Pack rerun excludes passed transaction records inside a failed member', () => {
  const executable = {
    kind: 'singleTest',
    testExecution: plan.testExecution,
    dataBindings: plan.dataBindings,
    iterationPolicy: plan.iterationPolicy,
  };
  const packPlan = {
    schemaVersion: 1,
    planId: 'pack-recovery-plan',
    name: 'Pack recovery plan',
    target: plan.target,
    evidence: plan.evidence,
    kind: 'regressionPack',
    members: [{ memberId: 'member-a', name: 'Member A', executable }],
    onMemberFailure: 'continue-next-member',
    sequential: true,
  };
  const packSource = createExecutionPlanSnapshot(packPlan, [{
    bindingId: 'member-a:transactions',
    records: [{ id: 'already-passed' }, { id: 'failed' }, { id: 'unattempted' }],
  }], { executionId: 'pack-source' });
  const packHierarchy = {
    executionId: packSource.executionId,
    snapshotHash: packSource.snapshotHash,
    members: [{
      memberId: 'member-a',
      name: 'Member A',
      status: 'failed',
      iterations: [
        { iterationId: 'a-1', index: 0, status: 'passed', stages: [], evidencePdfUrl: null },
        { iterationId: 'a-2', index: 1, status: 'failed', stages: [], evidencePdfUrl: null },
        { iterationId: 'a-3', index: 2, status: 'cancelled', stages: [], evidencePdfUrl: null },
      ],
    }],
  };

  const rerun = createRerunSnapshot(packSource, packHierarchy, 'failed');
  assert.deepEqual(
    rerun.data[0].records,
    [{ id: 'failed' }, { id: 'unattempted' }],
    'a passed transaction inside the failed member must never be replayed'
  );
});

test('transactional rerun blocks started retained state but permits an unattempted transaction', () => {
  const transactionalPlan = JSON.parse(JSON.stringify(plan));
  transactionalPlan.testExecution.test.transaction = {
    creates: ['purchaseOrder'],
    failureDisposition: 'retain-for-review',
    ownershipRequired: true,
  };
  const transactionalSource = createExecutionPlanSnapshot(transactionalPlan, [{
    bindingId: 'transactions',
    records: [{ id: 'started' }],
  }], { executionId: 'transaction-source' });
  const startedHierarchy = {
    executionId: transactionalSource.executionId,
    snapshotHash: transactionalSource.snapshotHash,
    members: [{
      memberId: 'execution',
      name: 'Recovery plan',
      status: 'failed',
      iterations: [{
        iterationId: 'transaction-1',
        index: 0,
        status: 'failed',
        stages: [{ status: 'failed' }],
        evidencePdfUrl: null,
      }],
    }],
  };
  assert.throws(
    () => createRerunSnapshot(transactionalSource, startedHierarchy, 'failed'),
    /already started.*retained/i
  );

  const unattemptedHierarchy = JSON.parse(JSON.stringify(startedHierarchy));
  unattemptedHierarchy.members[0].iterations[0].status = 'cancelled';
  unattemptedHierarchy.members[0].iterations[0].stages = [];
  const safe = createRerunSnapshot(transactionalSource, unattemptedHierarchy, 'failed');
  assert.deepEqual(safe.data[0].records, [{ id: 'started' }]);
});

test('execution logs redact known credentials and generic authorization secrets', () => {
  const output = redactExecutionLog(
    'user=owner@example.com password=TopSecret authorization: Bearer abc.def token=xyz https://name:pass@example.invalid/',
    ['owner@example.com', 'TopSecret']
  );
  assert.doesNotMatch(output, /owner@example\.com|TopSecret|abc\.def|token=xyz|name:pass/);
  assert.match(output, /\[REDACTED\]/);
});
