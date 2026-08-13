import fs from 'node:fs';
import path from 'node:path';

const appRoot = path.resolve(import.meta.dirname, '..');
const repoRoot = path.resolve(appRoot, '..', '..');
const regressionRoot = path.join(repoRoot, 'regression');
const qualityHistoryPath = path.join(regressionRoot, 'results', 'quality-history.json');

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) return walk(absolute);
    return entry.name.endsWith('.test.js') ? [absolute] : [];
  });
}

function featureFor(relativePath) {
  if (relativePath.startsWith('ui/')) return 'Workspace Experience';
  if (relativePath.startsWith('api/')) return 'Studio API Contracts';
  if (/security|credential|settings|tenant/.test(relativePath)) return 'Security & Configuration';
  if (/evidence/.test(relativePath)) return 'Audit & Evidence';
  return 'Execution Engine';
}

function areaFor(relativePath, title) {
  const combined = `${relativePath} ${title}`.toLowerCase();
  if (/overview/.test(combined)) return 'Automation Overview';
  if (/compose|testcases/.test(combined)) return 'Compose';
  if (/data/.test(combined)) return 'Test Data';
  if (/group|process/.test(combined)) return 'Process Suites';
  if (/audit|evidence/.test(combined)) return 'Audit & Evidence';
  if (/route|navigation|shell|picker|responsive|unsaved/.test(combined)) return 'Application Shell';
  if (/object/.test(combined)) return 'Object Repository';
  if (/security|credential|settings|tenant|owner|target/.test(combined)) return 'Security & Settings';
  return 'Execution Center';
}

function modeFor(relativePath, title) {
  const live = /^live(?:\s|:)/i.test(title);
  if (relativePath.startsWith('ui/')) return live ? 'Live UI' : 'Headless UI';
  if (relativePath.startsWith('api/')) return live ? 'Live API' : 'API';
  if (/security-context|sap-settings/.test(relativePath)) return 'API';
  return 'Unit / Integration';
}

const testPattern = /test\(\s*(['"`])([\s\S]*?)\1\s*,/g;
const tests = [];
const qualityHistory = fs.existsSync(qualityHistoryPath)
  ? JSON.parse(fs.readFileSync(qualityHistoryPath, 'utf8'))
  : { version: 1, runs: [], failures: [] };
const runsNewestFirst = [...(qualityHistory.runs ?? [])]
  .sort((left, right) => Date.parse(right.startedAt) - Date.parse(left.startedAt));
const latestByName = new Map();
for (const run of runsNewestFirst) {
  for (const result of run.tests ?? []) {
    const existing = latestByName.get(result.name);
    if (!existing || (existing.result.status === 'Skipped' && result.status !== 'Skipped')) {
      latestByName.set(result.name, { run, result });
    }
  }
}

for (const file of walk(regressionRoot).sort()) {
  const relativePath = path.relative(regressionRoot, file).replaceAll('\\', '/');
  const source = fs.readFileSync(file, 'utf8');
  for (const match of source.matchAll(testPattern)) {
    const title = match[2];
    const latest = latestByName.get(title);
    const stableId = `Q4H-${String(tests.length + 1).padStart(3, '0')}`;
    tests.push({
      id: stableId,
      name: title,
      feature: featureFor(relativePath),
      area: areaFor(relativePath, title),
      mode: modeFor(relativePath, title),
      source: `regression/${relativePath}`,
      latestStatus: latest?.result.status ?? 'Not run',
      lastExecutedAt: latest?.run.finishedAt ?? null,
      durationMs: latest?.result.durationMs ?? null,
      executionNote: latest
        ? latest.result.status === 'Skipped'
          ? latest.result.skipReason || `Skipped in ${latest.run.label}.`
          : latest.result.status === 'Failed'
            ? latest.result.error || `Failed in ${latest.run.label}.`
            : `Passed in ${latest.run.label}.`
        : 'No authoritative recorded execution.',
    });
  }
}

const snapshot = {
  generatedAt: new Date().toISOString(),
  source: 'Repository regression inventory and recorded Node test-run output',
  tests,
};

const destination = path.join(appRoot, 'data', 'test-catalog.json');
fs.mkdirSync(path.dirname(destination), { recursive: true });
fs.writeFileSync(destination, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');

const testMetadata = new Map(tests.map((test) => [test.name, test]));
const qualityDashboard = {
  executionHistory: runsNewestFirst.slice(0, 20).map((run) => ({
    id: run.id,
    label: run.label,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    passed: run.counts?.passed ?? 0,
    failed: run.counts?.failed ?? 0,
    skipped: run.counts?.skipped ?? 0,
    mode: run.mode,
    targetClass: run.targetClass,
  })),
  failureLedger: [...(qualityHistory.failures ?? [])].reverse().map((failure) => {
    const metadata = testMetadata.get(failure.test);
    return {
      ...failure,
      feature: metadata?.feature ?? 'Unclassified',
      area: metadata?.area ?? 'Unclassified',
      source: metadata?.source ?? failure.file,
      remediation: failure.state === 'Remediated'
        ? `Verified by recorded run ${failure.remediationRunId}.`
        : 'Pending remediation and a subsequent recorded pass.',
    };
  }),
};
fs.writeFileSync(
  path.join(appRoot, 'data', 'quality-history.json'),
  `${JSON.stringify(qualityDashboard, null, 2)}\n`,
  'utf8',
);
console.log(`Generated ${tests.length} G-Stride tests at ${destination}`);
