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
}

export interface IntegrationSettings {
  sap: SapIntegrationStatus;
  salesforce: { configured: boolean; available: boolean };
  oracle: { configured: boolean; available: boolean };
  servicenow: { configured: boolean; available: boolean };
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
}

export interface TestCase {
  name: string;
  steps: ModuleCall[];
}

export interface Dataset {
  headers: string[];
  rows: Record<string, string>[];
}

export interface Group {
  name: string;
  appId: string;
  testCaseFiles: string[];
  dataFile?: string;
}

export interface ObjectControl {
  appId: string;
  name: string;
  controlId: string;
  bindingPath: string | null;
  controlType: string | null;
  tableId: string | null;
  label: string | null;
  parentControlId: string | null;
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

/** Lightweight audit ledger listing (BL-12) — omits the full result blob. */
export interface RunHistorySummary {
  id: string;
  startedAt: string;
  finishedAt: string;
  status: 'passed' | 'failed';
  executedBy: string;
  mode: RunMode;
  appId: string;
  testCaseNames: string[];
  dataFile?: string;
  /** Path to this run's compiled evidence PDF (module-by-module status, screenshots, input/output). */
  evidencePdfPath?: string;
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
  status: 'running' | 'passed' | 'failed';
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
  };
}
