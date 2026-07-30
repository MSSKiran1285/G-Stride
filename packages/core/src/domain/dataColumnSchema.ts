import Database from 'better-sqlite3';
import type { TestValueType, DataSensitivity } from './testContract';

/** One column's declared shape within a dataset file — BL-025 AC2 ("Columns have names,
 *  types, examples and sensitivity"). Reuses the same TestValueType/DataSensitivity
 *  vocabulary as a Test's own contract inputs/outputs, so a data column and the step
 *  parameter it eventually feeds describe themselves the same way. */
export interface DataColumnSchema {
  file: string;
  column: string;
  type: TestValueType;
  sensitivity: DataSensitivity;
  example?: string;
}

const VALUE_TYPES = new Set<TestValueType>(['string', 'number', 'boolean', 'date', 'object', 'collection']);
const SENSITIVITIES = new Set<DataSensitivity>(['public', 'business', 'personal', 'secret']);

/** SQLite-backed store of per-column metadata for CSV/JSON dataset files, keyed by
 *  (file, column). Purely descriptive — never consulted by loadTransactionData at
 *  execution time — so a missing or stale schema row never blocks a Test run. */
export class DataColumnSchemaStore {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS data_columns (
        file TEXT NOT NULL,
        column_name TEXT NOT NULL,
        type TEXT NOT NULL DEFAULT 'string',
        sensitivity TEXT NOT NULL DEFAULT 'public',
        example TEXT,
        PRIMARY KEY (file, column_name)
      )
    `);
  }

  /** Every declared column for one dataset file, in the order they were first saved. */
  listForFile(file: string): DataColumnSchema[] {
    return this.db
      .prepare(
        `SELECT file, column_name as column, type, sensitivity, example
         FROM data_columns WHERE file = ? ORDER BY rowid ASC`
      )
      .all(file) as DataColumnSchema[];
  }

  /** Declares or updates one column's type/sensitivity/example. Unknown type/sensitivity
   *  values are rejected rather than silently coerced, since a bad value here would render
   *  as a false claim in Studio's UI rather than fail loudly at execution time. */
  setColumn(file: string, column: string, patch: { type: TestValueType; sensitivity: DataSensitivity; example?: string }): void {
    if (!VALUE_TYPES.has(patch.type)) throw new Error(`Unsupported column type "${patch.type}".`);
    if (!SENSITIVITIES.has(patch.sensitivity)) throw new Error(`Unsupported sensitivity "${patch.sensitivity}".`);
    this.db
      .prepare(
        `INSERT INTO data_columns (file, column_name, type, sensitivity, example)
         VALUES (@file, @column, @type, @sensitivity, @example)
         ON CONFLICT(file, column_name) DO UPDATE SET
           type = excluded.type,
           sensitivity = excluded.sensitivity,
           example = excluded.example`
      )
      .run({ file, column, type: patch.type, sensitivity: patch.sensitivity, example: patch.example ?? null });
  }

  /** Drops any column no longer present in `currentColumns` — keeps the schema in step with
   *  a CSV whose header row has since been edited, rather than accumulating stale entries. */
  pruneColumnsNotIn(file: string, currentColumns: string[]): void {
    const keep = new Set(currentColumns);
    const existing = this.listForFile(file);
    const drop = this.db.prepare('DELETE FROM data_columns WHERE file = ? AND column_name = ?');
    for (const col of existing) {
      if (!keep.has(col.column)) drop.run(file, col.column);
    }
  }

  /** Migrates every column row from one file name to another — used when a dataset file is
   *  renamed so its declared schema follows the file rather than being orphaned. */
  renameFile(oldFile: string, newFile: string): void {
    this.db.prepare('UPDATE data_columns SET file = ? WHERE file = ?').run(newFile, oldFile);
  }

  /** Permanently removes every column declared for one file — there is no undo. */
  removeFile(file: string): void {
    this.db.prepare('DELETE FROM data_columns WHERE file = ?').run(file);
  }

  close(): void {
    this.db.close();
  }
}
