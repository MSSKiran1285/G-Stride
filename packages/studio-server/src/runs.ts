import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { loadDataSet } from '@taf/core';

// studio-server's dist/ lives at packages/studio-server/dist. Walk to the repo
// root so CLI children resolve the same data, databases, reports, and evidence
// archive as Studio itself.
const REPO_ROOT = path.resolve(__dirname, '../../..');
const CLI_ENTRY = path.resolve(__dirname, '../../cli/dist/index.js');
const REPORTS_ROOT_REL = path.join('reports', 'studio');
export const REPORTS_ROOT = path.join(REPO_ROOT, REPORTS_ROOT_REL);

export interface StartRunOptions {
  testCaseFiles: string[];
  appId: string;
  dataFile?: string;
  headless?: boolean;
  /** "chain" (default): dependent stages in one shared session.
   * "suite": independent test cases.
   * "batch": independent named groups, each containing a dependent chain. */
  mode?: 'chain' | 'suite' | 'batch';
  groupFiles?: string[];
}

export interface RunRecord {
  id: string;
  status: 'running' | 'passed' | 'failed';
  mode: 'chain' | 'suite' | 'batch';
  reportDir: string;
  reportDirRel: string;
  testCaseFiles: string[];
  totalUnits: number;
  startedAt: string;
  finishedAt?: string;
  exitCode: number | null;
  logTail: string;
}

export interface EvidenceDocumentReference {
  runId: string;
  label: string;
  url: string;
}

interface EvidenceManifest {
  documents: Array<{
    runId: string;
    label: string;
    archivePath: string;
  }>;
}

export interface BatchGroupResult {
  name: string;
  status: 'passed' | 'failed';
  totalTestCases: number;
  passedCount: number;
  failedTestCase: string | null;
  passPercent: number;
  durationMs: number;
  evidencePdfUrl: string | null;
  stages: unknown[];
  error?: string;
}

export interface RunProgress {
  completedGroups: number;
  totalGroups: number;
  completedSteps: number;
  totalSteps: number;
  completedStages: number;
  totalStages: number;
  currentGroup: string;
  currentStage: string;
  currentStep: string;
  percent: number;
}

export interface RunStatus extends RunRecord {
  results: unknown[];
  groupResults?: BatchGroupResult[];
  progress?: RunProgress;
  /** Canonical immutable PDFs shared with Audit and Evidence. */
  evidenceDocuments: EvidenceDocumentReference[];
  /** Convenience link when this Studio execution produced exactly one PDF. */
  evidencePdfUrl: string | null;
}

const runs = new Map<string, RunRecord>();

/** Maps only safe archive-relative paths to the canonical evidence static mount. */
export function evidenceArchiveUrl(archivePath: string): string | null {
  const normalized = archivePath.replace(/\\/g, '/');
  const segments = normalized.split('/');
  if (
    !normalized ||
    normalized.startsWith('/') ||
    /^[A-Za-z]:/.test(normalized) ||
    segments.some((segment) => !segment || segment === '.' || segment === '..')
  ) {
    return null;
  }
  return `/audit-evidence/${normalized}`;
}

export function readEvidenceManifest(reportDir: string): EvidenceDocumentReference[] {
  const manifestPath = path.join(reportDir, 'evidence-manifest.json');
  if (!existsSync(manifestPath)) return [];
  try {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as EvidenceManifest;
    if (!Array.isArray(manifest.documents)) return [];
    return manifest.documents.flatMap((document) => {
      const url = evidenceArchiveUrl(document.archivePath);
      return url && document.runId && document.label
        ? [{ runId: document.runId, label: document.label, url }]
        : [];
    });
  } catch {
    return [];
  }
}

export function startRun(opts: StartRunOptions): RunRecord {
  const id = randomUUID();
  const reportDirRel = path.join(REPORTS_ROOT_REL, id);
  const reportDirAbs = path.join(REPO_ROOT, reportDirRel);
  mkdirSync(reportDirAbs, { recursive: true });

  const mode = opts.mode ?? 'chain';
  let dataRowCount = 1;
  if (mode !== 'batch' && opts.dataFile) {
    try {
      dataRowCount = Math.max(1, loadDataSet(path.resolve(REPO_ROOT, opts.dataFile)).length);
    } catch {
      dataRowCount = 1;
    }
  }
  const totalUnits = mode === 'batch'
    ? Math.max(1, opts.groupFiles?.length ?? 0)
    : mode === 'suite'
      ? Math.max(1, opts.testCaseFiles.length * dataRowCount)
      : dataRowCount;
  const subcommand = mode === 'batch' ? 'batch' : mode === 'suite' ? 'suite' : 'run';
  const args =
    mode === 'batch'
      ? [subcommand, ...(opts.groupFiles ?? []), '--report-dir', reportDirRel, '--headless', String(opts.headless ?? false)]
      : [subcommand, ...opts.testCaseFiles, '--app-id', opts.appId, '--report-dir', reportDirRel, '--headless', String(opts.headless ?? false)];
  if (mode !== 'batch' && opts.dataFile) args.push('--data', opts.dataFile);

  const record: RunRecord = {
    id,
    status: 'running',
    mode,
    reportDir: reportDirAbs,
    reportDirRel,
    testCaseFiles: opts.testCaseFiles,
    totalUnits,
    startedAt: new Date().toISOString(),
    exitCode: null,
    logTail: '',
  };
  runs.set(id, record);

  const child = spawn('node', [CLI_ENTRY, ...args], { cwd: REPO_ROOT });
  let log = '';
  const appendLog = (chunk: Buffer) => {
    log += chunk.toString();
    record.logTail = log.slice(-4000);
  };
  child.stdout.on('data', appendLog);
  child.stderr.on('data', appendLog);
  child.on('exit', (code) => {
    record.exitCode = code;
    record.status = code === 0 ? 'passed' : 'failed';
    record.finishedAt = new Date().toISOString();
  });
  child.on('error', (err) => {
    record.exitCode = -1;
    record.status = 'failed';
    record.finishedAt = new Date().toISOString();
    record.logTail = String(err);
  });

  return record;
}

export function getRun(id: string): RunStatus | null {
  const record = runs.get(id);
  if (!record) return null;

  if (record.mode === 'batch') {
    const summaryPath = path.join(record.reportDir, 'summary.json');
    const progressPath = path.join(record.reportDir, 'progress.json');
    let groupResults: BatchGroupResult[] = [];
    let progress: RunProgress | undefined;
    if (existsSync(progressPath)) {
      try {
        progress = JSON.parse(readFileSync(progressPath, 'utf8')) as RunProgress;
      } catch {
        progress = undefined;
      }
    }
    if (existsSync(summaryPath)) {
      const summary = JSON.parse(readFileSync(summaryPath, 'utf8'));
      groupResults = (summary.groups as any[]).map((group) => ({
        ...group,
        evidencePdfUrl:
          typeof group.evidenceArchivePath === 'string'
            ? evidenceArchiveUrl(group.evidenceArchivePath)
            : null,
      }));
    }
    const evidenceDocuments = groupResults.flatMap((group, index) => {
      if (!group.evidencePdfUrl) return [];
      const runId = group.evidencePdfUrl.split('/').filter(Boolean).at(-2) ?? '';
      return [{ runId, label: group.name || `Group ${index + 1}`, url: group.evidencePdfUrl }];
    });
    return {
      ...record,
      results: [],
      groupResults,
      progress,
      evidenceDocuments,
      evidencePdfUrl: evidenceDocuments.length === 1 ? evidenceDocuments[0].url : null,
    };
  }

  const results: unknown[] = [];
  if (existsSync(record.reportDir)) {
    const reportFiles = readdirSync(record.reportDir)
      .filter((file) => /^run-\d+\.json$/.test(file))
      .sort((left, right) => Number(left.match(/\d+/)![0]) - Number(right.match(/\d+/)![0]));
    for (const file of reportFiles) {
      results.push(JSON.parse(readFileSync(path.join(record.reportDir, file), 'utf8')));
    }
  }

  const evidenceDocuments = readEvidenceManifest(record.reportDir);
  return {
    ...record,
    results,
    evidenceDocuments,
    evidencePdfUrl: evidenceDocuments.length === 1 ? evidenceDocuments[0].url : null,
  };
}
