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
