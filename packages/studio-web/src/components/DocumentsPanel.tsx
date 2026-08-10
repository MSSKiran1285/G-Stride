import { CheckCircle2, ChevronDown, ChevronRight, Download, History, Search, ShieldCheck, XCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api } from '../api';
import type { CapturedDocument, EvidenceGovernance, RunHistoryEntry, RunHistoryFilter, RunHistoryGroup, RunHistorySummary, RunMode } from '../types';
import { studioRoutes } from '../routes';
import { AsyncFeedback, Card, EmptyState, PageHeader, Toolbar } from './WorkspacePrimitives';

const PAGE_SIZE = 20;

function formatTimestamp(iso: string): string {
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(new Date(iso));
}

function formatDuration(durationMs: number): string {
  if (!Number.isFinite(durationMs) || durationMs < 0) return '—';
  const seconds = Math.round(durationMs / 1000);
  const minutes = Math.floor(seconds / 60);
  return minutes > 0 ? `${minutes}m ${seconds % 60}s` : `${seconds}s`;
}

function evidencePdfUrl(path: string): string {
  return `/${path.replace(/\\/g, '/')}`;
}

/** Renders a run's Test/Group names, linking each one to its source file when known —
 *  BL-035 AC4's "source artifacts are linked from the run record". */
function ArtifactChips({ names, files, onOpen }: { names: string[]; files?: string[]; onOpen: (file: string) => void }) {
  return (
    <div className="audit-run-chips">
      {names.map((name, index) => {
        const file = files?.[index];
        return file ? (
          <button key={`${name}-${index}`} type="button" className="chip-link" onClick={() => onOpen(file)}>
            {name}
          </button>
        ) : (
          <span key={`${name}-${index}`}>{name}</span>
        );
      })}
    </div>
  );
}

export function DocumentsPanel({
  selectedRunId,
  onSelectedRunChange,
  onNavigateToRoute,
  initialStatusFilter,
}: {
  selectedRunId?: string;
  onSelectedRunChange?: (runId: string | null) => void;
  onNavigateToRoute?: (path: string) => void;
  /** HC-008: seeds the status filter on mount (e.g. Overview's "Needs attention" failed-runs
   *  link) — read once at mount, not kept in sync with later prop changes. */
  initialStatusFilter?: '' | 'passed' | 'failed';
} = {}) {
  const [runs, setRuns] = useState<RunHistorySummary[]>([]);
  const [total, setTotal] = useState(0);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<'' | 'passed' | 'failed'>(initialStatusFilter ?? '');
  const [mode, setMode] = useState<'' | RunMode>('');
  const [range, setRange] = useState<'all' | '7' | '30' | '90'>('all');
  const [environment, setEnvironment] = useState('');
  const [lineageStudioRunId, setLineageStudioRunId] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<'startedAt' | 'durationMs' | 'status'>('startedAt');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [governance, setGovernance] = useState<EvidenceGovernance | null>(null);
  const [selectedRun, setSelectedRun] = useState<RunHistoryEntry | null>(null);
  const [selectedDocuments, setSelectedDocuments] = useState<CapturedDocument[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  // BL-046: the grouping tree. `appIdScope` is what the tree selects; it is a filter like any
  // other, which is why sort, pagination, the status/mode/date filters and lineage all keep
  // working inside a selection instead of being replaced by it.
  const [groups, setGroups] = useState<RunHistoryGroup[]>([]);
  const [appIdScope, setAppIdScope] = useState<string | null>(null);
  const [collapsedAreas, setCollapsedAreas] = useState<Set<string>>(new Set());

  function currentFilter(): RunHistoryFilter {
    const cutoffDays = range === 'all' ? null : Number(range);
    return {
      query: query.trim() || undefined,
      status: status || undefined,
      mode: mode || undefined,
      environment: environment.trim() || undefined,
      dateFrom: cutoffDays ? new Date(Date.now() - cutoffDays * 86_400_000).toISOString() : undefined,
      studioRunId: lineageStudioRunId ?? undefined,
      appId: appIdScope ?? undefined,
      sortBy,
      sortDirection,
      limit: PAGE_SIZE,
      offset: page * PAGE_SIZE,
    };
  }

  function loadRuns() {
    setLoading(true);
    setError(null);
    api.listAuditRuns(currentFilter())
      .then(({ items, total: nextTotal }) => {
        setRuns(items);
        setTotal(nextTotal);
      })
      .catch((reason) => setError(String(reason)))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    loadRuns();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, status, mode, range, environment, lineageStudioRunId, appIdScope, sortBy, sortDirection, page]);

  // Counts are refetched on every filter change except the App ID scope itself — selecting a
  // node must not renumber the tree you selected it from.
  useEffect(() => {
    const cutoffDays = range === 'all' ? null : Number(range);
    api
      .listRunHistoryGroups({
        query: query.trim() || undefined,
        status: status || undefined,
        mode: mode || undefined,
        environment: environment.trim() || undefined,
        dateFrom: cutoffDays ? new Date(Date.now() - cutoffDays * 86_400_000).toISOString() : undefined,
        studioRunId: lineageStudioRunId ?? undefined,
      })
      .then(setGroups)
      .catch(() => setGroups([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, status, mode, range, environment, lineageStudioRunId]);

  useEffect(() => {
    api.getEvidenceGovernance().then(setGovernance).catch(() => setGovernance(null));
  }, []);

  useEffect(() => {
    if (!selectedRunId) {
      setSelectedRun(null);
      setSelectedDocuments([]);
      return;
    }
    setDetailLoading(true);
    setError(null);
    Promise.all([api.getAuditRun(selectedRunId), api.getAuditRunDocuments(selectedRunId).catch(() => [])])
      .then(([run, documents]) => {
        setSelectedRun(run);
        setSelectedDocuments(documents);
      })
      .catch((reason) => {
        setSelectedRun(null);
        setSelectedDocuments([]);
        setError(String(reason));
      })
      .finally(() => setDetailLoading(false));
  }, [selectedRunId]);

  function viewExecution(studioRunId: string) {
    onSelectedRunChange?.(null);
    setLineageStudioRunId(studioRunId);
    setPage(0);
  }

  function openArtifact(file: string) {
    onNavigateToRoute?.(studioRoutes.test(file));
  }

  const passed = runs.filter((run) => run.status === 'passed').length;
  const failed = runs.length - passed;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // Process area -> App IDs, with the area's roll-up being the sum of its children. Untagged App
  // IDs collect under one explicit bucket rather than being hidden or silently attached to a real
  // area — an audit view must not imply an artifact belongs somewhere it does not.
  const areaMap = new Map<string, RunHistoryGroup[]>();
  for (const g of groups) {
    const area = g.processArea || 'Untagged';
    if (!areaMap.has(area)) areaMap.set(area, []);
    areaMap.get(area)!.push(g);
  }
  const areaNames = [...areaMap.keys()].sort((a, b) => (a === 'Untagged' ? 1 : b === 'Untagged' ? -1 : a.localeCompare(b)));
  const ledgerTotal = groups.reduce((sum, g) => sum + g.total, 0);
  const passRate = (p: number, t: number) => (t === 0 ? 0 : Math.round((p / t) * 100));

  return (
    <div className="audit-library">
      <PageHeader
        className="audit-library-header"
        eyebrow="Immutable execution records"
        title="Audit and Evidence"
        description="Find a run by process, application, outcome, date, run ID, or executor—without navigating date folders."
        actions={<button type="button" onClick={() => loadRuns()} disabled={loading}>{loading ? 'Refreshing…' : 'Refresh'}</button>}
      />

      <section className="audit-stat-strip" aria-label="Audit summary">
        <div><History size={17} /><span><strong>{total}</strong> Total runs</span></div>
        <div><CheckCircle2 size={17} /><span><strong>{passed}</strong> Passed on this page</span></div>
        <div><XCircle size={17} /><span><strong>{failed}</strong> Failed on this page</span></div>
      </section>

      {governance && (
        <section className="evidence-governance-strip" aria-label="Evidence governance">
          <ShieldCheck size={18} aria-hidden="true" />
          <div>
            <strong>Canonical evidence is owner-protected and redaction is enforced</strong>
            <span>
              Retention: until the workspace owner deletes it · credentials excluded · execution logs filtered
            </span>
          </div>
        </section>
      )}

      {groups.length > 0 && (
        <nav className="audit-group-tree" aria-label="Runs grouped by process area and application">
          <div className="audit-group-tree-head">
            <span className="canvas-eyebrow">Grouped ledger</span>
            <button
              type="button"
              className={`audit-group-node audit-group-all${appIdScope === null ? ' is-selected' : ''}`}
              aria-pressed={appIdScope === null}
              onClick={() => { setAppIdScope(null); setPage(0); }}
            >
              <span className="audit-group-label">All applications</span>
              <span className="audit-group-counts">
                <span className="audit-group-rate">{passRate(groups.reduce((n, g) => n + g.passed, 0), ledgerTotal)}%</span>
                <span className="badge passed">{groups.reduce((n, g) => n + g.passed, 0)}</span>
                <span className="badge failed">{groups.reduce((n, g) => n + g.failed, 0)}</span>
                <span className="hint">{ledgerTotal}</span>
              </span>
            </button>
          </div>
          {areaNames.map((area) => {
            const children = areaMap.get(area)!;
            const areaTotal = children.reduce((n, g) => n + g.total, 0);
            const areaPassed = children.reduce((n, g) => n + g.passed, 0);
            const areaFailed = children.reduce((n, g) => n + g.failed, 0);
            const collapsed = collapsedAreas.has(area);
            return (
              <div key={area} className="audit-group-area">
                <button
                  type="button"
                  className="audit-group-node audit-group-area-head"
                  aria-expanded={!collapsed}
                  onClick={() =>
                    setCollapsedAreas((prev) => {
                      const next = new Set(prev);
                      if (next.has(area)) next.delete(area);
                      else next.add(area);
                      return next;
                    })
                  }
                >
                  <span className="audit-group-label">
                    {collapsed ? <ChevronRight size={14} aria-hidden="true" /> : <ChevronDown size={14} aria-hidden="true" />}
                    {area}
                  </span>
                  <span className="audit-group-counts">
                    <span className="audit-group-rate">{passRate(areaPassed, areaTotal)}%</span>
                    <span className="badge passed">{areaPassed}</span>
                    <span className="badge failed">{areaFailed}</span>
                    <span className="hint">{areaTotal}</span>
                  </span>
                </button>
                {!collapsed &&
                  children
                    .slice()
                    .sort((a, b) => a.appId.localeCompare(b.appId))
                    .map((g) => (
                      <button
                        key={g.appId}
                        type="button"
                        className={`audit-group-node audit-group-app${appIdScope === g.appId ? ' is-selected' : ''}`}
                        aria-pressed={appIdScope === g.appId}
                        onClick={() => { setAppIdScope(appIdScope === g.appId ? null : g.appId); setPage(0); }}
                      >
                        <span className="audit-group-label">{g.appId}</span>
                        <span className="audit-group-counts">
                          <span className="audit-group-rate">{passRate(g.passed, g.total)}%</span>
                          <span className="badge passed">{g.passed}</span>
                          <span className="badge failed">{g.failed}</span>
                          <span className="hint">{g.total}</span>
                        </span>
                      </button>
                    ))}
              </div>
            );
          })}
        </nav>
      )}

      {appIdScope && (
        <div className="fiori-message-strip info audit-lineage-strip">
          <span>Showing only runs for <code>{appIdScope}</code>.</span>
          <button type="button" className="ghost" onClick={() => { setAppIdScope(null); setPage(0); }}>Clear</button>
        </div>
      )}

      {lineageStudioRunId && (
        <div className="fiori-message-strip info audit-lineage-strip">
          <span>Showing only runs from execution <code>{lineageStudioRunId}</code>.</span>
          <button type="button" className="ghost" onClick={() => { setLineageStudioRunId(null); setPage(0); }}>Clear</button>
        </div>
      )}

      {(selectedRunId || detailLoading) && (
        <Card className="audit-detail-panel" label="Selected audit record">
          <div className="audit-detail-heading">
            <div>
              <span className="canvas-eyebrow">Stable audit record</span>
              <h3>{selectedRun?.testCaseNames[0] ?? (detailLoading ? 'Loading record…' : 'Record unavailable')}</h3>
            </div>
            <button type="button" onClick={() => onSelectedRunChange?.(null)}>Close</button>
          </div>
          {detailLoading && <AsyncFeedback state="loading" message="Loading audit record…" compact />}
          {!detailLoading && selectedRun && (
            <>
              <dl className="run-review-summary">
                <div><dt>Run ID</dt><dd><code>{selectedRun.id}</code></dd></div>
                <div><dt>Outcome</dt><dd>{selectedRun.status.toUpperCase()}</dd></div>
                <div><dt>Started</dt><dd>{formatTimestamp(selectedRun.startedAt)}</dd></div>
                <div><dt>Duration</dt><dd>{formatDuration(selectedRun.durationMs)}</dd></div>
                <div><dt>Executor</dt><dd>{selectedRun.executedBy}</dd></div>
                <div><dt>Application</dt><dd>{selectedRun.appId || 'No App ID'}</dd></div>
                {(selectedRun.targetHostname || selectedRun.targetSafetyClass) && (
                  <div><dt>Environment</dt><dd>{[selectedRun.targetHostname, selectedRun.targetSafetyClass].filter(Boolean).join(' · ')}</dd></div>
                )}
              </dl>
              <ArtifactChips names={selectedRun.testCaseNames} files={selectedRun.testCaseFiles} onOpen={openArtifact} />
              <div className="audit-lineage-actions">
                {selectedRun.studioRunId && (
                  <button type="button" className="ghost" onClick={() => onNavigateToRoute?.(studioRoutes.run(selectedRun.studioRunId!))}>
                    Open execution in Monitor
                  </button>
                )}
                {selectedRun.studioRunId && (
                  <button type="button" className="ghost" onClick={() => viewExecution(selectedRun.studioRunId!)}>
                    View this execution's other runs
                  </button>
                )}
                {selectedRun.parentStudioRunId && (
                  <button type="button" className="ghost" onClick={() => viewExecution(selectedRun.parentStudioRunId!)}>
                    View source execution (this was a rerun)
                  </button>
                )}
              </div>
              {selectedRun.evidencePdfPath && (
                <a className="button" href={evidencePdfUrl(selectedRun.evidencePdfPath)} target="_blank" rel="noreferrer">
                  <Download size={15} /> Open canonical evidence
                </a>
              )}
              {selectedDocuments.length > 0 && (
                <details className="audit-captured-documents">
                  <summary>Captured document values ({selectedDocuments.length})</summary>
                  <dl className="run-review-summary">
                    {selectedDocuments.map((doc) => (
                      <div key={doc.id}><dt>{doc.key}</dt><dd>{doc.value}</dd></div>
                    ))}
                  </dl>
                </details>
              )}
            </>
          )}
        </Card>
      )}

      <Toolbar className="audit-toolbar" label="Filter audit runs">
        <label className="audit-search">
          <Search size={16} aria-hidden="true" />
          <input
            type="search"
            aria-label="Search audit runs"
            placeholder="Search process, App ID, run ID, or executor"
            value={query}
            onChange={(event) => { setQuery(event.currentTarget.value); setPage(0); }}
          />
        </label>
        <input
          type="search"
          aria-label="Filter audit runs by environment"
          placeholder="Environment (hostname or safety class)"
          value={environment}
          onChange={(event) => { setEnvironment(event.currentTarget.value); setPage(0); }}
        />
        <select aria-label="Filter audit runs by status" value={status} onChange={(event) => { setStatus(event.currentTarget.value as '' | 'passed' | 'failed'); setPage(0); }}>
          <option value="">All outcomes</option>
          <option value="passed">Passed</option>
          <option value="failed">Failed</option>
        </select>
        <select aria-label="Filter audit runs by mode" value={mode} onChange={(event) => { setMode(event.currentTarget.value as '' | RunMode); setPage(0); }}>
          <option value="">All modes</option>
          <option value="chain">Chain</option>
          <option value="suite">Suite</option>
          <option value="batch">Batch</option>
        </select>
        <select aria-label="Filter audit runs by date range" value={range} onChange={(event) => { setRange(event.currentTarget.value as 'all' | '7' | '30' | '90'); setPage(0); }}>
          <option value="all">All dates</option>
          <option value="7">Last 7 days</option>
          <option value="30">Last 30 days</option>
          <option value="90">Last 90 days</option>
        </select>
        <select
          aria-label="Sort audit runs"
          value={`${sortBy}:${sortDirection}`}
          onChange={(event) => {
            const [nextSortBy, nextDirection] = event.currentTarget.value.split(':') as ['startedAt' | 'durationMs' | 'status', 'asc' | 'desc'];
            setSortBy(nextSortBy);
            setSortDirection(nextDirection);
            setPage(0);
          }}
        >
          <option value="startedAt:desc">Newest first</option>
          <option value="startedAt:asc">Oldest first</option>
          <option value="durationMs:desc">Longest duration first</option>
          <option value="durationMs:asc">Shortest duration first</option>
          <option value="status:asc">Outcome</option>
        </select>
      </Toolbar>

      {error && <AsyncFeedback state="error" message={error} onRetry={() => loadRuns()} />}
      {loading && runs.length === 0 && <AsyncFeedback state="loading" message="Loading audit records…" />}

      <div className="audit-result-heading">
        <strong>{total} run{total === 1 ? '' : 's'}</strong>
        <span>Page {page + 1} of {pageCount}</span>
      </div>

      {!loading && runs.length === 0 ? (
        <EmptyState
          title={total === 0 ? 'No audit records yet' : 'No matching runs'}
          description={total === 0
            ? 'Completed executions will create immutable records here.'
            : 'Adjust the search or filters to broaden the result.'}
        />
      ) : (
        <div className="audit-run-list">
          {runs.map((run) => (
            <article className="audit-run-card" key={run.id}>
              <div className={`audit-run-status ${run.status}`} aria-hidden="true" />
              <div className="audit-run-main">
                <div className="audit-run-title-row">
                  <div>
                    <h3>{run.testCaseNames[0] || 'Unnamed execution'}</h3>
                    {run.testCaseNames.length > 1 && <span>+{run.testCaseNames.length - 1} linked test cases</span>}
                  </div>
                  <span className={`badge ${run.status}`}>{run.status}</span>
                </div>
                <div className="audit-run-meta">
                  <span>{formatTimestamp(run.startedAt)}</span>
                  <span>{formatDuration(run.durationMs)}</span>
                  <span>{run.mode}</span>
                  <span>{run.appId || 'No App ID'}</span>
                  <span>{run.executedBy}</span>
                  {(run.targetHostname || run.targetSafetyClass) && (
                    <span>{[run.targetHostname, run.targetSafetyClass].filter(Boolean).join(' · ')}</span>
                  )}
                </div>
                <ArtifactChips names={run.testCaseNames} files={run.testCaseFiles} onOpen={openArtifact} />
                <code className="audit-run-id">{run.id}</code>
              </div>
              <div className="audit-run-action">
                <button type="button" onClick={() => onSelectedRunChange?.(run.id)}>View record</button>
                {run.evidencePdfPath ? (
                  <a href={evidencePdfUrl(run.evidencePdfPath)} target="_blank" rel="noreferrer">
                    <Download size={15} /> Evidence PDF
                  </a>
                ) : (
                  <span title="No canonical PDF was archived for this run. This commonly applies to older runs or executions that failed before evidence generation.">
                    No archived evidence
                  </span>
                )}
              </div>
            </article>
          ))}
        </div>
      )}

      {total > PAGE_SIZE && (
        <div className="audit-pagination">
          <button type="button" onClick={() => setPage((current) => Math.max(0, current - 1))} disabled={page === 0}>
            Previous
          </button>
          <span>Page {page + 1} of {pageCount}</span>
          <button type="button" onClick={() => setPage((current) => Math.min(pageCount - 1, current + 1))} disabled={page + 1 >= pageCount}>
            Next
          </button>
        </div>
      )}
    </div>
  );
}
