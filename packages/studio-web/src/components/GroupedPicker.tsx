import { useEffect, useRef, useState } from 'react';

interface GroupedPickerProps<T> {
  value: string;
  onChange: (key: string) => void;
  items: T[];
  getKey: (item: T) => string;
  getLabel: (item: T) => string;
  getGroup: (item: T) => string;
  sortGroups?: (a: string, b: string) => number;
  placeholder?: string;
  ariaLabel?: string;
}

/**
 * A collapsible grouped dropdown: each group starts collapsed (name + count only),
 * so opening the picker doesn't dump every item across every group on screen at
 * once — you expand only the group you're looking in. The group containing the
 * current selection starts expanded, so re-opening an already-selected item doesn't
 * require re-discovering which group it's under. Generic over T so the same tree UI
 * serves both file pickers (test cases/groups/datasets, grouped by BL-10's
 * processArea tag) and the module picker (grouped by each module's own category).
 */
export function GroupedPicker<T>({ value, onChange, items, getKey, getLabel, getGroup, sortGroups, placeholder, ariaLabel }: GroupedPickerProps<T>) {
  const [open, setOpen] = useState(false);
  const selectedItem = items.find((item) => getKey(item) === value);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(selectedItem ? [getGroup(selectedItem)] : []));
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const groups = items.reduce<Record<string, T[]>>((acc, item) => {
    const g = getGroup(item);
    (acc[g] ??= []).push(item);
    return acc;
  }, {});
  const groupNames = Object.keys(groups).sort(sortGroups);

  function toggle(group: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(group)) next.delete(group);
      else next.add(group);
      return next;
    });
  }

  function select(key: string) {
    onChange(key);
    setOpen(false);
  }

  return (
    <div ref={containerRef} style={{ position: 'relative' }}>
      <button
        type="button"
        className="ghost"
        style={{ width: '100%', textAlign: 'left', border: '1px solid var(--border)' }}
        onClick={() => setOpen((o) => !o)}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        {selectedItem ? getLabel(selectedItem) : placeholder || '— select —'}
      </button>
      {open && (
        <div
          className="panel"
          style={{ position: 'absolute', top: 'calc(100% + 0.2rem)', left: 0, right: 0, zIndex: 20, maxHeight: '20rem', overflowY: 'auto', padding: '0.3rem' }}
        >
          {groupNames.length === 0 && <p className="hint" style={{ margin: '0.3rem 0.5rem' }}>Nothing here yet.</p>}
          {groupNames.map((group) => (
            <div key={group}>
              <div
                className="row"
                style={{ padding: '0.3rem 0.4rem', cursor: 'pointer', alignItems: 'center', gap: '0.4rem', fontWeight: 600, borderRadius: '4px' }}
                onClick={() => toggle(group)}
              >
                <span style={{ width: '1rem', display: 'inline-block' }}>{expanded.has(group) ? '▾' : '▸'}</span>
                <span style={{ flex: 1 }}>{group}</span>
                <span className="hint">{groups[group].length}</span>
              </div>
              {expanded.has(group) &&
                groups[group].map((item) => {
                  const key = getKey(item);
                  return (
                    <div
                      key={key}
                      className="row"
                      style={{
                        padding: '0.3rem 0.4rem 0.3rem 2rem',
                        cursor: 'pointer',
                        borderRadius: '4px',
                        background: key === value ? 'var(--accent-soft)' : undefined,
                      }}
                      onClick={() => select(key)}
                    >
                      {getLabel(item)}
                    </div>
                  );
                })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
