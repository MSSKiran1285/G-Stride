import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { TestStepValueBinding, TestSystemContextKey } from '../types';

/**
 * One control for a step parameter's value, replacing the "choose a source, then name a column"
 * pair.
 *
 * Those were two separate silent acts, and getting the first one wrong was invisible: on
 * 16 Aug 2026 an observed run saved CreateAutomationRunReference with
 * `prefix: "automationReference"` — the column name typed into the box while the source was
 * still Literal. It reads as filled in, publishes clean (a literal is by definition valid), and
 * puts the string "automationOwner" into signed evidence where the accountable owner should be.
 *
 * Here, picking a dataset column IS the binding, so that state cannot be reached. Typing is what
 * makes a value literal, which is the one thing a free-text box already communicates well.
 *
 * Grouping by source and by file is also what makes this survive growth: the workspace's three
 * datasets already share eight column names — `quantity` exists in all three — so a flat list
 * cannot say which file a column came from, and there is no length at which that gets better.
 */

export interface ValueOption {
  /** `literal` is a suggested fixed value rather than a binding — a screen this App ID has
   *  actually been captured from, say. Picking one fills the box; it stays a literal. */
  source: 'dataset' | 'systemContext' | 'priorOutput' | 'literal';
  /** The binding key — a column name, a system-context key, or an earlier step's output. */
  key: string;
  label: string;
  /** Where it comes from, e.g. the files a column appears in. */
  detail?: string;
  group: string;
}

interface Props {
  value: string;
  binding: TestStepValueBinding;
  ariaLabel: string;
  placeholder?: string;
  /** The param has a module default and is not overridden — styled as a soft value. */
  soft?: boolean;
  numeric?: boolean;
  options: ValueOption[];
  onLiteral: (text: string) => void;
  onBind: (binding: TestStepValueBinding) => void;
}

const SOURCE_TAG: Record<TestStepValueBinding['source'], string> = {
  literal: 'literal',
  dataset: 'dataset',
  systemContext: 'system',
  priorOutput: 'earlier step',
};

/** What the box shows: a literal shows itself, a binding shows the thing it is bound to. */
function displayText(value: string, binding: TestStepValueBinding): string {
  if (binding.source === 'literal') return value;
  if (binding.source === 'dataset') return binding.key ?? '';
  if (binding.source === 'systemContext') return binding.key ?? '';
  return binding.output ?? '';
}

export function ValuePicker({ value, binding, ariaLabel, placeholder, soft, numeric, options, onLiteral, onBind }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [anchor, setAnchor] = useState<{ top: number; left: number; width: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const shown = query ?? displayText(value, binding);

  // Same portal treatment as ObjectPicker: an absolutely-positioned panel is clipped by any
  // scrolling ancestor, and these fields sit inside a dialog and sometimes inside a table.
  useEffect(() => {
    if (!open) return;
    const measure = () => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (rect) setAnchor({ top: rect.bottom + 3, left: rect.left, width: rect.width });
    };
    measure();
    window.addEventListener('scroll', measure, true);
    window.addEventListener('resize', measure);
    return () => {
      window.removeEventListener('scroll', measure, true);
      window.removeEventListener('resize', measure);
    };
  }, [open]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      const target = e.target as Node;
      if (containerRef.current?.contains(target) || dropdownRef.current?.contains(target)) return;
      setOpen(false);
      setQuery(null);
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const needle = (query ?? '').trim().toLowerCase();
  const matches = needle
    ? options.filter((o) => o.label.toLowerCase().includes(needle) || (o.detail ?? '').toLowerCase().includes(needle))
    : options;
  const groups: { group: string; items: ValueOption[] }[] = [];
  for (const option of matches) {
    const last = groups[groups.length - 1];
    if (last && last.group === option.group) last.items.push(option);
    else groups.push({ group: option.group, items: [option] });
  }
  const flat = groups.flatMap((g) => g.items);

  function choose(option: ValueOption) {
    if (option.source === 'literal') onLiteral(option.key);
    else if (option.source === 'dataset') onBind({ source: 'dataset', key: option.key });
    else if (option.source === 'systemContext') onBind({ source: 'systemContext', key: option.key as TestSystemContextKey });
    else onBind({ source: 'priorOutput', output: option.key });
    setQuery(null);
    setOpen(false);
  }

  return (
    <div className="value-picker" ref={containerRef}>
      <span className={`value-picker-tag kind-${binding.source}`}>{SOURCE_TAG[binding.source]}</span>
      <input
        className={soft && !value ? 'is-soft' : undefined}
        type={numeric && binding.source === 'literal' ? 'number' : 'text'}
        aria-label={ariaLabel}
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        value={shown}
        placeholder={placeholder}
        onFocus={() => setOpen(true)}
        onChange={(event) => {
          // Typing is what makes a value literal. Picking from the list is what binds it —
          // there is no way to be "on literal" while naming a column.
          setQuery(event.target.value);
          setActiveIndex(0);
          setOpen(true);
          onLiteral(event.target.value);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            if (open) {
              event.preventDefault();
              event.stopPropagation();
            }
            setOpen(false);
            setQuery(null);
          } else if (event.key === 'ArrowDown') {
            event.preventDefault();
            setOpen(true);
            setActiveIndex((i) => Math.min(i + 1, flat.length - 1));
          } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            setActiveIndex((i) => Math.max(i - 1, 0));
          } else if (event.key === 'Enter' && open && flat[activeIndex]) {
            event.preventDefault();
            choose(flat[activeIndex]);
          }
        }}
      />
      {open && anchor && flat.length > 0 && createPortal(
        <div
          ref={dropdownRef}
          className="panel value-picker-dropdown"
          style={{ position: 'fixed', top: anchor.top, left: anchor.left, minWidth: anchor.width, zIndex: 120 }}
        >
          <p className="value-picker-hint">Pick a value to bind it — or keep typing to use what you typed literally.</p>
          {groups.map(({ group, items }) => (
            <div key={group} className="value-picker-group">
              <p className="value-picker-group-label">{group}</p>
              {items.map((option) => {
                const index = flat.indexOf(option);
                const selected = binding.source === option.source && displayText(value, binding) === option.key;
                return (
                  <button
                    type="button"
                    key={`${option.source}:${option.key}:${option.group}`}
                    className={`value-picker-option${index === activeIndex ? ' active' : ''}${selected ? ' selected' : ''}`}
                    onMouseEnter={() => setActiveIndex(index)}
                    onMouseDown={(e) => {
                      e.preventDefault(); // keep focus in the input so it stays editable
                      choose(option);
                    }}
                  >
                    <span className="value-picker-option-label">{option.label}</span>
                    {option.detail && <span className="value-picker-option-detail">{option.detail}</span>}
                  </button>
                );
              })}
            </div>
          ))}
        </div>,
        document.body,
      )}
    </div>
  );
}
