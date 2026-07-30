import { readFileSync } from 'node:fs';
import type { FileDataSource, JsonValue } from './executionPlan';

export interface TransactionDataIssue {
  code:
    | 'invalid-json-root'
    | 'invalid-transaction-record'
    | 'missing-join-column'
    | 'duplicate-header-key'
    | 'orphan-child-record'
    | 'collection-name-collision';
  file: string;
  row?: number;
  message: string;
}

export class TransactionDataValidationError extends Error {
  constructor(public readonly issues: TransactionDataIssue[]) {
    super(issues.map((issue) => issue.message).join('\n'));
    this.name = 'TransactionDataValidationError';
  }
}

export interface LoadedTransactionData {
  records: Record<string, JsonValue>[];
  sourceRecordCounts: number[];
  childRecordCount: number;
}

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

function readJsonTransactions(file: string): Record<string, JsonValue>[] {
  const parsed = JSON.parse(readFileSync(file, 'utf-8')) as unknown;
  if (!Array.isArray(parsed)) {
    throw new TransactionDataValidationError([{
      code: 'invalid-json-root',
      file,
      message: `Nested JSON dataset "${file}" must contain an array of transaction objects.`,
    }]);
  }
  const issues: TransactionDataIssue[] = [];
  const records: Record<string, JsonValue>[] = [];
  parsed.forEach((record, index) => {
    if (!record || typeof record !== 'object' || Array.isArray(record)) {
      issues.push({
        code: 'invalid-transaction-record',
        file,
        row: index + 1,
        message: `JSON transaction ${index + 1} in "${file}" must be an object.`,
      });
      return;
    }
    records.push(record as Record<string, JsonValue>);
  });
  if (issues.length) throw new TransactionDataValidationError(issues);
  return records;
}

/**
 * Loads the versioned Execution Plan's transaction source without flattening
 * nested objects or child collections. Relational CSV joins one header row to
 * its owned child rows and rejects ambiguous or orphaned data.
 */
export function loadTransactionData(source: FileDataSource): LoadedTransactionData {
  if (source.format === 'json') {
    const records = readJsonTransactions(source.files[0]);
    return {
      records,
      sourceRecordCounts: [records.length],
      childRecordCount: countNestedChildren(records),
    };
  }
  if (source.format === 'csv') {
    const records = parseCsv(readFileSync(source.files[0], 'utf-8')) as Record<string, JsonValue>[];
    return { records, sourceRecordCounts: [records.length], childRecordCount: 0 };
  }

  const relation = source.relation;
  if (!relation || source.files.length !== 2) {
    throw new TransactionDataValidationError([{
      code: 'missing-join-column',
      file: source.files[0] ?? '',
      message: 'Relational CSV requires two files plus header key, child foreign key, and collection path.',
    }]);
  }
  const [headerFile, childFile] = source.files;
  const headers = parseCsv(readFileSync(headerFile, 'utf-8'));
  const children = parseCsv(readFileSync(childFile, 'utf-8'));
  const issues: TransactionDataIssue[] = [];
  const headerByKey = new Map<string, Record<string, string>>();
  const childrenByKey = new Map<string, Record<string, JsonValue>[]>();

  headers.forEach((record, index) => {
    const key = record[relation.headerKey];
    if (key === undefined || key === '') {
      issues.push({
        code: 'missing-join-column',
        file: headerFile,
        row: index + 1,
        message: `Header row ${index + 1} has no "${relation.headerKey}" join value.`,
      });
    } else if (headerByKey.has(key)) {
      issues.push({
        code: 'duplicate-header-key',
        file: headerFile,
        row: index + 1,
        message: `Header key "${key}" appears more than once; one transaction header must be unique.`,
      });
    } else if (relation.collectionPath in record) {
      issues.push({
        code: 'collection-name-collision',
        file: headerFile,
        row: index + 1,
        message: `Header column "${relation.collectionPath}" conflicts with the joined child collection name.`,
      });
    } else {
      headerByKey.set(key, record);
    }
  });

  children.forEach((record, index) => {
    const key = record[relation.childForeignKey];
    if (key === undefined || key === '') {
      issues.push({
        code: 'missing-join-column',
        file: childFile,
        row: index + 1,
        message: `Child row ${index + 1} has no "${relation.childForeignKey}" join value.`,
      });
      return;
    }
    if (!headerByKey.has(key)) {
      issues.push({
        code: 'orphan-child-record',
        file: childFile,
        row: index + 1,
        message: `Child row ${index + 1} references unknown header key "${key}".`,
      });
      return;
    }
    const collection = childrenByKey.get(key) ?? [];
    collection.push(record);
    childrenByKey.set(key, collection);
  });

  if (issues.length) throw new TransactionDataValidationError(issues);
  const records = [...headerByKey.entries()].map(([key, header]) => ({
    ...header,
    [relation.collectionPath]: childrenByKey.get(key) ?? [],
  })) as Record<string, JsonValue>[];
  return {
    records,
    sourceRecordCounts: [headers.length, children.length],
    childRecordCount: children.length,
  };
}

function countNestedChildren(records: Record<string, JsonValue>[]): number {
  let count = 0;
  const visit = (value: JsonValue, isRoot = false) => {
    if (Array.isArray(value)) {
      if (!isRoot) count += value.length;
      value.forEach((entry) => visit(entry));
    } else if (value && typeof value === 'object') {
      Object.values(value).forEach((entry) => visit(entry));
    }
  };
  records.forEach((record) => visit(record));
  return count;
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
