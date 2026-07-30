import { useMemo, useState } from 'react';
import { Database, Search } from 'lucide-react';
import { api } from '../api';
import type { DataLibraryItem } from '../types';
import { AsyncFeedback, TableFrame } from './WorkspacePrimitives';

function usageSummary(usage: { groups: string[]; packs: string[]; relations: string[] }): string {
  const parts: string[] = [];
  if (usage.groups.length) parts.push(`${usage.groups.length} Process${usage.groups.length === 1 ? '' : 'es'}: ${usage.groups.join(', ')}`);
  if (usage.packs.length) parts.push(`${usage.packs.length} Regression Pack${usage.packs.length === 1 ? '' : 's'}: ${usage.packs.join(', ')}`);
  if (usage.relations.length) parts.push(`${usage.relations.length} relationship${usage.relations.length === 1 ? '' : 's'}: ${usage.relations.join(', ')}`);
  return parts.join('; ');
}

interface DataLibraryProps {
  items: DataLibraryItem[];
  onOpen: (file: string) => void;
  /** Called after a rename or delete succeeds so the caller can refresh its own file list/tags
   *  and, if the currently open dataset was affected, react (follow the rename, close the editor). */
  onChanged: (event: { kind: 'renamed'; oldFile: string; newFile: string } | { kind: 'deleted'; file: string }) => void;
}

/** Searchable/filterable Test Data Library browser (BL-025 AC1/AC3) — rendered inline inside
 *  DataEditor, above the existing "Open dataset" picker, so a tester can find a dataset by
 *  name, format or process area and see (then act on) its dependency impact before renaming
 *  or removing it, without losing the existing quick-switch picker or relational CSV builder. */
export function DataLibrary({ items, onOpen, onChanged }: DataLibraryProps) {
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [areaFilter, setAreaFilter] = useState('all');
  const [formatFilter, setFormatFilter] = useState('all');
  const [renamingFile, setRenamingFile] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [busyFile, setBusyFile] = useState<string | null>(null);

  const processAreas = useMemo(
    () => Array.from(new Set(items.map((item) => item.processArea).filter(Boolean))).sort(),
    [items],
  );
  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return items.filter((item) => {
      const matchesSearch = !query || item.file.toLowerCase().includes(query);
      const matchesArea = areaFilter === 'all' || (areaFilter === 'untagged' ? !item.processArea : item.processArea === areaFilter);
      const matchesFormat = formatFilter === 'all' || item.format === formatFilter;
      return matchesSearch && matchesArea && matchesFormat;
    });
  }, [areaFilter, formatFilter, items, search]);

  function startRename(file: string) {
    setRenamingFile(file);
    setRenameDraft(file.replace(/\.(csv|json)$/i, ''));
    setNotice(null);
    setError(null);
  }

  async function confirmRename(file: string) {
    const extension = file.endsWith('.json') ? '.json' : '.csv';
    const newName = renameDraft.trim().endsWith(extension) ? renameDraft.trim() : `${renameDraft.trim()}${extension}`;
    if (!renameDraft.trim() || newName === file) {
      setRenamingFile(null);
      return;
    }
    setBusyFile(file);
    setError(null);
    try {
      const usage = await api.getDataUsage(file);
      const summary = usageSummary(usage);
      if (summary && !window.confirm(`Renaming "${file}" will update ${summary}.\n\nRename to "${newName}"?`)) {
        setBusyFile(null);
        return;
      }
      const result = await api.renameData(file, newName);
      const updatedCount = result.updatedGroups.length + result.updatedPacks.length + result.updatedRelations.length;
      setNotice(updatedCount > 0
        ? `Renamed to "${newName}" and updated ${updatedCount} referencing artifact${updatedCount === 1 ? '' : 's'}.`
        : `Renamed to "${newName}".`);
      setRenamingFile(null);
      onChanged({ kind: 'renamed', oldFile: file, newFile: newName });
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusyFile(null);
    }
  }

  async function deleteDataset(file: string) {
    setBusyFile(file);
    setError(null);
    try {
      const usage = await api.getDataUsage(file);
      const summary = usageSummary(usage);
      const message = summary
        ? `"${file}" is referenced by ${summary}.\n\nDelete anyway? Those Processes, Packs and relationships will fail until fixed.`
        : `Delete "${file}"? This can't be undone.`;
      if (!window.confirm(message)) {
        setBusyFile(null);
        return;
      }
      await api.deleteData(file, summary.length > 0);
      setNotice(`Deleted "${file}".`);
      onChanged({ kind: 'deleted', file });
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusyFile(null);
    }
  }

  return (
    <section className="panel stack" aria-label="Test Data Library">
      <div>
        <p className="eyebrow">Reusable Test Data</p>
        <h2 style={{ margin: 0 }}>Dataset Library</h2>
        <p className="hint">Find a dataset by file name, format or process area — with dependency-safe rename and removal.</p>
      </div>

      {error && <AsyncFeedback state="error" message={error} />}
      {notice && !error && <AsyncFeedback state="success" message={notice} compact />}

      <div className="test-library-filters">
        <div className="test-library-search">
          <label htmlFor="data-library-search">Search</label>
          <div className="input-with-icon">
            <Search size={16} aria-hidden="true" />
            <input id="data-library-search" type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="File name" />
          </div>
        </div>
        <div>
          <label htmlFor="data-library-area">Filter by process area</label>
          <select id="data-library-area" value={areaFilter} onChange={(event) => setAreaFilter(event.target.value)}>
            <option value="all">All process areas</option>
            {processAreas.map((value) => <option key={value} value={value}>{value}</option>)}
            <option value="untagged">Untagged</option>
          </select>
        </div>
        <div>
          <label htmlFor="data-library-format">Filter by format</label>
          <select id="data-library-format" value={formatFilter} onChange={(event) => setFormatFilter(event.target.value)}>
            <option value="all">All formats</option>
            <option value="csv">Flat CSV</option>
            <option value="json">Nested JSON</option>
          </select>
        </div>
      </div>

      <div className="test-library-result-summary" role="status" aria-live="polite">
        <strong>{filtered.length}</strong> of {items.length} datasets
      </div>

      <TableFrame label="Test Data Library results">
        <table className="responsive-table test-library-table">
          <thead>
            <tr><th>Dataset</th><th>Process area</th><th>Format</th><th>Rows</th><th><span className="sr-only">Actions</span></th></tr>
          </thead>
          <tbody>
            {filtered.map((item) => (
              <tr key={item.file}>
                <td data-label="Dataset">
                  <span className="test-library-file"><Database size={13} aria-hidden="true" /> {item.file}</span>
                </td>
                <td data-label="Process area">{item.processArea || <span className="hint">Untagged</span>}</td>
                <td data-label="Format">{item.format === 'json' ? 'Nested JSON' : 'Flat CSV'}</td>
                <td data-label="Rows">{item.rowCount}</td>
                <td data-label="Actions">
                  {renamingFile === item.file ? (
                    <div className="row" style={{ gap: '0.3rem' }}>
                      <input
                        aria-label={`Rename ${item.file}`}
                        value={renameDraft}
                        onChange={(event) => setRenameDraft(event.target.value)}
                        style={{ width: '10rem' }}
                        autoFocus
                      />
                      <button type="button" className="ghost" disabled={busyFile === item.file} onClick={() => confirmRename(item.file)}>Save</button>
                      <button type="button" className="ghost" onClick={() => setRenamingFile(null)}>Cancel</button>
                    </div>
                  ) : (
                    <div className="row" style={{ gap: '0.3rem' }}>
                      <button type="button" className="ghost" onClick={() => onOpen(item.file)}>Open</button>
                      <button type="button" className="ghost" disabled={busyFile === item.file} onClick={() => startRename(item.file)}>Rename</button>
                      <button type="button" className="ghost danger" disabled={busyFile === item.file} onClick={() => deleteDataset(item.file)}>Delete</button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={5} className="empty-table-state">No datasets match the current filters.</td></tr>
            )}
          </tbody>
        </table>
      </TableFrame>
    </section>
  );
}
