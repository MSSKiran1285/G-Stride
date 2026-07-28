import Database from 'better-sqlite3';

export interface ControlDefinition {
  appId: string;
  name: string;
  controlId: string;
  bindingPath?: string;
  controlType?: string;
  /**
   * For grid-table (sap.ui.table.Table) cells: the table's own DOM id. When
   * set, controlId holds the column's id rather than a per-cell id, since
   * grid table cells render runtime-generated ids that aren't stable across
   * sessions — see FioriPlaywrightAdapter's tableCell locator.
   */
  tableId?: string;
  /** Human-readable name for evidence captions/reports (e.g. "Delivered Quantity" instead of "DeliveredQuantityColumn"). Falls back to name when unset. */
  label?: string;
  /**
   * The captured UI5 control id of this control's immediate parent, if known — lets the
   * repository represent a screen as a tree (e.g. header section > field) rather than a
   * flat list. Not a foreign key into this table (it's a raw UI5 control id, not a
   * logical `name`) since a parent may not itself be individually named/saved.
   */
  parentControlId?: string;
}

/**
 * Reusable repository of UI control definitions, keyed by (appId, logical name).
 * Modules look up controls by logical name so a screen change only requires
 * updating the entry here, not every test case that uses it.
 */
export class ObjectRepository {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS controls (
        app_id TEXT NOT NULL,
        name TEXT NOT NULL,
        control_id TEXT NOT NULL,
        binding_path TEXT,
        control_type TEXT,
        table_id TEXT,
        label TEXT,
        parent_control_id TEXT,
        PRIMARY KEY (app_id, name)
      )
    `);
    for (const migration of [
      'ALTER TABLE controls ADD COLUMN table_id TEXT',
      'ALTER TABLE controls ADD COLUMN label TEXT',
      'ALTER TABLE controls ADD COLUMN parent_control_id TEXT',
      'ALTER TABLE controls ADD COLUMN sort_order INTEGER',
    ]) {
      try {
        this.db.exec(migration);
      } catch {
        // column already exists on a repository created before this field was added
      }
    }
  }

  upsert(def: ControlDefinition): void {
    this.db
      .prepare(
        `INSERT INTO controls (app_id, name, control_id, binding_path, control_type, table_id, label, parent_control_id)
         VALUES (@appId, @name, @controlId, @bindingPath, @controlType, @tableId, @label, @parentControlId)
         ON CONFLICT(app_id, name) DO UPDATE SET
           control_id = excluded.control_id,
           binding_path = excluded.binding_path,
           control_type = excluded.control_type,
           table_id = excluded.table_id,
           label = excluded.label,
           parent_control_id = excluded.parent_control_id`
      )
      .run(def);
  }

  get(appId: string, name: string): ControlDefinition {
    const row = this.db
      .prepare(
        `SELECT app_id as appId, name, control_id as controlId, binding_path as bindingPath, control_type as controlType, table_id as tableId, label, parent_control_id as parentControlId
         FROM controls WHERE app_id = ? AND name = ?`
      )
      .get(appId, name) as ControlDefinition | undefined;

    if (!row) {
      throw new Error(
        `Object repository: no control named "${name}" for app "${appId}". ` +
          `Run "taf inspect" against the live screen, then "taf objects add" to seed it.`
      );
    }
    return row;
  }

  /** Every App ID that has at least one saved object — lets Studio show what already exists before a new one gets captured. */
  listAppIds(): string[] {
    return (this.db.prepare('SELECT DISTINCT app_id as appId FROM controls ORDER BY app_id').all() as { appId: string }[]).map(
      (r) => r.appId
    );
  }

  listByApp(appId: string): ControlDefinition[] {
    return this.db
      .prepare(
        `SELECT app_id as appId, name, control_id as controlId, binding_path as bindingPath, control_type as controlType, table_id as tableId, label, parent_control_id as parentControlId
         FROM controls WHERE app_id = ?
         ORDER BY sort_order IS NULL, sort_order ASC, rowid ASC`
      )
      .all(appId) as ControlDefinition[];
  }

  /** Persists a user-chosen display order for an App ID's objects (drag-and-drop reordering in
   * Studio's Object Browser) — names not present in `orderedNames` (shouldn't normally happen,
   * but a stale client request is possible) keep whatever order they already had, sorting after
   * every explicitly-ordered name. */
  reorder(appId: string, orderedNames: string[]): void {
    const update = this.db.prepare('UPDATE controls SET sort_order = ? WHERE app_id = ? AND name = ?');
    const applyAll = this.db.transaction(() => {
      orderedNames.forEach((name, index) => update.run(index, appId, name));
    });
    applyAll();
  }

  /** Permanently removes one saved object — there is no undo. */
  remove(appId: string, name: string): void {
    this.db.prepare('DELETE FROM controls WHERE app_id = ? AND name = ?').run(appId, name);
  }

  /** Renames a saved object in place, keeping everything else (controlId, label, tableId, ...) — since
   * the table's primary key is (app_id, name), this is an insert-under-the-new-name-then-delete-the-old,
   * not a column update, but callers don't need to care about that distinction. */
  rename(appId: string, oldName: string, newName: string): void {
    if (oldName === newName) return;
    const def = this.get(appId, oldName);
    this.upsert({ ...def, name: newName });
    this.remove(appId, oldName);
  }

  close(): void {
    this.db.close();
  }
}
