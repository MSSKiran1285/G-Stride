import { useEffect, useState } from 'react';
import { api } from '../api';
import type { DataColumnSchema, DataFileUsage, DataLibraryItem, DataPreview, DataRelationDefinition, Dataset, DataSensitivity, JsonDataValue, TestValueType } from '../types';
import { ListCell } from './ListCell';
import { DomainTag } from './DomainTag';
import { PopDialog } from './PopDialog';
import { AsyncFeedback, TableFrame } from './WorkspacePrimitives';

/** Plain-language list of what references a dataset — 'safe to delete' is the empty case. */
function usageSummary(usage: DataFileUsage): string {
  const parts: string[] = [];
  if (usage.groups.length) parts.push(`${usage.groups.length} Process${usage.groups.length === 1 ? '' : 'es'}: ${usage.groups.join(', ')}`);
  if (usage.packs.length) parts.push(`${usage.packs.length} Regression Pack${usage.packs.length === 1 ? '' : 's'}: ${usage.packs.join(', ')}`);
  if (usage.relations.length) parts.push(`${usage.relations.length} relationship${usage.relations.length === 1 ? '' : 's'}: ${usage.relations.join(', ')}`);
  return parts.length ? parts.join('; ') : 'No tests yet';
}

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
  const [activeTab, setActiveTab] = useState<'library' | 'relationships'>('library');
  const [search, setSearch] = useState('');
  const [areaFilter, setAreaFilter] = useState('');
  /** The row highlighted in the library table — what the detail rail describes. Distinct from
   *  selectedFile, which is the dataset actually OPEN in the editor dialog: you inspect a
   *  dataset's dependencies before deciding to open, rename or delete it. */
  const [selectedLibraryFile, setSelectedLibraryFile] = useState('');
  const [selectedUsage, setSelectedUsage] = useState<DataFileUsage | null>(null);
  const [busyFile, setBusyFile] = useState<string | null>(null);
  const [newDatasetOpen, setNewDatasetOpen] = useState(false);
  /** Saved relationships with their definitions, so the rail can say what each one joins
   *  without the reader opening it first. */
  const [relationSummaries, setRelationSummaries] = useState<{ file: string; definition: DataRelationDefinition | null }[]>([]);

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
    api
      .listDataRelations()
      .then(async (relFiles) => {
        setRelationFiles(relFiles);
        // Each definition is fetched so the rail can show what the relationship actually joins.
        // One failure must not blank the whole list, so each resolves to null independently.
        setRelationSummaries(
          await Promise.all(
            relFiles.map(async (file) => ({
              file,
              definition: await api.getDataRelation(file).catch(() => null),
            }))
          )
        );
      })
      .catch(() => undefined);
  }

  /** True when anything at all references this dataset — the rail's "safe to delete" line. */
  function hasDependencies(usage: DataFileUsage): boolean {
    return usage.groups.length > 0 || usage.packs.length > 0 || usage.relations.length > 0;
  }

  function selectLibraryFile(file: string) {
    setSelectedLibraryFile(file);
    setSelectedUsage(null);
    api.getDataUsage(file).then(setSelectedUsage).catch(() => setSelectedUsage(null));
  }

  function startNewRelationship() {
    setActiveTab('relationships');
    setSelectedRelationFile('');
    setRelationFileName('');
    setRelation(EMPTY_RELATION);
    setRelationPreview(null);
    setError(null);
  }

  function closeDataset() {
    if (!confirmDiscardIfDirty()) return;
    setSelectedFile('');
    setDataset(null);
    setDirty(false);
    setSavedAt(null);
    onSelectedFileChange?.('');
  }

  async function renameSelected(file: string) {
    const next = window.prompt(`Rename ${file} to:`, file);
    if (!next || next.trim() === file) return;
    setBusyFile(file);
    try {
      await api.renameData(file, next.trim());
      if (selectedFile === file) openFile(next.trim());
      setSelectedLibraryFile(next.trim());
      refreshFiles();
      refreshTags();
      refreshLibrary();
      selectLibraryFile(next.trim());
      setError(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusyFile(null);
    }
  }

  async function deleteSelected(file: string) {
    const usage = selectedUsage ?? (await api.getDataUsage(file).catch(() => null));
    const summary = usage ? usageSummary(usage) : 'unknown dependencies';
    const dependent = usage ? hasDependencies(usage) : true;
    const message = dependent
      ? `${file} is used by ${summary}. Delete it anyway?`
      : `Delete ${file}? ${summary}.`;
    if (!window.confirm(message)) return;
    setBusyFile(file);
    try {
      await api.deleteData(file, dependent);
      if (selectedFile === file) {
        setSelectedFile('');
        setDataset(null);
      }
      setSelectedLibraryFile('');
      setSelectedUsage(null);
      refreshFiles();
      refreshTags();
      refreshLibrary();
      setError(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusyFile(null);
    }
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
    setNewDatasetOpen(false);
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

  const visibleItems = libraryItems.filter((item) => {
    const matchesSearch = item.file.toLowerCase().includes(search.trim().toLowerCase());
    const matchesArea = !areaFilter || (item.processArea || 'Untagged') === areaFilter;
    return matchesSearch && matchesArea;
  });
  const selectedItem = libraryItems.find((item) => item.file === selectedLibraryFile) ?? null;
  const libraryAreas = [...new Set(libraryItems.map((item) => item.processArea || 'Untagged'))].sort();

  return (
    <div className="stack data-workspace">
      <header className="data-workspace-heading">
        <div>
          <p className="eyebrow">Reusable Test Data</p>
          <h1>Datasets</h1>
          <p className="hint">Find a dataset, inspect what depends on it, then rename or remove it safely.</p>
        </div>
        <div className="row" style={{ flex: '0 0 auto' }}>
          <button type="button" onClick={startNewRelationship}>New relationship</button>
          <button type="button" className="primary" onClick={() => { setNewDatasetOpen(true); setError(null); }}>
            New dataset
          </button>
        </div>
      </header>

      {error && <AsyncFeedback state="error" message={error} />}
      {loading && <AsyncFeedback state="loading" message="Loading datasets…" />}

      <div className="workspace-tabs" role="tablist" aria-label="Test Data sections">
        <button
          type="button"
          role="tab"
          id="tab-dataset-library"
          aria-selected={activeTab === 'library'}
          aria-controls="panel-dataset-library"
          className={activeTab === 'library' ? 'workspace-tab active' : 'workspace-tab'}
          onClick={() => setActiveTab('library')}
        >
          Dataset library <span className="workspace-tab-count">{libraryItems.length}</span>
        </button>
        <button
          type="button"
          role="tab"
          id="tab-relationships"
          aria-selected={activeTab === 'relationships'}
          aria-controls="panel-relationships"
          className={activeTab === 'relationships' ? 'workspace-tab active' : 'workspace-tab'}
          onClick={() => setActiveTab('relationships')}
        >
          Relationships <span className="workspace-tab-count">{relationFiles.length}</span>
        </button>
      </div>

      {activeTab === 'library' ? (
        <div className="data-split" role="tabpanel" id="panel-dataset-library" aria-labelledby="tab-dataset-library">
          <section className="panel stack">
            <div className="data-filters">
              <input
                type="search"
                aria-label="Search file name"
                placeholder="Search file name"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
              <select aria-label="Filter by process area" value={areaFilter} onChange={(event) => setAreaFilter(event.target.value)}>
                <option value="">All process areas</option>
                {libraryAreas.map((area) => <option key={area} value={area}>{area}</option>)}
              </select>
            </div>

            <TableFrame label="Dataset library">
              <table className="responsive-table data-library-table">
                <thead>
                  <tr>
                    <th>Dataset</th>
                    <th>Process area</th>
                    <th>Format</th>
                    <th>Rows</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleItems.map((item) => (
                    <tr
                      key={item.file}
                      className={item.file === selectedLibraryFile ? 'selected-row' : undefined}
                      onClick={() => selectLibraryFile(item.file)}
                    >
                      <td data-label="Dataset">
                        <button
                          type="button"
                          className="data-library-name"
                          aria-pressed={item.file === selectedLibraryFile}
                          onClick={(event) => { event.stopPropagation(); selectLibraryFile(item.file); }}
                        >
                          {item.file}
                        </button>
                      </td>
                      <td data-label="Process area">{item.processArea || <span className="hint">Untagged</span>}</td>
                      <td data-label="Format">{item.format === 'json' ? 'Nested JSON' : 'Flat CSV'}</td>
                      <td data-label="Rows">{item.rowCount}</td>
                    </tr>
                  ))}
                  {visibleItems.length === 0 && (
                    <tr><td colSpan={4} className="hint">No datasets match.</td></tr>
                  )}
                </tbody>
              </table>
            </TableFrame>
            <p className="hint">{visibleItems.length} of {libraryItems.length} datasets</p>
          </section>

          <aside className="panel stack data-rail" aria-label="Selected dataset">
            {selectedItem ? (
              <>
                <div>
                  <p className="eyebrow">Selected dataset</p>
                  <h2 className="data-rail-title">{selectedItem.file}</h2>
                </div>
                <dl className="data-rail-facts">
                  <div><dt>Format</dt><dd>{selectedItem.format === 'json' ? 'Nested JSON' : 'Flat CSV'}</dd></div>
                  <div><dt>Process area</dt><dd>{selectedItem.processArea || 'Untagged'}</dd></div>
                  <div><dt>Rows</dt><dd>{selectedItem.rowCount}</dd></div>
                  <div>
                    <dt>Used by</dt>
                    <dd>{selectedUsage ? usageSummary(selectedUsage) : 'Checking…'}</dd>
                  </div>
                </dl>
                {selectedItem.columns.length > 0 && (
                  <div className="stack" style={{ gap: '0.4rem' }}>
                    <p className="eyebrow">Columns</p>
                    <div className="data-rail-columns">
                      {selectedItem.columns.map((column) => <code key={column}>{column}</code>)}
                    </div>
                  </div>
                )}
                <button type="button" className="primary" onClick={() => openFile(selectedItem.file)}>
                  Open dataset
                </button>
                <div className="row">
                  <button type="button" onClick={() => void renameSelected(selectedItem.file)} disabled={busyFile === selectedItem.file}>
                    Rename
                  </button>
                  <button type="button" className="ghost danger" onClick={() => void deleteSelected(selectedItem.file)} disabled={busyFile === selectedItem.file}>
                    Delete
                  </button>
                </div>
                <p className="hint">
                  {selectedUsage
                    ? (hasDependencies(selectedUsage)
                        ? 'Renaming updates every reference; deleting needs confirmation.'
                        : 'No dependencies — safe to delete.')
                    : 'Checking dependencies…'}
                </p>
              </>
            ) : (
              <p className="hint">Select a dataset to see what it holds and what depends on it.</p>
            )}
          </aside>
        </div>
      ) : (
        <div className="data-split" role="tabpanel" id="panel-relationships" aria-labelledby="tab-relationships">
          <section className="panel stack" aria-labelledby="relational-builder-heading">
            <div>
              <p className="eyebrow">One header · many owned children</p>
              <h2 id="relational-builder-heading">{relationFileName.trim() || 'New relationship'}</h2>
              <p className="hint">Join two CSV files without flattening line items.</p>
            </div>
            <div>
              <label htmlFor="relation-name">Relationship name</label>
              <input id="relation-name" value={relationFileName} onChange={(event) => setRelationFileName(event.target.value)} placeholder="sales-orders-with-items" />
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
                {previewing ? 'Validating…' : 'Validate'}
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

          <aside className="panel stack data-rail" aria-label="Saved relationships">
            <p className="eyebrow">Saved relationships</p>
            {relationSummaries.length === 0 && <p className="hint">None yet.</p>}
            <div className="stack" style={{ gap: '0.5rem' }}>
              {relationSummaries.map((entry) => (
                <button
                  key={entry.file}
                  type="button"
                  className={entry.file === selectedRelationFile ? 'data-relation-card selected' : 'data-relation-card'}
                  onClick={() => void openRelation(entry.file)}
                >
                  <span className="data-relation-name">{entry.file.replace(/\.json$/i, '')}</span>
                  {entry.definition && (
                    <span className="hint">
                      {entry.definition.headerFile} → {entry.definition.collectionPath} · key {entry.definition.headerKey}
                    </span>
                  )}
                </button>
              ))}
            </div>
            <p className="hint">
              Validation blocks duplicate header keys, missing keys, orphan children and collection-name
              collisions before a relationship can be saved.
            </p>
          </aside>
        </div>
      )}

      {newDatasetOpen && (
        <PopDialog title="New dataset" closeLabel="Close without creating a dataset" onClose={() => setNewDatasetOpen(false)}>
          <div className="panel stack">
            <div>
              <label htmlFor="new-dataset-format">Format</label>
              <select id="new-dataset-format" aria-label="New dataset format" value={newFormat} onChange={(e) => setNewFormat(e.target.value as 'csv' | 'json')}>
                <option value="csv">Flat CSV</option>
                <option value="json">Nested JSON</option>
              </select>
            </div>
            <div>
              <label htmlFor="new-dataset-name">File name</label>
              <input id="new-dataset-name" aria-label="New dataset file name" type="text" placeholder="my-new-dataset" value={newFileName} onChange={(e) => setNewFileName(e.target.value)} />
            </div>
            {newFormat === 'csv' && (
              <div>
                <label htmlFor="new-dataset-columns">Columns</label>
                <input
                  id="new-dataset-columns"
                  aria-label="New dataset column names"
                  type="text"
                  placeholder="columns, e.g. supplier,material,plant,quantity"
                  value={newHeaders}
                  onChange={(e) => setNewHeaders(e.target.value)}
                />
                <p className="hint">Comma-separated. You can add more later.</p>
              </div>
            )}
            <div className="row">
              <button type="button" className="primary" onClick={createNew}>Create</button>
              <button type="button" onClick={() => setNewDatasetOpen(false)}>Cancel</button>
            </div>
          </div>
        </PopDialog>
      )}

      {dataset && selectedFile && (
        <PopDialog
          className="data-dialog"
          title={`${selectedFile} — ${dataset.format === 'csv'
            ? `${dataset.rows.length} row${dataset.rows.length === 1 ? '' : 's'}`
            : `${dataset.records.length} transaction${dataset.records.length === 1 ? '' : 's'}`}${dirty ? ' · unsaved changes' : ''}`}
          closeLabel="Close dataset"
          onClose={closeDataset}
        >
          <div className="panel stack">
            {loadingArtifact && <AsyncFeedback state="loading" message={`Loading ${selectedFile}…`} compact />}

            <div className="row" style={{ alignItems: 'flex-start', gap: '1rem' }}>
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
        </PopDialog>
      )}
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
