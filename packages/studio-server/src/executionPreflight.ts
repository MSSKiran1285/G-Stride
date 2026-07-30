import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import {
  DataFilter,
  ExecutionPlan,
  ExecutionPlanSnapshot,
  FileDataSource,
  InputBinding,
  JsonValue,
  ObjectRepository,
  TestCase,
  applyDataSelection,
  createExecutionPlanSnapshot,
  loadTransactionData,
  validateExecutionPlan,
} from '@taf/core';
import type { ExecutionTargetContext } from './executionContext';
import {
  LegacyGroupAsset,
  LegacyTestAsset,
  ModuleRegistry,
  translateLegacyBatch,
  translateLegacyChain,
  translateLegacySingleTest,
  translateLegacySuite,
} from '@taf/engine';

export type ExecutionDraftKind = 'singleTest' | 'businessProcess' | 'regressionPack';

export interface ExecutionDraft {
  kind: ExecutionDraftKind;
  testCaseFiles: string[];
  groupFiles: string[];
  packFile?: string;
  appId: string;
  dataFile?: string;
  headless: boolean;
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

function correctionRoute(finding: PreflightFinding, draft: ExecutionDraft): string | undefined {
  if (finding.correction === 'settings') return '/settings/integrations/sap';
  if (finding.correction === 'data') {
    return draft.dataFile ? `/data/${encodeURIComponent(path.basename(draft.dataFile))}` : '/data';
  }
  if (finding.correction === 'scope') {
    const referencedTest = finding.reference?.match(/(?:^|[\\/])([^\\/]+\.json)(?:\s|$|·)/)?.[1];
    if (referencedTest) return `/compose/tests/${encodeURIComponent(referencedTest)}`;
    if (draft.packFile) {
      return `/process-suites/packs/${encodeURIComponent(draft.packFile)}`;
    }
    if (draft.kind === 'regressionPack' && draft.groupFiles.length > 0) {
      return `/process-suites/${encodeURIComponent(draft.groupFiles[0])}`;
    }
    if (draft.testCaseFiles.length > 0) {
      return `/compose/tests/${encodeURIComponent(draft.testCaseFiles[0])}`;
    }
    return draft.kind === 'regressionPack' ? '/process-suites' : '/compose';
  }
  return '/execute/new';
}

export interface ExecutionMatrix {
  members: number;
  iterations: number;
  stages: number;
  steps: number;
  knownChildRecords: number;
}

export interface ExecutionPreflightResult {
  ready: boolean;
  planKind: ExecutionPlan['kind'] | null;
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
  matrix: ExecutionMatrix;
  effectiveData: Array<{
    bindingId: string;
    sourceFiles: string[];
    recordCount: number;
    contentHash: string;
    records: JsonValue[];
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

interface GroupDefinition {
  name: string;
  appId: string;
  testCaseFiles: string[];
  dataFile?: string;
  version?: 1;
  lifecycle?: 'draft' | 'published';
  stages?: Array<{
    stageId: string;
    testCaseFile: string;
    inputBindings: Record<string, InputBinding | { source: 'processData'; path: string }>;
  }>;
}

interface PackDefinition {
  version: 1;
  name: string;
  description?: string;
  lifecycle: 'draft' | 'published';
  members: Array<{
    id: string;
    kind: 'test' | 'process';
    file: string;
    appId?: string;
    dataFile?: string;
    sessionPolicy: 'fresh-per-iteration' | 'reuse-within-process';
    iterationFailurePolicy: 'stop-execution' | 'continue-next-iteration';
  }>;
}

interface StoredPreflight {
  draftHash: string;
  planHash: string;
  snapshot: ExecutionPlanSnapshot;
  targetHash: string;
  expiresAtMs: number;
  warningCodes: string[];
  runId?: string;
  claimed: boolean;
}

export interface PreflightClaim {
  existingRunId?: string;
  snapshot?: ExecutionPlanSnapshot;
}

const PREFLIGHT_TTL_MS = 5 * 60 * 1000;

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`)
    .join(',')}}`;
}

function hash(value: unknown): string {
  return createHash('sha256').update(canonical(value)).digest('hex');
}

function safeJsonBasename(value: string, label: string): string {
  const base = path.basename(value);
  if (!base.endsWith('.json') || base !== value) {
    throw new Error(`${label} must be a plain JSON filename.`);
  }
  return base;
}

function safeDataBasename(value: string): string {
  const base = path.basename(value);
  if (
    base !== value
    || (!base.toLowerCase().endsWith('.csv') && !base.toLowerCase().endsWith('.json'))
  ) {
    throw new Error('Dataset must be a plain CSV or JSON filename.');
  }
  return base;
}

function stableArtifactId(value: string, fallback: string): string {
  const normalized = value
    .replace(/[^A-Za-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return (normalized && /^[A-Za-z]/.test(normalized) ? normalized : `${fallback}-${normalized || 'item'}`).slice(0, 80);
}

function countChildren(records: Record<string, JsonValue>[]): number {
  let count = 0;
  const visit = (value: JsonValue) => {
    if (Array.isArray(value)) {
      count += value.length;
      value.forEach(visit);
    } else if (value && typeof value === 'object') {
      Object.values(value).forEach(visit);
    } else if (typeof value === 'string' && value.trim().startsWith('[')) {
      try {
        const parsed = JSON.parse(value) as unknown;
        if (Array.isArray(parsed)) {
          count += parsed.length;
          parsed.forEach((entry) => visit(entry as JsonValue));
        }
      } catch {
        // Ordinary text beginning with "[" is not assumed to be child data.
      }
    }
  };
  records.forEach((record) => Object.values(record).forEach(visit));
  return count;
}

function processStepCount(tests: TestCase[]): number {
  return tests.reduce(
    (total, testCase, index) =>
      total + (index === 0
        ? testCase.steps.length
        : testCase.steps.filter((step) => step.module !== 'Login').length),
    0
  );
}

export class ExecutionPreflightService {
  private tokens = new Map<string, StoredPreflight>();
  private preflightTotal = 0;
  private preflightBlocked = 0;
  private blockingFindings = new Map<string, number>();

  constructor(
    private readonly paths: {
      testCasesDir: string;
      groupsDir: string;
      packsDir: string;
      dataDir: string;
    },
    private readonly objectRepository: ObjectRepository,
    private readonly registry: ModuleRegistry
  ) {}

  hashDraft(draft: ExecutionDraft): string {
    return hash({
      kind: draft.kind,
      testCaseFiles: draft.testCaseFiles,
      groupFiles: draft.groupFiles,
      packFile: draft.packFile ?? null,
      appId: draft.appId,
      dataFile: draft.dataFile ?? null,
      headless: draft.headless,
      sessionPolicy: draft.sessionPolicy,
      iterationFailurePolicy: draft.iterationFailurePolicy,
      maxRecords: draft.maxRecords ?? null,
      dataFilter: draft.dataFilter ?? null,
      dataMode: draft.dataMode ?? 'file',
      childDataFile: draft.childDataFile ?? null,
      headerKey: draft.headerKey ?? null,
      childForeignKey: draft.childForeignKey ?? null,
      collectionPath: draft.collectionPath ?? null,
    });
  }

  private loadTest(file: string, appId?: string): LegacyTestAsset {
    const safe = safeJsonBasename(file, 'Test');
    const fullPath = path.join(this.paths.testCasesDir, safe);
    if (!existsSync(fullPath)) throw new Error(`Test "${safe}" does not exist.`);
    const testCase = JSON.parse(readFileSync(fullPath, 'utf8')) as TestCase;
    if (!testCase.name || !Array.isArray(testCase.steps)) {
      throw new Error(`Test "${safe}" is not a valid Test definition.`);
    }
    return {
      file: path.join('testcases', safe),
      testCase,
      ...(appId?.trim() ? { appId: appId.trim() } : {}),
    };
  }

  private loadGroup(file: string): { definition: GroupDefinition; asset: LegacyGroupAsset } {
    const safe = safeJsonBasename(file, 'Business Process');
    const fullPath = path.join(this.paths.groupsDir, safe);
    if (!existsSync(fullPath)) throw new Error(`Business Process "${safe}" does not exist.`);
    const definition = JSON.parse(readFileSync(fullPath, 'utf8')) as GroupDefinition;
    if (
      !definition.name
      || !definition.appId
      || !Array.isArray(definition.testCaseFiles)
      || definition.testCaseFiles.length === 0
    ) {
      throw new Error(`Business Process "${safe}" is not a valid Group definition.`);
    }
    const orderedFiles = definition.stages?.length
      ? definition.stages.map((stage) => stage.testCaseFile)
      : definition.testCaseFiles;
    return {
      definition,
      asset: {
        name: definition.name,
        appId: definition.appId,
        tests: orderedFiles.map((test) => this.loadTest(test, definition.appId)),
        dataFile: definition.dataFile ? path.join('data', safeDataBasename(definition.dataFile)) : undefined,
      },
    };
  }

  private loadPack(file: string): PackDefinition {
    const safe = safeJsonBasename(file, 'Regression Pack');
    const fullPath = path.join(this.paths.packsDir, safe);
    if (!existsSync(fullPath)) throw new Error(`Regression Pack "${safe}" does not exist.`);
    const definition = JSON.parse(readFileSync(fullPath, 'utf8')) as PackDefinition;
    if (
      definition.version !== 1
      || !definition.name
      || !Array.isArray(definition.members)
      || definition.members.length === 0
    ) {
      throw new Error(`Regression Pack "${safe}" is not a valid version 1 Pack definition.`);
    }
    if (definition.lifecycle !== 'published') {
      throw new Error(`Regression Pack "${safe}" is still a draft. Publish it before execution.`);
    }
    return definition;
  }

  private applyStoredProcessBindings(
    executable: Extract<ExecutionPlan, { kind: 'businessProcess' }>,
    definition: GroupDefinition
  ): Extract<ExecutionPlan, { kind: 'businessProcess' }> {
    if (!definition.stages?.length) return executable;
    return {
      ...executable,
      stages: executable.stages.map((stage, index) => {
        const stored = definition.stages?.[index];
        if (!stored) return stage;
        const inputBindings = Object.fromEntries(
          Object.entries(stored.inputBindings ?? {}).map(([input, binding]) => [
            input,
            binding.source === 'processData'
              ? { ...binding, bindingId: 'data' }
              : binding,
          ])
        ) as typeof stage.inputBindings;
        return {
          ...stage,
          stageId: stored.stageId,
          inputBindings,
        };
      }),
    };
  }

  private buildPersistedPack(file: string): {
    plan: ExecutionPlan;
    tests: LegacyTestAsset[];
    matrix: ExecutionMatrix;
  } {
    const definition = this.loadPack(file);
    const members: Extract<ExecutionPlan, { kind: 'regressionPack' }>['members'] = [];
    const allTests: LegacyTestAsset[] = [];
    const matrix: ExecutionMatrix = {
      members: definition.members.length,
      iterations: 0,
      stages: 0,
      steps: 0,
      knownChildRecords: 0,
    };

    for (const member of definition.members) {
      if (member.kind === 'test') {
        const asset = this.loadTest(member.file, member.appId);
        const source = this.sourceForFile(member.dataFile);
        const records = this.loadRecords(source);
        const translated = translateLegacySingleTest(asset, {
          name: asset.testCase.name,
          profileRef: 'default',
          dataFile: member.dataFile ? path.join('data', safeDataBasename(member.dataFile)) : undefined,
          dataSource: source,
          sessionPolicy: member.sessionPolicy,
          iterationFailurePolicy: member.iterationFailurePolicy,
        });
        if (translated.kind !== 'singleTest') throw new Error(`Pack member "${member.id}" did not produce a Single Test.`);
        members.push({ memberId: member.id, name: asset.testCase.name, executable: translated });
        allTests.push(asset);
        matrix.iterations += records.length;
        matrix.stages += records.length;
        matrix.steps += asset.testCase.steps.length * records.length;
        matrix.knownChildRecords += countChildren(records);
        continue;
      }

      const loaded = this.loadGroup(member.file);
      const dataFile = member.dataFile ?? loaded.definition.dataFile;
      const source = this.sourceForFile(dataFile);
      const records = this.loadRecords(source);
      const translated = translateLegacyChain(loaded.asset.tests, {
        name: loaded.definition.name,
        profileRef: 'default',
        dataFile: dataFile ? path.join('data', safeDataBasename(dataFile)) : undefined,
        dataSource: source,
        sessionPolicy: member.sessionPolicy,
        iterationFailurePolicy: member.iterationFailurePolicy,
      });
      if (translated.kind !== 'businessProcess') {
        throw new Error(`Pack member "${member.id}" did not produce a Business Process.`);
      }
      const executable = this.applyStoredProcessBindings(translated, loaded.definition);
      members.push({ memberId: member.id, name: loaded.definition.name, executable });
      allTests.push(...loaded.asset.tests);
      matrix.iterations += records.length;
      matrix.stages += loaded.asset.tests.length * records.length;
      matrix.steps += processStepCount(loaded.asset.tests.map(({ testCase }) => testCase)) * records.length;
      matrix.knownChildRecords += countChildren(records);
    }

    return {
      plan: {
        schemaVersion: 1,
        planId: stableArtifactId(`pack-${file.replace(/\.json$/i, '')}`, 'pack'),
        name: definition.name,
        target: { provider: 'sap', profileRef: 'default' },
        evidence: { enabled: true, canonical: true },
        kind: 'regressionPack',
        members,
        onMemberFailure: 'continue-next-member',
        sequential: true,
      },
      tests: allTests,
      matrix,
    };
  }

  private sourceForFile(file: string | undefined): FileDataSource | undefined {
    if (!file) return undefined;
    const safe = safeDataBasename(path.basename(file));
    return {
      kind: 'file',
      format: safe.toLowerCase().endsWith('.json') ? 'json' : 'csv',
      files: [path.join('data', safe)],
    };
  }

  private sourceForDraft(draft: ExecutionDraft): FileDataSource | undefined {
    if (!draft.dataFile) return undefined;
    const headerFile = safeDataBasename(draft.dataFile);
    if (draft.dataMode !== 'relational-csv') return this.sourceForFile(headerFile);
    if (!draft.childDataFile || !draft.headerKey || !draft.childForeignKey || !draft.collectionPath) {
      throw new Error('Relational CSV requires header file, child file, both join keys, and a collection name.');
    }
    return {
      kind: 'file',
      format: 'relational-csv',
      files: [
        path.join('data', headerFile),
        path.join('data', safeDataBasename(draft.childDataFile)),
      ],
      relation: {
        headerKey: draft.headerKey.trim(),
        childForeignKey: draft.childForeignKey.trim(),
        collectionPath: draft.collectionPath.trim(),
      },
    };
  }

  private loadRecords(source: FileDataSource | undefined): Record<string, JsonValue>[] {
    if (!source) return [{}];
    const actualSource: FileDataSource = {
      ...source,
      files: source.files.map((file) => {
        const safe = safeDataBasename(path.basename(file));
        const fullPath = path.join(this.paths.dataDir, safe);
        if (!existsSync(fullPath)) throw new Error(`Dataset "${safe}" does not exist.`);
        return fullPath;
      }),
    };
    return loadTransactionData(actualSource).records;
  }

  private selectedRecords(draft: ExecutionDraft, source: FileDataSource | undefined): Record<string, JsonValue>[] {
    const records = this.loadRecords(source);
    return applyDataSelection(records, {
      filter: draft.dataFilter,
      maxRecords: draft.maxRecords,
    });
  }

  private validateObjects(
    tests: LegacyTestAsset[],
    findings: PreflightFinding[]
  ): void {
    for (const asset of tests) {
      for (const [stepIndex, step] of asset.testCase.steps.entries()) {
        let module;
        try {
          module = this.registry.get(step.module);
        } catch {
          findings.push({
            code: 'unknown-module',
            severity: 'blocking',
            message: `Test "${asset.testCase.name}" uses unavailable module "${step.module}".`,
            area: 'scope',
            reference: `${asset.file} · step ${stepIndex + 1}`,
            correction: 'scope',
          });
          continue;
        }
        for (const parameter of module.describe?.params ?? []) {
          const value = step.params[parameter.key];
          if (parameter.required && value === undefined) {
            findings.push({
              code: 'missing-module-parameter',
              severity: 'blocking',
              message: `${module.describe?.label ?? module.name} requires "${parameter.label}".`,
              area: 'scope',
              reference: `${asset.file} · step ${stepIndex + 1}`,
              correction: 'scope',
            });
          }
          if (!parameter.objectKind) continue;
          if (!value) {
            if (parameter.required) {
              findings.push({
                code: 'missing-object-reference',
                severity: 'blocking',
                message: `${module.describe?.label ?? module.name} requires an Object Repository reference for "${parameter.label}".`,
                area: 'scope',
                reference: `${asset.file} · step ${stepIndex + 1}`,
                correction: 'scope',
              });
            }
            continue;
          }
          if (value.includes('${')) continue;
          const appId = step.appId ?? asset.appId ?? '';
          try {
            this.objectRepository.get(appId, value);
          } catch {
            findings.push({
              code: 'missing-object',
              severity: 'blocking',
              message: `Object "${value}" is not registered for App ID "${appId}".`,
              area: 'scope',
              reference: `${asset.file} · step ${stepIndex + 1}`,
              correction: 'scope',
            });
          }
        }
      }
    }
  }

  private validateTransactionalPolicy(
    tests: LegacyTestAsset[],
    draft: ExecutionDraft,
    targetContext: ExecutionTargetContext,
    findings: PreflightFinding[]
  ): void {
    const transactional = tests.filter((asset) => (asset.testCase.transaction?.creates?.length ?? 0) > 0);
    if (transactional.length === 0) return;

    if (targetContext.safetyClass !== 'non-production') {
      findings.push({
        code: 'transactional-target-must-be-non-production',
        severity: 'blocking',
        message: 'Tests that create SAP documents can run only against a target explicitly classified as Non-production.',
        area: 'target',
        correction: 'settings',
      });
    }
    if (draft.iterationFailurePolicy !== 'stop-execution') {
      findings.push({
        code: 'transactional-fail-stop-required',
        severity: 'blocking',
        message: 'Transactional execution must stop after the first failed transaction; continuing to later transactions is not permitted.',
        area: 'policy',
        correction: 'preflight',
      });
    }

    for (const asset of transactional) {
      const policy = asset.testCase.transaction;
      if (policy?.failureDisposition !== 'retain-for-review') {
        findings.push({
          code: 'transaction-retention-policy-required',
          severity: 'blocking',
          message: `Test "${asset.testCase.name}" must declare retain-for-review as its failure disposition.`,
          area: 'policy',
          reference: asset.file,
          correction: 'scope',
        });
      }
      if (policy?.ownershipRequired !== true) {
        findings.push({
          code: 'transaction-owner-policy-required',
          severity: 'blocking',
          message: `Test "${asset.testCase.name}" must require an accountable run owner.`,
          area: 'policy',
          reference: asset.file,
          correction: 'scope',
        });
      }
    }

    if (!tests.some((asset) => asset.testCase.steps.some((step) => step.module === 'CreateAutomationRunReference'))) {
      findings.push({
        code: 'automation-reference-required',
        severity: 'blocking',
        message: 'Transactional execution must create an owner-linked automation reference before it starts creating SAP documents.',
        area: 'policy',
        correction: 'scope',
      });
    }

    findings.push({
      code: 'transaction-state-retained',
      severity: 'warning',
      message:
        'This execution can create SAP business documents. If any step fails, execution stops immediately and the resulting SAP state is retained unchanged for compliance review; no automatic reversal is performed.',
      area: 'policy',
      correction: 'preflight',
      requiresAcknowledgement: true,
    });
    findings.push({
      code: 'transaction-evidence-preserved',
      severity: 'information',
      message: 'Captured document numbers, the run owner, the automation reference, screenshots, and failure details remain attached to the immutable execution record.',
      area: 'policy',
      correction: 'preflight',
    });
  }

  private validateDataMappings(
    plan: ExecutionPlan,
    findings: PreflightFinding[]
  ): void {
    const validateExecutable = (
      executable: Extract<ExecutionPlan, { kind: 'singleTest' | 'businessProcess' }>,
      label: string
    ) => {
      const dataBinding = executable.dataBindings[0];
      let records = dataBinding ? this.loadRecords(dataBinding.source) : [{}];
      if (dataBinding) records = applyDataSelection(records, dataBinding.selection);
      const executions = executable.kind === 'singleTest'
        ? [executable.testExecution]
        : executable.stages;
      for (const execution of executions) {
        for (const [inputName, binding] of Object.entries(execution.inputBindings)) {
          if (binding.source === 'processData') {
            const segments = binding.path.split('.').filter(Boolean);
            const missing = records.filter((record) => {
              let current: unknown = record;
              for (const segment of segments) {
                if (!current || typeof current !== 'object' || Array.isArray(current) || !(segment in current)) return true;
                current = (current as Record<string, unknown>)[segment];
              }
              return false;
            }).length;
            if (missing > 0) {
              findings.push({
                code: 'missing-data-input',
                severity: 'blocking',
                message: `Input "${inputName}" is missing from ${missing} of ${records.length} selected transaction records.`,
                area: 'data',
                reference: `${label} · ${binding.path}`,
                correction: 'data',
              });
            }
          } else if (binding.source === 'literal' && binding.value === '') {
            const required = execution.test.contract?.inputs.find((input) => input.name === inputName)?.required;
            if (required) {
              findings.push({
                code: 'required-input-has-no-source',
                severity: 'blocking',
                message: `Required input "${inputName}" has no dataset, hand-off, or configured value.`,
                area: 'data',
                reference: label,
                correction: 'data',
              });
            }
          }
        }
      }
    };

    if (plan.kind === 'regressionPack') {
      for (const member of plan.members) {
        validateExecutable(member.executable as Extract<ExecutionPlan, { kind: 'singleTest' | 'businessProcess' }>, member.name);
      }
    } else {
      validateExecutable(plan, plan.name);
    }
  }

  private snapshotData(plan: ExecutionPlan): Array<{ bindingId: string; records: JsonValue[] }> {
    const forExecutable = (
      executable: Extract<ExecutionPlan, { kind: 'singleTest' | 'businessProcess' }>,
      memberId?: string
    ) => executable.dataBindings.map((binding) => {
      const records = applyDataSelection(this.loadRecords(binding.source), binding.selection);
      return {
        bindingId: memberId ? `${memberId}:${binding.bindingId}` : binding.bindingId,
        records,
      };
    });
    return plan.kind === 'regressionPack'
      ? plan.members.flatMap((member) => forExecutable(
          member.executable as Extract<ExecutionPlan, { kind: 'singleTest' | 'businessProcess' }>,
          member.memberId
        ))
      : forExecutable(plan);
  }

  private inputMappings(plan: ExecutionPlan): ExecutionPreflightResult['inputMappings'] {
    const describe = (binding: InputBinding): string => {
      if (binding.source === 'literal') return `Literal ${JSON.stringify(binding.value)}`;
      if (binding.source === 'processData') return `${binding.bindingId}.${binding.path}`;
      if (binding.source === 'stageOutput') return `stages.${binding.stageId}.outputs.${binding.output}`;
      return binding.key;
    };
    const forExecutable = (
      executable: Extract<ExecutionPlan, { kind: 'singleTest' | 'businessProcess' }>,
      member: string
    ) => {
      const executions = executable.kind === 'singleTest'
        ? [{ ...executable.testExecution, stageId: undefined }]
        : executable.stages;
      return executions.flatMap((execution) =>
        Object.entries(execution.inputBindings).map(([input, binding]) => ({
          member,
          test: execution.test.name,
          stageId: execution.stageId,
          input,
          sensitivity: execution.test.contract?.inputs.find((entry) => entry.name === input)?.sensitivity ?? 'business',
          source: binding.source,
          resolvedFrom: describe(binding),
        }))
      );
    };
    return plan.kind === 'regressionPack'
      ? plan.members.flatMap((member) => forExecutable(
          member.executable as Extract<ExecutionPlan, { kind: 'singleTest' | 'businessProcess' }>,
          member.name
        ))
      : forExecutable(plan, plan.name);
  }

  private effectiveData(
    plan: ExecutionPlan,
    snapshot: ExecutionPlanSnapshot | null
  ): ExecutionPreflightResult['effectiveData'] {
    if (!snapshot) return [];
    const sourceFiles = new Map<string, string[]>();
    const collect = (
      executable: Extract<ExecutionPlan, { kind: 'singleTest' | 'businessProcess' }>,
      memberId?: string
    ) => {
      for (const binding of executable.dataBindings) {
        const bindingId = memberId ? `${memberId}:${binding.bindingId}` : binding.bindingId;
        sourceFiles.set(bindingId, binding.source.files.map((file) => path.basename(file)));
      }
    };
    if (plan.kind === 'regressionPack') {
      for (const member of plan.members) {
        collect(
          member.executable as Extract<ExecutionPlan, { kind: 'singleTest' | 'businessProcess' }>,
          member.memberId
        );
      }
    } else {
      collect(plan);
    }
    return snapshot.data.map((data) => ({
      bindingId: data.bindingId,
      sourceFiles: sourceFiles.get(data.bindingId) ?? [],
      recordCount: data.recordCount,
      contentHash: data.contentHash,
      records: data.records,
    }));
  }

  async preflight(
    draft: ExecutionDraft,
    targetContext: ExecutionTargetContext
  ): Promise<ExecutionPreflightResult> {
    const findings: PreflightFinding[] = [];
    const matrix: ExecutionMatrix = {
      members: 0,
      iterations: 0,
      stages: 0,
      steps: 0,
      knownChildRecords: 0,
    };
    let plan: ExecutionPlan | null = null;
    let snapshot: ExecutionPlanSnapshot | null = null;
    let allTests: LegacyTestAsset[] = [];

    if (!targetContext.configured) {
      findings.push({
        code: 'sap-target-not-configured',
        severity: 'blocking',
        message: 'Configure the SAP test-system URL and credentials before execution.',
        area: 'target',
        correction: 'settings',
      });
    } else if (targetContext.safetyClass === 'unknown') {
      findings.push({
        code: 'sap-target-unclassified',
        severity: 'blocking',
        message: 'Classify the SAP target as Non-production or Production-like in Settings before execution.',
        area: 'target',
        correction: 'settings',
      });
    } else if (targetContext.verificationStatus !== 'live-verified') {
      findings.push({
        code: 'sap-target-verification-required',
        severity: 'blocking',
        message: targetContext.verifiedAt
          ? `SAP verification is stale (last verified ${targetContext.verifiedAt}). Verify the saved connection again.`
          : 'Verify SAP reachability and authentication in Settings before execution.',
        area: 'target',
        correction: 'settings',
      });
    } else if (targetContext.safetyClass === 'production-like') {
      findings.push({
        code: 'production-like-target',
        severity: 'warning',
        message: 'This target is classified as Production-like. Review the exact execution scope and side effects before starting.',
        area: 'target',
        correction: 'settings',
        requiresAcknowledgement: true,
      });
    }

    try {
      const tests = draft.testCaseFiles.map((file) => this.loadTest(file, draft.appId));
      const groups = draft.groupFiles.map((file) => this.loadGroup(file));
      if (draft.kind === 'regressionPack' && draft.packFile) {
        if (tests.length > 0 || groups.length > 0) {
          throw new Error('A saved Regression Pack cannot be mixed with compatibility Test or Process selections.');
        }
        const persisted = this.buildPersistedPack(draft.packFile);
        plan = persisted.plan;
        allTests = persisted.tests;
        Object.assign(matrix, persisted.matrix);
      } else if (draft.kind === 'singleTest') {
        if (tests.length !== 1 || groups.length !== 0) {
          throw new Error('Single Test requires exactly one saved Test.');
        }
        const dataSource = this.sourceForDraft(draft);
        const records = this.selectedRecords(draft, dataSource);
        if (records.length === 0) throw new Error('The selected dataset contains no transaction records.');
        plan = translateLegacySingleTest(tests[0], {
          name: tests[0].testCase.name,
          profileRef: 'default',
          dataFile: draft.dataFile ? path.join('data', safeDataBasename(draft.dataFile)) : undefined,
          sessionPolicy: draft.sessionPolicy,
          iterationFailurePolicy: draft.iterationFailurePolicy,
          maxRecords: draft.maxRecords,
          dataFilter: draft.dataFilter,
          dataSource,
        });
        allTests = tests;
        matrix.members = 1;
        matrix.iterations = records.length;
        matrix.stages = records.length;
        matrix.steps = tests[0].testCase.steps.length * records.length;
        matrix.knownChildRecords = countChildren(records);
      } else if (draft.kind === 'businessProcess') {
        if (tests.length === 0 || groups.length !== 0) {
          throw new Error('Business Process requires at least one ordered Test.');
        }
        const dataSource = this.sourceForDraft(draft);
        const records = this.selectedRecords(draft, dataSource);
        if (records.length === 0) throw new Error('The selected dataset contains no transaction records.');
        plan = translateLegacyChain(tests, {
          name: tests.map(({ testCase }) => testCase.name).join(' → '),
          profileRef: 'default',
          dataFile: draft.dataFile ? path.join('data', safeDataBasename(draft.dataFile)) : undefined,
          sessionPolicy: draft.sessionPolicy,
          iterationFailurePolicy: draft.iterationFailurePolicy,
          maxRecords: draft.maxRecords,
          dataFilter: draft.dataFilter,
          dataSource,
        });
        allTests = tests;
        matrix.members = 1;
        matrix.iterations = records.length;
        matrix.stages = tests.length * records.length;
        matrix.steps = processStepCount(tests.map(({ testCase }) => testCase)) * records.length;
        matrix.knownChildRecords = countChildren(records);
      } else {
        if ((tests.length === 0) === (groups.length === 0)) {
          throw new Error('Regression Pack requires Tests or Business Processes. Mixing both is not yet supported by the compatibility launcher.');
        }
        if (tests.length > 0) {
          const dataSource = this.sourceForDraft(draft);
          const records = this.selectedRecords(draft, dataSource);
          if (records.length === 0) throw new Error('The selected dataset contains no transaction records.');
          plan = translateLegacySuite(tests, {
            name: 'Regression Pack',
            profileRef: 'default',
            dataFile: draft.dataFile ? path.join('data', safeDataBasename(draft.dataFile)) : undefined,
            sessionPolicy: draft.sessionPolicy,
            iterationFailurePolicy: draft.iterationFailurePolicy,
            maxRecords: draft.maxRecords,
            dataFilter: draft.dataFilter,
            dataSource,
          });
          allTests = tests;
          matrix.members = tests.length;
          matrix.iterations = tests.length * records.length;
          matrix.stages = matrix.iterations;
          matrix.steps = tests.reduce((total, asset) => total + asset.testCase.steps.length, 0) * records.length;
          matrix.knownChildRecords = countChildren(records) * tests.length;
        } else {
          plan = translateLegacyBatch(
            groups.map(({ asset }) => asset),
            {
              name: 'Regression Pack',
              profileRef: 'default',
              sessionPolicy: draft.sessionPolicy,
              iterationFailurePolicy: draft.iterationFailurePolicy,
              maxRecords: draft.maxRecords,
              dataFilter: draft.dataFilter,
            }
          );
          allTests = groups.flatMap(({ asset }) => asset.tests);
          matrix.members = groups.length;
          for (const { definition, asset } of groups) {
            const records = this.selectedRecords(draft, this.sourceForFile(definition.dataFile));
            if (records.length === 0) {
              throw new Error(`Dataset for "${definition.name}" contains no transaction records.`);
            }
            matrix.iterations += records.length;
            matrix.stages += asset.tests.length * records.length;
            matrix.steps += processStepCount(asset.tests.map(({ testCase }) => testCase)) * records.length;
            matrix.knownChildRecords += countChildren(records);
          }
        }
      }

      for (const issue of validateExecutionPlan(plan)) {
        findings.push({
          code: issue.code,
          severity: 'blocking',
          message: issue.message,
          area: issue.path.includes('data') || issue.path.includes('Bindings') ? 'data' : 'scope',
          reference: issue.path,
          correction: issue.path.includes('data') || issue.path.includes('Bindings') ? 'data' : 'scope',
        });
      }
      this.validateDataMappings(plan, findings);
      this.validateObjects(allTests, findings);
      this.validateTransactionalPolicy(allTests, draft, targetContext, findings);
      if (!findings.some((finding) => finding.severity === 'blocking')) {
        snapshot = createExecutionPlanSnapshot(plan, this.snapshotData(plan));
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const dataSelectionFailure = /dataset|transaction records/i.test(message);
      findings.push({
        code: dataSelectionFailure ? 'invalid-data-selection' : 'invalid-execution-scope',
        severity: 'blocking',
        message,
        area: dataSelectionFailure ? 'data' : 'scope',
        correction: dataSelectionFailure ? 'data' : 'scope',
      });
    }

    const ready = Boolean(plan) && !findings.some((finding) => finding.severity === 'blocking');
    this.preflightTotal += 1;
    const blockingCodes = [...new Set(
      findings.filter((finding) => finding.severity === 'blocking').map((finding) => finding.code)
    )];
    if (blockingCodes.length > 0) this.preflightBlocked += 1;
    for (const code of blockingCodes) {
      this.blockingFindings.set(code, (this.blockingFindings.get(code) ?? 0) + 1);
    }
    const planHash = snapshot?.planHash ?? (plan ? hash(plan) : null);
    const token = ready ? randomUUID() : null;
    const expiresAtMs = Date.now() + PREFLIGHT_TTL_MS;
    if (token) {
      this.tokens.set(token, {
        draftHash: this.hashDraft(draft),
        planHash: planHash!,
        snapshot: snapshot!,
        targetHash: hash({
          configured: targetContext.configured,
          origin: targetContext.origin,
          credentialSource: targetContext.credentialSource,
          safetyClass: targetContext.safetyClass,
          verificationStatus: targetContext.verificationStatus,
          verifiedAt: targetContext.verifiedAt,
        }),
        expiresAtMs,
        warningCodes: findings
          .filter((finding) => finding.requiresAcknowledgement)
          .map((finding) => finding.code),
        claimed: false,
      });
    }
    this.prune();
    return {
      ready,
      planKind: plan?.kind ?? null,
      planHash,
      snapshotHash: snapshot?.snapshotHash ?? null,
      preflightToken: token,
      expiresAt: token ? new Date(expiresAtMs).toISOString() : null,
      target: {
        configured: targetContext.configured,
        provider: 'SAP',
        hostname: targetContext.hostname,
        profileRef: 'default',
        safetyClass: targetContext.safetyClass,
        verificationStatus: targetContext.verificationStatus,
        verifiedAt: targetContext.verifiedAt,
      },
      matrix,
      effectiveData: plan ? this.effectiveData(plan, snapshot) : [],
      inputMappings: plan ? this.inputMappings(plan) : [],
      findings: findings.map((finding) => ({
        ...finding,
        correctionRoute: correctionRoute(finding, draft),
      })),
    };
  }

  getHealthMetrics(): {
    total: number;
    blocked: number;
    blockingFindings: Record<string, number>;
  } {
    return {
      total: this.preflightTotal,
      blocked: this.preflightBlocked,
      blockingFindings: Object.fromEntries(
        [...this.blockingFindings.entries()].sort((left, right) => right[1] - left[1])
      ),
    };
  }

  claim(
    token: string,
    draft: ExecutionDraft,
    planHash: string,
    acknowledgedWarnings: string[],
    currentTargetContext?: ExecutionTargetContext
  ): PreflightClaim {
    const stored = this.tokens.get(token);
    if (!stored || stored.expiresAtMs <= Date.now()) {
      throw Object.assign(new Error('Preflight expired. Run preflight again before starting.'), { status: 409 });
    }
    if (stored.draftHash !== this.hashDraft(draft)) {
      throw Object.assign(new Error('Execution configuration changed after preflight. Run preflight again.'), { status: 409 });
    }
    if (!planHash || stored.planHash !== planHash) {
      throw Object.assign(new Error('Execution Plan hash does not match the approved preflight.'), { status: 409 });
    }
    if (
      currentTargetContext
      && stored.targetHash !== hash({
        configured: currentTargetContext.configured,
        origin: currentTargetContext.origin,
        credentialSource: currentTargetContext.credentialSource,
        safetyClass: currentTargetContext.safetyClass,
        verificationStatus: currentTargetContext.verificationStatus,
        verifiedAt: currentTargetContext.verifiedAt,
      })
    ) {
      throw Object.assign(new Error('SAP target context changed after preflight. Run preflight again.'), { status: 409 });
    }
    const acknowledged = new Set(acknowledgedWarnings);
    const missing = stored.warningCodes.filter((code) => !acknowledged.has(code));
    if (missing.length > 0) {
      throw Object.assign(new Error('Acknowledge the preflight warnings before starting.'), { status: 409 });
    }
    if (stored.runId) return { existingRunId: stored.runId };
    if (stored.claimed) {
      throw Object.assign(new Error('This execution request is already being started.'), { status: 409 });
    }
    stored.claimed = true;
    return { snapshot: stored.snapshot };
  }

  attachRun(token: string, runId: string): void {
    const stored = this.tokens.get(token);
    if (!stored) return;
    stored.runId = runId;
    stored.claimed = true;
  }

  private prune(): void {
    const now = Date.now();
    for (const [token, stored] of this.tokens) {
      if (stored.expiresAtMs <= now) this.tokens.delete(token);
    }
  }
}
