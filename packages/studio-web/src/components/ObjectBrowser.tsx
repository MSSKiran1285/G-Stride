import { useCallback, useEffect, useState } from 'react';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { api } from '../api';
import type { ObjectControl, ObjectVerificationEvent } from '../types';
import { DomainTag } from './DomainTag';
import { AsyncFeedback, EmptyState, TableFrame } from './WorkspacePrimitives';

const UNTAGGED = '(untagged)';

function verificationLabel(status: ObjectControl['verificationStatus']): string {
  if (status === 'verified') return 'verified';
  if (status === 'drifted') return 'drifted';
  if (status === 'missing') return 'missing';
  return 'never verified';
}

function verificationBadgeClass(status: ObjectControl['verificationStatus']): string {
  if (status === 'verified') return 'badge passed';
  if (status === 'drifted') return 'badge warning';
  if (status === 'missing') return 'badge failed';
  return 'badge neutral';
}

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
export function ObjectBrowser({
  initialAppId,
  initialObjectName,
  onSelectionChange,
}: {
  initialAppId?: string;
  initialObjectName?: string;
  onSelectionChange?: (appId: string, objectName?: string) => void;
} = {}) {
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
  const [reorderAnnouncement, setReorderAnnouncement] = useState('');
  const [usage, setUsage] = useState<string[] | null>(null);
  const [usageError, setUsageError] = useState<string | null>(null);
  const [verifications, setVerifications] = useState<ObjectVerificationEvent[]>([]);
  const [reverifying, setReverifying] = useState(false);
  const [reverifyOutcome, setReverifyOutcome] = useState<{
    outcome: 'verified' | 'drifted' | 'missing';
    live?: { controlId: string; controlType: string; bindingPath?: string; text?: string };
  } | null>(null);
  const domainOf = useCallback((id: string) => appIdTags[id] || UNTAGGED, [appIdTags]);

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
    if (!initialAppId || initialAppId === appId || !appIds.includes(initialAppId)) return;
    setDomain(domainOf(initialAppId));
    setAppId(initialAppId);
  }, [initialAppId, appId, appIds, domainOf]);

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

  useEffect(() => {
    if (!initialObjectName || objects.length === 0) return;
    if (objects.some((object) => object.name === initialObjectName)) {
      setSelectedName(initialObjectName);
    }
  }, [initialObjectName, objects]);

  // Usage and verification history are per-object facts fetched on demand, not carried on
  // every row in the bulk list response — selecting a different object (or reloading the
  // list after a rename/delete/reverify) always starts from a clean slate.
  useEffect(() => {
    setUsage(null);
    setUsageError(null);
    setVerifications([]);
    setReverifyOutcome(null);
    if (!appId || !selectedName) return;
    api.getObjectUsage(appId, selectedName).then(setUsage).catch((e) => setUsageError(String(e)));
    api.getObjectVerifications(appId, selectedName).then(setVerifications).catch(() => undefined);
  }, [appId, selectedName]);

  const domains = Array.from(new Set(appIds.map(domainOf))).sort((a, b) => (a === UNTAGGED ? 1 : b === UNTAGGED ? -1 : a.localeCompare(b)));
  const appIdsInDomain = domain ? appIds.filter((id) => domainOf(id) === domain) : [];

  // Search spans domain, App ID, name, label, type and stability in one box (BL-022 AC1) —
  // domain/App ID are already narrowed by the selects above, so this only needs to add the
  // stability terms on top of the name/label/type matching that already existed.
  const filtered = filter.trim()
    ? objects.filter((o) => {
        const q = filter.trim().toLowerCase();
        const stabilityText = [
          o.unstableId ? 'unstable' : 'stable',
          verificationLabel(o.verificationStatus),
          o.likelyDuplicateOf?.length ? 'duplicate' : '',
        ]
          .join(' ')
          .toLowerCase();
        return (
          o.name.toLowerCase().includes(q) ||
          (o.label ?? '').toLowerCase().includes(q) ||
          (o.controlType ?? '').toLowerCase().includes(q) ||
          domainOf(appId).toLowerCase().includes(q) ||
          appId.toLowerCase().includes(q) ||
          stabilityText.includes(q)
        );
      })
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
      let renameNote = '';
      if (newName !== selected.name) {
        // Rename propagates into every referencing Test automatically (same control, new
        // name — an IDE-style symbol rename, not a destructive change) — see server's
        // renameObjectInTestCase (BL-022 AC3).
        const { updatedTests } = await api.renameObject(appId, selected.name, newName);
        if (updatedTests.length > 0) {
          renameNote = ` Updated the reference in ${updatedTests.length} Test${updatedTests.length === 1 ? '' : 's'}: ${updatedTests.join(', ')}.`;
        }
      }
      await api.saveObject(appId, newName, {
        controlId: selected.controlId,
        controlType: selected.controlType ?? '',
        bindingPath: selected.bindingPath ?? undefined,
        label: editDraft.label.trim() || undefined,
        parentControlId: selected.parentControlId ?? undefined,
        tableId: selected.tableId ?? undefined,
        scope: selected.scope ?? undefined,
      });
      setEditing(false);
      setSelectedName(newName);
      onSelectionChange?.(appId, newName);
      refreshObjects();
      if (renameNote) setActionError(renameNote.trim()); // informational, reuses the same visible slot as an error
    } catch (e) {
      setActionError(String(e));
    } finally {
      setSaving(false);
    }
  }

  async function reverify() {
    if (!selected) return;
    setReverifying(true);
    setActionError(null);
    try {
      const result = await api.reverifyObject(appId, selected.name);
      setReverifyOutcome(result);
      api.getObjectVerifications(appId, selected.name).then(setVerifications).catch(() => undefined);
      refreshObjects(); // pick up the refreshed verificationStatus/lastVerifiedAt on the row
    } catch (e) {
      setActionError(String(e));
    } finally {
      setReverifying(false);
    }
  }

  /** Accepts a "drifted" reverify result: updates the stored control to the live id/type/
   *  binding path found by reverify() — an explicit, reviewed action, never automatic
   *  (BL-024 AC3's "without overwriting silently"). */
  async function applyReverifyFix() {
    if (!selected || !reverifyOutcome?.live) return;
    setSaving(true);
    setActionError(null);
    try {
      await api.saveObject(appId, selected.name, {
        controlId: reverifyOutcome.live.controlId,
        controlType: reverifyOutcome.live.controlType,
        bindingPath: reverifyOutcome.live.bindingPath,
        label: selected.label ?? undefined,
        parentControlId: selected.parentControlId ?? undefined,
        tableId: selected.tableId ?? undefined,
        scope: selected.scope ?? undefined,
      });
      setReverifyOutcome(null);
      refreshObjects();
    } catch (e) {
      setActionError(String(e));
    } finally {
      setSaving(false);
    }
  }

  function reorder(from: number, to: number) {
    if (from === to || to < 0 || to >= objects.length) return;
    const next = [...objects];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    setObjects(next);
    setReorderAnnouncement(`${moved.name} moved to position ${to + 1}.`);
    api.reorderObjects(appId, next.map((o) => o.name)).catch((e) => {
      setActionError(String(e));
      refreshObjects();
    });
  }

  async function deleteSelected() {
    if (!selected) return;
    // usage is already fetched for the detail panel (BL-022 AC2) — reuse it rather than a
    // second round-trip, and show exactly which Tests would break before confirming
    // (BL-022 AC3's "dependency impact" for delete, which — unlike rename — can't safely
    // propagate, so it must block and let the tester decide).
    const usedBy = usage ?? [];
    const message =
      usedBy.length > 0
        ? `"${selected.name}" is referenced by ${usedBy.length} Test${usedBy.length === 1 ? '' : 's'}: ${usedBy.join(', ')}.\n\nDelete anyway? Those Tests will fail until fixed.`
        : `Delete "${selected.name}" from ${appId}? This can't be undone.`;
    if (!window.confirm(message)) return;
    setDeleting(true);
    setActionError(null);
    try {
      await api.deleteObject(appId, selected.name, usedBy.length > 0);
      setSelectedName(null);
      onSelectionChange?.(appId);
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
          <select
            aria-label="Object repository App ID"
            value={appId}
            onChange={(e) => {
              setAppId(e.target.value);
              if (e.target.value) onSelectionChange?.(e.target.value);
            }}
            style={{ maxWidth: '18rem' }}
          >
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

      {error && <AsyncFeedback state="error" message={error} onRetry={refreshObjects} />}
      <span className="sr-only" role="status" aria-live="polite">{reorderAnnouncement}</span>

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
          <button className="pill pill-neutral" disabled={!selected || editing || reverifying} onClick={reverify} title="Compare the stored control against the live screen without changing anything — needs an open scan session">
            {reverifying ? 'Reverifying…' : 'Reverify'}
          </button>
          <button className="pill pill-neutral" disabled={!selected || editing} onClick={startEdit}>
            Edit
          </button>
          <button className="pill pill-danger" disabled={!selected || editing || deleting} onClick={deleteSelected}>
            {deleting ? 'Deleting…' : 'Delete'}
          </button>
        </div>
      )}
      {actionError && <AsyncFeedback state="error" message={actionError} />}

      {selected && !editing && (
        <div className="panel stack" style={{ gap: '0.6rem' }}>
          <p className="section-title">
            {selected.name} <span className="hint">— selector detail</span>
          </p>
          <div className="row" style={{ flexWrap: 'wrap', gap: '0.4rem' }}>
            <span className={verificationBadgeClass(selected.verificationStatus)}>{verificationLabel(selected.verificationStatus)}</span>
            {selected.unstableId && (
              <span className="badge warning" title="This control id looks auto-generated and may regenerate on the next reload">
                unstable id
              </span>
            )}
            {(selected.likelyDuplicateOf?.length ?? 0) > 0 && (
              <span className="badge warning" title={`Same type + label as: ${selected.likelyDuplicateOf!.join(', ')}`}>
                possible duplicate of {selected.likelyDuplicateOf!.length}
              </span>
            )}
            {selected.scope && <span className="badge neutral">{selected.scope}</span>}
          </div>

          <div className="row" style={{ flexWrap: 'wrap', gap: '1.5rem' }}>
            <div className="stack" style={{ gap: '0.15rem' }}>
              <span className="hint">Control ID</span>
              <span style={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>{selected.controlId}</span>
            </div>
            {selected.bindingPath && (
              <div className="stack" style={{ gap: '0.15rem' }}>
                <span className="hint">Binding path</span>
                <span style={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>{selected.bindingPath}</span>
              </div>
            )}
            {selected.tableId && (
              <div className="stack" style={{ gap: '0.15rem' }}>
                <span className="hint">Table ID</span>
                <span style={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>{selected.tableId}</span>
              </div>
            )}
          </div>

          <div className="row" style={{ flexWrap: 'wrap', gap: '1.5rem' }}>
            <div className="stack" style={{ gap: '0.15rem' }}>
              <span className="hint">Created</span>
              <span>{selected.createdAt ? new Date(selected.createdAt).toLocaleString() : '—'}</span>
            </div>
            <div className="stack" style={{ gap: '0.15rem' }}>
              <span className="hint">Last updated</span>
              <span>
                {selected.updatedAt ? new Date(selected.updatedAt).toLocaleString() : '—'}
                {selected.updatedBy ? ` by ${selected.updatedBy}` : ''}
              </span>
            </div>
            <div className="stack" style={{ gap: '0.15rem' }}>
              <span className="hint">Last verified</span>
              <span>{selected.lastVerifiedAt ? new Date(selected.lastVerifiedAt).toLocaleString() : 'never'}</span>
            </div>
          </div>

          <div className="stack" style={{ gap: '0.2rem' }}>
            <span className="hint">Usage</span>
            {usageError ? (
              <span className="error-text">{usageError}</span>
            ) : usage === null ? (
              <span className="hint">Checking…</span>
            ) : usage.length === 0 ? (
              <span className="hint">Not referenced by any saved Test.</span>
            ) : (
              <span>Used by {usage.length} Test{usage.length === 1 ? '' : 's'}: {usage.join(', ')}</span>
            )}
          </div>

          {reverifyOutcome && (
            <div className={`fiori-message-strip ${reverifyOutcome.outcome === 'verified' ? 'success' : reverifyOutcome.outcome === 'drifted' ? 'warning' : 'error'}`}>
              {reverifyOutcome.outcome === 'verified' && 'Live screen matches the stored control exactly — nothing to change.'}
              {reverifyOutcome.outcome === 'missing' && 'Not found on the live screen — is the right scan session open, or has this control been removed?'}
              {reverifyOutcome.outcome === 'drifted' && reverifyOutcome.live && (
                <>
                  Found a live control with a matching id suffix, but its id has changed:
                  <br />
                  stored: <code>{selected.controlId}</code>
                  <br />
                  live: <code>{reverifyOutcome.live.controlId}</code> ({reverifyOutcome.live.controlType})
                  <div className="row" style={{ marginTop: '0.4rem' }}>
                    <button className="primary" disabled={saving} onClick={applyReverifyFix}>
                      {saving ? 'Updating…' : 'Update stored control to match'}
                    </button>
                  </div>
                </>
              )}
            </div>
          )}

          {verifications.length > 0 && (
            <details>
              <summary className="hint" style={{ cursor: 'pointer' }}>Verification history ({verifications.length})</summary>
              <ul style={{ margin: '0.4rem 0 0', paddingLeft: '1.2rem' }}>
                {verifications.map((v, i) => (
                  <li key={i} className="hint">
                    {new Date(v.verifiedAt).toLocaleString()} — {v.outcome}
                    {v.verifiedBy ? ` (${v.verifiedBy})` : ''}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}

      {appId && (
        objects.length === 0 ? (
          <EmptyState title="No saved objects" description="Open a scan session and capture controls for this App ID." compact />
        ) : (
        <TableFrame label="Saved control objects">
          <table className="responsive-table">
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
                    <td className="drag-handle" data-label="Reorder" title={reorderable ? 'Drag to reorder' : 'Clear the filter to reorder'} style={{ opacity: reorderable ? 1 : 0.3 }}>
                      ⠿
                    </td>
                    <td data-label="Select">
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
                          onSelectionChange?.(appId, o.name);
                        }}
                      />
                    </td>
                    <td className="hint" data-label="Position">{i + 1}</td>
                    <td style={{ fontWeight: 600 }} data-label="Name">
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
                    <td className="hint" data-label="Type">
                      {o.controlType?.split('.').pop() ?? '—'}
                      {o.tableId && <span className="hint"> (table column)</span>}
                    </td>
                    <td className="hint" data-label="Label and actions">
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
                        <div className="object-row-label-actions">
                          <span>{o.label || '—'}</span>
                          <span className="object-order-actions">
                            <button
                              type="button"
                              className="ghost icon-only"
                              aria-label={`Move object ${o.name} up`}
                              onClick={() => reorder(i, i - 1)}
                              disabled={!reorderable || i === 0}
                            >
                              <ArrowUp size={14} aria-hidden="true" />
                            </button>
                            <button
                              type="button"
                              className="ghost icon-only"
                              aria-label={`Move object ${o.name} down`}
                              onClick={() => reorder(i, i + 1)}
                              disabled={!reorderable || i === objects.length - 1}
                            >
                              <ArrowDown size={14} aria-hidden="true" />
                            </button>
                          </span>
                        </div>
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
        </TableFrame>
        )
      )}
    </div>
  );
}
