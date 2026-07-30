import { Command } from 'commander';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { userInfo } from 'node:os';
import path from 'node:path';
import { ObjectRepository, DocumentLog, RunHistoryStore, TestCase, getCredentials } from '@taf/core';
import { ModuleRegistry, translateLegacyChain } from '@taf/engine';
import { writeHtmlReport, writeJsonReport, writeAuditEvidencePdf } from '@taf/reporting';
import { createExecutionProgressReporter, loadExecutionSnapshot, reportInputFields, runExecutionPlan } from '../executionPlanRuntime';

interface EvidenceManifestEntry {
  runId: string;
  label: string;
  archivePath: string;
}

export function registerRunCommand(program: Command): void {
  program
    .command('run <testCaseFiles...>')
    .description(
      'Execute one or more test case files in sequence (sharing one browser session and captured values), optionally once per row of a data-driven dataset'
    )
    .requiredOption('--app-id <appId>', 'object repository app id for this test case')
    .option('--data <path>', 'path to a data-driven CSV/JSON file')
    .option('--profile <name>', 'credential profile name', 'default')
    .option('--object-db <path>', 'object repository SQLite path', 'object-repository.db')
    .option('--document-db <path>', 'captured document number log SQLite path', 'document-log.db')
    .option('--run-history-db <path>', 'append-only run audit ledger SQLite path', 'run-history.db')
    .option('--evidence-archive <path>', 'permanent per-run evidence PDF archive directory (outside the disposable report dir)', 'audit-evidence')
    .option('--report-dir <path>', 'output directory for reports/screenshots', 'reports')
    .option('--headless <bool>', 'run headless', 'true')
    .option('--session-policy <policy>', 'fresh-per-iteration or reuse-within-process')
    .option('--iteration-failure <policy>', 'stop-execution or continue-next-iteration')
    .option('--max-records <count>', 'maximum transaction records to execute')
    .option('--execution-snapshot <path>', 'immutable preflight-approved execution snapshot')
    .option('--executed-by <identity>', 'authenticated Studio owner who initiated the execution')
    .option('--target-hostname <hostname>', 'non-secret SAP target hostname captured at Start')
    .option('--target-safety-class <classification>', 'SAP target safety classification captured at Start')
    .option('--target-verified-at <timestamp>', 'SAP target verification timestamp captured at Start')
    .option('--cancel-file <path>', 'cooperative cancellation signal file')
    .option(
      '--evidence-doc [path]',
      'deprecated compatibility flag; the canonical audit evidence PDF is generated automatically'
    )
    .action(async (testCaseFiles, opts) => {
      const testAssets = (testCaseFiles as string[]).map((file) => ({
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
      const translatedPlan = translateLegacyChain(testAssets, {
        name: testAssets.map(({ testCase }) => testCase.name).join(' â†’ '),
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
      const iterations = execution.members.flatMap((member) => member.iterations);

      for (const [index, iteration] of iterations.entries()) {
        const runId = randomUUID();
        const result = iteration.result;
        if (!result) {
          console.error(`Run ${index + 1}/${iterations.length}: FAILED before test execution â€” ${iteration.error ?? 'Unknown error'}`);
          continue;
        }

        const base = path.join(opts.reportDir, `run-${index + 1}`);
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
            memberId: execution.members[0]?.memberId,
            iterationId: iteration.iterationId,
            mode: 'chain',
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
          mode: 'chain',
          appId: opts.appId,
          testCaseNames: testAssets.map(({ testCase }) => testCase.name),
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

        console.log(
          `Run ${index + 1}/${iterations.length}: ${result.status.toUpperCase()} (${result.durationMs.toFixed(0)} ms) -> ${base}.html`
        );
      }

      objectRepository.close();
      documentLog.close();
      runHistory.close();

      process.exitCode = execution.status === 'cancelled' ? 2 : execution.status === 'failed' ? 1 : 0;
    });
}
