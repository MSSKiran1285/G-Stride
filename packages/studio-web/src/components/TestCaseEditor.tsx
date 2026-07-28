import { Fragment, useEffect, useState } from 'react';
import { api } from '../api';
import type { ModuleCall, ModuleInfo, TestCase } from '../types';
import { StepEditor } from './StepEditor';
import { DomainTag } from './DomainTag';
import { GroupedPicker } from './GroupedPicker';

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
  onDirtyChange?: (dirty: boolean) => void;
}

export function TestCaseEditor({ selectedTxTemplate, onDirtyChange }: TestCaseEditorProps = {}) {
  const [files, setFiles] = useState<string[]>([]);
  const [modules, setModules] = useState<ModuleInfo[]>([]);
  const [selectedFile, setSelectedFile] = useState('');
  const [testCase, setTestCase] = useState<TestCase | null>(null);
  const [dirty, setDirty] = useState(false);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [newFileName, setNewFileName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
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
    api.listTestCases().then(setFiles).catch((e) => setError(String(e)));
    api.listModules().then(setModules).catch((e) => setError(String(e)));
    refreshTags();
  }, []);

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

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
    setTestCase(next);
    setDirty(true);
  }

  function openFile(file: string) {
    if (!confirmDiscardIfDirty()) return;
    setSelectedFile(file);
    setSavedAt(null);
    setError(null);
    setDirty(false);
    api
      .getTestCase(file)
      .then(setTestCase)
      .catch((e) => setError(String(e)));
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
  }

  async function save() {
    if (!testCase || !selectedFile) return;
    try {
      await api.saveTestCase(selectedFile, testCase);
      setSavedAt(new Date().toLocaleTimeString());
      setDirty(false);
      setError(null);
      if (!files.includes(selectedFile)) setFiles([...files, selectedFile].sort());
    } catch (e) {
      setError(String(e));
    }
  }

  const defaultAppId = testCase?.steps.find((s) => s.appId)?.appId ?? '';

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

      <div className="panel row">
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
      </div>

      {error && <p className="error-text" role="alert">{error}</p>}

      {testCase && (
        <div className="panel stack">
          <div className="row" style={{ alignItems: 'flex-start', gap: '1rem' }}>
            <div style={{ flex: 1 }}>
              <label>Test case name</label>
              <input aria-label="Test case name" type="text" value={testCase.name} onChange={(e) => updateTestCase({ ...testCase, name: e.target.value })} />
            </div>
            <div style={{ flex: 1, maxWidth: '20rem' }}>
              <label>Domain</label>
              <DomainTag kind="testCase" name={selectedFile} value={fileTags[selectedFile] ?? ''} knownDomains={processAreas} onSaved={refreshTags} />
            </div>
          </div>

          <div>
            <p className="section-title">
              Steps ({testCase.steps.length}){dirty && <span className="hint"> — unsaved changes</span>}
            </p>
            <div className="table-wrap">
              <table>
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
                        <td className="drag-handle" title="Drag to reorder">
                          ⠿
                        </td>
                        <td className="step-index">{i + 1}</td>
                        <td className="step-module">{step.module}</td>
                        <td>{step.appId && <span className="badge running">{step.appId}</span>}</td>
                        <td className="step-params">{summarizeParams(step.params)}</td>
                        <td className="step-actions">
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
                              onSave={(call) => updateStep(i, call)}
                              onCancel={() => setEditingIndex(null)}
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
                          onSave={(call) => updateStep(editingIndex, call)}
                          onCancel={() => setEditingIndex(null)}
                        />
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="row">
            <button onClick={() => setEditingIndex(testCase.steps.length)} disabled={editingIndex !== null}>
              + Add step
            </button>
            <button className="primary" onClick={save}>
              Save test case
            </button>
            {savedAt && !dirty && <span className="hint">Saved at {savedAt}</span>}
          </div>
        </div>
      )}
    </div>
  );
}
