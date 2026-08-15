'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, mkdirSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { ObjectRepository } = require('../packages/core/dist');
const { ModuleRegistry } = require('../packages/engine/dist');
const { ExecutionPreflightService } = require('../packages/studio-server/dist/executionPreflight');

function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'qa4-preflight-'));
  const testCasesDir = path.join(root, 'testcases');
  const groupsDir = path.join(root, 'testgroups');
  const packsDir = path.join(root, 'testpacks');
  const dataDir = path.join(root, 'data');
  for (const directory of [testCasesDir, groupsDir, packsDir, dataDir]) mkdirSync(directory, { recursive: true });
  writeFileSync(
    path.join(testCasesDir, 'wait.json'),
    JSON.stringify({ name: 'Synthetic wait', steps: [{ module: 'Wait', params: { ms: '1' } }] })
  );
  writeFileSync(path.join(dataDir, 'records.csv'), 'order\n100\n200\n');
  const repository = new ObjectRepository(path.join(root, 'objects.db'));
  const service = new ExecutionPreflightService(
    { testCasesDir, groupsDir, packsDir, dataDir },
    repository,
    new ModuleRegistry()
  );
  return {
    root,
    repository,
    service,
    close() {
      repository.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
}

const configuredTarget = {
  provider: 'SAP',
  profileRef: 'default',
  configured: true,
  hostname: 'example.invalid',
  origin: 'https://example.invalid',
  credentialSource: 'credential-store',
  safetyClass: 'non-production',
  verificationStatus: 'live-verified',
  verifiedAt: '2026-07-29T10:00:00.000Z',
  capturedAt: '2026-07-29T10:01:00.000Z',
};
const productionLikeTarget = { ...configuredTarget, safetyClass: 'production-like' };

function singleDraft(overrides = {}) {
  return {
    kind: 'singleTest',
    testCaseFiles: ['wait.json'],
    groupFiles: [],
    appId: 'synthetic',
    dataFile: 'records.csv',
    headless: true,
    sessionPolicy: 'fresh-per-iteration',
    iterationFailurePolicy: 'continue-next-iteration',
    ...overrides,
  };
}

test('preflight calculates a Single Test matrix without opening SAP', async () => {
  const context = fixture();
  try {
    const result = await context.service.preflight(singleDraft(), configuredTarget);
    assert.equal(result.ready, true);
    assert.equal(result.planKind, 'singleTest');
    assert.deepEqual(result.matrix, {
      members: 1,
      iterations: 2,
      stages: 2,
      steps: 2,
      knownChildRecords: 0,
    });
    assert.equal(result.target.hostname, 'example.invalid');
    assert.match(result.planHash, /^[a-f0-9]{64}$/);
    assert.ok(result.preflightToken);
    assert.equal(result.findings.length, 0);
    assert.ok(result.findings.every((finding) => !JSON.stringify(finding).includes('password')));
  } finally {
    context.close();
  }
});

test('preflight filters the exact effective data, previews mappings, and seals filter identity', async () => {
  const context = fixture();
  try {
    writeFileSync(
      path.join(context.root, 'testcases', 'filtered.json'),
      JSON.stringify({
        name: 'Filtered transaction',
        steps: [{ module: 'Wait', params: { ms: '${order}' } }],
      })
    );
    const draft = singleDraft({
      testCaseFiles: ['filtered.json'],
      dataFilter: { path: 'order', operator: 'equals', value: '200' },
    });
    const result = await context.service.preflight(draft, configuredTarget);

    assert.equal(result.ready, true);
    assert.equal(result.matrix.iterations, 1);
    assert.equal(result.effectiveData.length, 1);
    assert.equal(result.effectiveData[0].recordCount, 1);
    assert.deepEqual(result.effectiveData[0].records, [{ order: '200' }]);
    assert.match(result.effectiveData[0].contentHash, /^[a-f0-9]{64}$/);
    assert.ok(result.inputMappings.some((mapping) =>
      mapping.input === 'order'
      && mapping.source === 'processData'
      && mapping.resolvedFrom === 'data.order'
    ));

    const claim = context.service.claim(result.preflightToken, draft, result.planHash, []);
    assert.deepEqual(claim.snapshot.data[0].records, result.effectiveData[0].records);
    assert.throws(
      () => context.service.claim(
        result.preflightToken,
        { ...draft, dataFilter: { ...draft.dataFilter, value: '100' } },
        result.planHash,
        []
      ),
      /configuration changed/
    );

    const empty = await context.service.preflight(
      { ...draft, dataFilter: { ...draft.dataFilter, value: 'missing' } },
      configuredTarget
    );
    const emptyFinding = empty.findings.find((finding) => finding.code === 'invalid-data-selection');
    assert.equal(empty.ready, false);
    assert.equal(emptyFinding.correctionRoute, '/data/records.csv');
  } finally {
    context.close();
  }
});

test('Start claim enforces warning acknowledgement, plan hash, and configuration freshness', async () => {
  const context = fixture();
  try {
    const draft = singleDraft();
    const result = await context.service.preflight(draft, productionLikeTarget);
    assert.throws(
      () => context.service.claim(result.preflightToken, draft, result.planHash, []),
      /Acknowledge/
    );
    assert.throws(
      () => context.service.claim(
        result.preflightToken,
        draft,
        '0'.repeat(64),
        ['production-like-target']
      ),
      /hash/
    );
    assert.throws(
      () => context.service.claim(
        result.preflightToken,
        { ...draft, headless: false },
        result.planHash,
        ['production-like-target']
      ),
      /configuration changed/
    );
    assert.throws(
      () => context.service.claim(
        result.preflightToken,
        draft,
        result.planHash,
        ['production-like-target'],
        { ...productionLikeTarget, hostname: 'changed.example.invalid', origin: 'https://changed.example.invalid' }
      ),
      /target context changed/
    );

    const claim = context.service.claim(
      result.preflightToken,
      draft,
      result.planHash,
      ['production-like-target'],
      productionLikeTarget
    );
    assert.equal(claim.snapshot.planHash, result.planHash);
    assert.equal(claim.snapshot.snapshotHash, result.snapshotHash);
    context.service.attachRun(result.preflightToken, 'run-123');
    assert.deepEqual(
      context.service.claim(
        result.preflightToken,
        draft,
        result.planHash,
        ['production-like-target']
      ),
      { existingRunId: 'run-123' }
    );
  } finally {
    context.close();
  }
});

test('preflight blocks missing target and missing assets with safe correction findings', async () => {
  const context = fixture();
  try {
    const result = await context.service.preflight(
      singleDraft({ testCaseFiles: ['missing.json'] }),
      {
        ...configuredTarget,
        configured: false,
        hostname: null,
        origin: null,
        credentialSource: 'none',
        safetyClass: 'unknown',
        verificationStatus: 'not-configured',
        verifiedAt: null,
      }
    );
    assert.equal(result.ready, false);
    assert.equal(result.preflightToken, null);
    const targetFinding = result.findings.find((finding) => finding.code === 'sap-target-not-configured');
    const scopeFinding = result.findings.find((finding) => finding.code === 'invalid-execution-scope');
    assert.equal(targetFinding.correctionRoute, '/settings/integrations/sap');
    assert.equal(scopeFinding.correctionRoute, '/compose/tests/missing.json');
  } finally {
    context.close();
  }
});

test('preflight blocks unclassified or stale SAP target context with recovery guidance', async () => {
  const context = fixture();
  try {
    const unclassified = await context.service.preflight(singleDraft(), {
      ...configuredTarget,
      safetyClass: 'unknown',
    });
    assert.equal(unclassified.ready, false);
    assert.ok(unclassified.findings.some((finding) => finding.code === 'sap-target-unclassified'));

    const stale = await context.service.preflight(singleDraft(), {
      ...configuredTarget,
      verificationStatus: 'saved-not-live-verified',
    });
    assert.equal(stale.ready, false);
    assert.ok(stale.findings.some((finding) => finding.code === 'sap-target-verification-required'));
    assert.ok(stale.findings.some((finding) => /Verify|stale/.test(finding.message)));
  } finally {
    context.close();
  }
});

test('preflight blocks required inputs that are absent from selected records', async () => {
  const context = fixture();
  try {
    writeFileSync(
      path.join(context.root, 'testcases', 'mapped.json'),
      JSON.stringify({
        name: 'Mapped input',
        steps: [{ module: 'Wait', params: { ms: '${delayMs}' } }],
      })
    );
    const result = await context.service.preflight(
      singleDraft({ testCaseFiles: ['mapped.json'] }),
      configuredTarget
    );
    assert.equal(result.ready, false);
    const finding = result.findings.find((entry) => entry.code === 'missing-data-input');
    assert.equal(finding.correctionRoute, '/data/records.csv');
  } finally {
    context.close();
  }
});

test('transactional preflight enforces non-production, fail-stop, owner reference, and retained state', async () => {
  const context = fixture();
  try {
    writeFileSync(
      path.join(context.root, 'testcases', 'transaction.json'),
      JSON.stringify({
        name: 'Create governed document',
        transaction: {
          creates: ['purchaseOrder'],
          failureDisposition: 'retain-for-review',
          ownershipRequired: true,
        },
        steps: [
          {
            module: 'CreateAutomationRunReference',
            params: {
              prefix: '${automationReferencePrefix}',
              owner: '${automationOwner}',
            },
          },
          { module: 'Wait', params: { ms: '1' } },
        ],
      })
    );
    writeFileSync(
      path.join(context.root, 'data', 'transaction.csv'),
      'automationReferencePrefix,automationOwner\nQ4HP2P,kiran\n'
    );
    const draft = singleDraft({
      testCaseFiles: ['transaction.json'],
      dataFile: 'transaction.csv',
      iterationFailurePolicy: 'stop-execution',
    });
    const allowed = await context.service.preflight(draft, configuredTarget);
    assert.equal(allowed.ready, true);
    assert.ok(allowed.findings.some((finding) => finding.code === 'transaction-state-retained'));
    assert.ok(allowed.findings.some((finding) => finding.code === 'transaction-evidence-preserved'));

    const continueAfterFailure = await context.service.preflight(
      { ...draft, iterationFailurePolicy: 'continue-next-iteration' },
      configuredTarget
    );
    assert.equal(continueAfterFailure.ready, false);
    assert.ok(continueAfterFailure.findings.some((finding) => finding.code === 'transactional-fail-stop-required'));

    const production = await context.service.preflight(draft, productionLikeTarget);
    assert.equal(production.ready, false);
    assert.ok(production.findings.some((finding) => finding.code === 'transactional-target-must-be-non-production'));
  } finally {
    context.close();
  }
});

test('every transactional Test needs its own automation reference, not just one in the run', async () => {
  // Regression for a real hole: the check was `tests.some(step is CreateAutomationRunReference)`,
  // so a Process satisfied the control with its FIRST member and every later member could create
  // SAP documents unreferenced. The o2c-e2e group did exactly that in the shipped workspace —
  // create-so carried the reference, create-delivery and create-billing did not, and it passed.
  const context = fixture();
  try {
    const transaction = (name, withReference) => ({
      name,
      transaction: { creates: ['purchaseOrder'], failureDisposition: 'retain-for-review', ownershipRequired: true },
      steps: [
        ...(withReference
          ? [{ module: 'CreateAutomationRunReference', params: { prefix: '${automationReferencePrefix}', owner: '${automationOwner}' } }]
          : []),
        { module: 'Wait', params: { ms: '1' } },
      ],
    });
    writeFileSync(path.join(context.root, 'testcases', 'referenced.json'), JSON.stringify(transaction('Referenced', true)));
    writeFileSync(path.join(context.root, 'testcases', 'unreferenced.json'), JSON.stringify(transaction('Unreferenced', false)));
    writeFileSync(
      path.join(context.root, 'data', 'transaction.csv'),
      'automationReferencePrefix,automationOwner\nQ4HP2P,kiran\n'
    );

    // businessProcess, not singleTest: a Single Test is exactly one Test by definition, and the
    // hole only shows with several ordered Tests in one run — which is what o2c-e2e is.
    const draft = singleDraft({
      kind: 'businessProcess',
      testCaseFiles: ['referenced.json', 'unreferenced.json'],
      dataFile: 'transaction.csv',
      iterationFailurePolicy: 'stop-execution',
    });
    const result = await context.service.preflight(draft, configuredTarget);

    assert.equal(result.ready, false, 'a run containing an unreferenced transactional Test must be blocked');
    const findings = result.findings.filter((f) => f.code === 'automation-reference-required');
    assert.equal(findings.length, 1, 'exactly the offending Test should be reported');
    // asset.file is a workspace-relative path, and the separator differs by platform.
    assert.ok(findings[0].reference.endsWith('unreferenced.json'), `unexpected reference: ${findings[0].reference}`);
    assert.equal(findings[0].severity, 'blocking');

    // And the control still passes once every transactional member carries its own.
    writeFileSync(path.join(context.root, 'testcases', 'unreferenced.json'), JSON.stringify(transaction('Unreferenced', true)));
    const fixed = await context.service.preflight(draft, configuredTarget);
    assert.ok(!fixed.findings.some((f) => f.code === 'automation-reference-required'));
  } finally {
    context.close();
  }
});

test('preflight joins relational CSV into transaction snapshots with owned child rows', async () => {
  const context = fixture();
  try {
    writeFileSync(
      path.join(context.root, 'testcases', 'line-items.json'),
      JSON.stringify({
        name: 'Line item transaction',
        steps: [{ module: 'Wait', params: { ms: '${items}' } }],
      })
    );
    writeFileSync(path.join(context.root, 'data', 'orders.csv'), 'scenarioKey,orderType\nA,OR\nB,OR\n');
    writeFileSync(path.join(context.root, 'data', 'items.csv'), 'scenarioKey,material\nA,MAT-1\nA,MAT-2\nB,MAT-3\n');
    const draft = singleDraft({
      testCaseFiles: ['line-items.json'],
      dataFile: 'orders.csv',
      dataMode: 'relational-csv',
      childDataFile: 'items.csv',
      headerKey: 'scenarioKey',
      childForeignKey: 'scenarioKey',
      collectionPath: 'items',
    });
    const result = await context.service.preflight(draft, configuredTarget);
    assert.equal(result.ready, true);
    assert.equal(result.matrix.iterations, 2);
    assert.equal(result.matrix.knownChildRecords, 3);
    const claim = context.service.claim(
      result.preflightToken,
      draft,
      result.planHash,
      []
    );
    assert.deepEqual(
      claim.snapshot.data[0].records.map((record) => record.items.length),
      [2, 1]
    );
  } finally {
    context.close();
  }
});
