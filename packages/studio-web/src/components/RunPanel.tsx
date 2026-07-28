import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import type { RunStatus } from '../types';
import { FileChainPicker } from './FileChainPicker';

function evidenceUrl(screenshotPath: string): string {
  return `/${screenshotPath.replace(/\\/g, '/')}`;
}

function CompletionBanner({ run }: { run: RunStatus }) {
  // Defensive: results/groupResults should always be arrays by the time this renders, but a
  // page-crashing "reading 'length' of undefined" is a much worse failure mode
  // than briefly showing "0 iterations" while state is momentarily incomplete.
  const results = run.results ?? [];
  const groupResults = run.groupResults ?? [];
  const isBatch = run.mode === 'batch';
  const passedCount = isBatch ? groupResults.filter((g) => g.status === 'passed').length : results.filter((r) => r.status === 'passed').length;
  const total = isBatch ? groupResults.length : results.length;
  const unit = isBatch ? 'group' : run.mode === 'suite' ? 'test case' : 'iteration';
  const plural = (n: number) => (n === 1 ? unit : `${unit}s`);
  const completedUnits = isBatch ? groupResults.length : results.length;
  const totalUnits = Math.max(1, run.totalUnits ?? completedUnits);
  const hasStepProgress = isBatch && run.status === 'running' && Boolean(run.progress?.totalSteps);
  const progressPercent = run.status === 'running'
    ? hasStepProgress
      ? Math.min(99, Math.max(0, Math.round(run.progress!.percent)))
      : Math.min(99, Math.round((completedUnits / totalUnits) * 100))
    : 100;
  const awaitingFirstResult = run.status === 'running' && completedUnits === 0 && !hasStepProgress;
  const progressSummary = hasStepProgress
    ? `${run.progress!.completedSteps} of ${run.progress!.totalSteps} steps · ${run.progress!.completedStages} of ${run.progress!.totalStages} scenarios completed`
    : run.status === 'running'
      ? awaitingFirstResult
        ? `Starting first ${unit}`
        : `${completedUnits} of ${totalUnits} ${plural(totalUnits)} completed`
      : `${totalUnits} of ${totalUnits} ${plural(totalUnits)} completed`;

  let label: string;
  if (run.status === 'running') {
    label = 'Running…';
  } else if (isBatch || run.mode === 'suite') {
    label = passedCount === total ? `✓ All ${total} ${plural(total)} passed` : `⚠ ${passedCount}/${total} ${plural(total)} passed`;
  } else {
    label = run.status === 'passed' ? `✓ Run passed (${passedCount}/${total} ${plural(total)})` : '✗ Run failed';
  }

  return (
    <div className={`completion-banner ${run.status}`}>
      <span className="completion-label">{label}</span>
      {run.status !== 'running' && <span className="hint">exit code {run.exitCode}</span>}
      {run.evidencePdfUrl && run.status !== 'running' && (
        <a href={run.evidencePdfUrl} target="_blank" rel="noreferrer">
          Open evidence PDF ↗
        </a>
      )}
      <div
        className={`run-progress${awaitingFirstResult ? ' indeterminate' : ''}`}
        role="progressbar"
        aria-label={`Execution progress: ${progressSummary}`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={awaitingFirstResult ? undefined : progressPercent}
        aria-valuetext={awaitingFirstResult ? `Starting first ${unit}` : undefined}
      >
        <div className="run-progress-meta">
          <span>{progressSummary}</span>
          <strong>{awaitingFirstResult ? 'In progress' : `${progressPercent}%`}</strong>
        </div>
        {hasStepProgress && (
          <span className="run-progress-context">
            {run.progress!.currentGroup}
            {run.progress!.currentStage ? ` · ${run.progress!.currentStage}` : ''}
            {run.progress!.currentStep ? ` · ${run.progress!.currentStep}` : ''}
          </span>
        )}
        <span className="run-progress-track" aria-hidden="true">
          <span className="run-progress-fill" style={{ width: awaitingFirstResult ? undefined : `${progressPercent}%` }} />
        </span>
      </div>
    </div>
  );
}

export function RunPanel() {
  const [files, setFiles] = useState<string[]>([]);
  const [groups, setGroups] = useState<string[]>([]);
  const [dataFiles, setDataFiles] = useState<string[]>([]);
  const [chain, setChain] = useState<string[]>([]);
  const [mode, setMode] = useState<'chain' | 'suite' | 'batch'>('chain');
  const [appId, setAppId] = useState('createPurchaseOrder');
  const [dataFile, setDataFile] = useState('');
  const [headless, setHeadless] = useState(false);
  const [run, setRun] = useState<RunStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [monitorError, setMonitorError] = useState<string | null>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [starting, setStarting] = useState(false);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollDelayRef = useRef(2000);
  const mountedRef = useRef(true);
  const startingRef = useRef(false);
  const reviewDialogRef = useRef<HTMLDialogElement>(null);
  const reviewCancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    mountedRef.current = true;
    api.listTestCases().then(setFiles).catch((e) => setError(String(e)));
    api.listGroups().then(setGroups).catch((e) => setError(String(e)));
    api.listData().then(setDataFiles).catch((e) => setError(String(e)));
    return () => {
      mountedRef.current = false;
      if (pollRef.current) clearTimeout(pollRef.current);
    };
  }, []);

  useEffect(() => {
    const dialog = reviewDialogRef.current;
    if (!dialog) return;
    if (reviewOpen && !dialog.open) {
      dialog.showModal();
      requestAnimationFrame(() => reviewCancelRef.current?.focus());
    } else if (!reviewOpen && dialog.open) {
      dialog.close();
    }
  }, [reviewOpen]);

  // Switching modes carries over a selection that means something different in the
  // new mode (a test case file isn't a group name) — start the composition over.
  function switchMode(next: 'chain' | 'suite' | 'batch') {
    setMode(next);
    setChain([]);
  }

  function reviewRun() {
    if (chain.length === 0) {
      setError(`Add at least one ${mode === 'batch' ? 'group' : 'test case file'} to the ${mode} first.`);
      return;
    }
    setError(null);
    setReviewOpen(true);
  }

  function schedulePoll(id: string, delay = pollDelayRef.current) {
    if (!mountedRef.current) return;
    if (pollRef.current) clearTimeout(pollRef.current);
    pollRef.current = setTimeout(() => {
      void pollRun(id);
    }, delay);
  }

  async function pollRun(id: string) {
    try {
      const status = await api.getRun(id);
      if (!mountedRef.current) return;
      setRun(status);
      setMonitorError(null);
      setLastUpdatedAt(new Date().toLocaleTimeString());
      pollDelayRef.current = 2000;
      if (status.status === 'running') schedulePoll(id);
      else pollRef.current = null;
    } catch (e) {
      if (!mountedRef.current) return;
      setMonitorError(`Monitor connection lost. The execution may still be running. Retrying automatically. ${String(e)}`);
      pollDelayRef.current = Math.min(pollDelayRef.current * 2, 30000);
      schedulePoll(id);
    }
  }

  async function executeRun() {
    if (startingRef.current) return;
    startingRef.current = true;
    setStarting(true);
    setReviewOpen(false);
    setError(null);
    setMonitorError(null);
    try {
      const started = await api.startRun(
        mode === 'batch'
          ? { groupFiles: chain, headless, mode }
          : { testCaseFiles: chain, appId, dataFile: dataFile || undefined, headless, mode }
      );
      setRun(started);
      setLastUpdatedAt(new Date().toLocaleTimeString());
      pollDelayRef.current = 2000;
      schedulePoll(started.id);
    } catch (e) {
      setError(String(e));
    } finally {
      startingRef.current = false;
      setStarting(false);
    }
  }

  return (
    <div className="stack">
      <div className="panel stack">
        <div className="row" style={{ alignItems: 'center' }}>
          <p className="section-title" style={{ margin: 0 }}>
            Mode
          </p>
          <div className="app-nav">
            <button className={mode === 'chain' ? 'active' : ''} onClick={() => switchMode('chain')}>
              Chain
            </button>
            <button className={mode === 'suite' ? 'active' : ''} onClick={() => switchMode('suite')}>
              Suite
            </button>
            <button className={mode === 'batch' ? 'active' : ''} onClick={() => switchMode('batch')}>
              Batch
            </button>
          </div>
        </div>
        <p className="hint" style={{ margin: '-0.4rem 0 0.2rem' }}>
          {mode === 'chain'
            ? 'A dependent, multi-stage business process (e.g. Create PO → Goods Receipt → Invoice) — one shared session, later steps can use values earlier ones captured. Loops every row of the data file: each row is one full pass through the whole chain. Stops at the first failure.'
            : mode === 'suite'
            ? 'Independent scenarios that shouldn\'t affect each other (a regression pack: happy path, negative path, edge cases) — each its own fresh session. Loops every row × every test case. A failure in one does not stop the others.'
            : 'Independent, named business scenarios (Groups) run together as one cycle — each its own fresh session, its own App ID and data file. Uses only the first row of each Group\'s data file (not a data sweep — for that, add rows to a Chain/Suite, or author another named Group). A group failing exits that group only.'}
        </p>

        <FileChainPicker
          availableLabel={mode === 'batch' ? 'Available groups' : 'Available test cases'}
          selectedLabel={mode === 'chain' ? 'Run order' : mode === 'suite' ? 'Suite members' : 'Batch members'}
          items={mode === 'batch' ? groups : files}
          selected={chain}
          onChange={setChain}
        />

        <div className="param-grid">
          {mode !== 'batch' && (
            <>
              <div>
                <label>App ID</label>
                <input aria-label="Execution App ID" type="text" value={appId} onChange={(e) => setAppId(e.target.value)} />
              </div>
              <div>
                <label>Data file</label>
                <select aria-label="Execution data file" value={dataFile} onChange={(e) => setDataFile(e.target.value)}>
                  <option value="">— none —</option>
                  {dataFiles.map((f) => (
                    <option key={f} value={f}>
                      {f}
                    </option>
                  ))}
                </select>
              </div>
            </>
          )}
          <div>
            <label>
              <input type="checkbox" checked={headless} onChange={(e) => setHeadless(e.target.checked)} style={{ width: 'auto', marginRight: '0.4rem' }} />
              Headless
            </label>
          </div>
          <div>
            <span className="hint">
              Evidence is generated automatically and shared with Audit and Evidence.
            </span>
          </div>
        </div>

        {error && <p className="error-text" role="alert">{error}</p>}

        <div>
          <button className="primary" onClick={reviewRun} disabled={starting || run?.status === 'running'}>
            {starting ? 'Starting…' : run?.status === 'running' ? 'Running…' : 'Review and run'}
          </button>
        </div>
      </div>

      <dialog
        ref={reviewDialogRef}
        className="run-review-dialog"
        aria-labelledby="run-review-title"
        aria-describedby="run-review-description"
        onCancel={(event) => {
          event.preventDefault();
          setReviewOpen(false);
        }}
        onClose={() => setReviewOpen(false)}
      >
        <div className="stack">
          <div>
            <h2 id="run-review-title" className="section-title">Review execution impact</h2>
            <p id="run-review-description" className="hint">
              Studio cannot currently verify the SAP tenant resolved by the execution profile. Confirm the configured credentials and target before continuing.
            </p>
          </div>
          <dl className="run-review-summary">
            <div><dt>Mode</dt><dd>{mode}</dd></div>
            <div><dt>{mode === 'batch' ? 'Groups' : 'Test cases'}</dt><dd>{chain.join(' → ')}</dd></div>
            {mode !== 'batch' && <div><dt>App ID</dt><dd>{appId || 'Not provided'}</dd></div>}
            {mode !== 'batch' && <div><dt>Data file</dt><dd>{dataFile || 'None'}</dd></div>}
            <div><dt>Browser</dt><dd>{headless ? 'Headless' : 'Visible'}</dd></div>
            <div><dt>Evidence PDF</dt><dd>One canonical document per audit run</dd></div>
          </dl>
          <div className="fiori-message-strip warning" role="alert">
            This execution may create or change real SAP business documents.
          </div>
          <div className="row run-review-actions">
            <button ref={reviewCancelRef} type="button" onClick={() => setReviewOpen(false)}>Cancel</button>
            <button type="button" className="primary" disabled={starting} onClick={() => void executeRun()}>
              {starting ? 'Starting…' : 'Confirm and start run'}
            </button>
          </div>
        </div>
      </dialog>

      {run && (
        <div className="panel stack">
          <CompletionBanner run={run} />

          <div className="run-monitor-health" role="status" aria-live="polite">
            {monitorError ? (
              <>
                <span className="error-text">{monitorError}</span>
                <button
                  type="button"
                  className="ghost"
                  onClick={() => {
                    setMonitorError(null);
                    pollDelayRef.current = 2000;
                    schedulePoll(run.id, 0);
                  }}
                >
                  Retry now
                </button>
              </>
            ) : (
              <span className="hint">{lastUpdatedAt ? `Last updated at ${lastUpdatedAt}` : 'Waiting for the first status update…'}</span>
            )}
          </div>

          {run.mode === 'batch' && (
            <>
              {(run.groupResults ?? []).length === 0 && run.status === 'running' && <p className="hint">Waiting for the first group to complete…</p>}

              {(run.groupResults ?? []).length > 0 && (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Group</th>
                        <th>Total test cases</th>
                        <th>Passed</th>
                        <th>Failed test case</th>
                        <th>Pass %</th>
                        <th>Duration</th>
                        <th>Evidence</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(run.groupResults ?? []).map((g, gi) => (
                        <tr key={gi}>
                          <td>
                            {g.name} — <span className={`badge ${g.status}`}>{g.status}</span>
                          </td>
                          <td>{g.totalTestCases}</td>
                          <td>{g.passedCount}</td>
                          <td className="error-text">{g.failedTestCase ?? (g.error ? `(setup error) ${g.error}` : '')}</td>
                          <td>{g.passPercent}%</td>
                          <td>{Math.round(g.durationMs)} ms</td>
                          <td>
                            {g.evidencePdfUrl ? (
                              <a href={g.evidencePdfUrl} target="_blank" rel="noreferrer">
                                Open ↗
                              </a>
                            ) : (
                              ''
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {(run.groupResults ?? []).map((g, gi) => (
                <div key={gi} className="stack">
                  <p className="section-title">
                    {g.name} — test case detail
                  </p>
                  <table>
                    <thead>
                      <tr>
                        <th>Test case</th>
                        <th>Status</th>
                        <th>Duration</th>
                      </tr>
                    </thead>
                    <tbody>
                      {g.stages.map((s, si) => (
                        <tr key={si}>
                          <td>{s.testCaseName}</td>
                          <td>
                            <span className={`badge ${s.status}`}>{s.status}</span>
                          </td>
                          <td>{Math.round(s.durationMs)} ms</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>

                  {g.stages.some((s) => s.steps.some((st) => st.status === 'failed' && st.screenshotPath)) && (
                    <div>
                      <p className="section-title">Failure screenshot</p>
                      {g.stages
                        .flatMap((s) => s.steps)
                        .filter((st) => st.status === 'failed' && st.screenshotPath)
                        .map((st, sti) => (
                          <figure key={sti} style={{ margin: '0 0 0.75rem' }}>
                            <img src={evidenceUrl(st.screenshotPath!)} alt={`${st.description} failure`} style={{ maxWidth: '100%', borderRadius: 8, border: '1px solid var(--border)' }} />
                            <figcaption className="hint">
                              {st.description} — {st.error}
                            </figcaption>
                          </figure>
                        ))}
                    </div>
                  )}
                </div>
              ))}
            </>
          )}

          {run.mode !== 'batch' && (run.results ?? []).length === 0 && run.status === 'running' && <p className="hint">Waiting for the first step to complete…</p>}

          {run.mode !== 'batch' && (run.results ?? []).map((result, ri) => (
            <div key={ri} className="stack">
              <p className="section-title">
                {result.testCaseName} — <span className={`badge ${result.status}`}>{result.status}</span>
              </p>
              {run.evidenceDocuments?.[ri] && (
                <p>
                  <a href={run.evidenceDocuments[ri].url} target="_blank" rel="noreferrer">
                    Open canonical evidence PDF ↗
                  </a>
                  <span className="hint"> Same document as Audit and Evidence</span>
                </p>
              )}

              <table>
                <thead>
                  <tr>
                    <th>Action</th>
                    <th>Status</th>
                    <th>Duration</th>
                    <th>Error</th>
                  </tr>
                </thead>
                <tbody>
                  {result.steps.map((s, si) => (
                    <tr key={si}>
                      <td title={s.module}>{s.description}</td>
                      <td>
                        <span className={`badge ${s.status}`}>{s.status}</span>
                      </td>
                      <td>{Math.round(s.durationMs)} ms</td>
                      <td className="error-text">{s.error ?? ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {result.steps.some((s) => s.status === 'failed' && s.screenshotPath) && (
                <div>
                  <p className="section-title">Failure screenshot</p>
                  {result.steps
                    .filter((s) => s.status === 'failed' && s.screenshotPath)
                    .map((s, si) => (
                      <figure key={si} style={{ margin: '0 0 0.75rem' }}>
                        <img src={evidenceUrl(s.screenshotPath!)} alt={`${s.description} failure`} style={{ maxWidth: '100%', borderRadius: 8, border: '1px solid var(--border)' }} />
                        <figcaption className="hint">{s.description} — {s.error}</figcaption>
                      </figure>
                    ))}
                </div>
              )}

              {Object.keys(result.capturedValues).length > 0 && (
                <div>
                  <p className="section-title">Captured values</p>
                  <table>
                    <tbody>
                      {Object.entries(result.capturedValues).map(([k, v]) => (
                        <tr key={k}>
                          <td>{k}</td>
                          <td>{String(v)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {result.fieldEvidence.length > 0 && (
                <div>
                  <p className="section-title">Evidence</p>
                  <div className="evidence-gallery">
                    {result.fieldEvidence.map((f, fi) => (
                      <figure key={fi}>
                        <img src={evidenceUrl(f.screenshotPath)} alt={f.label} loading="lazy" />
                        <figcaption>{f.label}</figcaption>
                      </figure>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))}

          {run.status === 'failed' && (
            <div>
              <p className="section-title">Run log (last 4000 chars)</p>
              <pre className="error-text log-tail">{run.logTail || '(no output captured)'}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
