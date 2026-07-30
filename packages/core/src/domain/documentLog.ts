import Database from 'better-sqlite3';

export interface CapturedDocument {
  id: number;
  appId: string;
  testCaseName: string;
  key: string;
  value: string;
  capturedAt: string;
  reportDir?: string;
  /** Links to the RunHistoryStore record that captured this value — see BL-13. Optional
   * since entries logged before this field existed have none. */
  runId?: string;
}

export interface DocumentListFilter {
  appId?: string;
  key?: string;
  /** Every business document value captured by one specific run — BL-035 AC4's "evidence
   *  types... linked from the run record" (a run's captured document numbers alongside its
   *  canonical PDF). */
  runId?: string;
  limit?: number;
}

/**
 * Durable, cross-run log of business document numbers a test run captured (e.g. a Purchase
 * Order, Material Document, or Supplier Invoice number) — distinct from RunResult.capturedValues,
 * which only lives for the one run/process that produced it. Every entry a run's capturedValues
 * holds gets logged here too, so a number is still findable after its own report/PDF is long gone.
 */
export class DocumentLog {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS captured_documents (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        app_id TEXT NOT NULL,
        test_case_name TEXT NOT NULL,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        captured_at TEXT NOT NULL,
        report_dir TEXT
      )
    `);
    try {
      this.db.exec('ALTER TABLE captured_documents ADD COLUMN run_id TEXT');
    } catch {
      // column already exists on a log created before run_id linkage was added
    }
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_captured_documents_app_id ON captured_documents (app_id)');
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_captured_documents_key ON captured_documents (key)');
  }

  record(entry: { appId: string; testCaseName: string; key: string; value: string; capturedAt: string; reportDir?: string; runId?: string }): void {
    this.db
      .prepare(
        `INSERT INTO captured_documents (app_id, test_case_name, key, value, captured_at, report_dir, run_id)
         VALUES (@appId, @testCaseName, @key, @value, @capturedAt, @reportDir, @runId)`
      )
      .run({ ...entry, reportDir: entry.reportDir ?? null, runId: entry.runId ?? null });
  }

  /**
   * Persists every entry of one run's capturedValues in a single call — the natural hook point
   * right after a CLI run/suite/batch invocation produces its RunResult/GroupResult. Skips
   * anything that isn't a plain string/number/boolean (this is a log of document identifiers,
   * not a general-purpose blob store), and skips capturing at all when there's nothing to log.
   */
  recordAll(appId: string, testCaseName: string, capturedValues: Record<string, unknown>, reportDir?: string, runId?: string): void {
    const capturedAt = new Date().toISOString();
    for (const [key, value] of Object.entries(capturedValues)) {
      if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') continue;
      this.record({ appId, testCaseName, key, value: String(value), capturedAt, reportDir, runId });
    }
  }

  list(filter: DocumentListFilter = {}): CapturedDocument[] {
    const clauses: string[] = [];
    const params: Record<string, unknown> = {};
    if (filter.appId) {
      clauses.push('app_id = @appId');
      params.appId = filter.appId;
    }
    if (filter.key) {
      clauses.push('key LIKE @key');
      params.key = `%${filter.key}%`;
    }
    if (filter.runId) {
      clauses.push('run_id = @runId');
      params.runId = filter.runId;
    }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    params.limit = filter.limit ?? 500;
    return (
      this.db
        .prepare(
          `SELECT id, app_id as appId, test_case_name as testCaseName, key, value, captured_at as capturedAt, report_dir as reportDir, run_id as runId
         FROM captured_documents ${where}
         ORDER BY id DESC
         LIMIT @limit`
        )
        .all(params) as (CapturedDocument & { runId: string | null })[]
    ).map((d) => ({ ...d, runId: d.runId ?? undefined }));
  }

  close(): void {
    this.db.close();
  }
}
