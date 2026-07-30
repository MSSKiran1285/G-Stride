import { ArrowDown, ArrowUp, Plus, X } from 'lucide-react';
import { useId, useState } from 'react';

interface FileChainPickerProps {
  availableLabel: string;
  selectedLabel: string;
  items: string[];
  selected: string[];
  onChange: (next: string[]) => void;
}

/** Filterable ordered transfer list with keyboard controls and live announcements. */
export function FileChainPicker({ availableLabel, selectedLabel, items, selected, onChange }: FileChainPickerProps) {
  const [filter, setFilter] = useState('');
  const [announcement, setAnnouncement] = useState('');
  const statusId = useId();
  const filteredItems = items.filter((file) => file.toLowerCase().includes(filter.toLowerCase()));

  function add(item: string) {
    if (selected.includes(item)) return;
    onChange([...selected, item]);
    setAnnouncement(`${item} added as item ${selected.length + 1}.`);
  }

  function remove(item: string) {
    onChange(selected.filter((file) => file !== item));
    setAnnouncement(`${item} removed.`);
  }

  function move(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= selected.length) return;
    const next = [...selected];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
    setAnnouncement(`${selected[index]} moved to position ${target + 1}.`);
  }

  return (
    <div className="file-chain-picker" aria-describedby={statusId}>
      <div className="file-chain-column">
        <label>{availableLabel}</label>
        <input
          aria-label={`Filter ${availableLabel.toLowerCase()}`}
          type="search"
          placeholder="Filter…"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
        />
        <ul className="chain-list">
          {filteredItems.map((file) => (
            <li key={file}>
              <span>{file}</span>
              <button className="ghost" aria-label={`Add ${file} to ${selectedLabel}`} onClick={() => add(file)} disabled={selected.includes(file)}>
                <Plus size={14} aria-hidden="true" /> + Add
              </button>
            </li>
          ))}
          {filteredItems.length === 0 && <li className="hint">No matches.</li>}
        </ul>
      </div>
      <div className="file-chain-column">
        <label>{selectedLabel}</label>
        <ul className="chain-list">
          {selected.map((file, index) => (
            <li key={file}>
              <span className="step-index">{index + 1}</span>
              <span>{file}</span>
              <button className="ghost" aria-label={`Move ${file} up`} onClick={() => move(index, -1)} disabled={index === 0}>
                <ArrowUp size={14} aria-hidden="true" />
              </button>
              <button className="ghost" aria-label={`Move ${file} down`} onClick={() => move(index, 1)} disabled={index === selected.length - 1}>
                <ArrowDown size={14} aria-hidden="true" />
              </button>
              <button className="ghost danger" aria-label={`Remove ${file} from ${selectedLabel}`} onClick={() => remove(file)}>
                <X size={14} aria-hidden="true" />
              </button>
            </li>
          ))}
          {selected.length === 0 && <li className="hint">Nothing selected yet.</li>}
        </ul>
      </div>
      <span id={statusId} className="sr-only" role="status" aria-live="polite">{announcement}</span>
    </div>
  );
}
