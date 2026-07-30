'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const catalog = require('../apps/test-operations/data/test-catalog.json');
const dashboard = require('../apps/test-operations/data/quality-history.json');
const history = require('./results/quality-history.json');

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) return walk(absolute);
    return entry.name.endsWith('.test.js') ? [absolute] : [];
  });
}

function inventory() {
  const testPattern = /test\(\s*(['"`])([\s\S]*?)\1\s*,/g;
  return walk(path.join(repoRoot, 'regression'))
    .sort()
    .flatMap((file) => {
      const relative = path.relative(path.join(repoRoot, 'regression'), file).replaceAll('\\', '/');
      return [...fs.readFileSync(file, 'utf8').matchAll(testPattern)].map((match) => ({
        name: match[2],
        source: `regression/${relative}`,
      }));
    });
}

function latestRecordedResults() {
  const latest = new Map();
  const runs = [...history.runs]
    .sort((left, right) => Date.parse(right.startedAt) - Date.parse(left.startedAt));
  for (const run of runs) {
    for (const result of run.tests ?? []) {
      const existing = latest.get(result.name);
      if (!existing || (existing.result.status === 'Skipped' && result.status !== 'Skipped')) {
        latest.set(result.name, { run, result });
      }
    }
  }
  return latest;
}

test('Test Operations catalogue inventory and status fields come only from repository tests and recorded runs', () => {
  assert.equal(catalog.source, 'Repository regression inventory and recorded Node test-run output');
  assert.deepEqual(
    catalog.tests.map(({ name, source }) => ({ name, source })),
    inventory(),
  );

  const latest = latestRecordedResults();
  for (const entry of catalog.tests) {
    const recorded = latest.get(entry.name);
    if (!recorded) {
      assert.equal(entry.latestStatus, 'Not run');
      assert.equal(entry.lastExecutedAt, null);
      assert.equal(entry.durationMs, null);
      assert.equal(entry.executionNote, 'No authoritative recorded execution.');
      continue;
    }

    assert.equal(entry.latestStatus, recorded.result.status);
    assert.equal(entry.lastExecutedAt, recorded.run.finishedAt);
    assert.equal(entry.durationMs, recorded.result.durationMs);
    if (recorded.result.status === 'Skipped') {
      assert.equal(
        entry.executionNote,
        recorded.result.skipReason || `Skipped in ${recorded.run.label}.`,
      );
    } else if (recorded.result.status === 'Failed') {
      assert.equal(
        entry.executionNote,
        recorded.result.error || `Failed in ${recorded.run.label}.`,
      );
    } else {
      assert.equal(entry.executionNote, `Passed in ${recorded.run.label}.`);
    }
  }
});

test('Test Operations failure ledger preserves every recorded failure and remediation link', () => {
  assert.equal(dashboard.failureLedger.length, history.failures.length);
  assert.deepEqual(
    dashboard.failureLedger.map((entry) => ({
      id: entry.id,
      runId: entry.runId,
      test: entry.test,
      failedAt: entry.failedAt,
      state: entry.state,
      remediatedAt: entry.remediatedAt,
      remediationRunId: entry.remediationRunId,
    })),
    [...history.failures].reverse().map((entry) => ({
      id: entry.id,
      runId: entry.runId,
      test: entry.test,
      failedAt: entry.failedAt,
      state: entry.state,
      remediatedAt: entry.remediatedAt,
      remediationRunId: entry.remediationRunId,
    })),
  );
});
