import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, FileCode2, Folder, FolderOpen, Plus } from 'lucide-react';
import { api } from '../api';
import { GroupEditor } from './GroupEditor';
import { PackEditor } from './PackEditor';
import { AsyncFeedback, EmptyState } from './WorkspacePrimitives';
import { PopDialog } from './PopDialog';

type Section = 'processes' | 'packs';

interface ProcessPacksWorkspaceProps {
  initialSection?: Section;
  initialProcessFile?: string;
  initialPackFile?: string;
  onProcessFileChange: (file: string) => void;
  onPackFileChange: (file: string) => void;
  onSectionChange: (section: Section) => void;
  onDirtyChange?: (dirty: boolean) => void;
}

/**
 * Business Processes and Regression Packs in the explorer shell the Object Library and Compose
 * Tests already use: a tree on the left holding both kinds under their own folder, the selected
 * artifact filling the canvas.
 *
 * They were previously a segmented control over two editors that each carried their own "open"
 * picker and their own "create new" field — three different ways to reach an artifact in one
 * module, none of them showing what else existed. The tree is the one way, and it answers "what
 * have we got" before you open anything.
 */
export function ProcessPacksWorkspace({
  initialSection = 'processes',
  initialProcessFile,
  initialPackFile,
  onProcessFileChange,
  onPackFileChange,
  onSectionChange,
  onDirtyChange,
}: ProcessPacksWorkspaceProps) {
  const [section, setSection] = useState<Section>(initialSection);
  const [dirty, setDirty] = useState(false);
  const [processFiles, setProcessFiles] = useState<string[]>([]);
  const [packFiles, setPackFiles] = useState<string[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<Section, boolean>>({ processes: true, packs: true });
  const [openProcess, setOpenProcess] = useState(initialProcessFile ?? '');
  const [openPack, setOpenPack] = useState(initialPackFile ?? '');

  // Create New asks which kind before it asks anything else — the two produce different
  // artifacts with different rules, and the answer decides which editor opens.
  const [createOpen, setCreateOpen] = useState(false);
  const [createKind, setCreateKind] = useState<Section>('processes');
  const [createName, setCreateName] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);
  const [pendingNewProcess, setPendingNewProcess] = useState<string | undefined>();
  const [pendingNewPack, setPendingNewPack] = useState<string | undefined>();

  function refreshTree() {
    Promise.all([api.listGroups(), api.listPacks()])
      .then(([groups, packs]) => {
        setProcessFiles(groups);
        setPackFiles(packs);
        setLoadError(null);
      })
      .catch((reason) => setLoadError(String(reason)));
  }

  useEffect(refreshTree, []);
  useEffect(() => setSection(initialSection), [initialSection]);
  useEffect(() => { if (initialProcessFile) setOpenProcess(initialProcessFile); }, [initialProcessFile]);
  useEffect(() => { if (initialPackFile) setOpenPack(initialPackFile); }, [initialPackFile]);

  const counts = useMemo(
    () => ({ processes: processFiles.length, packs: packFiles.length }),
    [processFiles.length, packFiles.length]
  );

  function handleDirty(next: boolean) {
    setDirty(next);
    onDirtyChange?.(next);
  }

  function confirmDiscard(): boolean {
    return !dirty || window.confirm('You have unsaved changes. Discard them and open something else?');
  }

  function openArtifact(kind: Section, file: string) {
    if (!confirmDiscard()) return;
    setDirty(false);
    setSection(kind);
    if (kind === 'processes') {
      setPendingNewProcess(undefined);
      setOpenProcess(file);
      onProcessFileChange(file);
    } else {
      setPendingNewPack(undefined);
      setOpenPack(file);
      onPackFileChange(file);
    }
  }

  function submitCreate() {
    const requested = createName.trim();
    if (!requested) return setCreateError('Give the new scenario a file name.');
    const file = requested.endsWith('.json') ? requested : `${requested}.json`;
    const existing = createKind === 'processes' ? processFiles : packFiles;
    if (existing.includes(file)) {
      return setCreateError(`"${file}" already exists — open it from the tree, or choose another name.`);
    }
    if (!confirmDiscard()) return;
    setDirty(false);
    setSection(createKind);
    setExpanded((prev) => ({ ...prev, [createKind]: true }));
    if (createKind === 'processes') {
      setPendingNewProcess(file);
      setOpenProcess(file);
      onProcessFileChange(file);
    } else {
      setPendingNewPack(file);
      setOpenPack(file);
      onPackFileChange(file);
    }
    setCreateOpen(false);
    setCreateName('');
    setCreateError(null);
  }

  const folders: { kind: Section; label: string; files: string[]; openFile: string }[] = [
    { kind: 'processes', label: 'Business Processes', files: processFiles, openFile: openProcess },
    { kind: 'packs', label: 'Regression Packs', files: packFiles, openFile: openPack },
  ];

  const nothingOpen = section === 'processes' ? !openProcess : !openPack;

  return (
    <div className="obj-lib-split-container">
      <aside className="obj-lib-tree-aside">
        <div className="obj-lib-tree-header">
          <div className="title-group">
            <Folder size={16} aria-hidden="true" />
            <span>Processes &amp; Packs</span>
          </div>
        </div>

        <div className="obj-lib-tree-body">
          {loadError && <AsyncFeedback state="error" message={loadError} onRetry={refreshTree} compact />}
          {folders.map((folder) => {
            const isExpanded = expanded[folder.kind];
            const isActiveFolder = section === folder.kind;
            return (
              <div key={folder.kind} className="tree-folder-group">
                <div
                  className={`obj-tree-folder-row ${isActiveFolder ? 'active-domain' : ''}`}
                  role="button"
                  tabIndex={0}
                  aria-expanded={isExpanded}
                  aria-label={folder.label}
                  onKeyDown={(event) => {
                    if (event.key !== 'Enter' && event.key !== ' ') return;
                    event.preventDefault();
                    (event.currentTarget as HTMLDivElement).click();
                  }}
                  onClick={() => {
                    // A folder is both a disclosure and a section switch: clicking "Regression
                    // Packs" should show packs, not just reveal their names.
                    setExpanded((prev) => ({ ...prev, [folder.kind]: !prev[folder.kind] }));
                    if (folder.kind !== section && confirmDiscard()) {
                      setDirty(false);
                      setSection(folder.kind);
                      onSectionChange(folder.kind);
                    }
                  }}
                >
                  <ChevronDown
                    size={14}
                    className="tree-chevron"
                    style={{ transform: isExpanded ? 'none' : 'rotate(-90deg)', transition: 'transform 0.15s ease' }}
                  />
                  {isExpanded ? <FolderOpen size={16} aria-hidden="true" /> : <Folder size={16} aria-hidden="true" />}
                  <span className="folder-name">{folder.label}</span>
                  <span className="folder-count">{folder.files.length}</span>
                </div>

                {isExpanded && (
                  <div className="obj-tree-children-list">
                    {folder.files.length === 0 ? (
                      <div className="tree-empty-item">(none yet)</div>
                    ) : (
                      folder.files.map((file) => {
                        const isOpen = isActiveFolder && folder.openFile === file;
                        return (
                          <div
                            key={file}
                            className={`obj-tree-child-item ${isOpen ? 'selected' : ''}`}
                            title={file}
                            role="button"
                            tabIndex={0}
                            aria-current={isOpen ? 'true' : undefined}
                            aria-label={`Open ${file}`}
                            onKeyDown={(event) => {
                              if (event.key !== 'Enter' && event.key !== ' ') return;
                              event.preventDefault();
                              openArtifact(folder.kind, file);
                            }}
                            onClick={(event) => {
                              event.stopPropagation();
                              openArtifact(folder.kind, file);
                            }}
                          >
                            <FileCode2 size={14} aria-hidden="true" style={{ flexShrink: 0 }} />
                            <span className="app-id-name" style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {file.replace(/\.json$/, '')}
                            </span>
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

        <div className="obj-lib-tree-action-bar">
          <button
            type="button"
            className="btn-scan-new-object"
            onClick={() => { setCreateKind(section); setCreateError(null); setCreateOpen(true); }}
          >
            <Plus size={15} aria-hidden="true" />
            <span>Create New</span>
          </button>
        </div>

        <div className="obj-lib-tree-footer">
          {counts.processes} Business Process{counts.processes === 1 ? '' : 'es'} · {counts.packs} Regression Pack{counts.packs === 1 ? '' : 's'}
        </div>
      </aside>

      <main className="obj-lib-main-canvas">
        <div className="obj-lib-top-header">
          <div className="obj-lib-title-row">
            <h2>
              {section === 'processes'
                ? (openProcess ? openProcess.replace(/\.json$/, '') : 'Business Processes')
                : (openPack ? openPack.replace(/\.json$/, '') : 'Regression Packs')}
            </h2>
            <span className="app-id-pill-badge">
              {section === 'processes' ? 'Business Process' : 'Regression Pack'}
            </span>
          </div>
        </div>

        <p className="hint" style={{ marginBottom: '0.65rem' }}>
          {section === 'processes'
            ? 'A Business Process sequences Tests and carries outputs forward between stages.'
            : 'A Regression Pack runs independent Tests or Business Processes with member-specific bindings.'}
        </p>

        {nothingOpen ? (
          <EmptyState
            title={section === 'processes' ? 'No Business Process open' : 'No Regression Pack open'}
            description="Pick one from the tree, or use Create New to orchestrate a new scenario."
          />
        ) : section === 'processes' ? (
          <GroupEditor
            initialFile={openProcess || undefined}
            newFile={pendingNewProcess}
            showLibraryControls={false}
            onSelectedFileChange={(file) => { setOpenProcess(file); onProcessFileChange(file); refreshTree(); }}
            onDirtyChange={handleDirty}
          />
        ) : (
          <PackEditor
            initialFile={openPack || undefined}
            newFile={pendingNewPack}
            showLibraryControls={false}
            onSelectedFileChange={(file) => { setOpenPack(file); onPackFileChange(file); refreshTree(); }}
            onDirtyChange={handleDirty}
          />
        )}
      </main>

      {createOpen && (
        <PopDialog
          title="Create new scenario"
          closeLabel="Close without creating a scenario"
          onClose={() => setCreateOpen(false)}
        >
          <div className="panel stack">
            <fieldset className="create-kind-choice">
              <legend>What are you orchestrating?</legend>
              <label>
                <input
                  type="radio"
                  name="create-kind"
                  value="processes"
                  checked={createKind === 'processes'}
                  onChange={() => { setCreateKind('processes'); setCreateError(null); }}
                />
                <span>
                  <strong>Business Process</strong>
                  <small>Ordered stages, one shared run — a later stage can use what an earlier one captured.</small>
                </span>
              </label>
              <label>
                <input
                  type="radio"
                  name="create-kind"
                  value="packs"
                  checked={createKind === 'packs'}
                  onChange={() => { setCreateKind('packs'); setCreateError(null); }}
                />
                <span>
                  <strong>Regression Pack</strong>
                  <small>Independent members, each with its own session and bindings — one failure does not stop the rest.</small>
                </span>
              </label>
            </fieldset>

            <div>
              <label htmlFor="new-scenario-name">File name</label>
              <input
                id="new-scenario-name"
                type="text"
                autoFocus
                placeholder={createKind === 'processes' ? 'po-gr-invoice' : 'quarterly-regression'}
                value={createName}
                onChange={(event) => { setCreateName(event.target.value); setCreateError(null); }}
                onKeyDown={(event) => { if (event.key === 'Enter') submitCreate(); }}
              />
              <p className="hint">No extension needed. Nothing is written until you save the scenario.</p>
            </div>

            {createError && <AsyncFeedback state="error" message={createError} compact />}

            <div className="row">
              <button type="button" className="primary" onClick={submitCreate}>Create</button>
              <button type="button" onClick={() => setCreateOpen(false)}>Cancel</button>
            </div>
          </div>
        </PopDialog>
      )}
    </div>
  );
}
