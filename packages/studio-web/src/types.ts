export type ObjectKind = 'clickable' | 'fillable' | 'toggleable' | 'readable' | 'tableColumn';

export interface StudioUser {
  id: string;
  provider: 'local' | 'google';
  name: string;
  email: string;
  picture?: string;
}

export interface AuthState {
  authenticated: boolean;
  ownerRegistered: boolean;
  googleClientId: string;
  user: StudioUser | null;
}

export interface SapIntegrationStatus {
  configured: boolean;
  url: string;
  username: string;
  source: 'environment' | 'credential-store' | 'none';
  safetyClass: 'unknown' | 'non-production' | 'production-like';
  verificationStatus: 'not-configured' | 'saved-not-live-verified' | 'live-verified';
  verifiedAt: string | null;
  verificationMessage: string | null;
}

export interface IntegrationSettings {
  sap: SapIntegrationStatus;
  salesforce: { configured: boolean; available: boolean };
  oracle: { configured: boolean; available: boolean };
  servicenow: { configured: boolean; available: boolean };
}

export interface ExecutionTargetContext {
  provider: 'SAP';
  profileRef: 'default';
  configured: boolean;
  hostname: string | null;
  origin: string | null;
  credentialSource: SapIntegrationStatus['source'];
  safetyClass: 'unknown' | 'non-production' | 'production-like';
  verificationStatus: 'not-configured' | 'saved-not-live-verified' | 'live-verified';
  verifiedAt: string | null;
  capturedAt: string;
}

export interface WorkspaceContext {
  workspaceId: 'single-owner-workspace';
  owner: StudioUser;
  target: ExecutionTargetContext;
  capturedAt: string;
}

export interface EvidenceGovernance {
  retentionPolicy: 'retain-until-workspace-owner-deletes';
  automaticDeletion: false;
  executionSnapshots: string;
  executionEvents: string;
  canonicalEvidence: string;
  redaction: {
    status: 'enforced';
    credentials: 'excluded';
    executionLogs: 'filtered';
    evidenceValues: 'policy-controlled';
  };
  rationale: string;
}

/** Mirrors @taf/core's ArtifactKind — the tag-store's artifact types for BL-10's processArea grouping. */
export type ArtifactKind = 'testCase' | 'group' | 'dataFile' | 'appId';

export interface ModuleParamDescriptor {
  key: string;
  label: string;
  required: boolean;
  placeholder?: string;
  /** Which kinds of captured control make sense for this param — see ObjectPicker.classifyObjectKind. */
  objectKind?: ObjectKind[];
}

export interface ModuleDescriptor {
  label: string;
  description: string;
  params: ModuleParamDescriptor[];
  /** Groups the module picker (BL-10) — e.g. "Built-In Modules" vs a business-process domain like "Procurement". */
  category?: string;
}

export interface ModuleInfo {
  name: string;
  describe: ModuleDescriptor | null;
}

export interface ModuleCall {
  module: string;
  appId?: string;
  params: Record<string, string>;
  valueBindings?: Record<string, TestStepValueBinding>;
}

export type TestSystemContextKey = 'sap.url' | 'sap.urlBase' | 'sap.username' | 'sap.password' | 'runtime.today';
export type TestStepValueBinding =
  | { source: 'literal' }
  | { source: 'dataset'; key: string }
  | { source: 'systemContext'; key: TestSystemContextKey }
  | { source: 'priorOutput'; output: string };

export interface TestCase {
  name: string;
  steps: ModuleCall[];
  contract?: TestContract;
  application?: TestApplication;
  version?: 1;
  lifecycle?: TestLifecycle;
}

export type TestApplication = 'SAP' | 'Salesforce' | 'Oracle' | 'ServiceNow';
export type TestLifecycle = 'draft' | 'published';
export type TestLibraryStatus = 'draft' | 'ready' | 'published';

export interface TestValidationIssue {
  code: string;
  path: string;
  message: string;
}

export interface TestLibraryItem {
  file: string;
  name: string;
  application: TestApplication;
  processArea: string;
  status: TestLibraryStatus;
  stepCount: number;
}

export type TestValueType = 'string' | 'number' | 'boolean' | 'date' | 'object' | 'collection';
export type DataSensitivity = 'public' | 'business' | 'personal' | 'secret';

export interface TestContractInput {
  name: string;
  type: TestValueType;
  required: boolean;
  runtimeKey?: string;
  description?: string;
  example?: string;
  sensitivity?: DataSensitivity;
}

export interface TestContractOutput {
  name: string;
  type: TestValueType;
  runtimeKey?: string;
  description?: string;
  producedByStep?: string;
  sensitivity?: DataSensitivity;
}

export interface TestContract {
  version: 1;
  inputs: TestContractInput[];
  outputs: TestContractOutput[];
}

export interface CsvDataset {
  format: 'csv';
  headers: string[];
  rows: Record<string, string>[];
}

export type JsonDataValue = string | number | boolean | null | JsonDataValue[] | { [key: string]: JsonDataValue };

export interface JsonDataset {
  format: 'json';
  records: Record<string, JsonDataValue>[];
}

export type Dataset = CsvDataset | JsonDataset;

export interface DataRelationDefinition {
  headerFile: string;
  childFile: string;
  headerKey: string;
  childForeignKey: string;
  collectionPath: string;
}

export interface DataPreview {
  valid: boolean;
  transactionCount: number;
  childRecordCount: number;
  sourceRecordCounts: number[];
  sample?: Record<string, JsonDataValue>[];
}

/** One row of the routeable Test Data Library (BL-025 AC1) — search/format/process-area
 *  facets over every dataset file, without loading its full contents. */
export interface DataLibraryItem {
  file: string;
  format: 'csv' | 'json';
  processArea: string;
  rowCount: number;
}

/** A dataset column's declared shape (BL-025 AC2) — reuses the same type/sensitivity
 *  vocabulary as a Test's own contract inputs/outputs. */
export interface DataColumnSchema {
  file: string;
  column: string;
  type: TestValueType;
  sensitivity: DataSensitivity;
  example?: string;
}

/** Every Process, Regression Pack and relational-CSV definition that references a dataset
 *  file — BL-025 AC3's dependency-impact view, mirroring ObjectControl's usage scan. */
export interface DataFileUsage {
  groups: string[];
  packs: string[];
  relations: string[];
}

export interface Group {
  name: string;
  appId: string;
  testCaseFiles: string[];
  dataFile?: string;
  version?: 1;
  lifecycle?: RegressionPackLifecycle;
  stages?: BusinessProcessStageDefinition[];
}

export type ProcessInputBinding =
  | { source: 'literal'; value: JsonDataValue }
  | { source: 'processData'; path: string }
  | { source: 'stageOutput'; stageId: string; output: string }
  | { source: 'systemContext'; key: 'sap.url' | 'sap.urlBase' | 'sap.username' | 'sap.password' | 'runtime.today' };

export interface BusinessProcessStageDefinition {
  stageId: string;
  testCaseFile: string;
  inputBindings: Record<string, ProcessInputBinding>;
}

export type RegressionPackLifecycle = 'draft' | 'published';
export type RegressionPackMemberKind = 'test' | 'process';

export interface RegressionPackMember {
  id: string;
  kind: RegressionPackMemberKind;
  file: string;
  appId?: string;
  dataFile?: string;
  sessionPolicy: 'fresh-per-iteration' | 'reuse-within-process';
  iterationFailurePolicy: 'stop-execution' | 'continue-next-iteration';
}

export interface RegressionPack {
  version: 1;
  name: string;
  description?: string;
  lifecycle: RegressionPackLifecycle;
  members: RegressionPackMember[];
}

export type ObjectVerificationStatus = 'never' | 'verified' | 'drifted' | 'missing';

export interface ObjectControl {
  appId: string;
  name: string;
  controlId: string;
  bindingPath: string | null;
  controlType: string | null;
  tableId: string | null;
  label: string | null;
  parentControlId: string | null;
  scope?: 'shell' | 'app' | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  updatedBy?: string | null;
  lastVerifiedAt?: string | null;
  verificationStatus?: ObjectVerificationStatus | null;
  /** Computed server-side (BL-024 AC2) — never persisted. */
  unstableId?: boolean;
  /** Names of other objects under the same App ID with the same type + label — a fact-based
   *  proxy for "this looks like the same on-screen element captured twice." */
  likelyDuplicateOf?: string[];
}

/** One reverify attempt against a live scan session, kept even when nothing changed — see
 *  ObjectRepository.VerificationEvent (core) and BL-024 AC1/AC3. */
export interface ObjectVerificationEvent {
  appId: string;
  name: string;
  verifiedAt: string;
  outcome: 'verified' | 'drifted' | 'missing';
  liveControlId?: string | null;
  liveControlType?: string | null;
  liveBindingPath?: string | null;
  liveText?: string | null;
  verifiedBy?: string | null;
}

/** A Compose field's request to capture a brand-new object without leaving the Test editor
 * or losing its in-progress (possibly unsaved) work — see App.tsx's ContextualCapturePanel
 * overlay, which is a sibling panel (like SettingsPanel) rather than a route change, so it
 * never trips the dirty-navigation guard. */
export interface CaptureRequest {
  appId: string;
  kind?: ObjectKind[];
  /** What the tester sees while capturing, e.g. the param's label ("Control name for Click Button"). */
  fieldLabel: string;
  /** Called with the saved object's name once the tester captures/saves one for this field. */
  onCaptured: (name: string) => void;
}

export type ControlCategory = 'actionable' | 'informational' | 'structural';
export type ControlScope = 'shell' | 'app';

export interface DiscoveredControl {
  controlId: string;
  controlType: string;
  bindingPath?: string;
  text?: string;
  parentId?: string;
  category: ControlCategory;
  scope: ControlScope;
  /** For a table Column, the enclosing table's id — see ui5Inspector.ts's enrichWithTableId. */
  tableId?: string;
  /** False when this control's id is purely auto-generated and regenerates on every reload — see ui5Inspector.ts. */
  stableId: boolean;
}

export interface ScanSessionInfo {
  sessionId: string;
  url: string;
  openedAt: string;
}

export interface ScanStatus {
  active: boolean;
  session?: ScanSessionInfo;
}

export interface ScanCaptureResult {
  controls: DiscoveredControl[];
  capturedAt: string;
  pageUrl: string;
}

export interface PickResult {
  status: 'idle' | 'waiting';
  picks: DiscoveredControl[];
}

export interface CapturedDocument {
  id: number;
  appId: string;
  testCaseName: string;
  key: string;
  value: string;
  capturedAt: string;
  reportDir?: string | null;
  /** Links to the audit ledger entry that captured this value — see RunHistorySummary. */
  runId?: string;
}

export type RunMode = 'chain' | 'suite' | 'batch';
export type ExecutionDraftKind = 'singleTest' | 'businessProcess' | 'regressionPack';
export type DataFilterOperator =
  | 'equals'
  | 'not-equals'
  | 'contains'
  | 'starts-with'
  | 'ends-with'
  | 'is-empty'
  | 'is-not-empty';

export interface DataFilter {
  path: string;
  operator: DataFilterOperator;
  value?: string;
}

export interface ExecutionDraft {
  executionKind: ExecutionDraftKind;
  testCaseFiles: string[];
  groupFiles: string[];
  packFile?: string;
  appId: string;
  dataFile?: string;
  headless: boolean;
  mode: RunMode;
  sessionPolicy: 'fresh-per-iteration' | 'reuse-within-process';
  iterationFailurePolicy: 'stop-execution' | 'continue-next-iteration';
  maxRecords?: number;
  dataFilter?: DataFilter;
  dataMode?: 'file' | 'relational-csv';
  childDataFile?: string;
  headerKey?: string;
  childForeignKey?: string;
  collectionPath?: string;
}

export interface PreflightFinding {
  code: string;
  severity: 'blocking' | 'warning' | 'information';
  message: string;
  area: 'scope' | 'data' | 'target' | 'policy';
  reference?: string;
  correction: 'scope' | 'data' | 'settings' | 'preflight';
  correctionRoute?: string;
  requiresAcknowledgement?: boolean;
}

export interface ExecutionPreflightResult {
  ready: boolean;
  planKind: ExecutionDraftKind | null;
  planHash: string | null;
  snapshotHash: string | null;
  preflightToken: string | null;
  expiresAt: string | null;
  target: {
    configured: boolean;
    provider: 'SAP';
    hostname: string | null;
    profileRef: string;
    safetyClass: ExecutionTargetContext['safetyClass'];
    verificationStatus: ExecutionTargetContext['verificationStatus'];
    verifiedAt: string | null;
  };
  matrix: {
    members: number;
    iterations: number;
    stages: number;
    steps: number;
    knownChildRecords: number;
  };
  effectiveData: Array<{
    bindingId: string;
    sourceFiles: string[];
    recordCount: number;
    contentHash: string;
    records: unknown[];
  }>;
  inputMappings: Array<{
    member: string;
    test: string;
    stageId?: string;
    input: string;
    sensitivity: string;
    source: 'literal' | 'processData' | 'stageOutput' | 'systemContext';
    resolvedFrom: string;
  }>;
  findings: PreflightFinding[];
}

/** Lightweight audit ledger listing (BL-12) — omits the full result blob. */
export interface RunHistorySummary {
  id: string;
  startedAt: string;
  finishedAt: string;
  /** Always present — BL-035 AC2's sort key. */
  durationMs: number;
  status: 'passed' | 'failed';
  executedBy: string;
  mode: RunMode;
  appId: string;
  testCaseNames: string[];
  /** File names backing each entry in testCaseNames, in the same order, when known — BL-035
   *  AC4's "source artifacts are linked from the run record". */
  testCaseFiles?: string[];
  dataFile?: string;
  /** Path to this run's compiled evidence PDF (module-by-module status, screenshots, input/output). */
  evidencePdfPath?: string;
  /** The Studio execution this run belongs to — every iteration of one Chain/Suite/Batch shares
   *  the same value (BL-035 AC3's lineage). */
  studioRunId?: string;
  /** studioRunId of the execution this run was rerun from, if any. */
  parentStudioRunId?: string;
  targetHostname?: string;
  targetSafetyClass?: string;
}

export interface RunHistoryFilter {
  appId?: string;
  status?: 'passed' | 'failed';
  mode?: RunMode;
  runId?: string;
  executedBy?: string;
  artifact?: string;
  environment?: string;
  dateFrom?: string;
  dateTo?: string;
  studioRunId?: string;
  query?: string;
  limit?: number;
  offset?: number;
  sortBy?: 'startedAt' | 'durationMs' | 'status';
  sortDirection?: 'asc' | 'desc';
}

/** Full audit ledger record, including the verbatim RunResult/GroupResult. */
export interface RunHistoryEntry extends RunHistorySummary {
  result: unknown;
}

export interface StepResult {
  module: string;
  /** Plain-English, run-specific account of what this step actually did — e.g. "Entered SupplierField = USSU-TRL07". */
  description: string;
  status: 'passed' | 'failed';
  startedAt: string;
  durationMs: number;
  error?: string;
  screenshotPath?: string;
}

export interface FieldEvidence {
  label: string;
  screenshotPath: string;
}

export interface RunResult {
  testCaseName: string;
  status: 'passed' | 'failed';
  startedAt: string;
  durationMs: number;
  steps: StepResult[];
  capturedValues: Record<string, unknown>;
  fieldEvidence: FieldEvidence[];
}

export interface GroupStageResult {
  testCaseName: string;
  status: 'passed' | 'failed';
  startedAt: string;
  durationMs: number;
  steps: StepResult[];
}

export interface BatchGroupResult {
  name: string;
  status: 'passed' | 'failed';
  totalTestCases: number;
  passedCount: number;
  failedTestCase: string | null;
  passPercent: number;
  durationMs: number;
  evidencePdfUrl: string | null;
  stages: GroupStageResult[];
  error?: string;
}

export interface RunStatus {
  id: string;
  status: 'running' | 'cancelling' | 'cancelled' | 'passed' | 'failed';
  mode: 'chain' | 'suite' | 'batch';
  reportDir: string;
  testCaseFiles: string[];
  /** Total reportable units: data iterations for a chain, test cases × rows for a
   * suite, and groups for a batch. */
  totalUnits: number;
  startedAt: string;
  finishedAt?: string;
  exitCode: number | null;
  logTail: string;
  snapshotHash?: string;
  cancellationRequestedAt?: string;
  cancellationBoundary?: 'after-active-iteration';
  parentRunId?: string;
  rerunReason?: string;
  rerunScope?: 'full' | 'failed';
  rerunReviewHash?: string;
  rerunChanges?: RerunDifference[];
  rerunEligibility?: {
    full: { eligible: boolean; reason?: string };
    failed: { eligible: boolean; reason?: string };
  };
  initiatedBy?: StudioUser;
  targetContext?: ExecutionTargetContext;
  evidencePdfUrl: string | null;
  evidenceDocuments: Array<{
    runId: string;
    label: string;
    url: string;
  }>;
  results: RunResult[];
  groupResults?: BatchGroupResult[];
  progress?: {
    completedGroups: number;
    totalGroups: number;
    completedSteps: number;
    totalSteps: number;
    completedStages: number;
    totalStages: number;
    currentGroup: string;
    currentStage: string;
    currentStep: string;
    percent: number;
    childWork?: {
      label: string;
      completed: number;
      total: number;
      currentIndex?: number;
      currentKey?: string;
      status: 'running' | 'passed' | 'failed';
      error?: string;
    };
  };
  hierarchy: {
    executionId: string;
    snapshotHash?: string;
    members: Array<{
      memberId: string;
      name: string;
      status: 'pending' | 'running' | 'passed' | 'failed' | 'cancelled';
      iterations: Array<{
        iterationId: string;
        index: number;
        status: 'pending' | 'running' | 'passed' | 'failed' | 'cancelled';
        stages: unknown[];
        evidencePdfUrl: string | null;
      }>;
    }>;
  };
  diagnosis: {
    memberId?: string;
    memberName?: string;
    iterationId?: string;
    iterationIndex?: number;
    stage?: string;
    step?: string;
    childIndex?: number;
    childKey?: string;
    category: 'setup' | 'data' | 'object' | 'authentication' | 'navigation' | 'assertion' | 'execution';
    message: string;
    screenshotPath?: string;
    /** The exact Test, object, or dataset this failure points at, when determinable (BL-032 AC3). */
    correction?: { kind: 'test' | 'object' | 'data'; route: string; label: string };
  } | null;
}

export interface RerunDifference {
  area: 'plan' | 'data' | 'policies' | 'target' | 'scope';
  field: string;
  sourceValue: string;
  rerunValue: string;
  changed: boolean;
  explanation: string;
}

export interface RerunReview {
  parentRunId: string;
  scope: 'full' | 'failed';
  reason: string;
  eligible: boolean;
  blockingReasons: string[];
  sourceSnapshotHash: string | null;
  proposedSnapshotHash: string | null;
  reviewHash: string;
  eligibleMembers: number;
  eligibleIterations: number;
  excludedPassedIterations: number;
  differences: RerunDifference[];
  changedInputs: RerunDifference[];
}

export interface ExecutionHealthMetrics {
  totalExecutions: number;
  running: number;
  passed: number;
  failed: number;
  cancelled: number;
  averageDurationMs: number;
  averageStartLatencyMs: number;
  completedIterations: number;
  iterationThroughputPerHour: number;
  evidenceExpected: number;
  evidenceAvailable: number;
  failureCategories: Record<string, number>;
  preflight: {
    total: number;
    blocked: number;
    blockingFindings: Record<string, number>;
  };
}
