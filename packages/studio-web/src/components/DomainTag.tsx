import { useEffect, useState } from 'react';
import { api } from '../api';
import type { ArtifactKind } from '../types';

interface DomainTagProps {
  kind: ArtifactKind;
  name: string;
  value: string;
  /** Existing domains (across all artifact kinds) offered as one-click chips, so the second
   * and later taggings of "Procurement" don't require retyping it. */
  knownDomains: string[];
  onSaved: (processArea: string) => void;
}

/**
 * Inline editor for BL-10's processArea tag on a single artifact (test case, group, data
 * file, or App ID) — a plain text field rather than a <select>, since the set of domains
 * isn't fixed; the quick-pick chips below it are how a growing convention (Procurement,
 * Sales, ...) gets reused without hand-typing it every time.
 */
export function DomainTag({ kind, name, value, knownDomains, onSaved }: DomainTagProps) {
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);

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
        <input aria-label={`Domain for ${name}`} type="text" value={draft} placeholder="e.g. Procurement" onChange={(e) => setDraft(e.target.value)} style={{ flex: 1 }} />
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
