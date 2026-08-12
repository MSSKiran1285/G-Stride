import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Download,
  FileText,
  Search,
  XCircle,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { api } from '../api';
import type { CapturedDocument, RunHistoryEntry, RunHistoryFilter, RunHistorySummary, RunMode } from '../types';
import { studioRoutes } from '../routes';
import { AsyncFeedback, Card, EmptyState } from './WorkspacePrimitives';

const PAGE_SIZE = 10;

function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(date);
}

function formatTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(date);
}

function formatDuration(durationMs: number): string {
  if (!Number.isFinite(durationMs) || durationMs < 0) return '—';
  const totalSeconds = Math.round(durationMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m ${seconds.toString().padStart(2, '0')}s` : `${seconds}s`;
}

function evidencePdfUrl(path: string): string {
  return `/${path.replace(/\\/g, '/')}`;
}

function generateEvidenceId(run: RunHistorySummary, index: number): string {
  const date = new Date(run.startedAt);
  if (Number.isNaN(date.getTime())) return `EVD-${run.id.slice(0, 8).toUpperCase()}`;
  const yyyy = date.getFullYear();
  const mm = (date.getMonth() + 1).toString().padStart(2, '0');
  const dd = date.getDate().toString().padStart(2, '0');
  const seq = (index + 1).toString().padStart(3, '0');
  return `EVD-${yyyy}-${mm}${dd}-${seq}`;
}

function fuzzyMatchRun(run: RunHistorySummary, index: number, rawQuery: string): boolean {
  if (!rawQuery || !rawQuery.trim()) return true;
  const q = rawQuery.trim().toLowerCase();
  const tokens = q.split(/\s+/).filter(Boolean);

  const evidenceId = generateEvidenceId(run, index).toLowerCase();
  const dateStr = formatDate(run.startedAt).toLowerCase();
  const timeStr = formatTime(run.startedAt).toLowerCase();
  const durationStr = formatDuration(run.durationMs).toLowerCase();
  const statusStr = (run.status || '').toLowerCase();
  const executedBy = (run.executedBy || '').toLowerCase();
  const testName = (run.testCaseNames?.[0] || run.appId || '').toLowerCase();
  const appId = (run.appId || '').toLowerCase();
  const id = (run.id || '').toLowerCase();
  const studioRunId = (run.studioRunId || '').toLowerCase();

  const searchableBlob = `${evidenceId} ${dateStr} ${timeStr} ${durationStr} ${statusStr} ${executedBy} ${testName} ${appId} ${id} ${studioRunId}`;

  return tokens.every((token) => searchableBlob.includes(token));
}

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

type SortColumnKey = 'startedAt' | 'durationMs' | 'status' | 'executedBy' | 'test';

export function DocumentsPanel({
  selectedRunId,
  onSelectedRunChange,
  onNavigateToRoute,
  initialStatusFilter,
}: {
  selectedRunId?: string;
  onSelectedRunChange?: (runId: string | null) => void;
  onNavigateToRoute?: (path: string) => void;
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
  const [sortBy, setSortBy] = useState<SortColumnKey>('startedAt');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selectedRun, setSelectedRun] = useState<RunHistoryEntry | null>(null);
  const [selectedDocuments, setSelectedDocuments] = useState<CapturedDocument[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);

  function currentFilter(): RunHistoryFilter {
    const cutoffDays = range === 'all' ? null : Number(range);
    return {
      query: query.trim() || undefined,
      status: status || undefined,
      mode: mode || undefined,
      environment: environment.trim() || undefined,
      dateFrom: cutoffDays ? new Date(Date.now() - cutoffDays * 86_400_000).toISOString() : undefined,
      studioRunId: lineageStudioRunId ?? undefined,
      sortBy: sortBy === 'executedBy' || sortBy === 'test' ? 'startedAt' : sortBy,
      sortDirection,
      limit: PAGE_SIZE,
      offset: page * PAGE_SIZE,
    };
  }

  function loadRuns() {
    setLoading(true);
    setError(null);
    api
      .listAuditRuns(currentFilter())
      .then(({ items, total: nextTotal }) => {
        let processedItems = items;
        if (query.trim()) {
          processedItems = processedItems.filter((run, idx) => fuzzyMatchRun(run, idx, query));
        }
        if (sortBy === 'executedBy') {
          processedItems = [...processedItems].sort((a, b) => {
            const nameA = a.executedBy || '';
            const nameB = b.executedBy || '';
            const cmp = nameA.localeCompare(nameB);
            return sortDirection === 'asc' ? cmp : -cmp;
          });
        } else if (sortBy === 'test') {
          processedItems = [...processedItems].sort((a, b) => {
            const nameA = a.testCaseNames?.[0] || a.appId || '';
            const nameB = b.testCaseNames?.[0] || b.appId || '';
            const cmp = nameA.localeCompare(nameB);
            return sortDirection === 'asc' ? cmp : -cmp;
          });
        }
        setRuns(processedItems);
        setTotal(query.trim() ? processedItems.length : nextTotal);
      })
      .catch((reason) => setError(String(reason)))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    loadRuns();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, status, mode, range, environment, lineageStudioRunId, sortBy, sortDirection, page]);

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

  function handleHeaderSort(colKey: SortColumnKey) {
    if (sortBy === colKey) {
      setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortBy(colKey);
      setSortDirection('desc');
    }
    setPage(0);
  }

  function renderSortableTh(label: string, colKey: SortColumnKey, className?: string) {
    const isActive = sortBy === colKey;
    return (
      <th
        key={label}
        className={`sortable-th ${isActive ? 'active' : ''} ${className ?? ''}`}
        onClick={() => handleHeaderSort(colKey)}
        title={`Sort by ${label}`}
      >
        <div className="th-content">
          <span>{label}</span>
          <span className="sort-icon-wrap" aria-hidden="true">
            {isActive ? (
              sortDirection === 'asc' ? <ArrowUp size={13} /> : <ArrowDown size={13} />
            ) : (
              <ArrowUpDown size={13} className="sort-idle" />
            )}
          </span>
        </div>
      </th>
    );
  }

  function viewExecution(studioRunId: string) {
    onSelectedRunChange?.(null);
    setLineageStudioRunId(studioRunId);
    setPage(0);
  }

  function openArtifact(file: string) {
    onNavigateToRoute?.(studioRoutes.test(file));
  }

  const passedCount = runs.filter((run) => run.status === 'passed').length;
  const failedCount = runs.filter((run) => run.status === 'failed').length;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="audit-evidence-view">
      {/* Header section */}
      <header className="audit-header-container">
        <h1 className="audit-main-title">Evidence Vault</h1>
        <p className="audit-subtitle">
          View and manage automated test execution evidence and audit trails for compliance and traceability.
        </p>
      </header>

      {/* 3 Metric Cards Strip */}
      <div className="audit-metrics-row">
        <div className="audit-metric-card">
          <div className="metric-icon-wrap total">
            <FileText size={20} aria-hidden="true" />
          </div>
          <div className="metric-content">
            <span className="metric-value">{loading ? '—' : total}</span>
            <span className="metric-label">Total runs</span>
          </div>
        </div>

        <div className="audit-metric-card">
          <div className="metric-icon-wrap passed">
            <CheckCircle2 size={20} aria-hidden="true" />
          </div>
          <div className="metric-content">
            <span className="metric-value">{loading ? '—' : passedCount}</span>
            <span className="metric-label">Passed</span>
          </div>
        </div>

        <div className="audit-metric-card">
          <div className="metric-icon-wrap failed">
            <XCircle size={20} aria-hidden="true" />
          </div>
          <div className="metric-content">
            <span className="metric-value">{loading ? '—' : failedCount}</span>
            <span className="metric-label">Failed</span>
          </div>
        </div>
      </div>

      {lineageStudioRunId && (
        <div className="fiori-message-strip info audit-lineage-strip">
          <span>Showing only runs from execution <code>{lineageStudioRunId}</code>.</span>
          <button type="button" className="ghost" onClick={() => { setLineageStudioRunId(null); setPage(0); }}>
            Clear
          </button>
        </div>
      )}

      {/* Structured Search Bar & Compact Side-by-Side Filters */}
      <div className="audit-filter-stack">
        <div className="audit-search-row">
          <Search size={16} className="search-icon" aria-hidden="true" />
          <input
            type="search"
            aria-label="Search evidence ID, executed by, date..."
            placeholder="Search evidence ID, executed by, test name, date..."
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(0);
            }}
          />
        </div>

        <div className="audit-filters-subrow">
          <select
            className="compact-select"
            aria-label="Filter by environment"
            value={environment}
            onChange={(e) => {
              setEnvironment(e.target.value);
              setPage(0);
            }}
          >
            <option value="">Environment: All</option>
            <option value="non-production">Non-production</option>
            <option value="production-like">Production-like</option>
          </select>

          <select
            className="compact-select"
            aria-label="Filter by outcome"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value as '' | 'passed' | 'failed');
              setPage(0);
            }}
          >
            <option value="">Outcome: All</option>
            <option value="passed">Passed</option>
            <option value="failed">Failed</option>
          </select>

          <select
            className="compact-select"
            aria-label="Filter by mode"
            value={mode}
            onChange={(e) => {
              setMode(e.target.value as '' | RunMode);
              setPage(0);
            }}
          >
            <option value="">Mode: All</option>
            <option value="chain">Chain</option>
            <option value="suite">Suite</option>
            <option value="batch">Batch</option>
          </select>

          <select
            className="compact-select"
            aria-label="Filter by date range"
            value={range}
            onChange={(e) => {
              setRange(e.target.value as 'all' | '7' | '30' | '90');
              setPage(0);
            }}
          >
            <option value="all">Date: All time</option>
            <option value="7">Last 7 days</option>
            <option value="30">Last 30 days</option>
            <option value="90">Last 90 days</option>
          </select>
        </div>
      </div>

      {/* Selected Run Detail Drawer */}
      {(selectedRunId || detailLoading) && (
        <Card className="audit-detail-panel" label="Selected audit record">
          <div className="audit-detail-heading">
            <div>
              <span className="canvas-eyebrow">Audit record</span>
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
                <div><dt>Date</dt><dd>{formatDate(selectedRun.startedAt)}</dd></div>
                <div><dt>Time</dt><dd>{formatTime(selectedRun.startedAt)}</dd></div>
                <div><dt>Duration</dt><dd>{formatDuration(selectedRun.durationMs)}</dd></div>
                <div><dt>Executed by</dt><dd>{selectedRun.executedBy}</dd></div>
                <div><dt>Application</dt><dd>{selectedRun.appId || 'No App ID'}</dd></div>
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
              </div>
              {selectedRun.evidencePdfPath && (
                <a className="button primary" href={evidencePdfUrl(selectedRun.evidencePdfPath)} target="_blank" rel="noreferrer">
                  <Download size={15} /> Open evidence PDF ↗
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

      {error && <AsyncFeedback state="error" message={error} onRetry={() => loadRuns()} />}

      {/* Main Datatable with Header Sorting */}
      <div className="audit-table-card">
        {loading && runs.length === 0 ? (
          <AsyncFeedback state="loading" message="Loading audit records…" />
        ) : runs.length === 0 ? (
          <EmptyState
            title={total === 0 ? 'No evidence records yet' : 'No matching evidence records'}
            description={total === 0 ? 'Completed test runs will generate evidence records here.' : 'Adjust search query or filters.'}
          />
        ) : (
          <table className="audit-evidence-table">
            <thead>
              <tr>
                <th style={{ width: '16%' }}>{renderSortableTh('Evidence ID', 'startedAt')}</th>
                <style>{`.audit-evidence-table th { padding: 0.4rem 0.55rem; }`}</style>
                <th style={{ width: '13%' }}>{renderSortableTh('Execution Date', 'startedAt')}</th>
                <th style={{ width: '11%' }}>{renderSortableTh('Execution Time', 'startedAt')}</th>
                <th style={{ width: '9%' }}>{renderSortableTh('Duration', 'durationMs')}</th>
                <th style={{ width: '9%' }}>{renderSortableTh('Status', 'status')}</th>
                <th style={{ width: '12%' }}>{renderSortableTh('Executed by', 'executedBy')}</th>
                <th style={{ width: '30%', textAlign: 'left' }}>{renderSortableTh('Test', 'test')}</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run, idx) => {
                const evidenceId = generateEvidenceId(run, page * PAGE_SIZE + idx);
                const hasPdf = Boolean(run.evidencePdfPath);
                const testName = run.testCaseNames?.[0] || run.appId || '—';
                const statusClass = run.status === 'passed' ? 'passed' : 'failed';
                return (
                  <tr key={run.id}>
                    <td className="td-evidence-id">
                      {hasPdf ? (
                        <a
                          href={evidencePdfUrl(run.evidencePdfPath!)}
                          target="_blank"
                          rel="noreferrer"
                          className={`evidence-id-link ${statusClass}`}
                          title="Open evidence PDF document"
                        >
                          {evidenceId}
                        </a>
                      ) : (
                        <button
                          type="button"
                          className={`evidence-id-btn ${statusClass}`}
                          onClick={() => onSelectedRunChange?.(run.id)}
                        >
                          {evidenceId}
                        </button>
                      )}
                    </td>
                    <td>{formatDate(run.startedAt)}</td>
                    <td>{formatTime(run.startedAt)}</td>
                    <td>{formatDuration(run.durationMs)}</td>
                    <td>
                      <span className={`status-pill ${run.status}`}>
                        {run.status === 'passed' ? 'Passed' : 'Failed'}
                      </span>
                    </td>
                    <td>{run.executedBy || 'QA Automation'}</td>
                    <td className="td-test-name">
                      <button
                        type="button"
                        className="btn-test-name"
                        onClick={() => onSelectedRunChange?.(run.id)}
                        title="Click to view audit record details"
                      >
                        {testName}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Footer Pagination */}
      <footer className="audit-pagination-bar">
        <span className="pagination-info">
          Page {page + 1} of {pageCount}
        </span>

        <div className="pagination-controls">
          <button
            type="button"
            className="page-nav-btn"
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={page === 0}
            aria-label="Previous page"
          >
            <ChevronLeft size={16} aria-hidden="true" />
          </button>

          {Array.from({ length: Math.min(5, pageCount) }, (_, i) => {
            const pageNum = i;
            const isActive = page === pageNum;
            return (
              <button
                key={pageNum}
                type="button"
                className={`page-num-btn ${isActive ? 'active' : ''}`}
                onClick={() => setPage(pageNum)}
              >
                {pageNum + 1}
              </button>
            );
          })}

          {pageCount > 5 && <span className="pagination-ellipsis">…</span>}
          {pageCount > 5 && (
            <button
              type="button"
              className={`page-num-btn ${page === pageCount - 1 ? 'active' : ''}`}
              onClick={() => setPage(pageCount - 1)}
            >
              {pageCount}
            </button>
          )}

          <button
            type="button"
            className="page-nav-btn"
            onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
            disabled={page + 1 >= pageCount}
            aria-label="Next page"
          >
            <ChevronRight size={16} aria-hidden="true" />
          </button>
        </div>
      </footer>
    </div>
  );
}
