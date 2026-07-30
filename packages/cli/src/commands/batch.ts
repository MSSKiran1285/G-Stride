import { Command } from 'commander';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { userInfo } from 'node:os';
import path from 'node:path';
import {
  DocumentLog,
  ObjectRepository,
  RunHistoryStore,
  TestCase,
  getCredentials,
  loadDataSet,
} from '@taf/core';
import {
  ExecutionOrchestrationEvent,
  ModuleRegistry,
  translateLegacyBatch,
} from '@taf/engine';
import { GlossaryEntry, TrainingSupplement, writeAuditEvidencePdf } from '@taf/reporting';
import { createExecutionEventRecorder, loadExecutionSnapshot, reportInputFields, runExecutionPlan } from '../executionPlanRuntime';

interface GroupDefinition {
  name: string;
  appId: string;
  testCaseFiles: string[];
  dataFile?: string;
  narrative?: string;
  glossary?: GlossaryEntry[];
  trainingSupplement?: TrainingSupplement;
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
  evidenceArchivePath: string | null;
  stages: unknown[];
  iterationIndex: number;
  iterationCount: number;
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

function testStepCount(testCases: TestCase[]): number {
  return testCases.reduce(
    (total, testCase, index) =>
      total + (index === 0
        ? testCase.steps.length
        : testCase.steps.filter((step) => step.module !== 'Login').length),
    0
  );
}

/** Legacy Batch now translates to a Regression Pack of Business Processes. */
export function registerBatchCommand(program: Command): void {
  program
    .command('batch [groupFiles...]')
    .description('Run named Business Processes independently, once for every record in each Group dataset')
    .option('--profile <name>', 'credential profile name', 'default')
    .option('--object-db <path>', 'object repository SQLite path', 'object-repository.db')
    .option('--document-db <path>', 'captured document number log SQLite path', 'document-log.db')
    .option('--run-history-db <path>', 'append-only run audit ledger SQLite path', 'run-history.db')
    .option('--evidence-archive <path>', 'permanent evidence archive directory (outside the disposable report dir)', 'audit-evidence')
    .option('--report-dir <path>', 'output directory for reports/screenshots', 'reports')
    .option('--headless <bool>', 'run headless', 'true')
    .option('--session-policy <policy>', 'fresh-per-iteration or reuse-within-process')
    .option('--iteration-failure <policy>', 'stop-execution or continue-next-iteration')
    .option('--max-records <count>', 'maximum records per Business Process')
    .option('--execution-snapshot <path>', 'immutable preflight-approved execution snapshot')
    .option('--executed-by <identity>', 'authenticated Studio owner who initiated the execution')
    .option('--target-hostname <hostname>', 'non-secret SAP target hostname captured at Start')
    .option('--target-safety-class <classification>', 'SAP target safety classification captured at Start')
    .option('--target-verified-at <timestamp>', 'SAP target verification timestamp captured at Start')
    .option('--cancel-file <path>', 'cooperative cancellation signal file')
    .option('--evidence-doc', 'deprecated compatibility flag; canonical audit evidence PDFs are generated automatically')
    .action(async (groupFiles: string[], opts) => {
      const approved = opts.executionSnapshot ? loadExecutionSnapshot(opts.executionSnapshot) : undefined;
      if (groupFiles.length === 0 && !approved) {
        throw new Error('Batch requires at least one Business Process or an approved execution snapshot.');
      }
      if (approved && approved.snapshot.plan.kind !== 'regressionPack') {
        throw new Error('Batch execution snapshots must contain a Regression Pack.');
      }
      const approvedPlan = approved?.snapshot.plan.kind === 'regressionPack'
        ? approved.snapshot.plan
        : undefined;
      const groups: GroupDefinition[] = groupFiles.length > 0
        ? groupFiles.map((file) => JSON.parse(readFileSync(file, 'utf-8')))
        : approvedPlan!.members.map((member) => {
            const executions = member.executable.kind === 'singleTest'
              ? [member.executable.testExecution]
              : member.executable.stages;
            const firstBinding = member.executable.dataBindings[0];
            return {
              name: member.name,
              appId: executions[0]?.test.appId ?? 'default',
              testCaseFiles: executions.map((execution) => execution.test.file),
              dataFile: firstBinding?.source.files[0]
                ? path.basename(firstBinding.source.files[0])
                : undefined,
            };
          });
      const testAssetsByGroup = groups.map((group) =>
        group.testCaseFiles.map((file) => {
          const normalized = file.replace(/\\/g, '/');
          const resolvedFile = normalized.startsWith('testcases/')
            ? normalized
            : path.join('testcases', file);
          return {
            file: resolvedFile,
            testCase: JSON.parse(readFileSync(resolvedFile, 'utf-8')) as TestCase,
            appId: group.appId,
          };
        })
      );
      const plannedIterations = groups.map((group, index) => {
        if (approvedPlan) {
          const memberId = approvedPlan.members[index]?.memberId;
          if (!memberId) return 1;
          const snapshotRecords = approved!.snapshot.data
            .filter((entry) => entry.bindingId.startsWith(`${memberId}:`))
            .reduce((total, entry) => total + entry.recordCount, 0);
          return snapshotRecords || 1;
        }
        if (!group.dataFile) return 1;
        const count = loadDataSet(path.join('data', group.dataFile)).length;
        return opts.maxRecords ? Math.min(count, Number(opts.maxRecords)) : count;
      });
      const totalIterations = plannedIterations.reduce((total, count) => total + count, 0);
      const iterationStepCounts = testAssetsByGroup.map((assets) =>
        testStepCount(assets.map(({ testCase }) => testCase))
      );
      const stageStepCounts = testAssetsByGroup.map((assets) =>
        assets.map(({ testCase }, stageIndex) =>
          stageIndex === 0
            ? testCase.steps.length
            : testCase.steps.filter((step) => step.module !== 'Login').length
        )
      );
      const totalSteps = iterationStepCounts.reduce(
        (total, steps, index) => total + steps * plannedIterations[index],
        0
      );
      const totalStages = testAssetsByGroup.reduce(
        (total, assets, index) => total + assets.length * plannedIterations[index],
        0
      );

      const objectRepository = new ObjectRepository(opts.objectDb);
      const documentLog = new DocumentLog(opts.documentDb);
      const runHistory = new RunHistoryStore(opts.runHistoryDb);
      const registry = new ModuleRegistry();
      const credentials = await getCredentials(opts.profile);
      const executedBy = typeof opts.executedBy === 'string' && opts.executedBy.trim()
        ? opts.executedBy.trim().slice(0, 256)
        : userInfo().username;
      mkdirSync(opts.reportDir, { recursive: true });

      const progressPath = path.join(opts.reportDir, 'progress.json');
      let completedIterations = 0;
      let completedSteps = 0;
      let completedStages = 0;
      let activeStepBase = 0;
      let activeStageBase = 0;
      let currentGroup = groups[0]?.name ?? '';
      const writeProgress = (change: Partial<BatchProgressFile> = {}) => {
        const progress: BatchProgressFile = {
          completedGroups: completedIterations,
          totalGroups: totalIterations,
          completedSteps,
          totalSteps,
          completedStages,
          totalStages,
          currentGroup,
          currentStage: '',
          currentStep: 'Preparing execution',
          percent: totalSteps > 0 ? Math.min(100, Math.round((completedSteps / totalSteps) * 100)) : 0,
          ...change,
        };
        writeFileSync(progressPath, JSON.stringify(progress, null, 2));
      };
      writeProgress();

      const plan = approvedPlan ?? translateLegacyBatch(
          groups.map((group, index) => ({
            name: group.name,
            appId: group.appId,
            tests: testAssetsByGroup[index],
            dataFile: group.dataFile ? path.join('data', group.dataFile) : undefined,
          })),
          {
            name: 'Legacy Batch',
            profileRef: opts.profile,
            sessionPolicy: opts.sessionPolicy,
            iterationFailurePolicy: opts.iterationFailure,
            maxRecords: opts.maxRecords ? Number(opts.maxRecords) : undefined,
          }
        );
      const tests = new Map<string, TestCase>();
      for (const assets of testAssetsByGroup) {
        for (const asset of assets) tests.set(asset.file.replace(/\\/g, '/'), asset.testCase);
      }
      const memberIndex = new Map(
        plan.kind === 'regressionPack'
          ? plan.members.map((member, index) => [member.memberId, index])
          : []
      );

      const recordEvent = createExecutionEventRecorder(opts.reportDir);
      const onEvent = (event: ExecutionOrchestrationEvent) => {
        recordEvent(event);
        if (event.type === 'iteration-started') {
          const index = memberIndex.get(event.context.memberId) ?? 0;
          currentGroup = groups[index]?.name ?? event.context.memberName;
          activeStepBase = completedSteps;
          activeStageBase = completedStages;
          writeProgress({ currentGroup, currentStep: `Starting record ${event.context.iterationIndex + 1}` });
        } else if (event.type === 'stage-progress') {
          const index = memberIndex.get(event.context.memberId) ?? 0;
          const executable = plan.kind === 'regressionPack'
            ? plan.members[index]?.executable
            : undefined;
          const stageIndex = executable?.kind === 'businessProcess'
            ? Math.max(0, executable.stages.findIndex((stage) => stage.stageId === event.stageId))
            : 0;
          const stageOffset = (stageStepCounts[index] ?? [])
            .slice(0, stageIndex)
            .reduce((total, count) => total + count, 0);
          writeProgress({
            completedSteps: activeStepBase + stageOffset + event.progress.completedSteps,
            completedStages: activeStageBase + stageIndex + event.progress.completedStages,
            currentGroup,
            currentStage: event.progress.currentStage,
            currentStep: event.progress.currentStep,
            childWork: event.progress.childWork,
            percent: totalSteps > 0
              ? Math.min(99, Math.round(((activeStepBase + stageOffset + event.progress.completedSteps) / totalSteps) * 100))
              : 0,
          });
        } else if (event.type === 'iteration-completed') {
          completedIterations++;
          completedSteps = activeStepBase + event.completedSteps;
          completedStages = activeStageBase + event.completedStages;
          writeProgress({
            completedGroups: completedIterations,
            completedSteps,
            completedStages,
            currentGroup,
            currentStep: event.status === 'passed' ? 'Record completed' : 'Record failed',
            percent: totalIterations > 0
              ? Math.min(99, Math.round((completedIterations / totalIterations) * 100))
              : 0,
          });
        }
      };

      const execution = await runExecutionPlan({
        plan,
        tests,
        objectRepository,
        registry,
        reportDir: opts.reportDir,
        headless: opts.headless === 'true',
        credentials,
        dataSnapshots: approved?.dataSnapshots,
        cancellationFile: opts.cancelFile,
        onEvent,
      });

      const summaries: BatchGroupResult[] = [];
      if (plan.kind !== 'regressionPack') throw new Error('Batch compatibility translation did not produce a Regression Pack.');
      for (const [groupIndex, member] of execution.members.entries()) {
        const group = groups[groupIndex];
        const iterationCount = member.plannedIterations || plannedIterations[groupIndex] || 1;
        if (member.iterations.length === 0) {
          summaries.push({
            name: group.name,
            status: 'failed',
            totalTestCases: group.testCaseFiles.length,
            passedCount: 0,
            failedTestCase: null,
            passPercent: 0,
            durationMs: 0,
            evidenceArchivePath: null,
            stages: [],
            iterationIndex: 0,
            iterationCount,
            error: member.error ?? 'The Business Process could not start.',
          });
          continue;
        }

        for (const iteration of member.iterations) {
          const result = iteration.result;
          const displayName = iterationCount > 1
            ? `${group.name} Â· Record ${iteration.iterationIndex + 1}`
            : group.name;
          if (!result) {
            summaries.push({
              name: displayName,
              status: 'failed',
              totalTestCases: group.testCaseFiles.length,
              passedCount: 0,
              failedTestCase: null,
              passPercent: 0,
              durationMs: 0,
              evidenceArchivePath: null,
              stages: [],
              iterationIndex: iteration.iterationIndex,
              iterationCount,
              error: iteration.error ?? 'The iteration could not start.',
            });
            continue;
          }

          const runId = randomUUID();
          const finishedAt = new Date().toISOString();
          const evidencePdfPath = path.join(opts.evidenceArchive, runId, 'evidence.pdf');
          mkdirSync(path.dirname(evidencePdfPath), { recursive: true });
          await writeAuditEvidencePdf(
            {
              runId,
              executionId: approved?.snapshot.executionId,
              planHash: approved?.snapshot.planHash,
              snapshotHash: approved?.snapshot.snapshotHash,
              planSchemaVersion: approved?.snapshot.plan.schemaVersion,
              snapshotSchemaVersion: approved?.snapshot.schemaVersion,
              dataVersions: approved?.snapshot.data.map((entry) => `${entry.bindingId}: ${entry.contentHash}`),
              targetHostname: opts.targetHostname,
              targetSafetyClass: opts.targetSafetyClass,
              targetVerifiedAt: opts.targetVerifiedAt,
              redactionState: 'enforced',
              memberId: member.memberId,
              iterationId: iteration.iterationId,
              mode: 'batch',
              appId: group.appId,
              status: result.status,
              executedBy,
              startedAt: result.startedAt,
              finishedAt,
              stages: result.stages,
              fieldEvidence: result.fieldEvidence,
              inputFields: reportInputFields(iteration.inputRecord),
              outputFields: result.capturedValues,
              narrative: group.narrative,
              glossary: group.glossary,
              trainingSupplement: group.trainingSupplement,
              documentTitle: group.documentTitle,
              documentSubtitle: group.documentSubtitle,
              testCaseId: group.testCaseId,
            },
            evidencePdfPath
          );
          documentLog.recordAll(group.appId, displayName, result.capturedValues, opts.reportDir, runId);
          runHistory.record({
            id: runId,
            startedAt: result.startedAt,
            finishedAt,
            status: result.status,
            executedBy,
            mode: 'batch',
            appId: group.appId,
            testCaseNames: result.stages.map((stage) => stage.testCaseName),
            dataFile: group.dataFile,
            result,
            evidencePdfPath,
          });

          const passedCount = result.stages.filter((stage) => stage.status === 'passed').length;
          const failedStage = result.stages.find((stage) => stage.status === 'failed');
          summaries.push({
            name: displayName,
            status: result.status,
            totalTestCases: group.testCaseFiles.length,
            passedCount,
            failedTestCase: failedStage?.testCaseName ?? null,
            passPercent: Math.round((passedCount / Math.max(1, group.testCaseFiles.length)) * 100),
            durationMs: result.durationMs,
            evidenceArchivePath: path.join(runId, 'evidence.pdf'),
            stages: result.stages,
            iterationIndex: iteration.iterationIndex,
            iterationCount,
          });
          console.log(
            `Batch "${displayName}": ${result.status.toUpperCase()} (${passedCount}/${group.testCaseFiles.length} stages passed)`
          );
        }
      }

      writeFileSync(
        path.join(opts.reportDir, 'summary.json'),
        JSON.stringify({ groups: summaries }, null, 2)
      );
      writeProgress({
        completedGroups: totalIterations,
        completedSteps: totalSteps,
        completedStages: totalStages,
        currentStep: execution.status === 'passed' ? 'Execution completed' : 'Execution completed with failures',
        percent: 100,
      });

      objectRepository.close();
      documentLog.close();
      runHistory.close();
      process.exitCode = execution.status === 'cancelled' ? 2 : execution.status === 'failed' ? 1 : 0;
    });
}
