import { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  ArrowRight,
  ChevronRight,
  CircleDollarSign,
  Clock3,
  FileCheck2,
  FileCode2,
  Layers,
  Play,
  Plus,
  RefreshCw,
  Scan,
  TimerReset,
  TrendingUp,
} from 'lucide-react';
import { api } from '../api';
import type { CapturedDocument, RunHistorySummary } from '../types';
import type { View } from '../App';

interface AutomationOverviewProps {
  onNavigate: (view: View) => void;
}

function displayName(fileName: string) {
  return fileName
    .replace(/\.json$/i, '')
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => (part.length <= 3 ? part.toUpperCase() : `${part[0].toUpperCase()}${part.slice(1)}`))
    .join(' ');
}

function formatTimestamp(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Time unavailable';
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

function formatDuration(run: RunHistorySummary) {
  const start = new Date(run.startedAt).getTime();
  const finish = new Date(run.finishedAt).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(finish) || finish < start) return 'Duration unavailable';
  const totalSeconds = Math.round((finish - start) / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

function executionName(run: RunHistorySummary) {
  if (run.testCaseNames.length === 1) return displayName(run.testCaseNames[0]);
  if (run.testCaseNames.length > 1) return `${run.testCaseNames.length} test cases`;
  return 'Execution';
}

interface ImpactAssumptions {
  manualMinutesPerTest: number;
  manualDurationMultiplier: number;
  manualHourlyCost: number;
  automationHourlyCost: number;
  automationEngineerHourlyCost: number;
  buildAndSetupHours: number;
  buildAmortizationMonths: number;
  maintenanceHoursPerMonth: number;
  licenseCostPerMonth: number;
  infrastructureCostPerMonth: number;
  reviewMinutesPerExecution: number;
  triageMinutesPerFailure: number;
  otherAutomationCost: number;
}

interface ExecutionImpact {
  total: number;
  passed: number;
  failed: number;
  passRate: number | null;
  automationHours: number;
  manualHours: number;
  manualLowHours: number;
  manualHighHours: number;
  timeSavedHours: number;
  manualCost: number;
  automationCost: number;
  potentialCostSaved: number;
  medianAutomationMinutesPerTest: number | null;
  analysisMonths: number;
  runtimeCost: number;
  allocatedBuildCost: number;
  maintenanceCost: number;
  licenseCost: number;
  infrastructureCost: number;
  reviewCost: number;
  triageCost: number;
  otherAutomationCost: number;
}

function runDurationHours(run: RunHistorySummary) {
  const start = new Date(run.startedAt).getTime();
  const finish = new Date(run.finishedAt).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(finish) || finish < start) return 0;
  return (finish - start) / 3_600_000;
}

function calculateExecutionImpact(runs: RunHistorySummary[], assumptions: ImpactAssumptions): ExecutionImpact {
  const durationPerTestMinutes: number[] = [];
  let automationHours = 0;
  let manualHours = 0;
  let manualLowHours = 0;
  let manualHighHours = 0;

  for (const run of runs) {
    const durationHours = runDurationHours(run);
    const testCount = Math.max(1, run.testCaseNames.length);
    automationHours += durationHours;
    if (durationHours > 0) durationPerTestMinutes.push((durationHours * 60) / testCount);

    const testFloorHours = (testCount * assumptions.manualMinutesPerTest) / 60;
    manualHours += Math.max(durationHours * assumptions.manualDurationMultiplier, testFloorHours);
    manualLowHours += Math.max(
      durationHours * Math.max(1, assumptions.manualDurationMultiplier * 0.67),
      testFloorHours * 0.67,
    );
    manualHighHours += Math.max(
      durationHours * assumptions.manualDurationMultiplier * 1.67,
      testFloorHours * 1.67,
    );
  }

  durationPerTestMinutes.sort((a, b) => a - b);
  const middle = Math.floor(durationPerTestMinutes.length / 2);
  const medianAutomationMinutesPerTest = durationPerTestMinutes.length === 0
    ? null
    : durationPerTestMinutes.length % 2 === 0
      ? (durationPerTestMinutes[middle - 1] + durationPerTestMinutes[middle]) / 2
      : durationPerTestMinutes[middle];

  const passed = runs.filter((run) => run.status === 'passed').length;
  const failed = runs.filter((run) => run.status === 'failed').length;
  const manualCost = manualHours * assumptions.manualHourlyCost;
  const validStartTimes = runs
    .map((run) => new Date(run.startedAt).getTime())
    .filter(Number.isFinite);
  const validFinishTimes = runs
    .map((run) => new Date(run.finishedAt).getTime())
    .filter(Number.isFinite);
  const earliestStart = validStartTimes.length > 0 ? Math.min(...validStartTimes) : null;
  const latestFinish = validFinishTimes.length > 0 ? Math.max(...validFinishTimes) : null;
  const historySpanDays = earliestStart !== null && latestFinish !== null
    ? Math.max(0, latestFinish - earliestStart) / 86_400_000
    : 0;
  const analysisMonths = runs.length > 0 ? Math.max(1, Math.ceil(historySpanDays / 30.44)) : 0;

  const runtimeCost = automationHours * assumptions.automationHourlyCost;
  const totalBuildCost = assumptions.buildAndSetupHours * assumptions.automationEngineerHourlyCost;
  const buildAllocationShare = assumptions.buildAmortizationMonths > 0
    ? Math.min(1, analysisMonths / assumptions.buildAmortizationMonths)
    : (analysisMonths > 0 ? 1 : 0);
  const allocatedBuildCost = totalBuildCost * buildAllocationShare;
  const maintenanceCost = assumptions.maintenanceHoursPerMonth
    * analysisMonths
    * assumptions.automationEngineerHourlyCost;
  const licenseCost = assumptions.licenseCostPerMonth * analysisMonths;
  const infrastructureCost = assumptions.infrastructureCostPerMonth * analysisMonths;
  const reviewCost = (runs.length * assumptions.reviewMinutesPerExecution / 60)
    * assumptions.automationEngineerHourlyCost;
  const triageCost = (failed * assumptions.triageMinutesPerFailure / 60)
    * assumptions.automationEngineerHourlyCost;
  const otherAutomationCost = assumptions.otherAutomationCost;
  const automationCost = runtimeCost
    + allocatedBuildCost
    + maintenanceCost
    + licenseCost
    + infrastructureCost
    + reviewCost
    + triageCost
    + otherAutomationCost;

  return {
    total: runs.length,
    passed,
    failed,
    passRate: runs.length > 0 ? (passed / runs.length) * 100 : null,
    automationHours,
    manualHours,
    manualLowHours,
    manualHighHours,
    timeSavedHours: manualHours - automationHours,
    manualCost,
    automationCost,
    potentialCostSaved: manualCost - automationCost,
    medianAutomationMinutesPerTest,
    analysisMonths,
    runtimeCost,
    allocatedBuildCost,
    maintenanceCost,
    licenseCost,
    infrastructureCost,
    reviewCost,
    triageCost,
    otherAutomationCost,
  };
}

function formatHours(value: number) {
  return new Intl.NumberFormat(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(value);
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(value);
}

export function AutomationOverview({ onNavigate }: AutomationOverviewProps) {
  const [testCases, setTestCases] = useState<string[]>([]);
  const [groups, setGroups] = useState<string[]>([]);
  const [objectsCount, setObjectsCount] = useState<number | null>(null);
  const [documents, setDocuments] = useState<CapturedDocument[]>([]);
  const [recentRuns, setRecentRuns] = useState<RunHistorySummary[]>([]);
  const [selectedTestCase, setSelectedTestCase] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [impactAssumptions, setImpactAssumptions] = useState<ImpactAssumptions>({
    manualMinutesPerTest: 12,
    manualDurationMultiplier: 3,
    manualHourlyCost: 50,
    automationHourlyCost: 2,
    automationEngineerHourlyCost: 75,
    buildAndSetupHours: 40,
    buildAmortizationMonths: 12,
    maintenanceHoursPerMonth: 4,
    licenseCostPerMonth: 100,
    infrastructureCostPerMonth: 50,
    reviewMinutesPerExecution: 3,
    triageMinutesPerFailure: 15,
    otherAutomationCost: 0,
  });

  useEffect(() => {
    let active = true;

    async function loadOverview() {
      setLoading(true);
      setLoadError(null);

      const [testCasesResult, groupsResult, appIdsResult, documentsResult, runsResult] = await Promise.allSettled([
        api.listTestCases(),
        api.listGroups(),
        api.listAppIds(),
        api.listDocuments(),
        api.listAuditRuns(),
      ]);

      if (!active) return;
      let unavailable = false;

      if (testCasesResult.status === 'fulfilled') {
        setTestCases(testCasesResult.value);
        setSelectedTestCase((current) => (
          current && testCasesResult.value.includes(current) ? current : (testCasesResult.value[0] ?? null)
        ));
      } else {
        setTestCases([]);
        setSelectedTestCase(null);
        unavailable = true;
      }

      if (groupsResult.status === 'fulfilled') setGroups(groupsResult.value);
      else {
        setGroups([]);
        unavailable = true;
      }

      if (documentsResult.status === 'fulfilled') setDocuments(documentsResult.value);
      else {
        setDocuments([]);
        unavailable = true;
      }

      if (runsResult.status === 'fulfilled') setRecentRuns(runsResult.value);
      else {
        setRecentRuns([]);
        unavailable = true;
      }

      if (appIdsResult.status === 'fulfilled') {
        const objectResults = await Promise.allSettled(appIdsResult.value.map((appId) => api.listObjects(appId)));
        if (!active) return;
        if (objectResults.some((result) => result.status === 'rejected')) {
          setObjectsCount(null);
          unavailable = true;
        } else {
          setObjectsCount(objectResults.reduce(
            (total, result) => total + (result.status === 'fulfilled' ? result.value.length : 0),
            0,
          ));
        }
      } else {
        setObjectsCount(null);
        unavailable = true;
      }

      if (unavailable) setLoadError('Some workspace data is unavailable. You can retry without leaving this page.');
      setLoading(false);
    }

    void loadOverview();
    return () => {
      active = false;
    };
  }, [reloadKey]);

  const selectedRunCount = useMemo(
    () => selectedTestCase
      ? recentRuns.filter((run) => run.testCaseNames.includes(selectedTestCase)).length
      : 0,
    [recentRuns, selectedTestCase],
  );

  const selectedEvidenceCount = useMemo(
    () => selectedTestCase
      ? documents.filter((document) => document.testCaseName === selectedTestCase).length
      : 0,
    [documents, selectedTestCase],
  );

  const executionImpact = useMemo(
    () => calculateExecutionImpact(recentRuns, impactAssumptions),
    [recentRuns, impactAssumptions],
  );

  return (
    <div className="canvas-overview">
      <header className="canvas-overview-intro">
        <div>
          <span className="canvas-eyebrow">Your automation workspace</span>
          <h1>Good morning</h1>
          <p>Continue recent work, review executions, or start a new test.</p>
        </div>
        <div className="canvas-overview-actions">
          <button type="button" className="primary" onClick={() => onNavigate('editor')}>
            <Plus size={17} aria-hidden="true" /> Create test
          </button>
          <button type="button" className="outline" onClick={() => onNavigate('run')}>
            <Play size={16} aria-hidden="true" /> New execution
          </button>
        </div>
      </header>

      <div className="canvas-summary" aria-label="Workspace summary">
        <button type="button" onClick={() => onNavigate('editor')}>
          <FileCode2 size={17} aria-hidden="true" />
          <span><strong>{loading ? '—' : testCases.length}</strong> Tests</span>
        </button>
        <button type="button" onClick={() => onNavigate('groups')}>
          <Layers size={17} aria-hidden="true" />
          <span><strong>{loading ? '—' : groups.length}</strong> Process suites</span>
        </button>
        <button type="button" onClick={() => onNavigate('objects')}>
          <Scan size={17} aria-hidden="true" />
          <span><strong>{loading ? '—' : (objectsCount ?? '—')}</strong> Controls</span>
        </button>
        <button type="button" onClick={() => onNavigate('documents')}>
          <FileCheck2 size={17} aria-hidden="true" />
          <span><strong>{loading ? '—' : documents.length}</strong> Evidence records</span>
        </button>
      </div>

      {loadError && (
        <div className="canvas-load-message" role="status">
          <span>{loadError}</span>
          <button type="button" className="ghost" onClick={() => setReloadKey((key) => key + 1)}>
            <RefreshCw size={14} aria-hidden="true" /> Retry
          </button>
        </div>
      )}

      <ExecutionImpactDashboard
        impact={executionImpact}
        assumptions={impactAssumptions}
        loading={loading}
        onAssumptionsChange={setImpactAssumptions}
      />

      <div className="canvas-overview-layout">
        <div className="canvas-overview-main">
          <section className="canvas-section" aria-labelledby="continue-heading">
            <div className="canvas-section-heading">
              <div>
                <h2 id="continue-heading">Pick up where you left off</h2>
                <p>Saved test cases available in this workspace</p>
              </div>
              <button type="button" className="text-action" onClick={() => onNavigate('editor')}>
                View all <ArrowRight size={14} aria-hidden="true" />
              </button>
            </div>

            <div className="canvas-artifact-list">
              {loading ? (
                <div className="canvas-empty-state">Loading saved work…</div>
              ) : testCases.length > 0 ? (
                testCases.slice(0, 5).map((testCase) => (
                  <button
                    type="button"
                    key={testCase}
                    className={`canvas-artifact-row ${selectedTestCase === testCase ? 'selected' : ''}`}
                    onClick={() => setSelectedTestCase(testCase)}
                    aria-pressed={selectedTestCase === testCase}
                  >
                    <span className="canvas-row-icon"><FileCode2 size={18} aria-hidden="true" /></span>
                    <span className="canvas-row-content">
                      <strong>{displayName(testCase)}</strong>
                      <small>Saved test case · {testCase}</small>
                    </span>
                    <ChevronRight size={17} aria-hidden="true" />
                  </button>
                ))
              ) : (
                <div className="canvas-empty-state">
                  <FileCode2 size={22} aria-hidden="true" />
                  <strong>No test cases yet</strong>
                  <span>Create your first test to begin building this workspace.</span>
                  <button type="button" className="text-action" onClick={() => onNavigate('editor')}>Create a test</button>
                </div>
              )}
            </div>
          </section>

          <div className="canvas-lower-grid">
            <section className="canvas-section" aria-labelledby="executions-heading">
              <div className="canvas-section-heading">
                <div>
                  <h2 id="executions-heading">Recent executions</h2>
                  <p>Latest immutable run records</p>
                </div>
                <button type="button" className="text-action" onClick={() => onNavigate('documents')}>
                  History <ArrowRight size={14} aria-hidden="true" />
                </button>
              </div>

              <div className="canvas-run-list">
                {loading ? (
                  <div className="canvas-empty-state compact">Loading execution history…</div>
                ) : recentRuns.length > 0 ? (
                  recentRuns.slice(0, 4).map((run) => (
                    <button type="button" key={run.id} className="canvas-run-row" onClick={() => onNavigate('documents')}>
                      <span className={`run-status-dot ${run.status}`} aria-hidden="true" />
                      <span className="canvas-row-content">
                        <strong>{executionName(run)}</strong>
                        <small>{formatTimestamp(run.startedAt)} · {formatDuration(run)}</small>
                      </span>
                      <span className={`run-status-text ${run.status}`}>{run.status}</span>
                    </button>
                  ))
                ) : (
                  <div className="canvas-empty-state compact">
                    <Play size={21} aria-hidden="true" />
                    <strong>No recorded executions</strong>
                    <span>Completed runs will appear here.</span>
                  </div>
                )}
              </div>
            </section>

            <section className="canvas-section" aria-labelledby="evidence-heading">
              <div className="canvas-section-heading">
                <div>
                  <h2 id="evidence-heading">Captured evidence</h2>
                  <p>Evidence saved by recorded runs</p>
                </div>
              </div>

              {loading ? (
                <div className="canvas-empty-state compact">Loading evidence…</div>
              ) : documents.length > 0 ? (
                <div className="canvas-evidence-summary">
                  <span className="canvas-evidence-icon"><FileCheck2 size={24} aria-hidden="true" /></span>
                  <strong>{documents.length} evidence record{documents.length === 1 ? '' : 's'}</strong>
                  <span>Across {new Set(documents.map((document) => document.testCaseName)).size} test case{new Set(documents.map((document) => document.testCaseName)).size === 1 ? '' : 's'}</span>
                  <button type="button" className="text-action" onClick={() => onNavigate('documents')}>Open audit and evidence</button>
                </div>
              ) : (
                <div className="canvas-empty-state compact">
                  <FileCheck2 size={21} aria-hidden="true" />
                  <strong>No evidence captured yet</strong>
                  <span>Evidence from recorded executions will appear here.</span>
                </div>
              )}
            </section>
          </div>
        </div>

        <aside className="canvas-inspector" aria-label="Selected test case details">
          {selectedTestCase ? (
            <>
              <div className="canvas-inspector-header">
                <div>
                  <span className="canvas-eyebrow">Test case</span>
                  <h2>{displayName(selectedTestCase)}</h2>
                </div>
              </div>

              <div className="canvas-inspector-actions">
                <button type="button" className="primary" onClick={() => onNavigate('editor')}>
                  Open in Compose
                </button>
                <button type="button" className="outline" onClick={() => onNavigate('run')}>
                  <Play size={15} aria-hidden="true" /> Execute
                </button>
              </div>

              <dl className="canvas-detail-list">
                <div>
                  <dt>Source file</dt>
                  <dd>{selectedTestCase}</dd>
                </div>
                <div>
                  <dt>Recorded executions</dt>
                  <dd>{selectedRunCount}</dd>
                </div>
                <div>
                  <dt>Evidence records</dt>
                  <dd>{selectedEvidenceCount}</dd>
                </div>
              </dl>

              <div className="canvas-inspector-note">
                <TriangleTargetMessage />
              </div>
            </>
          ) : (
            <div className="canvas-empty-state">
              <FileCode2 size={23} aria-hidden="true" />
              <strong>No test selected</strong>
              <span>Select a saved test to see its workspace context.</span>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

interface ExecutionImpactDashboardProps {
  impact: ExecutionImpact;
  assumptions: ImpactAssumptions;
  loading: boolean;
  onAssumptionsChange: (assumptions: ImpactAssumptions) => void;
}

function ExecutionImpactDashboard({
  impact,
  assumptions,
  loading,
  onAssumptionsChange,
}: ExecutionImpactDashboardProps) {
  const updateAssumption = (key: keyof ImpactAssumptions, value: number) => {
    onAssumptionsChange({
      ...assumptions,
      [key]: Number.isFinite(value) ? Math.max(0, value) : 0,
    });
  };

  const passWidth = impact.total > 0 ? (impact.passed / impact.total) * 100 : 0;
  const failWidth = impact.total > 0 ? (impact.failed / impact.total) * 100 : 0;

  return (
    <section className="execution-impact" aria-labelledby="execution-impact-heading">
      <div className="execution-impact-heading">
        <div>
          <span className="canvas-eyebrow">Measured outcomes and modeled impact</span>
          <h2 id="execution-impact-heading">Execution impact</h2>
          <p>Run totals and duration are exact. Manual effort and cost are transparent scenario estimates.</p>
        </div>
        <button type="button" className="text-action" onClick={() => document.querySelector('.canvas-run-list')?.scrollIntoView({ behavior: 'smooth' })}>
          Recent runs <ArrowRight size={14} aria-hidden="true" />
        </button>
      </div>

      <div className="impact-metrics-grid">
        <article className="impact-metric">
          <span className="impact-metric-icon"><Activity size={18} aria-hidden="true" /></span>
          <span className="impact-metric-label">Total executions <small>Actual</small></span>
          <strong className="impact-metric-value">{loading ? '—' : impact.total}</strong>
          <span className="impact-metric-detail">Recorded in the immutable run ledger</span>
        </article>

        <article className="impact-metric outcome">
          <span className="impact-metric-icon"><TrendingUp size={18} aria-hidden="true" /></span>
          <span className="impact-metric-label">Execution outcomes <small>Actual</small></span>
          <div className="impact-outcome-counts">
            <span><strong>{loading ? '—' : impact.passed}</strong> Passed</span>
            <span><strong>{loading ? '—' : impact.failed}</strong> Failed</span>
          </div>
          <div className="impact-outcome-bar" aria-label={impact.passRate === null ? 'No execution outcomes' : `${Math.round(impact.passRate)} percent passed`}>
            <span className="passed" style={{ width: `${passWidth}%` }} />
            <span className="failed" style={{ width: `${failWidth}%` }} />
          </div>
        </article>

        <article className="impact-metric">
          <span className="impact-metric-icon"><Clock3 size={18} aria-hidden="true" /></span>
          <span className="impact-metric-label">Automation runtime <small>Actual</small></span>
          <strong className="impact-metric-value">{loading ? '—' : `${formatHours(impact.automationHours)} h`}</strong>
          <span className="impact-metric-detail">Sum of recorded execution durations</span>
        </article>

        <article className="impact-metric modeled">
          <span className="impact-metric-icon"><TimerReset size={18} aria-hidden="true" /></span>
          <span className="impact-metric-label">Plausible manual effort <small>Modeled</small></span>
          <strong className="impact-metric-value">{loading ? '—' : `${formatHours(impact.manualHours)} h`}</strong>
          <span className="impact-metric-detail">
            Scenario range {formatHours(impact.manualLowHours)}–{formatHours(impact.manualHighHours)} h
          </span>
        </article>

        <article className="impact-metric modeled">
          <span className="impact-metric-icon"><TrendingUp size={18} aria-hidden="true" /></span>
          <span className="impact-metric-label">Potential time saved <small>Modeled</small></span>
          <strong className="impact-metric-value">{loading ? '—' : `${formatHours(impact.timeSavedHours)} h`}</strong>
          <span className="impact-metric-detail">Manual estimate minus automation runtime</span>
        </article>

        <article className="impact-metric modeled">
          <span className="impact-metric-icon"><CircleDollarSign size={18} aria-hidden="true" /></span>
          <span className="impact-metric-label">Potential cost saved <small>Modeled</small></span>
          <strong className={`impact-metric-value${impact.potentialCostSaved < 0 ? ' negative' : ''}`}>
            {loading ? '—' : formatCurrency(impact.potentialCostSaved)}
          </strong>
          <span className="impact-metric-detail">
            {formatCurrency(impact.manualCost)} manual equivalent − {formatCurrency(impact.automationCost)} automation TCO
            {impact.potentialCostSaved < 0 ? ' · investment not yet recovered' : ''}
          </span>
        </article>
      </div>

      <details className="impact-assumptions">
        <summary>Calculation assumptions and model</summary>
        <div className="impact-assumptions-body">
          <p className="impact-assumptions-intro">
            Actual execution duration and outcomes come from the run ledger. The planning defaults below are illustrative;
            replace them with contracted rates, engineering effort, and operating costs for a decision-grade estimate.
          </p>

          <section className="impact-assumption-group" aria-labelledby="manual-model-heading">
            <h3 id="manual-model-heading">Manual equivalent model</h3>
            <div className="impact-assumption-grid manual">
              <label>
                Manual minutes per test
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={assumptions.manualMinutesPerTest}
                  onChange={(event) => updateAssumption('manualMinutesPerTest', event.currentTarget.valueAsNumber)}
                />
              </label>
              <label>
                Manual slowdown factor
                <input
                  type="number"
                  min="0"
                  step="0.25"
                  value={assumptions.manualDurationMultiplier}
                  onChange={(event) => updateAssumption('manualDurationMultiplier', event.currentTarget.valueAsNumber)}
                />
              </label>
              <label>
                Manual hourly cost (USD)
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={assumptions.manualHourlyCost}
                  onChange={(event) => updateAssumption('manualHourlyCost', event.currentTarget.valueAsNumber)}
                />
              </label>
            </div>
            <div className="impact-factor-explainer">
              <strong>What does the slowdown factor mean?</strong>
              <span>
                A factor of {assumptions.manualDurationMultiplier} estimates manual handling at {assumptions.manualDurationMultiplier}×
                the recorded automation runtime. The model uses the larger of that result or {assumptions.manualMinutesPerTest} minutes
                per test. With the observed median of{' '}
                {impact.medianAutomationMinutesPerTest === null
                  ? 'an unavailable duration'
                  : `${impact.medianAutomationMinutesPerTest.toFixed(1)} automated minutes per test`}
                , the duration-based estimate is{' '}
                {impact.medianAutomationMinutesPerTest === null
                  ? 'unavailable'
                  : `${(impact.medianAutomationMinutesPerTest * assumptions.manualDurationMultiplier).toFixed(1)} minutes`}
                .
              </span>
            </div>
          </section>

          <section className="impact-assumption-group" aria-labelledby="automation-cost-heading">
            <h3 id="automation-cost-heading">Automation total cost of ownership</h3>
            <div className="impact-assumption-grid automation">
              <label>
                Automation runtime cost/hour (USD)
                <input
                  type="number"
                  min="0"
                  step="0.5"
                  value={assumptions.automationHourlyCost}
                  onChange={(event) => updateAssumption('automationHourlyCost', event.currentTarget.valueAsNumber)}
                />
              </label>
              <label>
                Automation engineer cost/hour (USD)
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={assumptions.automationEngineerHourlyCost}
                  onChange={(event) => updateAssumption('automationEngineerHourlyCost', event.currentTarget.valueAsNumber)}
                />
              </label>
              <label>
                Initial build and setup hours
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={assumptions.buildAndSetupHours}
                  onChange={(event) => updateAssumption('buildAndSetupHours', event.currentTarget.valueAsNumber)}
                />
              </label>
              <label>
                Build amortization period (months)
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={assumptions.buildAmortizationMonths}
                  onChange={(event) => updateAssumption('buildAmortizationMonths', event.currentTarget.valueAsNumber)}
                />
              </label>
              <label>
                Maintenance hours/month
                <input
                  type="number"
                  min="0"
                  step="0.5"
                  value={assumptions.maintenanceHoursPerMonth}
                  onChange={(event) => updateAssumption('maintenanceHoursPerMonth', event.currentTarget.valueAsNumber)}
                />
              </label>
              <label>
                License and tooling/month (USD)
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={assumptions.licenseCostPerMonth}
                  onChange={(event) => updateAssumption('licenseCostPerMonth', event.currentTarget.valueAsNumber)}
                />
              </label>
              <label>
                Fixed infrastructure/month (USD)
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={assumptions.infrastructureCostPerMonth}
                  onChange={(event) => updateAssumption('infrastructureCostPerMonth', event.currentTarget.valueAsNumber)}
                />
              </label>
              <label>
                Review minutes/execution
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={assumptions.reviewMinutesPerExecution}
                  onChange={(event) => updateAssumption('reviewMinutesPerExecution', event.currentTarget.valueAsNumber)}
                />
              </label>
              <label>
                Failure triage minutes/failed run
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={assumptions.triageMinutesPerFailure}
                  onChange={(event) => updateAssumption('triageMinutesPerFailure', event.currentTarget.valueAsNumber)}
                />
              </label>
              <label>
                Other automation cost for period (USD)
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={assumptions.otherAutomationCost}
                  onChange={(event) => updateAssumption('otherAutomationCost', event.currentTarget.valueAsNumber)}
                />
              </label>
            </div>
          </section>

          <section className="impact-cost-breakdown" aria-labelledby="cost-breakdown-heading">
            <div>
              <h3 id="cost-breakdown-heading">Automation cost included</h3>
              <p>
                Applied across {impact.analysisMonths} billing month{impact.analysisMonths === 1 ? '' : 's'} represented by the current run history.
                Initial build cost is allocated across the configured amortization period.
              </p>
            </div>
            <dl>
              <div><dt>Runtime</dt><dd>{formatCurrency(impact.runtimeCost)}</dd></div>
              <div><dt>Build/setup allocation</dt><dd>{formatCurrency(impact.allocatedBuildCost)}</dd></div>
              <div><dt>Maintenance labor</dt><dd>{formatCurrency(impact.maintenanceCost)}</dd></div>
              <div><dt>Licenses and tooling</dt><dd>{formatCurrency(impact.licenseCost)}</dd></div>
              <div><dt>Fixed infrastructure</dt><dd>{formatCurrency(impact.infrastructureCost)}</dd></div>
              <div><dt>Execution review</dt><dd>{formatCurrency(impact.reviewCost)}</dd></div>
              <div><dt>Failure triage</dt><dd>{formatCurrency(impact.triageCost)}</dd></div>
              <div><dt>Other period cost</dt><dd>{formatCurrency(impact.otherAutomationCost)}</dd></div>
              <div className="total"><dt>Total automation TCO</dt><dd>{formatCurrency(impact.automationCost)}</dd></div>
            </dl>
          </section>

          <p className="impact-model-note">
            The manual scenario range remains a lower/upper planning range, not a confidence interval. The cost comparison
            covers execution economics; add test design, training, migration, governance, security, procurement, or vendor
            support to “Other automation cost” when they apply.
          </p>
        </div>
      </details>
    </section>
  );
}

function TriangleTargetMessage() {
  return (
    <>
      <strong>Execution target not verified</strong>
      <span>Review the configured target before running this test.</span>
    </>
  );
}
