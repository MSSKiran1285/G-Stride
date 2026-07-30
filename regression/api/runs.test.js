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

const LIVE = {
  skip: !process.env.REGRESSION_LIVE
    && 'set REGRESSION_LIVE=1 to run the read-only matrix against the configured non-production SAP target',
};
const TRANSACTIONAL_LIVE = {
  skip: !process.env.REGRESSION_LIVE_TRANSACTIONAL
    && 'set REGRESSION_LIVE_TRANSACTIONAL=1 only after test-data ownership, fail-stop retention, and live-run approval are confirmed',
};
const EXECUTION = {
  skip: !process.env.REGRESSION_ISOLATED
    && !process.env.REGRESSION_ALLOW_EXECUTION
    && 'run through the isolated harness or set REGRESSION_ALLOW_EXECUTION=1',
};

async function startApprovedRun(body) {
  const executionKind = body.mode === 'chain'
    ? 'businessProcess'
    : body.mode === 'suite' || body.mode === 'batch'
      ? 'regressionPack'
      : 'singleTest';
  const draft = {
    ...body,
    executionKind,
    testCaseFiles: body.testCaseFiles ?? [],
    groupFiles: body.groupFiles ?? [],
    appId: body.appId ?? '',
    sessionPolicy: body.sessionPolicy ?? 'fresh-per-iteration',
    iterationFailurePolicy: body.iterationFailurePolicy
      ?? (body.mode === 'chain' ? 'stop-execution' : 'continue-next-iteration'),
  };
  const preflight = await api.post('/api/executions/preflight', draft);
  assert.equal(preflight.status, 200);
  assert.equal(preflight.body.ready, true);
  return api.post('/api/runs', {
    ...draft,
    preflightToken: preflight.body.preflightToken,
    planHash: preflight.body.planHash,
    acknowledgedWarnings: preflight.body.findings
      .filter((finding) => finding.requiresAcknowledgement)
      .map((finding) => finding.code),
  });
}

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

test('POST /api/runs completes a synthetic headless Chain', EXECUTION, async () => {
  const started = await startApprovedRun({
    mode: 'chain',
    testCaseFiles: ['cleanup-abandoned-drafts.json', 'synthetic-second-stage.json'],
    appId: 'syntheticApp',
    headless: true,
  });
  assert.equal(started.status, 201);

  const final = await pollRun(started.body.id, 30_000);
  assert.equal(final.status, 'passed');
  assert.equal(final.results.length, 1);
});

test('POST /api/runs completes a synthetic headless Suite', EXECUTION, async () => {
  const started = await startApprovedRun({
    mode: 'suite',
    testCaseFiles: ['cleanup-abandoned-drafts.json', 'synthetic-second-stage.json'],
    appId: 'syntheticApp',
    headless: true,
  });
  assert.equal(started.status, 201);

  const final = await pollRun(started.body.id, 30_000);
  assert.equal(final.status, 'passed');
  assert.equal(final.results.length, 2);
});

test('POST /api/runs completes a synthetic headless multi-group Batch', EXECUTION, async () => {
  const started = await startApprovedRun({
    mode: 'batch',
    groupFiles: ['cleanup-drafts.json', 'synthetic-process.json'],
    headless: true,
  });
  assert.equal(started.status, 201);

  const final = await pollRun(started.body.id, 30_000);
  assert.equal(final.status, 'passed');
  assert.equal(final.groupResults.length, 2);
});

test('rerun requires an explicit difference review and records immutable lineage', EXECUTION, async () => {
  const started = await startApprovedRun({
    mode: 'chain',
    testCaseFiles: ['cleanup-abandoned-drafts.json'],
    appId: 'syntheticApp',
    headless: true,
  });
  const original = await pollRun(started.body.id, 30_000);
  assert.equal(original.status, 'passed');
  assert.equal(original.rerunEligibility.failed.eligible, false);
  assert.equal(original.rerunEligibility.full.eligible, true);

  const review = await api.post(`/api/runs/${original.id}/rerun-review`, {
    scope: 'full',
    reason: 'Confirm the read-only recovery workflow',
  });
  assert.equal(review.status, 200);
  assert.equal(review.body.eligible, true);
  assert.equal(review.body.differences.length, 5);

  const changedAfterReview = await api.post(`/api/runs/${original.id}/rerun`, {
    scope: 'full',
    reason: 'Confirm the read-only recovery workflow',
    requestKey: 'synthetic-rerun-review-mismatch',
    reviewHash: 'not-the-reviewed-hash',
  });
  assert.equal(changedAfterReview.status, 409);

  const rerun = await api.post(`/api/runs/${original.id}/rerun`, {
    scope: 'full',
    reason: 'Confirm the read-only recovery workflow',
    requestKey: 'synthetic-rerun-reviewed',
    reviewHash: review.body.reviewHash,
  });
  assert.equal(rerun.status, 201);
  assert.equal(rerun.body.parentRunId, original.id);
  assert.equal(rerun.body.rerunReason, 'Confirm the read-only recovery workflow');
  assert.equal(rerun.body.rerunScope, 'full');
  assert.equal(rerun.body.rerunReviewHash, review.body.reviewHash);
});

// --- Gated live cases — real SAP execution, real wall-clock time ---

test('live: read-only Chain authenticates and opens Manage Purchase Orders, with evidence PDF', LIVE, async () => {
  const started = await startApprovedRun({
    mode: 'chain',
    testCaseFiles: ['verify-sap-login.json', 'open-manage-purchase-orders.json'],
    appId: 'createPurchaseOrder',
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

test('live: read-only Suite runs independent login and procurement navigation tests', LIVE, async () => {
  const started = await startApprovedRun({
    mode: 'suite',
    testCaseFiles: ['verify-sap-login.json', 'verify-procurement-navigation.json'],
    appId: 'createPurchaseOrder',
    headless: true,
  });
  assert.equal(started.status, 201);

  const final = await pollRun(started.body.id, 3 * 60 * 1000);
  assert.equal(final.status, 'passed');
  assert.equal(final.results.length, 2);
});

test('live: read-only Batch runs two independent SAP smoke groups', LIVE, async () => {
  const started = await startApprovedRun({
    mode: 'batch',
    groupFiles: ['sap-login-smoke.json', 'sap-procurement-navigation-smoke.json'],
    headless: true,
  });
  assert.equal(started.status, 201);

  const final = await pollRun(started.body.id, 8 * 60 * 1000);
  assert.equal(final.status, 'passed');
  assert.equal(final.groupResults.length, 2);
  assert.equal(final.groupResults.every((group) => group.status === 'passed'), true);
});

test('live transactional: negative test — create PO is blocked without a line item', TRANSACTIONAL_LIVE, async () => {
  const started = await startApprovedRun({
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
