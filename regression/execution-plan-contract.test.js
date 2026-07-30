'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const {
  ExecutionPlanValidationError,
  applyDataSelection,
  createExecutionPlanSnapshot,
  describeBinding,
  validateExecutionPlan,
} = require('../packages/core/dist');

const root = path.resolve(__dirname, '..');
const examplesDir = path.join(root, 'docs', 'ui-ux', 'execution-plan-examples');

function readJson(file) {
  return JSON.parse(readFileSync(path.join(examplesDir, file), 'utf8'));
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

test('Stage 1 example plans satisfy the versioned execution contract', () => {
  for (const file of [
    'single-test.plan.json',
    'business-process.plan.json',
    'regression-pack.plan.json',
  ]) {
    const issues = validateExecutionPlan(readJson(file));
    assert.deepEqual(issues, [], `${file} should be valid:\n${JSON.stringify(issues, null, 2)}`);
  }
});

test('Business Process hand-offs are ordered and namespaced', () => {
  const plan = readJson('business-process.plan.json');
  const deliveryBinding = plan.stages[1].inputBindings.salesOrderNumber;
  const billingBinding = plan.stages[2].inputBindings.deliveryNumber;

  assert.equal(describeBinding(deliveryBinding), 'stages.createSalesOrder.outputs.salesOrderNumber');
  assert.equal(describeBinding(billingBinding), 'stages.createDelivery.outputs.deliveryNumber');

  const invalid = clone(plan);
  invalid.stages[1].inputBindings.salesOrderNumber.stageId = 'createBilling';
  const issues = validateExecutionPlan(invalid);
  assert.ok(issues.some((issue) => issue.code === 'future-or-unknown-stage-output'));
});

test('Execution snapshots clone, freeze, and hash plan plus transaction data', () => {
  const plan = readJson('single-test.plan.json');
  const records = readJson('sales-orders.sample.json');
  const snapshot = createExecutionPlanSnapshot(
    plan,
    [{ bindingId: 'orders', records }],
    {
      executionId: 'execution-example',
      createdAt: '2026-07-28T12:00:00.000Z',
    }
  );
  const repeated = createExecutionPlanSnapshot(
    plan,
    [{ bindingId: 'orders', records }],
    {
      executionId: 'another-execution-id',
      createdAt: '2026-07-28T13:00:00.000Z',
    }
  );

  assert.equal(snapshot.data[0].recordCount, 2);
  assert.equal(snapshot.planHash.length, 64);
  assert.equal(snapshot.snapshotHash.length, 64);
  assert.equal(snapshot.planHash, repeated.planHash);
  assert.equal(snapshot.snapshotHash, repeated.snapshotHash);
  assert.equal(Object.isFrozen(snapshot), true);
  assert.equal(Object.isFrozen(snapshot.plan), true);
  assert.equal(Object.isFrozen(snapshot.data[0].records[0]), true);

  plan.name = 'Changed after submission';
  records[0].header.orderType = 'CHANGED';
  assert.equal(snapshot.plan.name, 'Create sales orders from selected records');
  assert.equal(snapshot.data[0].records[0].header.orderType, 'OR');
});

test('data selection applies nested filters before the immutable record limit', () => {
  const records = [
    { scenarioKey: 'A', header: { salesOrg: '1000' } },
    { scenarioKey: 'B', header: { salesOrg: '2000' } },
    { scenarioKey: 'C', header: { salesOrg: '2000' } },
  ];
  assert.deepEqual(
    applyDataSelection(records, {
      filter: { path: 'header.salesOrg', operator: 'equals', value: '2000' },
      maxRecords: 1,
    }),
    [records[1]]
  );
  assert.deepEqual(
    applyDataSelection(records, {
      filter: { path: 'scenarioKey', operator: 'contains', value: 'c' },
    }),
    [records[2]]
  );
  assert.deepEqual(
    applyDataSelection([{ value: '' }, { value: 'set' }, {}], {
      filter: { path: 'value', operator: 'is-empty' },
    }),
    [{ value: '' }, {}]
  );
});

test('Regression Pack snapshots namespace member data bindings', () => {
  const plan = readJson('regression-pack.plan.json');
  const records = readJson('sales-orders.sample.json');
  const snapshot = createExecutionPlanSnapshot(
    plan,
    [{ bindingId: 'o2c-process:orders', records }],
    { executionId: 'pack-example', createdAt: '2026-07-28T12:00:00.000Z' }
  );

  assert.equal(snapshot.data.length, 1);
  assert.equal(snapshot.data[0].bindingId, 'o2c-process:orders');
  assert.equal(snapshot.data[0].recordCount, 2);
});

test('Credential values are rejected from plans and data snapshots', () => {
  const plan = readJson('single-test.plan.json');
  const unsafePlan = clone(plan);
  unsafePlan.testExecution.test.contract.inputs.push({
    name: 'password',
    type: 'string',
    required: true,
    sensitivity: 'secret',
  });
  unsafePlan.testExecution.inputBindings.password = {
    source: 'literal',
    value: 'synthetic-secret',
  };
  assert.ok(validateExecutionPlan(unsafePlan).some((issue) => issue.code === 'secret-must-use-system-context'));

  assert.throws(
    () =>
      createExecutionPlanSnapshot(
        plan,
        [{ bindingId: 'orders', records: [{ scenarioKey: 'unsafe', password: 'synthetic-secret' }] }],
        { executionId: 'unsafe-example', createdAt: '2026-07-28T12:00:00.000Z' }
      ),
    (error) =>
      error instanceof ExecutionPlanValidationError &&
      error.issues.some((issue) => issue.code === 'embedded-secret-value')
  );
});

test('Snapshot creation rejects missing and unknown data bindings', () => {
  const plan = readJson('single-test.plan.json');
  assert.throws(
    () => createExecutionPlanSnapshot(plan, [], { executionId: 'missing-data' }),
    (error) =>
      error instanceof ExecutionPlanValidationError &&
      error.issues.some((issue) => issue.code === 'missing-data-snapshot')
  );
  assert.throws(
    () =>
      createExecutionPlanSnapshot(
        plan,
        [{ bindingId: 'other-data', records: [] }],
        { executionId: 'unknown-data' }
      ),
    (error) =>
      error instanceof ExecutionPlanValidationError &&
      error.issues.some((issue) => issue.code === 'unknown-data-snapshot')
  );
});
