import { useEffect, useState } from 'react';
import { api } from '../api';
import type {
  BusinessProcessStageDefinition,
  Group,
  ProcessInputBinding,
  TestContract,
  TestContractOutput,
} from '../types';
import { FileChainPicker } from './FileChainPicker';
import { DomainTag } from './DomainTag';
import { GroupedPicker } from './GroupedPicker';
import { AsyncFeedback } from './WorkspacePrimitives';

/**
 * Outputs that are one value per EXECUTION, not one per stage.
 *
 * The server inserts CreateAutomationRunReference as step 1 of every Test that creates SAP
 * documents, and that module declares these three. So the moment a Business Process contains two
 * transactional Tests — Create SO then Create Delivery — every one of them collides, and the
 * process could not be saved at all. o2c-e2e, the product's own flagship process, is exactly that
 * shape.
 *
 * The collision is not real. The module is deliberately idempotent: the first stage mints the
 * reference and later stages reuse it, because an audit trail pointing at three unrelated
 * identifiers for one run is the opposite of a correlation key. Whichever stage a consumer reads
 * it from, the value is the same, so there is no ambiguity to warn about. Any OTHER duplicated
 * output still is ambiguous — two stages producing different document numbers under one name —
 * and stays an error.
 */
const RUN_SCOPED_OUTPUTS = new Set(['automationReference', 'automationOwner', 'transactionFailureDisposition']);

const UNTAGGED = '(untagged)';
const sortDomains = (a: string, b: string) => (a === UNTAGGED ? 1 : b === UNTAGGED ? -1 : a.localeCompare(b));

interface GroupEditorProps {
  initialFile?: string;
  onSelectedFileChange?: (file: string) => void;
  onDirtyChange?: (dirty: boolean) => void;
  /** The workspace tree owns opening and creating, so the editor drops its own picker. */
  showLibraryControls?: boolean;
  /** A file name to start as a new unsaved Business Process, set by the workspace's Create New. */
  newFile?: string;
}

export function GroupEditor({
  initialFile,
  onSelectedFileChange,
  onDirtyChange,
  showLibraryControls = true,
  newFile,
}: GroupEditorProps = {}) {
  const [groupFiles, setGroupFiles] = useState<string[]>([]);
  const [testCaseFiles, setTestCaseFiles] = useState<string[]>([]);
  const [dataFiles, setDataFiles] = useState<string[]>([]);
  const [selectedFile, setSelectedFile] = useState('');
  const [group, setGroup] = useState<Group | null>(null);
  const [dirty, setDirty] = useState(false);
  const [newFileName, setNewFileName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingArtifact, setLoadingArtifact] = useState(false);
  const [saving, setSaving] = useState(false);
  // BL-10: processArea tag per process file, grouping the picker the same way Compose does.
  const [fileTags, setFileTags] = useState<Record<string, string>>({});
  const [processAreas, setProcessAreas] = useState<string[]>([]);
  const [contracts, setContracts] = useState<Record<string, TestContract>>({});

  function refreshTags() {
    api.listTags('group').then(setFileTags).catch(() => undefined);
    api.listProcessAreas().then(setProcessAreas).catch(() => undefined);
  }

  useEffect(() => {
    Promise.all([api.listGroups(), api.listTestCases(), api.listData()])
      .then(([nextGroups, nextTestCases, nextData]) => {
        setGroupFiles(nextGroups);
        setTestCaseFiles(nextTestCases);
        setDataFiles(nextData);
      })
      .catch((reason) => setError(String(reason)))
      .finally(() => setLoading(false));
    refreshTags();
  }, []);

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  useEffect(() => {
    if (!group) return;
    const missing = group.testCaseFiles.filter((file) => !contracts[file]);
    if (missing.length === 0) return;
    Promise.all(missing.map(async (file) => [file, await api.getTestContract(file)] as const))
      .then((entries) => setContracts((current) => ({ ...current, ...Object.fromEntries(entries) })))
      .catch((reason) => setError(String(reason)));
  }, [group?.testCaseFiles.join('|'), contracts]);

  useEffect(() => {
    if (!initialFile || initialFile === selectedFile) return;
    // A brand new scenario exists only as an unsaved draft in memory. Creating one also sets the
    // route, so this effect would otherwise fetch a file that is not on disk yet and report
    // "Error: Not found" over a perfectly good draft.
    if (initialFile === newFile) return;
    setSelectedFile(initialFile);
    setSavedAt(null);
    setError(null);
    setDirty(false);
    setLoadingArtifact(true);
    api.getGroup(initialFile)
      .then(setGroup)
      .catch((e) => setError(String(e)))
      .finally(() => setLoadingArtifact(false));
  }, [initialFile, selectedFile, newFile]);

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
    return window.confirm('You have unsaved changes to this Business Process. Discard them?');
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
    setLoadingArtifact(true);
    api
      .getGroup(file)
      .then(setGroup)
      .catch((e) => setError(String(e)))
      .finally(() => setLoadingArtifact(false));
    onSelectedFileChange?.(file);
  }

  /**
   * Starts an unsaved Business Process for a name the workspace tree asked for. Same draft the
   * editor's own Create makes — this is the tree driving it rather than the inline field.
   */
  function startNew(file: string) {
    setSelectedFile(file);
    setGroup({
      name: file.replace(/.json$/, ''),
      appId: '',
      testCaseFiles: [],
      dataFile: undefined,
      version: 1,
      lifecycle: 'draft',
      stages: [],
    });
    setDirty(true);
    setSavedAt(null);
    setError(null);
  }

  useEffect(() => {
    if (newFile) startNew(newFile);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newFile]);

  function createNew() {
    if (!newFileName.trim()) return;
    if (!confirmDiscardIfDirty()) return;
    const file = newFileName.trim().endsWith('.json') ? newFileName.trim() : `${newFileName.trim()}.json`;
    setSelectedFile(file);
    setGroup({
      name: file.replace(/\.json$/, ''),
      appId: '',
      testCaseFiles: [],
      dataFile: undefined,
      version: 1,
      lifecycle: 'draft',
      stages: [],
    });
    setDirty(true);
    setNewFileName('');
    setSavedAt(null);
    onSelectedFileChange?.(file);
  }

  async function save() {
    if (!group || !selectedFile) return;
    if (group.testCaseFiles.length === 0) {
      setError('Add at least one Test to this Business Process before saving.');
      return;
    }
    if (group.testCaseFiles.some((file) => !contracts[file])) {
      setError('Wait for every Test contract to load before saving this Business Process.');
      return;
    }
    setSaving(true);
    try {
      const stages = effectiveStages(group);
      const issues = processIssues(group, stages);
      if (issues.length > 0) {
        setError(`Resolve the Process topology before saving: ${issues[0]}`);
        return;
      }
      await api.saveGroup(selectedFile, {
        ...group,
        version: 1,
        lifecycle: group.lifecycle ?? 'draft',
        stages,
      });
      setSavedAt(new Date().toLocaleTimeString());
      setDirty(false);
      setError(null);
      if (!groupFiles.includes(selectedFile)) setGroupFiles([...groupFiles, selectedFile].sort());
      onSelectedFileChange?.(selectedFile);
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }

  const safeStageId = (file: string, index: number) => {
    const stem = file.replace(/\.json$/i, '').replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+/, '');
    return `stage-${index + 1}-${stem || 'test'}`;
  };

  const systemInput = (name: string): ProcessInputBinding | undefined => {
    const key = ({
      url: 'sap.url',
      urlBase: 'sap.urlBase',
      username: 'sap.username',
      password: 'sap.password',
      today: 'runtime.today',
    } as const)[name as 'url' | 'urlBase' | 'username' | 'password' | 'today'];
    return key ? { source: 'systemContext', key } : undefined;
  };

  function defaultBinding(
    inputName: string,
    prior: Array<{ stageId: string; output: TestContractOutput }>,
    hasData: boolean
  ): ProcessInputBinding {
    const system = systemInput(inputName);
    if (system) return system;
    const producer = [...prior].reverse().find((entry) => entry.output.name === inputName);
    if (producer) return { source: 'stageOutput', stageId: producer.stageId, output: producer.output.name };
    if (hasData) return { source: 'processData', path: inputName };
    return { source: 'literal', value: '' };
  }

  function effectiveStages(value: Group): BusinessProcessStageDefinition[] {
    const prior: Array<{ stageId: string; output: TestContractOutput }> = [];
    return value.testCaseFiles.map((file, index) => {
      const existing = value.stages?.[index]?.testCaseFile === file ? value.stages[index] : undefined;
      const stageId = existing?.stageId || safeStageId(file, index);
      const contract = contracts[file];
      const inputBindings = Object.fromEntries(
        (contract?.inputs ?? []).map((input) => [
          input.name,
          existing?.inputBindings?.[input.name] ?? defaultBinding(input.name, prior, Boolean(value.dataFile)),
        ])
      );
      for (const output of contract?.outputs ?? []) prior.push({ stageId, output });
      return { stageId, testCaseFile: file, inputBindings };
    });
  }

  function updateTestFiles(testCaseFiles: string[]) {
    if (!group) return;
    const next = { ...group, testCaseFiles };
    updateGroup({ ...next, stages: effectiveStages(next) });
  }

  function updateStage(index: number, patch: Partial<BusinessProcessStageDefinition>) {
    if (!group) return;
    const stages = effectiveStages(group).map((stage, stageIndex) =>
      stageIndex === index ? { ...stage, ...patch } : stage);
    updateGroup({ ...group, stages });
  }

  function updateStageBinding(index: number, input: string, binding: ProcessInputBinding) {
    if (!group) return;
    const stage = effectiveStages(group)[index];
    updateStage(index, { inputBindings: { ...stage.inputBindings, [input]: binding } });
  }

  function availableOutputs(stages: BusinessProcessStageDefinition[], beforeIndex: number) {
    return stages.slice(0, beforeIndex).flatMap((stage) =>
      (contracts[stage.testCaseFile]?.outputs ?? []).map((output) => ({ stageId: stage.stageId, output })));
  }

  function processIssues(value: Group, stages = effectiveStages(value)): string[] {
    const issues: string[] = [];
    const stageIds = new Set<string>();
    const outputs = new Map<string, string>();
    stages.forEach((stage, index) => {
      if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(stage.stageId)) {
        issues.push(`Stage ${index + 1} has an invalid ID.`);
      }
      if (stageIds.has(stage.stageId)) issues.push(`Stage ID "${stage.stageId}" is duplicated.`);
      const priorIds = new Set(stages.slice(0, index).map((entry) => entry.stageId));
      const contract = contracts[stage.testCaseFile];
      for (const input of contract?.inputs ?? []) {
        const binding = stage.inputBindings[input.name];
        if (input.required && !binding) issues.push(`${stage.stageId}.${input.name} has no source.`);
        if (binding?.source === 'stageOutput') {
          if (!priorIds.has(binding.stageId)) {
            issues.push(`${stage.stageId}.${input.name} creates a forward reference or cycle.`);
            continue;
          }
          const producer = stages.find((entry) => entry.stageId === binding.stageId);
          const output = contracts[producer?.testCaseFile ?? '']?.outputs.find((entry) => entry.name === binding.output);
          if (!output) issues.push(`${stage.stageId}.${input.name} references an unknown output.`);
          else if (output.type !== input.type) {
            issues.push(`${stage.stageId}.${input.name} expects ${input.type}, but ${binding.stageId}.${binding.output} produces ${output.type}.`);
          }
        }
        if (binding?.source === 'literal' && input.required && binding.value === '') {
          issues.push(`${stage.stageId}.${input.name} requires a non-empty source.`);
        }
      }
      for (const output of contract?.outputs ?? []) {
        const previous = outputs.get(output.name);
        if (previous && !RUN_SCOPED_OUTPUTS.has(output.name)) {
          issues.push(`Output "${output.name}" is declared by both ${previous} and ${stage.stageId}.`);
        }
        outputs.set(output.name, stage.stageId);
      }
      stageIds.add(stage.stageId);
    });
    return [...new Set(issues)];
  }

  function selectBinding(
    encoded: string,
    current: ProcessInputBinding,
    inputName: string
  ): ProcessInputBinding {
    if (encoded === 'processData') {
      return { source: 'processData', path: current.source === 'processData' ? current.path : inputName };
    }
    if (encoded === 'literal') {
      return { source: 'literal', value: current.source === 'literal' ? current.value : '' };
    }
    if (encoded.startsWith('systemContext:')) {
      return { source: 'systemContext', key: encoded.slice('systemContext:'.length) as Extract<ProcessInputBinding, { source: 'systemContext' }>['key'] };
    }
    const [, stageId, output] = encoded.split(':');
    return { source: 'stageOutput', stageId, output };
  }

  return (
    <div className="stack">
      {showLibraryControls && <div className="panel row">
        <div style={{ flex: 1 }}>
          <label>Open Business Process</label>
          <GroupedPicker
            ariaLabel="Open Business Process"
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
            <input aria-label="New Business Process file name" type="text" placeholder="po-gr-invoice" value={newFileName} onChange={(e) => setNewFileName(e.target.value)} />
            <button onClick={createNew}>Create</button>
          </div>
        </div>
      </div>}

      {error && <AsyncFeedback state="error" message={error} />}
      {loading && <AsyncFeedback state="loading" message="Loading Business Processes…" />}
      {loadingArtifact && <AsyncFeedback state="loading" message={`Loading ${selectedFile}…`} compact />}

      {group && (
        <div className="panel stack">
          <div className="row" style={{ alignItems: 'flex-start', gap: '1rem' }}>
            <div style={{ flex: 1 }}>
              <label>Business Process name (scenario title)</label>
              <input aria-label="Business Process name" type="text" value={group.name} onChange={(e) => updateGroup({ ...group, name: e.target.value })} />
            </div>
            <div style={{ flex: 1, maxWidth: '20rem' }}>
              <label>Process area</label>
              <DomainTag kind="group" name={selectedFile} value={fileTags[selectedFile] ?? ''} knownDomains={processAreas} onSaved={refreshTags} />
            </div>
            <div style={{ minWidth: '10rem' }}>
              <label>Lifecycle</label>
              <select
                aria-label="Business Process lifecycle"
                value={group.lifecycle ?? 'draft'}
                onChange={(event) => updateGroup({ ...group, lifecycle: event.target.value as 'draft' | 'published' })}
              >
                <option value="draft">Draft</option>
                <option value="published">Published</option>
              </select>
            </div>
          </div>

          <p className="section-title">
            Tests ({group.testCaseFiles.length}){dirty && <span className="hint"> — unsaved changes</span>}
          </p>
          <FileChainPicker
            availableLabel="Available Tests"
            selectedLabel="Business Process order"
            items={testCaseFiles}
            selected={group.testCaseFiles}
            onChange={updateTestFiles}
          />

          <div className="param-grid">
            <div>
              <label>App ID</label>
              <input aria-label="Business Process App ID" type="text" value={group.appId} onChange={(e) => updateGroup({ ...group, appId: e.target.value })} />
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

          {group.testCaseFiles.length > 0 && (() => {
            const stages = effectiveStages(group);
            const issues = processIssues(group, stages);
            return (
              <section className="stack" aria-label="Business Process stage topology">
                <div>
                  <p className="section-title">Stage topology and typed hand-offs</p>
                  <p className="hint">Each stage consumes Process data, protected system context, a literal, or an output produced by an earlier stage.</p>
                </div>
                {stages.map((stage, index) => {
                  const contract = contracts[stage.testCaseFile];
                  const priorOutputs = availableOutputs(stages, index);
                  return (
                    <fieldset key={`${stage.stageId}-${index}`} className="panel stack" aria-label={`Process stage ${index + 1}`}>
                      <legend>Stage {index + 1} · {stage.testCaseFile}</legend>
                      <div>
                        <label>Stage ID</label>
                        <input
                          aria-label={`Stage ${index + 1} ID`}
                          value={stage.stageId}
                          onChange={(event) => updateStage(index, { stageId: event.target.value })}
                        />
                      </div>
                      {!contract && <AsyncFeedback state="loading" message={`Loading contract for ${stage.testCaseFile}…`} compact />}
                      {(contract?.inputs ?? []).length === 0
                        ? <p className="hint">This Test declares no external business inputs.</p>
                        : (contract?.inputs ?? []).map((input) => {
                            const binding = stage.inputBindings[input.name] ?? defaultBinding(input.name, priorOutputs, Boolean(group.dataFile));
                            const encoded = binding.source === 'stageOutput'
                              ? `stageOutput:${binding.stageId}:${binding.output}`
                              : binding.source === 'systemContext'
                                ? `systemContext:${binding.key}`
                                : binding.source;
                            return (
                              <div className="param-grid" key={input.name}>
                                <div>
                                  <label>{input.name} <span className="hint">· {input.type}{input.required ? ' · required' : ''}</span></label>
                                  <select
                                    aria-label={`${stage.stageId} ${input.name} source`}
                                    value={encoded}
                                    onChange={(event) => updateStageBinding(index, input.name, selectBinding(event.target.value, binding, input.name))}
                                  >
                                    <option value="processData">Process data</option>
                                    <option value="literal">Literal value</option>
                                    {priorOutputs.map(({ stageId, output }) => (
                                      <option key={`${stageId}:${output.name}`} value={`stageOutput:${stageId}:${output.name}`}>
                                        {stageId}.{output.name} · {output.type}
                                      </option>
                                    ))}
                                    <option value="systemContext:sap.url">System · SAP URL</option>
                                    <option value="systemContext:sap.urlBase">System · SAP base URL</option>
                                    <option value="systemContext:sap.username">System · SAP username</option>
                                    <option value="systemContext:sap.password">System · SAP password</option>
                                    <option value="systemContext:runtime.today">System · Today</option>
                                  </select>
                                </div>
                                {binding.source === 'processData' && (
                                  <div>
                                    <label>Data property</label>
                                    <input
                                      aria-label={`${stage.stageId} ${input.name} data property`}
                                      value={binding.path}
                                      onChange={(event) => updateStageBinding(index, input.name, { source: 'processData', path: event.target.value })}
                                    />
                                  </div>
                                )}
                                {binding.source === 'literal' && (
                                  <div>
                                    <label>Literal value</label>
                                    <input
                                      aria-label={`${stage.stageId} ${input.name} literal value`}
                                      value={typeof binding.value === 'string' ? binding.value : JSON.stringify(binding.value)}
                                      onChange={(event) => updateStageBinding(index, input.name, { source: 'literal', value: event.target.value })}
                                    />
                                  </div>
                                )}
                              </div>
                            );
                          })}
                      <div>
                        <span className="hint">Produces: </span>
                        {(contract?.outputs ?? []).length === 0
                          ? <span className="hint">No declared outputs</span>
                          : contract?.outputs.map((output) => (
                              <span className="status-chip" key={output.name}>{output.name} · {output.type}</span>
                            ))}
                      </div>
                    </fieldset>
                  );
                })}
                <div className={`fiori-message-strip ${issues.length ? 'error' : 'success'}`} role="status">
                  {issues.length
                    ? <><strong>{issues.length} topology issue{issues.length === 1 ? '' : 's'}</strong><ul>{issues.map((issue) => <li key={issue}>{issue}</li>)}</ul></>
                    : 'Process topology is valid: all bindings resolve backward with compatible types.'}
                </div>
              </section>
            );
          })()}

          <div className="row">
            <button className="primary" onClick={save} disabled={saving}>
              {saving ? 'Saving…' : 'Save Business Process'}
            </button>
            {savedAt && !dirty && <AsyncFeedback state="success" message={`${selectedFile} — Saved at ${savedAt}`} compact />}
          </div>
        </div>
      )}
    </div>
  );
}
