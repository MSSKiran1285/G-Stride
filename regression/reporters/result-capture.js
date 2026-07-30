'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { Transform } = require('node:stream');

const destination = process.env.REGRESSION_RESULT_FILE;
const runStartedAt = new Date().toISOString();
const repoRoot = path.resolve(__dirname, '../..');
const qualityOutputPaths = [
  'apps/test-operations/data/quality-history.json',
  'apps/test-operations/data/test-catalog.json',
  'regression/results/',
];

function statusPath(line) {
  const raw = line.slice(3).trim();
  return (raw.includes(' -> ') ? raw.split(' -> ').at(-1) : raw)
    .replaceAll('\\', '/')
    .replace(/^"|"$/g, '');
}

function isQualityOutput(file) {
  return qualityOutputPaths.some((allowed) =>
    allowed.endsWith('/') ? file.startsWith(allowed) : file === allowed);
}

function readGitState() {
  try {
    const commitSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim();
    // Do not .trim() this: porcelain lines are fixed-width ("XY " prefix), and trimming the
    // whole multi-line blob eats the leading space off the *first* line only, corrupting its parse.
    const status = execFileSync('git', ['status', '--porcelain', '--untracked-files=all'], {
      cwd: repoRoot,
      encoding: 'utf8',
    });
    const entries = status.split(/\r?\n/).filter(Boolean);
    const worktreeClean = entries.length === 0;
    const sourceTreeClean = entries.every((line) => isQualityOutput(statusPath(line)));
    return { commitSha, worktreeClean, sourceTreeClean };
  } catch {
    return { commitSha: null, worktreeClean: null, sourceTreeClean: null };
  }
}

const { commitSha, worktreeClean, sourceTreeClean } = readGitState();
const serialize = (value) => JSON.stringify(value, (_key, item) => {
  if (item instanceof Error) {
    return {
      name: item.name,
      message: item.message,
      stack: item.stack,
      cause: item.cause,
      ...item,
    };
  }
  return item;
});

if (destination) {
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(
    destination,
    `${serialize({
      type: 'quality:run',
      data: {
        id: process.env.REGRESSION_RUN_ID || `quality-${runStartedAt.replace(/[:.]/g, '-')}`,
        label: process.env.REGRESSION_RUN_LABEL || 'Repository regression',
        mode: process.env.REGRESSION_RUN_MODE || 'Unit / Integration',
        targetClass: process.env.REGRESSION_TARGET_CLASS || 'Isolated',
        startedAt: runStartedAt,
        commitSha,
        worktreeClean,
        sourceTreeClean,
      },
    })}\n`,
    'utf8',
  );
}

module.exports = new Transform({
  writableObjectMode: true,
  transform(event, _encoding, callback) {
    if (destination) {
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.appendFileSync(destination, `${serialize(event)}\n`, 'utf8');
    }

    if (event.type === 'test:pass') {
      if (event.data.skip) {
        callback();
        return;
      }
      callback(null, `✔ ${event.data.name}\n`);
      return;
    }
    if (event.type === 'test:fail') {
      callback(null, `✖ ${event.data.name}\n`);
      return;
    }
    if (event.type === 'test:complete' && event.data.skip) {
      callback(null, `﹣ ${event.data.name} # ${event.data.skip}\n`);
      return;
    }
    if (event.type === 'test:summary') {
      const summary = event.data.counts;
      if (!summary) {
        callback();
        return;
      }
      callback(
        null,
        `tests ${summary.tests} · passed ${summary.passed} · failed ${summary.failed} · skipped ${summary.skipped}\n`,
      );
      return;
    }
    callback();
  },
});
