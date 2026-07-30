import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, ChevronRight, Search } from 'lucide-react';

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
 * Searchable grouped listbox. The search field owns the active option so Arrow
 * keys, Home/End, Enter and Escape work without moving focus through every row.
 */
export function GroupedPicker<T>({
  value,
  onChange,
  items,
  getKey,
  getLabel,
  getGroup,
  sortGroups,
  placeholder,
  ariaLabel,
}: GroupedPickerProps<T>) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeKey, setActiveKey] = useState('');
  const selectedItem = items.find((item) => getKey(item) === value);
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(selectedItem ? [getGroup(selectedItem)] : []),
  );
  const containerRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listboxId = useId();

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setActiveKey(value);
    window.requestAnimationFrame(() => searchRef.current?.focus());
  }, [open, value]);

  const groups = useMemo(() => items.reduce<Record<string, T[]>>((result, item) => {
    const group = getGroup(item);
    (result[group] ??= []).push(item);
    return result;
  }, {}), [items, getGroup]);
  const groupNames = Object.keys(groups).sort(sortGroups);
  const normalizedQuery = query.trim().toLowerCase();
  const visibleGroups = groupNames
    .map((group) => ({
      group,
      items: groups[group].filter((item) => getLabel(item).toLowerCase().includes(normalizedQuery)),
    }))
    .filter(({ items: groupItems }) => groupItems.length > 0);
  const visibleItems = visibleGroups.flatMap(({ group, items: groupItems }) => (
    normalizedQuery || expanded.has(group) ? groupItems : []
  ));

  function toggle(group: string) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(group)) next.delete(group);
      else next.add(group);
      return next;
    });
  }

  function select(key: string) {
    onChange(key);
    setOpen(false);
  }

  function moveActive(direction: -1 | 1) {
    if (visibleItems.length === 0) return;
    const currentIndex = visibleItems.findIndex((item) => getKey(item) === activeKey);
    const nextIndex = currentIndex === -1
      ? (direction === 1 ? 0 : visibleItems.length - 1)
      : (currentIndex + direction + visibleItems.length) % visibleItems.length;
    setActiveKey(getKey(visibleItems[nextIndex]));
  }

  function handleSearchKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      moveActive(event.key === 'ArrowDown' ? 1 : -1);
    } else if (event.key === 'Home' && visibleItems.length > 0) {
      event.preventDefault();
      setActiveKey(getKey(visibleItems[0]));
    } else if (event.key === 'End' && visibleItems.length > 0) {
      event.preventDefault();
      setActiveKey(getKey(visibleItems[visibleItems.length - 1]));
    } else if (event.key === 'Enter' && activeKey && visibleItems.some((item) => getKey(item) === activeKey)) {
      event.preventDefault();
      select(activeKey);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      setOpen(false);
    }
  }

  return (
    <div ref={containerRef} className="grouped-picker">
      <button
        type="button"
        className="grouped-picker-trigger"
        onClick={() => setOpen((current) => !current)}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
      >
        <span>{selectedItem ? getLabel(selectedItem) : placeholder || '— select —'}</span>
        <ChevronDown size={15} aria-hidden="true" />
      </button>
      {open && (
        <div className="grouped-picker-popover">
          <label className="grouped-picker-search">
            <Search size={14} aria-hidden="true" />
            <input
              ref={searchRef}
              role="combobox"
              aria-label={`Search ${ariaLabel?.toLowerCase() || 'options'}`}
              aria-autocomplete="list"
              aria-controls={listboxId}
              aria-expanded="true"
              aria-activedescendant={activeKey ? `${listboxId}-${encodeURIComponent(activeKey)}` : undefined}
              type="search"
              value={query}
              onChange={(event) => {
                setQuery(event.currentTarget.value);
                setActiveKey('');
              }}
              onKeyDown={handleSearchKeyDown}
              placeholder="Search…"
            />
          </label>
          <div id={listboxId} className="grouped-picker-listbox" role="listbox" aria-label={ariaLabel}>
            {visibleGroups.length === 0 && <p className="grouped-picker-empty">No matching options.</p>}
            {visibleGroups.map(({ group, items: groupItems }) => (
              <div
                key={group}
                className="grouped-picker-group"
                role="group"
                aria-label={`${group}, ${groupItems.length} options`}
              >
                <button
                  type="button"
                  className="grouped-picker-group-toggle"
                  onClick={() => toggle(group)}
                  aria-expanded={normalizedQuery ? true : expanded.has(group)}
                >
                  {normalizedQuery || expanded.has(group)
                    ? <ChevronDown size={14} aria-hidden="true" />
                    : <ChevronRight size={14} aria-hidden="true" />}
                  <span>{group}</span>
                  <small>{groupItems.length}</small>
                </button>
                {(normalizedQuery || expanded.has(group)) && groupItems.map((item) => {
                  const key = getKey(item);
                  return (
                    <button
                      type="button"
                      key={key}
                      id={`${listboxId}-${encodeURIComponent(key)}`}
                      className={`grouped-picker-option${key === value ? ' selected' : ''}${key === activeKey ? ' active' : ''}`}
                      role="option"
                      aria-selected={key === value}
                      onClick={() => select(key)}
                      onMouseEnter={() => setActiveKey(key)}
                    >
                      <span>{getLabel(item)}</span>
                      {key === value && <Check size={14} aria-hidden="true" />}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
