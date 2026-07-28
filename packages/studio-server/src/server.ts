import express, { Express } from 'express';
import path from 'node:path';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import {
  ObjectRepository,
  DocumentLog,
  TagStore,
  ArtifactKind,
  RunHistoryStore,
  getCredentials,
  getCredentialStatus,
  setCredentials,
} from '@taf/core';
import { ModuleRegistry } from '@taf/engine';
import { startRun, getRun } from './runs';
import { parseCsv, serializeCsv } from './csv';
import { openScanSession, getScanStatus, captureScan, closeScanSession, highlightControl, startPick, getPickResult, cancelPick, dismissPick } from './scanSession';
import { StudioAuth } from './auth';

const REPO_ROOT = path.resolve(__dirname, '../../..');
const DEFAULT_TESTCASES_DIR = path.join(REPO_ROOT, 'testcases');
const DEFAULT_GROUPS_DIR = path.join(REPO_ROOT, 'testgroups');
const DEFAULT_DATA_DIR = path.join(REPO_ROOT, 'data');
const DEFAULT_REPORTS_DIR = path.join(REPO_ROOT, 'reports');
const DEFAULT_EVIDENCE_ARCHIVE_DIR = path.join(REPO_ROOT, 'audit-evidence');
const DEFAULT_AUTH_CONFIG_PATH = path.join(REPO_ROOT, '.studio', 'auth.json');

/** A test case file name must be a plain "*.json" basename — never a path (no traversal outside testcases/). */
function safeTestCaseName(name: string): string {
  const base = path.basename(name);
  if (!base.endsWith('.json') || base !== name) {
    throw Object.assign(new Error(`Invalid test case file name "${name}"`), { status: 400 });
  }
  return base;
}

/** A group file name must be a plain "*.json" basename — never a path (no traversal outside testgroups/). */
function safeGroupFileName(name: string): string {
  const base = path.basename(name);
  if (!base.endsWith('.json') || base !== name) {
    throw Object.assign(new Error(`Invalid group file name "${name}"`), { status: 400 });
  }
  return base;
}

/** A dataset file name must be a plain "*.csv" basename — never a path (no traversal outside data/). */
function safeDataFileName(name: string): string {
  const base = path.basename(name);
  if (!base.endsWith('.csv') || base !== name) {
    throw Object.assign(new Error(`Invalid dataset file name "${name}"`), { status: 400 });
  }
  return base;
}

const VALID_TAG_KINDS: ArtifactKind[] = ['testCase', 'group', 'dataFile', 'appId'];

function safeTagKind(kind: string): ArtifactKind {
  if (!VALID_TAG_KINDS.includes(kind as ArtifactKind)) {
    throw Object.assign(new Error(`Invalid tag kind "${kind}" — must be one of ${VALID_TAG_KINDS.join(', ')}`), { status: 400 });
  }
  return kind as ArtifactKind;
}

export interface StudioServerOptions {
  objectDbPath?: string;
  documentDbPath?: string;
  tagDbPath?: string;
  runHistoryDbPath?: string;
  webDistPath?: string;
  testCasesDir?: string;
  groupsDir?: string;
  dataDir?: string;
  reportsDir?: string;
  evidenceArchiveDir?: string;
  authConfigPath?: string;
  /** Isolated UI tests disable execution routes so they cannot spawn the real CLI. */
  executionEnabled?: boolean;
}

export function createStudioServer(options: StudioServerOptions = {}): Express {
  const testCasesDir = options.testCasesDir ?? DEFAULT_TESTCASES_DIR;
  const groupsDir = options.groupsDir ?? DEFAULT_GROUPS_DIR;
  const dataDir = options.dataDir ?? DEFAULT_DATA_DIR;
  const reportsDir = options.reportsDir ?? DEFAULT_REPORTS_DIR;
  const evidenceArchiveDir = options.evidenceArchiveDir ?? DEFAULT_EVIDENCE_ARCHIVE_DIR;
  const auth = new StudioAuth(options.authConfigPath ?? DEFAULT_AUTH_CONFIG_PATH);
  const objectDbPath = options.objectDbPath ?? path.join(REPO_ROOT, 'object-repository.db');
  const objectRepository = new ObjectRepository(objectDbPath);
  const documentDbPath = options.documentDbPath ?? path.join(REPO_ROOT, 'document-log.db');
  const documentLog = new DocumentLog(documentDbPath);
  const tagDbPath = options.tagDbPath ?? path.join(REPO_ROOT, 'tags.db');
  const tagStore = new TagStore(tagDbPath);
  // Studio never writes to the audit ledger itself — only the CLI (the real execution path,
  // see Section 6's architecture note) calls .record(); Studio only ever reads it back, the
  // same relationship it already has with reports/ (spawn CLI, read its output).
  const runHistoryDbPath = options.runHistoryDbPath ?? path.join(REPO_ROOT, 'run-history.db');
  const runHistory = new RunHistoryStore(runHistoryDbPath);
  const registry = new ModuleRegistry();

  const app = express();
  app.locals.closeStudioStores = () => {
    objectRepository.close();
    documentLog.close();
    tagStore.close();
    runHistory.close();
  };
  app.use(express.json());

  // Authentication bootstrap routes remain public. Until a Google owner is linked,
  // the existing local workspace owner remains authenticated so enabling sign-in
  // cannot strand the current run history or repositories.
  app.get('/api/auth/state', (req, res) => {
    res.json(auth.state(req));
  });

  app.post('/api/auth/google', async (req, res) => {
    try {
      if (typeof req.body?.credential !== 'string' || !req.body.credential) {
        return res.status(400).json({ error: 'A Google ID token is required.' });
      }
      const user = await auth.signInWithGoogle(req.body.credential, res);
      res.json({ user });
    } catch (err: any) {
      res.status(err.status ?? 401).json({ error: err.message });
    }
  });

  app.post('/api/auth/logout', (req, res) => {
    auth.signOut(req, res);
    res.json({ ok: true });
  });

  app.use('/api', auth.requireAuthenticated);

  app.put('/api/settings/auth/google', (req, res) => {
    try {
      if (typeof req.body?.clientId !== 'string') {
        return res.status(400).json({ error: 'Body must include clientId: string.' });
      }
      auth.setGoogleClientId(req.body.clientId);
      res.json(auth.state(req));
    } catch (err: any) {
      res.status(err.status ?? 500).json({ error: err.message });
    }
  });

  app.get('/api/settings/integrations', async (_req, res) => {
    try {
      const sap = await getCredentialStatus('default');
      res.json({
        sap,
        salesforce: { configured: false, available: false },
        oracle: { configured: false, available: false },
        servicenow: { configured: false, available: false },
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.put('/api/settings/integrations/sap', async (req, res) => {
    try {
      const url = typeof req.body?.url === 'string' ? req.body.url.trim() : '';
      const username = typeof req.body?.username === 'string' ? req.body.username.trim() : '';
      const suppliedPassword = typeof req.body?.password === 'string' ? req.body.password : '';
      let parsed: URL;
      try {
        parsed = new URL(url);
      } catch {
        return res.status(400).json({ error: 'Enter a valid SAP test-system URL.' });
      }
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        return res.status(400).json({ error: 'SAP target URL must use HTTP or HTTPS.' });
      }
      if (!username) return res.status(400).json({ error: 'SAP username is required.' });

      const currentStatus = await getCredentialStatus('default');
      if (currentStatus.source === 'environment') {
        return res.status(409).json({
          error: 'The default SAP profile is supplied by environment variables. Update TAF_DEFAULT_URL, USERNAME and PASSWORD at the server instead.',
        });
      }
      const current = await getCredentials('default').catch(() => null);
      const password = suppliedPassword || current?.password || '';
      if (!password) return res.status(400).json({ error: 'SAP password is required the first time this target is saved.' });

      await setCredentials('default', { url: parsed.toString(), username, password });
      res.json(await getCredentialStatus('default'));
    } catch (err: any) {
      res.status(err.status ?? 500).json({ error: err.message });
    }
  });

  // Evidence screenshots / PDFs referenced by run results — served exactly at the
  // relative path already embedded in each run's JSON report (reports/studio/<id>/...).
  app.use('/reports', express.static(reportsDir));
  // Permanent evidence archive (BL-13) — survives reports/ being cleared, unlike the scratch dir above.
  app.use('/audit-evidence', express.static(evidenceArchiveDir));

  app.get('/api/modules', (_req, res) => {
    res.json(
      registry.list().map((m) => ({
        name: m.name,
        describe: m.describe ?? null,
      }))
    );
  });

  app.get('/api/testcases', (_req, res) => {
    if (!existsSync(testCasesDir)) return res.json([]);
    res.json(readdirSync(testCasesDir).filter((f) => f.endsWith('.json')));
  });

  app.get('/api/testcases/:file', (req, res) => {
    try {
      const file = safeTestCaseName(req.params.file);
      const full = path.join(testCasesDir, file);
      if (!existsSync(full)) return res.status(404).json({ error: 'Not found' });
      res.json(JSON.parse(readFileSync(full, 'utf-8')));
    } catch (err: any) {
      res.status(err.status ?? 500).json({ error: err.message });
    }
  });

  app.put('/api/testcases/:file', (req, res) => {
    try {
      const file = safeTestCaseName(req.params.file);
      const body = req.body;
      if (typeof body?.name !== 'string' || !Array.isArray(body?.steps)) {
        return res.status(400).json({ error: 'Body must be { name: string, steps: ModuleCall[] }' });
      }
      mkdirSync(testCasesDir, { recursive: true });
      writeFileSync(path.join(testCasesDir, file), JSON.stringify(body, null, 2) + '\n');
      res.json({ ok: true });
    } catch (err: any) {
      res.status(err.status ?? 500).json({ error: err.message });
    }
  });

  app.get('/api/groups', (_req, res) => {
    if (!existsSync(groupsDir)) return res.json([]);
    res.json(readdirSync(groupsDir).filter((f) => f.endsWith('.json')));
  });

  app.get('/api/groups/:file', (req, res) => {
    try {
      const file = safeGroupFileName(req.params.file);
      const full = path.join(groupsDir, file);
      if (!existsSync(full)) return res.status(404).json({ error: 'Not found' });
      res.json(JSON.parse(readFileSync(full, 'utf-8')));
    } catch (err: any) {
      res.status(err.status ?? 500).json({ error: err.message });
    }
  });

  app.put('/api/groups/:file', (req, res) => {
    try {
      const file = safeGroupFileName(req.params.file);
      const body = req.body;
      if (
        typeof body?.name !== 'string' ||
        typeof body?.appId !== 'string' ||
        !Array.isArray(body?.testCaseFiles) ||
        body.testCaseFiles.length === 0
      ) {
        return res.status(400).json({ error: 'Body must be { name: string, appId: string, testCaseFiles: string[], dataFile?: string }' });
      }
      mkdirSync(groupsDir, { recursive: true });
      writeFileSync(path.join(groupsDir, file), JSON.stringify(body, null, 2) + '\n');
      res.json({ ok: true });
    } catch (err: any) {
      res.status(err.status ?? 500).json({ error: err.message });
    }
  });

  // Fact-based disambiguation for ObjectPicker: "was this object name ever actually
  // used for this exact module+param before?" — not a guess, a scan of what's really
  // in every saved test case. Deliberately App-ID-agnostic: the caller already has an
  // App-ID-scoped candidate list, so it only needs to know which of ITS names appear
  // here, regardless of which App ID they were used under elsewhere.
  app.get('/api/module-usage/:module/:paramKey', (req, res) => {
    const { module, paramKey } = req.params;
    const used = new Set<string>();
    if (existsSync(testCasesDir)) {
      for (const file of readdirSync(testCasesDir).filter((f) => f.endsWith('.json'))) {
        try {
          const testCase = JSON.parse(readFileSync(path.join(testCasesDir, file), 'utf-8'));
          for (const step of testCase.steps ?? []) {
            if (step.module === module && typeof step.params?.[paramKey] === 'string' && step.params[paramKey]) {
              used.add(step.params[paramKey]);
            }
          }
        } catch {
          // skip an unreadable/malformed file rather than fail the whole scan
        }
      }
    }
    res.json([...used]);
  });

  app.get('/api/app-ids', (_req, res) => {
    res.json(objectRepository.listAppIds());
  });

  // BL-10's processArea tag, generalized across every artifact kind (test cases, groups,
  // data files, App IDs) so Compose/Groups/Run/Data/Objects Browser all group the same way.
  app.get('/api/process-areas', (_req, res) => {
    res.json(tagStore.listProcessAreas());
  });

  app.get('/api/tags/:kind', (req, res) => {
    try {
      res.json(tagStore.listTags(safeTagKind(req.params.kind)));
    } catch (err: any) {
      res.status(err.status ?? 500).json({ error: err.message });
    }
  });

  app.put('/api/tags/:kind/:name', (req, res) => {
    try {
      const kind = safeTagKind(req.params.kind);
      const { processArea } = req.body ?? {};
      if (typeof processArea !== 'string') {
        return res.status(400).json({ error: 'Body must include processArea: string (empty string clears the tag)' });
      }
      tagStore.setTag(kind, req.params.name, processArea);
      res.json({ ok: true });
    } catch (err: any) {
      res.status(err.status ?? 500).json({ error: err.message });
    }
  });

  app.get('/api/objects/:appId', (req, res) => {
    res.json(objectRepository.listByApp(req.params.appId));
  });

  // Registered before the generic PUT /:appId/:name below — Express matches routes in
  // registration order, so this literal "_reorder" segment must be tried first or it'd be
  // swallowed as if "_reorder" were itself an object name.
  app.put('/api/objects/:appId/_reorder', (req, res) => {
    const { order } = req.body ?? {};
    if (!Array.isArray(order) || order.some((n: unknown) => typeof n !== 'string')) {
      return res.status(400).json({ error: 'Body must include order: string[]' });
    }
    objectRepository.reorder(req.params.appId, order);
    res.json({ ok: true });
  });

  app.put('/api/objects/:appId/:name', (req, res) => {
    const { controlId, controlType, bindingPath, label, parentControlId, tableId } = req.body ?? {};
    if (typeof controlId !== 'string' || !controlId || typeof controlType !== 'string' || !controlType) {
      return res.status(400).json({ error: 'Body must include controlId: string and controlType: string' });
    }
    objectRepository.upsert({
      appId: req.params.appId,
      name: req.params.name,
      controlId,
      controlType,
      bindingPath,
      label,
      parentControlId,
      // better-sqlite3's named-parameter binding needs every key the SQL references to be
      // present on the object, even as undefined. tableId now comes from the curation UI
      // too — CurationList sets it automatically for a table Column, since a column's own
      // controlId doubles as the stable, row-independent locator fillTableCell/AddLineItem
      // need for driving multiple line items during execution.
      tableId,
    });
    res.json({ ok: true });
  });

  app.delete('/api/objects/:appId/:name', (req, res) => {
    objectRepository.remove(req.params.appId, req.params.name);
    res.json({ ok: true });
  });

  app.put('/api/objects/:appId/:name/rename', (req, res) => {
    const { newName } = req.body ?? {};
    if (typeof newName !== 'string' || !newName.trim()) {
      return res.status(400).json({ error: 'Body must include newName: string' });
    }
    try {
      objectRepository.rename(req.params.appId, req.params.name, newName.trim());
      res.json({ ok: true });
    } catch (err: any) {
      res.status(err.status ?? 500).json({ error: err.message });
    }
  });

  app.post('/api/scan/open', async (req, res) => {
    const { url } = req.body ?? {};
    if (typeof url !== 'string' || !url) {
      return res.status(400).json({ error: 'Body must include url: string' });
    }
    try {
      const info = await openScanSession(url);
      res.status(201).json(info);
    } catch (err: any) {
      res.status(err.status ?? 500).json({ error: err.message });
    }
  });

  app.get('/api/scan/status', (_req, res) => {
    res.json(getScanStatus());
  });

  app.post('/api/scan/capture', async (_req, res) => {
    try {
      res.json(await captureScan());
    } catch (err: any) {
      res.status(err.status ?? 500).json({ error: err.message });
    }
  });

  app.post('/api/scan/close', async (_req, res) => {
    await closeScanSession();
    res.json({ ok: true });
  });

  app.post('/api/scan/highlight', async (req, res) => {
    const { controlId } = req.body ?? {};
    if (typeof controlId !== 'string' || !controlId) {
      return res.status(400).json({ error: 'Body must include controlId: string' });
    }
    try {
      res.json(await highlightControl(controlId));
    } catch (err: any) {
      res.status(err.status ?? 500).json({ error: err.message });
    }
  });

  app.post('/api/scan/pick/start', async (_req, res) => {
    try {
      await startPick();
      res.json(getPickResult());
    } catch (err: any) {
      res.status(err.status ?? 500).json({ error: err.message });
    }
  });

  app.get('/api/scan/pick/result', (_req, res) => {
    res.json(getPickResult());
  });

  app.post('/api/scan/pick/cancel', async (_req, res) => {
    await cancelPick();
    res.json({ ok: true });
  });

  app.post('/api/scan/pick/dismiss', (req, res) => {
    const { controlId } = req.body ?? {};
    if (typeof controlId !== 'string' || !controlId) {
      return res.status(400).json({ error: 'Body must include controlId: string' });
    }
    dismissPick(controlId);
    res.json(getPickResult());
  });

  app.get('/api/data', (_req, res) => {
    if (!existsSync(dataDir)) return res.json([]);
    res.json(readdirSync(dataDir).filter((f) => f.endsWith('.csv') || f.endsWith('.json')));
  });

  app.get('/api/data/:file', (req, res) => {
    try {
      const file = safeDataFileName(req.params.file);
      const full = path.join(dataDir, file);
      if (!existsSync(full)) return res.json({ headers: [], rows: [] });
      res.json(parseCsv(readFileSync(full, 'utf-8')));
    } catch (err: any) {
      res.status(err.status ?? 500).json({ error: err.message });
    }
  });

  app.put('/api/data/:file', (req, res) => {
    try {
      const file = safeDataFileName(req.params.file);
      const body = req.body;
      if (!Array.isArray(body?.headers) || !Array.isArray(body?.rows)) {
        return res.status(400).json({ error: 'Body must be { headers: string[], rows: Record<string,string>[] }' });
      }
      mkdirSync(dataDir, { recursive: true });
      writeFileSync(path.join(dataDir, file), serializeCsv({ headers: body.headers, rows: body.rows }));
      res.json({ ok: true });
    } catch (err: any) {
      res.status(err.status ?? 500).json({ error: err.message });
    }
  });

  app.post('/api/runs', (req, res) => {
    if (options.executionEnabled === false) {
      return res.status(403).json({ error: 'Execution is disabled in this isolated Studio session.' });
    }
    const { testCaseFiles, groupFiles, appId, dataFile, headless, mode } = req.body ?? {};
    if (mode !== undefined && mode !== 'chain' && mode !== 'suite' && mode !== 'batch') {
      return res.status(400).json({ error: 'mode must be "chain", "suite" or "batch" if given' });
    }

    if (mode === 'batch') {
      if (!Array.isArray(groupFiles) || groupFiles.length === 0) {
        return res.status(400).json({ error: 'Body must include groupFiles: string[] when mode is "batch"' });
      }
      const resolvedGroups = groupFiles.map((f: string) => path.join('testgroups', safeGroupFileName(f)));
      const record = startRun({
        testCaseFiles: [],
        groupFiles: resolvedGroups,
        appId: '',
        headless: Boolean(headless),
        mode,
      });
      return res.status(201).json(getRun(record.id));
    }

    if (!Array.isArray(testCaseFiles) || testCaseFiles.length === 0 || typeof appId !== 'string') {
      return res.status(400).json({ error: 'Body must include testCaseFiles: string[] and appId: string' });
    }
    const resolvedFiles = testCaseFiles.map((f: string) => path.join('testcases', safeTestCaseName(f)));
    const resolvedData = dataFile ? path.join('data', path.basename(dataFile)) : undefined;
    const record = startRun({
      testCaseFiles: resolvedFiles,
      appId,
      dataFile: resolvedData,
      headless: Boolean(headless),
      mode,
    });
    // Return the full RunStatus shape (with results: []), not the bare RunRecord —
    // the client always expects a "results" array, and returning a record without
    // one for this split second between POST and the first GET poll crashed the
    // whole page (`run.results.length` on undefined, no error boundary to catch it).
    res.status(201).json(getRun(record.id));
  });

  app.get('/api/runs/:id', (req, res) => {
    const status = getRun(req.params.id);
    if (!status) return res.status(404).json({ error: 'Unknown run id' });
    res.json(status);
  });

  app.get('/api/documents', (req, res) => {
    const { appId, key } = req.query;
    res.json(
      documentLog.list({
        appId: typeof appId === 'string' && appId ? appId : undefined,
        key: typeof key === 'string' && key ? key : undefined,
      })
    );
  });

  // BL-12/13's audit ledger — read-only from Studio's side; see runHistory's own comment above.
  app.get('/api/audit/runs', (req, res) => {
    const { appId, status } = req.query;
    if (status !== undefined && status !== 'passed' && status !== 'failed') {
      return res.status(400).json({ error: 'status must be "passed" or "failed" if given' });
    }
    res.json(
      runHistory.list({
        appId: typeof appId === 'string' && appId ? appId : undefined,
        status,
      })
    );
  });

  app.get('/api/audit/runs/:id', (req, res) => {
    const entry = runHistory.get(req.params.id);
    if (!entry) return res.status(404).json({ error: 'Unknown run id' });
    res.json(entry);
  });

  const webDist = options.webDistPath ?? path.join(REPO_ROOT, 'packages/studio-web/dist');
  if (existsSync(webDist)) {
    app.use(express.static(webDist));
    app.get('*', (_req, res) => res.sendFile(path.join(webDist, 'index.html')));
  }

  mkdirSync(path.join(reportsDir, 'studio'), { recursive: true });

  return app;
}
