import { useState } from 'react';
import { TableRowsEditor } from './TableRowsEditor';

interface ListCellProps {
  value: string;
  onChange: (value: string) => void;
  ariaLabel?: string;
}

function looksLikeRowsJson(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed.startsWith('[')) return false;
  try {
    const parsed = JSON.parse(trimmed);
    return Array.isArray(parsed) && parsed.every((r) => typeof r === 'object' && r !== null && !Array.isArray(r));
  } catch {
    return false;
  }
}

/**
 * A data-cell editor that can switch between a plain single value, a repeating ";"
 * list, and a full table of rows. The table-of-rows mode exists for BL-06: a Compose
 * step like AddLineItem can reference this cell as its whole `rows` param via one
 * ${placeholder} (see TableRowsEditor's placeholder mode), which lets the DATA FILE
 * decide how many rows get added per run — not just what values fill a fixed count
 * authored in Compose. Defaults to whichever mode the existing value already looks
 * like, so opening a dataset shows its cells in the shape they were last edited in.
 */
export function ListCell({ value, onChange, ariaLabel = 'Dataset value' }: ListCellProps) {
  const [mode, setMode] = useState<'single' | 'list' | 'rows'>(
    looksLikeRowsJson(value) ? 'rows' : value.includes(';') ? 'list' : 'single'
  );

  if (mode === 'rows') {
    return (
      <div className="stack" style={{ gap: '0.25rem', minWidth: '20rem' }}>
        <TableRowsEditor value={value} onChange={onChange} ariaLabel={ariaLabel} />
        <button className="ghost" title="Collapse back to a single value" onClick={() => setMode('single')}>
          single value
        </button>
      </div>
    );
  }

  if (mode === 'single') {
    return (
      <div className="row" style={{ alignItems: 'center', gap: '0.3rem' }}>
        <input aria-label={ariaLabel} type="text" value={value} onChange={(e) => onChange(e.target.value)} style={{ flex: 1 }} />
        <button className="ghost" title="Edit as a list of values" onClick={() => setMode('list')}>
          ⋯
        </button>
        <button className="ghost" title="Edit as a table of rows (e.g. a variable number of line items)" onClick={() => setMode('rows')}>
          ⊞
        </button>
      </div>
    );
  }

  const items = value.split(';');

  function update(next: string[]) {
    onChange(next.join(';'));
  }

  return (
    <div className="stack" style={{ gap: '0.25rem', minWidth: '10rem' }}>
      {items.map((item, i) => (
        <div className="row" key={i} style={{ alignItems: 'center', gap: '0.25rem' }}>
          <input
            type="text"
            aria-label={`${ariaLabel}, item ${i + 1}`}
            value={item}
            placeholder={`item ${i + 1}`}
            onChange={(e) => update(items.map((it, j) => (j === i ? e.target.value : it)))}
            style={{ flex: 1 }}
          />
          <button className="ghost danger" title="Remove item" disabled={items.length <= 1} onClick={() => update(items.filter((_, j) => j !== i))}>
            ✕
          </button>
        </div>
      ))}
      <div className="row" style={{ gap: '0.3rem' }}>
        <button className="ghost" onClick={() => update([...items, ''])}>
          + item
        </button>
        <button className="ghost" title="Collapse back to a single value" onClick={() => setMode('single')}>
          single value
        </button>
      </div>
    </div>
  );
}
