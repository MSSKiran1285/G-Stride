'use strict';

/**
 * columnMap: the Test states which data columns mean which controls.
 *
 * Without it, every key in a row is taken to be a captured object name. That forces the data file
 * to carry SAP control names, and makes any extra column fatal — which is why a relational CSV
 * could not drive this module at all: the join the header/child files produce hands each child
 * row over complete with its foreign key, and that key resolved to "no control named orderRef".
 *
 * With a map, unmapped columns are ignored by design rather than by luck, so a child CSV can be
 * a plain business spreadsheet. A mapped column pointing at a control that does not exist is
 * still a loud failure — the map removes the coupling, not the safety.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ObjectRepository } = require('../packages/core/dist');
const { ModuleRegistry } = require('../packages/engine/dist');

const COLUMN_MAP = JSON.stringify({
  material: 'lineItemProductField',
  qty: 'lineItemQuantityField',
});

function repository() {
  const repo = new ObjectRepository(':memory:');
  repo.upsert({
    appId: 'so',
    name: 'AddLineItemButton',
    controlId: 'add-button',
    bindingPath: null,
    controlType: 'sap.m.Button',
    tableId: null,
    label: null,
    parentControlId: null,
  });
  for (const name of ['lineItemProductField', 'lineItemQuantityField']) {
    repo.upsert({
      appId: 'so',
      name,
      controlId: name,
      bindingPath: null,
      controlType: 'sap.ui.table.Column',
      tableId: 'items-table',
      label: null,
      parentControlId: null,
    });
  }
  return repo;
}

function recordingAdapter(filled) {
  return {
    waitFor: async () => ({}),
    performAction: async (locator, action, value) => {
      // columnId is the captured control's own id, so this records WHICH control each value
      // reached — asserting on values alone would pass even if the map sent them to the
      // wrong column.
      if (locator.tableCell) filled.push({ object: locator.tableCell.columnId, value });
      return {};
    },
  };
}

async function run(rows, params = {}) {
  const repo = repository();
  const filled = [];
  try {
    await new ModuleRegistry().get('AddLineItem').execute({
      adapter: recordingAdapter(filled),
      objectRepository: repo,
      appId: 'so',
      params: { rows: JSON.stringify(rows), addClickTiming: 'after', ...params },
      runState: {},
    });
  } finally {
    repo.close();
  }
  return filled;
}

/** Exactly the shape loadTransactionData produces for a header/child join. */
const JOINED_CHILD_ROWS = [
  { orderRef: 'SO-2', material: 'MAT-A', qty: '5' },
  { orderRef: 'SO-2', material: 'MAT-B', qty: '1' },
];

test('a joined child row carrying its foreign key is driven without the key becoming a control lookup', async () => {
  const filled = await run(JOINED_CHILD_ROWS, { columnMap: COLUMN_MAP });
  assert.deepEqual(filled, [
    { object: 'lineItemProductField', value: 'MAT-A' },
    { object: 'lineItemQuantityField', value: '5' },
    { object: 'lineItemProductField', value: 'MAT-B' },
    { object: 'lineItemQuantityField', value: '1' },
  ]);
});

test('without a map the same joined row fails on its foreign key — the behaviour columnMap exists to fix', async () => {
  await assert.rejects(
    () => run(JOINED_CHILD_ROWS),
    /no control named "orderRef"/,
  );
});

test('columns absent from the map are ignored, however many there are', async () => {
  const filled = await run(
    [{ orderRef: 'SO-9', material: 'MAT-A', qty: '2', comment: 'rush', costCentre: 'CC-1' }],
    { columnMap: COLUMN_MAP },
  );
  assert.equal(filled.length, 2, 'only the two mapped columns should reach the screen');
});

test('a mapped column missing from a row is skipped rather than filled blank', async () => {
  const filled = await run([{ material: 'MAT-A' }], { columnMap: COLUMN_MAP });
  assert.deepEqual(filled.map(({ value }) => value), ['MAT-A']);
});

test('a blank mapped value still skips the cell, so a price can auto-derive', async () => {
  const filled = await run([{ material: 'MAT-A', qty: '' }], { columnMap: COLUMN_MAP });
  assert.deepEqual(filled.map(({ value }) => value), ['MAT-A']);
});

test('cells are filled in the order the map declares, not the order the row happens to serialise', async () => {
  const filled = await run(
    [{ qty: '7', material: 'MAT-Z' }],
    { columnMap: COLUMN_MAP },
  );
  assert.deepEqual(filled, [
    { object: 'lineItemProductField', value: 'MAT-Z' },
    { object: 'lineItemQuantityField', value: '7' },
  ]);
});

test('a mapped object that does not exist is still a loud failure', async () => {
  await assert.rejects(
    () => run([{ material: 'MAT-A' }], { columnMap: JSON.stringify({ material: 'noSuchField' }) }),
    /no control named "noSuchField"/,
  );
});

test('malformed columnMap is rejected with a message that says the shape', async () => {
  await assert.rejects(
    () => run([{ material: 'MAT-A' }], { columnMap: 'not json' }),
    /"columnMap" must be a JSON object of \{data column: object name\}/,
  );
  await assert.rejects(
    () => run([{ material: 'MAT-A' }], { columnMap: '["material"]' }),
    /"columnMap" must be a JSON object of \{data column: object name\}/,
  );
});

test('a map entry with no object name is rejected rather than silently dropping the column', async () => {
  await assert.rejects(
    () => run([{ material: 'MAT-A' }], { columnMap: JSON.stringify({ material: '  ' }) }),
    /leaves "material" without an object name/,
  );
});

test('omitting columnMap keeps the original behaviour, where keys are object names', async () => {
  const filled = await run([{ lineItemProductField: 'MAT-A', lineItemQuantityField: '3' }]);
  assert.deepEqual(filled.map(({ value }) => value), ['MAT-A', '3']);
});
