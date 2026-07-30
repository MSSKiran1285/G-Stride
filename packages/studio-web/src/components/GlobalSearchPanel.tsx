import { useEffect, useState } from 'react';
import { Search, X } from 'lucide-react';
import { api } from '../api';
import type { SearchResult, SearchResultKind } from '../types';
import { AsyncFeedback } from './WorkspacePrimitives';

const KIND_LABELS: Record<SearchResultKind, string> = {
  test: 'Test',
  object: 'Object',
  dataset: 'Dataset',
  process: 'Process',
  pack: 'Regression Pack',
  run: 'Run',
};

/** Whether this result kind supports a dependency-aware delete from here — runs are
 *  immutable audit records (BL-12/13) and are never deleted from Studio. */
function isDeletable(kind: SearchResultKind): boolean {
  return kind !== 'run';
}

async function usageSummaryFor(result: SearchResult): Promise<string> {
  if (result.kind === 'test') {
    const usage = await api.getTestUsage(result.id);
    const parts: string[] = [];
    if (usage.groups.length) parts.push(`${usage.groups.length} Process${usage.groups.length === 1 ? '' : 'es'}: ${usage.groups.join(', ')}`);
    if (usage.packs.length) parts.push(`${usage.packs.length} Regression Pack${usage.packs.length === 1 ? '' : 's'}: ${usage.packs.join(', ')}`);
    return parts.join('; ');
  }
  if (result.kind === 'process') {
    const usage = await api.getGroupUsage(result.id);
    return usage.packs.length ? `${usage.packs.length} Regression Pack${usage.packs.length === 1 ? '' : 's'}: ${usage.packs.join(', ')}` : '';
  }
  if (result.kind === 'object') {
    const [appId, name] = result.id.split('/');
    const usage = await api.getObjectUsage(appId, name);
    return usage.length ? `${usage.length} Test${usage.length === 1 ? '' : 's'}: ${usage.join(', ')}` : '';
  }
  if (result.kind === 'dataset') {
    const usage = await api.getDataUsage(result.id);
    const parts: string[] = [];
    if (usage.groups.length) parts.push(`${usage.groups.length} Process${usage.groups.length === 1 ? '' : 'es'}`);
    if (usage.packs.length) parts.push(`${usage.packs.length} Regression Pack${usage.packs.length === 1 ? '' : 's'}`);
    if (usage.relations.length) parts.push(`${usage.relations.length} relationship${usage.relations.length === 1 ? '' : 's'}`);
    return parts.join('; ');
  }
  return '';
}

/** BL-037's "detail view" of incoming/outgoing dependencies for one search result — AC2. */
function UsagePanel({ result }: { result: SearchResult }) {
  const [incoming, setIncoming] = useState<string[] | null>(null);
  const [outgoing, setOutgoing] = useState<string[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    (async () => {
      if (result.kind === 'test') {
        const [usage, refs] = await Promise.all([api.getTestUsage(result.id), api.getTestReferences(result.id)]);
        if (!active) return;
        setIncoming([...usage.groups.map((f) => `Process: ${f}`), ...usage.packs.map((f) => `Regression Pack: ${f}`)]);
        setOutgoing(refs.objects.map((o) => `Object: ${o.appId}/${o.name}`));
      } else if (result.kind === 'process') {
        const [usage, group] = await Promise.all([api.getGroupUsage(result.id), api.getGroup(result.id)]);
        if (!active) return;
        setIncoming(usage.packs.map((f) => `Regression Pack: ${f}`));
        setOutgoing([
          ...group.testCaseFiles.map((f) => `Test: ${f}`),
          ...(group.dataFile ? [`Dataset: ${group.dataFile}`] : []),
        ]);
      } else if (result.kind === 'pack') {
        const pack = await api.getPack(result.id);
        if (!active) return;
        setIncoming([]);
        setOutgoing(pack.members.map((m) => `${m.kind === 'test' ? 'Test' : 'Process'}: ${m.file}${m.dataFile ? ` (data: ${m.dataFile})` : ''}`));
      } else if (result.kind === 'object') {
        const [appId, name] = result.id.split('/');
        const usage = await api.getObjectUsage(appId, name);
        if (!active) return;
        setIncoming(usage.map((f) => `Test: ${f}`));
        setOutgoing([]);
      } else if (result.kind === 'dataset') {
        const usage = await api.getDataUsage(result.id);
        if (!active) return;
        setIncoming([
          ...usage.groups.map((f) => `Process: ${f}`),
          ...usage.packs.map((f) => `Regression Pack: ${f}`),
          ...usage.relations.map((f) => `Relationship: ${f}`),
        ]);
        setOutgoing([]);
      } else {
        setIncoming([]);
        setOutgoing([]);
      }
    })()
      .catch((reason) => setError(String(reason)))
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [result.id, result.kind]);

  if (loading) return <AsyncFeedback state="loading" message="Loading dependencies…" compact />;
  if (error) return <AsyncFeedback state="error" message={error} compact />;

  return (
    <div className="search-usage-panel">
      <div>
        <strong>Incoming</strong>
        {incoming && incoming.length > 0 ? (
          <ul>{incoming.map((item) => <li key={item}>{item}</li>)}</ul>
        ) : (
          <span className="hint">Nothing references this.</span>
        )}
      </div>
      <div>
        <strong>Outgoing</strong>
        {outgoing && outgoing.length > 0 ? (
          <ul>{outgoing.map((item) => <li key={item}>{item}</li>)}</ul>
        ) : (
          <span className="hint">References nothing else.</span>
        )}
      </div>
    </div>
  );
}

export function GlobalSearchPanel({ onNavigate, onClose }: { onNavigate: (route: string) => void; onClose: () => void }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  const keyOf = (result: SearchResult) => `${result.kind}:${result.id}`;

  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const timer = setTimeout(() => {
      api.search(trimmed)
        .then((next) => {
          setResults(next);
          setError(null);
        })
        .catch((reason) => setError(String(reason)))
        .finally(() => setLoading(false));
    }, 250);
    return () => clearTimeout(timer);
  }, [query]);

  async function handleDelete(result: SearchResult) {
    const key = keyOf(result);
    setBusyKey(key);
    setError(null);
    try {
      const summary = await usageSummaryFor(result);
      const message = summary
        ? `"${result.label}" is referenced by ${summary}.\n\nDelete anyway? Those artifacts will break until fixed.`
        : `Delete "${result.label}"? This can't be undone.`;
      if (!window.confirm(message)) {
        setBusyKey(null);
        return;
      }
      const force = summary.length > 0;
      if (result.kind === 'test') await api.deleteTestCase(result.id, force);
      else if (result.kind === 'process') await api.deleteGroup(result.id, force);
      else if (result.kind === 'pack') await api.deletePack(result.id);
      else if (result.kind === 'object') {
        const [appId, name] = result.id.split('/');
        await api.deleteObject(appId, name, force);
      } else if (result.kind === 'dataset') await api.deleteData(result.id, force);
      setResults((current) => current.filter((r) => keyOf(r) !== key));
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <div className="settings-backdrop" role="presentation">
      <section className="capture-panel search-panel" role="dialog" aria-modal="true" aria-labelledby="global-search-title">
        <header className="settings-header">
          <div>
            <span className="canvas-eyebrow">Global search</span>
            <h2 id="global-search-title">Find any Test, Object, Dataset, Process, Pack or Run</h2>
          </div>
          <button type="button" className="ghost" onClick={onClose} aria-label="Close search">
            <X size={18} />
          </button>
        </header>
        <div className="capture-content search-content">
          <label className="input-with-icon" htmlFor="global-search-input">
            <Search size={16} aria-hidden="true" />
            <input
              id="global-search-input"
              type="search"
              autoFocus
              placeholder="Search by name, file, App ID…"
              value={query}
              onChange={(event) => setQuery(event.currentTarget.value)}
            />
          </label>

          {error && <AsyncFeedback state="error" message={error} />}
          {loading && <AsyncFeedback state="loading" message="Searching…" compact />}
          {!loading && query.trim() && results.length === 0 && (
            <p className="hint">No results for "{query.trim()}".</p>
          )}

          <ul className="search-results-list">
            {results.map((result) => {
              const key = keyOf(result);
              const expanded = expandedKey === key;
              return (
                <li key={key} className="search-result-row">
                  <div className="search-result-main">
                    <span className="badge search-kind">{KIND_LABELS[result.kind]}</span>
                    <button type="button" className="search-result-label" onClick={() => onNavigate(result.route)}>
                      {result.label}
                    </button>
                    <span className="search-result-meta">
                      {result.domain && <span>{result.domain}</span>}
                      {result.application && <span>{result.application}</span>}
                      {result.lifecycle && <span>{result.lifecycle}</span>}
                    </span>
                  </div>
                  <div className="search-result-actions">
                    <button type="button" className="ghost" onClick={() => setExpandedKey(expanded ? null : key)}>
                      {expanded ? 'Hide usage' : 'Show usage'}
                    </button>
                    {isDeletable(result.kind) && (
                      <button type="button" className="ghost danger" disabled={busyKey === key} onClick={() => handleDelete(result)}>
                        Delete
                      </button>
                    )}
                  </div>
                  {expanded && <UsagePanel result={result} />}
                </li>
              );
            })}
          </ul>
        </div>
      </section>
    </div>
  );
}
