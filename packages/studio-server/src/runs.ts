import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { BusinessProcessSpec, ExecutionPlan, ExecutionPlanSnapshot, SingleTestSpec, createExecutionPlanSnapshot, loadDataSet } from '@taf/core';
import type { ExecutionInitiator, ExecutionTargetContext } from './executionContext';

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
  sessionPolicy?: 'fresh-per-iteration' | 'reuse-within-process';
  iterationFailurePolicy?: 'stop-execution' | 'continue-next-iteration';
  maxRecords?: number;
  executionSnapshot?: ExecutionPlanSnapshot;
  parentRunId?: string;
  rerunReason?: string;
  rerunScope?: 'full' | 'failed';
  rerunRequestKey?: string;
  rerunReviewHash?: string;
  rerunChanges?: RerunDifference[];
  sensitiveValues?: string[];
  initiatedBy?: ExecutionInitiator;
  targetContext?: ExecutionTargetContext;
}

interface StoredRunRequest {
  testCaseFiles: string[];
  appId: string;
  dataFile?: string;
  headless?: boolean;
  mode: 'chain' | 'suite' | 'batch';
  groupFiles?: string[];
  sessionPolicy?: 'fresh-per-iteration' | 'reuse-within-process';
  iterationFailurePolicy?: 'stop-execution' | 'continue-next-iteration';
  maxRecords?: number;
}

export interface RunRecord {
  id: string;
  status: 'running' | 'cancelling' | 'cancelled' | 'passed' | 'failed';
  mode: 'chain' | 'suite' | 'batch';
  reportDir: string;
  reportDirRel: string;
  testCaseFiles: string[];
  totalUnits: number;
  startedAt: string;
  finishedAt?: string;
  exitCode: number | null;
  logTail: string;
  snapshotHash?: string;
  cancellationRequestedAt?: string;
  cancellationBoundary?: 'after-active-iteration';
  parentRunId?: string;
  rerunReason?: string;
  rerunScope?: 'full' | 'failed';
  rerunRequestKey?: string;
  rerunReviewHash?: string;
  rerunChanges?: RerunDifference[];
  initiatedBy?: ExecutionInitiator;
  targetContext?: ExecutionTargetContext;
  request: StoredRunRequest;
  startLatencyMs?: number;
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
  childWork?: {
    label: string;
    completed: number;
    total: number;
    currentIndex?: number;
    currentKey?: string;
    status: 'running' | 'passed' | 'failed';
    error?: string;
  };
}

export interface RunStatus extends RunRecord {
  results: unknown[];
  groupResults?: BatchGroupResult[];
  progress?: RunProgress;
  /** Canonical immutable PDFs shared with Audit and Evidence. */
  evidenceDocuments: EvidenceDocumentReference[];
  /** Convenience link when this Studio execution produced exactly one PDF. */
  evidencePdfUrl: string | null;
  hierarchy: ExecutionHierarchy;
  diagnosis: FailureDiagnosis | null;
  rerunEligibility?: RerunEligibility;
}

export interface RerunDifference {
  area: 'plan' | 'data' | 'policies' | 'target' | 'scope';
  field: string;
  sourceValue: string;
  rerunValue: string;
  changed: boolean;
  explanation: string;
}

export interface RerunScopeEligibility {
  eligible: boolean;
  reason?: string;
}

export interface RerunEligibility {
  full: RerunScopeEligibility;
  failed: RerunScopeEligibility;
}

export interface RerunReview {
  parentRunId: string;
  scope: 'full' | 'failed';
  reason: string;
  eligible: boolean;
  blockingReasons: string[];
  sourceSnapshotHash: string | null;
  proposedSnapshotHash: string | null;
  reviewHash: string;
  eligibleMembers: number;
  eligibleIterations: number;
  excludedPassedIterations: number;
  differences: RerunDifference[];
  changedInputs: RerunDifference[];
}

export interface FailureCorrection {
  kind: 'test' | 'object' | 'data';
  route: string;
  label: string;
}

export interface FailureDiagnosis {
  memberId?: string;
  memberName?: string;
  iterationId?: string;
  iterationIndex?: number;
  stage?: string;
  step?: string;
  childIndex?: number;
  childKey?: string;
  category: 'setup' | 'data' | 'object' | 'authentication' | 'navigation' | 'assertion' | 'execution';
  message: string;
  screenshotPath?: string;
  /** The exact Test, object, or dataset this failure points at, when one can be determined —
   *  BL-032 AC3 ("links open the exact Test, object, dataset, mapping or setting"). Absent
   *  when nothing in the plan/message resolves to a specific artifact. */
  correction?: FailureCorrection;
}

export interface ExecutionHierarchyIteration {
  iterationId: string;
  index: number;
  status: 'pending' | 'running' | 'passed' | 'failed' | 'cancelled';
  stages: unknown[];
  evidencePdfUrl: string | null;
}

export interface ExecutionHierarchyMember {
  memberId: string;
  name: string;
  status: 'pending' | 'running' | 'passed' | 'failed' | 'cancelled';
  iterations: ExecutionHierarchyIteration[];
}

export interface ExecutionHierarchy {
  executionId: string;
  snapshotHash?: string;
  members: ExecutionHierarchyMember[];
}

export interface ExecutionHealthMetrics {
  totalExecutions: number;
  running: number;
  passed: number;
  failed: number;
  cancelled: number;
  averageDurationMs: number;
  averageStartLatencyMs: number;
  completedIterations: number;
  iterationThroughputPerHour: number;
  evidenceExpected: number;
  evidenceAvailable: number;
  failureCategories: Record<FailureDiagnosis['category'], number>;
}

const runs = new Map<string, RunRecord>();
const RUN_STATE_FILE = 'run-state.json';
const SNAPSHOT_FILE = 'execution-snapshot.json';
const CANCELLATION_FILE = 'cancel-request.json';

export function redactExecutionLog(value: string, sensitiveValues: string[] = []): string {
  let redacted = value
    .replace(/(authorization\s*[:=]\s*bearer\s+)[^\s"'\\]+/gi, '$1[REDACTED]')
    .replace(/((?:password|passwd|token|secret)\s*[:=]\s*)[^\s,;"']+/gi, '$1[REDACTED]')
    .replace(/(https?:\/\/)[^/@\s:]+:[^/@\s]+@/gi, '$1[REDACTED]@');
  for (const sensitive of sensitiveValues) {
    if (sensitive.length >= 3) redacted = redacted.split(sensitive).join('[REDACTED]');
  }
  return redacted;
}

function persistRecord(record: RunRecord): void {
  mkdirSync(record.reportDir, { recursive: true });
  const target = path.join(record.reportDir, RUN_STATE_FILE);
  const temporary = `${target}.tmp`;
  writeFileSync(temporary, JSON.stringify(record, null, 2));
  renameSync(temporary, target);
}

function loadRecord(id: string): RunRecord | null {
  if (!/^[A-Za-z0-9_-]+$/.test(id)) return null;
  const reportDir = path.join(REPORTS_ROOT, id);
  const statePath = path.join(reportDir, RUN_STATE_FILE);
  if (!existsSync(statePath)) return null;
  try {
    const stored = JSON.parse(readFileSync(statePath, 'utf8')) as RunRecord;
    const record: RunRecord = {
      ...stored,
      id,
      reportDir,
      reportDirRel: path.join(REPORTS_ROOT_REL, id),
    };
    if (record.status === 'running' || record.status === 'cancelling') {
      record.status = record.status === 'cancelling' ? 'cancelled' : 'failed';
      record.exitCode = -1;
      record.finishedAt = new Date().toISOString();
      record.logTail = `${record.logTail}\nStudio restarted before the execution completed.`.trim();
      persistRecord(record);
    }
    runs.set(id, record);
    return record;
  } catch {
    return null;
  }
}

function readSnapshot(reportDir: string): ExecutionPlanSnapshot | undefined {
  const snapshotPath = path.join(reportDir, SNAPSHOT_FILE);
  if (!existsSync(snapshotPath)) return undefined;
  try {
    return JSON.parse(readFileSync(snapshotPath, 'utf8')) as ExecutionPlanSnapshot;
  } catch {
    return undefined;
  }
}

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

/** Every "run-N.json" result file in a report directory, keyed by its own iteration number N
 *  (1-based, parsed from the filename) rather than by array position — BL-031's fix for a
 *  real misalignment: when a mid-run iteration produces no result at all (e.g. a data-binding
 *  failure before the test case even starts), the CLI's own writer simply never creates that
 *  file, leaving a genuine gap in the numbering. Reading files back in sorted-array order
 *  (the old approach) would then silently attribute a LATER iteration's result to an EARLIER
 *  iteration's hierarchy row. Keying by the parsed number instead makes every row show its
 *  own, correctly-attributed result (or none) regardless of any earlier gap. */
export function readIndexedResults(reportDir: string): Map<number, unknown> {
  const indexed = new Map<number, unknown>();
  if (!existsSync(reportDir)) return indexed;
  for (const file of readdirSync(reportDir)) {
    const match = file.match(/^run-(\d+)\.json$/);
    if (!match) continue;
    try {
      indexed.set(Number(match[1]), JSON.parse(readFileSync(path.join(reportDir, file), 'utf8')));
    } catch {
      // skip an unreadable/malformed result file rather than fail the whole hierarchy build
    }
  }
  return indexed;
}

export function startRun(opts: StartRunOptions): RunRecord {
  const id = randomUUID();
  const reportDirRel = path.join(REPORTS_ROOT_REL, id);
  const reportDirAbs = path.join(REPO_ROOT, reportDirRel);
  mkdirSync(reportDirAbs, { recursive: true });
  const snapshotPath = path.join(reportDirAbs, SNAPSHOT_FILE);
  const cancellationPath = path.join(reportDirAbs, CANCELLATION_FILE);
  if (opts.executionSnapshot) {
    writeFileSync(snapshotPath, JSON.stringify(opts.executionSnapshot, null, 2));
  }

  const mode = opts.mode ?? 'chain';
  let dataRowCount = 1;
  if (mode !== 'batch' && opts.dataFile) {
    try {
      dataRowCount = Math.max(1, loadDataSet(path.resolve(REPO_ROOT, opts.dataFile)).length);
      if (opts.maxRecords) dataRowCount = Math.min(dataRowCount, opts.maxRecords);
    } catch {
      dataRowCount = 1;
    }
  }
  let batchIterationCount = 0;
  if (mode === 'batch') {
    for (const groupFile of opts.groupFiles ?? []) {
      try {
        const group = JSON.parse(
          readFileSync(path.resolve(REPO_ROOT, groupFile), 'utf8')
        ) as { dataFile?: string };
        const rows = group.dataFile
          ? loadDataSet(path.resolve(REPO_ROOT, 'data', group.dataFile)).length
          : 1;
        batchIterationCount += opts.maxRecords ? Math.min(rows, opts.maxRecords) : rows;
      } catch {
        // Keep a malformed/unreadable Group visible as one planned unit. The
        // CLI will report the exact loading error in the Batch summary.
        batchIterationCount += 1;
      }
    }
  }
  const snapshotIterations = (() => {
    const snapshot = opts.executionSnapshot;
    if (!snapshot) return undefined;
    if (snapshot.plan.kind !== 'regressionPack') {
      return snapshot.data[0]?.recordCount ?? 1;
    }
    return snapshot.plan.members.reduce((total, member) => {
      const memberRecords = snapshot.data
        .filter((entry) => entry.bindingId.startsWith(`${member.memberId}:`))
        .reduce((records, entry) => records + entry.recordCount, 0);
      return total + (memberRecords || 1);
    }, 0);
  })();
  const totalUnits = snapshotIterations ?? (mode === 'batch'
    ? Math.max(1, batchIterationCount)
    : mode === 'suite'
      ? Math.max(1, opts.testCaseFiles.length * dataRowCount)
      : dataRowCount);
  const subcommand = mode === 'batch' ? 'batch' : mode === 'suite' ? 'suite' : 'run';
  const args =
    mode === 'batch'
      ? [subcommand, ...(opts.groupFiles ?? []), '--report-dir', reportDirRel, '--headless', String(opts.headless ?? false)]
      : [subcommand, ...opts.testCaseFiles, '--app-id', opts.appId, '--report-dir', reportDirRel, '--headless', String(opts.headless ?? false)];
  if (mode !== 'batch' && opts.dataFile) args.push('--data', opts.dataFile);
  if (opts.sessionPolicy) args.push('--session-policy', opts.sessionPolicy);
  if (opts.iterationFailurePolicy) args.push('--iteration-failure', opts.iterationFailurePolicy);
  if (opts.maxRecords) args.push('--max-records', String(opts.maxRecords));
  if (opts.executionSnapshot) args.push('--execution-snapshot', snapshotPath);
  if (opts.initiatedBy) {
    const auditIdentity = opts.initiatedBy.provider === 'google'
      ? opts.initiatedBy.email
      : opts.initiatedBy.name;
    if (auditIdentity) args.push('--executed-by', auditIdentity);
  }
  if (opts.targetContext?.hostname) args.push('--target-hostname', opts.targetContext.hostname);
  if (opts.targetContext?.safetyClass) args.push('--target-safety-class', opts.targetContext.safetyClass);
  if (opts.targetContext?.verifiedAt) args.push('--target-verified-at', opts.targetContext.verifiedAt);
  args.push('--studio-run-id', id);
  if (opts.parentRunId) args.push('--parent-studio-run-id', opts.parentRunId);
  args.push('--cancel-file', cancellationPath);

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
    snapshotHash: opts.executionSnapshot?.snapshotHash,
    parentRunId: opts.parentRunId,
    rerunReason: opts.rerunReason,
    rerunScope: opts.rerunScope,
    rerunRequestKey: opts.rerunRequestKey,
    rerunReviewHash: opts.rerunReviewHash,
    rerunChanges: opts.rerunChanges,
    initiatedBy: opts.initiatedBy,
    targetContext: opts.targetContext,
    request: {
      testCaseFiles: [...opts.testCaseFiles],
      appId: opts.appId,
      dataFile: opts.dataFile,
      headless: opts.headless,
      mode,
      groupFiles: opts.groupFiles ? [...opts.groupFiles] : undefined,
      sessionPolicy: opts.sessionPolicy,
      iterationFailurePolicy: opts.iterationFailurePolicy,
      maxRecords: opts.maxRecords,
    },
  };
  runs.set(id, record);
  persistRecord(record);

  const child = spawn('node', [CLI_ENTRY, ...args], { cwd: REPO_ROOT });
  let log = '';
  const appendLog = (chunk: Buffer) => {
    log += redactExecutionLog(chunk.toString(), opts.sensitiveValues);
    record.logTail = log.slice(-4000);
  };
  child.stdout.on('data', appendLog);
  child.stderr.on('data', appendLog);
  child.on('spawn', () => {
    record.startLatencyMs = Math.max(0, Date.now() - Date.parse(record.startedAt));
    persistRecord(record);
  });
  child.on('exit', (code) => {
    record.exitCode = code;
    record.status = existsSync(cancellationPath) || code === 2 ? 'cancelled' : code === 0 ? 'passed' : 'failed';
    record.finishedAt = new Date().toISOString();
    persistRecord(record);
  });
  child.on('error', (err) => {
    record.exitCode = -1;
    record.status = 'failed';
    record.finishedAt = new Date().toISOString();
    record.logTail = String(err);
    persistRecord(record);
  });

  return record;
}

export function getRun(id: string): RunStatus | null {
  const record = runs.get(id) ?? loadRecord(id);
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
    const status = {
      ...record,
      results: [],
      groupResults,
      progress,
      evidenceDocuments,
      evidencePdfUrl: evidenceDocuments.length === 1 ? evidenceDocuments[0].url : null,
    };
    const hierarchy = buildHierarchy(status);
    return {
      ...status,
      hierarchy,
      diagnosis: diagnoseFailure(status, hierarchy),
      rerunEligibility: rerunEligibilityFor(record, readSnapshot(record.reportDir), hierarchy),
    };
  }

  const results: unknown[] = [];
  let progress: RunProgress | undefined;
  const progressPath = path.join(record.reportDir, 'progress.json');
  if (existsSync(progressPath)) {
    try {
      progress = JSON.parse(readFileSync(progressPath, 'utf8')) as RunProgress;
    } catch {
      progress = undefined;
    }
  }
  if (existsSync(record.reportDir)) {
    const reportFiles = readdirSync(record.reportDir)
      .filter((file) => /^run-\d+\.json$/.test(file))
      .sort((left, right) => Number(left.match(/\d+/)![0]) - Number(right.match(/\d+/)![0]));
    for (const file of reportFiles) {
      results.push(JSON.parse(readFileSync(path.join(record.reportDir, file), 'utf8')));
    }
  }

  const evidenceDocuments = readEvidenceManifest(record.reportDir);
  const status = {
    ...record,
    results,
    progress,
    evidenceDocuments,
    evidencePdfUrl: evidenceDocuments.length === 1 ? evidenceDocuments[0].url : null,
  };
  const hierarchy = buildHierarchy(status);
  return {
    ...status,
    hierarchy,
    diagnosis: diagnoseFailure(status, hierarchy),
    rerunEligibility: rerunEligibilityFor(record, readSnapshot(record.reportDir), hierarchy),
  };
}

function buildHierarchy(
  status: Omit<RunStatus, 'hierarchy' | 'diagnosis'>
): ExecutionHierarchy {
  const snapshot = readSnapshot(status.reportDir);
  const plan = snapshot?.plan;
  const members = plan?.kind === 'regressionPack'
    ? plan.members.map((member) => ({
        memberId: member.memberId,
        name: member.name,
        bindingId: member.executable.dataBindings[0]?.bindingId,
      }))
    : [{
        memberId: plan?.planId ?? 'execution',
        name: plan?.name ?? (status.testCaseFiles.join(' → ') || 'Execution'),
        bindingId: plan?.dataBindings[0]?.bindingId,
      }];
  const indexedResults = status.mode === 'batch' ? new Map<number, unknown>() : readIndexedResults(status.reportDir);
  // The Nth evidence document (in manifest order) always corresponds to the Nth result THAT
  // ACTUALLY EXISTS, by iteration number — the CLI writes both under the same skip-aware
  // per-iteration loop, so a skipped iteration is simply absent from both, in the same order.
  const sortedResultNumbers = [...indexedResults.keys()].sort((a, b) => a - b);
  let resultOffset = 0;
  const hierarchyMembers: ExecutionHierarchyMember[] = members.map((member, memberIndex) => {
    const qualifiedBinding = plan?.kind === 'regressionPack' && member.bindingId
      ? `${member.memberId}:${member.bindingId}`
      : member.bindingId;
    const plannedCount = qualifiedBinding
      ? snapshot?.data.find((entry) => entry.bindingId === qualifiedBinding)?.recordCount ?? 1
      : 1;
    const batchResults = status.groupResults?.filter((group) =>
      group.name === member.name || members.length === status.groupResults?.length && status.groupResults[memberIndex] === group
    ) ?? [];
    const memberResultBase = resultOffset;
    resultOffset += plannedCount;
    const iterationCount = status.mode === 'batch' ? Math.max(plannedCount, batchResults.length) : plannedCount;
    const iterations = Array.from({ length: iterationCount }, (_, index) => {
      const batch = status.mode === 'batch' ? batchResults[index] : undefined;
      const globalNumber = memberResultBase + index + 1;
      const result = status.mode !== 'batch' ? indexedResults.get(globalNumber) as any : undefined;
      const evidenceRank = status.mode !== 'batch' && result !== undefined ? sortedResultNumbers.indexOf(globalNumber) : -1;
      const evidence = status.mode === 'batch'
        ? batch?.evidencePdfUrl ?? null
        : evidenceRank >= 0 ? status.evidenceDocuments[evidenceRank]?.url ?? null : null;
      return {
        iterationId: `${member.memberId}-${index + 1}`,
        index,
        status: (batch?.status
          ?? result?.status
          ?? (status.status === 'running' || status.status === 'cancelling'
            ? 'pending'
            : status.status === 'cancelled'
              ? 'cancelled'
              : 'failed')) as ExecutionHierarchyIteration['status'],
        stages: batch?.stages ?? result?.stages ?? (result ? [result] : []),
        evidencePdfUrl: evidence,
      };
    });
    const states = iterations.map((iteration) => iteration.status);
    const memberStatus: ExecutionHierarchyMember['status'] = states.includes('failed')
      ? 'failed'
      : states.includes('cancelled')
        ? 'cancelled'
      : states.length > 0 && states.every((state) => state === 'passed')
        ? 'passed'
        : status.status === 'running' && memberIndex === 0
          ? 'running'
          : 'pending';
    return { memberId: member.memberId, name: member.name, status: memberStatus, iterations };
  });
  return {
    executionId: snapshot?.executionId ?? status.id,
    snapshotHash: snapshot?.snapshotHash ?? status.snapshotHash,
    members: hierarchyMembers,
  };
}

function failureCategory(message: string): FailureDiagnosis['category'] {
  if (/credential|login|auth/i.test(message)) return 'authentication';
  if (/object repository|control|locator/i.test(message)) return 'object';
  if (/data|binding|record|csv|json/i.test(message)) return 'data';
  if (/goto|navigation|network|url/i.test(message)) return 'navigation';
  if (/assert|expected|actual/i.test(message)) return 'assertion';
  if (/start|setup|preflight|load/i.test(message)) return 'setup';
  return 'execution';
}

/** Resolves the exact TestAssetSnapshot (file/appId/name) a failure's own stage came from —
 *  looked up by stageId within the failed member's executable, falling back to that
 *  executable's first/only stage when no stageId is known (e.g. a pre-BL-031 result). */
function findFailedTestAsset(
  plan: ExecutionPlan | undefined,
  memberId: string | undefined,
  stageId: string | undefined
): { file: string; appId: string; name: string } | undefined {
  if (!plan) return undefined;
  const executable: SingleTestSpec | BusinessProcessSpec | undefined =
    plan.kind === 'regressionPack' ? plan.members.find((m) => m.memberId === memberId)?.executable : plan;
  if (!executable) return undefined;
  const stages = executable.kind === 'businessProcess'
    ? executable.stages
    : [{ stageId: executable.testExecution.test.assetId, ...executable.testExecution }];
  const stage = (stageId ? stages.find((s) => s.stageId === stageId) : undefined) ?? stages[0];
  return stage ? { file: stage.test.file, appId: stage.test.appId, name: stage.test.name } : undefined;
}

/** The failing dataset file for a member's own data binding, if it has one — used for a
 *  'data'-category failure's correction link. Relational sources link to their header file. */
function findMemberDataFile(plan: ExecutionPlan | undefined, memberId: string | undefined): string | undefined {
  if (!plan) return undefined;
  const executable: SingleTestSpec | BusinessProcessSpec | undefined =
    plan.kind === 'regressionPack' ? plan.members.find((m) => m.memberId === memberId)?.executable : plan;
  const file = executable?.dataBindings[0]?.source.files[0];
  return file ? path.basename(file) : undefined;
}

/** BL-032 AC3: "links open the exact Test, object, dataset, mapping or setting" — an object
 *  category's control name is recovered from the message's own double-quoted convention
 *  (every object-repository throw site quotes the control name first — see
 *  ObjectRepository.get and controlAccess.ts), never invented. */
function correctionFor(
  category: FailureDiagnosis['category'],
  message: string,
  plan: ExecutionPlan | undefined,
  memberId: string | undefined,
  stageId: string | undefined
): FailureCorrection | undefined {
  if (category === 'object') {
    const name = message.match(/"([^"]+)"/)?.[1];
    const appId = findFailedTestAsset(plan, memberId, stageId)?.appId;
    if (name && appId) {
      return { kind: 'object', route: `/objects/${encodeURIComponent(appId)}/${encodeURIComponent(name)}`, label: `Open "${name}" in the Control Object Repository` };
    }
  }
  if (category === 'data') {
    const file = findMemberDataFile(plan, memberId);
    if (file) return { kind: 'data', route: `/data/${encodeURIComponent(file)}`, label: `Open dataset "${file}"` };
  }
  const asset = findFailedTestAsset(plan, memberId, stageId);
  if (asset) {
    const file = path.basename(asset.file);
    return { kind: 'test', route: `/compose/tests/${encodeURIComponent(file)}`, label: `Open Test "${asset.name}"` };
  }
  return undefined;
}

function diagnoseFailure(
  status: Omit<RunStatus, 'hierarchy' | 'diagnosis'>,
  hierarchy: ExecutionHierarchy
): FailureDiagnosis | null {
  if (status.status !== 'failed') return null;
  const batchFailure = status.groupResults?.find((group) => group.status === 'failed');
  const resultFailure = (status.results as any[]).find((result) => result?.status === 'failed');
  const stages: any[] = batchFailure?.stages ?? resultFailure?.stages ?? (resultFailure ? [resultFailure] : []);
  const failedStage = stages.find((stage) => stage?.status === 'failed');
  const failedStep = failedStage?.steps?.find((step: any) => step?.status === 'failed')
    ?? resultFailure?.steps?.find((step: any) => step?.status === 'failed');
  const failedMember = hierarchy.members.find((member) => member.status === 'failed');
  const failedIteration = failedMember?.iterations.find((iteration) => iteration.status === 'failed');
  const message = failedStep?.error
    ?? batchFailure?.error
    ?? resultFailure?.error
    ?? status.progress?.childWork?.error
    ?? status.logTail
    ?? 'Execution failed without a structured error.';
  const category = failureCategory(message);
  const plan = readSnapshot(status.reportDir)?.plan;
  return {
    memberId: failedMember?.memberId,
    memberName: failedMember?.name,
    iterationId: failedIteration?.iterationId,
    iterationIndex: failedIteration?.index,
    stage: failedStage?.testCaseName,
    step: failedStep?.description ?? failedStep?.module,
    childIndex: status.progress?.childWork?.currentIndex,
    childKey: status.progress?.childWork?.currentKey,
    category,
    message,
    screenshotPath: failedStep?.screenshotPath,
    correction: correctionFor(category, message, plan, failedMember?.memberId, failedStage?.stageId),
  };
}

export function cancelRun(id: string): RunStatus | null {
  const record = runs.get(id) ?? loadRecord(id);
  if (!record) return null;
  if (record.status !== 'running' && record.status !== 'cancelling') return getRun(id);
  if (record.status === 'running') {
    record.status = 'cancelling';
    record.cancellationRequestedAt = new Date().toISOString();
    record.cancellationBoundary = 'after-active-iteration';
    writeFileSync(
      path.join(record.reportDir, CANCELLATION_FILE),
      JSON.stringify({ requestedAt: record.cancellationRequestedAt, boundary: record.cancellationBoundary }, null, 2)
    );
    persistRecord(record);
  }
  return getRun(id);
}

function existingRerun(parentRunId: string, requestKey: string): RunStatus | null {
  for (const record of runs.values()) {
    if (record.parentRunId === parentRunId && record.rerunRequestKey === requestKey) return getRun(record.id);
  }
  if (!existsSync(REPORTS_ROOT)) return null;
  for (const directory of readdirSync(REPORTS_ROOT)) {
    const candidate = loadRecord(directory);
    if (candidate?.parentRunId === parentRunId && candidate.rerunRequestKey === requestKey) {
      return getRun(candidate.id);
    }
  }
  return null;
}

export function createRerunSnapshot(
  snapshot: ExecutionPlanSnapshot,
  hierarchy: ExecutionHierarchy,
  scope: 'full' | 'failed'
): ExecutionPlanSnapshot {
  const transactionRisk = transactionalRerunRisk(snapshot, hierarchy, scope);
  if (transactionRisk) throw new Error(transactionRisk);
  if (scope === 'full') {
    return createExecutionPlanSnapshot(
      snapshot.plan,
      snapshot.data.map((entry) => ({ bindingId: entry.bindingId, records: entry.records })),
      { executionId: randomUUID() }
    );
  }
  let plan = JSON.parse(JSON.stringify(snapshot.plan)) as ExecutionPlan;
  let data = snapshot.data.map((entry) => ({ bindingId: entry.bindingId, records: entry.records }));
  if (plan.kind === 'regressionPack') {
    const eligibleIndexes = new Map(
      hierarchy.members.map((member) => [
        member.memberId,
        member.iterations.filter((iteration) => iteration.status !== 'passed').map((iteration) => iteration.index),
      ])
    );
    plan.members = plan.members.filter((member) => {
      const indexes = eligibleIndexes.get(member.memberId) ?? [];
      if (indexes.length === 0) return false;
      if (member.executable.dataBindings.length === 0) return true;
      return member.executable.dataBindings.some((binding) => {
        const qualifiedId = `${member.memberId}:${binding.bindingId}`;
        const source = snapshot.data.find((entry) => entry.bindingId === qualifiedId);
        return Boolean(source && indexes.some((index) => source.records[index] !== undefined));
      });
    });
    if (plan.members.length === 0) throw new Error('This execution has no failed or unattempted Pack members to rerun.');
    data = data.flatMap((entry) => {
      const member = plan.kind === 'regressionPack'
        ? plan.members.find((candidate) => entry.bindingId.startsWith(`${candidate.memberId}:`))
        : undefined;
      if (!member) return [];
      const indexes = eligibleIndexes.get(member.memberId) ?? [];
      return [{
        bindingId: entry.bindingId,
        records: indexes.flatMap((index) => entry.records[index] === undefined ? [] : [entry.records[index]]),
      }];
    });
  } else {
    const eligibleIndexes = hierarchy.members[0]?.iterations
      .filter((iteration) => iteration.status !== 'passed')
      .map((iteration) => iteration.index) ?? [];
    if (eligibleIndexes.length === 0) throw new Error('This execution has no failed or unattempted transactions to rerun.');
    data = data.map((entry) => ({
      bindingId: entry.bindingId,
      records: eligibleIndexes.flatMap((index) => entry.records[index] === undefined ? [] : [entry.records[index]]),
    }));
  }
  return createExecutionPlanSnapshot(plan, data, { executionId: randomUUID() });
}

function executableIsTransactional(
  executable: Extract<ExecutionPlan, { kind: 'singleTest' | 'businessProcess' }>
): boolean {
  const assets = executable.kind === 'singleTest'
    ? [executable.testExecution.test]
    : executable.stages.map((stage) => stage.test);
  return assets.some((asset) =>
    Boolean(asset.transaction?.creates?.length)
    || asset.contract?.outputs.some((output) =>
      /(?:document|order|delivery|invoice|receipt|billing|poNumber|materialDocument)/i.test(output.name)
    )
    || /\b(?:create|post)\b.*\b(?:order|receipt|invoice|delivery|billing|document)\b/i.test(asset.name)
  );
}

function transactionalRerunRisk(
  snapshot: ExecutionPlanSnapshot,
  hierarchy: ExecutionHierarchy,
  scope: 'full' | 'failed'
): string | null {
  const plans = snapshot.plan.kind === 'regressionPack'
    ? snapshot.plan.members.map((member) => ({
        memberId: member.memberId,
        executable: member.executable,
      }))
    : [{
        memberId: hierarchy.members[0]?.memberId ?? snapshot.plan.planId,
        executable: snapshot.plan,
      }];
  for (const planned of plans) {
    if (!executableIsTransactional(
      planned.executable as Extract<ExecutionPlan, { kind: 'singleTest' | 'businessProcess' }>
    )) continue;
    const member = hierarchy.members.find((candidate) => candidate.memberId === planned.memberId)
      ?? (plans.length === 1 ? hierarchy.members[0] : undefined);
    const selected = member?.iterations.filter((iteration) =>
      scope === 'full' || iteration.status !== 'passed'
    ) ?? [];
    if (selected.some((iteration) => iteration.stages.length > 0 || iteration.status === 'passed')) {
      return scope === 'failed'
        ? 'Failed-only rerun is blocked because a selected transactional iteration already started and its SAP state is retained for compliance review.'
        : 'Full rerun is blocked because the immutable scope contains transactional iterations that already started and could duplicate SAP business documents.';
    }
  }
  return null;
}

function snapshotIsTransactional(snapshot: ExecutionPlanSnapshot): boolean {
  const executables = snapshot.plan.kind === 'regressionPack'
    ? snapshot.plan.members.map((member) => member.executable)
    : [snapshot.plan];
  return executables.some((executable) => executableIsTransactional(
    executable as Extract<ExecutionPlan, { kind: 'singleTest' | 'businessProcess' }>
  ));
}

function rerunEligibilityFor(
  record: RunRecord,
  snapshot: ExecutionPlanSnapshot | undefined,
  hierarchy: ExecutionHierarchy
): RerunEligibility {
  const terminal = record.status !== 'running' && record.status !== 'cancelling';
  const check = (scope: 'full' | 'failed'): RerunScopeEligibility => {
    if (!terminal) return { eligible: false, reason: 'Wait for the execution to reach a terminal state.' };
    if (!snapshot) return { eligible: false, reason: 'This legacy run has no immutable execution snapshot.' };
    try {
      createRerunSnapshot(snapshot, hierarchy, scope);
      return { eligible: true };
    } catch (error) {
      return { eligible: false, reason: error instanceof Error ? error.message : String(error) };
    }
  };
  return { full: check('full'), failed: check('failed') };
}

function stableTarget(target: ExecutionTargetContext | undefined): Record<string, string | null> {
  return {
    hostname: target?.hostname ?? null,
    origin: target?.origin ?? null,
    safetyClass: target?.safetyClass ?? 'unknown',
    verificationStatus: target?.verificationStatus ?? 'not-configured',
    verifiedAt: target?.verifiedAt ?? null,
  };
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`)
    .join(',')}}`;
}

function hashReview(value: unknown): string {
  return createHash('sha256').update(canonical(value)).digest('hex');
}

function dataSummary(snapshot: ExecutionPlanSnapshot): string {
  return snapshot.data
    .map((entry) => `${entry.bindingId}: ${entry.recordCount} record(s) · ${entry.contentHash.slice(0, 12)}`)
    .join('; ') || 'Implicit transaction context';
}

function policySummary(plan: ExecutionPlan): string {
  const executables = plan.kind === 'regressionPack'
    ? plan.members.map((member) => member.executable)
    : [plan];
  return [...new Set(executables.map((executable) =>
    `${executable.iterationPolicy.session}; ${executable.iterationPolicy.onIterationFailure}`
  ))].join(' | ');
}

function snapshotIterationCount(snapshot: ExecutionPlanSnapshot): number {
  if (snapshot.plan.kind !== 'regressionPack') return snapshot.data[0]?.recordCount ?? 1;
  return snapshot.plan.members.reduce((total, member) => {
    const count = snapshot.data
      .filter((entry) => entry.bindingId.startsWith(`${member.memberId}:`))
      .reduce((sum, entry) => sum + entry.recordCount, 0);
    return total + (count || 1);
  }, 0);
}

export function reviewRerun(
  id: string,
  options: {
    scope: 'full' | 'failed';
    reason: string;
    targetContext?: ExecutionTargetContext;
  }
): RerunReview {
  const original = getRun(id);
  if (!original) throw Object.assign(new Error('Unknown parent run id.'), { status: 404 });
  const snapshot = readSnapshot(original.reportDir);
  const blockingReasons: string[] = [];
  if (original.status === 'running' || original.status === 'cancelling') {
    blockingReasons.push('Wait for the parent execution to reach a terminal state.');
  }
  if (!options.reason.trim()) blockingReasons.push('A rerun reason is required for audit lineage.');
  if (!snapshot) blockingReasons.push('This legacy run does not contain a reusable execution snapshot.');
  if (
    !options.targetContext
    || options.targetContext.safetyClass === 'unknown'
    || options.targetContext.verificationStatus !== 'live-verified'
  ) {
    blockingReasons.push('The SAP target must be classified and freshly verified before rerun.');
  }
  if (snapshot && snapshotIsTransactional(snapshot) && options.targetContext?.safetyClass !== 'non-production') {
    blockingReasons.push('Transactional reruns are permitted only against a freshly verified Non-production SAP target.');
  }

  let proposed: ExecutionPlanSnapshot | null = null;
  if (snapshot) {
    try {
      proposed = createRerunSnapshot(snapshot, original.hierarchy, options.scope);
    } catch (error) {
      blockingReasons.push(error instanceof Error ? error.message : String(error));
    }
  }

  const sourceTarget = stableTarget(original.targetContext);
  const rerunTarget = stableTarget(options.targetContext);
  const differences: RerunDifference[] = snapshot ? [
    {
      area: 'plan',
      field: 'Execution Plan',
      sourceValue: snapshot.planHash,
      rerunValue: proposed?.planHash ?? 'Unavailable',
      changed: Boolean(proposed && snapshot.planHash !== proposed.planHash),
      explanation: 'Plan changes only when failed-only scope removes completed Pack members.',
    },
    {
      area: 'data',
      field: 'Immutable data snapshot',
      sourceValue: dataSummary(snapshot),
      rerunValue: proposed ? dataSummary(proposed) : 'Unavailable',
      changed: Boolean(proposed && dataSummary(snapshot) !== dataSummary(proposed)),
      explanation: 'Failed-only scope contains only eligible failed or unattempted transaction records.',
    },
    {
      area: 'policies',
      field: 'Session and failure policies',
      sourceValue: policySummary(snapshot.plan),
      rerunValue: proposed ? policySummary(proposed.plan) : 'Unavailable',
      changed: Boolean(proposed && policySummary(snapshot.plan) !== policySummary(proposed.plan)),
      explanation: 'Reruns inherit the immutable execution policies.',
    },
    {
      area: 'target',
      field: 'SAP target context',
      sourceValue: canonical(sourceTarget),
      rerunValue: canonical(rerunTarget),
      changed: canonical(sourceTarget) !== canonical(rerunTarget),
      explanation: 'The current target must be freshly verified and is recorded on the new run.',
    },
    {
      area: 'scope',
      field: 'Transaction scope',
      sourceValue: `${snapshotIterationCount(snapshot)} original iteration(s)`,
      rerunValue: proposed
        ? `${snapshotIterationCount(proposed)} ${options.scope === 'full' ? 'full-scope' : 'failed or unattempted'} iteration(s)`
        : 'Unavailable',
      changed: Boolean(proposed && (
        options.scope === 'failed'
        || snapshotIterationCount(snapshot) !== snapshotIterationCount(proposed)
      )),
      explanation: 'Completed iterations are excluded from failed-only reruns.',
    },
  ] : [];
  const changedInputs = differences.filter((difference) => difference.changed);
  const reviewIdentity = {
    parentRunId: id,
    scope: options.scope,
    reason: options.reason.trim(),
    sourceSnapshotHash: snapshot?.snapshotHash ?? null,
    proposedSnapshotHash: proposed?.snapshotHash ?? null,
    target: rerunTarget,
    blockingReasons,
    differences,
  };
  return {
    parentRunId: id,
    scope: options.scope,
    reason: options.reason.trim(),
    eligible: blockingReasons.length === 0 && Boolean(proposed),
    blockingReasons: [...new Set(blockingReasons)],
    sourceSnapshotHash: snapshot?.snapshotHash ?? null,
    proposedSnapshotHash: proposed?.snapshotHash ?? null,
    reviewHash: hashReview(reviewIdentity),
    eligibleMembers: proposed?.plan.kind === 'regressionPack' ? proposed.plan.members.length : proposed ? 1 : 0,
    eligibleIterations: proposed ? snapshotIterationCount(proposed) : 0,
    excludedPassedIterations: snapshot && proposed
      ? Math.max(0, snapshotIterationCount(snapshot) - snapshotIterationCount(proposed))
      : 0,
    differences,
    changedInputs,
  };
}

export function rerunRun(
  id: string,
  options: {
    scope: 'full' | 'failed';
    reason: string;
    requestKey: string;
    reviewHash: string;
    sensitiveValues?: string[];
    initiatedBy?: ExecutionInitiator;
    targetContext?: ExecutionTargetContext;
  }
): RunStatus {
  const original = getRun(id);
  if (!original) throw Object.assign(new Error('Unknown parent run id.'), { status: 404 });
  if (original.status === 'running' || original.status === 'cancelling') {
    throw Object.assign(new Error('Wait for the parent execution to reach a terminal state before rerunning it.'), { status: 409 });
  }
  if (!options.reason.trim()) throw Object.assign(new Error('A rerun reason is required for audit lineage.'), { status: 400 });
  if (!options.requestKey.trim()) throw Object.assign(new Error('A rerun request key is required.'), { status: 400 });
  const duplicate = existingRerun(id, options.requestKey);
  if (duplicate) return duplicate;
  const review = reviewRerun(id, {
    scope: options.scope,
    reason: options.reason,
    targetContext: options.targetContext,
  });
  if (!review.eligible) {
    throw Object.assign(new Error(review.blockingReasons.join(' ')), { status: 409 });
  }
  if (!options.reviewHash || options.reviewHash !== review.reviewHash) {
    throw Object.assign(new Error('Rerun inputs changed after review. Review the differences again.'), { status: 409 });
  }
  const snapshot = readSnapshot(original.reportDir);
  if (!snapshot || !original.request) {
    throw Object.assign(new Error('This legacy run does not contain a reusable execution snapshot.'), { status: 409 });
  }
  const nextSnapshot = createRerunSnapshot(snapshot, original.hierarchy, options.scope);
  const record = startRun({
    ...original.request,
    executionSnapshot: nextSnapshot,
    parentRunId: id,
    rerunReason: options.reason.trim(),
    rerunScope: options.scope,
    rerunRequestKey: options.requestKey,
    rerunReviewHash: review.reviewHash,
    rerunChanges: review.changedInputs,
    sensitiveValues: options.sensitiveValues,
    initiatedBy: options.initiatedBy,
    targetContext: options.targetContext,
  });
  return getRun(record.id)!;
}

export function getExecutionHealthMetrics(): ExecutionHealthMetrics {
  const ids = new Set<string>(runs.keys());
  if (existsSync(REPORTS_ROOT)) {
    for (const directory of readdirSync(REPORTS_ROOT)) {
      if (/^[A-Za-z0-9_-]+$/.test(directory)) ids.add(directory);
    }
  }
  const statuses = [...ids].flatMap((id) => {
    const status = getRun(id);
    return status ? [status] : [];
  });
  const terminal = statuses.filter((status) => status.finishedAt);
  const durationTotal = terminal.reduce(
    (total, status) => total + Math.max(0, Date.parse(status.finishedAt!) - Date.parse(status.startedAt)),
    0
  );
  const completedIterations = statuses.reduce(
    (total, status) => total + status.hierarchy.members.reduce(
      (memberTotal, member) => memberTotal + member.iterations.filter(
        (iteration) => iteration.status === 'passed' || iteration.status === 'failed'
      ).length,
      0
    ),
    0
  );
  const totalHours = durationTotal / 3_600_000;
  const evidenceExpected = statuses.reduce(
    (total, status) => total + status.hierarchy.members.reduce(
      (memberTotal, member) => memberTotal + member.iterations.filter(
        (iteration) => iteration.status === 'passed' || iteration.status === 'failed'
      ).length,
      0
    ),
    0
  );
  return {
    totalExecutions: statuses.length,
    running: statuses.filter((status) => status.status === 'running' || status.status === 'cancelling').length,
    passed: statuses.filter((status) => status.status === 'passed').length,
    failed: statuses.filter((status) => status.status === 'failed').length,
    cancelled: statuses.filter((status) => status.status === 'cancelled').length,
    averageDurationMs: terminal.length ? Math.round(durationTotal / terminal.length) : 0,
    averageStartLatencyMs: statuses.length
      ? Math.round(statuses.reduce((total, status) => total + (status.startLatencyMs ?? 0), 0) / statuses.length)
      : 0,
    completedIterations,
    iterationThroughputPerHour: totalHours > 0 ? Number((completedIterations / totalHours).toFixed(2)) : 0,
    evidenceExpected,
    evidenceAvailable: statuses.reduce((total, status) => total + status.evidenceDocuments.length, 0),
    failureCategories: statuses.reduce((categories, status) => {
      if (status.diagnosis) categories[status.diagnosis.category] += 1;
      return categories;
    }, {
      setup: 0,
      data: 0,
      object: 0,
      authentication: 0,
      navigation: 0,
      assertion: 0,
      execution: 0,
    } as Record<FailureDiagnosis['category'], number>),
  };
}
