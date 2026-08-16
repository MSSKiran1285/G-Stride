'use strict';

const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const { api, assertServerReachable } = require('../lib/apiClient');

before(assertServerReachable);

test('GET /api/data lists known fixtures', async () => {
  const { status, body } = await api.get('/api/data');
  assert.equal(status, 200);
  assert.ok(Array.isArray(body));
  assert.ok(body.includes('p2p-e2e.csv'));
});

test('GET /api/data/:file parses an existing CSV', async () => {
  const { status, body } = await api.get('/api/data/p2p-e2e.csv');
  assert.equal(status, 200);
  assert.equal(body.format, 'csv');
  assert.ok(body.headers.includes('supplier'));
  assert.ok(body.rows.length >= 1);
});

test('GET /api/data/:file for an unknown file returns an empty dataset, not 404', async () => {
  const { status, body } = await api.get('/api/data/does-not-exist.csv');
  assert.equal(status, 200);
  assert.deepEqual(body, { format: 'csv', headers: [], rows: [] });
});

test('PUT /api/data/:file rejects a non-.csv file name', async () => {
  const { status } = await api.put('/api/data/regression-sample.txt', { headers: ['a'], rows: [] });
  assert.equal(status, 400);
});

test('PUT /api/data/:file rejects a body missing rows', async () => {
  const { status } = await api.put('/api/data/regression-sample.csv', { headers: ['a'] });
  assert.equal(status, 400);
});

test('PUT then GET /api/data/:file round-trips (Data positive)', async () => {
  const dataset = {
    format: 'csv',
    headers: ['col1', 'col2'],
    rows: [
      { col1: 'a', col2: 'b' },
      { col1: 'c', col2: 'd' },
    ],
  };
  const put = await api.put('/api/data/regression-sample.csv', dataset);
  assert.equal(put.status, 200);
  assert.deepEqual(put.body, { ok: true });

  const get = await api.get('/api/data/regression-sample.csv');
  assert.equal(get.status, 200);
  assert.deepEqual(get.body, dataset);

  const list = await api.get('/api/data');
  assert.ok(list.body.includes('regression-sample.csv'));
});

test('nested JSON dataset validates, previews child work, saves, and reopens without flattening', async () => {
  const records = [
    {
      scenarioKey: 'SO-1',
      customer: 'USCU_S14',
      items: [
        { line: 10, material: 'MAT-1' },
        { line: 20, material: 'MAT-2' },
      ],
    },
    {
      scenarioKey: 'SO-2',
      customer: 'USCU_S15',
      items: [{ line: 10, material: 'MAT-3' }],
    },
  ];
  const preview = await api.post('/api/data/preview', { format: 'json', records });
  assert.equal(preview.status, 200);
  assert.equal(preview.body.transactionCount, 2);
  assert.equal(preview.body.childRecordCount, 3);

  const put = await api.put('/api/data/regression-nested.json', { format: 'json', records });
  assert.equal(put.status, 200);
  const get = await api.get('/api/data/regression-nested.json');
  assert.equal(get.status, 200);
  assert.deepEqual(get.body, { format: 'json', records });
});

test('relational CSV preview and persistence reject ambiguous data and preserve owned child rows', async () => {
  await api.put('/api/data/regression-orders.csv', {
    format: 'csv',
    headers: ['scenarioKey', 'customer'],
    rows: [
      { scenarioKey: 'A', customer: 'C1' },
      { scenarioKey: 'B', customer: 'C2' },
    ],
  });
  await api.put('/api/data/regression-items.csv', {
    format: 'csv',
    headers: ['scenarioKey', 'material'],
    rows: [
      { scenarioKey: 'A', material: 'M1' },
      { scenarioKey: 'A', material: 'M2' },
      { scenarioKey: 'B', material: 'M3' },
    ],
  });
  const definition = {
    headerFile: 'regression-orders.csv',
    childFile: 'regression-items.csv',
    headerKey: 'scenarioKey',
    childForeignKey: 'scenarioKey',
    collectionPath: 'items',
  };
  const preview = await api.post('/api/data/preview', { format: 'relational-csv', ...definition });
  assert.equal(preview.status, 200);
  assert.equal(preview.body.transactionCount, 2);
  assert.equal(preview.body.childRecordCount, 3);
  assert.deepEqual(preview.body.sample.map((record) => record.items.length), [2, 1]);

  const saved = await api.put('/api/data-relations/regression-orders-with-items.json', definition);
  assert.equal(saved.status, 200);
  assert.equal(saved.body.preview.transactionCount, 2);
  const reopened = await api.get('/api/data-relations/regression-orders-with-items.json');
  assert.deepEqual(reopened.body, definition);

  await api.put('/api/data/regression-orphans.csv', {
    format: 'csv',
    headers: ['scenarioKey', 'material'],
    rows: [{ scenarioKey: 'UNKNOWN', material: 'M4' }],
  });
  const invalid = await api.post('/api/data/preview', {
    format: 'relational-csv',
    ...definition,
    childFile: 'regression-orphans.csv',
  });
  assert.equal(invalid.status, 400);
  assert.match(invalid.body.error, /unknown header key/i);
  assert.ok(invalid.body.issues.some((issue) => issue.code === 'orphan-child-record'));
});

test('POST /api/data/parse-csv reads uploaded CSV with the same parser that reads files off disk', async () => {
  // A dataset cell can hold a JSON blob full of commas (BL-06's per-row line-item editor), which
  // is exactly what a naive split-on-comma parser destroys. Upload goes through the server so
  // there is only ever one parser, and this is the case that proves it.
  const rowsJson = '[{"material":"M1","qty":"2"},{"material":"M2","qty":"3"}]';
  const csv = [
    'supplier,lineItems,note',
    `USSU-TRL07,"${rowsJson.replace(/"/g, '""')}","says ""hello"", twice"`,
    '',
  ].join('\n');

  const parsed = await api.post('/api/data/parse-csv', { text: csv });
  assert.equal(parsed.status, 200);
  assert.deepEqual(parsed.body.headers, ['supplier', 'lineItems', 'note']);
  assert.equal(parsed.body.rows.length, 1);
  assert.equal(parsed.body.rows[0].lineItems, rowsJson, 'a JSON cell must survive the round trip intact');
  assert.equal(parsed.body.rows[0].note, 'says "hello", twice');

  // Nothing is written by parsing — the client reviews it and the ordinary save commits it.
  const listed = await api.get('/api/data');
  assert.ok(!listed.body.includes('undefined.csv'));

  const empty = await api.post('/api/data/parse-csv', { text: '   ' });
  assert.equal(empty.status, 400);
});
