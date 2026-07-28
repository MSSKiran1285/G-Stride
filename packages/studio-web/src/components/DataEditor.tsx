import { useEffect, useState } from 'react';
import { api } from '../api';
import type { Dataset } from '../types';
import { ListCell } from './ListCell';
import { DomainTag } from './DomainTag';
import { GroupedPicker } from './GroupedPicker';

const UNTAGGED = '(untagged)';
const sortDomains = (a: string, b: string) => (a === UNTAGGED ? 1 : b === UNTAGGED ? -1 : a.localeCompare(b));

interface DataEditorProps {
  onDirtyChange?: (dirty: boolean) => void;
}

export function DataEditor({ onDirtyChange }: DataEditorProps = {}) {
  const [files, setFiles] = useState<string[]>([]);
  const [selectedFile, setSelectedFile] = useState('');
  const [dataset, setDataset] = useState<Dataset | null>(null);
  const [newFileName, setNewFileName] = useState('');
  const [newHeaders, setNewHeaders] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  // BL-10: processArea tag per data file, grouping "Open dataset" the same way Compose does.
  const [fileTags, setFileTags] = useState<Record<string, string>>({});
  const [processAreas, setProcessAreas] = useState<string[]>([]);

  function refreshTags() {
    api.listTags('dataFile').then(setFileTags).catch(() => undefined);
    api.listProcessAreas().then(setProcessAreas).catch(() => undefined);
  }

  useEffect(() => {
    api
      .listData()
      .then((all) => setFiles(all.filter((f) => f.endsWith('.csv'))))
      .catch((e) => setError(String(e)));
    refreshTags();
  }, []);

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

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
    api
      .getDataset(file)
      .then(setDataset)
      .catch((e) => setError(String(e)));
  }

  function createNew() {
    const file = newFileName.trim().endsWith('.csv') ? newFileName.trim() : `${newFileName.trim()}.csv`;
    const headers = newHeaders
      .split(',')
      .map((h) => h.trim())
      .filter(Boolean);
    if (!newFileName.trim() || headers.length === 0) {
      setError('Give the dataset a file name and at least one column name.');
      return;
    }
    setSelectedFile(file);
    setDataset({ headers, rows: [] });
    setNewFileName('');
    setNewHeaders('');
    setSavedAt(null);
    setError(null);
    setDirty(true);
  }

  function setCell(rowIndex: number, header: string, value: string) {
    if (!dataset) return;
    const rows = dataset.rows.map((r, i) => (i === rowIndex ? { ...r, [header]: value } : r));
    setDataset({ ...dataset, rows });
    setDirty(true);
  }

  function addRow() {
    if (!dataset) return;
    const blank = Object.fromEntries(dataset.headers.map((h) => [h, '']));
    setDataset({ ...dataset, rows: [...dataset.rows, blank] });
    setDirty(true);
  }

  function removeRow(rowIndex: number) {
    if (!dataset) return;
    setDataset({ ...dataset, rows: dataset.rows.filter((_, i) => i !== rowIndex) });
    setDirty(true);
  }

  async function save() {
    if (!dataset || !selectedFile) return;
    try {
      await api.saveDataset(selectedFile, dataset);
      setSavedAt(new Date().toLocaleTimeString());
      setDirty(false);
      setError(null);
      if (!files.includes(selectedFile)) setFiles([...files, selectedFile].sort());
    } catch (e) {
      setError(String(e));
    }
  }

  return (
    <div className="stack">
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
            <input aria-label="New dataset file name" type="text" placeholder="my-new-dataset" value={newFileName} onChange={(e) => setNewFileName(e.target.value)} style={{ flex: 1 }} />
            <input
              type="text"
              aria-label="New dataset column names"
              placeholder="columns, e.g. supplier,material,plant,quantity"
              value={newHeaders}
              onChange={(e) => setNewHeaders(e.target.value)}
              style={{ flex: 2 }}
            />
            <button onClick={createNew}>Create</button>
          </div>
        </div>
      </div>

      {error && <p className="error-text" role="alert">{error}</p>}

      {dataset && (
        <div className="panel stack">
          <div className="row" style={{ alignItems: 'flex-start', gap: '1rem' }}>
            <p className="section-title" style={{ flex: 1, margin: 0 }}>
              {selectedFile} — {dataset.rows.length} row{dataset.rows.length === 1 ? '' : 's'}
              {dirty && <span className="hint"> — unsaved changes</span>}
            </p>
            <div style={{ flex: 1, maxWidth: '20rem' }}>
              <DomainTag kind="dataFile" name={selectedFile} value={fileTags[selectedFile] ?? ''} knownDomains={processAreas} onSaved={refreshTags} />
            </div>
          </div>

          <div className="table-wrap">
            <table>
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
                    <td className="hint">{ri + 1}</td>
                    {dataset.headers.map((h) => (
                      <td key={h}>
                        <ListCell ariaLabel={`${h}, row ${ri + 1}`} value={row[h] ?? ''} onChange={(v) => setCell(ri, h, v)} />
                      </td>
                    ))}
                    <td>
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
          </div>

          <div className="row">
            <button onClick={addRow}>+ Add row</button>
            <button className="primary" onClick={save}>
              Save dataset
            </button>
            {savedAt && !dirty && <span className="hint">Saved at {savedAt}</span>}
          </div>
        </div>
      )}
    </div>
  );
}
