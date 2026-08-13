import { useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { api } from '../api';
import type { CaptureRequest, ModuleCall, ModuleInfo, ModuleParamDescriptor, ObjectControl, TestStepValueBinding, TestSystemContextKey } from '../types';
import { TableRowsEditor } from './TableRowsEditor';
import { ObjectPicker } from './ObjectPicker';
import { GroupedPicker } from './GroupedPicker';

// Modules whose "rows" param is a dynamic table grid — gets TableRowsEditor instead
// of the generic one-text-box-per-param grid. The key it owns within that module's
// param schema; everything else (object-name overrides) still renders generically.
const TABLE_ROWS_MODULES = new Set(['AddLineItem']);
const TABLE_ROWS_KEY = 'rows';
const SYSTEM_CONTEXT_RUNTIME: Record<TestSystemContextKey, string> = {
  'sap.url': 'url',
  'sap.urlBase': 'urlBase',
  'sap.username': 'username',
  'sap.password': 'password',
  'runtime.today': 'today',
};
const SYSTEM_CONTEXT_LABELS: Record<TestSystemContextKey, string> = {
  'sap.url': 'SAP target URL',
  'sap.urlBase': 'SAP base URL',
  'sap.username': 'SAP username',
  'sap.password': 'SAP password',
  'runtime.today': 'Current date',
};

function sortModuleCategories(a: string, b: string): number {
  if (a === 'Uncategorized') return 1;
  if (b === 'Uncategorized') return -1;
  if (a === 'Built-In Modules') return -1;
  if (b === 'Built-In Modules') return 1;
  return a.localeCompare(b);
}

interface Props {
  modules: ModuleInfo[];
  initial: ModuleCall | null;
  defaultAppId: string;
  /** runState keys produced by earlier steps in this same test case — see BL-07/TestCaseEditor.computeHandoffKeys. */
  handoffKeys: Set<string>;
  contractInputKeys?: string[];
  /** Column names that actually exist in the workspace's datasets, with the files they come from.
   *  Without these, "Dataset input" offered only the Test's declared contract inputs — which is
   *  empty on a new Test, so the author had to know the column names by heart. */
  datasetColumns?: { name: string; files: string[] }[];
  onSave: (call: ModuleCall) => void;
  onCancel: () => void;
  /** Opens the app-level contextual capture overlay for an object-kind field — see
   *  ObjectPicker's onRequestCapture and App.tsx's ContextualCapturePanel (BL-023 AC4). */
  onRequestCapture?: (request: CaptureRequest) => void;
}

/** Every ${key} referenced in a param value. */
function extractPlaceholderKeys(value: string): string[] {
  return [...value.matchAll(/\$\{([^}]+)\}/g)].map((m) => m[1]);
}

function inferValueBinding(value: string, handoffKeys: Set<string>): TestStepValueBinding {
  const exact = value.match(/^\$\{([^}]+)\}$/)?.[1];
  if (!exact) return { source: 'literal' };
  const system = (Object.entries(SYSTEM_CONTEXT_RUNTIME) as Array<[TestSystemContextKey, string]>).find(([, runtime]) => runtime === exact)?.[0];
  if (system) return { source: 'systemContext', key: system };
  if (handoffKeys.has(exact)) return { source: 'priorOutput', output: exact };
  return { source: 'dataset', key: exact };
}

export function StepEditor({ modules, initial, defaultAppId, handoffKeys, contractInputKeys = [], datasetColumns = [], onSave, onCancel, onRequestCapture }: Props) {
  const [moduleName, setModuleName] = useState(initial?.module ?? modules[0]?.name ?? '');
  const [appId, setAppId] = useState(initial?.appId ?? '');
  const [params, setParams] = useState<Record<string, string>>(initial?.params ?? {});
  const [valueBindings, setValueBindings] = useState<Record<string, TestStepValueBinding>>(initial?.valueBindings ?? {});
  const [genericKey, setGenericKey] = useState('');
  const [objectControls, setObjectControls] = useState<ObjectControl[]>([]);
  // Announced rather than only shown, matching how TestCaseEditor already reports step
  // reordering — a reorder that is only visible is invisible to a screen-reader user.
  const [paramOrderAnnouncement, setParamOrderAnnouncement] = useState('');

  const selected = useMemo(() => modules.find((m) => m.name === moduleName) ?? null, [modules, moduleName]);
  const effectiveAppId = appId || defaultAppId;

  useEffect(() => {
    if (!effectiveAppId) return;
    api
      .listObjects(effectiveAppId)
      .then(setObjectControls)
      .catch(() => setObjectControls([]));
  }, [effectiveAppId]);

  /** Wraps the field's own capture request so the just-saved object shows up in this picker's
   *  options immediately — otherwise it's usable (onChange already filled the value) but
   *  invisible if the tester reopens the dropdown before the next unrelated refetch. */
  function handleRequestCapture(request: CaptureRequest) {
    onRequestCapture?.({
      ...request,
      onCaptured: (name) => {
        request.onCaptured(name);
        api.listObjects(effectiveAppId).then(setObjectControls).catch(() => undefined);
      },
    });
  }

  function setParam(key: string, value: string) {
    setParams((prev) => ({ ...prev, [key]: value }));
  }

  /**
   * BL-042: reorders the step's own parameter list. Only reachable for modules with no
   * descriptor — a described module's fields render in the order its own `describe.params`
   * declares, which is part of the module's contract and identical in every Test that uses it,
   * so it is not a per-step preference to override. The free-form list is different: those keys
   * exist only in this Test's JSON, so their order is genuinely this step's to choose.
   *
   * Persistence comes free and is not a trick: JSON.stringify emits string keys in insertion
   * order, so rebuilding the object in the chosen order is what makes the ordering survive save
   * and reload, with no schema change and no separate ordering field to keep in sync.
   */
  function moveParam(key: string, direction: -1 | 1) {
    setParams((prev) => {
      const keys = Object.keys(prev);
      const from = keys.indexOf(key);
      const to = from + direction;
      if (from === -1 || to < 0 || to >= keys.length) return prev;
      keys.splice(to, 0, ...keys.splice(from, 1));
      const next: Record<string, string> = {};
      for (const k of keys) next[k] = prev[k];
      setParamOrderAnnouncement(`${key} moved to position ${to + 1} of ${keys.length}.`);
      return next;
    });
  }

  function removeParam(key: string) {
    setParams((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
    setValueBindings((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }

  function save() {
    onSave({ module: moduleName, appId: appId || undefined, params, ...(Object.keys(valueBindings).length ? { valueBindings } : {}) });
  }

  function bindingFor(key: string, value: string): TestStepValueBinding {
    return valueBindings[key] ?? inferValueBinding(value, handoffKeys);
  }

  function updateBinding(key: string, binding: TestStepValueBinding) {
    setValueBindings((prev) => ({ ...prev, [key]: binding }));
    if (binding.source === 'literal') setParam(key, '');
    if (binding.source === 'dataset') setParam(key, binding.key ? `\${${binding.key}}` : '');
    if (binding.source === 'systemContext') setParam(key, `\${${SYSTEM_CONTEXT_RUNTIME[binding.key]}}`);
    if (binding.source === 'priorOutput') setParam(key, binding.output ? `\${${binding.output}}` : '');
  }

  function renderValueField(p: ModuleParamDescriptor, value: string) {
    const binding = bindingFor(p.key, value);

    // A timeout, a key name, a dialog title: there is only one possible answer, so asking "where
    // does this value come from" first is a question with one option. One box, no dropdown.
    if (p.literalOnly) {
      return (
        <input
          aria-label={p.label}
          value={value}
          placeholder={p.placeholder}
          onChange={(event) => setParam(p.key, event.target.value)}
        />
      );
    }

    return (
      <div className="step-value-authoring">
        <label htmlFor={`source-${p.key}`}>Value source</label>
        <select
          id={`source-${p.key}`}
          aria-label={`Value source for ${p.label}`}
          value={binding.source}
          onChange={(event) => {
            const source = event.target.value as TestStepValueBinding['source'];
            if (source === 'literal') updateBinding(p.key, { source });
            // Default to the Test's first declared input when it has one. With none declared the
            // field stays empty rather than guessing at one of the workspace's dataset columns.
            if (source === 'dataset') updateBinding(p.key, { source, key: contractInputKeys[0] ?? '' });
            if (source === 'systemContext') updateBinding(p.key, { source, key: 'sap.url' });
            if (source === 'priorOutput') updateBinding(p.key, { source, output: [...handoffKeys][0] ?? '' });
          }}
        >
          <option value="literal">Literal value</option>
          <option value="dataset">Dataset input</option>
          <option value="systemContext">System context</option>
          <option value="priorOutput">Prior step output</option>
        </select>

        {binding.source === 'literal' && (
          <input aria-label={p.label} type="text" value={value} placeholder={p.placeholder} onChange={(event) => setParam(p.key, event.target.value)} />
        )}
        {binding.source === 'dataset' && (
          <>
            <input
              aria-label={`Dataset input for ${p.label}`}
              list={`contract-inputs-${p.key}`}
              value={binding.key}
              placeholder="Declared input name"
              onChange={(event) => updateBinding(p.key, { source: 'dataset', key: event.target.value })}
            />
            {/* Real dataset columns first, each labelled with the file it lives in, then any
                declared contract input that no dataset supplies yet. Still a combobox, so a
                column that does not exist yet can be named ahead of the data. */}
            <datalist id={`contract-inputs-${p.key}`}>
              {datasetColumns.map((column) => (
                <option key={column.name} value={column.name}>{column.files.join(', ')}</option>
              ))}
              {contractInputKeys
                .filter((key) => !datasetColumns.some((column) => column.name === key))
                .map((key) => <option key={key} value={key}>declared input</option>)}
            </datalist>
          </>
        )}
        {binding.source === 'systemContext' && (
          <select
            aria-label={`System context for ${p.label}`}
            value={binding.key}
            onChange={(event) => updateBinding(p.key, { source: 'systemContext', key: event.target.value as TestSystemContextKey })}
          >
            {(Object.keys(SYSTEM_CONTEXT_LABELS) as TestSystemContextKey[]).map((key) => <option key={key} value={key}>{SYSTEM_CONTEXT_LABELS[key]}</option>)}
          </select>
        )}
        {binding.source === 'priorOutput' && (
          <select
            aria-label={`Prior output for ${p.label}`}
            value={binding.output}
            onChange={(event) => updateBinding(p.key, { source: 'priorOutput', output: event.target.value })}
          >
            <option value="">— choose an earlier output —</option>
            {[...handoffKeys].sort().map((key) => <option key={key} value={key}>{key}</option>)}
          </select>
        )}
      </div>
    );
  }

  function renderField(p: ModuleParamDescriptor) {
    const value = params[p.key] ?? '';
    const handoff = extractPlaceholderKeys(value).filter((k) => handoffKeys.has(k));
    return (
      <div key={p.key}>
        <label>
          {p.label}
          {p.required ? ' *' : ''}
        </label>
        {p.objectKind ? (
          <ObjectPicker
            value={value}
            onChange={(v) => setParam(p.key, v)}
            options={objectControls}
            kind={p.objectKind}
            placeholder={p.placeholder}
            module={moduleName}
            paramKey={p.key}
            appId={effectiveAppId || undefined}
            fieldLabel={p.label}
            onRequestCapture={onRequestCapture && effectiveAppId ? handleRequestCapture : undefined}
          />
        ) : renderValueField(p, value)}
        {handoff.length > 0 && (
          <p className="hint" style={{ margin: '0.2rem 0 0' }} title="Resolved from an earlier step in this Test, not a data file column">
            ↩ captured earlier: {handoff.join(', ')}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="panel stack">
      <span className="sr-only" role="status" aria-live="polite">{paramOrderAnnouncement}</span>
      <div className="row">
        <div style={{ flex: 1 }}>
          <label>Module</label>
          <GroupedPicker
            ariaLabel="Module"
            value={moduleName}
            onChange={(name) => {
              setModuleName(name);
              setParams({});
              setValueBindings({});
            }}
            items={modules}
            getKey={(m) => m.name}
            getLabel={(m) => m.describe?.label ?? m.name}
            getGroup={(m) => m.describe?.category || 'Uncategorized'}
            sortGroups={sortModuleCategories}
          />
        </div>
        <div style={{ flex: 1 }}>
          <label>App ID override (optional)</label>
          <input aria-label="App ID override" type="text" value={appId} onChange={(e) => setAppId(e.target.value)} placeholder={defaultAppId || 'inherit default'} />
        </div>
      </div>

      {selected?.describe && <p className="hint">{selected.describe.description}</p>}

      {TABLE_ROWS_MODULES.has(moduleName) ? (
        <>
          <TableRowsEditor
            value={params[TABLE_ROWS_KEY] ?? ''}
            onChange={(v) => setParam(TABLE_ROWS_KEY, v)}
            objectControls={objectControls}
            allowPlaceholderMode
          />
          {selected?.describe && selected.describe.params.some((p) => p.key !== TABLE_ROWS_KEY) && (
            <div style={{ borderTop: '1px solid var(--border)', paddingTop: '0.75rem' }}>
              <p className="section-title">Other options</p>
              <div className="param-grid">{selected.describe.params.filter((p) => p.key !== TABLE_ROWS_KEY).map(renderField)}</div>
            </div>
          )}
        </>
      ) : (
        <div className="param-grid">
          {selected?.describe
            ? selected.describe.params.map(renderField)
            : Object.keys(params).map((key, index, all) => (
                <div key={key}>
                  <label>{key}</label>
                  <div className="row">
                    <input aria-label={key} type="text" value={params[key]} onChange={(e) => setParam(key, e.target.value)} />
                    <button
                      className="ghost icon-only"
                      aria-label={`Move parameter ${key} up`}
                      onClick={() => moveParam(key, -1)}
                      disabled={index === 0}
                    >
                      <ArrowUp size={14} aria-hidden="true" />
                    </button>
                    <button
                      className="ghost icon-only"
                      aria-label={`Move parameter ${key} down`}
                      onClick={() => moveParam(key, 1)}
                      disabled={index === all.length - 1}
                    >
                      <ArrowDown size={14} aria-hidden="true" />
                    </button>
                    <button className="ghost danger" onClick={() => removeParam(key)} title="Remove param">
                      ✕
                    </button>
                  </div>
                </div>
              ))}
        </div>
      )}

      {!TABLE_ROWS_MODULES.has(moduleName) && !selected?.describe && (
        <div className="row">
          <input aria-label="New parameter name" type="text" placeholder="param name" value={genericKey} onChange={(e) => setGenericKey(e.target.value)} />
          <button
            onClick={() => {
              if (!genericKey.trim()) return;
              setParam(genericKey.trim(), '');
              setGenericKey('');
            }}
          >
            Add param
          </button>
          <span className="hint">No schema for this module yet — add whatever params it needs.</span>
        </div>
      )}

      <div className="row" style={{ borderTop: '1px solid var(--border)', paddingTop: '0.75rem' }}>
        <button className="primary" onClick={save}>
          Save step
        </button>
        <button onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}
