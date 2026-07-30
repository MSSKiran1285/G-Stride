'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ObjectRepository } = require('../packages/core/dist');
const { ModuleRegistry } = require('../packages/engine/dist');

function repository() {
  const repo = new ObjectRepository(':memory:');
  repo.upsert({
    appId: 'salesOrder',
    name: 'AddLineItemButton',
    controlId: 'add-button',
    bindingPath: null,
    controlType: 'sap.m.Button',
    tableId: null,
    label: null,
    parentControlId: null,
  });
  repo.upsert({
    appId: 'salesOrder',
    name: 'ProductColumn',
    controlId: 'product-column',
    bindingPath: null,
    controlType: 'sap.ui.table.Column',
    tableId: 'items-table',
    label: null,
    parentControlId: null,
  });
  return repo;
}

function adapter(failAtRow) {
  return {
    waitFor: async () => ({}),
    performAction: async (locator) => {
      if (failAtRow !== undefined && locator.tableCell?.rowIndex === failAtRow) throw new Error('Synthetic cell failure');
      return {};
    },
  };
}

test('AddLineItem reports bounded child progress for every owned line item', async () => {
  const repo = repository();
  const progress = [];
  try {
    await new ModuleRegistry().get('AddLineItem').execute({
      adapter: adapter(),
      objectRepository: repo,
      appId: 'salesOrder',
      params: {
        rows: JSON.stringify([
          { ProductColumn: 'A' },
          { ProductColumn: 'B' },
        ]),
      },
      runState: {},
      onChildProgress: (event) => progress.push(event),
    });
    assert.deepEqual(progress.map(({ completed, total, status, currentKey }) => ({
      completed,
      total,
      status,
      currentKey,
    })), [
      { completed: 0, total: 2, status: 'running', currentKey: '1' },
      { completed: 1, total: 2, status: 'passed', currentKey: '1' },
      { completed: 1, total: 2, status: 'running', currentKey: '2' },
      { completed: 2, total: 2, status: 'passed', currentKey: '2' },
    ]);
  } finally {
    repo.close();
  }
});

test('AddLineItem identifies the failing child index and does not overstate completion', async () => {
  const repo = repository();
  const progress = [];
  try {
    await assert.rejects(
      () => new ModuleRegistry().get('AddLineItem').execute({
        adapter: adapter(1),
        objectRepository: repo,
        appId: 'salesOrder',
        params: {
          rows: JSON.stringify([
            { ProductColumn: 'A' },
            { ProductColumn: 'B' },
          ]),
        },
        runState: {},
        onChildProgress: (event) => progress.push(event),
      }),
      /child row 2 \(2\)/
    );
    assert.deepEqual(progress.at(-1), {
      label: 'Line items',
      completed: 1,
      total: 2,
      currentIndex: 1,
      currentKey: '2',
      status: 'failed',
      error: 'Synthetic cell failure',
    });
  } finally {
    repo.close();
  }
});
