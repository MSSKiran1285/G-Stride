import { useEffect, useState } from 'react';
import { api } from '../api';
import type { Group } from '../types';
import { FileChainPicker } from './FileChainPicker';
import { DomainTag } from './DomainTag';
import { GroupedPicker } from './GroupedPicker';

const UNTAGGED = '(untagged)';
const sortDomains = (a: string, b: string) => (a === UNTAGGED ? 1 : b === UNTAGGED ? -1 : a.localeCompare(b));

interface GroupEditorProps {
  onDirtyChange?: (dirty: boolean) => void;
}

export function GroupEditor({ onDirtyChange }: GroupEditorProps = {}) {
  const [groupFiles, setGroupFiles] = useState<string[]>([]);
  const [testCaseFiles, setTestCaseFiles] = useState<string[]>([]);
  const [dataFiles, setDataFiles] = useState<string[]>([]);
  const [selectedFile, setSelectedFile] = useState('');
  const [group, setGroup] = useState<Group | null>(null);
  const [dirty, setDirty] = useState(false);
  const [newFileName, setNewFileName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  // BL-10: processArea tag per group file, grouping "Open group" the same way Compose does.
  const [fileTags, setFileTags] = useState<Record<string, string>>({});
  const [processAreas, setProcessAreas] = useState<string[]>([]);

  function refreshTags() {
    api.listTags('group').then(setFileTags).catch(() => undefined);
    api.listProcessAreas().then(setProcessAreas).catch(() => undefined);
  }

  useEffect(() => {
    api.listGroups().then(setGroupFiles).catch((e) => setError(String(e)));
    api.listTestCases().then(setTestCaseFiles).catch((e) => setError(String(e)));
    api.listData().then(setDataFiles).catch((e) => setError(String(e)));
    refreshTags();
  }, []);

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  // Same guard as the test case editor — a saved-then-forgotten group is worse than
  // a confirm dialog on an accidental reload.
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
    return window.confirm('You have unsaved changes to this group. Discard them?');
  }

  function updateGroup(next: Group) {
    setGroup(next);
    setDirty(true);
  }

  function openFile(file: string) {
    if (!confirmDiscardIfDirty()) return;
    setSelectedFile(file);
    setSavedAt(null);
    setError(null);
    setDirty(false);
    api
      .getGroup(file)
      .then(setGroup)
      .catch((e) => setError(String(e)));
  }

  function createNew() {
    if (!newFileName.trim()) return;
    if (!confirmDiscardIfDirty()) return;
    const file = newFileName.trim().endsWith('.json') ? newFileName.trim() : `${newFileName.trim()}.json`;
    setSelectedFile(file);
    setGroup({ name: file.replace(/\.json$/, ''), appId: '', testCaseFiles: [], dataFile: undefined });
    setDirty(true);
    setNewFileName('');
    setSavedAt(null);
  }

  async function save() {
    if (!group || !selectedFile) return;
    if (group.testCaseFiles.length === 0) {
      setError('Add at least one test case file to this group before saving.');
      return;
    }
    try {
      await api.saveGroup(selectedFile, group);
      setSavedAt(new Date().toLocaleTimeString());
      setDirty(false);
      setError(null);
      if (!groupFiles.includes(selectedFile)) setGroupFiles([...groupFiles, selectedFile].sort());
    } catch (e) {
      setError(String(e));
    }
  }

  return (
    <div className="stack">
      <div className="panel row">
        <div style={{ flex: 1 }}>
          <label>Open group</label>
          <GroupedPicker
            ariaLabel="Open group"
            value={selectedFile}
            onChange={openFile}
            items={groupFiles}
            getKey={(f) => f}
            getLabel={(f) => f}
            getGroup={(f) => fileTags[f] || UNTAGGED}
            sortGroups={sortDomains}
          />
        </div>
        <div style={{ flex: 1 }}>
          <label>Or create new</label>
          <div className="row">
            <input aria-label="New group file name" type="text" placeholder="po-gr-invoice" value={newFileName} onChange={(e) => setNewFileName(e.target.value)} />
            <button onClick={createNew}>Create</button>
          </div>
        </div>
      </div>

      {error && <p className="error-text" role="alert">{error}</p>}

      {group && (
        <div className="panel stack">
          <div className="row" style={{ alignItems: 'flex-start', gap: '1rem' }}>
            <div style={{ flex: 1 }}>
              <label>Group name (scenario title)</label>
              <input aria-label="Group name" type="text" value={group.name} onChange={(e) => updateGroup({ ...group, name: e.target.value })} />
            </div>
            <div style={{ flex: 1, maxWidth: '20rem' }}>
              <label>Domain</label>
              <DomainTag kind="group" name={selectedFile} value={fileTags[selectedFile] ?? ''} knownDomains={processAreas} onSaved={refreshTags} />
            </div>
          </div>

          <p className="section-title">
            Test cases ({group.testCaseFiles.length}){dirty && <span className="hint"> — unsaved changes</span>}
          </p>
          <FileChainPicker
            availableLabel="Available test cases"
            selectedLabel="Group order"
            items={testCaseFiles}
            selected={group.testCaseFiles}
            onChange={(next) => updateGroup({ ...group, testCaseFiles: next })}
          />

          <div className="param-grid">
            <div>
              <label>App ID</label>
              <input aria-label="Group App ID" type="text" value={group.appId} onChange={(e) => updateGroup({ ...group, appId: e.target.value })} />
            </div>
            <div>
              <label>Data file</label>
              <select aria-label="Group data file" value={group.dataFile ?? ''} onChange={(e) => updateGroup({ ...group, dataFile: e.target.value || undefined })}>
                <option value="">— none —</option>
                {dataFiles.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="row">
            <button className="primary" onClick={save}>
              Save group
            </button>
            {savedAt && !dirty && <span className="hint">Saved at {savedAt}</span>}
          </div>
        </div>
      )}
    </div>
  );
}
