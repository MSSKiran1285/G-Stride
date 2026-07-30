import type {
  ModuleInfo,
  TestCase,
  ObjectControl,
  ObjectVerificationEvent,
  RunStatus,
  RerunReview,
  Dataset,
  DataPreview,
  DataRelationDefinition,
  Group,
  RegressionPack,
  ScanStatus,
  ScanSessionInfo,
  ScanCaptureResult,
  PickResult,
  CapturedDocument,
  ArtifactKind,
  RunHistorySummary,
  RunHistoryEntry,
  AuthState,
  IntegrationSettings,
  SapIntegrationStatus,
  ExecutionDraft,
  ExecutionHealthMetrics,
  ExecutionPreflightResult,
  WorkspaceContext,
  EvidenceGovernance,
  TestContract,
  TestLibraryItem,
  TestValidationIssue,
  DataLibraryItem,
  DataColumnSchema,
  DataFileUsage,
  TestValueType,
  DataSensitivity,
} from './types';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
    ...init,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error ?? `Request to ${path} failed (${res.status})`);
  }
  return res.json();
}

export const api = {
  getAuthState: () => request<AuthState>('/api/auth/state'),
  signInWithGoogle: (credential: string) =>
    request<{ user: AuthState['user'] }>('/api/auth/google', {
      method: 'POST',
      body: JSON.stringify({ credential }),
    }),
  signOut: () => request<{ ok: true }>('/api/auth/logout', { method: 'POST' }),
  saveGoogleClientId: (clientId: string) =>
    request<AuthState>('/api/settings/auth/google', {
      method: 'PUT',
      body: JSON.stringify({ clientId }),
    }),
  getIntegrationSettings: () => request<IntegrationSettings>('/api/settings/integrations'),
  getWorkspaceContext: () => request<WorkspaceContext>('/api/workspace-context'),
  saveSapIntegration: (body: {
    url: string;
    username: string;
    password: string;
    safetyClass: 'non-production' | 'production-like';
  }) =>
    request<SapIntegrationStatus>('/api/settings/integrations/sap', {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
  verifySapIntegration: () =>
    request<{
      target: Pick<SapIntegrationStatus, 'safetyClass' | 'verificationStatus' | 'verifiedAt' | 'verificationMessage'>;
      message: string;
    }>('/api/settings/integrations/sap/verify', { method: 'POST' }),
  getEvidenceGovernance: () => request<EvidenceGovernance>('/api/evidence-governance'),
  listModules: () => request<ModuleInfo[]>('/api/modules'),
  listTestCases: () => request<string[]>('/api/testcases'),
  listTestLibrary: () => request<TestLibraryItem[]>('/api/testcases/library'),
  getTestCase: (file: string) => request<TestCase>(`/api/testcases/${encodeURIComponent(file)}`),
  getTestContract: (file: string) => request<TestContract>(`/api/testcases/${encodeURIComponent(file)}/contract`),
  saveTestCase: (file: string, testCase: TestCase) =>
    request<{ ok: true }>(`/api/testcases/${encodeURIComponent(file)}`, {
      method: 'PUT',
      body: JSON.stringify(testCase),
    }),
  createTestCase: (file: string, testCase: TestCase, processArea = '') =>
    request<{ ok: true }>(`/api/testcases/${encodeURIComponent(file)}`, {
      method: 'POST',
      body: JSON.stringify({ testCase, processArea }),
    }),
  validateTestCase: (testCase: TestCase) =>
    request<{ valid: boolean; issues: TestValidationIssue[] }>('/api/testcases/validate', {
      method: 'POST',
      body: JSON.stringify({ testCase }),
    }),
  listAppIds: () => request<string[]>('/api/app-ids'),
  getModuleUsage: (module: string, paramKey: string) =>
    request<string[]>(`/api/module-usage/${encodeURIComponent(module)}/${encodeURIComponent(paramKey)}`),
  listProcessAreas: () => request<string[]>('/api/process-areas'),
  listTags: (kind: ArtifactKind) => request<Record<string, string>>(`/api/tags/${kind}`),
  setTag: (kind: ArtifactKind, name: string, processArea: string) =>
    request<{ ok: true }>(`/api/tags/${kind}/${encodeURIComponent(name)}`, { method: 'PUT', body: JSON.stringify({ processArea }) }),
  listObjects: (appId: string) => request<ObjectControl[]>(`/api/objects/${encodeURIComponent(appId)}`),
  saveObject: (
    appId: string,
    name: string,
    body: { controlId: string; controlType: string; bindingPath?: string; label?: string; parentControlId?: string; tableId?: string; scope?: 'shell' | 'app' }
  ) =>
    request<{ ok: true }>(`/api/objects/${encodeURIComponent(appId)}/${encodeURIComponent(name)}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
  /** Blocked with a 409 (surfaced as a thrown error whose message includes usedBy's count) unless
   *  force is true — see server's dependency-aware delete (BL-022 AC3). */
  deleteObject: (appId: string, name: string, force = false) =>
    request<{ ok: true; usedBy: string[] }>(
      `/api/objects/${encodeURIComponent(appId)}/${encodeURIComponent(name)}${force ? '?force=true' : ''}`,
      { method: 'DELETE' }
    ),
  renameObject: (appId: string, name: string, newName: string) =>
    request<{ ok: true; updatedTests: string[] }>(`/api/objects/${encodeURIComponent(appId)}/${encodeURIComponent(name)}/rename`, {
      method: 'PUT',
      body: JSON.stringify({ newName }),
    }),
  getObjectUsage: (appId: string, name: string) =>
    request<string[]>(`/api/objects/${encodeURIComponent(appId)}/${encodeURIComponent(name)}/usage`),
  getObjectVerifications: (appId: string, name: string) =>
    request<ObjectVerificationEvent[]>(`/api/objects/${encodeURIComponent(appId)}/${encodeURIComponent(name)}/verifications`),
  reverifyObject: (appId: string, name: string) =>
    request<{ stored: ObjectControl; outcome: 'verified' | 'drifted' | 'missing'; live?: { controlId: string; controlType: string; bindingPath?: string; text?: string } }>(
      `/api/objects/${encodeURIComponent(appId)}/${encodeURIComponent(name)}/reverify`,
      { method: 'POST' }
    ),
  reorderObjects: (appId: string, order: string[]) =>
    request<{ ok: true }>(`/api/objects/${encodeURIComponent(appId)}/_reorder`, {
      method: 'PUT',
      body: JSON.stringify({ order }),
    }),
  listGroups: () => request<string[]>('/api/groups'),
  getGroup: (file: string) => request<Group>(`/api/groups/${encodeURIComponent(file)}`),
  saveGroup: (file: string, group: Group) =>
    request<{ ok: true }>(`/api/groups/${encodeURIComponent(file)}`, {
      method: 'PUT',
      body: JSON.stringify(group),
    }),
  listPacks: () => request<string[]>('/api/packs'),
  getPack: (file: string) => request<RegressionPack>(`/api/packs/${encodeURIComponent(file)}`),
  savePack: (file: string, pack: RegressionPack) =>
    request<{ ok: true }>(`/api/packs/${encodeURIComponent(file)}`, {
      method: 'PUT',
      body: JSON.stringify(pack),
    }),
  openScanSession: (url: string) => request<ScanSessionInfo>('/api/scan/open', { method: 'POST', body: JSON.stringify({ url }) }),
  getScanStatus: () => request<ScanStatus>('/api/scan/status'),
  captureScan: () => request<ScanCaptureResult>('/api/scan/capture', { method: 'POST' }),
  closeScanSession: () => request<{ ok: true }>('/api/scan/close', { method: 'POST' }),
  highlightControl: (controlId: string) =>
    request<{ found: boolean }>('/api/scan/highlight', { method: 'POST', body: JSON.stringify({ controlId }) }),
  startPick: () => request<PickResult>('/api/scan/pick/start', { method: 'POST' }),
  getPickResult: () => request<PickResult>('/api/scan/pick/result'),
  cancelPick: () => request<{ ok: true }>('/api/scan/pick/cancel', { method: 'POST' }),
  dismissPick: (controlId: string) => request<PickResult>('/api/scan/pick/dismiss', { method: 'POST', body: JSON.stringify({ controlId }) }),
  listData: () => request<string[]>('/api/data'),
  listDataLibrary: () => request<DataLibraryItem[]>('/api/data/library'),
  getDataset: (file: string) => request<Dataset>(`/api/data/${encodeURIComponent(file)}`),
  saveDataset: (file: string, dataset: Dataset) =>
    request<{ ok: true }>(`/api/data/${encodeURIComponent(file)}`, {
      method: 'PUT',
      body: JSON.stringify(dataset),
    }),
  /** Blocked with a 409 (thrown error's message includes the reference count) unless force is
   *  true — see server's dependency-aware delete, mirroring BL-022's object delete. */
  deleteData: (file: string, force = false) =>
    request<{ ok: true; usage: DataFileUsage }>(`/api/data/${encodeURIComponent(file)}${force ? '?force=true' : ''}`, {
      method: 'DELETE',
    }),
  renameData: (file: string, newName: string) =>
    request<{ ok: true; updatedGroups: string[]; updatedPacks: string[]; updatedRelations: string[] }>(
      `/api/data/${encodeURIComponent(file)}/rename`,
      { method: 'PUT', body: JSON.stringify({ newName }) }
    ),
  getDataUsage: (file: string) => request<DataFileUsage>(`/api/data/${encodeURIComponent(file)}/usage`),
  getDataSchema: (file: string) => request<DataColumnSchema[]>(`/api/data/${encodeURIComponent(file)}/schema`),
  saveDataColumn: (file: string, column: string, patch: { type: TestValueType; sensitivity: DataSensitivity; example?: string }) =>
    request<{ ok: true }>(`/api/data/${encodeURIComponent(file)}/schema/${encodeURIComponent(column)}`, {
      method: 'PUT',
      body: JSON.stringify(patch),
    }),
  listDataRelations: () => request<string[]>('/api/data-relations'),
  getDataRelation: (file: string) =>
    request<DataRelationDefinition>(`/api/data-relations/${encodeURIComponent(file)}`),
  saveDataRelation: (file: string, definition: DataRelationDefinition) =>
    request<{ ok: true; preview: DataPreview }>(`/api/data-relations/${encodeURIComponent(file)}`, {
      method: 'PUT',
      body: JSON.stringify(definition),
    }),
  previewData: (body:
    | { format: 'json'; records: Record<string, import('./types').JsonDataValue>[] }
    | ({ format: 'relational-csv' } & DataRelationDefinition)
  ) =>
    request<DataPreview>('/api/data/preview', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  preflightExecution: (body: ExecutionDraft) =>
    request<ExecutionPreflightResult>('/api/executions/preflight', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  startRun: (body: {
    testCaseFiles?: string[];
    groupFiles?: string[];
    packFile?: string;
    appId?: string;
    dataFile?: string;
    headless?: boolean;
    mode?: 'chain' | 'suite' | 'batch';
    executionKind?: ExecutionDraft['executionKind'];
    preflightToken?: string;
    planHash?: string;
    acknowledgedWarnings?: string[];
    sessionPolicy?: ExecutionDraft['sessionPolicy'];
    iterationFailurePolicy?: ExecutionDraft['iterationFailurePolicy'];
    maxRecords?: number;
    dataFilter?: ExecutionDraft['dataFilter'];
    dataMode?: ExecutionDraft['dataMode'];
    childDataFile?: string;
    headerKey?: string;
    childForeignKey?: string;
    collectionPath?: string;
  }) =>
    request<RunStatus>('/api/runs', { method: 'POST', body: JSON.stringify(body) }),
  getRun: (id: string) => request<RunStatus>(`/api/runs/${encodeURIComponent(id)}`),
  getExecutionMetrics: () => request<ExecutionHealthMetrics>('/api/execution-metrics'),
  cancelRun: (id: string) =>
    request<RunStatus>(`/api/runs/${encodeURIComponent(id)}/cancel`, { method: 'POST' }),
  reviewRerun: (id: string, body: { scope: 'full' | 'failed'; reason: string }) =>
    request<RerunReview>(`/api/runs/${encodeURIComponent(id)}/rerun-review`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  rerunRun: (id: string, body: {
    scope: 'full' | 'failed';
    reason: string;
    requestKey: string;
    reviewHash: string;
  }) =>
    request<RunStatus>(`/api/runs/${encodeURIComponent(id)}/rerun`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  listDocuments: (filter: { appId?: string; key?: string } = {}) => {
    const query = new URLSearchParams();
    if (filter.appId) query.set('appId', filter.appId);
    if (filter.key) query.set('key', filter.key);
    const qs = query.toString();
    return request<CapturedDocument[]>(`/api/documents${qs ? `?${qs}` : ''}`);
  },
  listAuditRuns: (filter: { appId?: string; status?: 'passed' | 'failed' } = {}) => {
    const query = new URLSearchParams();
    if (filter.appId) query.set('appId', filter.appId);
    if (filter.status) query.set('status', filter.status);
    const qs = query.toString();
    return request<RunHistorySummary[]>(`/api/audit/runs${qs ? `?${qs}` : ''}`);
  },
  getAuditRun: (id: string) => request<RunHistoryEntry>(`/api/audit/runs/${encodeURIComponent(id)}`),
};
