'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const {
  TransactionDataValidationError,
  loadTransactionData,
  validateExecutionPlan,
} = require('../packages/core/dist');

function scratch() {
  const root = mkdtempSync(path.join(tmpdir(), 'qa4-data-'));
  return {
    root,
    file(name, content) {
      const target = path.join(root, name);
      writeFileSync(target, content);
      return target;
    },
    close() {
      rmSync(root, { recursive: true, force: true });
    },
  };
}

test('nested JSON preserves one header with many line items as one transaction', () => {
  const context = scratch();
  try {
    const file = context.file('orders.json', JSON.stringify([
      {
        scenarioKey: 'SO-001',
        header: { soldToParty: 'CUSTOMER-001' },
        items: [
          { product: 'A', quantity: 10 },
          { product: 'B', quantity: 5 },
        ],
      },
    ]));
    const loaded = loadTransactionData({
      kind: 'file',
      format: 'json',
      files: [file],
    });
    assert.equal(loaded.records.length, 1);
    assert.equal(loaded.childRecordCount, 2);
    assert.equal(loaded.records[0].items.length, 2);
    assert.equal(loaded.records[0].header.soldToParty, 'CUSTOMER-001');
  } finally {
    context.close();
  }
});

test('nested JSON preserves many headers with owned line items as separate transactions', () => {
  const context = scratch();
  try {
    const file = context.file('orders.json', JSON.stringify([
      { scenarioKey: 'SO-001', items: [{ product: 'A' }, { product: 'B' }] },
      { scenarioKey: 'SO-002', items: [{ product: 'C' }, { product: 'D' }, { product: 'E' }] },
    ]));
    const loaded = loadTransactionData({ kind: 'file', format: 'json', files: [file] });
    assert.equal(loaded.records.length, 2);
    assert.equal(loaded.childRecordCount, 5);
    assert.deepEqual(loaded.records.map((record) => record.items.length), [2, 3]);
  } finally {
    context.close();
  }
});

test('relational CSV joins child rows to their owning header without creating duplicate headers', () => {
  const context = scratch();
  try {
    const headers = context.file(
      'orders.csv',
      'scenarioKey,soldToParty\nSO-001,CUSTOMER-001\nSO-002,CUSTOMER-002\n'
    );
    const items = context.file(
      'items.csv',
      'orderKey,lineNumber,product,quantity\nSO-001,10,A,10\nSO-001,20,B,5\nSO-002,10,C,2\n'
    );
    const loaded = loadTransactionData({
      kind: 'file',
      format: 'relational-csv',
      files: [headers, items],
      relation: {
        headerKey: 'scenarioKey',
        childForeignKey: 'orderKey',
        collectionPath: 'items',
      },
    });
    assert.equal(loaded.records.length, 2);
    assert.equal(loaded.childRecordCount, 3);
    assert.deepEqual(loaded.records.map((record) => record.items.length), [2, 1]);
    assert.equal(loaded.records[0].scenarioKey, 'SO-001');
  } finally {
    context.close();
  }
});

test('relational CSV rejects duplicate headers and orphan child rows with actionable issues', () => {
  const context = scratch();
  try {
    const headers = context.file('orders.csv', 'scenarioKey\nSO-001\nSO-001\n');
    const items = context.file('items.csv', 'orderKey,product\nSO-404,A\n');
    assert.throws(
      () => loadTransactionData({
        kind: 'file',
        format: 'relational-csv',
        files: [headers, items],
        relation: {
          headerKey: 'scenarioKey',
          childForeignKey: 'orderKey',
          collectionPath: 'items',
        },
      }),
      (error) => {
        assert.ok(error instanceof TransactionDataValidationError);
        assert.ok(error.issues.some((issue) => issue.code === 'duplicate-header-key'));
        assert.ok(error.issues.some((issue) => issue.code === 'orphan-child-record'));
        return true;
      }
    );
  } finally {
    context.close();
  }
});

test('Execution Plan validation requires explicit relational join metadata', () => {
  const plan = {
    schemaVersion: 1,
    planId: 'relational-test',
    name: 'Relational test',
    target: { provider: 'sap', profileRef: 'default' },
    evidence: { enabled: true, canonical: true },
    kind: 'singleTest',
    testExecution: {
      test: {
        assetId: 'test',
        file: 'testcases/test.json',
        name: 'Test',
        appId: 'app',
        contentHash: 'a'.repeat(64),
        contractMode: 'legacy-inferred',
        contract: { version: 1, inputs: [], outputs: [] },
      },
      inputBindings: {},
    },
    dataBindings: [{
      bindingId: 'orders',
      scope: 'test',
      source: {
        kind: 'file',
        format: 'relational-csv',
        files: ['data/orders.csv', 'data/items.csv'],
      },
    }],
    iterationPolicy: {
      session: 'fresh-per-iteration',
      onIterationFailure: 'continue-next-iteration',
      sequential: true,
    },
  };
  const issues = validateExecutionPlan(plan);
  assert.ok(issues.some((issue) => issue.code === 'missing-relational-join'));
});
