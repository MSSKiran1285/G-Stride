import { Command } from 'commander';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { userInfo } from 'node:os';
import path from 'node:path';
import { ObjectRepository, DocumentLog, RunHistoryStore, TestCase, getCredentials, loadDataSet } from '@taf/core';
import { ModuleRegistry, executeTestCaseChain } from '@taf/engine';
import { FioriPlaywrightAdapter } from '@taf/adapter-fiori';
import { writeHtmlReport, writeJsonReport, writeAuditEvidencePdf } from '@taf/reporting';

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
    .option(
      '--evidence-doc [path]',
      'deprecated compatibility flag; the canonical audit evidence PDF is generated automatically'
    )
    .action(async (testCaseFiles, opts) => {
      const now = new Date();
      const today = `${String(now.getMonth() + 1).padStart(2, '0')}/${String(now.getDate()).padStart(2, '0')}/${now.getFullYear()}`;
      const testCases: TestCase[] = testCaseFiles.map((f: string) => JSON.parse(readFileSync(f, 'utf-8')));
      const dataRows = opts.data ? loadDataSet(opts.data) : [{}];
      const objectRepository = new ObjectRepository(opts.objectDb);
      const documentLog = new DocumentLog(opts.documentDb);
      const runHistory = new RunHistoryStore(opts.runHistoryDb);
      const registry = new ModuleRegistry();
      const credentials = await getCredentials(opts.profile);
      const executedBy = userInfo().username;

      mkdirSync(opts.reportDir, { recursive: true });
      // Always capture annotated field evidence for the one canonical audit PDF.
      const evidenceDir = path.join(opts.reportDir, 'evidence');
      mkdirSync(evidenceDir, { recursive: true });

      let anyFailed = false;
      const evidenceManifest: EvidenceManifestEntry[] = [];

      for (const [index, dataRow] of dataRows.entries()) {
        const runId = randomUUID();
        const runStartedAt = new Date().toISOString();
        const adapter = new FioriPlaywrightAdapter({ headless: opts.headless === 'true' });
        const runDataRow = {
          ...dataRow,
          url: credentials.url,
          urlBase: credentials.url.replace(/\/+$/, ''),
          username: credentials.username,
          password: credentials.password,
          today,
        };

        const result = await executeTestCaseChain(testCases, adapter, objectRepository, registry, {
          appId: opts.appId,
          dataRow: runDataRow,
          screenshotDir: opts.reportDir,
          evidenceDir,
        });
        await adapter.close();

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
            mode: 'chain',
            appId: opts.appId,
            status: result.status,
            executedBy,
            startedAt: runStartedAt,
            finishedAt,
            stages: result.stages,
            fieldEvidence: result.fieldEvidence,
            inputFields: dataRow,
            outputFields: result.capturedValues,
          },
          evidencePdfPath
        );

        runHistory.record({
          id: runId,
          startedAt: runStartedAt,
          finishedAt,
          status: result.status,
          executedBy,
          mode: 'chain',
          appId: opts.appId,
          testCaseNames: testCases.map((tc) => tc.name),
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
          `Run ${index + 1}/${dataRows.length}: ${result.status.toUpperCase()} (${result.durationMs.toFixed(0)} ms) -> ${base}.html`
        );
        if (result.status === 'failed') anyFailed = true;

      }

      objectRepository.close();
      documentLog.close();
      runHistory.close();

      process.exitCode = anyFailed ? 1 : 0;
    });
}
