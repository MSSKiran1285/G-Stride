import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ChevronDown, FileCode2, Folder, FolderOpen, FolderPlus, Plus, Search, Trash2, X } from 'lucide-react';
import { api } from '../api';
import type { CaptureRequest, TestApplication, TestCase, TestLibraryItem, TestLibraryStatus } from '../types';
import { TestCaseEditor } from './TestCaseEditor';
import { AsyncFeedback, TableFrame } from './WorkspacePrimitives';

const APPLICATIONS: TestApplication[] = ['SAP', 'Salesforce', 'Oracle', 'ServiceNow'];
const UNTAGGED = '(untagged)';
// Sentinel value for the "create one" entry at the bottom of the process area dropdown. It is not a
// selectable area, so it must not collide with a real folder name.
const NEW_AREA_OPTION = '__new_process_area__';

function fileStem(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function statusLabel(status: TestLibraryStatus): string {
  return status === 'published' ? 'Published' : status === 'ready' ? 'Legacy ready' : 'Draft';
}

function areaOf(item: TestLibraryItem): string {
  return item.processArea || UNTAGGED;
}

interface TestLibraryProps {
  initialFile?: string;
  onSelectedFileChange: (file?: string) => void;
  onDirtyChange?: (dirty: boolean) => void;
  onRequestCapture?: (request: CaptureRequest) => void;
}

export function TestLibrary({ initialFile, onSelectedFileChange, onDirtyChange, onRequestCapture }: TestLibraryProps) {
  const [items, setItems] = useState<TestLibraryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);
  const [businessName, setBusinessName] = useState('');
  const [fileName, setFileName] = useState('');
  const [application, setApplication] = useState<TestApplication>('SAP');
  const [processArea, setProcessArea] = useState('');
  const [startingPoint, setStartingPoint] = useState<'blank' | 'template'>('blank');
  const [templateFile, setTemplateFile] = useState('');
  const [creating, setCreating] = useState(false);
  const [search, setSearch] = useState('');
  const [applicationFilter, setApplicationFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  // The tree is the process-area filter, so there is no separate select for it.
  const [selectedArea, setSelectedArea] = useState<string | null>(null);
  const [rootExpanded, setRootExpanded] = useState(true);
  const [expandedAreas, setExpandedAreas] = useState<Record<string, boolean>>({});
  // Folders come from the same registry the Object Library uses, so a folder created in either
  // workspace exists in both, and a brand new empty folder is visible before anything is filed in it.
  const [registeredAreas, setRegisteredAreas] = useState<string[]>([]);
  const [showNewFolderModal, setShowNewFolderModal] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [draggingFile, setDraggingFile] = useState<string | null>(null);
  const [dragOverArea, setDragOverArea] = useState<string | null>(null);
  // Deletion is confirmed rather than immediate: both remove real files, and there is no undo.
  const [testToDelete, setTestToDelete] = useState<TestLibraryItem | null>(null);
  const [folderToDelete, setFolderToDelete] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  function loadLibrary() {
    setLoading(true);
    api.listTestLibrary()
      .then((next) => {
        setItems(next);
        setError(null);
      })
      .catch((reason) => setError(String(reason)))
      .finally(() => setLoading(false));
    api.listProcessAreas()
      .then(setRegisteredAreas)
      .catch(() => setRegisteredAreas([]));
  }

  // Dropping a Test on a folder retags it. (untagged) is a view of "no process area", so dropping
  // there clears the tag rather than writing "(untagged)" as if it were a real folder name.
  async function moveTestToArea(file: string, area: string) {
    const target = area === UNTAGGED ? '' : area;
    const current = items.find((item) => item.file === file);
    if (current && (current.processArea ?? '') === target) return;
    try {
      await api.setTag('testCase', file, target);
      loadLibrary();
      setError(null);
    } catch (reason) {
      setError(String(reason));
    }
  }

  // Tried without force first: the server refuses when a Group or Pack still references the Test,
  // and that refusal is information the author needs, not an obstacle to route around.
  const [forceHint, setForceHint] = useState<string | null>(null);

  async function deleteTest(force: boolean) {
    if (!testToDelete) return;
    setDeleting(true);
    try {
      await api.deleteTestCase(testToDelete.file, force);
      if (initialFile === testToDelete.file) onSelectedFileChange(undefined);
      setTestToDelete(null);
      setForceHint(null);
      setError(null);
      loadLibrary();
    } catch (reason) {
      // A 409 means it is still referenced; offer the deliberate override rather than failing shut.
      setForceHint(String(reason));
    } finally {
      setDeleting(false);
    }
  }

  // Folders are a tag, so removing one never deletes a Test - the Tests inside become untagged.
  async function deleteFolder() {
    if (!folderToDelete) return;
    setDeleting(true);
    try {
      await Promise.all(
        (itemsByArea.get(folderToDelete) ?? []).map((item) => api.setTag('testCase', item.file, '')),
      );
      await api.deleteProcessArea(folderToDelete).catch(() => undefined);
      const next = await api.listProcessAreas().catch(() => registeredAreas);
      setRegisteredAreas(next);
      if (selectedArea === folderToDelete) setSelectedArea(null);
      setFolderToDelete(null);
      setError(null);
      loadLibrary();
    } catch (reason) {
      setError(String(reason));
    } finally {
      setDeleting(false);
    }
  }

  async function createFolder() {
    const name = newFolderName.trim();
    if (!name) return;
    try {
      await api.addProcessArea(name);
      const next = await api.listProcessAreas();
      setRegisteredAreas(next);
      setExpandedAreas((prev) => ({ ...prev, [name]: true }));
      setSelectedArea(name);
      // If the folder was created from the compose form's dropdown, land the selection on it.
      setProcessArea(name);
      setNewFolderName('');
      setShowNewFolderModal(false);
      setError(null);
    } catch (reason) {
      setError(String(reason));
    }
  }

  // Reloading whenever the centre pane returns to the list keeps the tree honest: a Test created or
  // renamed in the editor shows up in its folder instead of the tree quietly going stale.
  useEffect(() => {
    if (!initialFile) loadLibrary();
  }, [initialFile]);

  useEffect(() => {
    if (!initialFile) onDirtyChange?.(false);
  }, [initialFile, onDirtyChange]);

  // Opening a Test from the tree keeps its folder open, so the centre pane and the tree agree.
  useEffect(() => {
    if (!initialFile) return;
    const opened = items.find((item) => item.file === initialFile);
    if (!opened) return;
    setExpandedAreas((prev) => ({ ...prev, [areaOf(opened)]: true }));
  }, [initialFile, items]);

  // Every folder that exists: registered in the shared registry, or in use by a Test, or both.
  const processAreas = useMemo(() => {
    const named = items.map((item) => item.processArea).filter((value): value is string => Boolean(value));
    return Array.from(new Set([...registeredAreas, ...named])).sort((a, b) => a.localeCompare(b));
  }, [items, registeredAreas]);
  // Folders mirror the Object Library tree: every process area, plus (untagged) when it is used.
  const treeAreas = useMemo(() => {
    const areas = [...processAreas];
    if (items.some((item) => !item.processArea)) areas.push(UNTAGGED);
    return areas;
  }, [items, processAreas]);
  const itemsByArea = useMemo(() => {
    const grouped = new Map<string, TestLibraryItem[]>();
    for (const item of items) {
      const area = areaOf(item);
      if (!grouped.has(area)) grouped.set(area, []);
      grouped.get(area)!.push(item);
    }
    for (const list of grouped.values()) list.sort((a, b) => a.name.localeCompare(b.name));
    return grouped;
  }, [items]);

  const templateItems = useMemo(() => items.filter((item) => item.status !== 'draft'), [items]);
  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return items.filter((item) => {
      const matchesSearch = !query || `${item.name} ${item.file}`.toLowerCase().includes(query);
      const matchesArea = selectedArea === null || areaOf(item) === selectedArea;
      const matchesApplication = applicationFilter === 'all' || item.application === applicationFilter;
      const matchesStatus = statusFilter === 'all' || item.status === statusFilter;
      return matchesSearch && matchesArea && matchesApplication && matchesStatus;
    });
  }, [applicationFilter, items, search, selectedArea, statusFilter]);

  function updateBusinessName(value: string) {
    setBusinessName(value);
    setFileName(fileStem(value));
  }

  function resetCreationFields() {
    setBusinessName('');
    setFileName('');
    setApplication('SAP');
    setProcessArea('');
    setStartingPoint('blank');
    setTemplateFile('');
    setError(null);
  }

  // Guided creation always opens on a blank canvas, never on the leftovers of a cancelled attempt.
  function startComposing() {
    resetCreationFields();
    onSelectedFileChange(undefined);
    setComposing(true);
  }

  function cancelComposing() {
    resetCreationFields();
    setComposing(false);
  }

  function openTest(file: string) {
    setComposing(false);
    onSelectedFileChange(file);
  }

  async function createTest(event: React.FormEvent) {
    event.preventDefault();
    const stem = fileStem(fileName || businessName);
    if (!businessName.trim() || !stem) {
      setError('Enter a Test name and a valid identifier.');
      return;
    }
    if (startingPoint === 'template' && !templateFile) {
      setError('Choose an existing Test to use as the template.');
      return;
    }

    setCreating(true);
    setError(null);
    try {
      let source: TestCase | null = null;
      if (startingPoint === 'template') source = await api.getTestCase(templateFile);
      const next: TestCase = {
        name: businessName.trim(),
        application,
        version: 1,
        lifecycle: 'draft',
        steps: source ? structuredClone(source.steps) : [],
        contract: source?.contract ? structuredClone(source.contract) : { version: 1, inputs: [], outputs: [] },
      };
      const file = `${stem}.json`;
      await api.createTestCase(file, next, processArea.trim());
      resetCreationFields();
      setComposing(false);
      onSelectedFileChange(file);
    } catch (reason) {
      setError(String(reason));
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="obj-lib-split-container test-library-explorer">
      {/* LEFT COLUMN: Windows Explorer style tree, matching the Object Library */}
      <aside className="obj-lib-tree-aside">
        <div className="obj-lib-tree-header">
          <div className="title-group">
            <Folder size={16} style={{ color: '#0284c7' }} />
            <h2 id="testLibraryHeading">Test Library</h2>
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
          <div className="obj-tree-folder-row root-repo-row" onClick={() => setRootExpanded((v) => !v)}>
            <ChevronDown
              size={14}
              className="tree-chevron"
              style={{ transform: rootExpanded ? 'none' : 'rotate(-90deg)', transition: 'transform 0.15s ease' }}
            />
            {rootExpanded ? (
              <FolderOpen size={16} style={{ color: '#2563eb' }} />
            ) : (
              <Folder size={16} style={{ color: '#2563eb' }} />
            )}
            <span className="folder-name" style={{ fontWeight: 700, color: '#0f172a' }}>Tests</span>
            <span className="folder-count">{treeAreas.length}</span>
            <div className="btn-tree-folder-delete-placeholder" />
          </div>

          {rootExpanded && (
            <div className="obj-tree-children-list root-repo-children">
              {treeAreas.map((area) => {
                const isExpanded = expandedAreas[area] ?? false;
                const areaItems = itemsByArea.get(area) ?? [];
                const isAreaActive = selectedArea === area && !initialFile && !composing;

                return (
                  <div key={area} className="tree-folder-group">
                    <div
                      className={`obj-tree-folder-row ${isAreaActive ? 'active-domain' : ''} ${dragOverArea === area ? 'drop-target' : ''}`}
                      onDragOver={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        event.dataTransfer.dropEffect = 'move';
                        if (dragOverArea !== area) setDragOverArea(area);
                      }}
                      onDragLeave={(event) => {
                        event.stopPropagation();
                        setDragOverArea((current) => (current === area ? null : current));
                      }}
                      onDrop={async (event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        const file = event.dataTransfer.getData('text/plain') || draggingFile;
                        setDragOverArea(null);
                        setDraggingFile(null);
                        if (!file) return;
                        setExpandedAreas((prev) => ({ ...prev, [area]: true }));
                        await moveTestToArea(file, area);
                      }}
                      onClick={() => {
                        setComposing(false);
                        setSelectedArea(area);
                        onSelectedFileChange(undefined);
                        setExpandedAreas((prev) => ({ ...prev, [area]: !(prev[area] ?? false) }));
                      }}
                    >
                      <ChevronDown
                        size={14}
                        className="tree-chevron"
                        style={{
                          transform: isExpanded ? 'none' : 'rotate(-90deg)',
                          transition: 'transform 0.15s ease',
                          opacity: areaItems.length > 0 ? 1 : 0.3,
                        }}
                      />
                      {isExpanded ? (
                        <FolderOpen size={15} style={{ color: '#0284c7' }} />
                      ) : (
                        <Folder size={15} style={{ color: '#0284c7' }} />
                      )}
                      <span className="folder-name">{area}</span>
                      <span className="folder-count">{areaItems.length}</span>
                      {area === UNTAGGED ? (
                        // (untagged) is not a real folder, it is the absence of one.
                        <div className="btn-tree-folder-delete-placeholder" />
                      ) : (
                        <button
                          type="button"
                          className="btn-tree-folder-delete"
                          title={`Delete folder "${area}"`}
                          onClick={(event) => {
                            event.stopPropagation();
                            setFolderToDelete(area);
                          }}
                        >
                          <Trash2 size={13} />
                        </button>
                      )}
                    </div>

                    {isExpanded && (
                      <div className="obj-tree-children-list">
                        {areaItems.length === 0 ? (
                          <div className="tree-empty-item">(no Tests)</div>
                        ) : (
                          areaItems.map((item) => {
                            const isOpen = initialFile === item.file;
                            return (
                              <div
                                key={item.file}
                                draggable={true}
                                onDragStart={(event) => {
                                  event.stopPropagation();
                                  event.dataTransfer.setData('text/plain', item.file);
                                  event.dataTransfer.effectAllowed = 'move';
                                  setDraggingFile(item.file);
                                }}
                                onDragEnd={() => {
                                  setDraggingFile(null);
                                  setDragOverArea(null);
                                }}
                                className={`obj-tree-child-item ${isOpen ? 'selected' : ''} ${draggingFile === item.file ? 'dragging-tree-item' : ''}`}
                                title={`${item.file} — drag to move to another folder`}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  setSelectedArea(area);
                                  openTest(item.file);
                                }}
                              >
                                <FileCode2 size={14} style={{ color: isOpen ? '#2563eb' : '#64748b', flexShrink: 0 }} />
                                <span
                                  className="app-id-name"
                                  style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                                >
                                  {item.name}
                                </span>
                                <button
                                  type="button"
                                  className="btn-tree-appid-delete"
                                  title={`Delete Test "${item.name}"`}
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    setForceHint(null);
                                    setTestToDelete(item);
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
            className={`btn-scan-new-object ${composing ? 'active' : ''}`}
            onClick={startComposing}
          >
            <Plus size={15} />
            <span>Compose New Test</span>
          </button>
        </div>

        <div className="obj-lib-tree-footer">
          {treeAreas.length} Process Areas · {items.length} Tests
        </div>
      </aside>

      {/* CENTRE PANE: the open Test, guided creation, or the folder's results */}
      <main className="obj-lib-main-canvas">
        {initialFile ? (
          <div className="test-library-detail-pane">
            <div className="workspace-subheader">
              <button type="button" className="ghost" onClick={() => onSelectedFileChange(undefined)}>
                <ArrowLeft size={16} aria-hidden="true" /> Back to Test Library
              </button>
              <span className="hint">Stable route · {initialFile}</span>
            </div>
            <TestCaseEditor
              initialFile={initialFile}
              onSelectedFileChange={(file) => onSelectedFileChange(file)}
              onDirtyChange={onDirtyChange}
              showLibraryControls={false}
              onRequestCapture={onRequestCapture}
            />
          </div>
        ) : composing ? (
          <div className="test-library-compose-pane stack">
            <div className="obj-lib-top-header">
              <div className="obj-lib-title-row">
                <h2 id="newTestHeading">Compose New Test</h2>
                <span
                  className="app-id-pill-badge"
                  style={{ background: '#eff6ff', color: '#1d4ed8', borderColor: '#bfdbfe' }}
                >
                  Guided creation
                </span>
              </div>
            </div>

            {error && <AsyncFeedback state="error" message={error} />}

            <form className="panel stack test-create-panel" onSubmit={createTest} aria-labelledby="newTestHeading">
              <div className="test-create-grid">
                <div>
                  <label htmlFor="new-test-business-name">Test name</label>
                  <input id="new-test-business-name" value={businessName} onChange={(event) => updateBusinessName(event.target.value)} placeholder="Create purchase order" autoFocus />
                </div>
                <div>
                  {/* Named for what it does rather than for how it is stored: this is the id that
                      appears in the Test's stable route. The .json extension was shown next to it
                      but is not a choice - every Test is JSON - so it only added noise. */}
                  <label htmlFor="new-test-file-name">Identifier</label>
                  <input
                    id="new-test-file-name"
                    value={fileName}
                    readOnly
                    placeholder="create-purchase-order"
                    aria-describedby="new-test-file-name-hint"
                  />
                  <span id="new-test-file-name-hint" className="hint field-hint">Derived from the Test name. Used in the stable route.</span>
                </div>
                <div>
                  <label htmlFor="new-test-application">Test application</label>
                  <select id="new-test-application" value={application} onChange={(event) => setApplication(event.target.value as TestApplication)}>
                    {APPLICATIONS.map((value) => <option key={value}>{value}</option>)}
                  </select>
                </div>
                <div>
                  <label htmlFor="new-test-process-area">Process area</label>
                  <select
                    id="new-test-process-area"
                    value={processArea}
                    onChange={(event) => {
                      if (event.target.value === NEW_AREA_OPTION) {
                        setShowNewFolderModal(true);
                        return;
                      }
                      setProcessArea(event.target.value);
                    }}
                  >
                    <option value="">Untagged</option>
                    {processAreas.map((value) => <option key={value} value={value}>{value}</option>)}
                    <option value={NEW_AREA_OPTION}>+ New process area…</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="new-test-starting-point">Starting point</label>
                  <select id="new-test-starting-point" value={startingPoint} onChange={(event) => setStartingPoint(event.target.value as 'blank' | 'template')}>
                    <option value="blank">Blank Test</option>
                    <option value="template">Copy an existing Test</option>
                  </select>
                </div>
                {startingPoint === 'template' && (
                  <div>
                    <label htmlFor="new-test-template">Template Test</label>
                    <select id="new-test-template" value={templateFile} onChange={(event) => setTemplateFile(event.target.value)}>
                      <option value="">— choose a ready Test —</option>
                      {templateItems.map((item) => <option key={item.file} value={item.file}>{item.name}</option>)}
                    </select>
                  </div>
                )}
              </div>
              <div className="row">
                <button type="submit" className="primary" disabled={creating}>{creating ? 'Creating…' : 'Create Test'}</button>
                <button type="button" className="ghost" onClick={cancelComposing}>Cancel</button>
                <span className="hint">Creation persists the initial Test and opens its stable route.</span>
              </div>
            </form>
          </div>
        ) : (
          <div className="test-library-results-pane stack">
            <div className="obj-lib-top-header">
              <div className="obj-lib-title-row">
                <h2>{selectedArea ?? 'All Tests'}</h2>
                <span className="obj-lib-controls-count">{filtered.length} of {items.length} Tests</span>
              </div>
            </div>

            {error && <AsyncFeedback state="error" message={error} />}
            {loading && <AsyncFeedback state="loading" message="Loading Test Library…" />}

            <section className="stack" aria-label="Test Library filters and results">
              <div className="test-library-filters">
                <div className="test-library-search">
                  <label htmlFor="test-library-search">Search</label>
                  <div className="input-with-icon">
                    <Search size={16} aria-hidden="true" />
                    <input id="test-library-search" type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Name or file" />
                  </div>
                </div>
                <div>
                  <label htmlFor="test-library-application">Filter by application</label>
                  <select id="test-library-application" value={applicationFilter} onChange={(event) => setApplicationFilter(event.target.value)}>
                    <option value="all">All applications</option>
                    {APPLICATIONS.map((value) => <option key={value}>{value}</option>)}
                  </select>
                </div>
                <div>
                  <label htmlFor="test-library-status">Filter by status</label>
                  <select id="test-library-status" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
                    <option value="all">All statuses</option>
                    <option value="ready">Ready</option>
                    <option value="published">Published</option>
                    <option value="draft">Draft</option>
                  </select>
                </div>
                {selectedArea !== null && (
                  <div className="test-library-clear-folder">
                    <button type="button" className="ghost" onClick={() => setSelectedArea(null)}>Show all folders</button>
                  </div>
                )}
              </div>

              <TableFrame label="Test Library results">
                <table className="responsive-table test-library-table">
                  <thead>
                    <tr><th>Test</th><th>Process area</th><th>Application</th><th>Steps</th><th>Status</th><th><span className="sr-only">Actions</span></th></tr>
                  </thead>
                  <tbody>
                    {filtered.map((item) => (
                      <tr key={item.file}>
                        <td data-label="Test">
                          <strong>{item.name}</strong>
                          <span className="test-library-file"><FileCode2 size={13} aria-hidden="true" /> {item.file}</span>
                        </td>
                        <td data-label="Process area">{item.processArea || <span className="hint">Untagged</span>}</td>
                        <td data-label="Application">{item.application}</td>
                        <td data-label="Steps">{item.stepCount}</td>
                        <td data-label="Status"><span className={`badge ${item.status === 'published' ? 'passed' : 'running'}`}>{statusLabel(item.status)}</span></td>
                        <td data-label="Actions"><button type="button" className="ghost" onClick={() => openTest(item.file)}>Open Test</button></td>
                      </tr>
                    ))}
                    {!loading && filtered.length === 0 && (
                      <tr><td colSpan={6} className="empty-table-state">No Tests match the current filters.</td></tr>
                    )}
                  </tbody>
                </table>
              </TableFrame>
            </section>
          </div>
        )}
      </main>

      {testToDelete && (
        <div className="modal-backdrop" onClick={() => setTestToDelete(null)}>
          <div className="modal-card" style={{ maxWidth: '460px' }} onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <h3>Delete Test</h3>
              <button type="button" className="btn-close-aside" onClick={() => setTestToDelete(null)}><X size={16} /></button>
            </div>
            <div className="modal-body stack" style={{ gap: '0.85rem' }}>
              <p style={{ margin: 0 }}>
                Delete <strong>{testToDelete.name}</strong> ({testToDelete.file})? This removes the file and cannot be undone.
              </p>
              {forceHint && <AsyncFeedback state="error" message={forceHint} />}
            </div>
            <div className="modal-footer row" style={{ justifyContent: 'flex-end', gap: '0.5rem' }}>
              <button type="button" className="ghost" onClick={() => setTestToDelete(null)}>Cancel</button>
              <button type="button" className="primary" disabled={deleting} onClick={() => void deleteTest(Boolean(forceHint))}>
                {deleting ? 'Deleting…' : forceHint ? 'Delete anyway' : 'Delete Test'}
              </button>
            </div>
          </div>
        </div>
      )}

      {folderToDelete && (
        <div className="modal-backdrop" onClick={() => setFolderToDelete(null)}>
          <div className="modal-card" style={{ maxWidth: '460px' }} onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <h3>Delete folder</h3>
              <button type="button" className="btn-close-aside" onClick={() => setFolderToDelete(null)}><X size={16} /></button>
            </div>
            <div className="modal-body stack" style={{ gap: '0.85rem' }}>
              <p style={{ margin: 0 }}>
                Delete the folder <strong>{folderToDelete}</strong>?
              </p>
              <p className="hint" style={{ margin: 0 }}>
                {(itemsByArea.get(folderToDelete) ?? []).length === 0
                  ? 'The folder is empty.'
                  : `Its ${(itemsByArea.get(folderToDelete) ?? []).length} Test(s) are not deleted — they move to (untagged).`}
              </p>
            </div>
            <div className="modal-footer row" style={{ justifyContent: 'flex-end', gap: '0.5rem' }}>
              <button type="button" className="ghost" onClick={() => setFolderToDelete(null)}>Cancel</button>
              <button type="button" className="primary" disabled={deleting} onClick={() => void deleteFolder()}>
                {deleting ? 'Deleting…' : 'Delete folder'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showNewFolderModal && (
        <div className="modal-backdrop" onClick={() => setShowNewFolderModal(false)}>
          <div className="modal-card" style={{ maxWidth: '420px' }} onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <h3>Create New Process Area Folder</h3>
              <button type="button" className="btn-close-aside" onClick={() => setShowNewFolderModal(false)}>
                <X size={16} />
              </button>
            </div>
            <div className="modal-body stack" style={{ gap: '0.85rem' }}>
              <p className="hint" style={{ margin: 0 }}>
                Enter a folder name to organise your Tests:
              </p>
              <input
                type="text"
                aria-label="New folder name"
                placeholder="e.g. Sales, Procurement, Inventory"
                value={newFolderName}
                onChange={(event) => setNewFolderName(event.target.value)}
                autoFocus
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && newFolderName.trim()) void createFolder();
                }}
              />
            </div>
            <div className="modal-footer row" style={{ justifyContent: 'flex-end', gap: '0.5rem' }}>
              <button type="button" className="ghost" onClick={() => setShowNewFolderModal(false)}>Cancel</button>
              <button type="button" className="primary" disabled={!newFolderName.trim()} onClick={() => void createFolder()}>
                Create Folder
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
