'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { RunHistoryStore, DocumentLog } = require('../packages/core/dist');

function freshStore() {
  return new RunHistoryStore(':memory:');
}

function entry(overrides) {
  return {
    id: 'run-1',
    startedAt: '2026-01-01T00:00:00.000Z',
    finishedAt: '2026-01-01T00:00:05.000Z',
    status: 'passed',
    executedBy: 'alice',
    mode: 'chain',
    appId: 'app1',
    testCaseNames: ['Create Purchase Order'],
    result: { ok: true },
    ...overrides,
  };
}

test('record computes durationMs and list/get round-trip every new field (BL-035 AC1/AC3/AC4)', () => {
  const store = freshStore();
  try {
    store.record(entry({
      id: 'run-1',
      testCaseFiles: ['create-po.json'],
      studioRunId: 'exec-1',
      parentStudioRunId: 'exec-0',
      targetHostname: 'sap-dev.example.invalid',
      targetSafetyClass: 'non-production',
    }));
    const page = store.list();
    assert.equal(page.total, 1);
    assert.equal(page.items[0].durationMs, 5000);
    assert.deepEqual(page.items[0].testCaseFiles, ['create-po.json']);
    assert.equal(page.items[0].studioRunId, 'exec-1');
    assert.equal(page.items[0].parentStudioRunId, 'exec-0');
    assert.equal(page.items[0].targetHostname, 'sap-dev.example.invalid');
    assert.equal(page.items[0].targetSafetyClass, 'non-production');

    const full = store.get('run-1');
    assert.equal(full.result.ok, true);
    assert.equal(full.studioRunId, 'exec-1');
    // HC-030: get()'s own SQL query must select duration_ms too, not only list()'s.
    assert.equal(full.durationMs, 5000);
  } finally {
    store.close();
  }
});

test('get() and list() compute durationMs from timestamps for a ledger row recorded before that column existed (HC-030)', () => {
  const store = freshStore();
  try {
    // The runs table is append-only (no UPDATE/DELETE) by design, so a pre-migration row with a
    // NULL duration_ms can never be backfilled in place — insert one directly (record() cannot
    // produce a NULL duration_ms) to simulate exactly that shape.
    store.db.prepare(`
      INSERT INTO runs (id, started_at, finished_at, status, executed_by, mode, app_id, test_case_names, result_json, duration_ms)
      VALUES ('run-legacy-2', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:07.000Z', 'passed', 'alice', 'chain', 'app1', '["Legacy Run"]', '{}', NULL)
    `).run();

    const fetched = store.get('run-legacy-2');
    assert.equal(fetched.durationMs, 7000, 'expected get() to fall back to computing duration from timestamps');

    const listed = store.list({ runId: 'run-legacy-2' }).items[0];
    assert.equal(listed.durationMs, 7000, 'expected list() to fall back to computing duration from timestamps');
  } finally {
    store.close();
  }
});

test('every AC1 filter narrows the result set independently', () => {
  const store = freshStore();
  try {
    store.record(entry({ id: 'run-a', appId: 'app1', status: 'passed', mode: 'chain', executedBy: 'alice', testCaseNames: ['Create Purchase Order'], startedAt: '2026-01-01T00:00:00.000Z', finishedAt: '2026-01-01T00:00:01.000Z', targetHostname: 'sap-dev.example.invalid' }));
    store.record(entry({ id: 'run-b', appId: 'app2', status: 'failed', mode: 'suite', executedBy: 'bob', testCaseNames: ['Post Goods Receipt'], startedAt: '2026-02-01T00:00:00.000Z', finishedAt: '2026-02-01T00:00:01.000Z', targetSafetyClass: 'production-like' }));

    assert.deepEqual(store.list({ appId: 'app1' }).items.map((r) => r.id), ['run-a']);
    assert.deepEqual(store.list({ status: 'failed' }).items.map((r) => r.id), ['run-b']);
    assert.deepEqual(store.list({ mode: 'suite' }).items.map((r) => r.id), ['run-b']);
    assert.deepEqual(store.list({ runId: 'run-a' }).items.map((r) => r.id), ['run-a']);
    assert.deepEqual(store.list({ executedBy: 'bob' }).items.map((r) => r.id), ['run-b']);
    assert.deepEqual(store.list({ artifact: 'Goods Receipt' }).items.map((r) => r.id), ['run-b']);
    assert.deepEqual(store.list({ environment: 'sap-dev' }).items.map((r) => r.id), ['run-a']);
    assert.deepEqual(store.list({ environment: 'production-like' }).items.map((r) => r.id), ['run-b']);
    assert.deepEqual(store.list({ dateFrom: '2026-01-15T00:00:00.000Z' }).items.map((r) => r.id), ['run-b']);
    assert.deepEqual(store.list({ dateTo: '2026-01-15T00:00:00.000Z' }).items.map((r) => r.id), ['run-a']);
    assert.deepEqual(store.list({ query: 'bob' }).items.map((r) => r.id), ['run-b']);
  } finally {
    store.close();
  }
});

test('pagination returns the correct slice and total across pages (BL-035 AC2)', () => {
  const store = freshStore();
  try {
    for (let i = 1; i <= 5; i++) {
      store.record(entry({ id: `run-${i}`, startedAt: `2026-01-0${i}T00:00:00.000Z`, finishedAt: `2026-01-0${i}T00:00:01.000Z` }));
    }
    const firstPage = store.list({ limit: 2, offset: 0, sortBy: 'startedAt', sortDirection: 'asc' });
    assert.equal(firstPage.total, 5);
    assert.deepEqual(firstPage.items.map((r) => r.id), ['run-1', 'run-2']);

    const secondPage = store.list({ limit: 2, offset: 2, sortBy: 'startedAt', sortDirection: 'asc' });
    assert.deepEqual(secondPage.items.map((r) => r.id), ['run-3', 'run-4']);

    const lastPage = store.list({ limit: 2, offset: 4, sortBy: 'startedAt', sortDirection: 'asc' });
    assert.deepEqual(lastPage.items.map((r) => r.id), ['run-5']);
  } finally {
    store.close();
  }
});

test('sort by durationMs and status in both directions (BL-035 AC2)', () => {
  const store = freshStore();
  try {
    store.record(entry({ id: 'short', status: 'failed', startedAt: '2026-01-01T00:00:00.000Z', finishedAt: '2026-01-01T00:00:01.000Z' }));
    store.record(entry({ id: 'long', status: 'passed', startedAt: '2026-01-02T00:00:00.000Z', finishedAt: '2026-01-02T00:10:00.000Z' }));

    assert.deepEqual(
      store.list({ sortBy: 'durationMs', sortDirection: 'asc' }).items.map((r) => r.id),
      ['short', 'long']
    );
    assert.deepEqual(
      store.list({ sortBy: 'durationMs', sortDirection: 'desc' }).items.map((r) => r.id),
      ['long', 'short']
    );
    assert.deepEqual(
      store.list({ sortBy: 'status', sortDirection: 'asc' }).items.map((r) => r.id),
      ['short', 'long'] // "failed" < "passed" alphabetically
    );
  } finally {
    store.close();
  }
});

test('studioRunId groups an execution\'s sibling iterations and finds a rerun\'s source execution (BL-035 AC3 lineage)', () => {
  const store = freshStore();
  try {
    store.record(entry({ id: 'source-1', studioRunId: 'exec-source' }));
    store.record(entry({ id: 'source-2', studioRunId: 'exec-source' }));
    store.record(entry({ id: 'rerun-1', studioRunId: 'exec-rerun', parentStudioRunId: 'exec-source' }));

    const siblings = store.list({ studioRunId: 'exec-source' });
    assert.equal(siblings.total, 2);
    assert.deepEqual(new Set(siblings.items.map((r) => r.id)), new Set(['source-1', 'source-2']));

    const rerun = store.get('rerun-1');
    assert.equal(rerun.parentStudioRunId, 'exec-source');
  } finally {
    store.close();
  }
});

test("DocumentLog.list filters to one run's captured document values (BL-035 AC4)", () => {
  const log = new DocumentLog(':memory:');
  try {
    log.record({ appId: 'app1', testCaseName: 'Create PO', key: 'poNumber', value: '4500000123', capturedAt: '2026-01-01T00:00:00.000Z', runId: 'run-a' });
    log.record({ appId: 'app1', testCaseName: 'Create PO', key: 'supplier', value: 'ACME', capturedAt: '2026-01-01T00:00:00.000Z', runId: 'run-a' });
    log.record({ appId: 'app1', testCaseName: 'Create Invoice', key: 'invoiceNumber', value: '190000456', capturedAt: '2026-01-01T00:00:00.000Z', runId: 'run-b' });

    const forRunA = log.list({ runId: 'run-a' });
    assert.equal(forRunA.length, 2);
    assert.deepEqual(new Set(forRunA.map((d) => d.key)), new Set(['poNumber', 'supplier']));

    const forRunB = log.list({ runId: 'run-b' });
    assert.equal(forRunB.length, 1);
    assert.equal(forRunB[0].key, 'invoiceNumber');
  } finally {
    log.close();
  }
});
