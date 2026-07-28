'use strict';

const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const { api, assertServerReachable } = require('../lib/apiClient');

before(assertServerReachable);

async function pollRun(id, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { body } = await api.get(`/api/runs/${id}`);
    if (body.status !== 'running') return body;
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
  throw new Error(`Run ${id} did not finish within ${timeoutMs}ms`);
}

const LIVE = { skip: !process.env.REGRESSION_LIVE && 'set REGRESSION_LIVE=1 to run — this creates real documents in the SAP tenant' };

// --- Cheap validation — no live execution, no SAP hit ---

test('POST /api/runs rejects an invalid mode', async () => {
  const { status } = await api.post('/api/runs', { mode: 'bogus' });
  assert.equal(status, 400);
});

test('POST /api/runs (chain) rejects a missing testCaseFiles/appId', async () => {
  const { status } = await api.post('/api/runs', { mode: 'chain' });
  assert.equal(status, 400);
});

test('POST /api/runs (batch) rejects a missing groupFiles', async () => {
  const { status } = await api.post('/api/runs', { mode: 'batch' });
  assert.equal(status, 400);
});

test('GET /api/runs/:id 404s for an unknown run', async () => {
  const { status } = await api.get('/api/runs/00000000-0000-0000-0000-000000000000');
  assert.equal(status, 404);
});

// --- Gated live cases — real SAP execution, real wall-clock time ---

test('live: full chain — Create PO -> Goods Receipt -> Invoice, with evidence PDF', LIVE, async () => {
  const started = await api.post('/api/runs', {
    mode: 'chain',
    testCaseFiles: ['create-po.json', 'post-goods-receipt.json', 'post-supplier-invoice.json'],
    appId: 'createPurchaseOrder',
    dataFile: 'suppliers.csv',
    headless: true,
  });
  assert.equal(started.status, 201);

  const final = await pollRun(started.body.id, 6 * 60 * 1000);
  assert.equal(final.status, 'passed');
  assert.ok(Array.isArray(final.results) && final.results.length === 1);
  assert.equal(final.results[0].status, 'passed');
  assert.ok(final.evidencePdfUrl, 'expected an evidence PDF URL');
  assert.match(final.evidencePdfUrl, /^\/audit-evidence\/[^/]+\/evidence\.pdf$/);
  assert.equal(final.evidenceDocuments.length, 1);
  assert.equal(final.evidenceDocuments[0].url, final.evidencePdfUrl);
});

test('live: suite — independent single test case (Cleanup Drafts)', LIVE, async () => {
  const started = await api.post('/api/runs', {
    mode: 'suite',
    testCaseFiles: ['cleanup-abandoned-drafts.json'],
    appId: 'createPurchaseOrder',
    headless: true,
  });
  assert.equal(started.status, 201);

  const final = await pollRun(started.body.id, 3 * 60 * 1000);
  assert.equal(final.status, 'passed');
  assert.equal(final.results.length, 1);
});

test('live: negative test — create PO is blocked without a line item', LIVE, async () => {
  const started = await api.post('/api/runs', {
    mode: 'chain',
    testCaseFiles: ['create-po-missing-item-negative.json'],
    appId: 'createPurchaseOrder',
    dataFile: 'suppliers.csv', // this test case needs ${supplier} — without a data file it fails at EnterHeaderField, not at the intended assertion
    headless: true,
  });
  assert.equal(started.status, 201);

  const final = await pollRun(started.body.id, 3 * 60 * 1000);
  // "passed" here means the negative assertion correctly detected the blocked save —
  // the test case's whole point is asserting SAP refused to save without a line item.
  assert.equal(final.status, 'passed');
});
