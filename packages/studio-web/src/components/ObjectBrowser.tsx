import { useEffect, useState } from 'react';
import { api } from '../api';
import type { ObjectControl } from '../types';
import { DomainTag } from './DomainTag';

const UNTAGGED = '(untagged)';

/**
 * Lets an engineer see what's already captured before capturing more — the only way
 * to do this before was per-field autocomplete inside a Compose step, which meant you
 * had to already be composing a test case to discover an object existed at all. This
 * also surfaces every App ID in use, so a duplicate capture of the same screen under a
 * new App ID (which happened at least twice this session) becomes visible up front.
 *
 * App IDs are grouped by BL-10's processArea tag (Procurement, Sales, ...) — a flat
 * dropdown of every App ID ever captured doesn't scale once there are dozens across
 * several business domains. Untagged App IDs land in their own bucket rather than
 * being hidden, so nothing captured before tagging existed goes missing.
 *
 * Rows are single-select (radio) rather than a "Highlight on screen" link on every
 * row — a row's controls (highlight/edit/delete) only make sense for one object at a
 * time, and one shared toolbar reads clearer than repeating three actions N times.
 */
export function ObjectBrowser() {
  const [appIds, setAppIds] = useState<string[]>([]);
  const [appIdTags, setAppIdTags] = useState<Record<string, string>>({});
  const [processAreas, setProcessAreas] = useState<string[]>([]);
  const [domain, setDomain] = useState('');
  const [appId, setAppId] = useState('');
  const [objects, setObjects] = useState<ObjectControl[]>([]);
  const [filter, setFilter] = useState('');
  const [error, setError] = useState<string | null>(null);

  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [highlighting, setHighlighting] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editDraft, setEditDraft] = useState({ name: '', label: '' });
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [editingDomain, setEditingDomain] = useState(false);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  function refreshTags() {
    api.listTags('appId').then(setAppIdTags).catch(() => undefined);
    api.listProcessAreas().then(setProcessAreas).catch(() => undefined);
  }

  function refreshObjects() {
    if (!appId) return;
    api
      .listObjects(appId)
      .then(setObjects)
      .catch((e) => setError(String(e)));
  }

  useEffect(() => {
    api.listAppIds().then(setAppIds).catch((e) => setError(String(e)));
    refreshTags();
  }, []);

  useEffect(() => {
    setSelectedName(null);
    setEditing(false);
    setEditingDomain(false);
    if (!appId) {
      setObjects([]);
      return;
    }
    refreshObjects();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appId]);

  const domainOf = (id: string) => appIdTags[id] || UNTAGGED;
  const domains = Array.from(new Set(appIds.map(domainOf))).sort((a, b) => (a === UNTAGGED ? 1 : b === UNTAGGED ? -1 : a.localeCompare(b)));
  const appIdsInDomain = domain ? appIds.filter((id) => domainOf(id) === domain) : [];

  const filtered = filter.trim()
    ? objects.filter(
        (o) =>
          o.name.toLowerCase().includes(filter.trim().toLowerCase()) ||
          (o.label ?? '').toLowerCase().includes(filter.trim().toLowerCase()) ||
          (o.controlType ?? '').toLowerCase().includes(filter.trim().toLowerCase())
      )
    : objects;

  const selected = objects.find((o) => o.name === selectedName) ?? null;

  async function highlight() {
    if (!selected) return;
    setHighlighting(true);
    setNotFound(false);
    try {
      const result = await api.highlightControl(selected.controlId);
      if (!result.found) setNotFound(true);
    } catch {
      setNotFound(true);
    } finally {
      setHighlighting(false);
    }
  }

  function startEdit() {
    if (!selected) return;
    setEditDraft({ name: selected.name, label: selected.label ?? '' });
    setEditing(true);
    setActionError(null);
  }

  async function saveEdit() {
    if (!selected) return;
    const newName = editDraft.name.trim();
    if (!newName) {
      setActionError('Name cannot be empty.');
      return;
    }
    setSaving(true);
    setActionError(null);
    try {
      if (newName !== selected.name) {
        await api.renameObject(appId, selected.name, newName);
      }
      await api.saveObject(appId, newName, {
        controlId: selected.controlId,
        controlType: selected.controlType ?? '',
        bindingPath: selected.bindingPath ?? undefined,
        label: editDraft.label.trim() || undefined,
        parentControlId: selected.parentControlId ?? undefined,
        tableId: selected.tableId ?? undefined,
      });
      setEditing(false);
      setSelectedName(newName);
      refreshObjects();
    } catch (e) {
      setActionError(String(e));
    } finally {
      setSaving(false);
    }
  }

  function reorder(from: number, to: number) {
    if (from === to) return;
    const next = [...objects];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    setObjects(next);
    api.reorderObjects(appId, next.map((o) => o.name)).catch((e) => {
      setActionError(String(e));
      refreshObjects();
    });
  }

  async function deleteSelected() {
    if (!selected) return;
    if (!window.confirm(`Delete "${selected.name}" from ${appId}? This can't be undone.`)) return;
    setDeleting(true);
    setActionError(null);
    try {
      await api.deleteObject(appId, selected.name);
      setSelectedName(null);
      refreshObjects();
    } catch (e) {
      setActionError(String(e));
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="panel stack">
      <p className="section-title">Browse objects</p>
      <p className="hint" style={{ margin: 0 }}>
        Every App ID with at least one saved object, grouped by domain — check here before
        capturing a screen again under a new name.
      </p>
      <div className="row">
        <select
          aria-label="Object repository domain"
          value={domain}
          onChange={(e) => {
            setDomain(e.target.value);
            setAppId('');
          }}
          style={{ maxWidth: '14rem' }}
        >
          <option value="">— select a domain ({domains.length}) —</option>
          {domains.map((d) => (
            <option key={d} value={d}>
              {d} ({appIds.filter((id) => domainOf(id) === d).length})
            </option>
          ))}
        </select>
        {domain && (
          <select aria-label="Object repository App ID" value={appId} onChange={(e) => setAppId(e.target.value)} style={{ maxWidth: '18rem' }}>
            <option value="">— select an App ID ({appIdsInDomain.length}) —</option>
            {appIdsInDomain.map((id) => (
              <option key={id} value={id}>
                {id}
              </option>
            ))}
          </select>
        )}
        {appId && (
          <input
            type="text"
            aria-label="Filter saved objects"
            placeholder="Filter by name, label, or type…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            style={{ flex: 1 }}
          />
        )}
      </div>

      {error && <p className="error-text">{error}</p>}

      {appId && (
        <div className="stack" style={{ gap: '0.4rem' }}>
          <div className="row" style={{ alignItems: 'center', gap: '0.5rem' }}>
            <span className="hint">
              Domain: <strong style={{ color: 'var(--text)' }}>{appIdTags[appId] || UNTAGGED}</strong>
            </span>
            <button className="ghost" style={{ padding: '0.1rem 0.4rem' }} onClick={() => setEditingDomain((v) => !v)}>
              {editingDomain ? 'Cancel' : 'change ▾'}
            </button>
          </div>
          {editingDomain && (
            <div style={{ maxWidth: '24rem' }}>
              <DomainTag
                kind="appId"
                name={appId}
                value={appIdTags[appId] ?? ''}
                knownDomains={processAreas}
                onSaved={() => {
                  refreshTags();
                  setEditingDomain(false);
                }}
              />
            </div>
          )}
        </div>
      )}

      {appId && (
        <div className="row" style={{ alignItems: 'center', gap: '0.5rem', justifyContent: 'flex-end' }}>
          {notFound && <span className="error-text">Not found on screen — is a scan session open on this app?</span>}
          <button className="pill pill-success" disabled={!selected || highlighting || editing} onClick={highlight}>
            {highlighting ? 'Highlighting…' : 'Highlight'}
          </button>
          <button className="pill pill-neutral" disabled={!selected || editing} onClick={startEdit}>
            Edit
          </button>
          <button className="pill pill-danger" disabled={!selected || editing || deleting} onClick={deleteSelected}>
            {deleting ? 'Deleting…' : 'Delete'}
          </button>
        </div>
      )}
      {actionError && <p className="error-text">{actionError}</p>}

      {appId && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th></th>
                <th></th>
                <th>#</th>
                <th>Name</th>
                <th>Type</th>
                <th>Label</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((o, i) => {
                const isSelected = o.name === selectedName;
                const isEditingRow = isSelected && editing;
                const reorderable = !filter.trim();
                return (
                  <tr
                    key={o.name}
                    draggable={reorderable}
                    onDragStart={() => reorderable && setDragIndex(i)}
                    onDragOver={(e) => {
                      if (!reorderable) return;
                      e.preventDefault();
                      if (dragIndex !== null && dragIndex !== i) setDragOverIndex(i);
                    }}
                    onDragLeave={() => setDragOverIndex((cur) => (cur === i ? null : cur))}
                    onDrop={(e) => {
                      e.preventDefault();
                      if (reorderable && dragIndex !== null) reorder(dragIndex, i);
                      setDragIndex(null);
                      setDragOverIndex(null);
                    }}
                    onDragEnd={() => {
                      setDragIndex(null);
                      setDragOverIndex(null);
                    }}
                    className={[dragIndex === i ? 'dragging' : '', dragOverIndex === i ? 'drag-over' : ''].filter(Boolean).join(' ')}
                    style={{ background: isSelected ? 'var(--accent-soft)' : undefined }}
                  >
                    <td className="drag-handle" title={reorderable ? 'Drag to reorder' : 'Clear the filter to reorder'} style={{ opacity: reorderable ? 1 : 0.3 }}>
                      ⠿
                    </td>
                    <td>
                      <input
                        type="radio"
                        aria-label={`Select object ${o.name}`}
                        name="object-select"
                        checked={isSelected}
                        onChange={() => {
                          setSelectedName(o.name);
                          setEditing(false);
                          setNotFound(false);
                          setActionError(null);
                        }}
                      />
                    </td>
                    <td className="hint">{i + 1}</td>
                    <td style={{ fontWeight: 600 }}>
                      {isEditingRow ? (
                        <input
                          aria-label={`Rename object ${o.name}`}
                          type="text"
                          value={editDraft.name}
                          onChange={(e) => setEditDraft((d) => ({ ...d, name: e.target.value }))}
                          style={{ minWidth: '12rem' }}
                        />
                      ) : (
                        o.name
                      )}
                    </td>
                    <td className="hint">
                      {o.controlType?.split('.').pop() ?? '—'}
                      {o.tableId && <span className="hint"> (table column)</span>}
                    </td>
                    <td className="hint">
                      {isEditingRow ? (
                        <div className="row" style={{ gap: '0.4rem', alignItems: 'center' }}>
                          <input
                            aria-label={`Edit label for object ${o.name}`}
                            type="text"
                            value={editDraft.label}
                            onChange={(e) => setEditDraft((d) => ({ ...d, label: e.target.value }))}
                            style={{ minWidth: '10rem' }}
                          />
                          <button className="primary" disabled={saving} onClick={saveEdit}>
                            {saving ? 'Saving…' : 'Save'}
                          </button>
                          <button className="ghost" disabled={saving} onClick={() => setEditing(false)}>
                            Cancel
                          </button>
                        </div>
                      ) : (
                        o.label || '—'
                      )}
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={6} className="hint">
                    {objects.length === 0 ? 'No objects saved under this App ID yet.' : 'No objects match that filter.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
