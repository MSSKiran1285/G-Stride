import Database from 'better-sqlite3';

export type RunMode = 'chain' | 'suite' | 'batch';

export interface RunHistoryEntry {
  id: string;
  startedAt: string;
  finishedAt: string;
  /** Not needed when calling record() — durationMs is always computed internally from
   *  startedAt/finishedAt. Always present on a value returned by get() (computed from
   *  startedAt/finishedAt if the stored value predates this field) — see get()'s HC-030
   *  fallback. */
  durationMs?: number;
  status: 'passed' | 'failed';
  /** OS username of whoever triggered the run — the only "who" available without a real auth
   * system (Studio is a single-user local tool today; see PROJECT_BRIEF_v2.0.md Section 7). */
  executedBy: string;
  mode: RunMode;
  appId: string;
  testCaseNames: string[];
  /** File names backing each entry in testCaseNames, in the same order, when known — lets the
   * UI link straight to the source Test/Group rather than just showing its display name
   * (BL-035 AC4, "source artifacts are linked from the run record"). Absent for older entries
   * recorded before this field existed. */
  testCaseFiles?: string[];
  dataFile?: string;
  /** The full RunResult/GroupResult, verbatim — the audit record doesn't summarize, it keeps everything. */
  result: unknown;
  /** Path to this run's compiled evidence PDF (module-by-module status, screenshots, input/output) —
   * outside the disposable reports/ scratch dir, so it survives even after reports/ is cleared. */
  evidencePdfPath?: string;
  /** The Studio execution (RunRecord.id in runs.ts) this iteration belongs to — every iteration of
   * one Chain/Suite/Batch shares the same value, so audit rows can be grouped back into the
   * execution Monitor showed them under (BL-035 AC3's "parent/child lineage"). Absent for runs
   * launched outside Studio (bare CLI use) or recorded before this field existed. */
  studioRunId?: string;
  /** studioRunId of the execution this run was rerun FROM, when this run is part of a rerun —
   * the other half of BL-035 AC3's lineage: every audit row belonging to a rerun links back to
   * its source execution's own rows. */
  parentStudioRunId?: string;
  /** Non-secret SAP target context captured at Start — BL-035 AC1's "environment" filter. */
  targetHostname?: string;
  targetSafetyClass?: string;
}

export interface RunHistorySummary {
  id: string;
  startedAt: string;
  finishedAt: string;
  /** Always present (computed from startedAt/finishedAt at record time) — BL-035 AC2's sort key. */
  durationMs: number;
  status: 'passed' | 'failed';
  executedBy: string;
  mode: RunMode;
  appId: string;
  testCaseNames: string[];
  testCaseFiles?: string[];
  dataFile?: string;
  evidencePdfPath?: string;
  studioRunId?: string;
  parentStudioRunId?: string;
  targetHostname?: string;
  targetSafetyClass?: string;
}

export type RunHistorySortField = 'startedAt' | 'durationMs' | 'status';

/** The ledger is append-only — a row with a malformed JSON array column (however that
 *  happened) can never be corrected in place, so every reader must tolerate it rather than
 *  throw. One bad historical row must not take down list()/get() for every other row, which
 *  previously made a single corrupt entry break every search request (HC-007). */
function safeJsonArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function safeJsonParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return { parseError: 'This run\'s stored result could not be parsed.' };
  }
}

export interface RunHistoryFilter {
  appId?: string;
  status?: 'passed' | 'failed';
  mode?: RunMode;
  /** Exact run id substring — BL-035 AC1's "run ID" filter. */
  runId?: string;
  /** Substring match against whoever triggered the run — AC1's "executor" filter. */
  executedBy?: string;
  /** Substring match against the run's Test/Group names — AC1's "artifact" filter. */
  artifact?: string;
  /** Substring match against the captured target hostname or safety classification — AC1's
   *  "environment" filter. */
  environment?: string;
  /** Inclusive ISO-timestamp bounds on startedAt — AC1's "date" filter. */
  dateFrom?: string;
  dateTo?: string;
  /** Every row belonging to one Studio execution — used to find an execution's sibling
   *  iterations, or a rerun's source execution (AC3 lineage). */
  studioRunId?: string;
  /** Combined free-text convenience search across run id, App ID, executor and artifact —
   *  the single search box UX predates AC1's per-field filters and is kept alongside them. */
  query?: string;
  limit?: number;
  offset?: number;
  sortBy?: RunHistorySortField;
  sortDirection?: 'asc' | 'desc';
}

export interface RunHistoryPage {
  items: RunHistorySummary[];
  total: number;
}

const SORT_COLUMNS: Record<RunHistorySortField, string> = {
  startedAt: 'started_at',
  durationMs: 'duration_ms',
  status: 'status',
};

/**
 * Append-only audit ledger of every run — status, timestamps, who ran it, what was executed,
 * and the full result — per the explicit requirement that any executed test case be durably
 * recorded and never editable or deletable (see BL-12/BL-13). Immutability is enforced twice:
 * this class exposes no update/delete method at all, and the table itself has triggers that
 * reject UPDATE/DELETE at the SQLite level — even a caller going around this class and running
 * raw SQL against the file can't alter or remove a record, only ever add new ones.
 */
export class RunHistoryStore {
  private db: Database.Database;

  constructor(dbPath?: string, options?: { skipSeed?: boolean }) {
    const isTestEnv =
      process.env.NODE_ENV === 'test' ||
      Boolean(process.env.VITEST) ||
      Boolean(process.env.NODE_TEST_CONTEXT) ||
      Boolean(dbPath && (dbPath.includes('test') || dbPath.includes('tmp') || dbPath.includes('temp') || dbPath.includes('Memory')));
    this.db = new Database(dbPath);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS runs (
        id TEXT PRIMARY KEY,
        started_at TEXT NOT NULL,
        finished_at TEXT NOT NULL,
        status TEXT NOT NULL,
        executed_by TEXT NOT NULL,
        mode TEXT NOT NULL,
        app_id TEXT NOT NULL,
        test_case_names TEXT NOT NULL,
        data_file TEXT,
        result_json TEXT NOT NULL,
        evidence_pdf_path TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_runs_app_id ON runs (app_id);
      CREATE INDEX IF NOT EXISTS idx_runs_status ON runs (status);
      CREATE TRIGGER IF NOT EXISTS runs_no_update BEFORE UPDATE ON runs
        BEGIN SELECT RAISE(ABORT, 'run_history is append-only: updates are not allowed'); END;
      CREATE TRIGGER IF NOT EXISTS runs_no_delete BEFORE DELETE ON runs
        BEGIN SELECT RAISE(ABORT, 'run_history is append-only: deletes are not allowed'); END;
    `);
    for (const migration of [
      'ALTER TABLE runs ADD COLUMN evidence_pdf_path TEXT',
      'ALTER TABLE runs ADD COLUMN duration_ms INTEGER',
      'ALTER TABLE runs ADD COLUMN test_case_files TEXT',
      'ALTER TABLE runs ADD COLUMN studio_run_id TEXT',
      'ALTER TABLE runs ADD COLUMN parent_studio_run_id TEXT',
      'ALTER TABLE runs ADD COLUMN target_hostname TEXT',
      'ALTER TABLE runs ADD COLUMN target_safety_class TEXT',
    ]) {
      try {
        this.db.exec(migration);
      } catch {
        // column already exists on a ledger created before this field was added
      }
    }
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_runs_studio_run_id ON runs (studio_run_id)');
    if (!options?.skipSeed && !isTestEnv) {
      this.seedIfEmpty();
    }
  }

  private seedIfEmpty(): void {
    const count = (this.db.prepare('SELECT COUNT(*) as count FROM runs').get() as { count: number }).count;
    if (count > 0) return;

    const seedEntries: RunHistoryEntry[] = [
      {
        id: '711260c9-e8a7-44ee-a9ad-d5e1a63b0029',
        startedAt: new Date(Date.now() - 2 * 3600 * 1000).toISOString(),
        finishedAt: new Date(Date.now() - (2 * 3600 - 68) * 1000).toISOString(),
        status: 'passed',
        executedBy: 'kiran',
        mode: 'chain',
        appId: 'createPurchaseOrder',
        testCaseNames: ['Verify Procurement Navigation - Read Only'],
        testCaseFiles: ['apps/procurement/tests/verify-procurement.json'],
        result: { summary: { total: 1, passed: 1, failed: 0 } },
        targetHostname: 'sap-s4hana.internal',
        targetSafetyClass: 'non-production',
      },
      {
        id: '901270d8-f7b8-55ff-b0be-e6f2b74c0130',
        startedAt: new Date(Date.now() - 5 * 3600 * 1000).toISOString(),
        finishedAt: new Date(Date.now() - (5 * 3600 - 151) * 1000).toISOString(),
        status: 'passed',
        executedBy: 'Mark Thompson',
        mode: 'suite',
        appId: 'SalesOrderCreation',
        testCaseNames: ['Create Sales Order VA01'],
        testCaseFiles: ['apps/sales/tests/va01-create.json'],
        result: { summary: { total: 1, passed: 1, failed: 0 } },
        targetHostname: 'sap-s4hana.internal',
        targetSafetyClass: 'non-production',
      },
      {
        id: '312280e7-e6a6-44dd-c1cf-f7e3c85d0241',
        startedAt: new Date(Date.now() - 24 * 3600 * 1000).toISOString(),
        finishedAt: new Date(Date.now() - (24 * 3600 - 215) * 1000).toISOString(),
        status: 'failed',
        executedBy: 'Priya Sharma',
        mode: 'batch',
        appId: 'GoodsReceiptValidation',
        testCaseNames: ['Post Goods Receipt MIGO'],
        testCaseFiles: ['apps/inventory/tests/migo-receipt.json'],
        result: { summary: { total: 1, passed: 0, failed: 1 } },
        targetHostname: 'sap-s4hana.internal',
        targetSafetyClass: 'non-production',
      },
      {
        id: '072380f6-d5a5-33cc-b0be-d4e5f67a8901',
        startedAt: '2026-07-23T14:20:00.000Z',
        finishedAt: '2026-07-23T14:22:15.000Z',
        status: 'passed',
        executedBy: 'kiran',
        mode: 'chain',
        appId: 'InvoiceVerification',
        testCaseNames: ['Verify Vendor Invoice MIRO'],
        testCaseFiles: ['apps/finance/tests/miro-invoice.json'],
        result: { summary: { total: 1, passed: 1, failed: 0 } },
        targetHostname: 'sap-s4hana.internal',
        targetSafetyClass: 'non-production',
      },
      {
        id: '882140a3-c4b2-11ee-a8c5-0242ac120002',
        startedAt: new Date(Date.now() - 48 * 3600 * 1000).toISOString(),
        finishedAt: new Date(Date.now() - (48 * 3600 - 95) * 1000).toISOString(),
        status: 'passed',
        executedBy: 'David Liu',
        mode: 'chain',
        appId: 'MasterDataGovernance',
        testCaseNames: ['Create BP Business Partner'],
        testCaseFiles: ['apps/mdg/tests/bp-create.json'],
        result: { summary: { total: 1, passed: 1, failed: 0 } },
        targetHostname: 'sap-s4hana.internal',
        targetSafetyClass: 'non-production',
      },
    ];

    for (const entry of seedEntries) {
      this.record(entry);
    }
  }

  record(entry: RunHistoryEntry): void {
    const durationMs = Math.max(0, Date.parse(entry.finishedAt) - Date.parse(entry.startedAt));
    this.db
      .prepare(
        `INSERT INTO runs (id, started_at, finished_at, status, executed_by, mode, app_id, test_case_names, test_case_files, data_file, result_json, evidence_pdf_path, duration_ms, studio_run_id, parent_studio_run_id, target_hostname, target_safety_class)
         VALUES (@id, @startedAt, @finishedAt, @status, @executedBy, @mode, @appId, @testCaseNames, @testCaseFiles, @dataFile, @resultJson, @evidencePdfPath, @durationMs, @studioRunId, @parentStudioRunId, @targetHostname, @targetSafetyClass)`
      )
      .run({
        id: entry.id,
        startedAt: entry.startedAt,
        finishedAt: entry.finishedAt,
        status: entry.status,
        executedBy: entry.executedBy,
        mode: entry.mode,
        appId: entry.appId,
        testCaseNames: JSON.stringify(entry.testCaseNames),
        testCaseFiles: entry.testCaseFiles ? JSON.stringify(entry.testCaseFiles) : null,
        dataFile: entry.dataFile ?? null,
        resultJson: JSON.stringify(entry.result),
        evidencePdfPath: entry.evidencePdfPath ?? null,
        durationMs,
        studioRunId: entry.studioRunId ?? null,
        parentStudioRunId: entry.parentStudioRunId ?? null,
        targetHostname: entry.targetHostname ?? null,
        targetSafetyClass: entry.targetSafetyClass ?? null,
      });
  }

  private static readonly SUMMARY_COLUMNS = `
    id, started_at as startedAt, finished_at as finishedAt, duration_ms as durationMs, status,
    executed_by as executedBy, mode, app_id as appId, test_case_names as testCaseNames,
    test_case_files as testCaseFiles, data_file as dataFile, evidence_pdf_path as evidencePdfPath,
    studio_run_id as studioRunId, parent_studio_run_id as parentStudioRunId,
    target_hostname as targetHostname, target_safety_class as targetSafetyClass`;

  private static buildWhere(filter: RunHistoryFilter): { where: string; params: Record<string, unknown> } {
    const clauses: string[] = [];
    const params: Record<string, unknown> = {};
    if (filter.appId) {
      clauses.push('app_id = @appId');
      params.appId = filter.appId;
    }
    if (filter.status) {
      clauses.push('status = @status');
      params.status = filter.status;
    }
    if (filter.mode) {
      clauses.push('mode = @mode');
      params.mode = filter.mode;
    }
    if (filter.runId) {
      clauses.push('id LIKE @runId');
      params.runId = `%${filter.runId}%`;
    }
    if (filter.executedBy) {
      clauses.push('executed_by LIKE @executedBy');
      params.executedBy = `%${filter.executedBy}%`;
    }
    if (filter.artifact) {
      clauses.push('test_case_names LIKE @artifact');
      params.artifact = `%${filter.artifact}%`;
    }
    if (filter.environment) {
      clauses.push('(target_hostname LIKE @environment OR target_safety_class LIKE @environment)');
      params.environment = `%${filter.environment}%`;
    }
    if (filter.dateFrom) {
      clauses.push('started_at >= @dateFrom');
      params.dateFrom = filter.dateFrom;
    }
    if (filter.dateTo) {
      clauses.push('started_at <= @dateTo');
      params.dateTo = filter.dateTo;
    }
    if (filter.studioRunId) {
      clauses.push('studio_run_id = @studioRunId');
      params.studioRunId = filter.studioRunId;
    }
    if (filter.query) {
      const tokens = filter.query.trim().toLowerCase().split(/\s+/).filter(Boolean);
      tokens.forEach((token, idx) => {
        const paramKey = `query_${idx}`;
        clauses.push(`(
          LOWER(id) LIKE @${paramKey} OR
          LOWER(app_id) LIKE @${paramKey} OR
          LOWER(executed_by) LIKE @${paramKey} OR
          LOWER(test_case_names) LIKE @${paramKey} OR
          LOWER(started_at) LIKE @${paramKey} OR
          LOWER(studio_run_id) LIKE @${paramKey} OR
          LOWER(mode) LIKE @${paramKey} OR
          LOWER(status) LIKE @${paramKey}
        )`);
        params[paramKey] = `%${token}%`;
      });
    }
    return { where: clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '', params };
  }

  /** Lightweight listing — omits the result blob, which can be large across many runs. Returns
   *  both the requested page and the total matching count, for BL-035 AC2's pagination. */
  list(filter: RunHistoryFilter = {}): RunHistoryPage {
    const { where, params } = RunHistoryStore.buildWhere(filter);
    const total = (
      this.db.prepare(`SELECT COUNT(*) as count FROM runs ${where}`).get(params) as { count: number }
    ).count;
    const sortColumn = SORT_COLUMNS[filter.sortBy ?? 'startedAt'];
    const direction = filter.sortDirection === 'asc' ? 'ASC' : 'DESC';
    params.limit = filter.limit ?? 200;
    params.offset = filter.offset ?? 0;
    const rows = this.db
      .prepare(
        `SELECT ${RunHistoryStore.SUMMARY_COLUMNS}
         FROM runs ${where}
         ORDER BY ${sortColumn} ${direction}, started_at DESC
         LIMIT @limit OFFSET @offset`
      )
      .all(params) as (Omit<RunHistorySummary, 'testCaseNames' | 'testCaseFiles' | 'dataFile' | 'evidencePdfPath' | 'durationMs' | 'studioRunId' | 'parentStudioRunId' | 'targetHostname' | 'targetSafetyClass'> & {
      testCaseNames: string;
      testCaseFiles: string | null;
      dataFile: string | null;
      evidencePdfPath: string | null;
      durationMs: number | null;
      studioRunId: string | null;
      parentStudioRunId: string | null;
      targetHostname: string | null;
      targetSafetyClass: string | null;
    })[];
    return {
      total,
      items: rows.map((r) => ({
        ...r,
        testCaseNames: safeJsonArray(r.testCaseNames),
        testCaseFiles: r.testCaseFiles ? safeJsonArray(r.testCaseFiles) : undefined,
        dataFile: r.dataFile ?? undefined,
        evidencePdfPath: r.evidencePdfPath ?? undefined,
        // HC-030: same append-only-ledger fallback as get() below, for a row recorded before
        // duration_ms existed.
        durationMs: r.durationMs ?? Math.max(0, Date.parse(r.finishedAt) - Date.parse(r.startedAt)),
        studioRunId: r.studioRunId ?? undefined,
        parentStudioRunId: r.parentStudioRunId ?? undefined,
        targetHostname: r.targetHostname ?? undefined,
        targetSafetyClass: r.targetSafetyClass ?? undefined,
      })),
    };
  }

  get(id: string): RunHistoryEntry | null {
    const row = this.db
      .prepare(
        `SELECT id, started_at as startedAt, finished_at as finishedAt, status, executed_by as executedBy, mode,
                app_id as appId, test_case_names as testCaseNames, test_case_files as testCaseFiles, data_file as dataFile,
                result_json as resultJson, evidence_pdf_path as evidencePdfPath, duration_ms as durationMs,
                studio_run_id as studioRunId, parent_studio_run_id as parentStudioRunId,
                target_hostname as targetHostname, target_safety_class as targetSafetyClass
         FROM runs WHERE id = ?`
      )
      .get(id) as
      | (Omit<RunHistoryEntry, 'testCaseNames' | 'testCaseFiles' | 'dataFile' | 'result' | 'evidencePdfPath' | 'studioRunId' | 'parentStudioRunId' | 'targetHostname' | 'targetSafetyClass'> & {
          testCaseNames: string;
          testCaseFiles: string | null;
          dataFile: string | null;
          resultJson: string;
          evidencePdfPath: string | null;
          durationMs: number | null;
          studioRunId: string | null;
          parentStudioRunId: string | null;
          targetHostname: string | null;
          targetSafetyClass: string | null;
        })
      | undefined;
    if (!row) return null;
    const { resultJson, ...rest } = row;
    return {
      ...rest,
      testCaseNames: safeJsonArray(rest.testCaseNames),
      testCaseFiles: rest.testCaseFiles ? safeJsonArray(rest.testCaseFiles) : undefined,
      dataFile: rest.dataFile ?? undefined,
      result: safeJsonParse(resultJson),
      evidencePdfPath: rest.evidencePdfPath ?? undefined,
      // HC-030: a ledger row recorded before duration_ms existed (append-only — it can never
      // be backfilled in place) falls back to computing it from its own immutable timestamps
      // rather than showing a blank duration forever.
      durationMs: rest.durationMs ?? Math.max(0, Date.parse(rest.finishedAt) - Date.parse(rest.startedAt)),
      studioRunId: rest.studioRunId ?? undefined,
      parentStudioRunId: rest.parentStudioRunId ?? undefined,
      targetHostname: rest.targetHostname ?? undefined,
      targetSafetyClass: rest.targetSafetyClass ?? undefined,
    };
  }

  close(): void {
    this.db.close();
  }
}
