import { useEffect, useState } from 'react';
import { api } from '../api';
import type { DataColumnSchema, DataLibraryItem, DataPreview, DataRelationDefinition, Dataset, DataSensitivity, JsonDataValue, TestValueType } from '../types';
import { ListCell } from './ListCell';
import { DomainTag } from './DomainTag';
import { DataLibrary } from './DataLibrary';
import { GroupedPicker } from './GroupedPicker';
import { AsyncFeedback, TableFrame } from './WorkspacePrimitives';

const UNTAGGED = '(untagged)';
const sortDomains = (a: string, b: string) => (a === UNTAGGED ? 1 : b === UNTAGGED ? -1 : a.localeCompare(b));
const EMPTY_RELATION: DataRelationDefinition = {
  headerFile: '',
  childFile: '',
  headerKey: '',
  childForeignKey: '',
  collectionPath: 'items',
};
const VALUE_TYPES: TestValueType[] = ['string', 'number', 'boolean', 'date', 'object', 'collection'];
const SENSITIVITIES: DataSensitivity[] = ['public', 'business', 'personal', 'secret'];

interface DataEditorProps {
  initialFile?: string;
  onSelectedFileChange?: (file: string) => void;
  onDirtyChange?: (dirty: boolean) => void;
}

export function DataEditor({ initialFile, onSelectedFileChange, onDirtyChange }: DataEditorProps = {}) {
  const [files, setFiles] = useState<string[]>([]);
  const [selectedFile, setSelectedFile] = useState('');
  const [dataset, setDataset] = useState<Dataset | null>(null);
  const [newFileName, setNewFileName] = useState('');
  const [newHeaders, setNewHeaders] = useState('');
  const [newFormat, setNewFormat] = useState<'csv' | 'json'>('csv');
  const [jsonText, setJsonText] = useState('[]');
  const [preview, setPreview] = useState<DataPreview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [relationFiles, setRelationFiles] = useState<string[]>([]);
  const [selectedRelationFile, setSelectedRelationFile] = useState('');
  const [relationFileName, setRelationFileName] = useState('');
  const [relation, setRelation] = useState<DataRelationDefinition>(EMPTY_RELATION);
  const [relationPreview, setRelationPreview] = useState<DataPreview | null>(null);
  const [savingRelation, setSavingRelation] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingArtifact, setLoadingArtifact] = useState(false);
  const [saving, setSaving] = useState(false);
  // BL-10: processArea tag per data file, grouping "Open dataset" the same way Compose does.
  const [fileTags, setFileTags] = useState<Record<string, string>>({});
  const [processAreas, setProcessAreas] = useState<string[]>([]);
  // BL-025 AC2: declared name/type/example/sensitivity per CSV column, keyed by column name.
  const [columnSchema, setColumnSchema] = useState<Record<string, DataColumnSchema>>({});
  // BL-025 AC1/AC3: search/format/process-area facets and dependency-safe rename/removal.
  const [libraryItems, setLibraryItems] = useState<DataLibraryItem[]>([]);

  function refreshTags() {
    api.listTags('dataFile').then(setFileTags).catch(() => undefined);
    api.listProcessAreas().then(setProcessAreas).catch(() => undefined);
  }

  function refreshLibrary() {
    // HC-023: a swallowed failure here used to render as an indistinguishable "0 of 0 datasets"
    // empty state — the same shape as a search that legitimately found nothing.
    api.listDataLibrary().then(setLibraryItems).catch((e) => setError(String(e)));
  }

  function refreshColumnSchema(file: string) {
    api.getDataSchema(file)
      .then((rows) => setColumnSchema(Object.fromEntries(rows.map((r) => [r.column, r]))))
      .catch(() => setColumnSchema({}));
  }

  async function saveColumnSchema(column: string, patch: { type: TestValueType; sensitivity: DataSensitivity; example?: string }) {
    if (!selectedFile) return;
    try {
      await api.saveDataColumn(selectedFile, column, patch);
      setColumnSchema((prev) => ({ ...prev, [column]: { file: selectedFile, column, ...patch } }));
    } catch (e) {
      setError(String(e));
    }
  }

  function refreshRelations() {
    api.listDataRelations().then(setRelationFiles).catch(() => undefined);
  }

  function applyDataset(next: Dataset) {
    setDataset(next);
    setPreview(null);
    if (next.format === 'json') setJsonText(JSON.stringify(next.records, null, 2));
  }

  function refreshFiles() {
    setLoading(true);
    api
      .listData()
      .then((all) => setFiles(all.filter((f) => f.endsWith('.csv') || f.endsWith('.json'))))
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    refreshFiles();
    refreshTags();
    refreshRelations();
    refreshLibrary();
  }, []);

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  useEffect(() => {
    if (!initialFile || initialFile === selectedFile) return;
    setSelectedFile(initialFile);
    setSavedAt(null);
    setError(null);
    setDirty(false);
    setLoadingArtifact(true);
    refreshColumnSchema(initialFile);
    api.getDataset(initialFile)
      .then(applyDataset)
      .catch((e) => setError(String(e)))
      .finally(() => setLoadingArtifact(false));
  }, [initialFile, selectedFile]);

  useEffect(() => {
    function handler(e: BeforeUnloadEvent) {
      if (!dirty) return;
      e.preventDefault();
      e.returnValue = '';
    }
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  function confirmDiscardIfDirty(): boolean {
    if (!dirty) return true;
    return window.confirm('You have unsaved changes to this dataset. Discard them?');
  }

  function openFile(file: string) {
    if (!confirmDiscardIfDirty()) return;
    setSelectedFile(file);
    setSavedAt(null);
    setError(null);
    setDirty(false);
    setLoadingArtifact(true);
    refreshColumnSchema(file);
    api
      .getDataset(file)
      .then(applyDataset)
      .catch((e) => setError(String(e)))
      .finally(() => setLoadingArtifact(false));
    onSelectedFileChange?.(file);
  }

  function createNew() {
    const extension = newFormat === 'json' ? '.json' : '.csv';
    const file = newFileName.trim().endsWith(extension) ? newFileName.trim() : `${newFileName.trim()}${extension}`;
    const headers = newHeaders
      .split(',')
      .map((h) => h.trim())
      .filter(Boolean);
    if (!newFileName.trim() || (newFormat === 'csv' && headers.length === 0)) {
      setError(newFormat === 'csv'
        ? 'Give the dataset a file name and at least one column name.'
        : 'Give the nested JSON dataset a file name.');
      return;
    }
    setSelectedFile(file);
    applyDataset(newFormat === 'json'
      ? { format: 'json', records: [] }
      : { format: 'csv', headers, rows: [] });
    setColumnSchema({});
    setNewFileName('');
    setNewHeaders('');
    setSavedAt(null);
    setError(null);
    setDirty(true);
    onSelectedFileChange?.(file);
  }

  function setCell(rowIndex: number, header: string, value: string) {
    if (!dataset || dataset.format !== 'csv') return;
    const rows = dataset.rows.map((r, i) => (i === rowIndex ? { ...r, [header]: value } : r));
    setDataset({ ...dataset, rows });
    setDirty(true);
  }

  function addRow() {
    if (!dataset || dataset.format !== 'csv') return;
    const blank = Object.fromEntries(dataset.headers.map((h) => [h, '']));
    setDataset({ ...dataset, rows: [...dataset.rows, blank] });
    setDirty(true);
  }

  function removeRow(rowIndex: number) {
    if (!dataset || dataset.format !== 'csv') return;
    setDataset({ ...dataset, rows: dataset.rows.filter((_, i) => i !== rowIndex) });
    setDirty(true);
  }

  async function save() {
    if (!dataset || !selectedFile) return;
    setSaving(true);
    try {
      let next = dataset;
      if (dataset.format === 'json') {
        const records = parseJsonRecords();
        if (!preview) throw new Error('Preview the nested transactions before saving.');
        next = { format: 'json', records };
      }
      await api.saveDataset(selectedFile, next);
      setSavedAt(new Date().toLocaleTimeString());
      setDirty(false);
      setError(null);
      if (!files.includes(selectedFile)) setFiles([...files, selectedFile].sort());
      refreshLibrary();
      onSelectedFileChange?.(selectedFile);
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }

  function parseJsonRecords(): Record<string, JsonDataValue>[] {
    const parsed = JSON.parse(jsonText) as unknown;
    if (!Array.isArray(parsed)) throw new Error('Nested JSON must contain an array of transaction objects.');
    const invalid = parsed.findIndex((entry) => !entry || typeof entry !== 'object' || Array.isArray(entry));
    if (invalid >= 0) throw new Error(`Transaction ${invalid + 1} must be a JSON object.`);
    return parsed as Record<string, JsonDataValue>[];
  }

  async function previewJson() {
    setPreviewing(true);
    try {
      const records = parseJsonRecords();
      const next = await api.previewData({ format: 'json', records });
      setDataset({ format: 'json', records });
      setPreview(next);
      setError(null);
    } catch (e) {
      setPreview(null);
      setError(String(e));
    } finally {
      setPreviewing(false);
    }
  }

  async function previewRelation() {
    setPreviewing(true);
    try {
      const next = await api.previewData({ format: 'relational-csv', ...relation });
      setRelationPreview(next);
      setError(null);
    } catch (e) {
      setRelationPreview(null);
      setError(String(e));
    } finally {
      setPreviewing(false);
    }
  }

  async function saveRelation() {
    const file = relationFileName.trim().endsWith('.json')
      ? relationFileName.trim()
      : `${relationFileName.trim()}.json`;
    if (!relationFileName.trim()) {
      setError('Give the relationship definition a name.');
      return;
    }
    if (!relationPreview) {
      setError('Preview and resolve relationship errors before saving.');
      return;
    }
    setSavingRelation(true);
    try {
      const saved = await api.saveDataRelation(file, relation);
      setRelationPreview(saved.preview);
      setSelectedRelationFile(file);
      setRelationFileName(file.replace(/\.json$/i, ''));
      setSavedAt(new Date().toLocaleTimeString());
      setError(null);
      refreshRelations();
    } catch (e) {
      setError(String(e));
    } finally {
      setSavingRelation(false);
    }
  }

  async function openRelation(file: string) {
    setSelectedRelationFile(file);
    setRelationFileName(file.replace(/\.json$/i, ''));
    setRelationPreview(null);
    try {
      setRelation(await api.getDataRelation(file));
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }

  return (
    <div className="stack">
      <DataLibrary
        items={libraryItems}
        onOpen={openFile}
        onChanged={(event) => {
          if (event.kind === 'renamed') {
            if (selectedFile === event.oldFile) openFile(event.newFile);
          } else if (selectedFile === event.file) {
            setSelectedFile('');
            setDataset(null);
          }
          refreshFiles();
          refreshTags();
          refreshLibrary();
        }}
      />

      <div className="panel row">
        <div style={{ flex: 1 }}>
          <label>Open dataset</label>
          <GroupedPicker
            ariaLabel="Open dataset"
            value={selectedFile}
            onChange={openFile}
            items={files}
            getKey={(f) => f}
            getLabel={(f) => f}
            getGroup={(f) => fileTags[f] || UNTAGGED}
            sortGroups={sortDomains}
          />
        </div>
        <div style={{ flex: 2 }}>
          <label>Or create new</label>
          <div className="row">
            <select aria-label="New dataset format" value={newFormat} onChange={(e) => setNewFormat(e.target.value as 'csv' | 'json')}>
              <option value="csv">Flat CSV</option>
              <option value="json">Nested JSON</option>
            </select>
            <input aria-label="New dataset file name" type="text" placeholder="my-new-dataset" value={newFileName} onChange={(e) => setNewFileName(e.target.value)} style={{ flex: 1 }} />
            {newFormat === 'csv' && (
              <input
                type="text"
                aria-label="New dataset column names"
                placeholder="columns, e.g. supplier,material,plant,quantity"
                value={newHeaders}
                onChange={(e) => setNewHeaders(e.target.value)}
                style={{ flex: 2 }}
              />
            )}
            <button onClick={createNew}>Create</button>
          </div>
        </div>
      </div>

      {error && <AsyncFeedback state="error" message={error} />}
      {loading && <AsyncFeedback state="loading" message="Loading datasets…" />}
      {loadingArtifact && <AsyncFeedback state="loading" message={`Loading ${selectedFile}…`} compact />}

      {dataset && (
        <div className="panel stack">
          <div className="row" style={{ alignItems: 'flex-start', gap: '1rem' }}>
            <p className="section-title" style={{ flex: 1, margin: 0 }}>
              {selectedFile} — {dataset.format === 'csv'
                ? `${dataset.rows.length} row${dataset.rows.length === 1 ? '' : 's'}`
                : `${dataset.records.length} transaction${dataset.records.length === 1 ? '' : 's'}`}
              {dirty && <span className="hint"> — unsaved changes</span>}
            </p>
            <div style={{ flex: 1, maxWidth: '20rem' }}>
              <DomainTag kind="dataFile" name={selectedFile} value={fileTags[selectedFile] ?? ''} knownDomains={processAreas} onSaved={refreshTags} />
            </div>
          </div>

          {dataset.format === 'csv' ? (
            <TableFrame label={`${selectedFile} dataset`}>
              <table className="responsive-table">
                <thead>
                  <tr>
                    <th></th>
                    {dataset.headers.map((h) => (
                      <th key={h}>{h}</th>
                    ))}
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {dataset.rows.map((row, ri) => (
                    <tr key={ri}>
                      <td className="hint" data-label="Row">{ri + 1}</td>
                      {dataset.headers.map((h) => (
                        <td key={h} data-label={h}>
                          <ListCell ariaLabel={`${h}, row ${ri + 1}`} value={row[h] ?? ''} onChange={(v) => setCell(ri, h, v)} />
                        </td>
                      ))}
                      <td data-label="Actions">
                        <button className="ghost danger" aria-label={`Remove dataset row ${ri + 1}`} onClick={() => removeRow(ri)} title="Remove row">
                          ✕
                        </button>
                      </td>
                    </tr>
                  ))}
                  {dataset.rows.length === 0 && (
                    <tr>
                      <td colSpan={dataset.headers.length + 2} className="hint">
                        No rows yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </TableFrame>
          ) : null}

          {dataset.format === 'csv' && (
            <details className="stack">
              <summary>Column schema ({dataset.headers.length} column{dataset.headers.length === 1 ? '' : 's'})</summary>
              <p className="hint">Declare each column's type, sensitivity and an example value — reused wherever this dataset feeds a Test's contract inputs.</p>
              <TableFrame label={`${selectedFile} column schema`}>
                <table className="responsive-table">
                  <thead>
                    <tr><th>Column</th><th>Type</th><th>Sensitivity</th><th>Example</th></tr>
                  </thead>
                  <tbody>
                    {dataset.headers.map((header) => (
                      <ColumnSchemaRow
                        key={header}
                        column={header}
                        schema={columnSchema[header]}
                        onSave={(patch) => saveColumnSchema(header, patch)}
                      />
                    ))}
                  </tbody>
                </table>
              </TableFrame>
            </details>
          )}

          {dataset.format === 'json' && (
            <div className="stack">
              <label htmlFor="nested-json-editor">Nested transaction JSON</label>
              <textarea
                id="nested-json-editor"
                className="json-data-editor"
                rows={18}
                value={jsonText}
                onChange={(event) => {
                  setJsonText(event.target.value);
                  setPreview(null);
                  setDirty(true);
                }}
                spellCheck={false}
              />
              <p className="hint">Use one root object per business transaction. Child arrays remain owned by that transaction and are not flattened.</p>
              <div className="row">
                <button type="button" onClick={() => void previewJson()} disabled={previewing}>
                  {previewing ? 'Validating…' : 'Validate and preview'}
                </button>
                {preview && <PreviewSummary preview={preview} />}
              </div>
            </div>
          )}

          <div className="row">
            {dataset.format === 'csv' && <button onClick={addRow}>+ Add row</button>}
            <button className="primary" onClick={save} disabled={saving || (dataset.format === 'json' && !preview)}>
              {saving ? 'Saving…' : 'Save dataset'}
            </button>
            {savedAt && !dirty && <AsyncFeedback state="success" message={`${selectedFile} — Saved at ${savedAt}`} compact />}
          </div>
        </div>
      )}

      <section className="panel stack" aria-labelledby="relational-builder-heading">
        <div>
          <p className="eyebrow">One header · many owned children</p>
          <h2 id="relational-builder-heading">Relational CSV builder</h2>
          <p className="hint">Join two CSV files without flattening line items. Validation blocks duplicate header keys, missing keys, orphan children, and collection-name collisions.</p>
        </div>
        <div className="row">
          <div style={{ flex: 1 }}>
            <label htmlFor="saved-relation">Open relationship</label>
            <select id="saved-relation" value={selectedRelationFile} onChange={(event) => void openRelation(event.target.value)}>
              <option value="">— New relationship —</option>
              {relationFiles.map((file) => <option key={file} value={file}>{file}</option>)}
            </select>
          </div>
          <div style={{ flex: 1 }}>
            <label htmlFor="relation-name">Relationship name</label>
            <input id="relation-name" value={relationFileName} onChange={(event) => setRelationFileName(event.target.value)} placeholder="sales-orders-with-items" />
          </div>
        </div>
        <div className="relation-grid">
          <div>
            <label htmlFor="relation-header-file">Header CSV</label>
            <select id="relation-header-file" value={relation.headerFile} onChange={(event) => {
              setRelation({ ...relation, headerFile: event.target.value });
              setRelationPreview(null);
            }}>
              <option value="">Select header file</option>
              {files.filter((file) => file.endsWith('.csv')).map((file) => <option key={file} value={file}>{file}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="relation-header-key">Header key</label>
            <input id="relation-header-key" value={relation.headerKey} onChange={(event) => {
              setRelation({ ...relation, headerKey: event.target.value });
              setRelationPreview(null);
            }} placeholder="scenarioKey" />
          </div>
          <div>
            <label htmlFor="relation-child-file">Child CSV</label>
            <select id="relation-child-file" value={relation.childFile} onChange={(event) => {
              setRelation({ ...relation, childFile: event.target.value });
              setRelationPreview(null);
            }}>
              <option value="">Select child file</option>
              {files.filter((file) => file.endsWith('.csv')).map((file) => <option key={file} value={file}>{file}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="relation-child-key">Child foreign key</label>
            <input id="relation-child-key" value={relation.childForeignKey} onChange={(event) => {
              setRelation({ ...relation, childForeignKey: event.target.value });
              setRelationPreview(null);
            }} placeholder="scenarioKey" />
          </div>
          <div>
            <label htmlFor="relation-collection">Child collection name</label>
            <input id="relation-collection" value={relation.collectionPath} onChange={(event) => {
              setRelation({ ...relation, collectionPath: event.target.value });
              setRelationPreview(null);
            }} placeholder="items" />
          </div>
        </div>
        <div className="row">
          <button type="button" onClick={() => void previewRelation()} disabled={previewing}>
            {previewing ? 'Validating…' : 'Validate relationship'}
          </button>
          <button type="button" className="primary" onClick={() => void saveRelation()} disabled={savingRelation || !relationPreview}>
            {savingRelation ? 'Saving…' : 'Save relationship'}
          </button>
          {relationPreview && <PreviewSummary preview={relationPreview} />}
        </div>
        {relationPreview?.sample && (
          <details>
            <summary>Preview joined transactions</summary>
            <pre className="data-preview-json">{JSON.stringify(relationPreview.sample, null, 2)}</pre>
          </details>
        )}
      </section>
    </div>
  );
}

interface ColumnSchemaRowProps {
  column: string;
  schema?: DataColumnSchema;
  onSave: (patch: { type: TestValueType; sensitivity: DataSensitivity; example?: string }) => void;
}

/** One column's schema editor row — the example field commits on blur (not per keystroke)
 *  since it's backed by its own API call rather than the dataset's own save button. */
function ColumnSchemaRow({ column, schema, onSave }: ColumnSchemaRowProps) {
  const [example, setExample] = useState(schema?.example ?? '');

  useEffect(() => {
    setExample(schema?.example ?? '');
  }, [schema?.example]);

  const type = schema?.type ?? 'string';
  const sensitivity = schema?.sensitivity ?? 'public';

  return (
    <tr>
      <td data-label="Column"><strong>{column}</strong></td>
      <td data-label="Type">
        <select aria-label={`${column} type`} value={type} onChange={(e) => onSave({ type: e.target.value as TestValueType, sensitivity, example })}>
          {VALUE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      </td>
      <td data-label="Sensitivity">
        <select aria-label={`${column} sensitivity`} value={sensitivity} onChange={(e) => onSave({ type, sensitivity: e.target.value as DataSensitivity, example })}>
          {SENSITIVITIES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </td>
      <td data-label="Example">
        <input
          aria-label={`${column} example`}
          value={example}
          onChange={(e) => setExample(e.target.value)}
          onBlur={() => onSave({ type, sensitivity, example: example.trim() || undefined })}
          placeholder="e.g. 1000000123"
        />
      </td>
    </tr>
  );
}

function PreviewSummary({ preview }: { preview: DataPreview }) {
  return (
    <div className="data-preview-summary" role="status">
      <span><strong>{preview.transactionCount}</strong> transactions</span>
      <span><strong>{preview.childRecordCount}</strong> child records</span>
      <span>Sources: {preview.sourceRecordCounts.join(' + ')}</span>
    </div>
  );
}
