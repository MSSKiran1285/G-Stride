import { useEffect, useState } from 'react';
import { api } from '../api';
import type { RegressionPack, RegressionPackMember } from '../types';
import { AsyncFeedback } from './WorkspacePrimitives';

interface PackEditorProps {
  initialFile?: string;
  onSelectedFileChange?: (file: string) => void;
  onDirtyChange?: (dirty: boolean) => void;
  /** The workspace tree owns opening and creating, so the editor drops its own picker. */
  showLibraryControls?: boolean;
  /** A file name to start as a new unsaved Pack, set by the workspace's Create New. */
  newFile?: string;
}

const newMember = (index: number): RegressionPackMember => ({
  id: `member-${index + 1}`,
  kind: 'test',
  file: '',
  sessionPolicy: 'fresh-per-iteration',
  iterationFailurePolicy: 'continue-next-iteration',
});

export function PackEditor({
  initialFile,
  onSelectedFileChange,
  onDirtyChange,
  showLibraryControls = true,
  newFile,
}: PackEditorProps) {
  const [files, setFiles] = useState<string[]>([]);
  const [testFiles, setTestFiles] = useState<string[]>([]);
  const [processFiles, setProcessFiles] = useState<string[]>([]);
  const [dataFiles, setDataFiles] = useState<string[]>([]);
  const [selectedFile, setSelectedFile] = useState('');
  const [newFileName, setNewFileName] = useState('');
  const [pack, setPack] = useState<RegressionPack | null>(null);
  const [dirty, setDirty] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingArtifact, setLoadingArtifact] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([api.listPacks(), api.listTestCases(), api.listGroups(), api.listData()])
      .then(([nextFiles, nextTests, nextProcesses, nextData]) => {
        setFiles(nextFiles);
        setTestFiles(nextTests);
        setProcessFiles(nextProcesses);
        setDataFiles(nextData);
      })
      .catch((reason) => setError(String(reason)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => onDirtyChange?.(dirty), [dirty, onDirtyChange]);

  useEffect(() => {
    if (!initialFile || initialFile === selectedFile) return;
    // See GroupEditor: a new draft is not on disk, and fetching it reports "Not found" over it.
    if (initialFile === newFile) return;
    setSelectedFile(initialFile);
    setSavedAt(null);
    setError(null);
    setDirty(false);
    setLoadingArtifact(true);
    api.getPack(initialFile)
      .then(setPack)
      .catch((reason) => setError(String(reason)))
      .finally(() => setLoadingArtifact(false));
  }, [initialFile, selectedFile, newFile]);

  useEffect(() => {
    const handler = (event: BeforeUnloadEvent) => {
      if (!dirty) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  function confirmDiscard(): boolean {
    return !dirty || window.confirm('You have unsaved changes to this Regression Pack. Discard them?');
  }

  function update(next: RegressionPack) {
    setPack(next);
    setDirty(true);
  }

  function open(file: string) {
    if (!file || !confirmDiscard()) return;
    setSelectedFile(file);
    setSavedAt(null);
    setError(null);
    setDirty(false);
    setLoadingArtifact(true);
    api.getPack(file)
      .then(setPack)
      .catch((reason) => setError(String(reason)))
      .finally(() => setLoadingArtifact(false));
    onSelectedFileChange?.(file);
  }

  /** Starts an unsaved Pack for a name the workspace tree asked for. */
  function startNew(file: string) {
    setSelectedFile(file);
    setPack({
      version: 1,
      name: file.replace(/.json$/, ''),
      description: '',
      lifecycle: 'draft',
      members: [newMember(0)],
    });
    setSavedAt(null);
    setError(null);
    setDirty(true);
  }

  useEffect(() => {
    if (newFile) startNew(newFile);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newFile]);

  function create() {
    const requested = newFileName.trim();
    if (!requested || !confirmDiscard()) return;
    const file = requested.endsWith('.json') ? requested : `${requested}.json`;
    setSelectedFile(file);
    setPack({
      version: 1,
      name: requested.replace(/\.json$/, ''),
      description: '',
      lifecycle: 'draft',
      members: [newMember(0)],
    });
    setNewFileName('');
    setSavedAt(null);
    setError(null);
    setDirty(true);
    onSelectedFileChange?.(file);
  }

  function updateMember(index: number, patch: Partial<RegressionPackMember>) {
    if (!pack) return;
    const members = pack.members.map((member, memberIndex) =>
      memberIndex === index ? { ...member, ...patch } : member);
    update({ ...pack, members });
  }

  function setMemberKind(index: number, kind: RegressionPackMember['kind']) {
    updateMember(index, {
      kind,
      file: '',
      appId: kind === 'process' ? undefined : pack?.members[index].appId,
      sessionPolicy: kind === 'test' ? 'fresh-per-iteration' : pack?.members[index].sessionPolicy,
    });
  }

  function addMember() {
    if (!pack) return;
    const used = new Set(pack.members.map((member) => member.id));
    let index = pack.members.length;
    while (used.has(`member-${index + 1}`)) index += 1;
    update({ ...pack, members: [...pack.members, newMember(index)] });
  }

  function removeMember(index: number) {
    if (!pack || pack.members.length === 1) return;
    update({ ...pack, members: pack.members.filter((_, memberIndex) => memberIndex !== index) });
  }

  function packIssues(value: RegressionPack): string[] {
    const issues: string[] = [];
    const ids = new Set<string>();
    value.members.forEach((member, index) => {
      if (!member.id.trim()) issues.push(`Member ${index + 1} needs an ID.`);
      else if (ids.has(member.id)) issues.push(`Member ID "${member.id}" is duplicated.`);
      if (!member.file) issues.push(`Member ${index + 1} needs a Test or Business Process.`);
      if (member.kind === 'test' && member.sessionPolicy === 'reuse-within-process') {
        issues.push(`Test member "${member.id || index + 1}" cannot reuse a Business Process session.`);
      }
      ids.add(member.id);
    });
    return issues;
  }

  async function save() {
    if (!pack || !selectedFile) return;
    const issues = packIssues(pack);
    if (issues.length > 0) {
      setError(`Resolve the Pack definition before saving: ${issues[0]}`);
      return;
    }
    setSaving(true);
    try {
      await api.savePack(selectedFile, pack);
      setFiles((current) => current.includes(selectedFile) ? current : [...current, selectedFile].sort());
      setDirty(false);
      setError(null);
      setSavedAt(new Date().toLocaleTimeString());
      onSelectedFileChange?.(selectedFile);
    } catch (reason) {
      setError(String(reason));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="stack">
      {showLibraryControls && <div className="panel row">
        <div style={{ flex: 1 }}>
          <label htmlFor="open-pack">Open Regression Pack</label>
          <select id="open-pack" aria-label="Open Regression Pack" value={selectedFile} onChange={(event) => open(event.target.value)}>
            <option value="">— select a Pack —</option>
            {files.map((file) => <option key={file} value={file}>{file}</option>)}
          </select>
        </div>
        <div style={{ flex: 1 }}>
          <label htmlFor="new-pack">Or create new</label>
          <div className="row">
            <input id="new-pack" aria-label="New Pack file name" placeholder="quarterly-regression" value={newFileName} onChange={(event) => setNewFileName(event.target.value)} />
            <button type="button" onClick={create}>Create Pack</button>
          </div>
        </div>
      </div>}

      {loading && <AsyncFeedback state="loading" message="Loading Regression Packs…" />}
      {loadingArtifact && <AsyncFeedback state="loading" message={`Loading ${selectedFile}…`} compact />}
      {error && <AsyncFeedback state="error" message={error} />}

      {pack && (
        <section className="panel stack" aria-label="Regression Pack editor">
          <div className="row" style={{ alignItems: 'flex-start' }}>
            <div style={{ flex: 1 }}>
              <label htmlFor="pack-name">Pack name</label>
              <input id="pack-name" aria-label="Pack name" value={pack.name} onChange={(event) => update({ ...pack, name: event.target.value })} />
            </div>
            <div style={{ minWidth: '12rem' }}>
              <label htmlFor="pack-lifecycle">Lifecycle</label>
              <select id="pack-lifecycle" aria-label="Pack lifecycle" value={pack.lifecycle} onChange={(event) => update({ ...pack, lifecycle: event.target.value as RegressionPack['lifecycle'] })}>
                <option value="draft">Draft</option>
                <option value="published">Published</option>
              </select>
            </div>
          </div>
          <div>
            <label htmlFor="pack-description">Description</label>
            <textarea id="pack-description" aria-label="Pack description" value={pack.description ?? ''} onChange={(event) => update({ ...pack, description: event.target.value })} />
          </div>

          <div className="row" style={{ justifyContent: 'space-between' }}>
            <div>
              <p className="section-title">Independent member lanes ({pack.members.length})</p>
              <p className="hint">Each member runs as an isolated Test or Business Process with its own bindings and policies.</p>
            </div>
            <button type="button" onClick={addMember}>Add member</button>
          </div>

          {pack.members.map((member, index) => {
            const available = member.kind === 'test' ? testFiles : processFiles;
            return (
              <fieldset key={`${member.id}-${index}`} className="panel stack" aria-label={`Pack member ${index + 1}`}>
                <legend>Member {index + 1}</legend>
                {/* One lane reads left to right: what it is called, what it runs, and what data it
                    runs on. The policies sit on the row beneath, because they are the part you
                    set once and rarely revisit. */}
                <div className="pack-member-row">
                  <div className="pack-member-field">
                    <label>Member ID</label>
                    <input aria-label={`Member ${index + 1} ID`} value={member.id} onChange={(event) => updateMember(index, { id: event.target.value })} />
                  </div>
                  <div className="pack-member-field">
                    <label>Artifact type</label>
                    <select aria-label={`Member ${index + 1} type`} value={member.kind} onChange={(event) => setMemberKind(index, event.target.value as RegressionPackMember['kind'])}>
                      <option value="test">Test</option>
                      <option value="process">Business Process</option>
                    </select>
                  </div>
                  <div className="pack-member-field">
                    <label>Artifact</label>
                    <select aria-label={`Member ${index + 1} artifact`} value={member.file} onChange={(event) => updateMember(index, { file: event.target.value })}>
                      <option value="">— select —</option>
                      {available.map((file) => <option key={file} value={file}>{file}</option>)}
                    </select>
                  </div>
                  <div className="pack-member-field">
                    <label>Data binding</label>
                    <select aria-label={`Member ${index + 1} data`} value={member.dataFile ?? ''} onChange={(event) => updateMember(index, { dataFile: event.target.value || undefined })}>
                      <option value="">— inherit artifact/default —</option>
                      {dataFiles.map((file) => <option key={file} value={file}>{file}</option>)}
                    </select>
                  </div>
                </div>

                <div className="pack-member-row">
                  <div className="pack-member-field">
                    <label>App ID override</label>
                    <input aria-label={`Member ${index + 1} App ID`} value={member.appId ?? ''} onChange={(event) => updateMember(index, { appId: event.target.value || undefined })} />
                  </div>
                  <div className="pack-member-field">
                    <label>Session policy</label>
                    <select aria-label={`Member ${index + 1} session policy`} value={member.sessionPolicy} onChange={(event) => updateMember(index, { sessionPolicy: event.target.value as RegressionPackMember['sessionPolicy'] })}>
                      <option value="fresh-per-iteration">Fresh per iteration</option>
                      {member.kind === 'process' && <option value="reuse-within-process">Reuse within Process</option>}
                    </select>
                  </div>
                  <div className="pack-member-field">
                    <label>On iteration failure</label>
                    <select aria-label={`Member ${index + 1} failure policy`} value={member.iterationFailurePolicy} onChange={(event) => updateMember(index, { iterationFailurePolicy: event.target.value as RegressionPackMember['iterationFailurePolicy'] })}>
                      <option value="continue-next-iteration">Continue next iteration</option>
                      <option value="stop-execution">Stop execution</option>
                    </select>
                  </div>
                  <button
                    type="button"
                    className="ghost danger pack-member-remove"
                    onClick={() => removeMember(index)}
                    disabled={pack.members.length === 1}
                  >
                    Remove member
                  </button>
                </div>
              </fieldset>
            );
          })}

          <div className={`fiori-message-strip ${packIssues(pack).length ? 'error' : 'success'}`} role="status">
            {packIssues(pack).length
              ? <><strong>{packIssues(pack).length} Pack issue{packIssues(pack).length === 1 ? '' : 's'}</strong><ul>{packIssues(pack).map((issue) => <li key={issue}>{issue}</li>)}</ul></>
              : 'Pack definition is valid: members are independent and policy-compatible.'}
          </div>

          <div className="row">
            <button className="primary" type="button" onClick={save} disabled={saving}>
              {saving ? 'Saving…' : 'Save Regression Pack'}
            </button>
            {dirty && <span className="hint">Unsaved changes</span>}
            {savedAt && !dirty && <AsyncFeedback state="success" message={`${selectedFile} — Saved at ${savedAt}`} compact />}
          </div>
        </section>
      )}
    </div>
  );
}
