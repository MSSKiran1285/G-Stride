import { useState } from 'react';
import type { ObjectControl } from '../types';
import { ObjectPicker } from './ObjectPicker';

/**
 * AddLineItem's row editor is fully dynamic: the author picks which captured
 * table-column objects are "columns," so the same module can drive a Purchase
 * Order's item table, a Sales Order's, an Invoice's, or any other grid — there's
 * no fixed material/plant/quantity concept baked in here. State is kept as a
 * columns[] + rows[][] grid for editing ergonomics, then serialized to the
 * module's actual param shape: a JSON array of {object name: value} maps.
 */

function parseRows(json: string): { columns: string[]; rows: string[][] } {
  let parsed: Record<string, string>[] = [];
  try {
    const value = JSON.parse(json || '[]');
    if (Array.isArray(value)) parsed = value;
  } catch {
    // malformed or legacy value — start fresh rather than crash the editor
  }
  const columns = parsed.length > 0 ? Object.keys(parsed[0]) : [''];
  const rows = parsed.length > 0 ? parsed.map((r) => columns.map((c) => r[c] ?? '')) : [columns.map(() => '')];
  return { columns, rows };
}

function serializeRows(columns: string[], rows: string[][]): string {
  return JSON.stringify(rows.map((row) => Object.fromEntries(columns.map((c, i) => [c, row[i] ?? '']))));
}

function isBarePlaceholder(value: string): boolean {
  return /^\$\{\w+\}$/.test(value.trim());
}

interface Props {
  value: string;
  onChange: (value: string) => void;
  /** Omitted when this editor has no App ID context to suggest objects from (the Data
   * tab's own use of this component) — column headers fall back to plain text entry. */
  objectControls?: ObjectControl[];
  /** Lets the author replace the whole grid with one raw ${placeholder}, so a Data tab
   * column can drive the entire row set for a run — not just fill values within a fixed
   * row count authored here. Only meaningful in Compose; the Data tab's own use of this
   * component IS the data, so there's nothing further to point at. */
  allowPlaceholderMode?: boolean;
  ariaLabel?: string;
}

export function TableRowsEditor({ value, onChange, objectControls, allowPlaceholderMode, ariaLabel = 'Table rows' }: Props) {
  const [placeholderMode, setPlaceholderMode] = useState(() => Boolean(allowPlaceholderMode) && isBarePlaceholder(value));
  const [state, setState] = useState(() => parseRows(value));

  function commit(next: { columns: string[]; rows: string[][] }) {
    setState(next);
    onChange(serializeRows(next.columns, next.rows));
  }

  function setColumnName(index: number, name: string) {
    commit({ ...state, columns: state.columns.map((c, i) => (i === index ? name : c)) });
  }

  function addColumn() {
    commit({ columns: [...state.columns, ''], rows: state.rows.map((r) => [...r, '']) });
  }

  function removeColumn(index: number) {
    if (state.columns.length <= 1) return;
    commit({
      columns: state.columns.filter((_, i) => i !== index),
      rows: state.rows.map((r) => r.filter((_, i) => i !== index)),
    });
  }

  function setCell(rowIndex: number, colIndex: number, cellValue: string) {
    commit({
      ...state,
      rows: state.rows.map((r, i) => (i === rowIndex ? r.map((v, ci) => (ci === colIndex ? cellValue : v)) : r)),
    });
  }

  function addRow() {
    commit({ ...state, rows: [...state.rows, state.columns.map(() => '')] });
  }

  function removeRow(index: number) {
    if (state.rows.length <= 1) return;
    commit({ ...state, rows: state.rows.filter((_, i) => i !== index) });
  }

  if (placeholderMode) {
    return (
      <div className="stack">
        <div>
          <label>Data-file placeholder for all rows</label>
          <input
            type="text"
            aria-label={`${ariaLabel} placeholder`}
            value={value}
            placeholder="e.g. ${lineItems} — a Data tab column holding the whole row set"
            onChange={(e) => onChange(e.target.value)}
          />
        </div>
        <div>
          <button className="ghost" onClick={() => setPlaceholderMode(false)}>
            Build rows here instead
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="stack">
      {allowPlaceholderMode && (
        <div>
          <button className="ghost" onClick={() => setPlaceholderMode(true)}>
            Use a single data-file placeholder instead
          </button>
        </div>
      )}
      <div className="table-wrap">
        <table className="rows-grid">
          <thead>
            <tr>
              <th></th>
              {state.columns.map((col, ci) => (
                <th key={ci} style={{ minWidth: '11rem' }}>
                  {/* The remove control sits ABOVE the field rather than beside it. Inline, it
                      shortened the header input by its own width, so the column header and the
                      cells beneath it stopped lining up — 46px adrift at the right edge. */}
                  <div className="rows-grid-colhead">
                    <span>Column {ci + 1}</span>
                    <button className="ghost danger" aria-label={`Remove column ${ci + 1}`} onClick={() => removeColumn(ci)} disabled={state.columns.length <= 1} title="Remove column">
                      ✕
                    </button>
                  </div>
                  {objectControls ? (
                    <ObjectPicker
                      value={col}
                      onChange={(v) => setColumnName(ci, v)}
                      options={objectControls}
                      kind={['tableColumn']}
                      placeholder="column object name"
                    />
                  ) : (
                    <input aria-label={`${ariaLabel}, column ${ci + 1} name`} type="text" value={col} onChange={(e) => setColumnName(ci, e.target.value)} placeholder="object name" />
                  )}
                </th>
              ))}
              <th>
                <button className="ghost" onClick={addColumn} title="Add another table-column object">
                  + Col
                </button>
              </th>
            </tr>
          </thead>
          <tbody>
            {state.rows.map((row, ri) => (
              <tr key={ri}>
                <td className="hint">{ri + 1}</td>
                {row.map((cell, ci) => (
                  <td key={ci}>
                    <input aria-label={`${ariaLabel}, row ${ri + 1}, column ${ci + 1}`} type="text" value={cell} onChange={(e) => setCell(ri, ci, e.target.value)} placeholder="blank = skip cell" />
                  </td>
                ))}
                <td>
                  <button className="ghost danger" aria-label={`Remove ${ariaLabel} row ${ri + 1}`} onClick={() => removeRow(ri)} disabled={state.rows.length <= 1} title="Remove line">
                    ✕
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div>
        <button onClick={addRow}>+ Add line</button>
      </div>
    </div>
  );
}
