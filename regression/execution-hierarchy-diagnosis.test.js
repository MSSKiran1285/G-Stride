'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createExecutionPlanSnapshot } = require('../packages/core/dist');
const { getRun, REPORTS_ROOT } = require('../packages/studio-server/dist/runs.js');

function singleTestPlan() {
  return {
    schemaVersion: 1,
    planId: 'hierarchy-fixture-plan',
    name: 'Hierarchy Fixture Plan',
    target: { provider: 'sap', profileRef: 'default' },
    evidence: { enabled: true, canonical: true },
    kind: 'singleTest',
    testExecution: {
      test: {
        assetId: 'hierarchy-fixture-asset',
        file: 'testcases/hierarchy-fixture.json',
        name: 'Hierarchy Fixture Test',
        appId: 'hierarchyFixtureApp',
        contentHash: 'a'.repeat(64),
        contractMode: 'declared',
        contract: { version: 1, inputs: [], outputs: [] },
      },
      inputBindings: {},
    },
    dataBindings: [{
      bindingId: 'transactions',
      scope: 'test',
      source: { kind: 'file', format: 'json', files: ['data/hierarchy-fixture.json'] },
    }],
    iterationPolicy: { session: 'fresh-per-iteration', onIterationFailure: 'continue-next-iteration', sequential: true },
  };
}

function stepResult(overrides) {
  return {
    module: 'Wait',
    description: 'Synthetic step',
    status: 'passed',
    startedAt: new Date().toISOString(),
    durationMs: 1,
    stepId: 'step-0',
    ...overrides,
  };
}

function runResult({ status, stageId, testCaseName, steps }) {
  return {
    testCaseName,
    status,
    startedAt: new Date().toISOString(),
    durationMs: 5,
    steps,
    capturedValues: {},
    fieldEvidence: [],
    stages: [{
      stageId,
      testCaseName,
      status,
      startedAt: new Date().toISOString(),
      durationMs: 5,
      steps,
      fieldEvidence: [],
    }],
  };
}

function writeFixture(id, { snapshot, results, evidenceDocuments, status }) {
  const reportDir = path.join(REPORTS_ROOT, id);
  fs.mkdirSync(reportDir, { recursive: true });
  fs.writeFileSync(path.join(reportDir, 'execution-snapshot.json'), JSON.stringify(snapshot));
  for (const [number, result] of Object.entries(results)) {
    fs.writeFileSync(path.join(reportDir, `run-${number}.json`), JSON.stringify(result));
  }
  if (evidenceDocuments) {
    fs.writeFileSync(path.join(reportDir, 'evidence-manifest.json'), JSON.stringify({ documents: evidenceDocuments }));
  }
  fs.writeFileSync(path.join(reportDir, 'run-state.json'), JSON.stringify({
    id,
    status,
    mode: 'chain',
    reportDir,
    reportDirRel: path.join('reports', 'studio', id),
    testCaseFiles: ['hierarchy-fixture.json'],
    totalUnits: 3,
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    exitCode: status === 'passed' ? 0 : 1,
    logTail: '',
    snapshotHash: snapshot.snapshotHash,
    request: { testCaseFiles: ['hierarchy-fixture.json'], appId: snapshot.plan.testExecution.test.appId, mode: 'chain' },
  }));
  return reportDir;
}

test("a mid-run iteration with no result does not misattribute a later iteration's data (BL-031 AC1/AC4)", () => {
  const snapshot = createExecutionPlanSnapshot(singleTestPlan(), [
    { bindingId: 'transactions', records: [{ id: 'A' }, { id: 'B' }, { id: 'C' }] },
  ], { executionId: 'hierarchy-gap-execution' });
  const stageId = snapshot.plan.testExecution.test.assetId;
  const id = 'regression-hierarchy-gap-fixture';
  const reportDir = writeFixture(id, {
    snapshot,
    status: 'failed',
    // Iteration 2 (run-2.json) is deliberately absent — as if it failed before the test
    // case even started (no `result`), which is exactly what a real CLI run produces in
    // that case (cli/src/commands/run.ts's per-iteration loop `continue`s without writing
    // run-N.json or an evidence-manifest entry for that iteration).
    results: {
      1: runResult({ status: 'passed', stageId, testCaseName: 'Iteration One', steps: [stepResult({ description: 'Iteration one step' })] }),
      3: runResult({ status: 'passed', stageId, testCaseName: 'Iteration Three', steps: [stepResult({ description: 'Iteration three step' })] }),
    },
    evidenceDocuments: [
      { runId: 'evidence-run-1', label: 'Iteration One', archivePath: 'evidence-run-1/evidence.pdf' },
      { runId: 'evidence-run-3', label: 'Iteration Three', archivePath: 'evidence-run-3/evidence.pdf' },
    ],
  });
  try {
    const run = getRun(id);
    assert.ok(run);
    const iterations = run.hierarchy.members[0].iterations;
    assert.equal(iterations.length, 3);

    assert.equal(iterations[0].stages[0].testCaseName, 'Iteration One');
    assert.equal(iterations[0].evidencePdfUrl, '/audit-evidence/evidence-run-1/evidence.pdf');

    assert.equal(iterations[1].status, 'failed');
    assert.deepEqual(iterations[1].stages, []);
    assert.equal(iterations[1].evidencePdfUrl, null);

    // The critical assertion: iteration 3 shows its OWN result and evidence, not iteration
    // 1's data shifted into its slot (the bug a flat array-position read would produce).
    assert.equal(iterations[2].stages[0].testCaseName, 'Iteration Three');
    assert.equal(iterations[2].evidencePdfUrl, '/audit-evidence/evidence-run-3/evidence.pdf');
  } finally {
    fs.rmSync(reportDir, { recursive: true, force: true });
  }
});

test('a failed step carries a stable stepId and its child-item progress survives the run (BL-031 AC1)', () => {
  const snapshot = createExecutionPlanSnapshot(singleTestPlan(), [
    { bindingId: 'transactions', records: [{ id: 'A' }] },
  ], { executionId: 'hierarchy-childwork-execution' });
  const stageId = snapshot.plan.testExecution.test.assetId;
  const id = 'regression-hierarchy-childwork-fixture';
  const childWork = { label: 'Line items', completed: 2, total: 5, currentIndex: 2, currentKey: 'ITEM-3', status: 'failed', error: 'Row 3 failed.' };
  const reportDir = writeFixture(id, {
    snapshot,
    status: 'failed',
    results: {
      1: runResult({
        status: 'failed',
        stageId,
        testCaseName: 'Hierarchy Fixture Test',
        steps: [stepResult({ description: 'Add line items', status: 'failed', error: 'Row 3 failed.', childWork })],
      }),
    },
  });
  try {
    const run = getRun(id);
    const step = run.hierarchy.members[0].iterations[0].stages[0].steps[0];
    assert.equal(step.stepId, 'step-0');
    assert.deepEqual(step.childWork, childWork);
  } finally {
    fs.rmSync(reportDir, { recursive: true, force: true });
  }
});

test('diagnosis links to the exact object for an object-repository failure (BL-032 AC1/AC3)', () => {
  const snapshot = createExecutionPlanSnapshot(singleTestPlan(), [
    { bindingId: 'transactions', records: [{ id: 'A' }] },
  ], { executionId: 'hierarchy-object-diagnosis' });
  const stageId = snapshot.plan.testExecution.test.assetId;
  const id = 'regression-hierarchy-object-diagnosis-fixture';
  const message = 'Object repository: no control named "SubmitButton" for app "hierarchyFixtureApp".';
  const reportDir = writeFixture(id, {
    snapshot,
    status: 'failed',
    results: {
      1: runResult({ status: 'failed', stageId, testCaseName: 'Hierarchy Fixture Test', steps: [stepResult({ status: 'failed', error: message })] }),
    },
  });
  try {
    const run = getRun(id);
    assert.equal(run.diagnosis.category, 'object');
    assert.deepEqual(run.diagnosis.correction, {
      kind: 'object',
      route: '/objects/hierarchyFixtureApp/SubmitButton',
      label: 'Open "SubmitButton" in the Control Object Repository',
    });
  } finally {
    fs.rmSync(reportDir, { recursive: true, force: true });
  }
});

test('diagnosis links to the exact dataset for a data-binding failure (BL-032 AC1/AC3)', () => {
  const snapshot = createExecutionPlanSnapshot(singleTestPlan(), [
    { bindingId: 'transactions', records: [{ id: 'A' }] },
  ], { executionId: 'hierarchy-data-diagnosis' });
  const stageId = snapshot.plan.testExecution.test.assetId;
  const id = 'regression-hierarchy-data-diagnosis-fixture';
  const message = 'Data binding "transactions" contains no executable transaction records.';
  const reportDir = writeFixture(id, {
    snapshot,
    status: 'failed',
    results: {
      1: runResult({ status: 'failed', stageId, testCaseName: 'Hierarchy Fixture Test', steps: [stepResult({ status: 'failed', error: message })] }),
    },
  });
  try {
    const run = getRun(id);
    assert.equal(run.diagnosis.category, 'data');
    assert.deepEqual(run.diagnosis.correction, {
      kind: 'data',
      route: '/data/hierarchy-fixture.json',
      label: 'Open dataset "hierarchy-fixture.json"',
    });
  } finally {
    fs.rmSync(reportDir, { recursive: true, force: true });
  }
});

test('diagnosis links to the exact Test for a generic assertion failure (BL-032 AC1/AC3)', () => {
  const snapshot = createExecutionPlanSnapshot(singleTestPlan(), [
    { bindingId: 'transactions', records: [{ id: 'A' }] },
  ], { executionId: 'hierarchy-test-diagnosis' });
  const stageId = snapshot.plan.testExecution.test.assetId;
  const id = 'regression-hierarchy-test-diagnosis-fixture';
  const message = 'Assertion failed: expected "Draft" but found "Submitted".';
  const reportDir = writeFixture(id, {
    snapshot,
    status: 'failed',
    results: {
      1: runResult({ status: 'failed', stageId, testCaseName: 'Hierarchy Fixture Test', steps: [stepResult({ status: 'failed', error: message })] }),
    },
  });
  try {
    const run = getRun(id);
    assert.equal(run.diagnosis.category, 'assertion');
    assert.deepEqual(run.diagnosis.correction, {
      kind: 'test',
      route: '/compose/tests/hierarchy-fixture.json',
      label: 'Open Test "Hierarchy Fixture Test"',
    });
  } finally {
    fs.rmSync(reportDir, { recursive: true, force: true });
  }
});
