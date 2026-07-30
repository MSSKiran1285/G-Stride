import { CheckCircle2, Download, History, Search, ShieldCheck, XCircle } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import type { EvidenceGovernance, RunHistoryEntry, RunHistorySummary, RunMode } from '../types';
import { AsyncFeedback, Card, EmptyState, PageHeader, Toolbar } from './WorkspacePrimitives';

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

function formatDuration(run: RunHistorySummary): string {
  const milliseconds = new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime();
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return '—';
  const seconds = Math.round(milliseconds / 1000);
  const minutes = Math.floor(seconds / 60);
  return minutes > 0 ? `${minutes}m ${seconds % 60}s` : `${seconds}s`;
}

function evidencePdfUrl(path: string): string {
  return `/${path.replace(/\\/g, '/')}`;
}

export function DocumentsPanel({
  selectedRunId,
  onSelectedRunChange,
}: {
  selectedRunId?: string;
  onSelectedRunChange?: (runId: string | null) => void;
} = {}) {
  const [runs, setRuns] = useState<RunHistorySummary[]>([]);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<'' | 'passed' | 'failed'>('');
  const [mode, setMode] = useState<'' | RunMode>('');
  const [range, setRange] = useState<'all' | '7' | '30' | '90'>('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [governance, setGovernance] = useState<EvidenceGovernance | null>(null);
  const [selectedRun, setSelectedRun] = useState<RunHistoryEntry | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  async function loadRuns() {
    setLoading(true);
    setError(null);
    try {
      setRuns(await api.listAuditRuns());
    } catch (reason) {
      setError(String(reason));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadRuns();
    api.getEvidenceGovernance().then(setGovernance).catch(() => setGovernance(null));
  }, []);

  useEffect(() => {
    if (!selectedRunId) {
      setSelectedRun(null);
      return;
    }
    setDetailLoading(true);
    setError(null);
    api.getAuditRun(selectedRunId)
      .then(setSelectedRun)
      .catch((reason) => {
        setSelectedRun(null);
        setError(String(reason));
      })
      .finally(() => setDetailLoading(false));
  }, [selectedRunId]);

  const filteredRuns = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    const cutoff = range === 'all' ? null : Date.now() - Number(range) * 86_400_000;
    return [...runs]
      .filter((run) => !status || run.status === status)
      .filter((run) => !mode || run.mode === mode)
      .filter((run) => cutoff === null || new Date(run.startedAt).getTime() >= cutoff)
      .filter((run) => {
        if (!normalizedQuery) return true;
        return [
          run.id,
          run.appId,
          run.executedBy,
          run.mode,
          run.status,
          ...run.testCaseNames,
        ].some((value) => value.toLowerCase().includes(normalizedQuery));
      })
      .sort((left, right) => new Date(right.startedAt).getTime() - new Date(left.startedAt).getTime());
  }, [runs, query, status, mode, range]);

  const passed = runs.filter((run) => run.status === 'passed').length;
  const failed = runs.length - passed;

  return (
    <div className="audit-library">
      <PageHeader
        className="audit-library-header"
        eyebrow="Immutable execution records"
        title="Audit and Evidence"
        description="Find a run by process, application, outcome, date, run ID, or executor—without navigating date folders."
        actions={<button type="button" onClick={() => void loadRuns()} disabled={loading}>{loading ? 'Refreshing…' : 'Refresh'}</button>}
      />

      <section className="audit-stat-strip" aria-label="Audit summary">
        <div><History size={17} /><span><strong>{runs.length}</strong> Total runs</span></div>
        <div><CheckCircle2 size={17} /><span><strong>{passed}</strong> Passed</span></div>
        <div><XCircle size={17} /><span><strong>{failed}</strong> Failed</span></div>
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
                <div><dt>Duration</dt><dd>{formatDuration(selectedRun)}</dd></div>
                <div><dt>Executor</dt><dd>{selectedRun.executedBy}</dd></div>
                <div><dt>Application</dt><dd>{selectedRun.appId || 'No App ID'}</dd></div>
              </dl>
              <div className="audit-run-chips">
                {selectedRun.testCaseNames.map((name) => <span key={name}>{name}</span>)}
              </div>
              {selectedRun.evidencePdfPath && (
                <a className="button" href={evidencePdfUrl(selectedRun.evidencePdfPath)} target="_blank" rel="noreferrer">
                  <Download size={15} /> Open canonical evidence
                </a>
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
            onChange={(event) => setQuery(event.currentTarget.value)}
          />
        </label>
        <select aria-label="Filter audit runs by status" value={status} onChange={(event) => setStatus(event.currentTarget.value as '' | 'passed' | 'failed')}>
          <option value="">All outcomes</option>
          <option value="passed">Passed</option>
          <option value="failed">Failed</option>
        </select>
        <select aria-label="Filter audit runs by mode" value={mode} onChange={(event) => setMode(event.currentTarget.value as '' | RunMode)}>
          <option value="">All modes</option>
          <option value="chain">Chain</option>
          <option value="suite">Suite</option>
          <option value="batch">Batch</option>
        </select>
        <select aria-label="Filter audit runs by date range" value={range} onChange={(event) => setRange(event.currentTarget.value as 'all' | '7' | '30' | '90')}>
          <option value="all">All dates</option>
          <option value="7">Last 7 days</option>
          <option value="30">Last 30 days</option>
          <option value="90">Last 90 days</option>
        </select>
      </Toolbar>

      {error && <AsyncFeedback state="error" message={error} onRetry={() => void loadRuns()} />}
      {loading && runs.length === 0 && <AsyncFeedback state="loading" message="Loading audit records…" />}

      <div className="audit-result-heading">
        <strong>{filteredRuns.length} run{filteredRuns.length === 1 ? '' : 's'}</strong>
        <span>Newest first</span>
      </div>

      {!loading && filteredRuns.length === 0 ? (
        <EmptyState
          title={runs.length === 0 ? 'No audit records yet' : 'No matching runs'}
          description={runs.length === 0
            ? 'Completed executions will create immutable records here.'
            : 'Adjust the search or filters to broaden the result.'}
        />
      ) : (
        <div className="audit-run-list">
          {filteredRuns.map((run) => (
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
                  <span>{formatDuration(run)}</span>
                  <span>{run.mode}</span>
                  <span>{run.appId || 'No App ID'}</span>
                  <span>{run.executedBy}</span>
                </div>
                <div className="audit-run-chips">
                  {run.testCaseNames.map((name) => <span key={name}>{name}</span>)}
                </div>
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
    </div>
  );
}
