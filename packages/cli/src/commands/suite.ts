import { Command } from 'commander';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { userInfo } from 'node:os';
import path from 'node:path';
import { ObjectRepository, DocumentLog, RunHistoryStore, TestCase, getCredentials } from '@taf/core';
import { ModuleRegistry, translateLegacySuite } from '@taf/engine';
import { writeHtmlReport, writeJsonReport, writeAuditEvidencePdf } from '@taf/reporting';
import { createExecutionProgressReporter, loadExecutionSnapshot, reportInputFields, runExecutionPlan } from '../executionPlanRuntime';

interface EvidenceManifestEntry {
  runId: string;
  label: string;
  archivePath: string;
}

/**
 * Like `run`, but for INDEPENDENT test cases rather than dependent stages of one
 * flow: each file gets its own fresh browser session (no shared runState — one
 * test case's captured PO number, say, has no business leaking into another's
 * run), and a failure in one does not stop the rest from running — the point of
 * a suite is "run everything and tell me what broke", not fail-fast. Reports are
 * still numbered run-1.json, run-2.json, ... in the same sequential convention
 * `run` uses, so anything that already reads a report directory (Studio's poller
 * included) doesn't need to know suite mode exists.
 */
export function registerSuiteCommand(program: Command): void {
  program
    .command('suite <testCaseFiles...>')
    .description('Run independent test cases as a suite — each gets its own session, and one failing does not stop the others')
    .requiredOption('--app-id <appId>', 'object repository app id for these test cases')
    .option('--data <path>', 'path to a data-driven CSV/JSON file — applied to every test case in the suite')
    .option('--profile <name>', 'credential profile name', 'default')
    .option('--object-db <path>', 'object repository SQLite path', 'object-repository.db')
    .option('--document-db <path>', 'captured document number log SQLite path', 'document-log.db')
    .option('--run-history-db <path>', 'append-only run audit ledger SQLite path', 'run-history.db')
    .option('--evidence-archive <path>', 'permanent evidence archive directory (outside the disposable report dir)', 'audit-evidence')
    .option('--report-dir <path>', 'output directory for reports/screenshots', 'reports')
    .option('--headless <bool>', 'run headless', 'true')
    .option('--session-policy <policy>', 'fresh-per-iteration or reuse-within-process')
    .option('--iteration-failure <policy>', 'stop-execution or continue-next-iteration')
    .option('--max-records <count>', 'maximum records per Pack member')
    .option('--execution-snapshot <path>', 'immutable preflight-approved execution snapshot')
    .option('--executed-by <identity>', 'authenticated Studio owner who initiated the execution')
    .option('--target-hostname <hostname>', 'non-secret SAP target hostname captured at Start')
    .option('--target-safety-class <classification>', 'SAP target safety classification captured at Start')
    .option('--target-verified-at <timestamp>', 'SAP target verification timestamp captured at Start')
    .option('--cancel-file <path>', 'cooperative cancellation signal file')
    .option(
      '--evidence-doc [path]',
      'deprecated compatibility flag; canonical audit evidence PDFs are generated automatically'
    )
    .action(async (testCaseFiles: string[], opts) => {
      const testAssets = testCaseFiles.map((file) => ({
        file,
        testCase: JSON.parse(readFileSync(file, 'utf-8')) as TestCase,
        appId: opts.appId,
      }));
      const objectRepository = new ObjectRepository(opts.objectDb);
      const documentLog = new DocumentLog(opts.documentDb);
      const runHistory = new RunHistoryStore(opts.runHistoryDb);
      const registry = new ModuleRegistry();
      const credentials = await getCredentials(opts.profile);
      const executedBy = typeof opts.executedBy === 'string' && opts.executedBy.trim()
        ? opts.executedBy.trim().slice(0, 256)
        : userInfo().username;

      mkdirSync(opts.reportDir, { recursive: true });
      const evidenceManifest: EvidenceManifestEntry[] = [];
      const translatedPlan = translateLegacySuite(testAssets, {
        name: 'Legacy regression suite',
        profileRef: opts.profile,
        dataFile: opts.data,
        sessionPolicy: opts.sessionPolicy,
        iterationFailurePolicy: opts.iterationFailure,
        maxRecords: opts.maxRecords ? Number(opts.maxRecords) : undefined,
      });
      const approved = opts.executionSnapshot ? loadExecutionSnapshot(opts.executionSnapshot) : undefined;
      const plan = approved?.snapshot.plan ?? translatedPlan;
      const tests = new Map(testAssets.map(({ file, testCase }) => [file.replace(/\\/g, '/'), testCase]));
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
        onEvent: createExecutionProgressReporter({
          plan,
          tests,
          reportDir: opts.reportDir,
          dataSnapshots: approved?.dataSnapshots,
        }),
      });
      const iterations = execution.members.flatMap((member) =>
        member.iterations.map((iteration) => ({ member, iteration }))
      );

      for (const [index, { member, iteration }] of iterations.entries()) {
          const runIndex = index + 1;
          const runId = randomUUID();
          const result = iteration.result;
          if (!result) {
            console.error(`Suite ${runIndex}/${iterations.length} [${member.name}]: FAILED before test execution â€” ${iteration.error ?? 'Unknown error'}`);
            continue;
          }

          const base = path.join(opts.reportDir, `run-${runIndex}`);
          writeJsonReport(result, `${base}.json`);
          writeHtmlReport(result, `${base}.html`);
          documentLog.recordAll(opts.appId, result.testCaseName, result.capturedValues, opts.reportDir, runId);

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
              mode: 'suite',
              appId: opts.appId,
              status: result.status,
              executedBy,
              startedAt: result.startedAt,
              finishedAt,
              stages: result.stages,
              fieldEvidence: result.fieldEvidence,
              inputFields: reportInputFields(iteration.inputRecord),
              outputFields: result.capturedValues,
            },
            evidencePdfPath
          );

          runHistory.record({
            id: runId,
            startedAt: result.startedAt,
            finishedAt,
            status: result.status,
            executedBy,
            mode: 'suite',
            appId: opts.appId,
            testCaseNames: result.stages.map((stage) => stage.testCaseName),
            dataFile: opts.data ? path.basename(opts.data) : undefined,
            result,
            evidencePdfPath,
          });
          evidenceManifest.push({
            runId,
            label: result.testCaseName,
            archivePath: path.join(runId, 'evidence.pdf'),
          });
          writeFileSync(
            path.join(opts.reportDir, 'evidence-manifest.json'),
            JSON.stringify({ documents: evidenceManifest }, null, 2)
          );

          console.log(`Suite ${runIndex}/${iterations.length} [${member.name}]: ${result.status.toUpperCase()} (${result.durationMs.toFixed(0)} ms) -> ${base}.html`);
      }

      objectRepository.close();
      documentLog.close();
      runHistory.close();

      process.exitCode = execution.status === 'cancelled' ? 2 : execution.status === 'failed' ? 1 : 0;
    });
}
