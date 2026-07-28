import { Command } from 'commander';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { userInfo } from 'node:os';
import path from 'node:path';
import { ObjectRepository, DocumentLog, RunHistoryStore, TestCase, getCredentials, loadDataSet } from '@taf/core';
import { ModuleRegistry, executeGroup, GroupStageResult } from '@taf/engine';
import { FioriPlaywrightAdapter } from '@taf/adapter-fiori';
import { writeAuditEvidencePdf, GlossaryEntry, TrainingSupplement } from '@taf/reporting';

interface GroupDefinition {
  name: string;
  appId: string;
  testCaseFiles: string[];
  dataFile?: string;
  /** Hand-authored training/audit content for the whole group — see writeAuditEvidencePdf.
   * Per-stage content (objective, preconditions, etc.) lives on each TestCase file instead. */
  narrative?: string;
  glossary?: GlossaryEntry[];
  trainingSupplement?: TrainingSupplement;
  /** Optional evidence-document identity. */
  documentTitle?: string;
  documentSubtitle?: string;
  testCaseId?: string;
}

interface BatchGroupResult {
  name: string;
  status: 'passed' | 'failed';
  totalTestCases: number;
  passedCount: number;
  failedTestCase: string | null;
  passPercent: number;
  durationMs: number;
  /** Relative to --evidence-archive, e.g. "<run-id>/evidence.pdf". */
  evidenceArchivePath: string | null;
  stages: GroupStageResult[];
  /** Set when the group couldn't even start (bad file reference, malformed JSON, browser launch failure) —
   *  distinct from a test case failing mid-run, but still just "this group failed", not a batch-wide crash. */
  error?: string;
}

interface BatchProgressFile {
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

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'group';
}

/**
 * Runs several named Groups (each a dependent chain of test cases with its
 * own data file) independently: a group that fails exits *that* group only —
 * the other groups still run, and each pass/fail is tracked on its own. This
 * is the "batch" concept — a suite whose members are whole chains, not
 * single test cases.
 */
export function registerBatchCommand(program: Command): void {
  program
    .command('batch <groupFiles...>')
    .description('Run named groups (each a dependent chain with its own data file) independently — a failing group does not stop the others')
    .option('--profile <name>', 'credential profile name', 'default')
    .option('--object-db <path>', 'object repository SQLite path', 'object-repository.db')
    .option('--document-db <path>', 'captured document number log SQLite path', 'document-log.db')
    .option('--run-history-db <path>', 'append-only run audit ledger SQLite path', 'run-history.db')
    .option('--evidence-archive <path>', 'permanent evidence archive directory (outside the disposable report dir)', 'audit-evidence')
    .option('--report-dir <path>', 'output directory for reports/screenshots', 'reports')
    .option('--headless <bool>', 'run headless', 'true')
    .option('--evidence-doc', 'deprecated compatibility flag; canonical audit evidence PDFs are generated automatically')
    .action(async (groupFiles: string[], opts) => {
      const now = new Date();
      const today = `${String(now.getMonth() + 1).padStart(2, '0')}/${String(now.getDate()).padStart(2, '0')}/${now.getFullYear()}`;
      const groups: GroupDefinition[] = groupFiles.map((f) => JSON.parse(readFileSync(f, 'utf-8')));
      const objectRepository = new ObjectRepository(opts.objectDb);
      const documentLog = new DocumentLog(opts.documentDb);
      const runHistory = new RunHistoryStore(opts.runHistoryDb);
      const registry = new ModuleRegistry();
      const credentials = await getCredentials(opts.profile);
      const executedBy = userInfo().username;

      mkdirSync(opts.reportDir, { recursive: true });
      const progressPath = path.join(opts.reportDir, 'progress.json');
      const writeProgress = (progress: BatchProgressFile) => {
        writeFileSync(progressPath, JSON.stringify(progress, null, 2));
      };

      let anyGroupFailed = false;
      const summaries: BatchGroupResult[] = [];
      writeProgress({
        completedGroups: 0,
        totalGroups: groups.length,
        completedSteps: 0,
        totalSteps: 0,
        completedStages: 0,
        totalStages: 0,
        currentGroup: groups[0]?.name ?? '',
        currentStage: '',
        currentStep: 'Preparing execution',
        percent: 0,
      });

      for (const [groupIndex, group] of groups.entries()) {
        const slug = slugify(group.name);
        const groupDir = path.join(opts.reportDir, slug);
        mkdirSync(groupDir, { recursive: true });
        const groupStart = Date.now();
        const runId = randomUUID();
        const runStartedAt = new Date().toISOString();
        let adapter: FioriPlaywrightAdapter | undefined;

        try {
          // Always capture annotated field evidence for the group's canonical audit PDF.
          const evidenceDir = path.join(groupDir, 'evidence');
          mkdirSync(evidenceDir, { recursive: true });

          // Group files store bare test case / data file names (as saved by the Groups tab), the
          // same way testCaseFiles/dataFile arrive from studio-server for chain/suite mode — resolve
          // them relative to the CLI's cwd (the repo root), not relative to the group file itself.
          const testCases: TestCase[] = group.testCaseFiles.map((f) => JSON.parse(readFileSync(path.join('testcases', f), 'utf-8')));
          const dataRows = group.dataFile ? loadDataSet(path.join('data', group.dataFile)) : [{}];
          const dataRow = dataRows[0] ?? {};
          const runDataRow = {
            ...dataRow,
            url: credentials.url,
            urlBase: credentials.url.replace(/\/+$/, ''),
            username: credentials.username,
            password: credentials.password,
            today,
          };

          adapter = new FioriPlaywrightAdapter({ headless: opts.headless === 'true' });
          const result = await executeGroup(testCases, adapter, objectRepository, registry, {
            appId: group.appId,
            dataRow: runDataRow,
            screenshotDir: groupDir,
            evidenceDir,
            onProgress: (progress) => {
              const groupFraction = progress.totalSteps > 0 ? progress.completedSteps / progress.totalSteps : 0;
              writeProgress({
                completedGroups: groupIndex,
                totalGroups: groups.length,
                completedSteps: progress.completedSteps,
                totalSteps: progress.totalSteps,
                completedStages: progress.completedStages,
                totalStages: progress.totalStages,
                currentGroup: group.name,
                currentStage: progress.currentStage,
                currentStep: progress.currentStep,
                percent: Math.min(99, Math.round(((groupIndex + groupFraction) / groups.length) * 100)),
              });
            },
          });

          documentLog.recordAll(group.appId, group.name, result.capturedValues, groupDir, runId);

          const auditFinishedAt = new Date().toISOString();
          const auditEvidencePdfPath = path.join(opts.evidenceArchive, runId, 'evidence.pdf');
          mkdirSync(path.dirname(auditEvidencePdfPath), { recursive: true });
          await writeAuditEvidencePdf(
            {
              runId,
              mode: 'batch',
              appId: group.appId,
              status: result.status,
              executedBy,
              startedAt: runStartedAt,
              finishedAt: auditFinishedAt,
              stages: result.stages,
              fieldEvidence: result.fieldEvidence,
              inputFields: dataRow,
              outputFields: result.capturedValues,
              narrative: group.narrative,
              glossary: group.glossary,
              trainingSupplement: group.trainingSupplement,
              documentTitle: group.documentTitle,
              documentSubtitle: group.documentSubtitle,
              testCaseId: group.testCaseId,
            },
            auditEvidencePdfPath
          );

          runHistory.record({
            id: runId,
            startedAt: runStartedAt,
            finishedAt: auditFinishedAt,
            status: result.status,
            executedBy,
            mode: 'batch',
            appId: group.appId,
            testCaseNames: result.stages.map((s) => s.testCaseName),
            dataFile: group.dataFile,
            result,
            evidencePdfPath: auditEvidencePdfPath,
          });

          const passedCount = result.stages.filter((s) => s.status === 'passed').length;
          const failedStage = result.stages.find((s) => s.status === 'failed');
          summaries.push({
            name: group.name,
            status: result.status,
            totalTestCases: result.totalTestCases,
            passedCount,
            failedTestCase: failedStage?.testCaseName ?? null,
            passPercent: Math.round((passedCount / result.totalTestCases) * 100),
            durationMs: result.durationMs,
            evidenceArchivePath: path.join(runId, 'evidence.pdf'),
            stages: result.stages,
          });
          writeProgress({
            completedGroups: summaries.length,
            totalGroups: groups.length,
            completedSteps: result.stages.reduce((total, stage) => total + stage.steps.length, 0),
            totalSteps: result.stages.reduce((total, stage) => total + stage.steps.length, 0),
            completedStages: result.stages.length,
            totalStages: result.totalTestCases,
            currentGroup: group.name,
            currentStage: result.stages[result.stages.length - 1]?.testCaseName ?? '',
            currentStep: result.status === 'passed' ? 'Group completed' : 'Group failed',
            percent: Math.round((summaries.length / groups.length) * 100),
          });

          console.log(
            `Batch group "${group.name}": ${result.status.toUpperCase()} (${passedCount}/${result.totalTestCases} test cases passed)`
          );
          if (result.status === 'failed') anyGroupFailed = true;
        } catch (err) {
          // A group that can't even start (bad file reference, malformed JSON, browser launch
          // failure) is still just "this group failed" — it must not take the other groups down with it.
          const message = err instanceof Error ? err.message : String(err);
          summaries.push({
            name: group.name,
            status: 'failed',
            totalTestCases: group.testCaseFiles.length,
            passedCount: 0,
            failedTestCase: null,
            passPercent: 0,
            durationMs: Date.now() - groupStart,
            evidenceArchivePath: null,
            stages: [],
            error: message,
          });
          writeProgress({
            completedGroups: summaries.length,
            totalGroups: groups.length,
            completedSteps: 0,
            totalSteps: 0,
            completedStages: 0,
            totalStages: group.testCaseFiles.length,
            currentGroup: group.name,
            currentStage: '',
            currentStep: `Group failed to start: ${message}`,
            percent: Math.round((summaries.length / groups.length) * 100),
          });
          console.log(`Batch group "${group.name}": FAILED to start — ${message}`);
          anyGroupFailed = true;
          runHistory.record({
            id: runId,
            startedAt: runStartedAt,
            finishedAt: new Date().toISOString(),
            status: 'failed',
            executedBy,
            mode: 'batch',
            appId: group.appId,
            testCaseNames: group.testCaseFiles,
            dataFile: group.dataFile,
            result: { error: message },
          });
        } finally {
          if (adapter) await adapter.close().catch(() => undefined);
        }
      }

      objectRepository.close();
      documentLog.close();
      runHistory.close();

      writeFileSync(path.join(opts.reportDir, 'summary.json'), JSON.stringify({ groups: summaries }, null, 2));

      process.exitCode = anyGroupFailed ? 1 : 0;
    });
}
