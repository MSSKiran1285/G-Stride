'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { DataColumnSchemaStore } = require('../packages/core/dist');

function freshStore() {
  return new DataColumnSchemaStore(':memory:');
}

test('setColumn upserts a column and listForFile returns it in first-saved order', () => {
  const store = freshStore();
  try {
    store.setColumn('orders.csv', 'supplier', { type: 'string', sensitivity: 'business', example: 'ACME Corp' });
    store.setColumn('orders.csv', 'quantity', { type: 'number', sensitivity: 'public', example: '10' });
    const rows = store.listForFile('orders.csv');
    assert.equal(rows.length, 2);
    assert.deepEqual(rows.map((r) => r.column), ['supplier', 'quantity']);
    assert.equal(rows[0].type, 'string');
    assert.equal(rows[0].sensitivity, 'business');
    assert.equal(rows[0].example, 'ACME Corp');

    // Re-saving the same column updates in place rather than duplicating.
    store.setColumn('orders.csv', 'supplier', { type: 'string', sensitivity: 'secret', example: 'Updated' });
    const rerows = store.listForFile('orders.csv');
    assert.equal(rerows.length, 2);
    assert.equal(rerows[0].sensitivity, 'secret');
    assert.equal(rerows[0].example, 'Updated');
  } finally {
    store.close();
  }
});

test('setColumn rejects an unsupported type or sensitivity', () => {
  const store = freshStore();
  try {
    assert.throws(() => store.setColumn('orders.csv', 'supplier', { type: 'currency', sensitivity: 'public' }), /Unsupported column type/);
    assert.throws(() => store.setColumn('orders.csv', 'supplier', { type: 'string', sensitivity: 'top-secret' }), /Unsupported sensitivity/);
  } finally {
    store.close();
  }
});

test('renameFile migrates every column row to the new file name', () => {
  const store = freshStore();
  try {
    store.setColumn('old-orders.csv', 'supplier', { type: 'string', sensitivity: 'public' });
    store.setColumn('old-orders.csv', 'quantity', { type: 'number', sensitivity: 'public' });
    store.renameFile('old-orders.csv', 'new-orders.csv');
    assert.deepEqual(store.listForFile('old-orders.csv'), []);
    assert.equal(store.listForFile('new-orders.csv').length, 2);
  } finally {
    store.close();
  }
});

test('removeFile drops every column row for that file, leaving others untouched', () => {
  const store = freshStore();
  try {
    store.setColumn('orders.csv', 'supplier', { type: 'string', sensitivity: 'public' });
    store.setColumn('other.csv', 'material', { type: 'string', sensitivity: 'public' });
    store.removeFile('orders.csv');
    assert.deepEqual(store.listForFile('orders.csv'), []);
    assert.equal(store.listForFile('other.csv').length, 1);
  } finally {
    store.close();
  }
});

test('pruneColumnsNotIn drops only columns absent from the current header set', () => {
  const store = freshStore();
  try {
    store.setColumn('orders.csv', 'supplier', { type: 'string', sensitivity: 'public' });
    store.setColumn('orders.csv', 'quantity', { type: 'number', sensitivity: 'public' });
    store.pruneColumnsNotIn('orders.csv', ['supplier']);
    const rows = store.listForFile('orders.csv');
    assert.deepEqual(rows.map((r) => r.column), ['supplier']);
  } finally {
    store.close();
  }
});
