import { useCallback, useEffect, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  Clock,
  Copy,
  ExternalLink,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  GripVertical,
  Info,
  Plus,
  RefreshCw,
  ShieldCheck,
  Target,
  Trash2,
  X,
} from 'lucide-react';
import { api } from '../api';
import type { ObjectControl, ObjectVerificationEvent, ObjectReconcileResult, ObjectCoverage } from '../types';
import { AsyncFeedback, EmptyState } from './WorkspacePrimitives';

const UNTAGGED = '(untagged)';

function verificationLabel(status: ObjectControl['verificationStatus']): string {
  if (status === 'verified') return 'verified';
  if (status === 'drifted') return 'drifted';
  if (status === 'missing') return 'missing';
  return 'never verified';
}

function formatControlType(type?: string | null): string {
  if (!type) return '—';
  const clean = (type.split('.').pop() || type).toLowerCase();
  return clean;
}

const DELETED_FOLDERS_STORAGE_KEY = 'studio.deleted_process_areas';

function getStoredDeletedFolders(): Set<string> {
  try {
    const raw = localStorage.getItem(DELETED_FOLDERS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return new Set(parsed.map((s) => String(s).toLowerCase()));
      }
    }
  } catch {
    // ignore
  }
  return new Set();
}

function storeDeletedFolders(set: Set<string>): void {
  try {
    localStorage.setItem(DELETED_FOLDERS_STORAGE_KEY, JSON.stringify(Array.from(set)));
  } catch {
    // ignore
  }
}

export function ObjectBrowser({
  initialAppId,
  initialObjectName,
  onSelectionChange,
  scannerContent,
}: {
  initialAppId?: string;
  initialObjectName?: string;
  onSelectionChange?: (appId: string, objectName?: string) => void;
  scannerContent?: React.ReactNode;
} = {}) {
  const [appIds, setAppIds] = useState<string[]>([]);
  const [appIdTags, setAppIdTags] = useState<Record<string, string>>({});
  const [processAreas, setProcessAreas] = useState<string[]>([]);
  const [domain, setDomain] = useState('');
  const [appId, setAppId] = useState('');
  const [objects, setObjects] = useState<ObjectControl[]>([]);
  const [filter, setFilter] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'browse' | 'scan'>('browse');
  const [repoExpanded, setRepoExpanded] = useState(true);
  const [expandedDomains, setExpandedDomains] = useState<Record<string, boolean>>({});

  // Drag and Drop & Folder Management states
  const [draggingAppId, setDraggingAppId] = useState<string | null>(null);
  const [dragOverDomain, setDragOverDomain] = useState<string | null>(null);
  const [showNewFolderModal, setShowNewFolderModal] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [folderToDelete, setFolderToDelete] = useState<string | null>(null);
  const [deleteConfirmInput, setDeleteConfirmInput] = useState('');
  const [appIdToDelete, setAppIdToDelete] = useState<string | null>(null);
  const [deleteAppIdConfirmInput, setDeleteAppIdConfirmInput] = useState('');
  const [deletedFolders, setDeletedFolders] = useState<Set<string>>(() => getStoredDeletedFolders());

  const [selectedName, setSelectedName] = useState<string | undefined>(undefined);
  const [highlighting, setHighlighting] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editDraft, setEditDraft] = useState({ name: '', label: '' });
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

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
  const [reconciling, setReconciling] = useState(false);
  const [reconcileResult, setReconcileResult] = useState<ObjectReconcileResult | null>(null);

  // Layout UI states
  const [copiedField, setCopiedField] = useState<string | null>(null);

  // What this App ID's capture covers. The library showed what HAS been captured and nothing
  // about the state it is in, so a stale capture looked exactly like a fresh one.
  const [coverage, setCoverage] = useState<ObjectCoverage | null>(null);

  const domainOf = useCallback((id: string) => appIdTags[id] || UNTAGGED, [appIdTags]);

  function refreshTags() {
    api.listTags('appId').then(setAppIdTags).catch(() => undefined);
    api.listProcessAreas().then(setProcessAreas).catch(() => undefined);
  }

  function refreshCoverage(forAppId: string) {
    if (!forAppId) return setCoverage(null);
    api.getObjectCoverage()
      .then((all) => setCoverage(all.find((entry) => entry.appId === forAppId) ?? null))
      // Coverage is context, not the page — losing it must not take the object list with it.
      .catch(() => setCoverage(null));
  }

  function refreshObjects() {
    if (!appId) return;
    api
      .listObjects(appId)
      .then((res) => {
        setObjects(res);
        if (res.length > 0 && !selectedName) {
          setSelectedName(res[0].name);
        }
      })
      .catch((e) => setError(String(e)));
  }

  async function handleCreateFolder() {
    const name = newFolderName.trim();
    if (!name) return;
    setActionError(null);
    try {
      setDeletedFolders((prev) => {
        const next = new Set(prev);
        next.delete(name.toLowerCase());
        storeDeletedFolders(next);
        return next;
      });
      try {
        await api.addProcessArea(name);
      } catch {
        // Fallback if backend server was started prior to route addition
      }
      refreshTags();
      setExpandedDomains((prev) => ({ ...prev, [name]: true }));
      setDomain(name);
      setNewFolderName('');
      setShowNewFolderModal(false);
    } catch (e) {
      setActionError(String(e));
    }
  }

  async function handleDeleteFolder() {
    if (!folderToDelete || deleteConfirmInput !== 'DELETE') return;
    const target = folderToDelete;
    setActionError(null);
    try {
      setDeletedFolders((prev) => {
        const next = new Set([...prev, target.toLowerCase()]);
        storeDeletedFolders(next);
        return next;
      });
      try {
        await api.deleteProcessArea(target);
      } catch {
        // Fallback for un-restarted server instance: untag all App IDs in this folder
        const childAppIds = appIds.filter((id) => domainOf(id) === target);
        await Promise.all(childAppIds.map((id) => api.setTag('appId', id, '')));
      }
      setFolderToDelete(null);
      setDeleteConfirmInput('');
      refreshTags();
      if (domain === target) {
        setDomain('');
      }
    } catch (e) {
      setActionError(String(e));
    }
  }

  async function handleDeleteAppId() {
    if (!appIdToDelete || deleteAppIdConfirmInput !== 'DELETE') return;
    const target = appIdToDelete;
    setActionError(null);
    try {
      await api.deleteAppId(target);
      setAppIdToDelete(null);
      setDeleteAppIdConfirmInput('');
      const updatedIds = await api.listAppIds();
      setAppIds(updatedIds);
      if (appId === target) {
        setAppId(updatedIds.length > 0 ? updatedIds[0] : '');
        setObjects([]);
      }
      refreshTags();
    } catch (e) {
      setActionError(String(e));
    }
  }

  useEffect(() => {
    api.listAppIds().then((ids) => {
      setAppIds(ids);
      if (ids.length > 0 && !appId) {
        const firstId = initialAppId && ids.includes(initialAppId) ? initialAppId : ids[0];
        setAppId(firstId);
      }
    }).catch((e) => setError(String(e)));
    refreshTags();
  }, []);

  useEffect(() => {
    if (!initialAppId || initialAppId === appId || !appIds.includes(initialAppId)) return;
    setDomain(domainOf(initialAppId));
    setAppId(initialAppId);
  }, [initialAppId, appId, appIds, domainOf]);

  useEffect(() => {
    if (appId && appIdTags[appId] && !domain) {
      setDomain(appIdTags[appId]);
    }
  }, [appId, appIdTags, domain]);

  useEffect(() => {
    setSelectedName(undefined);
    setEditing(false);
    setReconcileResult(null);
    if (!appId) {
      setObjects([]);
      setCoverage(null);
      return;
    }
    refreshObjects();
    refreshCoverage(appId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appId]);

  useEffect(() => {
    if (!initialObjectName || objects.length === 0) return;
    if (objects.some((object) => object.name === initialObjectName)) {
      setSelectedName(initialObjectName);
    }
  }, [initialObjectName, objects]);

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
  const rawDomains = processAreas.length > 0 ? Array.from(new Set([...processAreas, ...domains])).sort() : domains;
  const allDomains = rawDomains.filter((d) => !deletedFolders.has(d.toLowerCase()));

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

  function copyToClipboard(text: string, fieldName: string) {
    void navigator.clipboard.writeText(text).then(() => {
      setCopiedField(fieldName);
      setTimeout(() => setCopiedField(null), 1800);
    });
  }

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
      if (renameNote) setActionError(renameNote.trim());
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
      refreshObjects();
    } catch (e) {
      setActionError(String(e));
    } finally {
      setReverifying(false);
    }
  }

  async function reconcileAll() {
    if (objects.length === 0) return;
    setReconciling(true);
    setActionError(null);
    try {
      const result = await api.reconcileObjects(appId);
      setReconcileResult(result);
      refreshObjects();
    } catch (e) {
      setActionError(String(e));
    } finally {
      setReconciling(false);
    }
  }

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
      setSelectedName(undefined);
      onSelectionChange?.(appId, undefined);
      refreshObjects();
    } catch (e) {
      setActionError(String(e));
    } finally {
      setDeleting(false);
    }
  }

  const reorderable = !filter.trim();

  return (
    <div className="obj-lib-split-container">
      {/* LEFT COLUMN: Windows Explorer Style Tree Navigation Panel */}
      <aside className="obj-lib-tree-aside">
        <div className="obj-lib-tree-header">
          <div className="title-group">
            <Folder size={16} style={{ color: '#0284c7' }} />
            <span>Object Library</span>
          </div>
          <button
            type="button"
            className="btn-tree-add-folder"
            onClick={() => setShowNewFolderModal(true)}
            title="Create New Folder"
          >
            <FolderPlus size={15} />
          </button>
        </div>

        <div className="obj-lib-tree-body">
          {/* Root Repositories Folder Node */}
          <div
            className="obj-tree-folder-row root-repo-row"
            onClick={() => setRepoExpanded((v) => !v)}
          >
            <ChevronDown
              size={14}
              className="tree-chevron"
              style={{
                transform: repoExpanded ? 'none' : 'rotate(-90deg)',
                transition: 'transform 0.15s ease',
              }}
            />
            {repoExpanded ? (
              <FolderOpen size={16} style={{ color: '#2563eb' }} />
            ) : (
              <Folder size={16} style={{ color: '#2563eb' }} />
            )}
            <span className="folder-name" style={{ fontWeight: 700, color: '#0f172a' }}>Repositories</span>
            <span className="folder-count">{allDomains.length}</span>
            <div className="btn-tree-folder-delete-placeholder" />
          </div>

          {/* Process Area Folders nested under Repositories */}
          {repoExpanded && (
            <div className="obj-tree-children-list root-repo-children">
              {allDomains.map((d) => {
                const isExpanded = expandedDomains[d] ?? false;
                const childAppIds = appIds.filter((id) => domainOf(id) === d);
                const isDomainActive = domain === d && viewMode === 'browse';

                return (
                  <div key={d} className="tree-folder-group">
                    <div
                      className={`obj-tree-folder-row ${isDomainActive ? 'active-domain' : ''} ${dragOverDomain === d ? 'drop-target' : ''}`}
                      onDragOver={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        e.dataTransfer.dropEffect = 'move';
                        if (dragOverDomain !== d) setDragOverDomain(d);
                      }}
                      onDragLeave={(e) => {
                        e.stopPropagation();
                        setDragOverDomain((cur) => (cur === d ? null : cur));
                      }}
                      onDrop={async (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        const idToMove = e.dataTransfer.getData('text/plain') || draggingAppId;
                        setDragOverDomain(null);
                        setDraggingAppId(null);
                        if (idToMove) {
                          const targetArea = d === UNTAGGED ? '' : d;
                          await api.setTag('appId', idToMove, targetArea);
                          refreshTags();
                        }
                      }}
                      onClick={() => {
                        setDomain(d);
                        setExpandedDomains((prev) => ({ ...prev, [d]: !(prev[d] ?? false) }));
                        if (childAppIds.length > 0 && !childAppIds.includes(appId)) {
                          setAppId(childAppIds[0]);
                          setViewMode('browse');
                          onSelectionChange?.(childAppIds[0], undefined);
                        }
                      }}
                    >
                      <ChevronDown
                        size={14}
                        className="tree-chevron"
                        style={{
                          transform: isExpanded ? 'none' : 'rotate(-90deg)',
                          transition: 'transform 0.15s ease',
                          opacity: childAppIds.length > 0 ? 1 : 0.3,
                        }}
                      />
                      {isExpanded ? (
                        <FolderOpen size={15} style={{ color: '#0284c7' }} />
                      ) : (
                        <Folder size={15} style={{ color: '#0284c7' }} />
                      )}
                      <span className="folder-name">{d}</span>
                      <span className="folder-count">{childAppIds.length}</span>

                      {d !== UNTAGGED ? (
                        <button
                          type="button"
                          className="btn-tree-folder-delete"
                          title={`Delete folder "${d}"`}
                          onClick={(e) => {
                            e.stopPropagation();
                            setFolderToDelete(d);
                            setDeleteConfirmInput('');
                          }}
                        >
                          <Trash2 size={13} />
                        </button>
                      ) : (
                        <div className="btn-tree-folder-delete-placeholder" />
                      )}
                    </div>

                    {isExpanded && (
                      <div className="obj-tree-children-list">
                        {childAppIds.length === 0 ? (
                          <div className="tree-empty-item">(no App IDs)</div>
                        ) : (
                          childAppIds.map((id) => {
                            const isAppActive = appId === id && viewMode === 'browse';
                            return (
                              <div
                                key={id}
                                draggable={true}
                                onDragStart={(e) => {
                                  e.stopPropagation();
                                  e.dataTransfer.setData('text/plain', id);
                                  e.dataTransfer.effectAllowed = 'move';
                                  setDraggingAppId(id);
                                }}
                                onDragEnd={() => {
                                  setDraggingAppId(null);
                                  setDragOverDomain(null);
                                }}
                                className={`obj-tree-child-item ${isAppActive ? 'selected' : ''} ${draggingAppId === id ? 'dragging-tree-item' : ''}`}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setDomain(d);
                                  setAppId(id);
                                  setViewMode('browse');
                                  onSelectionChange?.(id, undefined);
                                }}
                              >
                                <FileText size={14} style={{ color: isAppActive ? '#2563eb' : '#64748b', flexShrink: 0 }} />
                                <span className="app-id-name" style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{id}</span>
                                <button
                                  type="button"
                                  className="btn-tree-appid-delete"
                                  title={`Delete App ID "${id}"`}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setAppIdToDelete(id);
                                    setDeleteAppIdConfirmInput('');
                                  }}
                                >
                                  <Trash2 size={13} />
                                </button>
                              </div>
                            );
                          })
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="obj-lib-tree-action-bar">
          <button
            type="button"
            className={`btn-scan-new-object ${viewMode === 'scan' ? 'active' : ''}`}
            onClick={() => setViewMode('scan')}
          >
            <Plus size={15} />
            <span>Scan New Object</span>
          </button>
        </div>

        <div className="obj-lib-tree-footer">
          {allDomains.length} Process Areas · {appIds.length} App IDs
        </div>
      </aside>

      {/* MIDDLE COLUMN: Controls Table & Content Canvas */}
      <main className="obj-lib-main-canvas">
        {viewMode === 'scan' ? (
          <div className="obj-lib-scan-section stack" style={{ gap: '1rem', flex: 1, overflowY: 'auto' }}>
            <div className="obj-lib-top-header">
              <div className="obj-lib-title-row">
                <h2>Scan New Object</h2>
                <span className="app-id-pill-badge" style={{ background: '#eff6ff', color: '#1d4ed8', borderColor: '#bfdbfe' }}>
                  Live Capture Session
                </span>
              </div>
            </div>
            {scannerContent || (
              <div className="clean-scan-card panel stack" style={{ padding: '1.25rem', background: '#f8fafc', borderRadius: '8px', border: '1px solid var(--border)', gap: '0.85rem' }}>
                <p style={{ margin: 0, fontSize: '0.88rem', color: 'var(--text-soft)', lineHeight: 1.4 }}>
                  Connect to your live SAP environment to scan, pick, and curate reusable page controls.
                </p>
              </div>
            )}
          </div>
        ) : (
          <>
            {/* Top Header */}
            <div className="obj-lib-top-header">
              <div className="obj-lib-title-row">
                <h2>{appId || 'Select an App ID'}</h2>
                {appId && <span className="app-id-pill-badge">App ID</span>}
                <span className="obj-lib-controls-count">
                  {objects.length} controls <Info size={14} />
                </span>
                {coverage && coverage.captured > 0 && (
                  <span
                    className="obj-coverage-chip"
                    title={
                      'Reconcile checks every stored object against the live screen. '
                      + 'Nothing here has been checked since it was captured.'
                    }
                  >
                    {coverage.drifted > 0 && <strong className="drifted">{coverage.drifted} drifted</strong>}
                    {coverage.neverVerified > 0 && (
                      <span>{coverage.neverVerified} never verified</span>
                    )}
                    {coverage.drifted === 0 && coverage.neverVerified === 0 && (
                      <span>all {coverage.verified} verified</span>
                    )}
                  </span>
                )}
              </div>
              {filter && (
                <button type="button" className="btn-clear-filters" onClick={() => setFilter('')}>
                  Clear filters
                </button>
              )}
            </div>

            {/* Global Filter Bar */}
            <div className="row" style={{ marginBottom: '0.65rem' }}>
              <input
                type="text"
                aria-label="Filter saved objects"
                placeholder="Filter controls by name, label, type, or domain…"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                style={{ flex: 1 }}
              />
            </div>

            {/* A Test naming an object this App ID does not hold. It is what blocks publishing,
                and it is otherwise invisible until a run fails or a publish is attempted —
                usually the result of a rename or a delete that left the Test behind. */}
            {coverage && coverage.missing.length > 0 && (
              <div className="fiori-message-strip error" role="alert" style={{ marginBottom: '0.65rem' }}>
                <strong>{coverage.missing.length} object{coverage.missing.length === 1 ? '' : 's'} referenced but not captured.</strong>{' '}
                {coverage.missing.map((entry) => `${entry.name} (${entry.referencedBy.join(', ')})`).join(' · ')}
              </div>
            )}

            {error && <AsyncFeedback state="error" message={error} onRetry={refreshObjects} />}
            {actionError && <AsyncFeedback state="error" message={actionError} />}
            {notFound && <span className="error-text" style={{ marginBottom: '0.5rem' }}>Not found on screen — is a scan session open on this app?</span>}
            <span className="sr-only" role="status" aria-live="polite">{reorderAnnouncement}</span>

            {/* Reconcile Banner if active */}
            {reconcileResult && (
              <div
                className={`fiori-message-strip ${reconcileResult.missing === 0 ? 'success' : reconcileResult.verified + reconcileResult.drifted === 0 ? 'error' : 'warning'}`}
                style={{ marginBottom: '0.65rem' }}
              >
                Reconciled {reconcileResult.total} Object{reconcileResult.total === 1 ? '' : 's'} for {appId} against the current screen:{' '}
                {reconcileResult.verified} verified, {reconcileResult.drifted} drifted, {reconcileResult.missing} not found on this screen.
              </div>
            )}

            {/* Top Right Action Toolbar */}
            {appId && (
              <div className="obj-lib-actions-row">
                <div className="obj-lib-actions-group">
                  <button
                    type="button"
                    className="pill pill-primary"
                    disabled={objects.length === 0 || reconciling || editing}
                    onClick={reconcileAll}
                    title="Check every stored Object for this App ID against the currently open scan session's live screen"
                  >
                    <RefreshCw size={13} /> {reconciling ? 'Reconciling…' : `RECONCILE ALL (${objects.length})`}
                  </button>
                  <button type="button" className="pill pill-neutral" disabled={!selected || highlighting || editing} onClick={highlight}>
                    <Target size={13} /> {highlighting ? 'Highlighting…' : 'HIGHLIGHT'}
                  </button>
                  <button type="button" className="pill pill-neutral" disabled={!selected || editing || reverifying} onClick={reverify}>
                    <ShieldCheck size={13} /> {reverifying ? 'Reverifying…' : 'REVERIFY'}
                  </button>
                  <button type="button" className="pill pill-neutral" disabled={!selected || editing} onClick={startEdit}>
                    <Plus size={13} /> EDIT
                  </button>
                  <button type="button" className="pill pill-danger" disabled={!selected || editing || deleting} onClick={deleteSelected}>
                    <Trash2 size={13} /> {deleting ? 'Deleting…' : 'DELETE'}
                  </button>
                </div>
              </div>
            )}

            {/* Main Controls Table */}
            <div className="obj-lib-table-container">
              {objects.length === 0 ? (
                <EmptyState title="No saved objects" description="Open a scan session and capture controls for this App ID." compact />
              ) : (
                <table className="obj-table-clean">
                  <thead>
                    <tr>
                      <th scope="col" style={{ width: '28px' }}></th>
                      <th scope="col" style={{ width: '32px' }}></th>
                      <th scope="col" style={{ width: '45px' }}>#</th>
                      <th scope="col">NAME</th>
                      <th scope="col">TYPE</th>
                      <th scope="col">LABEL</th>
                      <th scope="col" style={{ width: '60px', textAlign: 'right' }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((o, i) => {
                      const isSelected = o.name === selectedName;
                      const isEditingRow = isSelected && editing;
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
                          className={[isSelected ? 'selected-row' : '', dragIndex === i ? 'dragging' : '', dragOverIndex === i ? 'drag-over' : ''].filter(Boolean).join(' ')}
                          onClick={() => {
                            setSelectedName(o.name);
                            setEditing(false);
                            setNotFound(false);
                            setActionError(null);
                            onSelectionChange?.(appId, o.name);
                          }}
                        >
                          <td style={{ color: 'var(--text-soft)', cursor: 'grab', textAlign: 'center', width: '28px' }}>
                            <GripVertical size={14} style={{ opacity: 0.5 }} />
                          </td>
                          <td style={{ textAlign: 'center', width: '32px' }} onClick={(e) => e.stopPropagation()}>
                            <input
                              type="radio"
                              name={`selected-control-${appId}`}
                              checked={isSelected}
                              onChange={() => {
                                setSelectedName(o.name);
                                setEditing(false);
                                setNotFound(false);
                                setActionError(null);
                                onSelectionChange?.(appId, o.name);
                              }}
                              aria-label={`Select control ${o.name}`}
                              style={{ cursor: 'pointer' }}
                            />
                          </td>
                          <td style={{ fontWeight: 600, color: 'var(--text-soft)', width: '45px' }}>{i + 1}</td>
                          <td style={{ fontWeight: 700 }}>
                            {isEditingRow ? (
                              <input
                                aria-label={`Rename object ${o.name}`}
                                type="text"
                                value={editDraft.name}
                                onChange={(e) => setEditDraft((d) => ({ ...d, name: e.target.value }))}
                                onClick={(e) => e.stopPropagation()}
                                style={{ minWidth: '10rem' }}
                              />
                            ) : (
                              o.name
                            )}
                          </td>
                          <td style={{ color: 'var(--text-soft)' }}>
                            {formatControlType(o.controlType)}
                          </td>
                          <td style={{ color: 'var(--text-soft)' }}>
                            {isEditingRow ? (
                              <div className="row" style={{ gap: '0.4rem', alignItems: 'center' }} onClick={(e) => e.stopPropagation()}>
                                <input
                                  aria-label={`Edit label for object ${o.name}`}
                                  type="text"
                                  value={editDraft.label}
                                  onChange={(e) => setEditDraft((d) => ({ ...d, label: e.target.value }))}
                                  style={{ minWidth: '8rem' }}
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
                          <td style={{ textAlign: 'right', whiteSpace: 'nowrap', width: '60px' }} onClick={(e) => e.stopPropagation()}>
                            <div style={{ display: 'inline-flex', gap: '0.2rem', alignItems: 'center', justifyContent: 'flex-end' }}>
                              <button
                                type="button"
                                className="btn-table-arrow"
                                disabled={i === 0 || !reorderable}
                                onClick={() => reorder(i, i - 1)}
                                title="Move up"
                              >
                                <ArrowUp size={13} />
                              </button>
                              <button
                                type="button"
                                className="btn-table-arrow"
                                disabled={i === filtered.length - 1 || !reorderable}
                                onClick={() => reorder(i, i + 1)}
                                title="Move down"
                              >
                                <ArrowDown size={13} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </>
        )}
      </main>

      {/* RIGHT COLUMN: Selector Details Panel */}
      {viewMode === 'browse' && selected && (
        <aside className="obj-lib-inspector-aside">
          <div className="inspector-top-bar">
            <h3>Selector Details</h3>
            <button type="button" className="btn-close-aside" onClick={() => setSelectedName(undefined)} title="Close Details">
              <X size={16} />
            </button>
          </div>

          <div className="inspector-scroll-content">
            <div className="inspector-header-title">
              <h4>{selected.name}</h4>
              <span className="control-badge-pill">{formatControlType(selected.controlType)}</span>
            </div>

            <div className="inspector-field-group">
              <label>CONTROL ID</label>
              <div className="inspector-code-box">
                <code>{selected.controlId}</code>
                <button
                  type="button"
                  className="btn-copy-icon"
                  onClick={() => copyToClipboard(selected.controlId, 'controlId')}
                  title="Copy Control ID"
                >
                  {copiedField === 'controlId' ? <Check size={13} style={{ color: '#059669' }} /> : <Copy size={13} />}
                </button>
              </div>
            </div>

            <div className="inspector-field-group">
              <label>BINDING PATH</label>
              <div className="inspector-code-box">
                <code>{selected.bindingPath || 'None'}</code>
                {selected.bindingPath && (
                  <button
                    type="button"
                    className="btn-copy-icon"
                    onClick={() => copyToClipboard(selected.bindingPath!, 'bindingPath')}
                    title="Copy Binding Path"
                  >
                    {copiedField === 'bindingPath' ? <Check size={13} style={{ color: '#059669' }} /> : <Copy size={13} />}
                  </button>
                )}
              </div>
            </div>

            <div className="inspector-field-group">
              <label>USAGE</label>
              <span className="inspector-text-value">
                {usageError ? (
                  <span className="error-text">{usageError}</span>
                ) : usage === null ? (
                  'Checking…'
                ) : usage.length === 0 ? (
                  `Input for ${selected.label || selected.name}`
                ) : (
                  `Used by ${usage.length} Test(s): ${usage.join(', ')}`
                )}
              </span>
            </div>

            <div className="inspector-field-group">
              <label>VERIFICATION STATUS</label>
              <div>
                <span className="inspector-verification-tag">
                  <Clock size={13} />
                  <span>{verificationLabel(selected.verificationStatus)}</span>
                </span>
              </div>
            </div>

            {reverifyOutcome && (
              <div className={`fiori-message-strip ${reverifyOutcome.outcome === 'verified' ? 'success' : reverifyOutcome.outcome === 'drifted' ? 'warning' : 'error'}`}>
                {reverifyOutcome.outcome === 'verified' && 'Live screen matches the stored control.'}
                {reverifyOutcome.outcome === 'missing' && 'Not found on live screen.'}
                {reverifyOutcome.outcome === 'drifted' && reverifyOutcome.live && (
                  <div>
                    ID changed to <code>{reverifyOutcome.live.controlId}</code>
                    <button type="button" className="primary" disabled={saving} onClick={applyReverifyFix} style={{ marginTop: '0.3rem' }}>
                      Update stored control
                    </button>
                  </div>
                )}
              </div>
            )}

            {verifications.length > 0 && (
              <details style={{ fontSize: '0.75rem' }}>
                <summary style={{ cursor: 'pointer', color: 'var(--text-soft)' }}>Verification history ({verifications.length})</summary>
                <ul style={{ margin: '0.3rem 0 0', paddingLeft: '1.2rem' }}>
                  {verifications.map((v, i) => (
                    <li key={i}>
                      {new Date(v.verifiedAt).toLocaleDateString()} — {v.outcome}
                    </li>
                  ))}
                </ul>
              </details>
            )}

            <div className="inspector-field-group">
              <label>SELECTOR (PRIMARY)</label>
              <div className="inspector-json-block">
                <pre>
{JSON.stringify(
  {
    type: 'css',
    value: `#${selected.controlId}`,
  },
  null,
  2
)}
                </pre>
                <button
                  type="button"
                  className="btn-copy-icon"
                  onClick={() => copyToClipboard(JSON.stringify({ type: 'css', value: `#${selected.controlId}` }, null, 2), 'selector')}
                  title="Copy Selector JSON"
                >
                  {copiedField === 'selector' ? <Check size={13} style={{ color: '#059669' }} /> : <Copy size={13} />}
                </button>
              </div>
            </div>

            <button type="button" className="inspector-bottom-btn" onClick={() => highlight()}>
              Highlight Control <ExternalLink size={13} />
            </button>
          </div>
        </aside>
      )}

      {/* Create New Folder Modal */}
      {showNewFolderModal && (
        <div className="modal-backdrop" onClick={() => setShowNewFolderModal(false)}>
          <div className="modal-card" style={{ maxWidth: '420px' }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Create New Process Area Folder</h3>
              <button type="button" className="btn-close-aside" onClick={() => setShowNewFolderModal(false)}>
                <X size={16} />
              </button>
            </div>
            <div className="modal-body stack" style={{ gap: '0.85rem' }}>
              <p className="hint" style={{ margin: 0 }}>
                Enter a folder name to organize your SAP App IDs:
              </p>
              <input
                type="text"
                aria-label="New folder name"
                placeholder="e.g. Sales, Procurement, Inventory"
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && newFolderName.trim()) {
                    void handleCreateFolder();
                  }
                }}
              />
            </div>
            <div className="modal-footer row" style={{ justifyContent: 'flex-end', gap: '0.5rem' }}>
              <button type="button" className="ghost" onClick={() => setShowNewFolderModal(false)}>
                Cancel
              </button>
              <button
                type="button"
                className="primary"
                disabled={!newFolderName.trim()}
                onClick={() => void handleCreateFolder()}
              >
                Create Folder
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Folder Safety Confirmation Modal */}
      {folderToDelete && (() => {
        const folderAppIdCount = appIds.filter((id) => domainOf(id) === folderToDelete).length;
        return (
          <div className="modal-backdrop" onClick={() => setFolderToDelete(null)}>
            <div className="modal-card" style={{ maxWidth: '440px' }} onClick={(e) => e.stopPropagation()}>
              <div className="modal-header">
                <h3>Delete Folder "{folderToDelete}"</h3>
                <button type="button" className="btn-close-aside" onClick={() => setFolderToDelete(null)}>
                  <X size={16} />
                </button>
              </div>
              <div className="modal-body stack" style={{ gap: '0.85rem' }}>
                <div className="fiori-message-strip error">
                  <p style={{ margin: 0 }}>
                    This will remove the folder <strong>"{folderToDelete}"</strong> and untag its <strong>{folderAppIdCount}</strong> App ID{folderAppIdCount === 1 ? '' : 's'}.
                  </p>
                </div>
                <p className="hint" style={{ margin: 0, fontSize: '0.82rem', lineHeight: 1.4 }}>
                  {folderAppIdCount > 0 ? (
                    <>The <strong>{folderAppIdCount}</strong> App ID{folderAppIdCount === 1 ? '' : 's'} and stored controls inside this folder will not be lost — they will be safely moved to <strong>(untagged)</strong>.</>
                  ) : (
                    <>App IDs and stored controls inside this folder will not be lost — they will be safely moved to <strong>(untagged)</strong>.</>
                  )}
                </p>
                <label style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text)' }}>
                  To confirm deletion, please type <strong style={{ color: '#dc2626' }}>DELETE</strong> below:
                </label>
              <input
                type="text"
                aria-label="Type DELETE to confirm folder deletion"
                placeholder='Type "DELETE" to confirm'
                value={deleteConfirmInput}
                onChange={(e) => setDeleteConfirmInput(e.target.value)}
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && deleteConfirmInput === 'DELETE') {
                    void handleDeleteFolder();
                  }
                }}
                style={{
                  borderColor: deleteConfirmInput === 'DELETE' ? '#16a34a' : undefined,
                }}
              />
            </div>
            <div className="modal-footer row" style={{ justifyContent: 'flex-end', gap: '0.5rem' }}>
              <button type="button" className="ghost" onClick={() => setFolderToDelete(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="danger-solid"
                disabled={deleteConfirmInput !== 'DELETE'}
                onClick={() => void handleDeleteFolder()}
              >
                Delete Folder
              </button>
            </div>
          </div>
        </div>
      );
    })()}

      {/* Delete App ID Safety Confirmation Modal */}
      {appIdToDelete && (() => {
        return (
          <div className="modal-backdrop" onClick={() => setAppIdToDelete(null)}>
            <div className="modal-card" style={{ maxWidth: '440px' }} onClick={(e) => e.stopPropagation()}>
              <div className="modal-header">
                <h3>Delete App ID "{appIdToDelete}"</h3>
                <button type="button" className="btn-close-aside" onClick={() => setAppIdToDelete(null)}>
                  <X size={16} />
                </button>
              </div>
              <div className="modal-body stack" style={{ gap: '0.85rem' }}>
                <div className="fiori-message-strip error">
                  <p style={{ margin: 0 }}>
                    This will remove the App ID <strong>"{appIdToDelete}"</strong> and permanently delete all its stored object controls.
                  </p>
                </div>
                <p className="hint" style={{ margin: 0, fontSize: '0.82rem', lineHeight: 1.4 }}>
                  This action cannot be undone. All control definitions saved for <strong>{appIdToDelete}</strong> will be permanently deleted.
                </p>
                <label style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text)' }}>
                  To confirm deletion, please type <strong style={{ color: '#dc2626' }}>DELETE</strong> below:
                </label>
                <input
                  type="text"
                  aria-label="Type DELETE to confirm App ID deletion"
                  placeholder='Type "DELETE" to confirm'
                  value={deleteAppIdConfirmInput}
                  onChange={(e) => setDeleteAppIdConfirmInput(e.target.value)}
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && deleteAppIdConfirmInput === 'DELETE') {
                      void handleDeleteAppId();
                    }
                  }}
                  style={{
                    borderColor: deleteAppIdConfirmInput === 'DELETE' ? '#16a34a' : undefined,
                  }}
                />
              </div>
              <div className="modal-footer row" style={{ justifyContent: 'flex-end', gap: '0.5rem' }}>
                <button type="button" className="ghost" onClick={() => setAppIdToDelete(null)}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="danger-solid"
                  disabled={deleteAppIdConfirmInput !== 'DELETE'}
                  onClick={() => void handleDeleteAppId()}
                >
                  Delete App ID
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
