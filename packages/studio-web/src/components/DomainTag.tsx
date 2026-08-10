import { useEffect, useId, useState } from 'react';
import { api } from '../api';
import type { ArtifactKind } from '../types';

interface DomainTagProps {
  kind: ArtifactKind;
  name: string;
  value: string;
  /** Existing domains (across all artifact kinds), offered both as the combobox's own options
   * and as one-click chips, so the second and later taggings of "Procurement" don't require
   * retyping it. */
  knownDomains: string[];
  onSaved: (processArea: string) => void;
}

/**
 * Inline editor for BL-10's processArea tag on a single artifact (test case, group, data
 * file, or App ID).
 *
 * BL-044 turned the plain text field into a combobox — a real <input list=…>, not a <select>.
 * That distinction is the whole point: the set of process areas is a growing convention, not a
 * fixed enumeration, so the control has to offer what already exists AND accept something new
 * in the same keystroke. A <select> would have made the first use of a new area impossible.
 *
 * The quick-pick chips stay alongside it rather than being replaced by the dropdown: the chips
 * save and commit in one click, whereas choosing from the list still requires pressing Save.
 * The chip matching the current value is marked with aria-pressed so the current selection is
 * indicated rather than merely present in a list.
 *
 * This one component is what Compose, Business Processes, Test Data and the Control Object
 * Repository all render, which is why BL-044's "applied consistently everywhere" criterion is
 * satisfied by changing it here rather than in four places.
 */
export function DomainTag({ kind, name, value, knownDomains, onSaved }: DomainTagProps) {
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);
  // Several DomainTags can be on one screen; a shared datalist id would let one field's
  // suggestions silently drive another's.
  const listId = `${useId()}-process-areas`;

  useEffect(() => setDraft(value), [value]);

  async function save(next: string) {
    setSaving(true);
    try {
      await api.setTag(kind, name, next);
      onSaved(next);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="stack" style={{ gap: '0.3rem' }}>
      <div className="row" style={{ gap: '0.3rem' }}>
        <input
          aria-label={`Process area for ${name}`}
          type="text"
          role="combobox"
          list={listId}
          value={draft}
          placeholder="e.g. Procurement"
          onChange={(e) => setDraft(e.target.value)}
          style={{ flex: 1 }}
        />
        <datalist id={listId}>
          {knownDomains.map((d) => (
            <option key={d} value={d} />
          ))}
        </datalist>
        <button className="ghost" disabled={saving || draft.trim() === value} onClick={() => save(draft.trim())}>
          {saving ? '…' : 'Save'}
        </button>
      </div>
      {knownDomains.length > 0 && (
        <div className="row" style={{ gap: '0.3rem', flexWrap: 'wrap' }}>
          {knownDomains.map((d) => (
            <button
              key={d}
              className="ghost"
              style={{ padding: '0.1rem 0.5rem' }}
              disabled={saving}
              aria-pressed={d === value}
              onClick={() => {
                setDraft(d);
                save(d);
              }}
            >
              {d}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
