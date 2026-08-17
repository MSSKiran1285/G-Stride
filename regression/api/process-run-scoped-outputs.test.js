'use strict';

/**
 * A Business Process may contain more than one transactional Test.
 *
 * The server inserts CreateAutomationRunReference as step 1 of every Test that creates SAP
 * documents, and that module declares automationReference, automationOwner and
 * transactionFailureDisposition. Two such Tests in one process therefore declared the same three
 * outputs, tripped the duplicate-output rule, and the process could not be saved at all — which
 * ruled out the shape the product exists for: Create Sales Order, then its Delivery, then its
 * Billing Document.
 *
 * The collision was never real. The module is idempotent by design: the first stage mints the
 * reference and later stages reuse it, so whichever stage a consumer reads it from, the value is
 * the same. Any other duplicated output still is ambiguous, and stays an error.
 */

const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const { api, assertServerReachable } = require('../lib/apiClient');

before(assertServerReachable);

const APP_ID = 'runScopedRegressionApp';

function transactionalTest(name, documentKind) {
  return {
    version: 1,
    lifecycle: 'draft',
    application: 'SAP',
    name,
    transaction: { creates: [documentKind], failureDisposition: 'retain-for-review', ownershipRequired: true },
    steps: [
      {
        module: 'CreateAutomationRunReference',
        params: { prefix: '${automationReferencePrefix}', owner: '${automationOwner}', maxLength: '16' },
      },
      { module: 'Wait', params: { ms: '1' } },
    ],
  };
}

/**
 * Saves WITH explicit stages, which is what the editor sends. The stage-topology rules — the
 * duplicate-output one included — are only evaluated when stages are present, so a body without
 * them proves nothing about this.
 */
async function saveProcess(file, testCaseFiles, inputBindingsFor = () => ({})) {
  return api.put(`/api/groups/${file}`, {
    version: 1,
    lifecycle: 'draft',
    name: file.replace(/\.json$/, ''),
    appId: APP_ID,
    testCaseFiles,
    stages: testCaseFiles.map((testCaseFile, index) => ({
      stageId: `stage-${index + 1}-${testCaseFile.replace(/\.json$/, '')}`,
      testCaseFile,
      inputBindings: inputBindingsFor(testCaseFile, index),
    })),
  });
}

test('two transactional Tests can share one Business Process', async () => {
  await api.put('/api/testcases/run-scoped-first.json', transactionalTest('Run Scoped First', 'salesOrder'));
  await api.put('/api/testcases/run-scoped-second.json', transactionalTest('Run Scoped Second', 'outboundDelivery'));

  try {
    const saved = await saveProcess(
      'run-scoped-process.json',
      ['run-scoped-first.json', 'run-scoped-second.json'],
      (_file, index) => ({
        automationReferencePrefix: { source: 'processData', path: 'automationReferencePrefix' },
        // Stage 2 reads the owner the first stage already declared — the very hand-off the
        // duplicate-output rule used to make unsaveable.
        automationOwner: index === 0
          ? { source: 'processData', path: 'automationOwner' }
          : { source: 'stageOutput', stageId: 'stage-1-run-scoped-first', output: 'automationOwner' },
      })
    );
    assert.equal(
      saved.status,
      200,
      `expected the process to save; server said: ${JSON.stringify(saved.body)}`
    );

    const reopened = await api.get('/api/groups/run-scoped-process.json');
    assert.equal(reopened.status, 200);
    assert.deepEqual(reopened.body.testCaseFiles, ['run-scoped-first.json', 'run-scoped-second.json']);
  } finally {
    await api.delete('/api/groups/run-scoped-process.json?force=true');
    await api.delete('/api/testcases/run-scoped-first.json?force=true');
    await api.delete('/api/testcases/run-scoped-second.json?force=true');
  }
});

test('a genuinely ambiguous duplicate output is still refused', async () => {
  // Two stages capturing a document number under the SAME key really are ambiguous: the values
  // differ, so a consumer reading it cannot know which document it got. The exemption must not
  // have widened into "duplicates are fine".
  const capturing = (name) => ({
    version: 1,
    lifecycle: 'draft',
    application: 'SAP',
    name,
    steps: [
      {
        module: 'CaptureDocumentNumberFromSuccessDialog',
        appId: APP_ID,
        params: { captureAs: 'sharedDocumentNumber', label: 'Doc', buttonText: 'Close' },
      },
    ],
  });

  await api.put('/api/testcases/run-scoped-dup-a.json', capturing('Run Scoped Dup A'));
  await api.put('/api/testcases/run-scoped-dup-b.json', capturing('Run Scoped Dup B'));

  try {
    const saved = await saveProcess('run-scoped-dup-process.json', ['run-scoped-dup-a.json', 'run-scoped-dup-b.json']);
    assert.equal(saved.status, 400);
    assert.match(saved.body.error, /sharedDocumentNumber.*declared by both/);
  } finally {
    await api.delete('/api/groups/run-scoped-dup-process.json?force=true');
    await api.delete('/api/testcases/run-scoped-dup-a.json?force=true');
    await api.delete('/api/testcases/run-scoped-dup-b.json?force=true');
  }
});
