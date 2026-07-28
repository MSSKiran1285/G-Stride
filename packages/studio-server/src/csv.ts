export interface CsvDataset {
  headers: string[];
  rows: Record<string, string>[];
}

// RFC4180-style: a field containing a comma, quote, or newline is wrapped in
// double quotes, with embedded quotes doubled. Needed once a cell can hold a
// JSON blob (see BL-06's per-row line-item editor) — those always contain
// commas, so the earlier plain comma-split parser silently corrupted them.
// Mirrors @taf/core's own loadDataSet parsing — this is the read/write
// counterpart used by the dataset editor, kept separate from core's
// read-only loader since it needs headers back too.
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

export function parseCsv(content: string): CsvDataset {
  if (!content.trim()) return { headers: [], rows: [] };
  const rows = parseCsvRows(content.trim() + '\n');
  const [headerRow, ...dataRows] = rows;
  return {
    headers: headerRow,
    rows: dataRows.map((values) => {
      const obj: Record<string, string> = {};
      headerRow.forEach((h, i) => (obj[h] = values[i] ?? ''));
      return obj;
    }),
  };
}

function needsQuoting(value: string): boolean {
  return /[",\n\r]/.test(value);
}

function quoteField(value: string): string {
  return needsQuoting(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function serializeCsv(dataset: CsvDataset): string {
  const lines = [dataset.headers.map(quoteField).join(',')];
  for (const row of dataset.rows) {
    lines.push(dataset.headers.map((h) => quoteField(row[h] ?? '')).join(','));
  }
  return lines.join('\n') + '\n';
}
