import express, { Express } from 'express';
import path from 'node:path';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import {
  ExecutionPlanSnapshot,
  ObjectRepository,
  DocumentLog,
  TagStore,
  ArtifactKind,
  JsonValue,
  TestCase,
  TransactionDataValidationError,
  RunHistoryStore,
  getCredentials,
  getCredentialStatus,
  loadTransactionData,
  setCredentials,
  validateTestContract,
  isLikelyUnstableId,
  findLikelyDuplicates,
  DataColumnSchemaStore,
  TestValueType,
  DataSensitivity,
} from '@taf/core';
import { ModuleRegistry, capturesForStep, inferLegacyTestContract } from '@taf/engine';
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
import { openScanSession, getScanStatus, captureScan, closeScanSession, highlightControl, startPick, getPickResult, cancelPick, dismissPick, reverifyControl } from './scanSession';
import { StudioAuth } from './auth';
import { ExecutionDraft, ExecutionDraftKind, ExecutionPreflightService } from './executionPreflight';
import { executionInitiator, executionTargetContext, workspaceContext } from './executionContext';
import { verifySapConnection, SapVerificationResult } from './sapVerification';
import {
  EVIDENCE_GOVERNANCE,
  WorkspaceGovernanceStore,
} from './workspaceGovernance';
import { OverviewPreferencesStore } from './overviewPreferences';

const REPO_ROOT = path.resolve(__dirname, '../../..');
const DEFAULT_TESTCASES_DIR = path.join(REPO_ROOT, 'testcases');
const DEFAULT_GROUPS_DIR = path.join(REPO_ROOT, 'testgroups');
const DEFAULT_PACKS_DIR = path.join(REPO_ROOT, 'testpacks');
const DEFAULT_DATA_DIR = path.join(REPO_ROOT, 'data');
const DEFAULT_REPORTS_DIR = path.join(REPO_ROOT, 'reports');
const DEFAULT_EVIDENCE_ARCHIVE_DIR = path.join(REPO_ROOT, 'audit-evidence');
const DEFAULT_AUTH_CONFIG_PATH = path.join(REPO_ROOT, '.studio', 'auth.json');
const DEFAULT_GOVERNANCE_PATH = path.join(REPO_ROOT, '.studio', 'workspace-governance.json');
const DEFAULT_OVERVIEW_PREFERENCES_PATH = path.join(REPO_ROOT, '.studio', 'overview-preferences.json');

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

/** A pack file name must be a plain "*.json" basename — never a path. */
function safePackFileName(name: string): string {
  const base = path.basename(name);
  if (!base.endsWith('.json') || base !== name) {
    throw Object.assign(new Error(`Invalid pack file name "${name}"`), { status: 400 });
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
  dataSchemaDbPath?: string;
  runHistoryDbPath?: string;
  webDistPath?: string;
  testCasesDir?: string;
  groupsDir?: string;
  packsDir?: string;
  dataDir?: string;
  reportsDir?: string;
  evidenceArchiveDir?: string;
  authConfigPath?: string;
  governancePath?: string;
  overviewPreferencesPath?: string;
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
  const packsDir = options.packsDir ?? DEFAULT_PACKS_DIR;
  const dataDir = options.dataDir ?? DEFAULT_DATA_DIR;
  const dataRelationsDir = path.join(dataDir, '.relations');
  const reportsDir = options.reportsDir ?? DEFAULT_REPORTS_DIR;
  const evidenceArchiveDir = options.evidenceArchiveDir ?? DEFAULT_EVIDENCE_ARCHIVE_DIR;
  const auth = new StudioAuth(options.authConfigPath ?? DEFAULT_AUTH_CONFIG_PATH);
  const governance = new WorkspaceGovernanceStore(options.governancePath ?? DEFAULT_GOVERNANCE_PATH);
  const overviewPreferences = new OverviewPreferencesStore(options.overviewPreferencesPath ?? DEFAULT_OVERVIEW_PREFERENCES_PATH);
  const objectDbPath = options.objectDbPath ?? path.join(REPO_ROOT, 'object-repository.db');
  const objectRepository = new ObjectRepository(objectDbPath);
  const documentDbPath = options.documentDbPath ?? path.join(REPO_ROOT, 'document-log.db');
  const documentLog = new DocumentLog(documentDbPath);
  const tagDbPath = options.tagDbPath ?? path.join(REPO_ROOT, 'tags.db');
  const tagStore = new TagStore(tagDbPath);
  const dataSchemaDbPath = options.dataSchemaDbPath ?? path.join(REPO_ROOT, 'data-column-schema.db');
  const dataColumnSchemaStore = new DataColumnSchemaStore(dataSchemaDbPath);
  // Studio never writes to the audit ledger itself — only the CLI (the real execution path,
  // see Section 6's architecture note) calls .record(); Studio only ever reads it back, the
  // same relationship it already has with reports/ (spawn CLI, read its output).
  const runHistoryDbPath = options.runHistoryDbPath ?? path.join(REPO_ROOT, 'run-history.db');
  const runHistory = new RunHistoryStore(runHistoryDbPath);
  const registry = new ModuleRegistry();
  const executionPreflight = new ExecutionPreflightService(
    { testCasesDir, groupsDir, packsDir, dataDir },
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

  const validateTestForPublishing = (testCase: TestCase) => {
    const issues: Array<{ code: string; path: string; message: string }> = [];
    if (!testCase.contract) {
      issues.push({ code: 'missing-test-contract', path: 'contract', message: 'Declare typed Test inputs and outputs before publishing.' });
      return issues;
    }
    issues.push(...validateTestContract(testCase.contract));
    if (!Array.isArray(testCase.steps) || testCase.steps.length === 0) {
      issues.push({ code: 'missing-test-steps', path: 'steps', message: 'Add at least one executable step before publishing.' });
      return issues;
    }

    const inputKeys = new Set<string>();
    for (const input of testCase.contract.inputs ?? []) {
      inputKeys.add(input.name);
      inputKeys.add(input.runtimeKey ?? input.name);
    }
    const systemKeys = new Set(['url', 'urlBase', 'username', 'password', 'today']);
    const systemContextKeys = new Set(['sap.url', 'sap.urlBase', 'sap.username', 'sap.password', 'runtime.today']);
    const availableOutputs = new Set<string>();
    const defaultAppId = testCase.steps.find((step) => typeof step?.appId === 'string' && step.appId.trim())?.appId?.trim() ?? '';

    testCase.steps.forEach((step, stepIndex) => {
      const stepPath = `steps[${stepIndex}]`;
      let moduleInfo;
      try {
        moduleInfo = registry.get(step?.module);
      } catch {
        issues.push({ code: 'unknown-module', path: `${stepPath}.module`, message: `Module "${String(step?.module)}" is not registered.` });
        return;
      }
      if (!step.params || typeof step.params !== 'object' || Array.isArray(step.params)) {
        issues.push({ code: 'invalid-step-params', path: `${stepPath}.params`, message: 'Step parameters must be a key/value object.' });
        return;
      }

      const descriptors = moduleInfo.describe?.params ?? [];
      for (const descriptor of descriptors) {
        const value = step.params[descriptor.key];
        if (descriptor.required && (typeof value !== 'string' || !value.trim())) {
          issues.push({ code: 'missing-required-parameter', path: `${stepPath}.params.${descriptor.key}`, message: `Required parameter "${descriptor.label}" is empty.` });
          continue;
        }
        if (descriptor.objectKind && typeof value === 'string' && value.trim()) {
          const appId = step.appId?.trim() || defaultAppId;
          if (!appId) {
            issues.push({ code: 'missing-object-app-id', path: `${stepPath}.appId`, message: `Set an App ID before using object "${value}".` });
          } else if (/\$\{[^}]+\}/.test(value)) {
            issues.push({ code: 'dynamic-object-reference', path: `${stepPath}.params.${descriptor.key}`, message: 'Object Repository references must resolve to a saved object before publishing.' });
          } else {
            try {
              objectRepository.get(appId, value.trim());
            } catch {
              issues.push({ code: 'missing-object-reference', path: `${stepPath}.params.${descriptor.key}`, message: `Object "${value}" does not exist under App ID "${appId}".` });
            }
          }
        }
      }

      for (const [paramKey, value] of Object.entries(step.params)) {
        if (typeof value !== 'string') {
          issues.push({ code: 'invalid-parameter-value', path: `${stepPath}.params.${paramKey}`, message: 'Executable parameter values must be strings.' });
          continue;
        }
        for (const match of value.matchAll(/\$\{([^}]+)\}/g)) {
          const key = match[1];
          if (!inputKeys.has(key) && !systemKeys.has(key) && !availableOutputs.has(key)) {
            issues.push({ code: 'unresolved-step-value', path: `${stepPath}.params.${paramKey}`, message: `Value "${key}" is not a declared input, system context value or prior output.` });
          }
        }
      }

      for (const [paramKey, binding] of Object.entries(step.valueBindings ?? {})) {
        if (!binding || typeof binding !== 'object' || !('source' in binding)) {
          issues.push({ code: 'invalid-value-binding', path: `${stepPath}.valueBindings.${paramKey}`, message: 'Value binding is invalid.' });
        } else if (binding.source === 'dataset' && (!binding.key || !inputKeys.has(binding.key))) {
          issues.push({ code: 'unresolved-dataset-binding', path: `${stepPath}.valueBindings.${paramKey}`, message: `Dataset value "${binding.key ?? ''}" is not declared by the Test contract.` });
        } else if (binding.source === 'systemContext' && !systemContextKeys.has(binding.key)) {
          issues.push({ code: 'invalid-system-binding', path: `${stepPath}.valueBindings.${paramKey}`, message: 'Choose a supported system context value.' });
        } else if (binding.source === 'priorOutput' && (!binding.output || !availableOutputs.has(binding.output))) {
          issues.push({ code: 'unresolved-prior-output', path: `${stepPath}.valueBindings.${paramKey}`, message: `Prior output "${binding.output ?? ''}" is unavailable before this step.` });
        }
      }

      for (const output of capturesForStep(step.module, step.params)) availableOutputs.add(output);
    });

    for (const output of testCase.contract.outputs ?? []) {
      const runtimeKey = output.runtimeKey ?? output.name;
      if (!availableOutputs.has(runtimeKey)) {
        issues.push({ code: 'unproduced-contract-output', path: `contract.outputs.${output.name}`, message: `Output "${output.name}" maps to "${runtimeKey}", but no step produces that value.` });
      }
    }
    return issues;
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
    const packFile = body?.packFile === undefined || body?.packFile === null || body?.packFile === ''
      ? undefined
      : safePackFileName(String(body.packFile));
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
      packFile,
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
    dataColumnSchemaStore.close();
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

  // BL-019 AC2: "Cost assumptions are saved as owner workspace preferences" — a single shared
  // JSON preference file, the same pattern workspaceGovernance.ts already uses for SAP target state.
  app.get('/api/settings/overview-preferences', (_req, res) => {
    res.json(overviewPreferences.getImpactAssumptions());
  });

  app.put('/api/settings/overview-preferences', (req, res) => {
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
      return res.status(400).json({ error: 'Body must be an object of numeric assumption fields.' });
    }
    res.json(overviewPreferences.saveImpactAssumptions(req.body));
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
    res.json(readdirSync(testCasesDir).filter((f) => f.endsWith('.json')).sort());
  });

  app.get('/api/testcases/library', (_req, res) => {
    // Same HC-023-class gap as /api/data/library: no top-level try/catch, and per-file
    // JSON.parse wasn't even individually guarded — one malformed Test file used to take down
    // the entire Test Library instead of being skipped like every other file-scanning route.
    try {
      if (!existsSync(testCasesDir)) return res.json([]);
      const tags = tagStore.listTags('testCase');
      const items = readdirSync(testCasesDir)
        .filter((file) => file.endsWith('.json'))
        .sort()
        .flatMap((file) => {
          try {
            const testCase = JSON.parse(readFileSync(path.join(testCasesDir, file), 'utf-8'));
            const steps = Array.isArray(testCase.steps) ? testCase.steps : [];
            const application = ['SAP', 'Salesforce', 'Oracle', 'ServiceNow'].includes(testCase.application)
              ? testCase.application
              : 'SAP';
            return [{
              file,
              name: typeof testCase.name === 'string' && testCase.name.trim() ? testCase.name : file.replace(/\.json$/i, ''),
              application,
              processArea: tags[file] ?? '',
              status: testCase.lifecycle === 'published' ? 'published' : testCase.lifecycle === 'draft' || steps.length === 0 ? 'draft' : 'ready',
              stepCount: steps.length,
            }];
          } catch {
            return []; // skip an unreadable/malformed file rather than fail the whole library
          }
        });
      res.json(items);
    } catch (err: any) {
      res.status(err.status ?? 500).json({ error: err.message });
    }
  });

  app.post('/api/testcases/validate', (req, res) => {
    const testCase = req.body?.testCase ?? req.body;
    if (typeof testCase?.name !== 'string' || !Array.isArray(testCase?.steps)) {
      return res.status(400).json({ error: 'Body must include a Test with name and steps.' });
    }
    const issues = validateTestForPublishing(testCase);
    res.json({ valid: issues.length === 0, issues });
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

  app.get('/api/testcases/:file/contract', (req, res) => {
    try {
      const file = safeTestCaseName(req.params.file);
      const full = path.join(testCasesDir, file);
      if (!existsSync(full)) return res.status(404).json({ error: 'Not found' });
      const testCase = JSON.parse(readFileSync(full, 'utf-8'));
      res.json(inferLegacyTestContract(testCase));
    } catch (err: any) {
      res.status(err.status ?? 500).json({ error: err.message });
    }
  });

  app.post('/api/testcases/:file', (req, res) => {
    try {
      const file = safeTestCaseName(req.params.file);
      const body = req.body?.testCase ?? req.body;
      const processArea = req.body?.testCase ? req.body.processArea : '';
      if (typeof body?.name !== 'string' || !Array.isArray(body?.steps)) {
        return res.status(400).json({ error: 'Body must be { name: string, steps: ModuleCall[] }' });
      }
      if (typeof processArea !== 'string') {
        return res.status(400).json({ error: 'processArea must be a string.' });
      }
      if (body.application !== undefined && !['SAP', 'Salesforce', 'Oracle', 'ServiceNow'].includes(body.application)) {
        return res.status(400).json({ error: 'application must be SAP, Salesforce, Oracle or ServiceNow.' });
      }
      if (body.version !== undefined && body.version !== 1) return res.status(400).json({ error: 'Test version must be 1.' });
      if (body.lifecycle !== undefined && body.lifecycle !== 'draft' && body.lifecycle !== 'published') {
        return res.status(400).json({ error: 'Test lifecycle must be draft or published.' });
      }
      if (body.lifecycle === 'published') {
        const issues = validateTestForPublishing(body);
        if (issues.length > 0) return res.status(400).json({ error: 'Test is not ready to publish.', issues });
      }
      mkdirSync(testCasesDir, { recursive: true });
      const full = path.join(testCasesDir, file);
      if (existsSync(full)) return res.status(409).json({ error: `Test "${file}" already exists.` });
      writeFileSync(full, JSON.stringify(body, null, 2) + '\n');
      if (processArea.trim()) tagStore.setTag('testCase', file, processArea.trim());
      res.status(201).json({ ok: true });
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
      if (body.application !== undefined && !['SAP', 'Salesforce', 'Oracle', 'ServiceNow'].includes(body.application)) {
        return res.status(400).json({ error: 'application must be SAP, Salesforce, Oracle or ServiceNow.' });
      }
      if (body.version !== undefined && body.version !== 1) return res.status(400).json({ error: 'Test version must be 1.' });
      if (body.lifecycle !== undefined && body.lifecycle !== 'draft' && body.lifecycle !== 'published') {
        return res.status(400).json({ error: 'Test lifecycle must be draft or published.' });
      }
      if (body.lifecycle === 'published') {
        const issues = validateTestForPublishing(body);
        if (issues.length > 0) return res.status(400).json({ error: 'Test is not ready to publish.', issues });
      }
      mkdirSync(testCasesDir, { recursive: true });
      writeFileSync(path.join(testCasesDir, file), JSON.stringify(body, null, 2) + '\n');
      res.json({ ok: true });
    } catch (err: any) {
      res.status(err.status ?? 500).json({ error: err.message });
    }
  });

  /** Every Process (Group) and Regression Pack that references a Test file directly —
   *  BL-037's dependency-aware delete/rename for Tests (a Group's own testCaseFiles/stages,
   *  or a Pack "test"-kind member). */
  function findTestUsage(file: string): { groups: string[]; packs: string[] } {
    const groups: string[] = [];
    const packs: string[] = [];
    if (existsSync(groupsDir)) {
      for (const groupFile of readdirSync(groupsDir).filter((f) => f.endsWith('.json'))) {
        try {
          const group = JSON.parse(readFileSync(path.join(groupsDir, groupFile), 'utf-8'));
          if (Array.isArray(group.testCaseFiles) && group.testCaseFiles.includes(file)) groups.push(groupFile);
        } catch {
          // skip an unreadable/malformed file rather than fail the whole scan
        }
      }
    }
    if (existsSync(packsDir)) {
      for (const packFile of readdirSync(packsDir).filter((f) => f.endsWith('.json'))) {
        try {
          const pack = JSON.parse(readFileSync(path.join(packsDir, packFile), 'utf-8'));
          if (Array.isArray(pack.members) && pack.members.some((m: any) => m?.kind === 'test' && m?.file === file)) packs.push(packFile);
        } catch {
          // skip
        }
      }
    }
    return { groups, packs };
  }

  app.get('/api/testcases/:file/usage', (req, res) => {
    try {
      res.json(findTestUsage(safeTestCaseName(req.params.file)));
    } catch (err: any) {
      res.status(err.status ?? 500).json({ error: err.message });
    }
  });

  app.delete('/api/testcases/:file', (req, res) => {
    try {
      const file = safeTestCaseName(req.params.file);
      const usage = findTestUsage(file);
      const usedBy = [...usage.groups, ...usage.packs];
      if (usedBy.length > 0 && req.query.force !== 'true') {
        return res.status(409).json({
          error: `"${file}" is referenced by ${usedBy.length} artifact${usedBy.length === 1 ? '' : 's'}. Pass force=true to delete anyway.`,
          usage,
        });
      }
      const full = path.join(testCasesDir, file);
      if (existsSync(full)) rmSync(full);
      tagStore.setTag('testCase', file, '');
      res.json({ ok: true, usage });
    } catch (err: any) {
      res.status(err.status ?? 500).json({ error: err.message });
    }
  });

  app.put('/api/testcases/:file/rename', (req, res) => {
    try {
      const file = safeTestCaseName(req.params.file);
      const { newName } = req.body ?? {};
      if (typeof newName !== 'string' || !newName.trim()) {
        return res.status(400).json({ error: 'Body must include newName: string' });
      }
      const newFile = safeTestCaseName(newName.trim());
      const oldFull = path.join(testCasesDir, file);
      const newFull = path.join(testCasesDir, newFile);
      if (!existsSync(oldFull)) return res.status(404).json({ error: `Test "${file}" does not exist.` });
      if (existsSync(newFull)) return res.status(409).json({ error: `Test "${newFile}" already exists.` });

      // Rename is a same-Test identity change, not a delete — propagating it into every
      // referencing Process/Pack is the safe, expected behavior (the same IDE-style symbol
      // rename BL-022/BL-025 already established for objects and datasets).
      const usage = findTestUsage(file);
      for (const groupFile of usage.groups) {
        const groupPath = path.join(groupsDir, groupFile);
        const group = JSON.parse(readFileSync(groupPath, 'utf-8'));
        group.testCaseFiles = (group.testCaseFiles ?? []).map((f: string) => (f === file ? newFile : f));
        for (const stage of group.stages ?? []) {
          if (stage.testCaseFile === file) stage.testCaseFile = newFile;
        }
        writeFileSync(groupPath, JSON.stringify(group, null, 2) + '\n');
      }
      for (const packFile of usage.packs) {
        const packPath = path.join(packsDir, packFile);
        const pack = JSON.parse(readFileSync(packPath, 'utf-8'));
        for (const member of pack.members ?? []) {
          if (member?.kind === 'test' && member.file === file) member.file = newFile;
        }
        writeFileSync(packPath, JSON.stringify(pack, null, 2) + '\n');
      }

      renameSync(oldFull, newFull);
      const processArea = tagStore.getTag('testCase', file);
      if (processArea) {
        tagStore.setTag('testCase', newFile, processArea);
        tagStore.setTag('testCase', file, '');
      }
      res.json({ ok: true, updatedGroups: usage.groups, updatedPacks: usage.packs });
    } catch (err: any) {
      res.status(err.status ?? 500).json({ error: err.message });
    }
  });

  /** Every Object this Test's own steps reference — BL-037 AC2's "outgoing" dependency view
   *  for a Test (findTestUsage above is its "incoming" view: which Processes/Packs use it).
   *  isObjectReferenceParam is a hoisted function declaration defined further down this file
   *  (with the rest of the Object Repository routes) — safe to call here regardless. */
  function findTestReferences(testCase: any): { appId: string; name: string }[] {
    const seen = new Set<string>();
    const refs: { appId: string; name: string }[] = [];
    const defaultAppId = testCase.steps?.find((s: any) => s.appId)?.appId ?? '';
    for (const step of testCase.steps ?? []) {
      const appId = step.appId || defaultAppId;
      for (const [key, value] of Object.entries(step.params ?? {})) {
        if (typeof value !== 'string' || !isObjectReferenceParam(step.module, key)) continue;
        const names: string[] = [];
        if (key === 'rows') {
          try {
            const rows = JSON.parse(value);
            if (Array.isArray(rows)) {
              for (const row of rows) {
                if (row && typeof row === 'object') names.push(...Object.keys(row));
              }
            }
          } catch {
            // not JSON — not a TableRowsEditor-shaped param
          }
        } else {
          names.push(value);
        }
        for (const name of names) {
          const dedupeKey = `${appId}::${name}`;
          if (!seen.has(dedupeKey)) {
            seen.add(dedupeKey);
            refs.push({ appId, name });
          }
        }
      }
    }
    return refs;
  }

  app.get('/api/testcases/:file/references', (req, res) => {
    try {
      const file = safeTestCaseName(req.params.file);
      const full = path.join(testCasesDir, file);
      if (!existsSync(full)) return res.status(404).json({ error: 'Not found' });
      const testCase = JSON.parse(readFileSync(full, 'utf-8'));
      res.json({ objects: findTestReferences(testCase) });
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
      if (body.stages !== undefined) {
        if (
          body.version !== 1
          || (body.lifecycle !== 'draft' && body.lifecycle !== 'published')
          || !Array.isArray(body.stages)
          || body.stages.length !== body.testCaseFiles.length
        ) {
          return res.status(400).json({ error: 'A version 1 Business Process requires lifecycle and one stage per Test.' });
        }
        const stageIds = new Set<string>();
        const priorOutputs = new Map<string, Map<string, { type: string }>>();
        const outputOwners = new Map<string, string>();
        for (const [index, stage] of body.stages.entries()) {
          if (
            typeof stage?.stageId !== 'string'
            || !/^[A-Za-z][A-Za-z0-9_-]*$/.test(stage.stageId)
            || stageIds.has(stage.stageId)
            || stage.testCaseFile !== body.testCaseFiles[index]
            || typeof stage.inputBindings !== 'object'
            || stage.inputBindings === null
          ) {
            return res.status(400).json({ error: `Business Process stage ${index + 1} has an invalid ID, Test reference, or binding map.` });
          }
          const testFile = safeTestCaseName(stage.testCaseFile);
          const testPath = path.join(testCasesDir, testFile);
          if (!existsSync(testPath)) {
            return res.status(400).json({ error: `Business Process stage "${stage.stageId}" references missing Test "${testFile}".` });
          }
          const contract = inferLegacyTestContract(JSON.parse(readFileSync(testPath, 'utf8')));
          for (const input of contract.inputs) {
            const binding = stage.inputBindings[input.name];
            if (input.required && !binding) {
              return res.status(400).json({ error: `Required input "${stage.stageId}.${input.name}" has no binding.` });
            }
            if (!binding) continue;
            if (!['literal', 'processData', 'stageOutput', 'systemContext'].includes(binding.source)) {
              return res.status(400).json({ error: `Input "${stage.stageId}.${input.name}" has an unsupported binding source.` });
            }
            if (binding.source === 'literal' && input.required && binding.value === '') {
              return res.status(400).json({ error: `Required input "${stage.stageId}.${input.name}" cannot use an empty literal.` });
            }
            if (binding.source === 'processData' && (typeof binding.path !== 'string' || !binding.path.trim())) {
              return res.status(400).json({ error: `Input "${stage.stageId}.${input.name}" requires a data property.` });
            }
            if (binding.source === 'stageOutput') {
              const producer = priorOutputs.get(binding.stageId);
              if (!producer) {
                return res.status(400).json({ error: `Input "${stage.stageId}.${input.name}" creates a forward reference or cycle.` });
              }
              const output = producer.get(binding.output);
              if (!output) {
                return res.status(400).json({ error: `Input "${stage.stageId}.${input.name}" references unknown output "${binding.output}".` });
              }
              if (output.type !== input.type) {
                return res.status(400).json({ error: `Input "${stage.stageId}.${input.name}" expects ${input.type}, but the selected output produces ${output.type}.` });
              }
            }
          }
          const outputs = new Map<string, { type: string }>();
          for (const output of contract.outputs) {
            const owner = outputOwners.get(output.name);
            if (owner) {
              return res.status(400).json({ error: `Output "${output.name}" is declared by both "${owner}" and "${stage.stageId}".` });
            }
            outputOwners.set(output.name, stage.stageId);
            outputs.set(output.name, { type: output.type });
          }
          priorOutputs.set(stage.stageId, outputs);
          stageIds.add(stage.stageId);
        }
      }
      mkdirSync(groupsDir, { recursive: true });
      writeFileSync(path.join(groupsDir, file), JSON.stringify(body, null, 2) + '\n');
      res.json({ ok: true });
    } catch (err: any) {
      res.status(err.status ?? 500).json({ error: err.message });
    }
  });

  /** Every Regression Pack that references a Process (Group) file directly — BL-037's
   *  dependency-aware delete/rename for Processes. */
  function findGroupUsage(file: string): { packs: string[] } {
    const packs: string[] = [];
    if (existsSync(packsDir)) {
      for (const packFile of readdirSync(packsDir).filter((f) => f.endsWith('.json'))) {
        try {
          const pack = JSON.parse(readFileSync(path.join(packsDir, packFile), 'utf-8'));
          if (Array.isArray(pack.members) && pack.members.some((m: any) => m?.kind === 'process' && m?.file === file)) packs.push(packFile);
        } catch {
          // skip an unreadable/malformed file rather than fail the whole scan
        }
      }
    }
    return { packs };
  }

  app.get('/api/groups/:file/usage', (req, res) => {
    try {
      res.json(findGroupUsage(safeGroupFileName(req.params.file)));
    } catch (err: any) {
      res.status(err.status ?? 500).json({ error: err.message });
    }
  });

  app.delete('/api/groups/:file', (req, res) => {
    try {
      const file = safeGroupFileName(req.params.file);
      const usage = findGroupUsage(file);
      if (usage.packs.length > 0 && req.query.force !== 'true') {
        return res.status(409).json({
          error: `"${file}" is referenced by ${usage.packs.length} Regression Pack${usage.packs.length === 1 ? '' : 's'}. Pass force=true to delete anyway.`,
          usage,
        });
      }
      const full = path.join(groupsDir, file);
      if (existsSync(full)) rmSync(full);
      tagStore.setTag('group', file, '');
      res.json({ ok: true, usage });
    } catch (err: any) {
      res.status(err.status ?? 500).json({ error: err.message });
    }
  });

  app.put('/api/groups/:file/rename', (req, res) => {
    try {
      const file = safeGroupFileName(req.params.file);
      const { newName } = req.body ?? {};
      if (typeof newName !== 'string' || !newName.trim()) {
        return res.status(400).json({ error: 'Body must include newName: string' });
      }
      const newFile = safeGroupFileName(newName.trim());
      const oldFull = path.join(groupsDir, file);
      const newFull = path.join(groupsDir, newFile);
      if (!existsSync(oldFull)) return res.status(404).json({ error: `Process "${file}" does not exist.` });
      if (existsSync(newFull)) return res.status(409).json({ error: `Process "${newFile}" already exists.` });

      const usage = findGroupUsage(file);
      for (const packFile of usage.packs) {
        const packPath = path.join(packsDir, packFile);
        const pack = JSON.parse(readFileSync(packPath, 'utf-8'));
        for (const member of pack.members ?? []) {
          if (member?.kind === 'process' && member.file === file) member.file = newFile;
        }
        writeFileSync(packPath, JSON.stringify(pack, null, 2) + '\n');
      }

      renameSync(oldFull, newFull);
      const processArea = tagStore.getTag('group', file);
      if (processArea) {
        tagStore.setTag('group', newFile, processArea);
        tagStore.setTag('group', file, '');
      }
      res.json({ ok: true, updatedPacks: usage.packs });
    } catch (err: any) {
      res.status(err.status ?? 500).json({ error: err.message });
    }
  });

  app.get('/api/packs', (_req, res) => {
    if (!existsSync(packsDir)) return res.json([]);
    res.json(readdirSync(packsDir).filter((f) => f.endsWith('.json')).sort());
  });

  app.get('/api/packs/:file', (req, res) => {
    try {
      const file = safePackFileName(req.params.file);
      const full = path.join(packsDir, file);
      if (!existsSync(full)) return res.status(404).json({ error: 'Not found' });
      res.json(JSON.parse(readFileSync(full, 'utf-8')));
    } catch (err: any) {
      res.status(err.status ?? 500).json({ error: err.message });
    }
  });

  app.put('/api/packs/:file', (req, res) => {
    try {
      const file = safePackFileName(req.params.file);
      const body = req.body;
      const members = Array.isArray(body?.members) ? body.members : [];
      const ids = members.map((member: any) => member?.id);
      const validMember = (member: any) =>
        typeof member?.id === 'string' &&
        member.id.trim().length > 0 &&
        (member.kind === 'test' || member.kind === 'process') &&
        typeof member.file === 'string' &&
        member.file.endsWith('.json') &&
        path.basename(member.file) === member.file &&
        (member.sessionPolicy === 'fresh-per-iteration' || member.sessionPolicy === 'reuse-within-process') &&
        (member.iterationFailurePolicy === 'stop-execution' || member.iterationFailurePolicy === 'continue-next-iteration');
      if (
        body?.version !== 1 ||
        typeof body?.name !== 'string' ||
        body.name.trim().length === 0 ||
        (body.description !== undefined && typeof body.description !== 'string') ||
        (body.lifecycle !== 'draft' && body.lifecycle !== 'published') ||
        members.length === 0 ||
        !members.every(validMember) ||
        new Set(ids).size !== ids.length
      ) {
        return res.status(400).json({
          error: 'Body must be a version 1 Regression Pack with a name, lifecycle, and uniquely identified test or process members.',
        });
      }
      for (const member of members) {
        const artifactFile = member.kind === 'test'
          ? path.join(testCasesDir, safeTestCaseName(member.file))
          : path.join(groupsDir, safeGroupFileName(member.file));
        if (!existsSync(artifactFile)) {
          return res.status(400).json({ error: `Pack member "${member.id}" references missing ${member.kind} artifact "${member.file}".` });
        }
        if (member.appId !== undefined && typeof member.appId !== 'string') {
          return res.status(400).json({ error: `Pack member "${member.id}" has an invalid App ID override.` });
        }
        if (member.kind === 'test' && member.sessionPolicy === 'reuse-within-process') {
          return res.status(400).json({ error: `Pack Test member "${member.id}" cannot reuse a Process session; use a fresh session.` });
        }
        const memberTests = member.kind === 'test'
          ? [JSON.parse(readFileSync(artifactFile, 'utf8'))]
          : (() => {
              const process = JSON.parse(readFileSync(artifactFile, 'utf8'));
              if (body.lifecycle === 'published' && process.lifecycle === 'draft') {
                throw Object.assign(
                  new Error(`Published Pack member "${member.id}" references draft Business Process "${member.file}".`),
                  { status: 400 }
                );
              }
              return process.testCaseFiles.map((testFile: string) => {
                const safe = safeTestCaseName(testFile);
                const testPath = path.join(testCasesDir, safe);
                if (!existsSync(testPath)) {
                  throw Object.assign(new Error(`Pack member "${member.id}" references missing Test "${safe}".`), { status: 400 });
                }
                return JSON.parse(readFileSync(testPath, 'utf8'));
              });
            })();
        if (
          member.iterationFailurePolicy !== 'stop-execution'
          && memberTests.some((testCase: any) => Array.isArray(testCase.transaction?.creates) && testCase.transaction.creates.length > 0)
        ) {
          return res.status(400).json({
            error: `Transactional Pack member "${member.id}" must stop execution after an iteration failure.`,
          });
        }
        if (member.dataFile !== undefined) {
          if (typeof member.dataFile !== 'string') {
            return res.status(400).json({ error: `Pack member "${member.id}" has an invalid data binding.` });
          }
          const dataFile = path.join(dataDir, safeDataFileName(member.dataFile));
          if (!existsSync(dataFile)) {
            return res.status(400).json({ error: `Pack member "${member.id}" references missing dataset "${member.dataFile}".` });
          }
        }
      }
      mkdirSync(packsDir, { recursive: true });
      writeFileSync(path.join(packsDir, file), JSON.stringify(body, null, 2) + '\n');
      res.json({ ok: true });
    } catch (err: any) {
      res.status(err.status ?? 500).json({ error: err.message });
    }
  });

  // A Regression Pack is never referenced by anything else, so it has no dependency-aware
  // delete/rename to compute — but a stable route needs both to exist regardless, for
  // BL-037's search results to manage every artifact kind consistently.
  app.delete('/api/packs/:file', (req, res) => {
    try {
      const file = safePackFileName(req.params.file);
      const full = path.join(packsDir, file);
      if (existsSync(full)) rmSync(full);
      res.json({ ok: true, usage: { packs: [] } });
    } catch (err: any) {
      res.status(err.status ?? 500).json({ error: err.message });
    }
  });

  app.put('/api/packs/:file/rename', (req, res) => {
    try {
      const file = safePackFileName(req.params.file);
      const { newName } = req.body ?? {};
      if (typeof newName !== 'string' || !newName.trim()) {
        return res.status(400).json({ error: 'Body must include newName: string' });
      }
      const newFile = safePackFileName(newName.trim());
      const oldFull = path.join(packsDir, file);
      const newFull = path.join(packsDir, newFile);
      if (!existsSync(oldFull)) return res.status(404).json({ error: `Regression Pack "${file}" does not exist.` });
      if (existsSync(newFull)) return res.status(409).json({ error: `Regression Pack "${newFile}" already exists.` });
      renameSync(oldFull, newFull);
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

  // BL-037 AC1: one search across every artifact kind, each result typed with domain
  // (process area), application (App ID) and lifecycle status, plus the stable route to open
  // it. Runs behind the same blanket app.use('/api', auth.requireAuthenticated) as everything
  // else (AC4) — no separate authorization check needed here.
  app.get('/api/search', (req, res) => {
    // HC-007: unlike every other route in this file, this one had no top-level try/catch — a
    // single malformed row anywhere it scans (Tests, Objects, the run ledger, ...) took down
    // every search request with an uncaught exception, which Express's default handler renders
    // as an HTML error page (the exact "Unexpected token '<'" the client used to crash on).
    try {
      const raw = req.query.q;
      const q = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
      if (!q) return res.json([]);
      const results: Array<{
        kind: 'test' | 'object' | 'dataset' | 'process' | 'pack' | 'run';
        id: string;
        label: string;
        domain: string;
        application: string;
        lifecycle: string;
        route: string;
      }> = [];
  
      if (existsSync(testCasesDir)) {
        const tags = tagStore.listTags('testCase');
        for (const file of readdirSync(testCasesDir).filter((f) => f.endsWith('.json'))) {
          try {
            const testCase = JSON.parse(readFileSync(path.join(testCasesDir, file), 'utf-8'));
            const name = typeof testCase.name === 'string' && testCase.name.trim() ? testCase.name : file;
            if (!`${name} ${file}`.toLowerCase().includes(q)) continue;
            const steps = Array.isArray(testCase.steps) ? testCase.steps : [];
            results.push({
              kind: 'test',
              id: file,
              label: name,
              domain: tags[file] ?? '',
              application: steps.find((s: any) => s?.appId)?.appId ?? '',
              lifecycle: testCase.lifecycle === 'published' ? 'published' : testCase.lifecycle === 'draft' || steps.length === 0 ? 'draft' : 'ready',
              route: `/compose/tests/${encodeURIComponent(file)}`,
            });
          } catch {
            // skip an unreadable/malformed file rather than fail the whole search
          }
        }
      }
  
      for (const appId of objectRepository.listAppIds()) {
        for (const control of objectRepository.listByApp(appId)) {
          if (!`${control.name} ${control.label ?? ''} ${control.controlType ?? ''}`.toLowerCase().includes(q)) continue;
          results.push({
            kind: 'object',
            id: `${appId}/${control.name}`,
            label: control.label || control.name,
            domain: '',
            application: appId,
            lifecycle: control.verificationStatus ?? 'never',
            route: `/objects/${encodeURIComponent(appId)}/${encodeURIComponent(control.name)}`,
          });
        }
      }
  
      if (existsSync(dataDir)) {
        const tags = tagStore.listTags('dataFile');
        for (const file of readdirSync(dataDir).filter((f) => f.endsWith('.csv') || f.endsWith('.json'))) {
          if (!file.toLowerCase().includes(q)) continue;
          results.push({
            kind: 'dataset',
            id: file,
            label: file,
            domain: tags[file] ?? '',
            application: '',
            lifecycle: '',
            route: `/data/${encodeURIComponent(file)}`,
          });
        }
      }
  
      if (existsSync(groupsDir)) {
        const tags = tagStore.listTags('group');
        for (const file of readdirSync(groupsDir).filter((f) => f.endsWith('.json'))) {
          try {
            const group = JSON.parse(readFileSync(path.join(groupsDir, file), 'utf-8'));
            const name = typeof group.name === 'string' && group.name.trim() ? group.name : file;
            if (!`${name} ${file}`.toLowerCase().includes(q)) continue;
            results.push({
              kind: 'process',
              id: file,
              label: name,
              domain: tags[file] ?? '',
              application: typeof group.appId === 'string' ? group.appId : '',
              lifecycle: group.lifecycle ?? '',
              route: `/process-suites/${encodeURIComponent(file)}`,
            });
          } catch {
            // skip
          }
        }
      }
  
      if (existsSync(packsDir)) {
        for (const file of readdirSync(packsDir).filter((f) => f.endsWith('.json'))) {
          try {
            const pack = JSON.parse(readFileSync(path.join(packsDir, file), 'utf-8'));
            const name = typeof pack.name === 'string' && pack.name.trim() ? pack.name : file;
            if (!`${name} ${file}`.toLowerCase().includes(q)) continue;
            results.push({
              kind: 'pack',
              id: file,
              label: name,
              domain: '',
              application: '',
              lifecycle: pack.lifecycle ?? '',
              route: `/process-suites/packs/${encodeURIComponent(file)}`,
            });
          } catch {
            // skip
          }
        }
      }
  
      for (const run of runHistory.list({ query: q, limit: 25, sortBy: 'startedAt', sortDirection: 'desc' }).items) {
        results.push({
          kind: 'run',
          id: run.id,
          label: run.testCaseNames[0] || run.id,
          domain: '',
          application: run.appId,
          lifecycle: run.status,
          route: `/audit/runs/${encodeURIComponent(run.id)}`,
        });
      }

      res.json(results.slice(0, 200));
    } catch (err: any) {
      res.status(err.status ?? 500).json({ error: err.message });
    }
  });

  // BL-10's processArea tag, generalized across every artifact kind (test cases, groups,
  // data files, App IDs) so Compose/Groups/Run/Data/Objects Browser all group the same way.
  app.get('/api/process-areas', (_req, res) => {
    res.json(tagStore.listProcessAreas());
  });

  app.post('/api/process-areas', (req, res) => {
    try {
      const { name } = req.body ?? {};
      if (typeof name !== 'string' || !name.trim()) {
        return res.status(400).json({ error: 'Body must include name: string' });
      }
      tagStore.addProcessArea(name.trim());
      res.json({ ok: true });
    } catch (err: any) {
      res.status(err.status ?? 500).json({ error: err.message });
    }
  });

  app.delete('/api/process-areas/:name', (req, res) => {
    try {
      tagStore.deleteProcessArea(req.params.name);
      res.json({ ok: true });
    } catch (err: any) {
      res.status(err.status ?? 500).json({ error: err.message });
    }
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

  // Precise usage/rename-propagation for BL-022 AC3 ("dependency impact... preserve or guide
  // reference correction"): only a step's params that the owning module's own schema marks as
  // objectKind (an object-repository reference) count — a coincidental string match in an
  // unrelated freeform param must not. AddLineItem's "rows" param is the one exception: it's a
  // JSON blob of {objectName: value} rows with no objectKind of its own (see StepEditor's
  // TABLE_ROWS_KEY handling), so its keys are checked directly instead.
  function isObjectReferenceParam(moduleName: string, paramKey: string): boolean {
    if (moduleName === 'AddLineItem' && paramKey === 'rows') return true;
    try {
      return Boolean(registry.get(moduleName).describe?.params.find((p) => p.key === paramKey)?.objectKind);
    } catch {
      return false; // unknown module — nothing to match against
    }
  }

  /** Every step across every persisted Test case that references `name` under `appId`, scoped
   *  by each step's own App ID (falling back to the test's first-step default, same rule
   *  TestCaseEditor.tsx uses client-side) so a same-named object under a different App ID is
   *  never treated as a match. */
  function findObjectUsage(appId: string, name: string): string[] {
    const used: string[] = [];
    if (!existsSync(testCasesDir)) return used;
    for (const file of readdirSync(testCasesDir).filter((f) => f.endsWith('.json'))) {
      try {
        const testCase = JSON.parse(readFileSync(path.join(testCasesDir, file), 'utf-8'));
        const defaultAppId = testCase.steps?.find((s: any) => s.appId)?.appId ?? '';
        const referenced = (testCase.steps ?? []).some((step: any) => {
          if ((step.appId || defaultAppId) !== appId) return false;
          return Object.entries(step.params ?? {}).some(([key, value]) => {
            if (typeof value !== 'string' || !isObjectReferenceParam(step.module, key)) return false;
            if (key === 'rows') {
              try {
                const rows = JSON.parse(value);
                return Array.isArray(rows) && rows.some((row) => row && typeof row === 'object' && name in row);
              } catch {
                return false;
              }
            }
            return value === name;
          });
        });
        if (referenced) used.push(file);
      } catch {
        // skip an unreadable/malformed file rather than fail the whole scan
      }
    }
    return used;
  }

  /** Rewrites every reference to `oldName` under `appId` to `newName` in one Test case's steps,
   *  in place — mutates `testCase`, returns whether anything actually changed. Used to
   *  propagate a rename rather than silently leaving referencing Tests broken. */
  function renameObjectInTestCase(testCase: any, appId: string, oldName: string, newName: string): boolean {
    let changed = false;
    const defaultAppId = testCase.steps?.find((s: any) => s.appId)?.appId ?? '';
    for (const step of testCase.steps ?? []) {
      if ((step.appId || defaultAppId) !== appId) continue;
      for (const [key, value] of Object.entries(step.params ?? {})) {
        if (typeof value !== 'string' || !isObjectReferenceParam(step.module, key)) continue;
        if (key === 'rows') {
          try {
            const rows = JSON.parse(value);
            if (Array.isArray(rows) && rows.some((row) => row && typeof row === 'object' && oldName in row)) {
              step.params[key] = JSON.stringify(
                rows.map((row: any) => {
                  if (!row || typeof row !== 'object' || !(oldName in row)) return row;
                  const { [oldName]: cellValue, ...rest } = row;
                  return { ...rest, [newName]: cellValue };
                })
              );
              changed = true;
            }
          } catch {
            // not JSON — not a TableRowsEditor-shaped param
          }
          continue;
        }
        if (value === oldName) {
          step.params[key] = newName;
          changed = true;
        }
      }
    }
    return changed;
  }

  /** Every Process (Group), Regression Pack and relational-CSV definition that references a
   *  dataset file — BL-025 AC3 ("Rename/removal shows affected Tests and Processes"). A Test
   *  itself never binds a data file directly (only a Group or a Pack member does — see
   *  ContextualCapturePanel's object-usage sibling for the analogous BL-022 scan), so those
   *  two directories plus the relation-definitions folder are the complete set of places to look. */
  function findDataFileUsage(file: string): { groups: string[]; packs: string[]; relations: string[] } {
    const groups: string[] = [];
    const packs: string[] = [];
    const relations: string[] = [];
    if (existsSync(groupsDir)) {
      for (const groupFile of readdirSync(groupsDir).filter((f) => f.endsWith('.json'))) {
        try {
          const group = JSON.parse(readFileSync(path.join(groupsDir, groupFile), 'utf-8'));
          if (group.dataFile === file) groups.push(groupFile);
        } catch {
          // skip an unreadable/malformed file rather than fail the whole scan
        }
      }
    }
    if (existsSync(packsDir)) {
      for (const packFile of readdirSync(packsDir).filter((f) => f.endsWith('.json'))) {
        try {
          const pack = JSON.parse(readFileSync(path.join(packsDir, packFile), 'utf-8'));
          if (Array.isArray(pack.members) && pack.members.some((m: any) => m?.dataFile === file)) packs.push(packFile);
        } catch {
          // skip
        }
      }
    }
    if (existsSync(dataRelationsDir)) {
      for (const relFile of readdirSync(dataRelationsDir).filter((f) => f.endsWith('.json'))) {
        try {
          const relation = JSON.parse(readFileSync(path.join(dataRelationsDir, relFile), 'utf-8'));
          if (relation.headerFile === file || relation.childFile === file) relations.push(relFile);
        } catch {
          // skip
        }
      }
    }
    return { groups, packs, relations };
  }

  app.get('/api/data/library', (_req, res) => {
    // HC-023: this had no top-level try/catch — if tagStore.listTags() ever threw (a locked
    // tags.db, for instance), the whole Dataset Library silently came back empty ("0 of 0")
    // because the client's own refreshLibrary() swallows a failed fetch, making a server-side
    // exception look exactly like "the search found nothing" instead of "nothing loaded."
    try {
      if (!existsSync(dataDir)) return res.json([]);
      const tags = tagStore.listTags('dataFile');
      const items = readdirSync(dataDir)
        .filter((file) => file.endsWith('.csv') || file.endsWith('.json'))
        .sort()
        .map((file) => {
          const format: 'csv' | 'json' = file.endsWith('.json') ? 'json' : 'csv';
          let rowCount = 0;
          try {
            const full = path.join(dataDir, file);
            if (format === 'json') {
              const records = JSON.parse(readFileSync(full, 'utf-8'));
              rowCount = Array.isArray(records) ? records.length : 0;
            } else {
              rowCount = parseCsv(readFileSync(full, 'utf-8')).rows.length;
            }
          } catch {
            rowCount = 0; // malformed file — still listed, just without a row count
          }
          return { file, format, processArea: tags[file] ?? '', rowCount };
        });
      res.json(items);
    } catch (err: any) {
      res.status(err.status ?? 500).json({ error: err.message });
    }
  });

  app.get('/api/data/:file/usage', (req, res) => {
    try {
      res.json(findDataFileUsage(safeDataFileName(req.params.file)));
    } catch (err: any) {
      res.status(err.status ?? 500).json({ error: err.message });
    }
  });

  app.get('/api/data/:file/schema', (req, res) => {
    try {
      res.json(dataColumnSchemaStore.listForFile(safeDataFileName(req.params.file)));
    } catch (err: any) {
      res.status(err.status ?? 500).json({ error: err.message });
    }
  });

  app.put('/api/data/:file/schema/:column', (req, res) => {
    try {
      const file = safeDataFileName(req.params.file);
      const { type, sensitivity, example } = req.body ?? {};
      if (typeof type !== 'string' || typeof sensitivity !== 'string') {
        return res.status(400).json({ error: 'Body must include type: string and sensitivity: string' });
      }
      dataColumnSchemaStore.setColumn(file, req.params.column, { type: type as TestValueType, sensitivity: sensitivity as DataSensitivity, example });
      res.json({ ok: true });
    } catch (err: any) {
      res.status(err.status ?? 500).json({ error: err.message });
    }
  });

  app.delete('/api/data/:file', (req, res) => {
    try {
      const file = safeDataFileName(req.params.file);
      const usage = findDataFileUsage(file);
      const usedBy = [...usage.groups, ...usage.packs, ...usage.relations];
      if (usedBy.length > 0 && req.query.force !== 'true') {
        return res.status(409).json({
          error: `"${file}" is referenced by ${usedBy.length} artifact${usedBy.length === 1 ? '' : 's'}. Pass force=true to delete anyway.`,
          usage,
        });
      }
      const full = path.join(dataDir, file);
      if (existsSync(full)) rmSync(full);
      dataColumnSchemaStore.removeFile(file);
      tagStore.setTag('dataFile', file, '');
      res.json({ ok: true, usage });
    } catch (err: any) {
      res.status(err.status ?? 500).json({ error: err.message });
    }
  });

  app.put('/api/data/:file/rename', (req, res) => {
    try {
      const file = safeDataFileName(req.params.file);
      const { newName } = req.body ?? {};
      if (typeof newName !== 'string' || !newName.trim()) {
        return res.status(400).json({ error: 'Body must include newName: string' });
      }
      const newFile = safeDataFileName(newName.trim());
      if (path.extname(newFile) !== path.extname(file)) {
        return res.status(400).json({ error: 'A dataset can only be renamed to the same file extension.' });
      }
      const oldFull = path.join(dataDir, file);
      const newFull = path.join(dataDir, newFile);
      if (!existsSync(oldFull)) return res.status(404).json({ error: `Dataset "${file}" does not exist.` });
      if (existsSync(newFull)) return res.status(409).json({ error: `Dataset "${newFile}" already exists.` });

      // Rename is a same-dataset identity change, not a delete — propagate it into every
      // referencing Process/Pack/relation (an IDE-style symbol rename), mirroring BL-022's
      // object rename rather than leaving those artifacts pointing at a file that no longer exists.
      const usage = findDataFileUsage(file);
      for (const groupFile of usage.groups) {
        const groupPath = path.join(groupsDir, groupFile);
        const group = JSON.parse(readFileSync(groupPath, 'utf-8'));
        group.dataFile = newFile;
        writeFileSync(groupPath, JSON.stringify(group, null, 2) + '\n');
      }
      for (const packFile of usage.packs) {
        const packPath = path.join(packsDir, packFile);
        const pack = JSON.parse(readFileSync(packPath, 'utf-8'));
        for (const member of pack.members ?? []) {
          if (member?.dataFile === file) member.dataFile = newFile;
        }
        writeFileSync(packPath, JSON.stringify(pack, null, 2) + '\n');
      }
      for (const relFile of usage.relations) {
        const relPath = path.join(dataRelationsDir, relFile);
        const relation = JSON.parse(readFileSync(relPath, 'utf-8'));
        if (relation.headerFile === file) relation.headerFile = newFile;
        if (relation.childFile === file) relation.childFile = newFile;
        writeFileSync(relPath, JSON.stringify(relation, null, 2) + '\n');
      }

      renameSync(oldFull, newFull);
      dataColumnSchemaStore.renameFile(file, newFile);
      const processArea = tagStore.getTag('dataFile', file);
      if (processArea) {
        tagStore.setTag('dataFile', newFile, processArea);
        tagStore.setTag('dataFile', file, '');
      }
      res.json({ ok: true, updatedGroups: usage.groups, updatedPacks: usage.packs, updatedRelations: usage.relations });
    } catch (err: any) {
      res.status(err.status ?? 500).json({ error: err.message });
    }
  });

  app.get('/api/objects/:appId', (req, res) => {
    const controls = objectRepository.listByApp(req.params.appId);
    const duplicates = findLikelyDuplicates(controls);
    res.json(
      controls.map((c) => ({
        ...c,
        unstableId: isLikelyUnstableId(c.controlId),
        likelyDuplicateOf: duplicates.get(c.name) ?? [],
      }))
    );
  });

  app.get('/api/objects/:appId/:name/usage', (req, res) => {
    res.json(findObjectUsage(req.params.appId, req.params.name));
  });

  app.get('/api/objects/:appId/:name/verifications', (req, res) => {
    res.json(objectRepository.listVerifications(req.params.appId, req.params.name));
  });

  app.post('/api/objects/:appId/:name/reverify', async (req, res) => {
    try {
      const stored = objectRepository.get(req.params.appId, req.params.name);
      const result = await reverifyControl(stored.controlId, stored.controlType);
      objectRepository.recordVerification({
        appId: req.params.appId,
        name: req.params.name,
        verifiedAt: new Date().toISOString(),
        outcome: result.outcome,
        liveControlId: result.live?.controlId,
        liveControlType: result.live?.controlType,
        liveBindingPath: result.live?.bindingPath,
        liveText: result.live?.text,
        verifiedBy: auth.state(req).user?.name,
      });
      res.json({ stored, ...result });
    } catch (err: any) {
      res.status(err.status ?? 500).json({ error: err.message });
    }
  });

  // BL-047 Phase 1: reconcile every stored Object for one App ID against whatever screen the
  // open scan session currently has live, instead of capturing a fresh (and possibly
  // duplicate) control — the same reverifyControl() the single-object Reverify action uses,
  // run once per Object, with the same verification history recorded for each. A "missing"
  // outcome here often just means this particular control lives on a different screen within
  // the same App ID's flow, not that it's wrong — the caller decides what to do with each row.
  app.post('/api/objects/:appId/reconcile', async (req, res) => {
    try {
      const appId = req.params.appId;
      const stored = objectRepository.listByApp(appId);
      const results: Array<{ name: string; outcome: 'verified' | 'drifted' | 'missing'; live?: { controlId: string; controlType: string; bindingPath?: string; text?: string } }> = [];
      for (const control of stored) {
        const result = await reverifyControl(control.controlId, control.controlType);
        objectRepository.recordVerification({
          appId,
          name: control.name,
          verifiedAt: new Date().toISOString(),
          outcome: result.outcome,
          liveControlId: result.live?.controlId,
          liveControlType: result.live?.controlType,
          liveBindingPath: result.live?.bindingPath,
          liveText: result.live?.text,
          verifiedBy: auth.state(req).user?.name,
        });
        results.push({ name: control.name, outcome: result.outcome, live: result.live });
      }
      res.json({
        total: results.length,
        verified: results.filter((r) => r.outcome === 'verified').length,
        drifted: results.filter((r) => r.outcome === 'drifted').length,
        missing: results.filter((r) => r.outcome === 'missing').length,
        results,
      });
    } catch (err: any) {
      res.status(err.status ?? 500).json({ error: err.message });
    }
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
    const { controlId, controlType, bindingPath, label, parentControlId, tableId, scope } = req.body ?? {};
    if (typeof controlId !== 'string' || !controlId || typeof controlType !== 'string' || !controlType) {
      return res.status(400).json({ error: 'Body must include controlId: string and controlType: string' });
    }
    objectRepository.upsert(
      {
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
        scope: scope === 'shell' || scope === 'app' ? scope : undefined,
      },
      auth.state(req).user?.name
    );
    res.json({ ok: true });
  });

  app.delete('/api/app-ids/:appId', (req, res) => {
    const appId = req.params.appId;
    objectRepository.removeAppId(appId);
    tagStore.setTag('appId', appId, '');
    res.json({ ok: true });
  });

  app.delete('/api/objects/:appId/:name', (req, res) => {
    const usedBy = findObjectUsage(req.params.appId, req.params.name);
    if (usedBy.length > 0 && req.query.force !== 'true') {
      return res.status(409).json({
        error: `"${req.params.name}" is referenced by ${usedBy.length} Test${usedBy.length === 1 ? '' : 's'}. Pass force=true to delete anyway.`,
        usedBy,
      });
    }
    objectRepository.remove(req.params.appId, req.params.name);
    res.json({ ok: true, usedBy });
  });

  app.put('/api/objects/:appId/:name/rename', (req, res) => {
    const { newName } = req.body ?? {};
    if (typeof newName !== 'string' || !newName.trim()) {
      return res.status(400).json({ error: 'Body must include newName: string' });
    }
    const trimmedNewName = newName.trim();
    try {
      // Rename is a same-control identity change, not a delete — propagating it into every
      // referencing Test is the safe, expected behavior (an IDE-style symbol rename), unlike
      // delete below which blocks instead of guessing what a removed reference should become.
      const usedBy = findObjectUsage(req.params.appId, req.params.name);
      const updatedTests: string[] = [];
      for (const file of usedBy) {
        const testPath = path.join(testCasesDir, file);
        const testCase = JSON.parse(readFileSync(testPath, 'utf-8'));
        if (renameObjectInTestCase(testCase, req.params.appId, req.params.name, trimmedNewName)) {
          writeFileSync(testPath, JSON.stringify(testCase, null, 2) + '\n');
          updatedTests.push(file);
        }
      }
      objectRepository.rename(req.params.appId, req.params.name, trimmedNewName, auth.state(req).user?.name);
      res.json({ ok: true, updatedTests });
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
      packFile,
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
      if ((!Array.isArray(groupFiles) || groupFiles.length === 0) && typeof packFile !== 'string') {
        return res.status(400).json({ error: 'Body must include groupFiles: string[] or a saved packFile when mode is "batch"' });
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
      if ((!Array.isArray(groupFiles) || groupFiles.length === 0) && !requestedDraft.packFile) {
        return res.status(400).json({ error: 'Body must include groupFiles: string[] or a saved packFile when mode is "batch"' });
      }
      const resolvedGroups = Array.isArray(groupFiles)
        ? groupFiles.map((f: string) => path.join('testgroups', safeGroupFileName(f)))
        : [];
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
    try {
      const { appId, key } = req.query;
      res.json(
        documentLog.list({
          appId: typeof appId === 'string' && appId ? appId : undefined,
          key: typeof key === 'string' && key ? key : undefined,
        })
      );
    } catch (err: any) {
      res.status(err.status ?? 500).json({ error: err.message });
    }
  });

  // BL-12/13's audit ledger — read-only from Studio's side; see runHistory's own comment above.
  // BL-035 AC1/AC2: every filter and pagination/sort control the query understands.
  app.get('/api/audit/runs', (req, res) => {
    try {
      const { appId, status, mode, runId, executedBy, artifact, environment, dateFrom, dateTo, studioRunId, query, limit, offset, sortBy, sortDirection } = req.query;
      if (status !== undefined && status !== 'passed' && status !== 'failed') {
        return res.status(400).json({ error: 'status must be "passed" or "failed" if given' });
      }
      if (mode !== undefined && mode !== 'chain' && mode !== 'suite' && mode !== 'batch') {
        return res.status(400).json({ error: 'mode must be "chain", "suite" or "batch" if given' });
      }
      if (sortBy !== undefined && sortBy !== 'startedAt' && sortBy !== 'durationMs' && sortBy !== 'status') {
        return res.status(400).json({ error: 'sortBy must be "startedAt", "durationMs" or "status" if given' });
      }
      if (sortDirection !== undefined && sortDirection !== 'asc' && sortDirection !== 'desc') {
        return res.status(400).json({ error: 'sortDirection must be "asc" or "desc" if given' });
      }
      const str = (value: unknown) => (typeof value === 'string' && value ? value : undefined);
      const num = (value: unknown) => {
        const parsed = typeof value === 'string' ? Number(value) : NaN;
        return Number.isFinite(parsed) ? parsed : undefined;
      };
      const page = runHistory.list({
        appId: str(appId),
        status,
        mode,
        runId: str(runId),
        executedBy: str(executedBy),
        artifact: str(artifact),
        environment: str(environment),
        dateFrom: str(dateFrom),
        dateTo: str(dateTo),
        studioRunId: str(studioRunId),
        query: str(query),
        limit: num(limit),
        offset: num(offset),
        sortBy,
        sortDirection,
      });
      // A header, not a body-shape change — AutomationOverview and other existing consumers
      // still get the plain RunHistorySummary[] they always have; only a pagination-aware
      // caller needs to read this.
      res.setHeader('X-Total-Count', String(page.total));
      res.json(page.items);
    } catch (err: any) {
      res.status(err.status ?? 500).json({ error: err.message });
    }
  });

  app.get('/api/audit/runs/:id', (req, res) => {
    try {
      const entry = runHistory.get(req.params.id);
      if (!entry) return res.status(404).json({ error: 'Unknown run id' });
      res.json(entry);
    } catch (err: any) {
      res.status(err.status ?? 500).json({ error: err.message });
    }
  });

  // BL-035 AC4: a run's captured business-document evidence, alongside its canonical PDF.
  app.get('/api/audit/runs/:id/documents', (req, res) => {
    try {
      res.json(documentLog.list({ runId: req.params.id }));
    } catch (err: any) {
      res.status(err.status ?? 500).json({ error: err.message });
    }
  });

  const webDist = options.webDistPath ?? path.join(REPO_ROOT, 'packages/studio-web/dist');
  if (existsSync(webDist)) {
    app.use(express.static(webDist));
    app.get('*', (_req, res) => res.sendFile(path.join(webDist, 'index.html')));
  }

  mkdirSync(path.join(reportsDir, 'studio'), { recursive: true });

  return app;
}
