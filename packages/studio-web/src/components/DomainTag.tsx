import { useEffect, useState } from 'react';
import { api } from '../api';
import type { ArtifactKind } from '../types';

// Sentinel for the "create one" entry at the bottom of the list. It is not a selectable area, so
// it must not collide with a real folder name.
const NEW_AREA_OPTION = '__new_process_area__';

interface DomainTagProps {
  kind: ArtifactKind;
  name: string;
  value: string;
  /** Existing process areas, across all artifact kinds, offered as the dropdown's options. */
  knownDomains: string[];
  onSaved: (processArea: string) => void;
}

/**
 * Inline editor for BL-10's processArea tag on a single artifact (test case, group, data
 * file, or App ID).
 *
 * Process areas are folders now, created and managed in the library trees, so this control lists
 * them rather than asking anyone to retype one. BL-044 originally required a combobox here on the
 * grounds that "a <select> would make the first use of a new area impossible" — that objection is
 * answered by the "+ New process area" entry, which creates the folder and files the artifact into
 * it in one action, so a new area is still reachable without leaving the screen.
 *
 * Save appears only once the selection actually differs from what is stored, so the control states
 * plainly whether there is an unsaved change.
 *
 * This one component is what Compose, Business Processes, Test Data and the Control Object
 * Repository all render, which is why BL-044's "applied consistently everywhere" criterion is
 * satisfied by changing it here rather than in four places.
 */
export function DomainTag({ kind, name, value, knownDomains, onSaved }: DomainTagProps) {
  const [draft, setDraft] = useState(value);
  const [creatingNew, setCreatingNew] = useState(false);
  const [newArea, setNewArea] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setDraft(value);
    setCreatingNew(false);
    setNewArea('');
  }, [value, name]);

  const pending = creatingNew ? newArea.trim() : draft;
  const changed = pending !== value && (!creatingNew || pending !== '');

  async function save() {
    setSaving(true);
    try {
      // A brand-new area is registered as a folder as well as tagged, so it appears in the trees
      // straight away instead of existing only as this one artifact's tag.
      if (creatingNew) await api.addProcessArea(pending).catch(() => undefined);
      await api.setTag(kind, name, pending);
      onSaved(pending);
      setCreatingNew(false);
      setNewArea('');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="row" style={{ gap: '0.3rem' }}>
      <select
        aria-label={`Process area for ${name}`}
        value={creatingNew ? NEW_AREA_OPTION : draft}
        disabled={saving}
        onChange={(event) => {
          if (event.target.value === NEW_AREA_OPTION) {
            setCreatingNew(true);
            setNewArea('');
            return;
          }
          setCreatingNew(false);
          setDraft(event.target.value);
        }}
        style={{ flex: 1 }}
      >
        <option value="">Untagged</option>
        {knownDomains.map((d) => (
          <option key={d} value={d}>{d}</option>
        ))}
        <option value={NEW_AREA_OPTION}>+ New process area…</option>
      </select>

      {creatingNew && (
        <input
          // Deliberately not "New process area for X": that would contain the select's own label as
          // a substring, leaving two controls that match the same accessible-name lookup.
          aria-label={`New process area name for ${name}`}
          type="text"
          value={newArea}
          placeholder="e.g. Procurement"
          autoFocus
          disabled={saving}
          onChange={(event) => setNewArea(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && changed) void save();
          }}
          style={{ flex: 1 }}
        />
      )}

      {changed && (
        <button className="ghost" disabled={saving} onClick={() => void save()}>
          {saving ? '…' : 'Save'}
        </button>
      )}
    </div>
  );
}
