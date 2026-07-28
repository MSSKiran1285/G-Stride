import { useState } from 'react';

interface FileChainPickerProps {
  availableLabel: string;
  selectedLabel: string;
  items: string[];
  selected: string[];
  onChange: (next: string[]) => void;
}

/** Two-column picker: filterable available list on the left, ordered selection with move/remove on the right. */
export function FileChainPicker({ availableLabel, selectedLabel, items, selected, onChange }: FileChainPickerProps) {
  const [filter, setFilter] = useState('');
  const filteredItems = items.filter((f) => f.toLowerCase().includes(filter.toLowerCase()));

  function add(item: string) {
    if (selected.includes(item)) return;
    onChange([...selected, item]);
  }

  function remove(item: string) {
    onChange(selected.filter((f) => f !== item));
  }

  function move(index: number, dir: -1 | 1) {
    const target = index + dir;
    if (target < 0 || target >= selected.length) return;
    const next = [...selected];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  }

  return (
    <div className="row">
      <div style={{ flex: 1 }}>
        <label>{availableLabel}</label>
        <input aria-label={`Filter ${availableLabel.toLowerCase()}`} type="text" placeholder="Filter…" value={filter} onChange={(e) => setFilter(e.target.value)} style={{ marginBottom: '0.4rem' }} />
        <ul className="chain-list">
          {filteredItems.map((f) => (
            <li key={f}>
              <span style={{ flex: 1 }}>{f}</span>
              <button className="ghost" aria-label={`Add ${f} to ${selectedLabel}`} onClick={() => add(f)} disabled={selected.includes(f)}>
                + Add
              </button>
            </li>
          ))}
          {filteredItems.length === 0 && <li className="hint">No matches.</li>}
        </ul>
      </div>
      <div style={{ flex: 1 }}>
        <label>{selectedLabel}</label>
        <ul className="chain-list">
          {selected.map((f, i) => (
            <li key={f}>
              <span className="step-index">{i + 1}</span>
              <span style={{ flex: 1 }}>{f}</span>
              <button className="ghost" aria-label={`Move ${f} up`} onClick={() => move(i, -1)} disabled={i === 0}>
                ↑
              </button>
              <button className="ghost" aria-label={`Move ${f} down`} onClick={() => move(i, 1)} disabled={i === selected.length - 1}>
                ↓
              </button>
              <button className="ghost danger" aria-label={`Remove ${f} from ${selectedLabel}`} onClick={() => remove(f)}>
                ✕
              </button>
            </li>
          ))}
          {selected.length === 0 && <li className="hint">Nothing selected yet.</li>}
        </ul>
      </div>
    </div>
  );
}
