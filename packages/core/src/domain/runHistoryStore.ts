import Database from 'better-sqlite3';

export type RunMode = 'chain' | 'suite' | 'batch';

export interface RunHistoryEntry {
  id: string;
  startedAt: string;
  finishedAt: string;
  status: 'passed' | 'failed';
  /** OS username of whoever triggered the run — the only "who" available without a real auth
   * system (Studio is a single-user local tool today; see PROJECT_BRIEF_v2.0.md Section 7). */
  executedBy: string;
  mode: RunMode;
  appId: string;
  testCaseNames: string[];
  dataFile?: string;
  /** The full RunResult/GroupResult, verbatim — the audit record doesn't summarize, it keeps everything. */
  result: unknown;
  /** Path to this run's compiled evidence PDF (module-by-module status, screenshots, input/output) —
   * outside the disposable reports/ scratch dir, so it survives even after reports/ is cleared. */
  evidencePdfPath?: string;
}

export interface RunHistorySummary {
  id: string;
  startedAt: string;
  finishedAt: string;
  status: 'passed' | 'failed';
  executedBy: string;
  mode: RunMode;
  appId: string;
  testCaseNames: string[];
  dataFile?: string;
  evidencePdfPath?: string;
}

export interface RunHistoryFilter {
  appId?: string;
  status?: 'passed' | 'failed';
  limit?: number;
}

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

  constructor(dbPath: string) {
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
    try {
      this.db.exec('ALTER TABLE runs ADD COLUMN evidence_pdf_path TEXT');
    } catch {
      // column already exists on a ledger created before the screenshot-links-to-PDF redesign
    }
  }

  record(entry: RunHistoryEntry): void {
    this.db
      .prepare(
        `INSERT INTO runs (id, started_at, finished_at, status, executed_by, mode, app_id, test_case_names, data_file, result_json, evidence_pdf_path)
         VALUES (@id, @startedAt, @finishedAt, @status, @executedBy, @mode, @appId, @testCaseNames, @dataFile, @resultJson, @evidencePdfPath)`
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
        dataFile: entry.dataFile ?? null,
        resultJson: JSON.stringify(entry.result),
        evidencePdfPath: entry.evidencePdfPath ?? null,
      });
  }

  /** Lightweight listing — omits the result blob, which can be large across many runs. */
  list(filter: RunHistoryFilter = {}): RunHistorySummary[] {
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
    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    params.limit = filter.limit ?? 200;
    const rows = this.db
      .prepare(
        `SELECT id, started_at as startedAt, finished_at as finishedAt, status, executed_by as executedBy, mode,
                app_id as appId, test_case_names as testCaseNames, data_file as dataFile, evidence_pdf_path as evidencePdfPath
         FROM runs ${where}
         ORDER BY started_at DESC
         LIMIT @limit`
      )
      .all(params) as (Omit<RunHistorySummary, 'testCaseNames' | 'dataFile' | 'evidencePdfPath'> & {
      testCaseNames: string;
      dataFile: string | null;
      evidencePdfPath: string | null;
    })[];
    return rows.map((r) => ({
      ...r,
      testCaseNames: JSON.parse(r.testCaseNames),
      dataFile: r.dataFile ?? undefined,
      evidencePdfPath: r.evidencePdfPath ?? undefined,
    }));
  }

  get(id: string): RunHistoryEntry | null {
    const row = this.db
      .prepare(
        `SELECT id, started_at as startedAt, finished_at as finishedAt, status, executed_by as executedBy, mode,
                app_id as appId, test_case_names as testCaseNames, data_file as dataFile, result_json as resultJson, evidence_pdf_path as evidencePdfPath
         FROM runs WHERE id = ?`
      )
      .get(id) as
      | (Omit<RunHistoryEntry, 'testCaseNames' | 'dataFile' | 'result' | 'evidencePdfPath'> & {
          testCaseNames: string;
          dataFile: string | null;
          resultJson: string;
          evidencePdfPath: string | null;
        })
      | undefined;
    if (!row) return null;
    const { resultJson, ...rest } = row;
    return {
      ...rest,
      testCaseNames: JSON.parse(rest.testCaseNames),
      dataFile: rest.dataFile ?? undefined,
      result: JSON.parse(resultJson),
      evidencePdfPath: rest.evidencePdfPath ?? undefined,
    };
  }

  close(): void {
    this.db.close();
  }
}
