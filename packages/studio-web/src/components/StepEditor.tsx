import { useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { api } from '../api';
import type { CaptureRequest, ModuleCall, ModuleInfo, ModuleParamDescriptor, ObjectControl, TestStepValueBinding, TestSystemContextKey } from '../types';
import { TableRowsEditor } from './TableRowsEditor';
import { ObjectPicker } from './ObjectPicker';
import { GroupedPicker } from './GroupedPicker';
import { ValuePicker, type ValueOption } from './ValuePicker';

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
/**
 * `sap.url` and `sap.urlBase` resolve from the SAME configured target — the only difference is
 * that urlBase has trailing slashes stripped (executionPlanRuntime.ts: `url.replace(/\/+$/, '')`).
 * "target URL" vs "base URL" implied a semantic split that does not exist and left the author
 * guessing, so the labels now say what actually differs: use urlBase when concatenating a path
 * onto it, which is why create-so.json's NavigateToApp reads `${urlBase}/ui#...`.
 */
const SYSTEM_CONTEXT_LABELS: Record<TestSystemContextKey, string> = {
  'sap.url': 'SAP target URL — exactly as configured',
  'sap.urlBase': 'SAP target URL — no trailing slash, for building a link',
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
  /** Screens this step's App ID has been captured from — see the appUrl field below. */
  const [entryPoints, setEntryPoints] = useState<{ url: string; template: string; appId?: string }[]>([]);
  // Announced rather than only shown, matching how TestCaseEditor already reports step
  // reordering — a reorder that is only visible is invisible to a screen-reader user.
  const [paramOrderAnnouncement, setParamOrderAnnouncement] = useState('');

  const selected = useMemo(() => modules.find((m) => m.name === moduleName) ?? null, [modules, moduleName]);
  const effectiveAppId = appId || defaultAppId;

  useEffect(() => {
    if (!effectiveAppId) {
      setObjectControls([]);
      return;
    }
    api
      .listObjects(effectiveAppId)
      .then(setObjectControls)
      .catch(() => setObjectControls([]));
  }, [effectiveAppId]);

  /**
   * Entry points for this step's App ID — or, when it has none yet, every known screen.
   *
   * NavigateToApp is normally the FIRST step in a Test, authored before anything has said which
   * app the Test is for, so scoping strictly to the App ID left the field empty exactly when it
   * was most useful and sent the author back to typing a launchpad URL. Falling back to all of
   * them keeps the offer available; once the App ID is set the list narrows to that app's own.
   */
  useEffect(() => {
    const load = effectiveAppId
      ? api.listAppEntryPoints(effectiveAppId).then((entries) => entries.map((e) => ({ ...e, appId: effectiveAppId })))
      : api.listAllAppEntryPoints();
    load.then(setEntryPoints).catch(() => setEntryPoints([]));
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
    // Drop params the author cleared back to empty where the descriptor declares a default:
    // absent and "" mean the same thing to the module, and absent is what keeps the Test free
    // of values nobody chose. Params with no declared default are left exactly as typed.
    const described = new Map((selected?.describe?.params ?? []).map((p) => [p.key, p]));
    const persisted: Record<string, string> = {};
    for (const [key, value] of Object.entries(params)) {
      if (value === '' && described.get(key)?.default !== undefined) continue;
      persisted[key] = value;
    }
    onSave({ module: moduleName, appId: appId || undefined, params: persisted, ...(Object.keys(valueBindings).length ? { valueBindings } : {}) });
  }

  /**
   * Everything a step value can be bound to, grouped by where it comes from.
   *
   * Dataset columns group BY FILE rather than into one "Dataset" bucket: the workspace's three
   * CSVs already share eight column names — `quantity` is in all three — so a flat list cannot
   * say which file a column belongs to, and that ambiguity gets worse with every dataset added,
   * not better.
   */
  const valueOptions = useMemo<ValueOption[]>(() => {
    const options: ValueOption[] = [];
    const byFile = new Map<string, { name: string; files: string[] }[]>();
    for (const column of datasetColumns) {
      for (const file of column.files.length ? column.files : ['(no file)']) {
        (byFile.get(file) ?? byFile.set(file, []).get(file)!).push(column);
      }
    }
    for (const file of [...byFile.keys()].sort()) {
      for (const column of byFile.get(file)!) {
        options.push({
          source: 'dataset',
          key: column.name,
          label: column.name,
          detail: column.files.length > 1 ? `also in ${column.files.filter((f) => f !== file).join(', ')}` : undefined,
          group: `Dataset column · ${file}`,
        });
      }
    }
    // Contract inputs no dataset supplies yet — still bindable, so a column can be named ahead
    // of the data that will carry it.
    for (const key of contractInputKeys) {
      if (datasetColumns.some((c) => c.name === key)) continue;
      options.push({ source: 'dataset', key, label: key, detail: 'declared input, no dataset yet', group: 'Dataset column · declared only' });
    }
    for (const key of Object.keys(SYSTEM_CONTEXT_LABELS) as TestSystemContextKey[]) {
      options.push({ source: 'systemContext', key, label: SYSTEM_CONTEXT_LABELS[key], group: 'System value' });
    }
    for (const key of [...handoffKeys].sort()) {
      options.push({ source: 'priorOutput', key, label: key, group: 'Captured by an earlier step' });
    }
    return options;
  }, [datasetColumns, contractInputKeys, handoffKeys]);

  /** An `appUrl` param additionally offers the screens this App ID has been captured from.
   *  They are LITERAL suggestions, not bindings — picking one fills the box with the portable
   *  ${urlBase}/ui#… form and the value stays a plain literal. */
  const entryPointOptions = useMemo<ValueOption[]>(
    () => entryPoints.map((entry) => ({
      source: 'literal' as const,
      key: entry.template,
      label: entry.template,
      detail: entry.url,
      // When the step has no App ID yet the list spans apps, so each entry has to say which.
      group: effectiveAppId ? 'Screen captured for this App ID' : `Screen captured for ${entry.appId ?? 'another app'}`,
    })),
    [entryPoints, effectiveAppId],
  );

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

  /**
   * Soft fill: a param the author has not touched shows its module default AS THE VALUE, muted,
   * rather than as a placeholder hint. "Reference capture key: automationReference" answers what
   * the field will actually do; an empty box with grey ghost text does not.
   *
   * It stays soft — `isSoft` params are stripped in save(), so the Test records only what the
   * author decided. Writing the default in would pin every Test to today's value and make a
   * later change to that default silently not apply to anything already authored.
   */
  function isSet(p: ModuleParamDescriptor): boolean {
    const v = params[p.key];
    return v !== undefined && v !== '';
  }
  function isSoft(p: ModuleParamDescriptor): boolean {
    return !isSet(p) && p.default !== undefined;
  }
  function shownValue(p: ModuleParamDescriptor): string {
    return isSet(p) ? params[p.key] : (p.default ?? '');
  }

  function renderValueField(p: ModuleParamDescriptor, value: string) {
    const binding = bindingFor(p.key, value);
    const soft = isSoft(p);

    // A checkbox or a two-option select has nowhere to PUT a ${placeholder}: rendering one for a
    // value that already holds a binding would show it as unchecked/default and then write that
    // back over the binding the moment the step is saved. So a param that is currently bound
    // keeps the general text+chip control regardless of its declared type. Typed rendering is a
    // presentation choice; it must never be able to destroy a value.
    const isBound = /^\$\{[^}]+\}$/.test(value);

    // A checkbox, a select over two options: there is one possible shape of answer and nowhere to
    // put a ${placeholder}, so these never ask "where does this value come from".
    if (p.type === 'boolean' && !isBound) {
      const on = shownValue(p) === 'true';
      return (
        <label className={`step-check${soft ? ' is-soft' : ''}`}>
          <input
            type="checkbox"
            aria-label={p.label}
            checked={on}
            onChange={(event) => setParam(p.key, event.target.checked ? 'true' : 'false')}
          />
          <span>{on ? 'Yes' : 'No'}{soft ? ' (default)' : ''}</span>
        </label>
      );
    }

    if (p.type === 'enum' && p.options?.length && !isBound) {
      // First option is the default, and an unset param means exactly that — so the select
      // shows it without writing it, keeping the saved Test free of redundant params.
      return (
        <select
          className={value ? undefined : 'is-soft'}
          aria-label={p.label}
          value={value || p.default || p.options[0]}
          onChange={(event) => setParam(p.key, event.target.value)}
        >
          {p.options.map((option, i) => (
            <option key={option} value={option}>{i === 0 ? `${option} (default)` : option}</option>
          ))}
        </select>
      );
    }

    if (p.literalOnly) {
      return (
        <input
          className={soft ? 'is-soft' : undefined}
          aria-label={p.label}
          type={p.type === 'number' ? 'number' : 'text'}
          value={shownValue(p)}
          placeholder={p.placeholder}
          onChange={(event) => setParam(p.key, event.target.value)}
        />
      );
    }

    // Everything else: ONE control. Picking a dataset column, a system value or an earlier
    // step's output IS the binding; typing is what makes a value literal. Splitting those into
    // a source chip plus a separate box let a column name be typed while the source was still
    // Literal — a value that looks filled in, publishes clean, and silently reaches evidence.
    return (
      <ValuePicker
        value={value}
        binding={binding}
        ariaLabel={p.label}
        placeholder={p.placeholder}
        soft={soft}
        numeric={p.type === 'number'}
        options={p.type === 'appUrl' ? [...entryPointOptions, ...valueOptions] : valueOptions}
        onLiteral={(text) => {
          setValueBindings((prev) => {
            const next = { ...prev };
            delete next[p.key];
            return next;
          });
          setParam(p.key, text);
        }}
        onBind={(next) => updateBinding(p.key, next)}
      />
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
            /* An object param with a default shows it the way every other defaulted field does.
               As a PLACEHOLDER rather than a soft value, though: ObjectPicker filters its own
               option list by whatever is in the box, so seeding "AddLineItemButton" as a value
               would hide every other clickable object until the author cleared it — the opposite
               of helpful. An empty box reading AddLineItemButton says the same thing and leaves
               the list whole. `default` wins over `placeholder`, which for these params was the
               redundant "default: AddLineItemButton". */
            placeholder={p.default ?? p.placeholder}
            soft={isSoft(p)}
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

  /**
   * Orders a described module's fields by how much attention each actually needs, instead of
   * giving all of them the same weight in a two-column grid.
   *
   * Required first, then optional-but-meaningful, then everything marked `advanced` folded into
   * a closed <details>. The split is deliberately by `advanced` and not by `required`: an
   * optional param the author has to think about (a dialog title to expect, a run-state key a
   * later step reads) stays in the main form, because hiding those is how the 14 Aug 2026
   * observed run silently lost `dialogTitles`. Only params whose default is the answer you'd
   * want anyway get collapsed.
   */
  function renderDescribedParams(all: ModuleParamDescriptor[]) {
    const main = all.filter((p) => !p.advanced);
    const advanced = all.filter((p) => p.advanced);
    const required = main.filter((p) => p.required);
    const optional = main.filter((p) => !p.required);
    // The collapsed row has to say what is inside AND that it is already settled, or it reads as
    // an unanswered question. "Options (3)" is a closed box; "Using defaults · max length 16" is
    // a statement of what the step will do. Parentheticals are dropped (they carry the SAP type
    // name, not the meaning) and booleans read yes/no.
    const changed = advanced.filter(isSet);
    const summary = advanced
      .map((p) => {
        const short = p.label.replace(/\s*\([^)]*\)/g, '').replace(/\s+instead of.*$/i, '').trim();
        const raw = shownValue(p);
        const shown = p.type === 'boolean' ? (raw === 'true' ? 'yes' : 'no') : raw || '—';
        return `${short} ${shown}${isSet(p) ? ' (changed)' : ''}`;
      })
      .join(' · ');
    const heading = changed.length === 0
      ? `Using defaults (${advanced.length})`
      : `Defaults (${advanced.length}) · ${changed.length} changed`;

    return (
      <>
        {required.length > 0 && <div className="param-grid">{required.map(renderField)}</div>}
        {optional.length > 0 && <div className="param-grid">{optional.map(renderField)}</div>}
        {advanced.length > 0 && (
          <details className="step-advanced" open={changed.length > 0}>
            <summary>
              <span>{heading}</span>
              <small>{summary}</small>
            </summary>
            <div className="param-grid">{advanced.map(renderField)}</div>
          </details>
        )}
      </>
    );
  }

  return (
    <div className="panel stack step-editor">
      <span className="sr-only" role="status" aria-live="polite">{paramOrderAnnouncement}</span>
      <div className="step-editor-head">
        <div>
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
        <div>
          {/* "(optional)" dropped: it wrapped the label onto two lines, and the placeholder
              already says "inherit default", which makes the same point in the same glance. */}
          <label>App ID override</label>
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
          {selected?.describe && renderDescribedParams(selected.describe.params.filter((p) => p.key !== TABLE_ROWS_KEY))}
        </>
      ) : selected?.describe ? (
        renderDescribedParams(selected.describe.params)
      ) : (
        <div className="param-grid">
          {Object.keys(params).map((key, index, all) => (
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
