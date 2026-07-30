import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import type { CaptureRequest, ObjectControl, ObjectKind } from '../types';

/**
 * Buckets a captured control into a broad "kind" so a module's param can only suggest
 * controls that actually make sense for it — e.g. "Click Button" shouldn't suggest a
 * table column. Table columns are checked first since a column can otherwise also match
 * a type-name pattern below (a grid table's Column IS also nominally clickable in some
 * apps' headers, but what matters here is that it's addressed via tableCell, not a plain
 * click). Purely a studio-web display concern — doesn't need to match the engine's own
 * classification 1:1, just needs to steer a human toward the right object.
 */
function classifyObjectKind(o: Pick<ObjectControl, 'controlType' | 'tableId'>): ObjectKind {
  if (o.tableId) return 'tableColumn';
  const t = o.controlType ?? '';
  if (/Button|Link|GenericTile|Card|IconTabFilter/.test(t)) return 'clickable';
  if (/CheckBox|Switch|RadioButton/.test(t)) return 'toggleable';
  if (/Input|SearchField|TextArea|SmartField|DatePicker|TimePicker|ComboBox|Select|SFB|DynamicDateRangeInput/.test(t)) return 'fillable';
  if (/Text|Label|Title|ObjectStatus|ObjectNumber/.test(t)) return 'readable';
  return 'fillable'; // unknown types default to the most common case rather than being hidden entirely
}

/** "sap.m.Button" -> "Button" — the same friendly-type convention CurationList uses. */
function friendlyType(controlType: string | null): string {
  return (controlType ?? '').split('.').pop() || '—';
}

/** Wraps the substring of `text` matching `query` (case-insensitive) in a highlight span. */
function highlightMatch(text: string, query: string) {
  if (!query.trim()) return text;
  const i = text.toLowerCase().indexOf(query.trim().toLowerCase());
  if (i === -1) return text;
  return (
    <>
      {text.slice(0, i)}
      <mark style={{ background: 'var(--warning-bg)', color: 'var(--warning)', borderRadius: '2px' }}>{text.slice(i, i + query.trim().length)}</mark>
      {text.slice(i + query.trim().length)}
    </>
  );
}

interface ObjectPickerProps {
  value: string;
  onChange: (value: string) => void;
  options: ObjectControl[];
  kind?: ObjectKind[];
  placeholder?: string;
  /** When both are given, options already used for this exact module+param combination
   * in some other saved test case get a "used" badge and sort to the top — a fact
   * (real prior usage), not a guess, so it's a safer disambiguator than ranking by
   * relevance heuristics that could be wrong. */
  module?: string;
  paramKey?: string;
  /** The App ID this field's objects belong to — required for "Capture a new object" below
   *  to know where a newly captured control should be saved. Omit to hide that action. */
  appId?: string;
  /** Human description of this field for the capture overlay's header, e.g. "Control name for
   *  Click Button" — falls back to placeholder if not given. */
  fieldLabel?: string;
  /** Opens the app-level contextual capture overlay (BL-023 AC4) instead of navigating away
   *  from Compose. Omit to hide the "Capture a new object" action entirely. */
  onRequestCapture?: (request: CaptureRequest) => void;
}

/**
 * Replaces the native <input list>/<datalist> combo, which had two real problems:
 * once a suggestion was chosen, editability got flaky (browser-dependent datalist
 * quirks), and it had no way to filter suggestions by "kind" — every object for the
 * App ID showed up regardless of whether it made sense for this param. This is a
 * fully custom combobox: always freely editable, filtered by kind first, then by
 * whatever's typed, and closing on blur/Escape/selection rather than relying on
 * native datalist behavior. Each row also shows its control type (two same-labeled
 * objects, e.g. two "Create" buttons, are still distinguishable) and a one-click
 * "highlight on screen" action — the only fully reliable disambiguator when text
 * alone still leaves two options looking identical.
 */
export function ObjectPicker({ value, onChange, options, kind, placeholder, module, paramKey, appId, fieldLabel, onRequestCapture }: ObjectPickerProps) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [highlightingName, setHighlightingName] = useState<string | null>(null);
  const [notFoundName, setNotFoundName] = useState<string | null>(null);
  const [usedNames, setUsedNames] = useState<Set<string>>(new Set());
  // Escape hatch for classifyObjectKind's client-side heuristic getting a control wrong
  // (e.g. an oddly-named button not matching the /Button|Link/../ pattern) — rather than
  // a control silently never showing up with no way to find out why, one click reveals
  // the full unfiltered list.
  const [showHiddenAnyway, setShowHiddenAnyway] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (!module || !paramKey) return;
    api
      .getModuleUsage(module, paramKey)
      .then((names) => setUsedNames(new Set(names)))
      .catch(() => setUsedNames(new Set()));
  }, [module, paramKey]);

  const kindFiltered = kind && !showHiddenAnyway ? options.filter((o) => kind.includes(classifyObjectKind(o))) : options;
  const textFiltered = (
    value.trim()
      ? kindFiltered.filter(
          (o) => o.name.toLowerCase().includes(value.trim().toLowerCase()) || (o.label ?? '').toLowerCase().includes(value.trim().toLowerCase())
        )
      : kindFiltered
  ).sort((a, b) => {
    const aUsed = usedNames.has(a.name) ? 0 : 1;
    const bUsed = usedNames.has(b.name) ? 0 : 1;
    return aUsed !== bUsed ? aUsed - bUsed : a.name.localeCompare(b.name);
  });

  const hiddenByKindCount = kind && !showHiddenAnyway ? options.length - kindFiltered.length : 0;

  function select(name: string) {
    onChange(name);
    setOpen(false);
  }

  function requestCapture() {
    if (!onRequestCapture || !appId) return;
    setOpen(false);
    onRequestCapture({ appId, kind, fieldLabel: fieldLabel || placeholder || 'this field', onCaptured: select });
  }

  async function highlight(o: ObjectControl) {
    setHighlightingName(o.name);
    setNotFoundName(null);
    try {
      const result = await api.highlightControl(o.controlId);
      if (!result.found) setNotFoundName(o.name);
    } catch {
      setNotFoundName(o.name);
    } finally {
      setHighlightingName(null);
    }
  }

  return (
    <div className="row" style={{ flexWrap: 'nowrap', gap: '0.4rem', alignItems: 'flex-start' }}>
    <div ref={containerRef} style={{ position: 'relative', flex: 1, minWidth: 0 }}>
      <input
        type="text"
        aria-label={placeholder || 'Object name'}
        value={value}
        placeholder={placeholder}
        onChange={(e) => {
          onChange(e.target.value);
          setActiveIndex(0);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        // Every actionable row/button inside the dropdown (select, highlight, capture) calls
        // preventDefault() on mousedown specifically so it never triggers this blur first —
        // without it, a typed value with no matches (or the ever-present "+ Capture" row) could
        // leave the dropdown open indefinitely, visually covering whatever control sits below it.
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setOpen(false);
          else if (e.key === 'ArrowDown') {
            e.preventDefault();
            setOpen(true);
            setActiveIndex((i) => Math.min(i + 1, textFiltered.length - 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActiveIndex((i) => Math.max(i - 1, 0));
          } else if (e.key === 'Enter' && open && textFiltered[activeIndex]) {
            e.preventDefault();
            select(textFiltered[activeIndex].name);
          }
        }}
      />
      {open && (textFiltered.length > 0 || hiddenByKindCount > 0) && (
        <div
          className="panel"
          style={{
            position: 'absolute',
            top: 'calc(100% + 0.2rem)',
            left: 0,
            zIndex: 20,
            minWidth: '100%',
            width: 'max-content',
            maxWidth: 'min(38rem, 90vw)',
            maxHeight: '16rem',
            overflowY: 'auto',
            padding: '0.3rem',
          }}
        >
          {textFiltered.map((o, i) => (
            <div
              key={o.name}
              className="row"
              style={{
                padding: '0.35rem 0.5rem',
                cursor: 'pointer',
                alignItems: 'center',
                gap: '0.6rem',
                borderRadius: '4px',
                flexWrap: 'nowrap',
                background: i === activeIndex ? 'var(--accent-soft)' : undefined,
              }}
              onMouseEnter={() => setActiveIndex(i)}
              onMouseDown={(e) => {
                e.preventDefault(); // keep focus on the input so it stays editable immediately after
                select(o.name);
              }}
            >
              <span
                style={{ fontWeight: 600, flex: '1 1 auto', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
                title={o.name}
              >
                {highlightMatch(o.name, value)}
              </span>
              {usedNames.has(o.name) && (
                <span className="badge informational" style={{ flex: '0 0 auto' }} title="Used for this exact module+param in another saved test case">
                  used
                </span>
              )}
              <span className="hint" style={{ fontFamily: 'monospace', flex: '0 0 auto', whiteSpace: 'nowrap' }}>
                {friendlyType(o.controlType)}
              </span>
              <span
                className="hint"
                style={{ flex: '0 0 auto', maxWidth: '10rem', textAlign: 'right', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
                title={o.label ?? undefined}
              >
                {o.label ? highlightMatch(o.label, value) : '—'}
              </span>
              <button
                className="ghost caution"
                style={{ flex: '0 0 auto' }}
                disabled={highlightingName === o.name}
                onMouseDown={(e) => {
                  e.preventDefault(); // keep focus on the input so blur doesn't close the dropdown before the click registers
                  e.stopPropagation();
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  highlight(o);
                }}
                title="Flash this control on the live screen — needs an open scan session"
              >
                {highlightingName === o.name ? '…' : '⚑'}
              </button>
            </div>
          ))}
          {notFoundName && (
            <p className="error-text" style={{ margin: '0.2rem 0.5rem' }}>
              "{notFoundName}" not found on screen right now — is a scan session open on this app?
            </p>
          )}
          {textFiltered.length === 0 && hiddenByKindCount > 0 && (
            <p className="hint" style={{ margin: '0.3rem 0.5rem' }}>
              No matching objects of this kind.
            </p>
          )}
          {hiddenByKindCount > 0 && (
            <div
              className="row"
              style={{ margin: '0.3rem 0.5rem 0.1rem', borderTop: '1px solid var(--border)', paddingTop: '0.3rem', alignItems: 'center' }}
            >
              <span className="hint" style={{ flex: 1 }}>
                {hiddenByKindCount} other object{hiddenByKindCount === 1 ? '' : 's'} hidden — wrong kind for this field
              </span>
              <button
                className="ghost"
                onMouseDown={(e) => e.preventDefault()}
                onClick={(e) => {
                  e.stopPropagation();
                  setShowHiddenAnyway(true);
                }}
              >
                Show anyway
              </button>
            </div>
          )}
          {showHiddenAnyway && kind && (
            <p className="hint" style={{ margin: '0.2rem 0.5rem 0' }}>
              Showing every object for this App ID, including the wrong kind for this field.
            </p>
          )}
        </div>
      )}
    </div>
    {onRequestCapture && appId && (
      // Deliberately NOT inside the dropdown: that panel is absolutely positioned and can
      // visually cover whatever sits below it while open, which would make this button
      // unreachable (both to a real click and to Playwright's hit-testing) exactly when
      // the tester needs it most — right after typing a name with no existing match.
      <button
        type="button"
        className="ghost"
        style={{ flexShrink: 0, whiteSpace: 'nowrap' }}
        onClick={requestCapture}
        title={`Capture a new object for ${appId}`}
      >
        + Capture
      </button>
    )}
    </div>
  );
}
