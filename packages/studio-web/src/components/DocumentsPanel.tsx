import { CheckCircle2, Download, History, Search, XCircle } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import type { RunHistorySummary, RunMode } from '../types';

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

export function DocumentsPanel() {
  const [runs, setRuns] = useState<RunHistorySummary[]>([]);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<'' | 'passed' | 'failed'>('');
  const [mode, setMode] = useState<'' | RunMode>('');
  const [range, setRange] = useState<'all' | '7' | '30' | '90'>('all');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
  }, []);

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
      <header className="audit-library-header">
        <div>
          <span className="canvas-eyebrow">Immutable execution records</span>
          <h2>Audit and Evidence</h2>
          <p>Find a run by process, application, outcome, date, run ID, or executor—without navigating date folders.</p>
        </div>
        <button type="button" onClick={() => void loadRuns()} disabled={loading}>{loading ? 'Refreshing…' : 'Refresh'}</button>
      </header>

      <section className="audit-stat-strip" aria-label="Audit summary">
        <div><History size={17} /><span><strong>{runs.length}</strong> Total runs</span></div>
        <div><CheckCircle2 size={17} /><span><strong>{passed}</strong> Passed</span></div>
        <div><XCircle size={17} /><span><strong>{failed}</strong> Failed</span></div>
      </section>

      <section className="audit-toolbar" aria-label="Filter audit runs">
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
      </section>

      {error && <p className="error-text" role="alert">{error}</p>}

      <div className="audit-result-heading">
        <strong>{filteredRuns.length} run{filteredRuns.length === 1 ? '' : 's'}</strong>
        <span>Newest first</span>
      </div>

      {filteredRuns.length === 0 ? (
        <section className="audit-empty">
          <Search size={22} />
          <strong>No matching runs</strong>
          <span>Adjust the search or filters to broaden the result.</span>
        </section>
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
                {run.evidencePdfPath ? (
                  <a href={evidencePdfUrl(run.evidencePdfPath)} target="_blank" rel="noreferrer">
                    <Download size={15} /> Evidence PDF
                  </a>
                ) : (
                  <span>Evidence unavailable</span>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
