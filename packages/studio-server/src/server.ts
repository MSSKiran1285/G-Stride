import express, { Express } from 'express';
import path from 'node:path';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import {
  ExecutionPlanSnapshot,
  ObjectRepository,
  DocumentLog,
  TagStore,
  ArtifactKind,
  JsonValue,
  TransactionDataValidationError,
  RunHistoryStore,
  getCredentials,
  getCredentialStatus,
  loadTransactionData,
  setCredentials,
} from '@taf/core';
import { ModuleRegistry } from '@taf/engine';
import {
  cancelRun,
  getExecutionHealthMetrics,
  getRun,
  redactExecutionLog,
  rerunRun,
  reviewRerun,
  startRun,
} from './runs';
import { parseCsv, serializeCsv } from './csv';
import { openScanSession, getScanStatus, captureScan, closeScanSession, highlightControl, startPick, getPickResult, cancelPick, dismissPick } from './scanSession';
import { StudioAuth } from './auth';
import { ExecutionDraft, ExecutionDraftKind, ExecutionPreflightService } from './executionPreflight';
import { executionInitiator, executionTargetContext, workspaceContext } from './executionContext';
import { verifySapConnection, SapVerificationResult } from './sapVerification';
import {
  EVIDENCE_GOVERNANCE,
  WorkspaceGovernanceStore,
} from './workspaceGovernance';

const REPO_ROOT = path.resolve(__dirname, '../../..');
const DEFAULT_TESTCASES_DIR = path.join(REPO_ROOT, 'testcases');
const DEFAULT_GROUPS_DIR = path.join(REPO_ROOT, 'testgroups');
const DEFAULT_DATA_DIR = path.join(REPO_ROOT, 'data');
const DEFAULT_REPORTS_DIR = path.join(REPO_ROOT, 'reports');
const DEFAULT_EVIDENCE_ARCHIVE_DIR = path.join(REPO_ROOT, 'audit-evidence');
const DEFAULT_AUTH_CONFIG_PATH = path.join(REPO_ROOT, '.studio', 'auth.json');
const DEFAULT_GOVERNANCE_PATH = path.join(REPO_ROOT, '.studio', 'workspace-governance.json');

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
  if ((!base.endsWith('.csv') && !base.endsWith('.json')) || base !== name) {
    throw Object.assign(new Error(`Invalid dataset file name "${name}"`), { status: 400 });
  }
  return base;
}

function safeRelationFileName(name: string): string {
  const base = path.basename(name);
  if (!base.endsWith('.json') || base !== name) {
    throw Object.assign(new Error(`Invalid relationship file name "${name}"`), { status: 400 });
  }
  return base;
}

interface DataRelationDefinition {
  headerFile: string;
  childFile: string;
  headerKey: string;
  childForeignKey: string;
  collectionPath: string;
}

function nestedChildCount(records: Record<string, JsonValue>[]): number {
  let count = 0;
  const visit = (value: JsonValue) => {
    if (Array.isArray(value)) {
      count += value.length;
      value.forEach(visit);
    } else if (value && typeof value === 'object') {
      Object.values(value).forEach(visit);
    }
  };
  records.forEach((record) => Object.values(record).forEach(visit));
  return count;
}

function validateJsonRecords(value: unknown, file: string): Record<string, JsonValue>[] {
  if (!Array.isArray(value)) {
    throw Object.assign(new Error(`Nested JSON dataset "${file}" must contain an array of transaction objects.`), { status: 400 });
  }
  const invalid = value.findIndex((record) => !record || typeof record !== 'object' || Array.isArray(record));
  if (invalid >= 0) {
    throw Object.assign(new Error(`JSON transaction ${invalid + 1} in "${file}" must be an object.`), { status: 400 });
  }
  return value as Record<string, JsonValue>[];
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
  governancePath?: string;
  /** Test seam for the non-mutating SAP login verification. */
  verifySap?: (
    credentials: Awaited<ReturnType<typeof getCredentials>>,
    objectRepository: ObjectRepository,
    registry: ModuleRegistry
  ) => Promise<SapVerificationResult>;
  /** Isolated UI tests disable execution routes so they cannot spawn the real CLI. */
  executionEnabled?: boolean;
  /** Test seam for an isolated, non-SAP execution service. */
  runService?: {
    start: typeof startRun;
    get: typeof getRun;
    metrics: typeof getExecutionHealthMetrics;
    cancel: typeof cancelRun;
    review?: typeof reviewRerun;
    rerun: typeof rerunRun;
  };
}

export function createStudioServer(options: StudioServerOptions = {}): Express {
  const testCasesDir = options.testCasesDir ?? DEFAULT_TESTCASES_DIR;
  const groupsDir = options.groupsDir ?? DEFAULT_GROUPS_DIR;
  const dataDir = options.dataDir ?? DEFAULT_DATA_DIR;
  const dataRelationsDir = path.join(dataDir, '.relations');
  const reportsDir = options.reportsDir ?? DEFAULT_REPORTS_DIR;
  const evidenceArchiveDir = options.evidenceArchiveDir ?? DEFAULT_EVIDENCE_ARCHIVE_DIR;
  const auth = new StudioAuth(options.authConfigPath ?? DEFAULT_AUTH_CONFIG_PATH);
  const governance = new WorkspaceGovernanceStore(options.governancePath ?? DEFAULT_GOVERNANCE_PATH);
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
  const executionPreflight = new ExecutionPreflightService(
    { testCasesDir, groupsDir, dataDir },
    objectRepository,
    registry
  );
  const runService = options.runService ?? {
    start: startRun,
    get: getRun,
    metrics: getExecutionHealthMetrics,
    cancel: cancelRun,
    review: reviewRerun,
    rerun: rerunRun,
  };
  const currentTargetContext = async () => {
    const status = await getCredentialStatus('default');
    return executionTargetContext(status, governance.getSap(status));
  };

  const executionDraftFromBody = (body: any): ExecutionDraft => {
    const inferredKind: ExecutionDraftKind =
      body?.mode === 'chain'
        ? 'businessProcess'
        : body?.mode === 'suite' || body?.mode === 'batch'
          ? 'regressionPack'
          : 'singleTest';
    const kind = body?.executionKind ?? inferredKind;
    if (!['singleTest', 'businessProcess', 'regressionPack'].includes(kind)) {
      throw Object.assign(
        new Error('executionKind must be "singleTest", "businessProcess", or "regressionPack".'),
        { status: 400 }
      );
    }
    const testCaseFiles = Array.isArray(body?.testCaseFiles)
      ? body.testCaseFiles.map((file: unknown) => {
          if (typeof file !== 'string') {
            throw Object.assign(new Error('testCaseFiles must contain filenames.'), { status: 400 });
          }
          return safeTestCaseName(file);
        })
      : [];
    const groupFiles = Array.isArray(body?.groupFiles)
      ? body.groupFiles.map((file: unknown) => {
          if (typeof file !== 'string') {
            throw Object.assign(new Error('groupFiles must contain filenames.'), { status: 400 });
          }
          return safeGroupFileName(file);
        })
      : [];
    const sessionPolicy = body?.sessionPolicy ?? 'fresh-per-iteration';
    if (!['fresh-per-iteration', 'reuse-within-process'].includes(sessionPolicy)) {
      throw Object.assign(new Error('Invalid sessionPolicy.'), { status: 400 });
    }
    const iterationFailurePolicy =
      body?.iterationFailurePolicy
      ?? (kind === 'businessProcess' ? 'stop-execution' : 'continue-next-iteration');
    if (!['stop-execution', 'continue-next-iteration'].includes(iterationFailurePolicy)) {
      throw Object.assign(new Error('Invalid iterationFailurePolicy.'), { status: 400 });
    }
    const maxRecords = body?.maxRecords === undefined || body?.maxRecords === null || body?.maxRecords === ''
      ? undefined
      : Number(body.maxRecords);
    if (maxRecords !== undefined && (!Number.isInteger(maxRecords) || maxRecords < 1)) {
      throw Object.assign(new Error('maxRecords must be a positive integer.'), { status: 400 });
    }
    const rawFilter = body?.dataFilter;
    const dataFilter = rawFilter === undefined || rawFilter === null
      ? undefined
      : {
          path: typeof rawFilter.path === 'string' ? rawFilter.path.trim() : '',
          operator: rawFilter.operator,
          value: typeof rawFilter.value === 'string' ? rawFilter.value : undefined,
        };
    const filterOperators = [
      'equals',
      'not-equals',
      'contains',
      'starts-with',
      'ends-with',
      'is-empty',
      'is-not-empty',
    ];
    if (
      dataFilter
      && (
        !/^[A-Za-z_][A-Za-z0-9_]*(?:\.(?:[A-Za-z_][A-Za-z0-9_]*|\d+))*$/.test(dataFilter.path)
        || !filterOperators.includes(dataFilter.operator)
        || (
          !['is-empty', 'is-not-empty'].includes(dataFilter.operator)
          && (dataFilter.value === undefined || dataFilter.value === '')
        )
      )
    ) {
      throw Object.assign(
        new Error('dataFilter requires a valid property path, supported operator, and value where applicable.'),
        { status: 400 }
      );
    }
    const dataMode = body?.dataMode ?? 'file';
    if (!['file', 'relational-csv'].includes(dataMode)) {
      throw Object.assign(new Error('dataMode must be "file" or "relational-csv".'), { status: 400 });
    }
    return {
      kind,
      testCaseFiles,
      groupFiles,
      appId: typeof body?.appId === 'string' ? body.appId : '',
      dataFile: typeof body?.dataFile === 'string' && body.dataFile
        ? safeDataFileName(body.dataFile)
        : undefined,
      headless: Boolean(body?.headless),
      sessionPolicy,
      iterationFailurePolicy,
      maxRecords,
      dataFilter,
      dataMode,
      childDataFile: typeof body?.childDataFile === 'string' && body.childDataFile
        ? safeDataFileName(body.childDataFile)
        : undefined,
      headerKey: typeof body?.headerKey === 'string' ? body.headerKey : undefined,
      childForeignKey: typeof body?.childForeignKey === 'string' ? body.childForeignKey : undefined,
      collectionPath: typeof body?.collectionPath === 'string' ? body.collectionPath : undefined,
    };
  };

  const app = express();
  app.disable('x-powered-by');
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    next();
  });
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

  app.use('/api', (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
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
        sap: { ...sap, ...governance.getSap(sap) },
        salesforce: { configured: false, available: false },
        oracle: { configured: false, available: false },
        servicenow: { configured: false, available: false },
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/workspace-context', async (req, res) => {
    try {
      const user = auth.state(req).user;
      if (!user) return res.status(401).json({ error: 'Authentication is required.' });
      const status = await getCredentialStatus('default');
      res.json(workspaceContext(user, status, governance.getSap(status)));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.put('/api/settings/integrations/sap', async (req, res) => {
    try {
      const url = typeof req.body?.url === 'string' ? req.body.url.trim() : '';
      const username = typeof req.body?.username === 'string' ? req.body.username.trim() : '';
      const suppliedPassword = typeof req.body?.password === 'string' ? req.body.password : '';
      const safetyClass = req.body?.safetyClass;
      if (safetyClass !== 'non-production' && safetyClass !== 'production-like') {
        return res.status(400).json({ error: 'Select whether the SAP target is Non-production or Production-like.' });
      }
      let parsed: URL;
      try {
        parsed = new URL(url);
      } catch {
        return res.status(400).json({ error: 'Enter a valid SAP test-system URL.' });
      }
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        return res.status(400).json({ error: 'SAP target URL must use HTTP or HTTPS.' });
      }
      if (parsed.username || parsed.password) {
        return res.status(400).json({ error: 'Do not embed credentials in the SAP target URL. Use the username and password fields.' });
      }
      if (!username) return res.status(400).json({ error: 'SAP username is required.' });

      const currentStatus = await getCredentialStatus('default');
      if (currentStatus.source === 'environment') {
        const target = governance.saveConfiguration(currentStatus, safetyClass);
        return res.json({ ...currentStatus, ...target });
      }
      const current = await getCredentials('default').catch(() => null);
      const password = suppliedPassword || current?.password || '';
      if (!password) return res.status(400).json({ error: 'SAP password is required the first time this target is saved.' });

      await setCredentials('default', { url: parsed.toString(), username, password });
      const saved = await getCredentialStatus('default');
      res.json({ ...saved, ...governance.saveConfiguration(saved, safetyClass) });
    } catch (err: any) {
      res.status(err.status ?? 500).json({ error: err.message });
    }
  });

  app.post('/api/settings/integrations/sap/verify', async (_req, res) => {
    try {
      const status = await getCredentialStatus('default');
      const current = governance.getSap(status);
      if (!status.configured) {
        return res.status(409).json({ error: 'Save the SAP connection before verifying it.' });
      }
      if (current.safetyClass === 'unknown') {
        return res.status(409).json({ error: 'Classify the SAP target before verifying it.' });
      }
      const verifier = options.verifySap ?? verifySapConnection;
      const credentials = await getCredentials('default');
      const result = await verifier(credentials, objectRepository, registry);
      const safeResult = {
        ...result,
        message: redactExecutionLog(result.message, [credentials.username, credentials.password]),
      };
      const target = governance.recordVerification(status, safeResult);
      if (!safeResult.verified) {
        return res.status(422).json({
          error: safeResult.message,
          target,
        });
      }
      res.json({ target, message: safeResult.message });
    } catch (err: any) {
      res.status(err.status ?? 500).json({ error: err.message });
    }
  });

  app.get('/api/evidence-governance', (_req, res) => {
    res.json(EVIDENCE_GOVERNANCE);
  });

  // Evidence screenshots / PDFs referenced by run results — served exactly at the
  // relative path already embedded in each run's JSON report (reports/studio/<id>/...).
  const serveProtectedArtifacts = (mountPath: string, root: string, allowSpaAtMountRoot = false) => {
    const isSpaMountRoot = (req: express.Request) =>
      allowSpaAtMountRoot && req.method === 'GET' && (req.path === '/' || req.path === '');
    app.use(
      mountPath,
      (req, res, next) => {
        if (isSpaMountRoot(req)) return next();
        auth.requireAuthenticated(req, res, next);
      },
      (req, res, next) => {
        if (isSpaMountRoot(req)) return next();
        res.setHeader('Cache-Control', 'private, no-store');
        next();
      },
      (req, res, next) => {
        if (isSpaMountRoot(req)) return next();
        express.static(root, { dotfiles: 'deny', fallthrough: true, index: false })(req, res, next);
      }
    );
    // Stop missing artifact requests before the SPA fallback. This gives the
    // authenticated owner a safe 404 and never reveals whether a file exists to
    // an unauthenticated caller.
    app.use(mountPath, (req, res, next) => {
      if (isSpaMountRoot(req)) return next();
      res.status(404).json({ error: 'Artifact not found.' });
    });
  };

  serveProtectedArtifacts('/reports', reportsDir);
  // Permanent evidence archive (BL-13) — survives reports/ being cleared, unlike the scratch dir above.
  serveProtectedArtifacts('/audit-evidence', evidenceArchiveDir, true);

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
      if (!existsSync(full)) {
        return res.json(file.endsWith('.json')
          ? { format: 'json', records: [] }
          : { format: 'csv', headers: [], rows: [] });
      }
      if (file.endsWith('.json')) {
        const records = validateJsonRecords(JSON.parse(readFileSync(full, 'utf-8')), file);
        return res.json({ format: 'json', records });
      }
      res.json({ format: 'csv', ...parseCsv(readFileSync(full, 'utf-8')) });
    } catch (err: any) {
      res.status(err.status ?? 500).json({ error: err.message });
    }
  });

  app.put('/api/data/:file', (req, res) => {
    try {
      const file = safeDataFileName(req.params.file);
      const body = req.body;
      if (file.endsWith('.json')) {
        const records = validateJsonRecords(body?.records, file);
        mkdirSync(dataDir, { recursive: true });
        writeFileSync(path.join(dataDir, file), `${JSON.stringify(records, null, 2)}\n`);
        return res.json({ ok: true });
      }
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

  app.get('/api/data-relations', (_req, res) => {
    if (!existsSync(dataRelationsDir)) return res.json([]);
    res.json(readdirSync(dataRelationsDir).filter((file) => file.endsWith('.json')).sort());
  });

  app.get('/api/data-relations/:file', (req, res) => {
    try {
      const file = safeRelationFileName(req.params.file);
      const full = path.join(dataRelationsDir, file);
      if (!existsSync(full)) return res.status(404).json({ error: `Relationship "${file}" does not exist.` });
      res.json(JSON.parse(readFileSync(full, 'utf8')));
    } catch (err: any) {
      res.status(err.status ?? 500).json({ error: err.message });
    }
  });

  app.put('/api/data-relations/:file', (req, res) => {
    try {
      const file = safeRelationFileName(req.params.file);
      const body = req.body as Partial<DataRelationDefinition>;
      const definition: DataRelationDefinition = {
        headerFile: safeDataFileName(String(body.headerFile ?? '')),
        childFile: safeDataFileName(String(body.childFile ?? '')),
        headerKey: String(body.headerKey ?? '').trim(),
        childForeignKey: String(body.childForeignKey ?? '').trim(),
        collectionPath: String(body.collectionPath ?? '').trim(),
      };
      if (!definition.headerFile.endsWith('.csv') || !definition.childFile.endsWith('.csv')) {
        return res.status(400).json({ error: 'Relational datasets require CSV header and child files.' });
      }
      if (!definition.headerKey || !definition.childForeignKey || !definition.collectionPath) {
        return res.status(400).json({ error: 'Header key, child foreign key, and collection path are required.' });
      }
      const source = {
        kind: 'file' as const,
        format: 'relational-csv' as const,
        files: [
          path.join(dataDir, definition.headerFile),
          path.join(dataDir, definition.childFile),
        ],
        relation: {
          headerKey: definition.headerKey,
          childForeignKey: definition.childForeignKey,
          collectionPath: definition.collectionPath,
        },
      };
      const preview = loadTransactionData(source);
      mkdirSync(dataRelationsDir, { recursive: true });
      writeFileSync(path.join(dataRelationsDir, file), `${JSON.stringify(definition, null, 2)}\n`);
      res.json({
        ok: true,
        preview: {
          valid: true,
          transactionCount: preview.records.length,
          childRecordCount: preview.childRecordCount,
          sourceRecordCounts: preview.sourceRecordCounts,
        },
      });
    } catch (err: any) {
      if (err instanceof TransactionDataValidationError) {
        return res.status(400).json({ error: err.message, issues: err.issues });
      }
      res.status(err.status ?? 500).json({ error: err.message });
    }
  });

  app.post('/api/data/preview', (req, res) => {
    try {
      if (req.body?.format === 'json') {
        const records = validateJsonRecords(req.body.records, 'unsaved-preview.json');
        return res.json({
          valid: true,
          transactionCount: records.length,
          childRecordCount: nestedChildCount(records),
          sourceRecordCounts: [records.length],
        });
      }
      if (req.body?.format !== 'relational-csv') {
        return res.status(400).json({ error: 'Preview format must be "json" or "relational-csv".' });
      }
      const definition = req.body as DataRelationDefinition & { format: 'relational-csv' };
      const loaded = loadTransactionData({
        kind: 'file',
        format: 'relational-csv',
        files: [
          path.join(dataDir, safeDataFileName(String(definition.headerFile ?? ''))),
          path.join(dataDir, safeDataFileName(String(definition.childFile ?? ''))),
        ],
        relation: {
          headerKey: String(definition.headerKey ?? '').trim(),
          childForeignKey: String(definition.childForeignKey ?? '').trim(),
          collectionPath: String(definition.collectionPath ?? '').trim(),
        },
      });
      res.json({
        valid: true,
        transactionCount: loaded.records.length,
        childRecordCount: loaded.childRecordCount,
        sourceRecordCounts: loaded.sourceRecordCounts,
        sample: loaded.records.slice(0, 3),
      });
    } catch (err: any) {
      if (err instanceof TransactionDataValidationError) {
        return res.status(400).json({ error: err.message, issues: err.issues });
      }
      res.status(err.status ?? 500).json({ error: err.message });
    }
  });

  app.post('/api/executions/preflight', async (req, res) => {
    try {
      const draft = executionDraftFromBody(req.body);
      const result = await executionPreflight.preflight(
        draft,
        await currentTargetContext()
      );
      res.json(result);
    } catch (err: any) {
      res.status(err.status ?? 400).json({ error: err.message });
    }
  });

  app.post('/api/runs', async (req, res) => {
    if (options.executionEnabled === false) {
      return res.status(403).json({ error: 'Execution is disabled in this isolated Studio session.' });
    }
    const {
      testCaseFiles,
      groupFiles,
      appId,
      dataFile,
      headless,
      mode,
      preflightToken,
      planHash,
      acknowledgedWarnings,
    } = req.body ?? {};
    if (mode !== undefined && mode !== 'chain' && mode !== 'suite' && mode !== 'batch') {
      return res.status(400).json({ error: 'mode must be "chain", "suite" or "batch" if given' });
    }
    let requestedDraft: ExecutionDraft;
    try {
      requestedDraft = executionDraftFromBody(req.body);
    } catch (err: any) {
      return res.status(err.status ?? 400).json({ error: err.message });
    }
    if (mode === 'batch') {
      if (!Array.isArray(groupFiles) || groupFiles.length === 0) {
        return res.status(400).json({ error: 'Body must include groupFiles: string[] when mode is "batch"' });
      }
    } else if (!Array.isArray(testCaseFiles) || testCaseFiles.length === 0 || typeof appId !== 'string') {
      return res.status(400).json({ error: 'Body must include testCaseFiles: string[] and appId: string' });
    }

    if (preflightToken === undefined) {
      return res.status(409).json({ error: 'A successful server preflight is required before Start.' });
    }

    let approvedToken: string | undefined;
    let approvedSnapshot: ExecutionPlanSnapshot | undefined;
    if (preflightToken !== undefined) {
      try {
        if (typeof preflightToken !== 'string' || typeof planHash !== 'string') {
          return res.status(400).json({ error: 'A preflight Start must include preflightToken and planHash.' });
        }
        const currentTarget = await currentTargetContext();
        const claim = executionPreflight.claim(
          preflightToken,
          requestedDraft,
          planHash,
          Array.isArray(acknowledgedWarnings)
            ? acknowledgedWarnings.filter((code: unknown): code is string => typeof code === 'string')
            : [],
          currentTarget
        );
        if (claim.existingRunId) return res.json(runService.get(claim.existingRunId));
        approvedToken = preflightToken;
        approvedSnapshot = claim.snapshot;
      } catch (err: any) {
        return res.status(err.status ?? 409).json({ error: err.message });
      }
    }

    const initiatingUser = auth.state(req).user;
    if (!initiatingUser) return res.status(401).json({ error: 'Authentication is required.' });
    let executionSecrets: string[] = [];
    let targetContext: ReturnType<typeof executionTargetContext>;
    try {
      const credentials = await getCredentials('default');
      executionSecrets = [credentials.username, credentials.password];
      targetContext = await currentTargetContext();
    } catch (err: any) {
      return res.status(409).json({ error: `SAP credential profile is unavailable: ${err.message}` });
    }
    const initiatedBy = executionInitiator(initiatingUser);

    if (mode === 'batch') {
      if (!Array.isArray(groupFiles) || groupFiles.length === 0) {
        return res.status(400).json({ error: 'Body must include groupFiles: string[] when mode is "batch"' });
      }
      const resolvedGroups = groupFiles.map((f: string) => path.join('testgroups', safeGroupFileName(f)));
      const record = runService.start({
        testCaseFiles: [],
        groupFiles: resolvedGroups,
        appId: '',
        headless: Boolean(headless),
        mode,
        sessionPolicy: requestedDraft.sessionPolicy,
        iterationFailurePolicy: requestedDraft.iterationFailurePolicy,
        maxRecords: requestedDraft.maxRecords,
        executionSnapshot: approvedSnapshot,
        sensitiveValues: executionSecrets,
        initiatedBy,
        targetContext,
      });
      if (approvedToken) executionPreflight.attachRun(approvedToken, record.id);
      return res.status(201).json(runService.get(record.id));
    }

    if (!Array.isArray(testCaseFiles) || testCaseFiles.length === 0 || typeof appId !== 'string') {
      return res.status(400).json({ error: 'Body must include testCaseFiles: string[] and appId: string' });
    }
    const resolvedFiles = testCaseFiles.map((f: string) => path.join('testcases', safeTestCaseName(f)));
    const resolvedData = dataFile ? path.join('data', path.basename(dataFile)) : undefined;
    const record = runService.start({
      testCaseFiles: resolvedFiles,
      appId,
      dataFile: resolvedData,
      headless: Boolean(headless),
      mode,
      sessionPolicy: requestedDraft.sessionPolicy,
      iterationFailurePolicy: requestedDraft.iterationFailurePolicy,
      maxRecords: requestedDraft.maxRecords,
      executionSnapshot: approvedSnapshot,
      sensitiveValues: executionSecrets,
      initiatedBy,
      targetContext,
    });
    if (approvedToken) executionPreflight.attachRun(approvedToken, record.id);
    // Return the full RunStatus shape (with results: []), not the bare RunRecord —
    // the client always expects a "results" array, and returning a record without
    // one for this split second between POST and the first GET poll crashed the
    // whole page (`run.results.length` on undefined, no error boundary to catch it).
    res.status(201).json(runService.get(record.id));
  });

  app.get('/api/runs/:id', (req, res) => {
    const status = runService.get(req.params.id);
    if (!status) return res.status(404).json({ error: 'Unknown run id' });
    res.json(status);
  });

  app.get('/api/execution-metrics', (_req, res) => {
    res.json({
      ...runService.metrics(),
      preflight: executionPreflight.getHealthMetrics(),
    });
  });

  app.get('/api/execution-retention', (_req, res) => {
    res.json({
      policy: EVIDENCE_GOVERNANCE.retentionPolicy,
      automaticDeletion: EVIDENCE_GOVERNANCE.automaticDeletion,
      executionSnapshots: EVIDENCE_GOVERNANCE.executionSnapshots,
      executionEvents: EVIDENCE_GOVERNANCE.executionEvents,
      canonicalEvidence: EVIDENCE_GOVERNANCE.canonicalEvidence,
      rationale: EVIDENCE_GOVERNANCE.rationale,
    });
  });

  app.post('/api/runs/:id/cancel', (req, res) => {
    const status = runService.cancel(req.params.id);
    if (!status) return res.status(404).json({ error: 'Unknown run id' });
    res.json(status);
  });

  app.post('/api/runs/:id/rerun', async (req, res) => {
    try {
      const scope = req.body?.scope;
      if (scope !== 'full' && scope !== 'failed') {
        return res.status(400).json({ error: 'Rerun scope must be "full" or "failed".' });
      }
      if (
        typeof req.body?.reason !== 'string'
        || typeof req.body?.requestKey !== 'string'
        || typeof req.body?.reviewHash !== 'string'
      ) {
        return res.status(400).json({ error: 'Rerun reason, requestKey and reviewHash are required.' });
      }
      const credentials = await getCredentials('default');
      const initiatingUser = auth.state(req).user;
      if (!initiatingUser) return res.status(401).json({ error: 'Authentication is required.' });
      const rerunTarget = await currentTargetContext();
      if (rerunTarget.safetyClass === 'unknown' || rerunTarget.verificationStatus !== 'live-verified') {
        return res.status(409).json({
          error: 'The SAP target must be classified and freshly verified before rerun.',
        });
      }
      const status = runService.rerun(req.params.id, {
        scope,
        reason: req.body.reason,
        requestKey: req.body.requestKey,
        reviewHash: req.body.reviewHash,
        sensitiveValues: [credentials.username, credentials.password],
        initiatedBy: executionInitiator(initiatingUser),
        targetContext: rerunTarget,
      });
      res.status(201).json(status);
    } catch (error: any) {
      res.status(error.status ?? 400).json({ error: error.message });
    }
  });

  app.post('/api/runs/:id/rerun-review', async (req, res) => {
    try {
      const scope = req.body?.scope;
      if (scope !== 'full' && scope !== 'failed') {
        return res.status(400).json({ error: 'Rerun scope must be "full" or "failed".' });
      }
      if (typeof req.body?.reason !== 'string') {
        return res.status(400).json({ error: 'Rerun reason is required.' });
      }
      const initiatingUser = auth.state(req).user;
      if (!initiatingUser) return res.status(401).json({ error: 'Authentication is required.' });
      const reviewOptions = {
        scope,
        reason: req.body.reason,
        targetContext: await currentTargetContext(),
      };
      const review = runService.review
        ? runService.review(req.params.id, reviewOptions)
        : reviewRerun(req.params.id, reviewOptions);
      res.json(review);
    } catch (error: any) {
      res.status(error.status ?? 400).json({ error: error.message });
    }
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
