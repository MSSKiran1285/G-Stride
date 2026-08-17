'use strict';

/**
 * How many times AddLineItem presses the grid's add-a-row control, and when.
 *
 * This is the arithmetic that decides how many line items a real SAP document ends up with, so
 * it is asserted rather than left to a live run to discover. 'before' creates each row ahead of
 * filling it, so N rows need N clicks. 'after' commits the row just filled and moves the
 * creation row on, so it needs a click BETWEEN rows and none after the last — committing does
 * not clear the creation row, and a trailing click leaves it holding the last row's values for
 * the caller's save step to persist a second time.
 *
 * That trailing click put a duplicate line on every Sales Order the O2C suite created between
 * 24 Jul and 16 Aug 2026 (SO 336722: one row in, items 10 and 20 both qty 10; SO 337657: two
 * rows in, items 10/20/30 with 30 duplicating 20). It passed unnoticed because the module
 * reports what it fed in, never what the document ended up holding.
 */

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

/** Records every action in order, so both the count and the interleaving can be asserted. */
function recordingAdapter(actions) {
  return {
    waitFor: async () => ({}),
    performAction: async (locator, action, value) => {
      if (locator.tableCell) actions.push(`fill:row${locator.tableCell.rowIndex}=${value}`);
      else actions.push('click');
      return {};
    },
  };
}

async function run(rows, addClickTiming) {
  const repo = repository();
  const actions = [];
  try {
    await new ModuleRegistry().get('AddLineItem').execute({
      adapter: recordingAdapter(actions),
      objectRepository: repo,
      appId: 'salesOrder',
      params: { rows: JSON.stringify(rows), ...(addClickTiming ? { addClickTiming } : {}) },
      runState: {},
    });
  } finally {
    repo.close();
  }
  return actions;
}

const TWO_ROWS = [{ ProductColumn: 'A' }, { ProductColumn: 'B' }];
const ONE_ROW = [{ ProductColumn: 'A' }];

test('AddLineItem clicks add once per row before filling it when timing is "before"', async () => {
  const actions = await run(TWO_ROWS, 'before');
  assert.deepEqual(actions, [
    'click',
    'fill:row0=A',
    'click',
    'fill:row1=B',
  ]);
  assert.equal(actions.filter((a) => a === 'click').length, TWO_ROWS.length);
});

test('"before" is the default when no timing is given', async () => {
  assert.deepEqual(await run(ONE_ROW), ['click', 'fill:row0=A']);
});

test('AddLineItem clicks add BETWEEN rows only when timing is "after"', async () => {
  const actions = await run(TWO_ROWS, 'after');
  assert.deepEqual(actions, [
    'fill:row0=A',
    'click',
    'fill:row1=B',
  ]);
  assert.equal(
    actions.filter((a) => a === 'click').length,
    TWO_ROWS.length - 1,
    'a click after the last row would leave the creation row populated for the save step to commit again'
  );
});

test('a single row with timing "after" is never committed by AddLineItem itself', async () => {
  // The regression in its smallest form: one row used to produce one click, and the document
  // came out with two identical line items.
  assert.deepEqual(await run(ONE_ROW, 'after'), ['fill:row0=A']);
});

test('the add-click count is one less than the row count for any "after" row set', async () => {
  for (const size of [1, 2, 3, 7]) {
    const rows = Array.from({ length: size }, (_, i) => ({ ProductColumn: `P${i}` }));
    const clicks = (await run(rows, 'after')).filter((a) => a === 'click').length;
    assert.equal(clicks, size - 1, `expected ${size - 1} clicks for ${size} rows`);
  }
});

test('AddLineItem still reports the row count it was given, not the click count', async () => {
  const repo = repository();
  const runState = {};
  try {
    await new ModuleRegistry().get('AddLineItem').execute({
      adapter: recordingAdapter([]),
      objectRepository: repo,
      appId: 'salesOrder',
      params: { rows: JSON.stringify(TWO_ROWS), addClickTiming: 'after' },
      runState,
    });
  } finally {
    repo.close();
  }
  assert.equal(runState.lineItemCount, 2);
});
