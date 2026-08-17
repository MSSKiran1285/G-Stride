'use strict';

/**
 * The per-transaction line-item distribution shown in the execution review.
 *
 * The server reports one total. "12 line items" is the same number whether it means one order of
 * twelve or six orders of two, and those are very different things to authorise against a real
 * SAP tenant — so the review breaks it down per transaction. This asserts the counting agrees
 * with the server's own countChildren for the two shapes line items actually arrive in: nested
 * from a relational join, and as JSON inside a single CSV cell.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');

// The panel is TSX and studio-web deliberately does not depend on @taf/core (core links
// better-sqlite3, which cannot be bundled for a browser — see types.ts, which mirrors core's
// types by hand for the same reason). So the function is read out of source and evaluated rather
// than imported. It is small, pure and has no imports of its own; if that stops being true this
// test fails loudly rather than drifting silently.
function loadChildRecordsIn() {
  const source = readFileSync(
    path.join(__dirname, '..', 'packages', 'studio-web', 'src', 'components', 'RunPanel.tsx'),
    'utf-8'
  );
  const start = source.indexOf('function childRecordsIn(');
  assert.notEqual(start, -1, 'childRecordsIn has been renamed or removed from RunPanel');
  const end = source.indexOf('\n}', start);
  assert.notEqual(end, -1, 'childRecordsIn is not closed at column 0 as expected');
  const body = source
    .slice(start, end + 2)
    .replace(/\)\s*:\s*number\s*\{/, ') {')   // return type
    .replace(/:\s*unknown/g, '')              // parameter types
    .replace(/ as unknown/g, '');             // assertions
  assert.equal(/:\s*(number|string|unknown)\b/.test(body), false, 'unstripped type annotation remains');
  // eslint-disable-next-line no-new-func
  return new Function(`${body}; return childRecordsIn;`)();
}

const childRecordsIn = loadChildRecordsIn();

test('a relational join nests its children, and each parent is counted on its own', () => {
  const records = [
    { orderRef: 'SO-1', items: [{ material: 'A' }] },
    { orderRef: 'SO-2', items: [{ material: 'A' }, { material: 'B' }, { material: 'C' }] },
  ];
  assert.deepEqual(records.map(childRecordsIn), [1, 3]);
});

test('line items held as JSON inside one CSV cell are counted the same way', () => {
  const records = [
    { orderRef: 'SO-1', lineItems: '[{"material":"A"},{"material":"B"}]' },
    { orderRef: 'SO-2', lineItems: '[{"material":"A"}]' },
  ];
  assert.deepEqual(records.map(childRecordsIn), [2, 1]);
});

test('a flat transaction with no children counts zero, so the breakdown stays hidden', () => {
  assert.equal(childRecordsIn({ orderRef: 'SO-1', soldToParty: 'C-1000' }), 0);
});

test('an ordinary value that merely starts with a bracket is not mistaken for a row set', () => {
  assert.equal(childRecordsIn({ note: '[urgent] ship today' }), 0);
});

test('the distribution distinguishes runs the single total cannot', () => {
  const oneBigOrder = [{ items: Array.from({ length: 12 }, () => ({ material: 'A' })) }];
  const sixSmallOrders = Array.from({ length: 6 }, () => ({ items: [{ material: 'A' }, { material: 'B' }] }));
  const sum = (records) => records.map(childRecordsIn).reduce((a, b) => a + b, 0);

  assert.equal(sum(oneBigOrder), 12);
  assert.equal(sum(sixSmallOrders), 12);
  assert.deepEqual(oneBigOrder.map(childRecordsIn), [12]);
  assert.deepEqual(sixSmallOrders.map(childRecordsIn), [2, 2, 2, 2, 2, 2]);
});
