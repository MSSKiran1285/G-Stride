import { useEffect, useMemo, useState } from 'react';
import {
  Box,
  Calendar,
  Check,
  ChevronDown,
  Clock,
  DollarSign,
  ExternalLink,
  FileText,
  FlaskConical,
  GitFork,
  Info,
  Play,
  RefreshCw,
  ShieldCheck,
  Sun,
} from 'lucide-react';
import { api } from '../api';
import type { CapturedDocument, ImpactAssumptions, RunHistorySummary, WorkspaceContext } from '../types';
import type { View } from '../App';

interface AutomationOverviewProps {
  onNavigate: (view: View) => void;
  onNavigateToRoute: (path: string) => void;
  onOpenFailedRuns: () => void;
  workspaceContext: WorkspaceContext | null;
}

function timeOfDayGreeting(hour: number): string {
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
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
  const formatted = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(value);
  return formatted.startsWith('$') ? `US${formatted}` : formatted;
}

export interface WeeklyTrendBucket5Weeks {
  weekLabel: string;
  total: number;
  passed: number;
  failed: number;
  passRate: number | null;
  automationHours: number;
}

export function computeWeeklyTrend5Weeks(runs: RunHistorySummary[]): WeeklyTrendBucket5Weeks[] {
  const now = new Date();
  const dayOfWeek = (now.getUTCDay() + 6) % 7; // 0 = Monday
  const currentMonday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - dayOfWeek));

  const weekBuckets: { mondayIso: string; sundayIso: string; label: string }[] = [];
  for (let i = 0; i <= 4; i++) {
    const monday = new Date(currentMonday.getTime() - i * 7 * 86_400_000);
    const sunday = new Date(monday.getTime() + 6 * 86_400_000);

    const mStr = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(monday);
    const sStr = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(sunday);
    const label = `${mStr} – ${sStr}`;

    weekBuckets.push({
      mondayIso: monday.toISOString().slice(0, 10),
      sundayIso: sunday.toISOString().slice(0, 10),
      label,
    });
  }

  return weekBuckets.map((wb) => {
    const matching = runs.filter((r) => {
      const dateStr = r.startedAt.slice(0, 10);
      return dateStr >= wb.mondayIso && dateStr <= wb.sundayIso;
    });
    const total = matching.length;
    const passed = matching.filter((r) => r.status === 'passed').length;
    const failed = matching.filter((r) => r.status === 'failed').length;
    const passRate = total > 0 ? (passed / total) * 100 : null;
    const automationHours = matching.reduce((sum, r) => sum + runDurationHours(r), 0);

    return {
      weekLabel: wb.label,
      total,
      passed,
      failed,
      passRate,
      automationHours,
    };
  });
}

const IMPACT_WINDOW_SIZE = 500;

const DEFAULT_IMPACT_ASSUMPTIONS: ImpactAssumptions = {
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
};

function dynamicGreetingSubhead(hour: number): string {
  const morningQuestions = [
    'What SAP workflows would you like to test or automate today?',
    'Where should we focus your test automation today?',
    'How can I help you accelerate your S/4HANA quality today?',
    'Ready to inspect your SAP test coverage and execution impact?',
    'Which SAP module or business process would you like to validate today?',
  ];

  const afternoonQuestions = [
    'What SAP business processes are we validating this afternoon?',
    'How can I help you streamline your test executions today?',
    'Where would you like to build or run automated tests next?',
    'Ready to review your latest SAP execution impact and test metrics?',
    'Which SAP test scenario would you like to execute next?',
  ];

  const eveningQuestions = [
    'Ready to review today\'s SAP test execution results and evidence?',
    'What compliance or execution records would you like to inspect tonight?',
    'Here is your end-of-day SAP automation impact and test summary.',
    'Where would you like to pick up your SAP automation next?',
    'How did your SAP automation runs perform today?',
  ];

  const pool = hour < 12 ? morningQuestions : hour < 17 ? afternoonQuestions : eveningQuestions;
  const randomIndex = Math.floor(Math.random() * pool.length);
  return pool[randomIndex];
}

export function AutomationOverview({ onNavigate, workspaceContext }: AutomationOverviewProps) {
  const [testCases, setTestCases] = useState<string[]>([]);
  const [groups, setGroups] = useState<string[]>([]);
  const [objectsCount, setObjectsCount] = useState<number | null>(null);
  const [documents, setDocuments] = useState<CapturedDocument[]>([]);
  const [allRuns, setAllRuns] = useState<RunHistorySummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [dateRangeFilter, setDateRangeFilter] = useState<'30' | '60' | '90' | 'all' | 'custom'>('all');
  const [customStartDate, setCustomStartDate] = useState<string>('');
  const [customEndDate, setCustomEndDate] = useState<string>('');
  const [showDateDropdown, setShowDateDropdown] = useState<boolean>(false);
  const [appIdFilter, setAppIdFilter] = useState('');
  const [impactAssumptions, setImpactAssumptions] = useState<ImpactAssumptions | null>(null);

  useEffect(() => {
    let active = true;

    async function loadOverview() {
      setLoading(true);
      setLoadError(null);

      const [testCasesResult, groupsResult, appIdsResult, documentsResult, runsResult, assumptionsResult] = await Promise.allSettled([
        api.listTestCases(),
        api.listGroups(),
        api.listAppIds(),
        api.listDocuments(),
        api.listAuditRuns({ limit: IMPACT_WINDOW_SIZE, sortBy: 'startedAt', sortDirection: 'desc' }),
        api.getOverviewPreferences(),
      ]);

      if (!active) return;
      const unavailableSections: string[] = [];

      if (testCasesResult.status === 'fulfilled') setTestCases(testCasesResult.value);
      else {
        setTestCases([]);
        unavailableSections.push('Tests');
      }

      if (groupsResult.status === 'fulfilled') setGroups(groupsResult.value);
      else {
        setGroups([]);
        unavailableSections.push('Business Processes');
      }

      if (documentsResult.status === 'fulfilled') setDocuments(documentsResult.value);
      else {
        setDocuments([]);
        unavailableSections.push('Captured Evidence');
      }

      if (runsResult.status === 'fulfilled') setAllRuns(runsResult.value.items);
      else {
        setAllRuns([]);
        unavailableSections.push('Recent Runs');
      }

      if (assumptionsResult.status === 'fulfilled') setImpactAssumptions(assumptionsResult.value);
      else unavailableSections.push('Execution Impact Assumptions');

      if (appIdsResult.status === 'fulfilled') {
        const objectResults = await Promise.allSettled(appIdsResult.value.map((appId) => api.listObjects(appId)));
        if (!active) return;
        if (objectResults.some((result) => result.status === 'rejected')) {
          setObjectsCount(null);
          unavailableSections.push('Controls');
        } else {
          setObjectsCount(objectResults.reduce(
            (total, result) => total + (result.status === 'fulfilled' ? result.value.length : 0),
            0,
          ));
        }
      } else {
        setObjectsCount(null);
        unavailableSections.push('Controls');
      }

      if (unavailableSections.length > 0) {
        setLoadError(`${unavailableSections.join(', ')} could not be loaded. You can retry without leaving this page.`);
      }
      setLoading(false);
    }

    void loadOverview();
    return () => {
      active = false;
    };
  }, [reloadKey]);

  useEffect(() => {
    if (!impactAssumptions) return;
    const timer = setTimeout(() => {
      api.saveOverviewPreferences(impactAssumptions).catch(() => undefined);
    }, 600);
    return () => clearTimeout(timer);
  }, [impactAssumptions]);

  const runAppIds = useMemo(
    () => [...new Set(allRuns.map((run) => run.appId).filter(Boolean))].sort(),
    [allRuns],
  );

  const filteredRuns = useMemo(() => {
    let startMs: number | null = null;
    let endMs: number | null = null;

    if (dateRangeFilter === 'custom') {
      if (customStartDate) startMs = new Date(customStartDate + 'T00:00:00').getTime();
      if (customEndDate) endMs = new Date(customEndDate + 'T23:59:59.999').getTime();
    } else if (dateRangeFilter !== 'all') {
      const days = Number(dateRangeFilter);
      startMs = Date.now() - days * 86_400_000;
    }

    return allRuns.filter((run) => {
      if (appIdFilter && run.appId !== appIdFilter) return false;
      const runMs = new Date(run.startedAt).getTime();
      if (startMs !== null && Number.isFinite(startMs) && runMs < startMs) return false;
      if (endMs !== null && Number.isFinite(endMs) && runMs > endMs) return false;
      return true;
    });
  }, [allRuns, dateRangeFilter, customStartDate, customEndDate, appIdFilter]);

  const executionImpact = useMemo(
    () => calculateExecutionImpact(filteredRuns, impactAssumptions ?? DEFAULT_IMPACT_ASSUMPTIONS),
    [filteredRuns, impactAssumptions],
  );

  const weeklyTrend5Weeks = useMemo(() => computeWeeklyTrend5Weeks(filteredRuns), [filteredRuns]);

  // Always display user name in Camel Case (Capitalized Case)
  const rawUserName = workspaceContext?.owner?.name
    ? workspaceContext.owner.name.split(' ')[0]
    : 'Kiran';
  const userName = rawUserName.charAt(0).toUpperCase() + rawUserName.slice(1).toLowerCase();

  const actualEvidenceCount = allRuns.length || documents.length;
  const now = new Date();

  const [greetingSubhead] = useState(() => dynamicGreetingSubhead(now.getHours()));

  return (
    <div className="ref-overview-canvas">
      {/* Reference Header */}
      <header className="ref-overview-header">
        <div className="ref-greeting-group">
          <h1>
            Good {timeOfDayGreeting(now.getHours()).replace('Good ', '').toLowerCase()}, {userName}
          </h1>
          <p>{greetingSubhead}</p>
        </div>

        <div className="ref-time-widget">
          <div className="ref-time-row">
            <Sun size={18} className="ref-sun-icon" />
            <span className="ref-time-text">
              {new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }).format(now)}
            </span>
          </div>
          <span className="ref-date-text">
            {new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'short', day: 'numeric' }).format(now)}
          </span>
        </div>
      </header>

      {/* Top 4 Summary Strip */}
      <div className="ref-summary-strip" aria-label="Workspace summary">
        <button type="button" className="ref-summary-card" onClick={() => onNavigate('editor')}>
          <div className="ref-summary-icon-wrapper test-blue">
            <FlaskConical size={20} />
          </div>
          <div className="ref-summary-content">
            <strong className="ref-summary-num">{loading ? '—' : testCases.length}</strong>
            <span className="ref-summary-label">Tests</span>
          </div>
        </button>

        <button type="button" className="ref-summary-card" onClick={() => onNavigate('groups')}>
          <div className="ref-summary-icon-wrapper process-green">
            <GitFork size={20} />
          </div>
          <div className="ref-summary-content">
            <strong className="ref-summary-num">{loading ? '—' : groups.length}</strong>
            <span className="ref-summary-label">Business Processes</span>
          </div>
        </button>

        <button type="button" className="ref-summary-card" onClick={() => onNavigate('objects')}>
          <div className="ref-summary-icon-wrapper control-purple">
            <ShieldCheck size={20} />
          </div>
          <div className="ref-summary-content">
            <strong className="ref-summary-num">{loading ? '—' : (objectsCount ?? '—')}</strong>
            <span className="ref-summary-label">Controls</span>
          </div>
        </button>

        <button type="button" className="ref-summary-card" onClick={() => onNavigate('documents')}>
          <div className="ref-summary-icon-wrapper evidence-blue">
            <FileText size={20} />
          </div>
          <div className="ref-summary-content">
            <strong className="ref-summary-num">{loading ? '—' : actualEvidenceCount}</strong>
            <span className="ref-summary-label">Evidence records</span>
          </div>
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

      {/* Execution Impact Section */}
      <ExecutionImpactDashboard
        impact={executionImpact}
        assumptions={impactAssumptions ?? DEFAULT_IMPACT_ASSUMPTIONS}
        loading={loading}
        onAssumptionsChange={setImpactAssumptions}
        dateRangeFilter={dateRangeFilter}
        onDateRangeChange={setDateRangeFilter}
        customStartDate={customStartDate}
        onCustomStartDateChange={setCustomStartDate}
        customEndDate={customEndDate}
        onCustomEndDateChange={setCustomEndDate}
        showDateDropdown={showDateDropdown}
        onToggleDateDropdown={setShowDateDropdown}
        appIdFilter={appIdFilter}
        onAppIdFilterChange={setAppIdFilter}
        appIds={runAppIds}
        weeklyTrend={weeklyTrend5Weeks}
        onNavigate={onNavigate}
        allRuns={allRuns}
      />
    </div>
  );
}

interface ExecutionImpactDashboardProps {
  impact: ExecutionImpact;
  assumptions: ImpactAssumptions;
  loading: boolean;
  onAssumptionsChange: (assumptions: ImpactAssumptions) => void;
  dateRangeFilter: '30' | '60' | '90' | 'all' | 'custom';
  onDateRangeChange: (value: '30' | '60' | '90' | 'all' | 'custom') => void;
  customStartDate: string;
  onCustomStartDateChange: (val: string) => void;
  customEndDate: string;
  onCustomEndDateChange: (val: string) => void;
  showDateDropdown: boolean;
  onToggleDateDropdown: (show: boolean) => void;
  appIdFilter: string;
  onAppIdFilterChange: (value: string) => void;
  appIds: string[];
  weeklyTrend: WeeklyTrendBucket5Weeks[];
  onNavigate: (view: View) => void;
  allRuns: RunHistorySummary[];
}

function ExecutionImpactDashboard({
  impact,
  assumptions,
  loading,
  onAssumptionsChange,
  dateRangeFilter,
  onDateRangeChange,
  customStartDate,
  onCustomStartDateChange,
  customEndDate,
  onCustomEndDateChange,
  showDateDropdown,
  onToggleDateDropdown,
  appIdFilter,
  onAppIdFilterChange,
  appIds,
  weeklyTrend,
  onNavigate,
  allRuns,
}: ExecutionImpactDashboardProps) {
  const updateAssumption = (key: keyof ImpactAssumptions, value: number) => {
    onAssumptionsChange({
      ...assumptions,
      [key]: Number.isFinite(value) ? Math.max(0, value) : 0,
    });
  };

  const passWidth = impact.total > 0 ? (impact.passed / impact.total) * 100 : 0;
  const failWidth = impact.total > 0 ? (impact.failed / impact.total) * 100 : 0;

  const dateRangeDisplayLabel = useMemo(() => {
    if (dateRangeFilter === '30') return 'Last 30 days';
    if (dateRangeFilter === '60') return 'Last 60 days';
    if (dateRangeFilter === '90') return 'Last 90 days';
    if (dateRangeFilter === 'custom' && customStartDate && customEndDate) {
      const s = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(new Date(customStartDate + 'T00:00:00'));
      const e = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(customEndDate + 'T00:00:00'));
      return `${s} – ${e}`;
    }
    if (dateRangeFilter === 'custom') return 'Custom range';
    if (allRuns.length > 0) {
      const times = allRuns.map((r) => new Date(r.startedAt).getTime()).filter(Number.isFinite);
      const min = new Date(Math.min(...times));
      const max = new Date(Math.max(...times));
      const s = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(min);
      const e = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(max);
      return `${s} – ${e}`;
    }
    return 'All available history';
  }, [dateRangeFilter, customStartDate, customEndDate, allRuns]);

  return (
    <section className="ref-impact-section" aria-labelledby="execution-impact-heading">
      {/* Section Title + Inline Filter Pills */}
      <div className="ref-impact-header">
        <h2 id="execution-impact-heading">Execution Impact</h2>
        <div className="ref-impact-filters">
          {/* Custom Date Range Pill */}
          <div className="ref-filter-pill ref-date-pill-container">
            <button
              type="button"
              className="ref-pill-trigger-btn"
              onClick={() => onToggleDateDropdown(!showDateDropdown)}
              aria-expanded={showDateDropdown}
              aria-haspopup="true"
            >
              <Calendar size={15} className="ref-pill-icon" />
              <div className="ref-pill-text">
                <span className="ref-pill-label">Date range</span>
                <span className="ref-pill-value">{dateRangeDisplayLabel}</span>
              </div>
              <ChevronDown size={14} className="ref-pill-chevron" />
            </button>

            {/* Custom Interactive Dropdown Menu */}
            {showDateDropdown && (
              <div className="ref-dropdown-menu">
                <div className="ref-dropdown-presets">
                  <button
                    type="button"
                    className={`ref-dropdown-item${dateRangeFilter === 'all' ? ' active' : ''}`}
                    onClick={() => {
                      onDateRangeChange('all');
                      onToggleDateDropdown(false);
                    }}
                  >
                    All available history
                  </button>
                  <button
                    type="button"
                    className={`ref-dropdown-item${dateRangeFilter === '30' ? ' active' : ''}`}
                    onClick={() => {
                      onDateRangeChange('30');
                      onToggleDateDropdown(false);
                    }}
                  >
                    Last 30 days
                  </button>
                  <button
                    type="button"
                    className={`ref-dropdown-item${dateRangeFilter === '60' ? ' active' : ''}`}
                    onClick={() => {
                      onDateRangeChange('60');
                      onToggleDateDropdown(false);
                    }}
                  >
                    Last 60 days
                  </button>
                  <button
                    type="button"
                    className={`ref-dropdown-item${dateRangeFilter === '90' ? ' active' : ''}`}
                    onClick={() => {
                      onDateRangeChange('90');
                      onToggleDateDropdown(false);
                    }}
                  >
                    Last 90 days
                  </button>
                </div>

                <div className="ref-dropdown-divider" />

                <div className="ref-custom-date-section">
                  <span className="ref-custom-date-title">Custom date range</span>
                  <div className="ref-datepicker-inputs">
                    <label>
                      Start date
                      <input
                        type="date"
                        value={customStartDate}
                        onChange={(e) => onCustomStartDateChange(e.currentTarget.value)}
                      />
                    </label>
                    <label>
                      End date
                      <input
                        type="date"
                        value={customEndDate}
                        onChange={(e) => onCustomEndDateChange(e.currentTarget.value)}
                      />
                    </label>
                  </div>
                  <div className="ref-datepicker-footer">
                    <button
                      type="button"
                      className="ref-dp-apply"
                      disabled={!customStartDate || !customEndDate}
                      onClick={() => {
                        if (customStartDate && customEndDate) {
                          onDateRangeChange('custom');
                          onToggleDateDropdown(false);
                        }
                      }}
                    >
                      Apply
                    </button>
                    <button
                      type="button"
                      className="ref-dp-clear"
                      onClick={() => {
                        onCustomStartDateChange('');
                        onCustomEndDateChange('');
                        onDateRangeChange('all');
                        onToggleDateDropdown(false);
                      }}
                    >
                      Reset
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* App ID Pill */}
          <div className="ref-filter-pill ref-app-pill-container">
            <Box size={15} className="ref-pill-icon" />
            <div className="ref-pill-text">
              <span className="ref-pill-label">App ID</span>
              <span className="ref-pill-value">{appIdFilter || 'All Apps'}</span>
            </div>
            <ChevronDown size={14} className="ref-pill-chevron" />
            <select
              className="ref-overlay-select"
              value={appIdFilter}
              onChange={(e) => onAppIdFilterChange(e.currentTarget.value)}
            >
              <option value="">All Apps</option>
              {appIds.map((id) => <option key={id} value={id}>{id}</option>)}
            </select>
          </div>
        </div>
      </div>

      {/* Side-by-Side Actual & Modeled Group Cards */}
      <div className="ref-impact-grid">
        {/* Left Container: ACTUAL */}
        <div className="ref-impact-group actual-group">
          <div className="ref-group-badge">
            <span className="ref-dot green-dot">●</span>
            <span className="ref-badge-title green-title">ACTUAL</span>
            <span className="ref-badge-desc">Real outcomes from executed automation</span>
          </div>
          <div className="ref-cards-trio">
            <article className="ref-card">
              <div className="ref-card-header">
                <span className="ref-card-icon blue-icon"><Play size={13} /></span>
                <span className="ref-card-title">Total executions</span>
              </div>
              <strong className="ref-card-value">{loading ? '—' : impact.total}</strong>
              <span className="ref-card-sub">Across all tests</span>
            </article>

            <article className="ref-card">
              <div className="ref-card-header">
                <span className="ref-card-icon green-icon"><Check size={13} /></span>
                <span className="ref-card-title">Execution outcomes</span>
              </div>
              <div className="ref-outcome-counts">
                <span className="passed-text"><strong>{loading ? '—' : impact.passed}</strong> Passed</span>
                <span className="sep">|</span>
                <span className="failed-text"><strong>{loading ? '—' : impact.failed}</strong> Failed</span>
              </div>
              <div className="ref-outcome-bar">
                <span className="passed-seg" style={{ width: `${passWidth}%` }} />
                <span className="failed-seg" style={{ width: `${failWidth}%` }} />
              </div>
              <span className="ref-card-sub">
                {impact.passRate === null ? 'No executions' : `Pass rate: ${impact.passRate.toFixed(1)}%`}
              </span>
            </article>

            <article className="ref-card">
              <div className="ref-card-header">
                <span className="ref-card-icon blue-icon"><Clock size={13} /></span>
                <span className="ref-card-title">Automation runtime</span>
              </div>
              <strong className="ref-card-value">{loading ? '—' : `${formatHours(impact.automationHours)} h`}</strong>
              <span className="ref-card-sub">Total time executed</span>
            </article>
          </div>
        </div>

        {/* Right Container: MODELED */}
        <div className="ref-impact-group modeled-group">
          <div className="ref-group-badge">
            <span className="ref-dot orange-dot">●</span>
            <span className="ref-badge-title orange-title">MODELED</span>
            <span className="ref-badge-desc">Estimated impact if done manually</span>
          </div>
          <div className="ref-cards-trio">
            <article className="ref-card">
              <div className="ref-card-header">
                <span className="ref-card-icon orange-icon"><Clock size={13} /></span>
                <span className="ref-card-title">Plausible manual effort</span>
              </div>
              <strong className="ref-card-value orange-text">{loading ? '—' : `${formatHours(impact.manualHours)} h`}</strong>
              <span className="ref-card-sub">Time it would take manually</span>
            </article>

            <article className="ref-card">
              <div className="ref-card-header">
                <span className="ref-card-icon orange-icon"><Clock size={13} /></span>
                <span className="ref-card-title">Potential time saved</span>
              </div>
              <strong className="ref-card-value orange-text">{loading ? '—' : `${formatHours(impact.timeSavedHours)} h`}</strong>
              <span className="ref-card-sub">After accounting for automation runtime</span>
            </article>

            <article className="ref-card">
              <div className="ref-card-header">
                <span className="ref-card-icon orange-icon"><DollarSign size={13} /></span>
                <span className="ref-card-title">Potential cost saved</span>
              </div>
              <strong className="ref-card-value orange-text">
                {loading ? '—' : formatCurrency(impact.potentialCostSaved)}
              </strong>
              <span className="ref-card-sub">Based on blended hourly rate</span>
            </article>
          </div>
        </div>
      </div>

      {/* Weekly Trend Section */}
      <section className="ref-weekly-trend">
        <div className="ref-trend-header">
          <div className="ref-trend-title-group">
            <h3>Weekly trend (last 5 weeks)</h3>
            <Info size={15} className="ref-info-icon" />
          </div>
          <button type="button" className="ref-btn-link" onClick={() => onNavigate('documents')}>
            View full report <ExternalLink size={13} />
          </button>
        </div>

        <div className="ref-table-card">
          <table className="ref-trend-table">
            <thead>
              <tr>
                <th scope="col">Week</th>
                <th scope="col">Total Executions</th>
                <th scope="col">Passed</th>
                <th scope="col">Failed</th>
                <th scope="col">Pass Rate</th>
                <th scope="col">Automation Runtime (h)</th>
              </tr>
            </thead>
            <tbody>
              {weeklyTrend.map((week) => (
                <tr key={week.weekLabel}>
                  <td>{week.weekLabel}</td>
                  <td>{week.total}</td>
                  <td className="passed-num">{week.passed}</td>
                  <td className="failed-num">{week.failed}</td>
                  <td>
                    <div className="ref-pass-rate-cell">
                      <div className="ref-rate-bar">
                        <span style={{ width: `${week.passRate ?? 0}%` }} />
                      </div>
                      <span className="ref-rate-text">{week.passRate === null ? '—' : `${week.passRate.toFixed(1)}%`}</span>
                    </div>
                  </td>
                  <td>{week.automationHours.toFixed(1)} h</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Calculation Assumptions Collapsible */}
      <details className="ref-assumptions">
        <summary>
          <ChevronDown size={14} className="ref-assumptions-chevron" />
          <span>Calculation assumptions</span>
          <Info size={14} className="ref-info-icon" />
          <span className="ref-assumptions-line" />
        </summary>

        <div className="impact-assumptions-body">
          <p className="impact-assumptions-intro">
            Actual execution duration and outcomes come from the run ledger. The planning defaults below are illustrative;
            replace them with contracted rates, engineering effort, and operating costs for a decision-grade estimate.
          </p>

          <section className="impact-assumption-group">
            <h3>Manual equivalent model</h3>
            <div className="impact-assumption-grid manual">
              <label>
                Manual minutes per test
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={assumptions.manualMinutesPerTest}
                  onChange={(e) => updateAssumption('manualMinutesPerTest', e.currentTarget.valueAsNumber)}
                />
              </label>
              <label>
                Manual slowdown factor
                <input
                  type="number"
                  min="0"
                  step="0.25"
                  value={assumptions.manualDurationMultiplier}
                  onChange={(e) => updateAssumption('manualDurationMultiplier', e.currentTarget.valueAsNumber)}
                />
              </label>
              <label>
                Manual hourly cost (USD)
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={assumptions.manualHourlyCost}
                  onChange={(e) => updateAssumption('manualHourlyCost', e.currentTarget.valueAsNumber)}
                />
              </label>
            </div>
          </section>

          <section className="impact-assumption-group">
            <h3>Automation total cost of ownership</h3>
            <div className="impact-assumption-grid automation">
              <label>
                Automation runtime cost/hour (USD)
                <input
                  type="number"
                  min="0"
                  step="0.5"
                  value={assumptions.automationHourlyCost}
                  onChange={(e) => updateAssumption('automationHourlyCost', e.currentTarget.valueAsNumber)}
                />
              </label>
              <label>
                Automation engineer cost/hour (USD)
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={assumptions.automationEngineerHourlyCost}
                  onChange={(e) => updateAssumption('automationEngineerHourlyCost', e.currentTarget.valueAsNumber)}
                />
              </label>
            </div>
          </section>
        </div>
      </details>
    </section>
  );
}
