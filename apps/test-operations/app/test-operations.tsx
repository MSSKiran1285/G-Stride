'use client';

import {
  Activity,
  AlertTriangle,
  BarChart3,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleSlash2,
  Clock3,
  FlaskConical,
  Gauge,
  History,
  LayoutDashboard,
  ListChecks,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  TerminalSquare,
  XCircle,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { executionHistory, failureLedger } from '../data/execution-history';

type TestStatus = 'Passed' | 'Failed' | 'Skipped' | 'Not run';
type View = 'overview' | 'catalog' | 'failures';

interface CatalogTest {
  id: string;
  name: string;
  feature: string;
  area: string;
  mode: string;
  source: string;
  latestStatus: TestStatus;
  lastExecutedAt: string | null;
  durationMs: number | null;
  executionNote: string;
}

export interface Snapshot {
  generatedAt: string;
  source: string;
  tests: CatalogTest[];
}

const navItems: Array<{ id: View; label: string; icon: React.ReactNode }> = [
  { id: 'overview', label: 'Execution overview', icon: <LayoutDashboard size={18} /> },
  { id: 'catalog', label: 'Test catalog', icon: <ListChecks size={18} /> },
  { id: 'failures', label: 'Failure ledger', icon: <History size={18} /> },
];

const featureIcons: Record<string, React.ReactNode> = {
  'Workspace Experience': <LayoutDashboard size={18} />,
  'Studio API Contracts': <TerminalSquare size={18} />,
  'Security & Configuration': <ShieldCheck size={18} />,
  'Audit & Evidence': <History size={18} />,
  'Execution Engine': <Gauge size={18} />,
};

function statusIcon(status: TestStatus) {
  if (status === 'Passed') return <CheckCircle2 size={14} />;
  if (status === 'Failed') return <XCircle size={14} />;
  if (status === 'Skipped') return <CircleSlash2 size={14} />;
  return <Clock3 size={14} />;
}

function formatDuration(duration: number | null) {
  if (duration === null) return '—';
  if (duration < 1000) return `${duration} ms`;
  return `${(duration / 1000).toFixed(2)} s`;
}

export function TestOperations({ snapshot }: { snapshot: Snapshot }) {
  const [view, setView] = useState<View>('overview');
  const passed = snapshot.tests.filter((test) => test.latestStatus === 'Passed').length;
  const failed = snapshot.tests.filter((test) => test.latestStatus === 'Failed').length;
  const skipped = snapshot.tests.filter((test) => test.latestStatus === 'Skipped').length;
  const executed = passed + failed;
  const passRate = executed === 0 ? 0 : Math.round((passed / executed) * 1000) / 10;

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/ai-elk-logo-dark.png" alt="" />
          <div>
            <strong>QA/4HANA</strong>
            <span>Test Operations</span>
          </div>
        </div>

        <nav aria-label="Test operations">
          {navItems.map((item) => (
            <button
              type="button"
              key={item.id}
              className={view === item.id ? 'active' : ''}
              onClick={() => setView(item.id)}
              aria-current={view === item.id ? 'page' : undefined}
            >
              {item.icon}<span>{item.label}</span>
              {item.id === 'failures' && <small>{failureLedger.length}</small>}
            </button>
          ))}
        </nav>

        <div className="sidebar-foot">
          <span className="environment-dot" />
          <div><strong>Repository snapshot</strong><span>Updated 29 Jul 2026</span></div>
        </div>
      </aside>

      <main>
        <header className="topbar">
          <div>
            <span className="eyebrow">Quality command center</span>
            <h1>{navItems.find((item) => item.id === view)?.label}</h1>
          </div>
          <div className="quality-pulse">
            <span className="pulse-dot" />
            <div><strong>{failed === 0 ? 'All executed checks passing' : `${failed} checks failing`}</strong><span>{passRate}% executed pass rate</span></div>
          </div>
        </header>

        <div className="content">
          {view === 'overview' && (
            <Overview
              tests={snapshot.tests}
              passed={passed}
              failed={failed}
              skipped={skipped}
              passRate={passRate}
              onOpenCatalog={() => setView('catalog')}
              onOpenFailures={() => setView('failures')}
            />
          )}
          {view === 'catalog' && <Catalog tests={snapshot.tests} />}
          {view === 'failures' && <FailureLedger />}
        </div>
      </main>
    </div>
  );
}

function Overview({
  tests,
  passed,
  failed,
  skipped,
  passRate,
  onOpenCatalog,
  onOpenFailures,
}: {
  tests: CatalogTest[];
  passed: number;
  failed: number;
  skipped: number;
  passRate: number;
  onOpenCatalog: () => void;
  onOpenFailures: () => void;
}) {
  const features = useMemo(() => {
    return Array.from(new Set(tests.map((test) => test.feature))).map((feature) => {
      const featureTests = tests.filter((test) => test.feature === feature);
      return {
        name: feature,
        total: featureTests.length,
        passed: featureTests.filter((test) => test.latestStatus === 'Passed').length,
        skipped: featureTests.filter((test) => test.latestStatus === 'Skipped').length,
      };
    });
  }, [tests]);
  const modes = Array.from(new Set(tests.map((test) => test.mode))).map((mode) => ({
    name: mode,
    count: tests.filter((test) => test.mode === mode).length,
  })).sort((left, right) => right.count - left.count);

  return (
    <div className="page-stack">
      <section className="hero">
        <div>
          <span className="eyebrow">Latest verified snapshot</span>
          <h2>Quality is green. History stays visible.</h2>
          <p>Every QA/4HANA regression test is catalogued by feature and execution mode. Past failures remain in the ledger after remediation.</p>
        </div>
        <div className="hero-score">
          <div className="score-ring" style={{ '--score': `${passRate * 3.6}deg` } as React.CSSProperties}>
            <span><strong>{passRate}%</strong><small>pass rate</small></span>
          </div>
          <div><strong>{passed} / {passed + failed}</strong><span>executed checks passing</span></div>
        </div>
      </section>

      <section className="metric-grid" aria-label="Latest execution metrics">
        <button type="button" className="metric-card" onClick={onOpenCatalog}>
          <span className="metric-icon coral"><FlaskConical size={19} /></span>
          <div><small>Total inventory</small><strong>{tests.length}</strong><span>Across {features.length} feature groups</span></div>
          <ChevronRight size={17} />
        </button>
        <div className="metric-card">
          <span className="metric-icon green"><CheckCircle2 size={19} /></span>
          <div><small>Latest passed</small><strong>{passed}</strong><span>No active failures</span></div>
        </div>
        <div className="metric-card">
          <span className="metric-icon amber"><CircleSlash2 size={19} /></span>
          <div><small>Intentionally skipped</small><strong>{skipped}</strong><span>Live or execution opt-in</span></div>
        </div>
        <button type="button" className="metric-card" onClick={onOpenFailures}>
          <span className="metric-icon navy"><History size={19} /></span>
          <div><small>Historical failures</small><strong>{failureLedger.length}</strong><span>All retained · all remediated</span></div>
          <ChevronRight size={17} />
        </button>
      </section>

      <section className="overview-grid">
        <article className="surface trend-card">
          <div className="section-heading">
            <div><span className="eyebrow">Run history</span><h3>Execution outcomes</h3></div>
            <span className="legend"><i className="passed" /> Passed <i className="failed" /> Failed <i className="skipped" /> Skipped</span>
          </div>
          <div className="history-bars">
            {executionHistory.map((run) => {
              const total = run.passed + run.failed + run.skipped;
              return (
                <div className="history-row" key={run.id}>
                  <div className="history-label"><strong>{run.label}</strong><span>{run.timestamp} · {run.mode}</span></div>
                  <div className="stacked-bar" aria-label={`${run.passed} passed, ${run.failed} failed, ${run.skipped} skipped`}>
                    <span className="passed" style={{ width: `${run.passed / total * 100}%` }} />
                    <span className="failed" style={{ width: `${run.failed / total * 100}%` }} />
                    <span className="skipped" style={{ width: `${run.skipped / total * 100}%` }} />
                  </div>
                  <strong className="history-total">{total}</strong>
                </div>
              );
            })}
          </div>
        </article>

        <article className="surface modes-card">
          <div className="section-heading"><div><span className="eyebrow">Coverage mix</span><h3>Execution modes</h3></div><SlidersHorizontal size={18} /></div>
          <div className="mode-list">
            {modes.map((mode) => (
              <div key={mode.name}>
                <div><strong>{mode.name}</strong><span>{mode.count} tests</span></div>
                <span className="mode-track"><i style={{ width: `${mode.count / tests.length * 100}%` }} /></span>
              </div>
            ))}
          </div>
        </article>
      </section>

      <section className="surface">
        <div className="section-heading">
          <div><span className="eyebrow">Coverage map</span><h3>Health by feature</h3></div>
          <button type="button" className="text-button" onClick={onOpenCatalog}>Open full catalog <ChevronRight size={15} /></button>
        </div>
        <div className="feature-grid">
          {features.map((feature) => (
            <article className="feature-card" key={feature.name}>
              <span className="feature-icon">{featureIcons[feature.name]}</span>
              <div><strong>{feature.name}</strong><span>{feature.passed} passing · {feature.skipped} skipped</span></div>
              <div className="feature-score"><Check size={14} /><span>{feature.total}</span></div>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

function Catalog({ tests }: { tests: CatalogTest[] }) {
  const [query, setQuery] = useState('');
  const [feature, setFeature] = useState('All features');
  const [status, setStatus] = useState('All statuses');
  const [mode, setMode] = useState('All modes');
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(['Workspace Experience']));

  const features = Array.from(new Set(tests.map((test) => test.feature)));
  const modes = Array.from(new Set(tests.map((test) => test.mode)));
  const filtered = tests.filter((test) => {
    const matchesQuery = !query || `${test.id} ${test.name} ${test.area} ${test.source}`.toLowerCase().includes(query.toLowerCase());
    return matchesQuery
      && (feature === 'All features' || test.feature === feature)
      && (status === 'All statuses' || test.latestStatus === status)
      && (mode === 'All modes' || test.mode === mode);
  });
  const grouped = features
    .map((name) => ({ name, tests: filtered.filter((test) => test.feature === name) }))
    .filter((group) => group.tests.length > 0);

  function toggle(name: string) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  return (
    <div className="page-stack">
      <section className="page-intro">
        <div><span className="eyebrow">Repository-derived inventory</span><h2>All {tests.length} QA/4HANA tests</h2><p>Grouped by feature with the latest verified status, source, execution mode, and duration.</p></div>
        <div className="catalog-summary"><span><i className="passed" /> {tests.filter((test) => test.latestStatus === 'Passed').length} passed</span><span><i className="skipped" /> {tests.filter((test) => test.latestStatus === 'Skipped').length} skipped</span></div>
      </section>

      <section className="filter-bar" aria-label="Filter test catalog">
        <label className="search-field"><Search size={16} /><input type="search" placeholder="Search test name, ID, area, or source…" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
        <select aria-label="Filter by feature" value={feature} onChange={(event) => setFeature(event.target.value)}>
          <option>All features</option>{features.map((item) => <option key={item}>{item}</option>)}
        </select>
        <select aria-label="Filter by status" value={status} onChange={(event) => setStatus(event.target.value)}>
          <option>All statuses</option><option>Passed</option><option>Failed</option><option>Skipped</option>
        </select>
        <select aria-label="Filter by execution mode" value={mode} onChange={(event) => setMode(event.target.value)}>
          <option>All modes</option>{modes.map((item) => <option key={item}>{item}</option>)}
        </select>
      </section>

      <div className="result-line"><strong>{filtered.length} tests</strong><span>{grouped.length} feature groups</span></div>

      <div className="catalog-groups">
        {grouped.map((group) => {
          const open = expanded.has(group.name) || feature !== 'All features' || Boolean(query);
          return (
            <section className="catalog-group" key={group.name}>
              <button type="button" className="group-heading" onClick={() => toggle(group.name)} aria-expanded={open}>
                <span className="feature-icon">{featureIcons[group.name]}</span>
                <span><strong>{group.name}</strong><small>{group.tests.length} tests · {group.tests.filter((test) => test.latestStatus === 'Passed').length} passing</small></span>
                {open ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
              </button>
              {open && (
                <div className="test-table-wrap">
                  <table>
                    <thead><tr><th>Test case</th><th>Workspace / area</th><th>Mode</th><th>Latest</th><th>Duration</th></tr></thead>
                    <tbody>
                      {group.tests.map((test) => (
                        <tr key={test.id}>
                          <td data-label="Test case"><span className="test-name"><code>{test.id}</code><strong>{test.name}</strong><small>{test.source}</small></span></td>
                          <td data-label="Workspace / area">{test.area}</td>
                          <td data-label="Mode"><span className="mode-pill">{test.mode}</span></td>
                          <td data-label="Latest"><span className={`status-badge ${test.latestStatus.toLowerCase().replace(' ', '-')}`}>{statusIcon(test.latestStatus)}{test.latestStatus}</span></td>
                          <td data-label="Duration">{formatDuration(test.durationMs)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          );
        })}
        {grouped.length === 0 && <div className="empty-state"><Search size={24} /><strong>No tests match these filters</strong><span>Clear or broaden a filter to restore results.</span></div>}
      </div>
    </div>
  );
}

function FailureLedger() {
  const [query, setQuery] = useState('');
  const filtered = failureLedger.filter((entry) => `${entry.id} ${entry.test} ${entry.cause} ${entry.feature}`.toLowerCase().includes(query.toLowerCase()));

  return (
    <div className="page-stack">
      <section className="page-intro">
        <div><span className="eyebrow">Append-only quality record</span><h2>Failures remain visible after recovery</h2><p>Each failure event keeps its original occurrence, cause, remediation, and subsequent pass time.</p></div>
        <span className="retention-pill"><ShieldCheck size={16} /> History retained</span>
      </section>

      <section className="ledger-summary">
        <div><AlertTriangle size={18} /><span><small>Recorded failures</small><strong>{failureLedger.length}</strong></span></div>
        <div><CheckCircle2 size={18} /><span><small>Remediated</small><strong>{failureLedger.filter((item) => item.state === 'Remediated').length}</strong></span></div>
        <div><Activity size={18} /><span><small>Currently failing</small><strong>0</strong></span></div>
        <div><Clock3 size={18} /><span><small>Median recovery</small><strong>4 min</strong></span></div>
      </section>

      <label className="search-field ledger-search"><Search size={16} /><input type="search" placeholder="Search failure, cause, feature, or ID…" value={query} onChange={(event) => setQuery(event.target.value)} /></label>

      <div className="failure-list">
        {filtered.map((entry) => (
          <article className="failure-card" key={entry.id}>
            <div className="failure-timeline" aria-hidden="true"><span className="failed" /><i /><span className="passed" /></div>
            <div className="failure-main">
              <div className="failure-title"><div><code>{entry.id}</code><h3>{entry.test}</h3></div><span className="status-badge passed"><CheckCircle2 size={14} />{entry.state}</span></div>
              <div className="failure-meta"><span>{entry.feature}</span><span>{entry.mode}</span><span>Failed {entry.failedAt}</span><span>Passed {entry.passedAt}</span></div>
              <div className="failure-details">
                <div><small>Observed cause</small><p>{entry.cause}</p></div>
                <div><small>Remediation</small><p>{entry.remediation}</p></div>
              </div>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
