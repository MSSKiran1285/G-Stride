import type {
  ModuleInfo,
  TestCase,
  ObjectControl,
  RunStatus,
  Dataset,
  Group,
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
  saveSapIntegration: (body: { url: string; username: string; password: string }) =>
    request<SapIntegrationStatus>('/api/settings/integrations/sap', {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
  listModules: () => request<ModuleInfo[]>('/api/modules'),
  listTestCases: () => request<string[]>('/api/testcases'),
  getTestCase: (file: string) => request<TestCase>(`/api/testcases/${encodeURIComponent(file)}`),
  saveTestCase: (file: string, testCase: TestCase) =>
    request<{ ok: true }>(`/api/testcases/${encodeURIComponent(file)}`, {
      method: 'PUT',
      body: JSON.stringify(testCase),
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
    body: { controlId: string; controlType: string; bindingPath?: string; label?: string; parentControlId?: string; tableId?: string }
  ) =>
    request<{ ok: true }>(`/api/objects/${encodeURIComponent(appId)}/${encodeURIComponent(name)}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
  deleteObject: (appId: string, name: string) =>
    request<{ ok: true }>(`/api/objects/${encodeURIComponent(appId)}/${encodeURIComponent(name)}`, { method: 'DELETE' }),
  renameObject: (appId: string, name: string, newName: string) =>
    request<{ ok: true }>(`/api/objects/${encodeURIComponent(appId)}/${encodeURIComponent(name)}/rename`, {
      method: 'PUT',
      body: JSON.stringify({ newName }),
    }),
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
  getDataset: (file: string) => request<Dataset>(`/api/data/${encodeURIComponent(file)}`),
  saveDataset: (file: string, dataset: Dataset) =>
    request<{ ok: true }>(`/api/data/${encodeURIComponent(file)}`, {
      method: 'PUT',
      body: JSON.stringify(dataset),
    }),
  startRun: (body: {
    testCaseFiles?: string[];
    groupFiles?: string[];
    appId?: string;
    dataFile?: string;
    headless?: boolean;
    mode?: 'chain' | 'suite' | 'batch';
  }) =>
    request<RunStatus>('/api/runs', { method: 'POST', body: JSON.stringify(body) }),
  getRun: (id: string) => request<RunStatus>(`/api/runs/${encodeURIComponent(id)}`),
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
