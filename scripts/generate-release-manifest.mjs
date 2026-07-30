import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const historyPath = path.join(repoRoot, 'regression', 'results', 'quality-history.json');
const catalogPath = path.join(repoRoot, 'apps', 'test-operations', 'data', 'test-catalog.json');
const auditEvidenceDir = path.join(repoRoot, 'audit-evidence');
const packagePath = path.join(repoRoot, 'package.json');
const qualityOutputPaths = [
  'apps/test-operations/data/quality-history.json',
  'apps/test-operations/data/test-catalog.json',
  'regression/results/',
];

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const version = argument('--version');
if (!version) {
  console.error('Usage: node scripts/generate-release-manifest.mjs --version <semver> [--out <path>]');
  process.exit(1);
}
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
  console.error(`Invalid semantic version: ${version}`);
  process.exit(1);
}
const outPath = argument('--out')
  || path.join(repoRoot, 'release-manifests', `v${version}.json`);

function git(args) {
  return execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8' }).trim();
}

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

const candidateCommit = git(['rev-parse', 'HEAD']);
const status = git(['status', '--porcelain', '--untracked-files=all']);
const statusEntries = status ? status.split(/\r?\n/).filter(Boolean) : [];
const worktreeClean = statusEntries.length === 0;
const sourceTreeClean = statusEntries.every((line) => isQualityOutput(statusPath(line)));

function loadHistory() {
  if (!fs.existsSync(historyPath)) {
    throw new Error(`No recorded results found at ${path.relative(repoRoot, historyPath)}.`);
  }
  const parsed = JSON.parse(fs.readFileSync(historyPath, 'utf8'));
  return Array.isArray(parsed.runs) ? parsed.runs : [];
}

// A run "counts" toward a category if its label/mode match, ordered newest first.
const requiredCategories = [
  {
    key: 'core',
    label: 'Core regression',
    match: (run) => run.mode === 'Unit / Integration' && /core/i.test(run.label),
  },
  {
    key: 'isolatedApi',
    label: 'Isolated API regression',
    match: (run) => run.mode === 'API' && /isolated/i.test(run.label),
  },
  {
    key: 'isolatedUi',
    label: 'Isolated UI regression',
    match: (run) => run.mode === 'Headless UI' && /isolated/i.test(run.label),
  },
];

function latestMatch(runs, matcher) {
  return runs
    .filter(matcher)
    .sort((left, right) => Date.parse(right.startedAt) - Date.parse(left.startedAt))
    .at(0);
}

function runSecretScan() {
  try {
    const output = execFileSync(process.execPath, ['regression/secret-scan.mjs'], {
      cwd: repoRoot,
      encoding: 'utf8',
    });
    const match = output.match(/passed:\s*(\d+)\s*non-ignored repository files/i);
    return { passed: true, filesChecked: match ? Number(match[1]) : null, output: output.trim() };
  } catch (error) {
    return { passed: false, filesChecked: null, output: (error.stdout || error.message || '').trim() };
  }
}

function readCatalogueCount() {
  if (!fs.existsSync(catalogPath)) return null;
  const parsed = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
  return Array.isArray(parsed.tests) ? parsed.tests.length : null;
}

function listAuditEvidenceRuns() {
  if (!fs.existsSync(auditEvidenceDir)) return [];
  return fs.readdirSync(auditEvidenceDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^[0-9a-f-]{36}$/i.test(entry.name))
    .map((entry) => entry.name);
}

const runs = loadHistory();
const errors = [];
const categoryResults = {};
const packageVersion = JSON.parse(fs.readFileSync(packagePath, 'utf8')).version;

if (packageVersion !== version) {
  errors.push(`Requested manifest version ${version} does not match package.json version ${packageVersion}.`);
}

for (const category of requiredCategories) {
  const run = latestMatch(runs, category.match);
  if (!run) {
    errors.push(`${category.label}: no recorded run found in quality-history.json.`);
    continue;
  }
  if (!run.commitSha) {
    errors.push(`${category.label}: latest run (${run.id}) predates commit stamping — re-record it against ${candidateCommit} before this manifest can be generated.`);
  } else if (run.commitSha !== candidateCommit) {
    errors.push(`${category.label}: latest run (${run.id}) was recorded against commit ${run.commitSha}, not the candidate ${candidateCommit}. Stale run.`);
  }
  if (run.sourceTreeClean !== true) {
    errors.push(`${category.label}: latest run (${run.id}) was not recorded from a clean product source tree.`);
  }
  if ((run.counts?.failed ?? 0) > 0 || (run.counts?.cancelled ?? 0) > 0 || (run.counts?.todo ?? 0) > 0) {
    errors.push(`${category.label}: latest run (${run.id}) contains failed, cancelled, or todo tests.`);
  }
  categoryResults[category.key] = {
    runId: run.id,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    commitSha: run.commitSha || null,
    worktreeClean: run.worktreeClean ?? null,
    sourceTreeClean: run.sourceTreeClean ?? null,
    passed: run.counts?.passed ?? null,
    failed: run.counts?.failed ?? null,
    skipped: run.counts?.skipped ?? null,
    cancelled: run.counts?.cancelled ?? null,
    todo: run.counts?.todo ?? null,
  };
}

if (!sourceTreeClean) {
  errors.push('Product source tree is not clean. Only recorded quality outputs may differ from the candidate commit.');
}

const secretScan = runSecretScan();
if (!secretScan.passed) errors.push('High-confidence repository secret scan failed.');

if (errors.length > 0) {
  console.error(`Release manifest for v${version} was NOT generated. ${errors.length} blocking issue(s):\n`);
  for (const error of errors) console.error(`  - ${error}`);
  process.exit(1);
}

const manifest = {
  version,
  candidateCommit,
  generatedAt: new Date().toISOString(),
  worktreeClean,
  sourceTreeClean,
  evidenceChangesPresent: !worktreeClean,
  results: categoryResults,
  secretScan,
  testCatalogueCount: readCatalogueCount(),
  auditEvidenceRunIds: listAuditEvidenceRuns(),
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
console.log(`Release manifest written to ${path.relative(repoRoot, outPath)}`);
