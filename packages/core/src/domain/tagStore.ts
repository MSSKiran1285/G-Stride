import Database from 'better-sqlite3';

export type ArtifactKind = 'testCase' | 'group' | 'dataFile' | 'appId';

/**
 * A generic (kind, name) -> processArea tag store, backing BL-10's domain grouping
 * (Sales, Procurement, HR, Finance, ...) across test cases, groups, data files, and
 * App IDs uniformly — one tagging mechanism for every artifact type rather than a
 * one-off hierarchy just for Objects Browser (see BL-05).
 */
export class TagStore {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tags (
        kind TEXT NOT NULL,
        name TEXT NOT NULL,
        process_area TEXT NOT NULL,
        PRIMARY KEY (kind, name)
      );
      CREATE TABLE IF NOT EXISTS process_areas (
        name TEXT PRIMARY KEY
      );
      CREATE TABLE IF NOT EXISTS deleted_process_areas (
        name TEXT PRIMARY KEY
      );
    `);
  }

  /** An empty processArea removes the tag entirely rather than storing a blank value. */
  setTag(kind: ArtifactKind, name: string, processArea: string): void {
    if (!processArea.trim()) {
      this.db.prepare('DELETE FROM tags WHERE kind = ? AND name = ?').run(kind, name);
      return;
    }
    this.db
      .prepare(
        `INSERT INTO tags (kind, name, process_area) VALUES (@kind, @name, @processArea)
         ON CONFLICT(kind, name) DO UPDATE SET process_area = excluded.process_area`
      )
      .run({ kind, name, processArea: processArea.trim() });
  }

  getTag(kind: ArtifactKind, name: string): string | null {
    const row = this.db.prepare('SELECT process_area as processArea FROM tags WHERE kind = ? AND name = ?').get(kind, name) as
      | { processArea: string }
      | undefined;
    return row?.processArea ?? null;
  }

  /** name -> processArea, for every tagged artifact of this kind. */
  listTags(kind: ArtifactKind): Record<string, string> {
    const rows = this.db.prepare('SELECT name, process_area as processArea FROM tags WHERE kind = ?').all(kind) as {
      name: string;
      processArea: string;
    }[];
    return Object.fromEntries(rows.map((r) => [r.name, r.processArea]));
  }

  addProcessArea(name: string): void {
    const trimmed = name.trim();
    if (!trimmed) return;
    this.db.prepare('DELETE FROM deleted_process_areas WHERE LOWER(name) = LOWER(?)').run(trimmed);
    this.db.prepare('INSERT OR IGNORE INTO process_areas (name) VALUES (?)').run(trimmed);
  }

  deleteProcessArea(name: string): void {
    const trimmed = name.trim();
    if (!trimmed) return;
    this.db.prepare('INSERT OR IGNORE INTO deleted_process_areas (name) VALUES (?)').run(trimmed);
    this.db.prepare('DELETE FROM process_areas WHERE LOWER(name) = LOWER(?)').run(trimmed);
    this.db.prepare('DELETE FROM tags WHERE LOWER(process_area) = LOWER(?)').run(trimmed);
  }

  /** Every distinct processArea in use across all kinds + custom created process areas (excluding deleted ones). */
  listProcessAreas(): string[] {
    const tagAreas = (this.db.prepare('SELECT DISTINCT process_area as processArea FROM tags').all() as { processArea: string }[]).map(
      (r) => r.processArea
    );
    const customAreas = (this.db.prepare('SELECT name as processArea FROM process_areas').all() as { processArea: string }[]).map(
      (r) => r.processArea
    );
    const deletedAreas = new Set(
      (this.db.prepare('SELECT name as processArea FROM deleted_process_areas').all() as { processArea: string }[]).map(
        (r) => r.processArea.toLowerCase()
      )
    );
    return Array.from(new Set([...tagAreas, ...customAreas]))
      .filter((a) => !deletedAreas.has(a.toLowerCase()))
      .sort();
  }

  close(): void {
    this.db.close();
  }
}
