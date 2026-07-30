import { Fragment, useEffect, useState } from 'react';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { api } from '../api';
import type { CaptureRequest, ModuleCall, ModuleInfo, TestApplication, TestCase, TestContract, TestValidationIssue } from '../types';
import { StepEditor } from './StepEditor';
import { DomainTag } from './DomainTag';
import { GroupedPicker } from './GroupedPicker';
import { AsyncFeedback, TableFrame } from './WorkspacePrimitives';
import { TestContractEditor } from './TestContractEditor';

const UNTAGGED = '(untagged)';
const sortDomains = (a: string, b: string) => (a === UNTAGGED ? 1 : b === UNTAGGED ? -1 : a.localeCompare(b));

function summarizeParams(params: Record<string, string>): string {
  const entries = Object.entries(params).filter(([, v]) => v !== '');
  if (entries.length === 0) return '(no params)';
  return entries.map(([k, v]) => `${k}=${v}`).join('  ·  ');
}

// Param keys that name a runState key a step CAPTURES (hands off to later steps) rather than
// reads. Used to tell a step's author "this ${placeholder} isn't a data-file column, it's a
// value an earlier step in this same test case produced" — see BL-07.
const CAPTURE_KEY_PARAM_KEYS = new Set(['captureAs', 'amountKey', 'lineItemCountKey']);

/** Every runState key produced by steps strictly before `uptoIndex` — see CAPTURE_KEY_PARAM_KEYS. */
function computeHandoffKeys(steps: ModuleCall[], uptoIndex: number, modules: ModuleInfo[]): Set<string> {
  const keys = new Set<string>();
  for (let i = 0; i < uptoIndex && i < steps.length; i++) {
    const moduleInfo = modules.find((m) => m.name === steps[i].module);
    for (const p of moduleInfo?.describe?.params ?? []) {
      if (!CAPTURE_KEY_PARAM_KEYS.has(p.key)) continue;
      const value = steps[i].params[p.key]?.trim() || p.placeholder;
      if (value) keys.add(value);
    }
  }
  return keys;
}

interface TestCaseEditorProps {
  selectedTxTemplate?: string | null;
  initialFile?: string;
  onSelectedFileChange?: (file: string) => void;
  onDirtyChange?: (dirty: boolean) => void;
  showLibraryControls?: boolean;
  onRequestCapture?: (request: CaptureRequest) => void;
}

export function TestCaseEditor({
  selectedTxTemplate,
  initialFile,
  onSelectedFileChange,
  onDirtyChange,
  showLibraryControls = true,
  onRequestCapture,
}: TestCaseEditorProps = {}) {
  const [files, setFiles] = useState<string[]>([]);
  const [modules, setModules] = useState<ModuleInfo[]>([]);
  const [selectedFile, setSelectedFile] = useState('');
  const [testCase, setTestCase] = useState<TestCase | null>(null);
  const [dirty, setDirty] = useState(false);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [newFileName, setNewFileName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingArtifact, setLoadingArtifact] = useState(false);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [validationIssues, setValidationIssues] = useState<TestValidationIssue[]>([]);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [reorderAnnouncement, setReorderAnnouncement] = useState('');
  // Keys produced by whole test cases that run BEFORE this one when it's a later stage
  // in a saved Group (Chain mode shares runState across a Group's stages) — see BL-07.
  // computeHandoffKeys alone only sees steps within the currently open file, which
  // misses exactly this case (e.g. post-goods-receipt.json's ${poNumber}, captured by
  // create-po.json — a different file, same Group, same shared runState at runtime).
  const [crossFileHandoffKeys, setCrossFileHandoffKeys] = useState<Set<string>>(new Set());
  // BL-10: processArea tag per test case file, so "Open test case" groups by domain
  // instead of one flat, ever-growing list.
  const [fileTags, setFileTags] = useState<Record<string, string>>({});
  const [processAreas, setProcessAreas] = useState<string[]>([]);

  function refreshTags() {
    api.listTags('testCase').then(setFileTags).catch(() => undefined);
    api.listProcessAreas().then(setProcessAreas).catch(() => undefined);
  }

  useEffect(() => {
    Promise.all([api.listTestCases(), api.listModules()])
      .then(([nextFiles, nextModules]) => {
        setFiles(nextFiles);
        setModules(nextModules);
      })
      .catch((reason) => setError(String(reason)))
      .finally(() => setLoading(false));
    refreshTags();
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
    api.getTestCase(initialFile)
      .then(setTestCase)
      .catch((e) => setError(String(e)))
      .finally(() => setLoadingArtifact(false));
  }, [initialFile, selectedFile]);

  useEffect(() => {
    if (!selectedFile || modules.length === 0) {
      setCrossFileHandoffKeys(new Set());
      return;
    }
    let cancelled = false;
    (async () => {
      const groupFiles = await api.listGroups().catch(() => [] as string[]);
      const groups = await Promise.all(groupFiles.map((f) => api.getGroup(f).catch(() => null)));
      const precedingFiles = new Set<string>();
      for (const group of groups) {
        if (!group) continue;
        const idx = group.testCaseFiles.indexOf(selectedFile);
        if (idx > 0) group.testCaseFiles.slice(0, idx).forEach((f) => precedingFiles.add(f));
      }
      const keys = new Set<string>();
      for (const f of precedingFiles) {
        const tc = await api.getTestCase(f).catch(() => null);
        if (!tc) continue;
        computeHandoffKeys(tc.steps, tc.steps.length, modules).forEach((k) => keys.add(k));
      }
      if (!cancelled) setCrossFileHandoffKeys(keys);
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedFile, modules]);

  // Warn on tab close/refresh if there are unsaved edits — losing a half-built
  // test case to an accidental reload is the most damaging way this can go wrong.
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
    return window.confirm('You have unsaved changes to this test case. Discard them?');
  }

  function updateTestCase(next: TestCase) {
    setTestCase(next.lifecycle === 'published' ? { ...next, lifecycle: 'draft' } : next);
    setDirty(true);
    setValidationIssues([]);
  }

  function openFile(file: string) {
    if (!confirmDiscardIfDirty()) return;
    setSelectedFile(file);
    setSavedAt(null);
    setError(null);
    setDirty(false);
    setLoadingArtifact(true);
    api
      .getTestCase(file)
      .then(setTestCase)
      .catch((e) => setError(String(e)))
      .finally(() => setLoadingArtifact(false));
    onSelectedFileChange?.(file);
  }

  function createNew() {
    if (!newFileName.trim()) return;
    if (!confirmDiscardIfDirty()) return;
    const file = newFileName.trim().endsWith('.json') ? newFileName.trim() : `${newFileName.trim()}.json`;
    setSelectedFile(file);
    setTestCase({ name: file.replace(/\.json$/, ''), steps: [] });
    setDirty(true);
    setNewFileName('');
    setSavedAt(null);
    onSelectedFileChange?.(file);
  }

  function updateStep(index: number, call: ModuleCall) {
    if (!testCase) return;
    const steps = [...testCase.steps];
    if (index >= steps.length) steps.push(call);
    else steps[index] = call;
    updateTestCase({ ...testCase, steps });
    setEditingIndex(null);
  }

  function removeStep(index: number) {
    if (!testCase) return;
    updateTestCase({ ...testCase, steps: testCase.steps.filter((_, i) => i !== index) });
  }

  function reorderStep(from: number, to: number) {
    if (!testCase || from === to) return;
    const steps = [...testCase.steps];
    const [moved] = steps.splice(from, 1);
    steps.splice(to, 0, moved);
    updateTestCase({ ...testCase, steps });
    setReorderAnnouncement(`${moved.module} moved to step ${to + 1}.`);
  }

  async function persist(candidate: TestCase, successLabel: string) {
    setSaving(true);
    try {
      await api.saveTestCase(selectedFile, candidate);
      setTestCase(candidate);
      setSavedAt(new Date().toLocaleTimeString());
      setDirty(false);
      setError(null);
      setValidationIssues([]);
      if (!files.includes(selectedFile)) setFiles([...files, selectedFile].sort());
      onSelectedFileChange?.(selectedFile);
      return successLabel;
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }

  async function save() {
    if (!testCase || !selectedFile) return;
    await persist({ ...testCase, version: 1, lifecycle: testCase.lifecycle ?? 'draft' }, 'saved');
  }

  async function publish() {
    if (!testCase || !selectedFile) return;
    const candidate: TestCase = { ...testCase, version: 1, lifecycle: 'published' };
    setPublishing(true);
    setError(null);
    try {
      const result = await api.validateTestCase(candidate);
      setValidationIssues(result.issues);
      if (!result.valid) return;
      await persist(candidate, 'published');
    } catch (reason) {
      setError(String(reason));
    } finally {
      setPublishing(false);
    }
  }

  async function declareContract() {
    if (!testCase) return;
    let contract: TestContract = { version: 1, inputs: [], outputs: [] };
    if (selectedFile && files.includes(selectedFile)) {
      contract = await api.getTestContract(selectedFile).catch(() => contract);
    }
    updateTestCase({ ...testCase, version: 1, lifecycle: 'draft', contract });
  }

  const defaultAppId = testCase?.steps.find((s) => s.appId)?.appId ?? '';
  const contractInputKeys = (testCase?.contract?.inputs ?? []).map((input) => input.runtimeKey ?? input.name);

  return (
    <div className="stack">
      <details className="panel">
        <summary className="section-title" style={{ cursor: 'pointer' }}>
          How Objects, Modules, and App ID fit together
        </summary>
        <div className="stack" style={{ marginTop: '0.6rem', fontSize: '0.85rem', color: 'var(--text-soft)' }}>
          <p style={{ margin: 0 }}>
            <strong style={{ color: 'var(--text)' }}>Modules</strong> are generic, reusable verbs — "Click Button,"
            "Enter Header Field" — built into Studio. They know <em>how</em> to do something but nothing about{' '}
            <em>what</em> screen you're on.
          </p>
          <p style={{ margin: 0 }}>
            <strong style={{ color: 'var(--text)' }}>Objects</strong> (captured in the Objects tab) are the nouns — a
            specific, named control on a specific screen. An object just remembers where something is; it can't do
            anything by itself.
          </p>
          <p style={{ margin: 0 }}>
            A step is a module (the verb) plus a reference to one saved object (the noun), by name — e.g.{' '}
            <code>Click Button</code> + <code>CreateButton</code>. A few modules (<code>Add Line Item(s)</code>,{' '}
            <code>Save &amp; Capture Document Number</code>) bundle several related objects internally, so one step
            covers what would otherwise be several.
          </p>
          <p style={{ margin: 0 }}>
            <strong style={{ color: 'var(--text)' }}>App ID</strong> is just a namespace — it keeps one screen's
            "SupplierField" from colliding with another screen's. Set it per step (or once as the test case default);
            it determines which saved objects show up as suggestions when you're filling in a field below.
          </p>
        </div>
      </details>

      {selectedTxTemplate && (
        <div className="fiori-message-strip info" style={{ marginBottom: '0.75rem' }}>
          <strong>SAP Transaction Template Active:</strong> Pre-loaded sequence for <code>{selectedTxTemplate}</code>. Edit parameters or add custom step modules below.
        </div>
      )}

      {showLibraryControls && <div className="panel row">
        <div style={{ flex: 1 }}>
          <label>Open test case</label>
          <GroupedPicker
            ariaLabel="Open test case"
            value={selectedFile}
            onChange={openFile}
            items={files}
            getKey={(f) => f}
            getLabel={(f) => f}
            getGroup={(f) => fileTags[f] || UNTAGGED}
            sortGroups={sortDomains}
          />
        </div>
        <div style={{ flex: 1 }}>
          <label>Or create new</label>
          <div className="row">
            <input aria-label="New test case file name" type="text" placeholder="my-new-scenario" value={newFileName} onChange={(e) => setNewFileName(e.target.value)} />
            <button onClick={createNew}>Create</button>
          </div>
        </div>
      </div>}

      {error && <AsyncFeedback state="error" message={error} />}
      {loading && <AsyncFeedback state="loading" message="Loading Compose resources…" />}
      {loadingArtifact && <AsyncFeedback state="loading" message={`Loading ${selectedFile}…`} compact />}
      <span className="sr-only" role="status" aria-live="polite">{reorderAnnouncement}</span>

      {testCase && (
        <div className="panel stack">
          <div className="test-lifecycle-bar">
            <div>
              <span className="eyebrow">Test lifecycle</span>
              <strong>{testCase.lifecycle === 'published' ? 'Published' : testCase.lifecycle === 'draft' ? 'Draft' : 'Legacy ready'}</strong>
              <span className="hint">{testCase.lifecycle === 'published' ? 'Available for governed composition.' : 'Publishing requires a valid contract, parameters and objects.'}</span>
            </div>
            <span className={`badge ${testCase.lifecycle === 'published' ? 'passed' : 'running'}`}>{testCase.lifecycle === 'published' ? 'Published' : 'Draft'}</span>
          </div>

          <div className="row" style={{ alignItems: 'flex-start', gap: '1rem' }}>
            <div style={{ flex: 1 }}>
              <label>Test case name</label>
              <input aria-label="Test case name" type="text" value={testCase.name} onChange={(e) => updateTestCase({ ...testCase, name: e.target.value })} />
            </div>
            <div style={{ flex: 1, maxWidth: '20rem' }}>
              <label>Application</label>
              <select aria-label="Test application" value={testCase.application ?? 'SAP'} onChange={(e) => updateTestCase({ ...testCase, application: e.target.value as TestApplication })}>
                <option value="SAP">SAP</option>
                <option value="Salesforce">Salesforce</option>
                <option value="Oracle">Oracle</option>
                <option value="ServiceNow">ServiceNow</option>
              </select>
            </div>
            <div style={{ flex: 1, maxWidth: '20rem' }}>
              <label>Domain</label>
              <DomainTag kind="testCase" name={selectedFile} value={fileTags[selectedFile] ?? ''} knownDomains={processAreas} onSaved={refreshTags} />
            </div>
          </div>

          {testCase.contract ? (
            <TestContractEditor
              contract={testCase.contract}
              stepNames={testCase.steps.map((step) => step.module)}
              onChange={(contract) => updateTestCase({ ...testCase, contract })}
            />
          ) : (
            <div className="contract-empty-state">
              <div><strong>No declared Test contract</strong><p className="hint">Legacy inference keeps this Test executable, but publishing requires reviewed typed inputs and outputs.</p></div>
              <button type="button" onClick={() => void declareContract()}>Use inferred contract</button>
            </div>
          )}

          {validationIssues.length > 0 && (
            <div className="publish-validation-panel" role="alert" aria-labelledby="publishIssuesHeading">
              <strong id="publishIssuesHeading">Resolve {validationIssues.length} publishing issue{validationIssues.length === 1 ? '' : 's'}</strong>
              <ul>{validationIssues.map((issue, index) => <li key={`${issue.path}-${index}`}><code>{issue.path}</code> — {issue.message}</li>)}</ul>
            </div>
          )}

          <div>
            <p className="section-title">
              Steps ({testCase.steps.length}){dirty && <span className="hint"> — unsaved changes</span>}
            </p>
            <TableFrame label="Test case steps">
              <table className="responsive-table">
                <thead>
                  <tr>
                    <th></th>
                    <th>#</th>
                    <th>Module</th>
                    <th>App ID</th>
                    <th>Params</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {testCase.steps.map((step, i) => (
                    <Fragment key={i}>
                      <tr
                        draggable
                        onDragStart={() => setDragIndex(i)}
                        onDragOver={(e) => {
                          e.preventDefault();
                          if (dragIndex !== null && dragIndex !== i) setDragOverIndex(i);
                        }}
                        onDragLeave={() => setDragOverIndex((cur) => (cur === i ? null : cur))}
                        onDrop={(e) => {
                          e.preventDefault();
                          if (dragIndex !== null) reorderStep(dragIndex, i);
                          setDragIndex(null);
                          setDragOverIndex(null);
                        }}
                        onDragEnd={() => {
                          setDragIndex(null);
                          setDragOverIndex(null);
                        }}
                        className={[dragIndex === i ? 'dragging' : '', dragOverIndex === i ? 'drag-over' : ''].filter(Boolean).join(' ')}
                      >
                        <td className="drag-handle" title="Drag to reorder" data-label="Reorder">
                          ⠿
                        </td>
                        <td className="step-index" data-label="Step">{i + 1}</td>
                        <td className="step-module" data-label="Module">{step.module}</td>
                        <td data-label="App ID">{step.appId && <span className="badge running">{step.appId}</span>}</td>
                        <td className="step-params" data-label="Parameters">{summarizeParams(step.params)}</td>
                        <td className="step-actions" data-label="Actions">
                          <button
                            className="ghost icon-only"
                            aria-label={`Move step ${i + 1}: ${step.module} up`}
                            onClick={() => reorderStep(i, i - 1)}
                            disabled={i === 0}
                          >
                            <ArrowUp size={14} aria-hidden="true" />
                          </button>
                          <button
                            className="ghost icon-only"
                            aria-label={`Move step ${i + 1}: ${step.module} down`}
                            onClick={() => reorderStep(i, i + 1)}
                            disabled={i === testCase.steps.length - 1}
                          >
                            <ArrowDown size={14} aria-hidden="true" />
                          </button>
                          <button className="ghost" aria-label={`${editingIndex === i ? 'Close editor for' : 'Edit'} step ${i + 1}: ${step.module}`} onClick={() => setEditingIndex(editingIndex === i ? null : i)}>
                            {editingIndex === i ? 'Close' : 'Edit'}
                          </button>
                          <button className="ghost danger" aria-label={`Remove step ${i + 1}: ${step.module}`} onClick={() => removeStep(i)}>
                            Remove
                          </button>
                        </td>
                      </tr>
                      {editingIndex === i && (
                        <tr>
                          <td colSpan={6} className="step-editor-cell">
                            <StepEditor
                              modules={modules}
                              initial={step}
                              defaultAppId={defaultAppId}
                              handoffKeys={new Set([...computeHandoffKeys(testCase.steps, i, modules), ...crossFileHandoffKeys])}
                              contractInputKeys={contractInputKeys}
                              onSave={(call) => updateStep(i, call)}
                              onCancel={() => setEditingIndex(null)}
                              onRequestCapture={onRequestCapture}
                            />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                  {editingIndex === testCase.steps.length && (
                    <tr>
                      <td colSpan={6} className="step-editor-cell">
                        <StepEditor
                          modules={modules}
                          initial={null}
                          defaultAppId={defaultAppId}
                          handoffKeys={new Set([...computeHandoffKeys(testCase.steps, testCase.steps.length, modules), ...crossFileHandoffKeys])}
                          contractInputKeys={contractInputKeys}
                          onSave={(call) => updateStep(editingIndex, call)}
                          onCancel={() => setEditingIndex(null)}
                          onRequestCapture={onRequestCapture}
                        />
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </TableFrame>
          </div>

          <div className="row">
            <button onClick={() => setEditingIndex(testCase.steps.length)} disabled={editingIndex !== null}>
              + Add step
            </button>
            <button className="primary" onClick={save} disabled={saving}>
              {saving ? 'Saving…' : 'Save test case'}
            </button>
            <button onClick={() => void publish()} disabled={saving || publishing}>
              {publishing ? 'Checking…' : 'Publish Test'}
            </button>
            {savedAt && !dirty && <AsyncFeedback state="success" message={`${selectedFile} — Saved at ${savedAt}`} compact />}
          </div>
        </div>
      )}
    </div>
  );
}
