'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, readdirSync } = require('node:fs');
const path = require('node:path');
const { validateExecutionPlan } = require('../packages/core/dist');
const {
  translateLegacyBatch,
  translateLegacyChain,
  translateLegacySingleTest,
  translateLegacySuite,
} = require('../packages/engine/dist');

const root = path.resolve(__dirname, '..');
const testCasesDir = path.join(root, 'testcases');
const groupsDir = path.join(root, 'testgroups');

function jsonFiles(directory) {
  return readdirSync(directory).filter((file) => file.endsWith('.json')).sort();
}

function readJson(directory, file) {
  return JSON.parse(readFileSync(path.join(directory, file), 'utf8'));
}

function asset(file, appId) {
  const testCase = readJson(testCasesDir, file);
  assert.equal(typeof testCase.name, 'string', `${file} must retain a display name`);
  assert.ok(Array.isArray(testCase.steps), `${file} must retain a steps array`);
  return {
    file: path.join('testcases', file),
    testCase,
    appId,
  };
}

function assertValid(plan, label) {
  const issues = validateExecutionPlan(plan);
  assert.deepEqual(issues, [], `${label} did not migrate cleanly:\n${JSON.stringify(issues, null, 2)}`);
  assert.equal(plan.schemaVersion, 1);
}

test('every persisted legacy Test translates without source mutation', () => {
  const files = jsonFiles(testCasesDir);
  assert.ok(files.length > 0, 'expected persisted Tests');
  for (const file of files) {
    const source = readFileSync(path.join(testCasesDir, file), 'utf8');
    const testAsset = asset(file, 'migrationAudit');
    const single = translateLegacySingleTest(testAsset, {
      name: testAsset.testCase.name,
      profileRef: 'default',
    });
    assertValid(single, `Single Test ${file}`);
    assert.equal(
      readFileSync(path.join(testCasesDir, file), 'utf8'),
      source,
      `${file} was rewritten during compatibility translation`
    );
  }
});

test('every persisted legacy Group translates to a Business Process and combined Batch Pack', () => {
  const groupFiles = jsonFiles(groupsDir);
  assert.ok(groupFiles.length > 0, 'expected persisted Groups');
  const groupAssets = groupFiles.map((file) => {
    const definition = readJson(groupsDir, file);
    assert.equal(typeof definition.name, 'string', `${file} must retain a display name`);
    assert.equal(typeof definition.appId, 'string', `${file} must retain an App ID`);
    assert.ok(Array.isArray(definition.testCaseFiles) && definition.testCaseFiles.length > 0);
    const tests = definition.testCaseFiles.map((testFile) => asset(testFile, definition.appId));
    const dataFile = definition.dataFile
      ? path.join('data', path.basename(definition.dataFile))
      : undefined;
    const chain = translateLegacyChain(tests, {
      name: definition.name,
      profileRef: 'default',
      dataFile,
      sessionPolicy: 'reuse-within-process',
      iterationFailurePolicy: 'stop-execution',
    });
    assertValid(chain, `Business Process ${file}`);
    assert.equal(chain.kind, 'businessProcess');
    assert.equal(chain.stages.length, tests.length);
    return {
      name: definition.name,
      appId: definition.appId,
      tests,
      dataFile,
    };
  });

  const batch = translateLegacyBatch(groupAssets, {
    name: 'Persisted legacy Group migration audit',
    profileRef: 'default',
    sessionPolicy: 'fresh-per-iteration',
    iterationFailurePolicy: 'continue-next-iteration',
  });
  assertValid(batch, 'combined legacy Batch');
  assert.equal(batch.kind, 'regressionPack');
  assert.equal(batch.members.length, groupFiles.length);
});

test('legacy Suite translation preserves selected order and independent executable identity', () => {
  const files = jsonFiles(testCasesDir).slice(0, 3);
  assert.ok(files.length >= 2, 'expected at least two Tests for Suite compatibility');
  const assets = files.map((file) => asset(file, 'migrationAudit'));
  const suite = translateLegacySuite(assets, {
    name: 'Persisted Suite migration audit',
    profileRef: 'default',
  });
  assertValid(suite, 'legacy Suite');
  assert.equal(suite.kind, 'regressionPack');
  assert.deepEqual(
    suite.members.map((member) => member.executable.testExecution.test.file),
    files.map((file) => path.join('testcases', file).replace(/\\/g, '/'))
  );
  assert.equal(new Set(suite.members.map((member) => member.memberId)).size, files.length);
});
