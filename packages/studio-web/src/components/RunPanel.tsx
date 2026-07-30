import { useEffect, useRef, useState } from 'react';
import { Boxes, CheckCircle2, GitBranch, PlayCircle, RotateCcw, ShieldCheck, Square, TestTube2 } from 'lucide-react';
import { api } from '../api';
import type {
  DataFilterOperator,
  ExecutionDraft,
  ExecutionDraftKind,
  ExecutionHealthMetrics,
  ExecutionPreflightResult,
  RerunReview,
  RunStatus,
} from '../types';
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
  const unit = isBatch ? 'process iteration' : run.mode === 'suite' ? 'test case' : 'iteration';
  const plural = (n: number) => (n === 1 ? unit : `${unit}s`);
  const completedUnits = isBatch ? groupResults.length : results.length;
  const totalUnits = Math.max(1, run.totalUnits ?? completedUnits);
  const active = run.status === 'running' || run.status === 'cancelling';
  const hasStepProgress = active && Boolean(run.progress?.totalSteps);
  const progressPercent = active
    ? hasStepProgress
      ? Math.min(99, Math.max(0, Math.round(run.progress!.percent)))
      : Math.min(99, Math.round((completedUnits / totalUnits) * 100))
    : 100;
  const awaitingFirstResult = active && completedUnits === 0 && !hasStepProgress;
  const progressSummary = hasStepProgress
    ? `${run.progress!.completedSteps} of ${run.progress!.totalSteps} steps · ${run.progress!.completedStages} of ${run.progress!.totalStages} scenarios completed`
    : active
      ? awaitingFirstResult
        ? `Starting first ${unit}`
        : `${completedUnits} of ${totalUnits} ${plural(totalUnits)} completed`
      : `${totalUnits} of ${totalUnits} ${plural(totalUnits)} completed`;

  let label: string;
  if (run.status === 'cancelling') {
    label = 'Cancellation requested — finishing the active transaction…';
  } else if (run.status === 'running') {
    label = 'Running…';
  } else if (run.status === 'cancelled') {
    label = 'Run cancelled at a safe transaction boundary';
  } else if (isBatch || run.mode === 'suite') {
    label = passedCount === total ? `✓ All ${total} ${plural(total)} passed` : `⚠ ${passedCount}/${total} ${plural(total)} passed`;
  } else {
    label = run.status === 'passed' ? `✓ Run passed (${passedCount}/${total} ${plural(total)})` : '✗ Run failed';
  }

  return (
    <div
      className={`completion-banner ${run.status}`}
      role="status"
      aria-live="polite"
      aria-busy={active}
    >
      <span className="completion-label">{label}</span>
      {!active && <span className="hint">exit code {run.exitCode}</span>}
      {run.evidencePdfUrl && !active && (
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
            {run.progress!.childWork
              ? ` · ${run.progress!.childWork.label} ${run.progress!.childWork.completed}/${run.progress!.childWork.total}${run.progress!.childWork.currentKey ? ` (${run.progress!.childWork.currentKey})` : ''}`
              : ''}
          </span>
        )}
        <span className="run-progress-track" aria-hidden="true">
          <span className="run-progress-fill" style={{ width: awaitingFirstResult ? undefined : `${progressPercent}%` }} />
        </span>
      </div>
    </div>
  );
}

export function RunPanel({
  initialRunId,
  onRunStarted,
  onNavigateToRoute,
  onOpenSapSettings,
  onDirtyChange,
}: {
  initialRunId?: string;
  onRunStarted?: (runId: string) => void;
  onNavigateToRoute?: (path: string) => void;
  onOpenSapSettings?: () => void;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const [files, setFiles] = useState<string[]>([]);
  const [groups, setGroups] = useState<string[]>([]);
  const [packs, setPacks] = useState<string[]>([]);
  const [dataFiles, setDataFiles] = useState<string[]>([]);
  const [chain, setChain] = useState<string[]>([]);
  const [mode, setMode] = useState<'single' | 'chain' | 'suite' | 'batch' | 'pack'>('single');
  const [appId, setAppId] = useState('createPurchaseOrder');
  const [dataFile, setDataFile] = useState('');
  const [headless, setHeadless] = useState(false);
  const [sessionPolicy, setSessionPolicy] = useState<'fresh-per-iteration' | 'reuse-within-process'>('fresh-per-iteration');
  const [iterationFailurePolicy, setIterationFailurePolicy] = useState<'stop-execution' | 'continue-next-iteration'>('continue-next-iteration');
  const [maxRecords, setMaxRecords] = useState('');
  const [filterPath, setFilterPath] = useState('');
  const [filterOperator, setFilterOperator] = useState<DataFilterOperator>('equals');
  const [filterValue, setFilterValue] = useState('');
  const [dataMode, setDataMode] = useState<'file' | 'relational-csv'>('file');
  const [childDataFile, setChildDataFile] = useState('');
  const [headerKey, setHeaderKey] = useState('scenarioKey');
  const [childForeignKey, setChildForeignKey] = useState('scenarioKey');
  const [collectionPath, setCollectionPath] = useState('items');
  const [run, setRun] = useState<RunStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [monitorError, setMonitorError] = useState<string | null>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [starting, setStarting] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [rerunning, setRerunning] = useState(false);
  const [reviewingRerun, setReviewingRerun] = useState(false);
  const [rerunScope, setRerunScope] = useState<'full' | 'failed'>('failed');
  const [rerunReason, setRerunReason] = useState('');
  const [rerunReview, setRerunReview] = useState<RerunReview | null>(null);
  const [rerunReviewOpen, setRerunReviewOpen] = useState(false);
  const [healthMetrics, setHealthMetrics] = useState<ExecutionHealthMetrics | null>(null);
  const [preflighting, setPreflighting] = useState(false);
  const [preflight, setPreflight] = useState<ExecutionPreflightResult | null>(null);
  const [warningsAcknowledged, setWarningsAcknowledged] = useState(false);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollDelayRef = useRef(2000);
  const mountedRef = useRef(true);
  const startingRef = useRef(false);
  const reviewDialogRef = useRef<HTMLDialogElement>(null);
  const reviewCancelRef = useRef<HTMLButtonElement>(null);
  const rerunReviewDialogRef = useRef<HTMLDialogElement>(null);
  const rerunReviewCancelRef = useRef<HTMLButtonElement>(null);
  const rerunRequestKeyRef = useRef<string | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    api.listTestCases().then(setFiles).catch((e) => setError(String(e)));
    api.listGroups().then(setGroups).catch((e) => setError(String(e)));
    api.listPacks().then(setPacks).catch((e) => setError(String(e)));
    api.listData().then(setDataFiles).catch((e) => setError(String(e)));
    api.getExecutionMetrics().then(setHealthMetrics).catch(() => undefined);
    return () => {
      mountedRef.current = false;
      if (pollRef.current) clearTimeout(pollRef.current);
    };
  }, []);

  useEffect(() => {
    if (initialRunId) void pollRun(initialRunId);
  }, [initialRunId]);

  useEffect(() => {
    const dirty = chain.length > 0 && !run;
    onDirtyChange?.(dirty);
    const preventRefresh = (event: BeforeUnloadEvent) => {
      if (!dirty) return;
      event.preventDefault();
    };
    window.addEventListener('beforeunload', preventRefresh);
    return () => window.removeEventListener('beforeunload', preventRefresh);
  }, [chain.length, run, onDirtyChange]);

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

  useEffect(() => {
    const dialog = rerunReviewDialogRef.current;
    if (!dialog) return;
    if (rerunReviewOpen && !dialog.open) {
      dialog.showModal();
      requestAnimationFrame(() => rerunReviewCancelRef.current?.focus());
    } else if (!rerunReviewOpen && dialog.open) {
      dialog.close();
    }
  }, [rerunReviewOpen]);

  useEffect(() => {
    if (!run?.rerunEligibility) return;
    if (rerunScope === 'failed' && !run.rerunEligibility.failed.eligible) {
      setRerunScope(run.rerunEligibility.full.eligible ? 'full' : 'failed');
    }
  }, [run?.id, run?.rerunEligibility, rerunScope]);

  useEffect(() => {
    invalidatePreflight();
  }, [
    mode,
    chain,
    appId,
    dataFile,
    headless,
    sessionPolicy,
    iterationFailurePolicy,
    maxRecords,
    filterPath,
    filterOperator,
    filterValue,
    dataMode,
    childDataFile,
    headerKey,
    childForeignKey,
    collectionPath,
  ]);

  // Switching modes carries over a selection that means something different in the
  // new mode (a test case file isn't a group name) — start the composition over.
  function switchMode(next: 'single' | 'chain' | 'suite' | 'batch' | 'pack') {
    setMode(next);
    setChain([]);
    setDataFile('');
    setChildDataFile('');
    setIterationFailurePolicy(next === 'chain' || next === 'pack' ? 'stop-execution' : 'continue-next-iteration');
    invalidatePreflight();
  }

  function invalidatePreflight() {
    setPreflight(null);
    setWarningsAcknowledged(false);
  }

  function executionKind(): ExecutionDraftKind {
    if (mode === 'single') return 'singleTest';
    if (mode === 'chain') return 'businessProcess';
    return 'regressionPack';
  }

  function legacyMode(): 'chain' | 'suite' | 'batch' {
    if (mode === 'chain') return 'chain';
    if (mode === 'batch' || mode === 'pack') return 'batch';
    return 'suite';
  }

  function draft(): ExecutionDraft {
    return {
      executionKind: executionKind(),
      testCaseFiles: mode === 'batch' || mode === 'pack' ? [] : chain,
      groupFiles: mode === 'batch' ? chain : [],
      packFile: mode === 'pack' ? chain[0] : undefined,
      appId,
      dataFile: mode === 'batch' || mode === 'pack' ? undefined : dataFile || undefined,
      headless,
      mode: legacyMode(),
      sessionPolicy,
      iterationFailurePolicy,
      maxRecords: maxRecords ? Number(maxRecords) : undefined,
      dataFilter: filterPath.trim()
        ? {
            path: filterPath.trim(),
            operator: filterOperator,
            value: ['is-empty', 'is-not-empty'].includes(filterOperator) ? undefined : filterValue,
          }
        : undefined,
      dataMode: mode === 'batch' || mode === 'pack' ? 'file' : dataMode,
      childDataFile: mode !== 'batch' && mode !== 'pack' && dataMode === 'relational-csv' ? childDataFile || undefined : undefined,
      headerKey: mode !== 'batch' && mode !== 'pack' && dataMode === 'relational-csv' ? headerKey : undefined,
      childForeignKey: mode !== 'batch' && mode !== 'pack' && dataMode === 'relational-csv' ? childForeignKey : undefined,
      collectionPath: mode !== 'batch' && mode !== 'pack' && dataMode === 'relational-csv' ? collectionPath : undefined,
    };
  }

  async function reviewRun() {
    if (chain.length === 0) {
      setError(`Select at least one ${mode === 'pack' ? 'saved Regression Pack' : mode === 'batch' ? 'Business Process' : 'Test'} before preflight.`);
      return;
    }
    if (mode === 'single' && chain.length !== 1) {
      setError('Single Test requires exactly one saved Test.');
      return;
    }
    setError(null);
    setPreflighting(true);
    try {
      const result = await api.preflightExecution(draft());
      setPreflight(result);
      setWarningsAcknowledged(false);
      setReviewOpen(true);
    } catch (reason) {
      setError(String(reason));
    } finally {
      setPreflighting(false);
    }
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
      if (status.status === 'running' || status.status === 'cancelling') schedulePoll(id);
      else {
        pollRef.current = null;
        api.getExecutionMetrics().then(setHealthMetrics).catch(() => undefined);
      }
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
      if (!preflight?.ready || !preflight.preflightToken || !preflight.planHash) {
        throw new Error('A successful preflight is required before Start.');
      }
      const executionDraft = draft();
      const started = await api.startRun({
        ...executionDraft,
        preflightToken: preflight.preflightToken,
        planHash: preflight.planHash,
        acknowledgedWarnings: warningsAcknowledged
          ? preflight.findings.filter((finding) => finding.requiresAcknowledgement).map((finding) => finding.code)
          : [],
      });
      setRun(started);
      onRunStarted?.(started.id);
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

  async function requestCancellation() {
    if (!run || (run.status !== 'running' && run.status !== 'cancelling')) return;
    setCancelling(true);
    setError(null);
    try {
      const next = await api.cancelRun(run.id);
      setRun(next);
      schedulePoll(run.id, 500);
    } catch (reason) {
      setError(String(reason));
    } finally {
      setCancelling(false);
    }
  }

  async function requestRerunReview() {
    if (!run || !rerunReason.trim()) {
      setError('Enter a reason before creating a traceable rerun.');
      return;
    }
    setReviewingRerun(true);
    setError(null);
    try {
      const review = await api.reviewRerun(run.id, {
        scope: rerunScope,
        reason: rerunReason.trim(),
      });
      setRerunReview(review);
      rerunRequestKeyRef.current = crypto.randomUUID();
      setRerunReviewOpen(true);
    } catch (reason) {
      setError(String(reason));
    } finally {
      setReviewingRerun(false);
    }
  }

  async function confirmRerun() {
    if (!run || !rerunReview?.eligible || !rerunRequestKeyRef.current) return;
    setRerunning(true);
    setError(null);
    try {
      const next = await api.rerunRun(run.id, {
        scope: rerunReview.scope,
        reason: rerunReview.reason,
        requestKey: rerunRequestKeyRef.current,
        reviewHash: rerunReview.reviewHash,
      });
      setRerunReviewOpen(false);
      setRun(next);
      setRerunReason('');
      setRerunReview(null);
      rerunRequestKeyRef.current = null;
      onRunStarted?.(next.id);
      schedulePoll(next.id, 500);
    } catch (reason) {
      setError(String(reason));
    } finally {
      setRerunning(false);
    }
  }

  return (
    <div className="stack execution-workspace">
      <section className="execution-hero">
        <div>
          <span className="canvas-eyebrow">New execution</span>
          <h2>Prepare a controlled SAP run</h2>
          <p>Choose the business intent, bind its data, and validate the exact work before SAP is opened.</p>
        </div>
        <div className="execution-safety-mark"><ShieldCheck size={20} /><span>Preflight required</span></div>
      </section>

      {healthMetrics && (
        <details className="execution-health">
          <summary>Execution health and planning metrics</summary>
          <div className="execution-health-grid">
            <span><strong>{healthMetrics.totalExecutions}</strong> executions</span>
            <span><strong>{healthMetrics.passed}</strong> passed</span>
            <span><strong>{healthMetrics.failed}</strong> failed</span>
            <span><strong>{healthMetrics.cancelled}</strong> cancelled</span>
            <span><strong>{healthMetrics.iterationThroughputPerHour}</strong> iterations/hour</span>
            <span>
              <strong>{healthMetrics.evidenceAvailable}/{healthMetrics.evidenceExpected}</strong> evidence available
            </span>
            <span><strong>{healthMetrics.preflight.blocked}</strong> blocked preflights</span>
            <span><strong>{healthMetrics.averageStartLatencyMs} ms</strong> average start latency</span>
          </div>
        </details>
      )}

      <ol className="execution-stepper" aria-label="Execution preparation steps">
        <li className="active"><span>1</span><strong>Scope</strong></li>
        <li className={chain.length ? 'active' : ''}><span>2</span><strong>Data &amp; policies</strong></li>
        <li className={preflight ? 'active' : ''}><span>3</span><strong>Preflight</strong></li>
        <li className={preflight?.ready ? 'active' : ''}><span>4</span><strong>Review</strong></li>
      </ol>

      <div className="panel stack execution-config-panel">
        <div className="row" style={{ alignItems: 'center' }}>
          <p className="section-title" style={{ margin: 0 }}>
            Execution type
          </p>
          <div className="app-nav">
            <button className={mode === 'single' ? 'active' : ''} onClick={() => switchMode('single')}>
              <TestTube2 size={15} aria-hidden="true" /> Single Test
            </button>
            <button className={mode === 'chain' ? 'active' : ''} onClick={() => switchMode('chain')}>
              <GitBranch size={15} aria-hidden="true" /> Business Process
            </button>
            <button className={mode === 'suite' ? 'active' : ''} onClick={() => switchMode('suite')}>
              <Boxes size={15} aria-hidden="true" /> Pack · Tests
            </button>
            <button className={mode === 'batch' ? 'active' : ''} onClick={() => switchMode('batch')}>
              <Boxes size={15} aria-hidden="true" /> Pack · Processes
            </button>
            <button className={mode === 'pack' ? 'active' : ''} onClick={() => switchMode('pack')}>
              <Boxes size={15} aria-hidden="true" /> Saved Pack
            </button>
          </div>
        </div>
        <p className="hint" style={{ margin: '-0.4rem 0 0.2rem' }}>
          {mode === 'single'
            ? 'One reusable Test. A dataset creates one isolated iteration per record; without a dataset it runs once.'
            : mode === 'chain'
            ? 'A dependent, multi-stage business process (e.g. Create PO → Goods Receipt → Invoice) — one shared session, later steps can use values earlier ones captured. Loops every row of the data file: each row is one full pass through the whole chain. Stops at the first failure.'
            : mode === 'suite'
            ? 'Independent scenarios that shouldn\'t affect each other (a regression pack: happy path, negative path, edge cases) — each its own fresh session. Loops every row × every test case. A failure in one does not stop the others.'
            : mode === 'batch'
            ? 'Independent, named business scenarios (Groups) run as one regression pack — each has its own App ID and data file. Every data row creates an isolated process iteration, and a failure in one Group does not prevent the next Group from running.'
            : 'Run a published Regression Pack exactly as authored, including mixed independent Tests and Business Processes with member-specific data and policies.'}
        </p>

        <FileChainPicker
          availableLabel={mode === 'pack' ? 'Available saved Packs' : mode === 'batch' ? 'Available Business Processes' : 'Available Tests'}
          selectedLabel={mode === 'pack' ? 'Selected saved Pack' : mode === 'single' ? 'Selected Test' : mode === 'chain' ? 'Stage order' : 'Pack members'}
          items={mode === 'pack' ? packs : mode === 'batch' ? groups : files}
          selected={chain}
          onChange={(next) => setChain(mode === 'single' || mode === 'pack' ? next.slice(-1) : next)}
        />

        <div className="param-grid">
          {mode !== 'batch' && mode !== 'pack' && (
            <>
              <div>
                <label>App ID</label>
                <input aria-label="Execution App ID" type="text" value={appId} onChange={(e) => setAppId(e.target.value)} />
              </div>
              <div>
                <label htmlFor="execution-data-mode">Data model</label>
                <select
                  id="execution-data-mode"
                  value={dataMode}
                  onChange={(event) => {
                    setDataMode(event.target.value as typeof dataMode);
                    setChildDataFile('');
                  }}
                >
                  <option value="file">Single CSV or nested JSON</option>
                  <option value="relational-csv">Header CSV + child CSV</option>
                </select>
              </div>
              <div>
                <label>{dataMode === 'relational-csv' ? 'Header data file' : 'Transaction data file'}</label>
                <select aria-label="Execution data file" value={dataFile} onChange={(e) => setDataFile(e.target.value)}>
                  <option value="">— none —</option>
                  {dataFiles.map((f) => (
                    <option key={f} value={f}>
                      {f}
                    </option>
                  ))}
                </select>
              </div>
              {dataMode === 'relational-csv' && (
                <>
                  <div>
                    <label htmlFor="execution-child-data">Child data file</label>
                    <select id="execution-child-data" value={childDataFile} onChange={(event) => setChildDataFile(event.target.value)}>
                      <option value="">— select child file —</option>
                      {dataFiles.filter((file) => file.endsWith('.csv') && file !== dataFile).map((file) => (
                        <option key={file} value={file}>{file}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label htmlFor="execution-header-key">Header join key</label>
                    <input id="execution-header-key" value={headerKey} onChange={(event) => setHeaderKey(event.target.value)} />
                  </div>
                  <div>
                    <label htmlFor="execution-child-key">Child foreign key</label>
                    <input id="execution-child-key" value={childForeignKey} onChange={(event) => setChildForeignKey(event.target.value)} />
                  </div>
                  <div>
                    <label htmlFor="execution-collection-path">Child collection name</label>
                    <input id="execution-collection-path" value={collectionPath} onChange={(event) => setCollectionPath(event.target.value)} />
                  </div>
                </>
              )}
            </>
          )}
          <div>
            <label>
              <input type="checkbox" checked={headless} onChange={(e) => setHeadless(e.target.checked)} style={{ width: 'auto', marginRight: '0.4rem' }} />
              Headless
            </label>
          </div>
          {mode === 'pack' && (
            <div>
              <span className="hint">Data, application, session and failure policies come from the published Pack definition.</span>
            </div>
          )}
          {mode !== 'pack' && (
            <>
          <div>
            <label htmlFor="execution-session-policy">Session policy</label>
            <select
              id="execution-session-policy"
              value={sessionPolicy}
              onChange={(event) => setSessionPolicy(event.target.value as typeof sessionPolicy)}
            >
              <option value="fresh-per-iteration">Fresh browser per transaction</option>
              <option value="reuse-within-process">Reuse session within process</option>
            </select>
          </div>
          <div>
            <label htmlFor="execution-failure-policy">After an iteration failure</label>
            <select
              id="execution-failure-policy"
              value={iterationFailurePolicy}
              onChange={(event) => setIterationFailurePolicy(event.target.value as typeof iterationFailurePolicy)}
            >
              <option value="stop-execution">Stop remaining iterations</option>
              <option value="continue-next-iteration">Continue to next transaction</option>
            </select>
          </div>
          <div>
            <label htmlFor="execution-max-records">Maximum transaction records</label>
            <input
              id="execution-max-records"
              type="number"
              min="1"
              step="1"
              placeholder="All selected records"
              value={maxRecords}
              onChange={(event) => setMaxRecords(event.target.value)}
            />
          </div>
          <div>
            <label htmlFor="execution-filter-path">Filter property</label>
            <input
              id="execution-filter-path"
              placeholder="e.g. scenarioKey or header.salesOrg"
              value={filterPath}
              onChange={(event) => setFilterPath(event.target.value)}
            />
          </div>
          <div>
            <label htmlFor="execution-filter-operator">Filter rule</label>
            <select
              id="execution-filter-operator"
              value={filterOperator}
              onChange={(event) => setFilterOperator(event.target.value as DataFilterOperator)}
              disabled={!filterPath.trim()}
            >
              <option value="equals">Equals</option>
              <option value="not-equals">Does not equal</option>
              <option value="contains">Contains</option>
              <option value="starts-with">Starts with</option>
              <option value="ends-with">Ends with</option>
              <option value="is-empty">Is empty</option>
              <option value="is-not-empty">Is not empty</option>
            </select>
          </div>
          <div>
            <label htmlFor="execution-filter-value">Filter value</label>
            <input
              id="execution-filter-value"
              value={filterValue}
              onChange={(event) => setFilterValue(event.target.value)}
              disabled={!filterPath.trim() || ['is-empty', 'is-not-empty'].includes(filterOperator)}
              placeholder={['is-empty', 'is-not-empty'].includes(filterOperator) ? 'Not required' : 'Exact or partial value'}
            />
          </div>
            </>
          )}
          <div>
            <span className="hint">
              Evidence is generated automatically and shared with Audit and Evidence.
            </span>
          </div>
        </div>

        {error && <p className="error-text" role="alert">{error}</p>}

        <div>
          <button className="primary" onClick={() => void reviewRun()} disabled={preflighting || starting || run?.status === 'running' || run?.status === 'cancelling'}>
            {preflighting ? 'Checking readiness…' : run?.status === 'running' || run?.status === 'cancelling' ? 'Running…' : 'Run preflight'}
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
            <h2 id="run-review-title" className="section-title">
              {preflight?.ready ? <CheckCircle2 size={19} aria-hidden="true" /> : <ShieldCheck size={19} aria-hidden="true" />}
              Preflight and impact review
            </h2>
            <p id="run-review-description" className="hint">
              {preflight?.ready
                ? 'Studio validated the plan, saved assets, object references, dataset, and configured target context.'
                : 'Start is blocked until every blocking finding below is corrected and preflight is run again.'}
            </p>
          </div>
          <dl className="run-review-summary">
            <div><dt>Execution type</dt><dd>{executionKind() === 'singleTest' ? 'Single Test' : executionKind() === 'businessProcess' ? 'Business Process' : 'Regression Pack'}</dd></div>
            <div><dt>{mode === 'pack' ? 'Saved Pack' : mode === 'batch' ? 'Business Processes' : 'Tests'}</dt><dd>{chain.join(' → ')}</dd></div>
            {mode !== 'batch' && mode !== 'pack' && <div><dt>App ID</dt><dd>{appId || 'Not provided'}</dd></div>}
            {mode !== 'batch' && mode !== 'pack' && <div><dt>Data file</dt><dd>{dataFile || 'None'}</dd></div>}
            <div><dt>SAP target</dt><dd>{preflight?.target.hostname ?? 'Not configured'}</dd></div>
            <div><dt>Target class</dt><dd>{preflight?.target.safetyClass === 'non-production' ? 'Non-production' : preflight?.target.safetyClass === 'production-like' ? 'Production-like' : 'Unclassified'}</dd></div>
            <div><dt>Target verification</dt><dd>{preflight?.target.verificationStatus === 'live-verified' && preflight.target.verifiedAt ? `Verified ${new Date(preflight.target.verifiedAt).toLocaleString()}` : 'Verification required'}</dd></div>
            <div><dt>Browser</dt><dd>{headless ? 'Headless' : 'Visible'}</dd></div>
            <div><dt>Session policy</dt><dd>{sessionPolicy === 'fresh-per-iteration' ? 'Fresh browser per transaction' : 'Reuse within process'}</dd></div>
            <div><dt>Failure policy</dt><dd>{iterationFailurePolicy === 'stop-execution' ? 'Stop remaining iterations' : 'Continue to next transaction'}</dd></div>
            <div><dt>Record limit</dt><dd>{maxRecords || 'All selected records'}</dd></div>
            <div>
              <dt>Data filter</dt>
              <dd>
                {filterPath.trim()
                  ? `${filterPath.trim()} ${filterOperator}${['is-empty', 'is-not-empty'].includes(filterOperator) ? '' : ` "${filterValue}"`}`
                  : 'No filter'}
              </dd>
            </div>
            <div><dt>Evidence PDF</dt><dd>One canonical document per audit run</dd></div>
          </dl>
          {preflight && (
            <>
              <div className="preflight-matrix" aria-label="Calculated execution matrix">
                <span><strong>{preflight.matrix.members}</strong> Members</span>
                <span><strong>{preflight.matrix.iterations}</strong> Iterations</span>
                <span><strong>{preflight.matrix.stages}</strong> Stages</span>
                <span><strong>{preflight.matrix.steps}</strong> Steps</span>
                <span><strong>{preflight.matrix.knownChildRecords}</strong> Known child records</span>
              </div>
              <section className="preflight-effective-data" aria-labelledby="effective-data-title">
                <div className="preflight-section-heading">
                  <div>
                    <h3 id="effective-data-title">Approved effective data</h3>
                    <p className="hint">
                      These exact selected records are sealed into snapshot {preflight.snapshotHash?.slice(0, 12) ?? 'unavailable'} and reused by Start.
                    </p>
                  </div>
                </div>
                {preflight.effectiveData.length === 0 ? (
                  <p className="hint">No external dataset is bound; the execution uses one implicit transaction context.</p>
                ) : preflight.effectiveData.map((data) => (
                  <details key={data.bindingId} className="effective-data-binding" open={preflight.effectiveData.length === 1}>
                    <summary>
                      <strong>{data.bindingId}</strong>
                      <span>{data.recordCount} selected record{data.recordCount === 1 ? '' : 's'}</span>
                      <span>{data.sourceFiles.join(' + ')}</span>
                    </summary>
                    <p className="snapshot-fingerprint">Data hash: {data.contentHash}</p>
                    <pre aria-label={`Selected records for ${data.bindingId}`}>{JSON.stringify(data.records, null, 2)}</pre>
                  </details>
                ))}
              </section>
              <section className="preflight-mapping-preview" aria-labelledby="mapping-preview-title">
                <h3 id="mapping-preview-title">Resolved input mappings</h3>
                {preflight.inputMappings.length === 0 ? (
                  <p className="hint">The selected Tests declare no external inputs.</p>
                ) : (
                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>Member / Test</th>
                          <th>Input</th>
                          <th>Source</th>
                          <th>Resolved from</th>
                        </tr>
                      </thead>
                      <tbody>
                        {preflight.inputMappings.map((mapping, index) => (
                          <tr key={`${mapping.member}-${mapping.stageId ?? 'test'}-${mapping.input}-${index}`}>
                            <td>
                              <strong>{mapping.member}</strong>
                              <small>{mapping.test}{mapping.stageId ? ` · ${mapping.stageId}` : ''}</small>
                            </td>
                            <td>{mapping.input}<small>{mapping.sensitivity}</small></td>
                            <td>{mapping.source}</td>
                            <td><code>{mapping.resolvedFrom}</code></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
              <div className="preflight-findings" aria-label="Preflight findings">
                {preflight.findings.length === 0 && <p className="fiori-message-strip success">No preflight findings.</p>}
                {preflight.findings.map((finding, index) => (
                  <div key={`${finding.code}-${index}`} className={`preflight-finding ${finding.severity}`}>
                    <strong>{finding.severity === 'blocking' ? 'Blocked' : finding.severity === 'warning' ? 'Review' : 'Information'}</strong>
                    <span>{finding.message}</span>
                    {finding.reference && <small>{finding.reference}</small>}
                    {finding.correctionRoute && finding.correction !== 'preflight' && (
                      <button
                        type="button"
                        className="ghost"
                        onClick={() => {
                          setReviewOpen(false);
                          if (finding.correction === 'settings') onOpenSapSettings?.();
                          else onNavigateToRoute?.(finding.correctionRoute!);
                        }}
                      >
                        {finding.correction === 'settings'
                          ? 'Open SAP settings'
                          : finding.correction === 'data'
                            ? 'Open dataset'
                            : 'Open source'}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}
          <div className="fiori-message-strip warning" role="alert">
            This execution may create or change real SAP business documents.
          </div>
          {preflight?.findings.some((finding) => finding.requiresAcknowledgement) && (
            <label className="execution-warning-ack">
              <input type="checkbox" checked={warningsAcknowledged} onChange={(event) => setWarningsAcknowledged(event.target.checked)} />
              I reviewed the target warning and intend to start this execution.
            </label>
          )}
          <div className="row run-review-actions">
            <button ref={reviewCancelRef} type="button" onClick={() => setReviewOpen(false)}>Cancel</button>
            <button
              type="button"
              className="primary"
              disabled={
                starting
                || !preflight?.ready
                || (preflight.findings.some((finding) => finding.requiresAcknowledgement) && !warningsAcknowledged)
              }
              onClick={() => void executeRun()}
            >
              <PlayCircle size={16} aria-hidden="true" /> {starting ? 'Starting…' : 'Confirm and start'}
            </button>
          </div>
        </div>
      </dialog>

      <dialog
        ref={rerunReviewDialogRef}
        className="run-review-dialog rerun-review-dialog"
        aria-labelledby="rerun-review-title"
        onCancel={(event) => {
          event.preventDefault();
          setRerunReviewOpen(false);
        }}
        onClose={() => setRerunReviewOpen(false)}
      >
        <div className="stack">
          <div>
            <p className="eyebrow">Immutable recovery review</p>
            <h2 id="rerun-review-title" className="section-title">
              <RotateCcw size={19} aria-hidden="true" /> Compare source and rerun
            </h2>
            <p className="hint">
              Nothing starts until this comparison is eligible and explicitly confirmed.
            </p>
          </div>
          {rerunReview && (
            <>
              <div className="preflight-matrix rerun-review-metrics" aria-label="Calculated rerun scope">
                <span><strong>{rerunReview.eligibleMembers}</strong> Members</span>
                <span><strong>{rerunReview.eligibleIterations}</strong> Iterations</span>
                <span><strong>{rerunReview.excludedPassedIterations}</strong> Passed excluded</span>
                <span><strong>{rerunReview.changedInputs.length}</strong> Differences</span>
              </div>
              {rerunReview.blockingReasons.length > 0 && (
                <div className="preflight-findings" aria-label="Rerun blockers">
                  {rerunReview.blockingReasons.map((reason, index) => (
                    <div className="preflight-finding blocking" key={`${reason}-${index}`}>
                      <strong>Blocked</strong>
                      <span>{reason}</span>
                    </div>
                  ))}
                </div>
              )}
              <div className="rerun-difference-table table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Area</th>
                      <th>Source execution</th>
                      <th>Proposed rerun</th>
                      <th>Result</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rerunReview.differences.map((difference) => (
                      <tr key={`${difference.area}-${difference.field}`}>
                        <td><strong>{difference.field}</strong><small>{difference.area}</small></td>
                        <td><code>{difference.sourceValue}</code></td>
                        <td><code>{difference.rerunValue}</code></td>
                        <td>
                          <span className={`badge ${difference.changed ? 'warning' : 'passed'}`}>
                            {difference.changed ? 'Changed' : 'Inherited'}
                          </span>
                          <small>{difference.explanation}</small>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="snapshot-fingerprint">
                Source snapshot: {rerunReview.sourceSnapshotHash ?? 'Unavailable'}<br />
                Proposed snapshot: {rerunReview.proposedSnapshotHash ?? 'Unavailable'}
              </p>
            </>
          )}
          <div className="row run-review-actions">
            <button ref={rerunReviewCancelRef} type="button" onClick={() => setRerunReviewOpen(false)}>Cancel</button>
            <button
              type="button"
              className="primary"
              disabled={rerunning || !rerunReview?.eligible}
              onClick={() => void confirmRerun()}
            >
              <RotateCcw size={16} aria-hidden="true" />
              {rerunning ? 'Creating rerun…' : 'Confirm safe rerun'}
            </button>
          </div>
        </div>
      </dialog>

      {run && (
        <div className="panel stack">
          <CompletionBanner run={run} />

          {(run.status === 'running' || run.status === 'cancelling') && (
            <div className="run-recovery-actions">
              <div>
                <strong>Safe cancellation</strong>
                <p className="hint">The active transaction finishes; no new transaction or Pack member will start.</p>
              </div>
              <button
                type="button"
                className="danger-outline"
                disabled={cancelling || run.status === 'cancelling'}
                onClick={() => void requestCancellation()}
              >
                <Square size={15} aria-hidden="true" />
                {run.status === 'cancelling' || cancelling ? 'Cancellation requested' : 'Cancel after active transaction'}
              </button>
            </div>
          )}

          {run.parentRunId && (
            <>
              <p className="run-lineage">
                Rerun of <a href={`/execute/runs/${encodeURIComponent(run.parentRunId)}`}>{run.parentRunId}</a>
                {run.rerunScope ? ` · ${run.rerunScope} scope` : ''}
                {run.rerunReason ? ` · ${run.rerunReason}` : ''}
              </p>
              {run.rerunChanges && run.rerunChanges.length > 0 && (
                <details className="rerun-recorded-changes">
                  <summary>{run.rerunChanges.length} reviewed input difference{run.rerunChanges.length === 1 ? '' : 's'}</summary>
                  <ul>
                    {run.rerunChanges.map((change, index) => (
                      <li key={`${change.area}-${change.field}-${index}`}>
                        <strong>{change.field}</strong>: {change.sourceValue} → {change.rerunValue}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </>
          )}

          {(run.initiatedBy || run.targetContext) && (
            <p className="run-lineage">
              {run.initiatedBy && (
                <>Started by {run.initiatedBy.name}{run.initiatedBy.provider === 'google' ? ` · ${run.initiatedBy.email}` : ''}</>
              )}
              {run.initiatedBy && run.targetContext && ' · '}
              {run.targetContext && (
                <>
                  SAP target {run.targetContext.hostname ?? 'not configured'} ·{' '}
                  {run.targetContext.safetyClass === 'non-production' ? 'Non-production' : run.targetContext.safetyClass === 'production-like' ? 'Production-like' : 'Unclassified'} ·{' '}
                  {run.targetContext.verificationStatus === 'live-verified'
                    ? `verified ${run.targetContext.verifiedAt ? new Date(run.targetContext.verifiedAt).toLocaleString() : ''}`
                    : 'verification required'}
                </>
              )}
            </p>
          )}

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

          {run.hierarchy?.members.length > 0 && (
            <section className="execution-hierarchy" aria-label="Execution hierarchy">
              <div className="execution-hierarchy-heading">
                <div>
                  <p className="eyebrow">Execution monitor</p>
                  <h3>Process and transaction progress</h3>
                </div>
                {run.hierarchy.snapshotHash && (
                  <span className="snapshot-reference" title={run.hierarchy.snapshotHash}>
                    Snapshot {run.hierarchy.snapshotHash.slice(0, 10)}
                  </span>
                )}
              </div>
              {run.hierarchy.members.map((member) => (
                <details className="execution-member" key={member.memberId} open>
                  <summary>
                    <span>{member.name}</span>
                    <span className={`badge ${member.status}`}>{member.status}</span>
                  </summary>
                  <ol className="execution-iterations">
                    {member.iterations.map((iteration) => (
                      <li key={iteration.iterationId}>
                        <span>Transaction {iteration.index + 1}</span>
                        <span className={`badge ${iteration.status}`}>{iteration.status}</span>
                        {iteration.evidencePdfUrl && (
                          <a href={iteration.evidencePdfUrl} target="_blank" rel="noreferrer">
                            Evidence PDF ↗
                          </a>
                        )}
                      </li>
                    ))}
                  </ol>
                </details>
              ))}
            </section>
          )}

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
            <div className="failure-diagnosis">
              {run.diagnosis && (
                <>
                  <p className="eyebrow">Root failure · {run.diagnosis.category}</p>
                  <h3>{run.diagnosis.step ?? run.diagnosis.stage ?? 'Execution setup'}</h3>
                  <dl className="diagnosis-grid">
                    <div><dt>Member</dt><dd>{run.diagnosis.memberName ?? 'Execution'}</dd></div>
                    <div><dt>Transaction</dt><dd>{run.diagnosis.iterationIndex !== undefined ? run.diagnosis.iterationIndex + 1 : 'Not started'}</dd></div>
                    <div><dt>Stage</dt><dd>{run.diagnosis.stage ?? 'Not started'}</dd></div>
                    <div><dt>Child item</dt><dd>{run.diagnosis.childKey ?? (run.diagnosis.childIndex !== undefined ? run.diagnosis.childIndex + 1 : 'Not applicable')}</dd></div>
                  </dl>
                  <p className="error-text">{run.diagnosis.message}</p>
                  {run.diagnosis.correction && (
                    <button
                      type="button"
                      className="ghost"
                      onClick={() => onNavigateToRoute?.(run.diagnosis!.correction!.route)}
                    >
                      {run.diagnosis.correction.label}
                    </button>
                  )}
                </>
              )}
              <p className="section-title">Run log (last 4000 chars)</p>
              <pre className="error-text log-tail">{run.logTail || '(no output captured)'}</pre>
            </div>
          )}

          {run.status !== 'running' && run.status !== 'cancelling' && (
            <section className="rerun-panel" aria-labelledby="rerun-heading">
              <div>
                <p className="eyebrow">Recovery</p>
                <h3 id="rerun-heading">Create a traceable rerun</h3>
                <p className="hint">A new execution and snapshot are created. This run and its evidence remain unchanged.</p>
              </div>
              <label>
                Scope
                <select value={rerunScope} onChange={(event) => setRerunScope(event.target.value as 'full' | 'failed')}>
                  <option value="failed" disabled={run.rerunEligibility ? !run.rerunEligibility.failed.eligible : false}>
                    Failed or unattempted scope only
                  </option>
                  <option value="full" disabled={run.rerunEligibility ? !run.rerunEligibility.full.eligible : false}>
                    Full original scope
                  </option>
                </select>
                {run.rerunEligibility && !run.rerunEligibility[rerunScope].eligible && (
                  <span className="hint">{run.rerunEligibility[rerunScope].reason}</span>
                )}
              </label>
              <label>
                Rerun reason
                <input value={rerunReason} onChange={(event) => setRerunReason(event.target.value)} placeholder="Why is this rerun required?" />
              </label>
              <button
                type="button"
                className="primary"
                disabled={
                  reviewingRerun
                  || rerunning
                  || !rerunReason.trim()
                  || Boolean(run.rerunEligibility && !run.rerunEligibility[rerunScope].eligible)
                }
                onClick={() => void requestRerunReview()}
              >
                <RotateCcw size={15} aria-hidden="true" />
                {reviewingRerun ? 'Calculating differences…' : 'Review differences'}
              </button>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
