'use strict';

/**
 * Per-App-ID capture health.
 *
 * The Object Library showed what HAS been captured and nothing about the state it is in, so a
 * stale capture looked exactly like a fresh one until a run failed on it. This reports the
 * verification breakdown, and the objects a Test names that the repository does not hold.
 *
 * Note what `missing` deliberately cannot catch: a field that no Test references AND no capture
 * holds is invisible here, because nothing in the product knows it should exist. It catches the
 * rename-or-delete case, not the never-automated-it case.
 */

const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const { api, assertServerReachable } = require('../lib/apiClient');

before(assertServerReachable);

const APP_ID = 'coverageRegressionApp';

async function coverageFor(appId) {
  const { status, body } = await api.get('/api/objects/coverage');
  assert.equal(status, 200);
  return body.find((entry) => entry.appId === appId);
}

async function seedObject(name) {
  await api.put(`/api/objects/${APP_ID}/${name}`, {
    controlId: `${name}-id`,
    controlType: 'sap.m.Input',
  });
}

test('coverage reports capture health and the objects a Test names but the repository lacks', async () => {
  await seedObject('CoverageCapturedField');

  // Names an object that exists, and one that does not — the shape a rename leaves behind.
  await api.put('/api/testcases/coverage-regression.json', {
    version: 1,
    lifecycle: 'draft',
    application: 'SAP',
    name: 'Coverage Regression',
    steps: [
      { module: 'EnterHeaderField', appId: APP_ID, params: { field: 'CoverageCapturedField', value: 'x' } },
      { module: 'EnterHeaderField', appId: APP_ID, params: { field: 'CoverageRenamedField', value: 'y' } },
    ],
  });

  try {
    const entry = await coverageFor(APP_ID);
    assert.ok(entry, 'the App ID is reported');
    assert.equal(entry.captured, 1);
    assert.equal(entry.neverVerified, 1, 'a freshly captured object has never been verified');
    assert.equal(entry.drifted, 0);
    assert.deepEqual(
      entry.missing.map(({ name, referencedBy }) => ({ name, referencedBy })),
      [{ name: 'CoverageRenamedField', referencedBy: ['coverage-regression.json'] }]
    );
    assert.deepEqual(entry.unreferenced, [], 'the captured object is named by the Test');
  } finally {
    await api.delete('/api/testcases/coverage-regression.json?force=true');
    await api.delete(`/api/objects/${APP_ID}/CoverageCapturedField?force=true`);
  }
});

test('a captured object no Test names is reported as unreferenced, not as missing', async () => {
  await seedObject('CoverageOrphanField');
  try {
    const entry = await coverageFor(APP_ID);
    assert.deepEqual(entry.unreferenced, ['CoverageOrphanField']);
    assert.deepEqual(entry.missing, [], 'nothing is missing — the object exists, it is just unused');
  } finally {
    await api.delete(`/api/objects/${APP_ID}/CoverageOrphanField?force=true`);
  }
});

test('a ${placeholder} object reference is not counted as a missing capture', async () => {
  // It resolves at run time and cannot be checked from here. It is a publishing issue in its own
  // right — reporting it as an uncaptured object would send the reader to scan a screen for a
  // control that was never meant to have that name.
  await api.put('/api/testcases/coverage-dynamic.json', {
    version: 1,
    lifecycle: 'draft',
    application: 'SAP',
    name: 'Coverage Dynamic',
    steps: [{ module: 'EnterHeaderField', appId: APP_ID, params: { field: '${fieldName}', value: 'x' } }],
  });
  try {
    const entry = await coverageFor(APP_ID);
    assert.equal(
      (entry?.missing ?? []).some((item) => item.name.includes('${')),
      false
    );
  } finally {
    await api.delete('/api/testcases/coverage-dynamic.json?force=true');
  }
});

test('the route is not shadowed by the App ID route it sits beside', async () => {
  // /api/objects/:appId is registered for every other App ID, so "coverage" would be matched as
  // one and answered with an empty control list unless this route is declared first.
  const { status, body } = await api.get('/api/objects/coverage');
  assert.equal(status, 200);
  assert.ok(Array.isArray(body));
  assert.ok(
    body.every((entry) => typeof entry.appId === 'string' && typeof entry.captured === 'number'),
    'coverage entries, not raw controls'
  );
});
