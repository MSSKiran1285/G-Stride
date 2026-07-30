import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(import.meta.dirname, '..');
const historyPath = path.join(repoRoot, 'regression', 'results', 'quality-history.json');

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function relativeFile(file) {
  return file
    ? path.relative(repoRoot, file).replaceAll('\\', '/')
    : '';
}

function errorMessage(details) {
  const error = details?.error;
  if (!error) return null;
  if (typeof error === 'string') return error;
  return error.message
    || error.cause
    || error.stack
    || (Array.isArray(error.log) ? error.log.join('\n') : null)
    || JSON.stringify(error);
}

function loadHistory() {
  if (!fs.existsSync(historyPath)) {
    return { version: 1, runs: [], failures: [] };
  }
  const parsed = JSON.parse(fs.readFileSync(historyPath, 'utf8'));
  return {
    version: 1,
    runs: Array.isArray(parsed.runs) ? parsed.runs : [],
    failures: Array.isArray(parsed.failures) ? parsed.failures : [],
  };
}

const input = argument('--input');
if (!input) throw new Error('Usage: node regression/record-quality-run.mjs --input <result.ndjson>');

const absoluteInput = path.resolve(repoRoot, input);
const events = fs.readFileSync(absoluteInput, 'utf8')
  .split(/\r?\n/)
  .filter(Boolean)
  .map((line) => JSON.parse(line));
const metadata = events.find((event) => event.type === 'quality:run')?.data;
if (!metadata?.id || !metadata?.startedAt) {
  throw new Error('Result file does not contain quality:run metadata.');
}

const completed = new Map();
for (const event of events) {
  if (event.type === 'test:complete' && event.data?.details?.type === 'test') {
    const source = relativeFile(event.data.file);
    if (
      event.data.name.endsWith('.test.js')
      || event.data.name.replaceAll('\\', '/') === source
    ) {
      continue;
    }
    const status = event.data.skip
      ? 'Skipped'
      : event.data.details.passed
        ? 'Passed'
        : 'Failed';
    completed.set(`${event.data.file || ''}\u0000${event.data.name}`, {
      name: event.data.name,
      file: source,
      status,
      durationMs: event.data.details.duration_ms ?? null,
      skipReason: event.data.skip || null,
      error: errorMessage(event.data.details),
    });
  }
}

const summary = events
  .filter((event) => event.type === 'test:summary' && event.data?.counts)
  .at(-1)?.data;
const tests = [...completed.values()];
const counts = summary?.counts ?? {
  tests: tests.length,
  passed: tests.filter((test) => test.status === 'Passed').length,
  failed: tests.filter((test) => test.status === 'Failed').length,
  skipped: tests.filter((test) => test.status === 'Skipped').length,
  cancelled: 0,
  todo: 0,
};
const finishedAt = new Date().toISOString();
const run = {
  ...metadata,
  finishedAt,
  durationMs: summary?.duration_ms ?? null,
  counts,
  tests,
};

const history = loadHistory();
history.failures = history.failures.filter((failure) => !failure.test.endsWith('.test.js'));
history.runs = history.runs.filter((existing) => existing.id !== run.id);
history.runs.push(run);
history.runs.sort((left, right) => Date.parse(left.startedAt) - Date.parse(right.startedAt));

for (const test of tests) {
  if (test.status === 'Failed') {
    const duplicate = history.failures.find(
      (failure) => failure.runId === run.id && failure.test === test.name,
    );
    if (!duplicate) {
      history.failures.push({
        id: '',
        runId: run.id,
        test: test.name,
        file: test.file,
        mode: metadata.mode,
        targetClass: metadata.targetClass,
        failedAt: finishedAt,
        error: test.error || 'Test failed without a structured error.',
        state: 'Current',
        remediatedAt: null,
        remediationRunId: null,
      });
    }
    continue;
  }
  if (test.status === 'Passed') {
    for (const failure of history.failures) {
      if (failure.test === test.name && failure.state === 'Current') {
        failure.state = 'Remediated';
        failure.remediatedAt = finishedAt;
        failure.remediationRunId = run.id;
      }
    }
  }
}

history.failures.forEach((failure, index) => {
  failure.id = `FL-${String(index + 1).padStart(4, '0')}`;
});

fs.mkdirSync(path.dirname(historyPath), { recursive: true });
fs.writeFileSync(historyPath, `${JSON.stringify(history, null, 2)}\n`, 'utf8');
console.log(
  `Recorded ${run.label}: ${counts.passed} passed, ${counts.failed} failed, ${counts.skipped} skipped.`,
);
