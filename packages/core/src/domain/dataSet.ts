import { readFileSync } from 'node:fs';

/** Loads a data-driven test dataset from a JSON array or a simple CSV file. */
export function loadDataSet(path: string): Record<string, string>[] {
  if (path.endsWith('.json')) {
    return JSON.parse(readFileSync(path, 'utf-8'));
  }
  if (path.endsWith('.csv')) {
    return parseCsv(readFileSync(path, 'utf-8'));
  }
  throw new Error(`Unsupported data file extension: ${path}`);
}

// RFC4180-style: a field containing a comma, quote, or newline is wrapped in
// double quotes, with embedded quotes doubled. Needed once a cell can hold a
// JSON blob (see BL-06's per-row line-item editor) — those always contain
// commas, so a plain comma-split silently corrupted them. Mirrors
// studio-server's own csv.ts (the read/write counterpart used by the dataset
// editor) — both must parse the same file format the same way.
function parseCsvRows(content: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  const text = content.replace(/\r\n/g, '\n');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
      continue;
    }
    if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field.trim());
      field = '';
    } else if (c === '\n') {
      row.push(field.trim());
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += c;
    }
  }
  return rows;
}

function parseCsv(content: string): Record<string, string>[] {
  if (!content.trim()) return [];
  const rows = parseCsvRows(content.trim() + '\n');
  const [headerRow, ...dataRows] = rows;
  return dataRows.map((values) => {
    const row: Record<string, string> = {};
    headerRow.forEach((h, i) => (row[h] = values[i] ?? ''));
    return row;
  });
}

/**
 * Resolves ${placeholder} references in module params against a data row first,
 * falling back to values captured earlier in the same run (e.g. a PO number
 * captured by an earlier step and referenced by a later one).
 */
export function resolveParams(
  params: Record<string, string>,
  dataRow: Record<string, string>,
  runState: Record<string, unknown>
): Record<string, string> {
  const resolved: Record<string, string> = {};
  for (const [key, value] of Object.entries(params)) {
    resolved[key] = value.replace(/\$\{(\w+)\}/g, (_match, name) => {
      if (name in dataRow) return dataRow[name];
      if (name in runState) return String(runState[name]);
      throw new Error(`Unresolved placeholder "\${${name}}" in param "${key}"`);
    });
  }
  return resolved;
}
