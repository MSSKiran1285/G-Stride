import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import type { ModuleCall, ModuleInfo, ModuleParamDescriptor, ObjectControl } from '../types';
import { TableRowsEditor } from './TableRowsEditor';
import { ObjectPicker } from './ObjectPicker';
import { GroupedPicker } from './GroupedPicker';

// Modules whose "rows" param is a dynamic table grid — gets TableRowsEditor instead
// of the generic one-text-box-per-param grid. The key it owns within that module's
// param schema; everything else (object-name overrides) still renders generically.
const TABLE_ROWS_MODULES = new Set(['AddLineItem']);
const TABLE_ROWS_KEY = 'rows';

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
  onSave: (call: ModuleCall) => void;
  onCancel: () => void;
}

/** Every ${key} referenced in a param value. */
function extractPlaceholderKeys(value: string): string[] {
  return [...value.matchAll(/\$\{([^}]+)\}/g)].map((m) => m[1]);
}

export function StepEditor({ modules, initial, defaultAppId, handoffKeys, onSave, onCancel }: Props) {
  const [moduleName, setModuleName] = useState(initial?.module ?? modules[0]?.name ?? '');
  const [appId, setAppId] = useState(initial?.appId ?? '');
  const [params, setParams] = useState<Record<string, string>>(initial?.params ?? {});
  const [genericKey, setGenericKey] = useState('');
  const [objectControls, setObjectControls] = useState<ObjectControl[]>([]);

  const selected = useMemo(() => modules.find((m) => m.name === moduleName) ?? null, [modules, moduleName]);
  const effectiveAppId = appId || defaultAppId;

  useEffect(() => {
    if (!effectiveAppId) return;
    api
      .listObjects(effectiveAppId)
      .then(setObjectControls)
      .catch(() => setObjectControls([]));
  }, [effectiveAppId]);

  function setParam(key: string, value: string) {
    setParams((prev) => ({ ...prev, [key]: value }));
  }

  function removeParam(key: string) {
    setParams((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }

  function save() {
    onSave({ module: moduleName, appId: appId || undefined, params });
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
          />
        ) : (
          <input aria-label={p.label} type="text" value={value} placeholder={p.placeholder} onChange={(e) => setParam(p.key, e.target.value)} />
        )}
        {handoff.length > 0 && (
          <p className="hint" style={{ margin: '0.2rem 0 0' }} title="Resolved from an earlier step in this test case, not a data file column">
            ↩ captured earlier: {handoff.join(', ')}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="panel stack">
      <div className="row">
        <div style={{ flex: 1 }}>
          <label>Module</label>
          <GroupedPicker
            ariaLabel="Module"
            value={moduleName}
            onChange={(name) => {
              setModuleName(name);
              setParams({});
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
            : Object.keys(params).map((key) => (
                <div key={key}>
                  <label>{key}</label>
                  <div className="row">
                    <input aria-label={key} type="text" value={params[key]} onChange={(e) => setParam(key, e.target.value)} />
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
