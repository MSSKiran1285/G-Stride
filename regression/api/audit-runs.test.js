'use strict';

const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const { api, assertServerReachable } = require('../lib/apiClient');
const { RunHistoryStore, DocumentLog } = require('../../packages/core/dist');

before(assertServerReachable);

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required — run this file through regression/run-isolated-api.js, not node --test directly.`);
  return value;
}

function seedRun(store, overrides) {
  store.record({
    id: 'audit-regression-run',
    startedAt: '2026-01-01T00:00:00.000Z',
    finishedAt: '2026-01-01T00:00:05.000Z',
    status: 'passed',
    executedBy: 'regression-executor',
    mode: 'chain',
    appId: 'regressionAuditApp',
    testCaseNames: ['Regression Audit Test'],
    testCaseFiles: ['regression-audit-test.json'],
    result: { ok: true },
    ...overrides,
  });
}

test('GET /api/audit/runs supports every AC1 filter and reports X-Total-Count for pagination (BL-035 AC1/AC2)', async () => {
  const store = new RunHistoryStore(requireEnv('REGRESSION_RUN_HISTORY_DB'));
  try {
    seedRun(store, { id: 'audit-regression-alpha', appId: 'regressionAuditAlpha', executedBy: 'alice-regression', targetHostname: 'alpha.sap.example.invalid', targetSafetyClass: 'non-production', studioRunId: 'regression-exec-alpha' });
    seedRun(store, { id: 'audit-regression-beta', appId: 'regressionAuditBeta', status: 'failed', executedBy: 'bob-regression', startedAt: '2026-03-01T00:00:00.000Z', finishedAt: '2026-03-01T00:00:02.000Z', targetSafetyClass: 'production-like', studioRunId: 'regression-exec-beta', parentStudioRunId: 'regression-exec-alpha' });

    const byAppId = await api.get('/api/audit/runs?appId=regressionAuditAlpha');
    assert.equal(byAppId.status, 200);
    assert.ok(byAppId.body.some((r) => r.id === 'audit-regression-alpha'));
    assert.ok(!byAppId.body.some((r) => r.id === 'audit-regression-beta'));

    const byStatus = await api.get('/api/audit/runs?status=failed&runId=audit-regression-beta');
    assert.deepEqual(byStatus.body.map((r) => r.id), ['audit-regression-beta']);

    const byExecutedBy = await api.get('/api/audit/runs?executedBy=bob-regression');
    assert.ok(byExecutedBy.body.every((r) => r.executedBy === 'bob-regression'));

    const byEnvironment = await api.get('/api/audit/runs?environment=production-like');
    assert.ok(byEnvironment.body.some((r) => r.id === 'audit-regression-beta'));
    assert.ok(!byEnvironment.body.some((r) => r.id === 'audit-regression-alpha'));

    const byDate = await api.get('/api/audit/runs?dateFrom=2026-02-01T00:00:00.000Z&runId=audit-regression');
    assert.deepEqual(byDate.body.map((r) => r.id), ['audit-regression-beta']);

    const invalidStatus = await api.get('/api/audit/runs?status=bogus');
    assert.equal(invalidStatus.status, 400);

    const paged = await api.get('/api/audit/runs?runId=audit-regression&limit=1&offset=0&sortBy=startedAt&sortDirection=asc');
    assert.equal(paged.body.length, 1);
    assert.equal(paged.body[0].id, 'audit-regression-alpha');
    const total = Number(paged.headers.get('x-total-count'));
    assert.ok(total >= 2, `expected X-Total-Count to be at least 2, got ${total}`);
  } finally {
    store.close();
  }
});

test('GET /api/audit/runs/:id/documents returns only that run\'s captured document values (BL-035 AC4)', async () => {
  const store = new RunHistoryStore(requireEnv('REGRESSION_RUN_HISTORY_DB'));
  const documentLog = new DocumentLog(requireEnv('REGRESSION_DOCUMENT_LOG_DB'));
  try {
    seedRun(store, { id: 'audit-regression-documents' });
    documentLog.record({ appId: 'regressionAuditApp', testCaseName: 'Regression Audit Test', key: 'poNumber', value: '4500009999', capturedAt: '2026-01-01T00:00:00.000Z', runId: 'audit-regression-documents' });
    documentLog.record({ appId: 'regressionAuditApp', testCaseName: 'Regression Audit Test', key: 'poNumber', value: 'unrelated-value', capturedAt: '2026-01-01T00:00:00.000Z', runId: 'some-other-run' });

    const documents = await api.get('/api/audit/runs/audit-regression-documents/documents');
    assert.equal(documents.status, 200);
    assert.equal(documents.body.length, 1);
    assert.equal(documents.body[0].value, '4500009999');

    const detail = await api.get('/api/audit/runs/audit-regression-documents');
    assert.equal(detail.status, 200);
    assert.deepEqual(detail.body.testCaseFiles, ['regression-audit-test.json']);
  } finally {
    store.close();
    documentLog.close();
  }
});

// BL-046 — the grouping tree's roll-up counts. The tree exists to make a large ledger navigable,
// which it can only do if each node states how much sits underneath it across the WHOLE filtered
// ledger. Counts derived from the visible page would renumber as you paged and would be worse
// than no tree at all, so these assertions deliberately seed more runs than one page holds.
test('GET /api/audit/runs/groups rolls up counts per App ID across the whole ledger, not a page (BL-046 AC1)', async () => {
  const store = new RunHistoryStore(requireEnv('REGRESSION_RUN_HISTORY_DB'));
  try {
    for (let i = 0; i < 12; i += 1) {
      seedRun(store, {
        id: `bl046-alpha-${i}`,
        appId: 'bl046Alpha',
        status: i % 3 === 0 ? 'failed' : 'passed',
      });
    }
    for (let i = 0; i < 5; i += 1) {
      seedRun(store, { id: `bl046-beta-${i}`, appId: 'bl046Beta', status: 'passed' });
    }

    const res = await api.get('/api/audit/runs/groups');
    assert.equal(res.status, 200);
    const byApp = Object.fromEntries(res.body.map((g) => [g.appId, g]));

    // 12 alpha runs: i = 0,3,6,9 failed -> 4 failed, 8 passed.
    assert.equal(byApp.bl046Alpha.total, 12);
    assert.equal(byApp.bl046Alpha.failed, 4);
    assert.equal(byApp.bl046Alpha.passed, 8);
    assert.equal(byApp.bl046Beta.total, 5);
    assert.equal(byApp.bl046Beta.passed, 5);
    assert.equal(byApp.bl046Beta.failed, 0);
    assert.ok(byApp.bl046Alpha.lastStartedAt, 'expected a most-recent timestamp per group');
  } finally {
    store.close();
  }
});

// The tree and the grid must never disagree about what exists. Both go through the same
// buildWhere predicate, so a filter applied to one has to move the other identically.
test('GET /api/audit/runs/groups honours the same filters as the run list (BL-046 AC2)', async () => {
  const store = new RunHistoryStore(requireEnv('REGRESSION_RUN_HISTORY_DB'));
  try {
    seedRun(store, { id: 'bl046-filter-pass', appId: 'bl046Filter', status: 'passed' });
    seedRun(store, { id: 'bl046-filter-fail', appId: 'bl046Filter', status: 'failed' });

    const failedOnly = await api.get('/api/audit/runs/groups?status=failed');
    assert.equal(failedOnly.status, 200);
    const group = failedOnly.body.find((g) => g.appId === 'bl046Filter');
    assert.equal(group.total, 1);
    assert.equal(group.failed, 1);
    assert.equal(group.passed, 0);

    // The same filter through the list endpoint must agree with the tree.
    const listed = await api.get('/api/audit/runs?status=failed&appId=bl046Filter');
    assert.equal(Number(listed.headers.get('x-total-count')), 1);
  } finally {
    store.close();
  }
});

// Process area comes from the same appId tag store the rest of the product groups by, so the
// ledger's tree matches how Tests, datasets and Objects are already organised rather than
// inventing a second taxonomy that only audit uses.
test('GET /api/audit/runs/groups reports each App ID\'s process area from the shared tag store (BL-046 AC1)', async () => {
  const store = new RunHistoryStore(requireEnv('REGRESSION_RUN_HISTORY_DB'));
  try {
    seedRun(store, { id: 'bl046-tagged', appId: 'bl046Tagged', status: 'passed' });
    await api.put('/api/tags/appId/bl046Tagged', { processArea: 'Procurement' });

    const res = await api.get('/api/audit/runs/groups');
    const tagged = res.body.find((g) => g.appId === 'bl046Tagged');
    assert.equal(tagged.processArea, 'Procurement');

    // An untagged App ID reports an empty area rather than being dropped — an audit view must
    // never hide runs just because nobody has classified their application yet.
    const untagged = res.body.find((g) => g.appId === 'bl046Alpha' || g.appId === 'regressionAuditApp');
    assert.ok(untagged, 'expected untagged App IDs to still appear in the tree');
    assert.equal(typeof untagged.processArea, 'string');
  } finally {
    store.close();
  }
});
