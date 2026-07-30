import { createHash } from 'node:crypto';
import {
  BusinessProcessSpec,
  DataBinding,
  DataFilter,
  EXECUTION_PLAN_SCHEMA_VERSION,
  ExecutionPlan,
  FileDataSource,
  InputBinding,
  SingleTestSpec,
  SystemContextKey,
  TestAssetSnapshot,
  TestCase,
  TestContract,
} from '@taf/core';

export interface LegacyTestAsset {
  file: string;
  testCase: TestCase;
  appId?: string;
}

export interface LegacyGroupAsset {
  name: string;
  appId: string;
  tests: LegacyTestAsset[];
  dataFile?: string;
  dataSource?: FileDataSource;
}

export interface LegacyPlanOptions {
  name: string;
  profileRef: string;
  dataFile?: string;
  planId?: string;
  sessionPolicy?: 'fresh-per-iteration' | 'reuse-within-process';
  iterationFailurePolicy?: 'stop-execution' | 'continue-next-iteration';
  maxRecords?: number;
  dataFilter?: DataFilter;
  dataSource?: FileDataSource;
}

const PLACEHOLDER = /\$\{(\w+)\}/g;
const SYSTEM_BINDINGS: Readonly<Record<string, SystemContextKey>> = Object.freeze({
  url: 'sap.url',
  urlBase: 'sap.urlBase',
  username: 'sap.username',
  password: 'sap.password',
  today: 'runtime.today',
});

function stableId(value: string, fallback: string): string {
  const id = value
    .replace(/[^A-Za-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const safe = id && /^[A-Za-z]/.test(id) ? id : `${fallback}-${id || 'item'}`;
  return safe.slice(0, 80);
}

function hashTest(testCase: TestCase): string {
  return createHash('sha256').update(JSON.stringify(testCase)).digest('hex');
}

function placeholders(value: string): string[] {
  const names: string[] = [];
  for (const match of value.matchAll(PLACEHOLDER)) names.push(match[1]);
  return names;
}

function capturesForStep(module: string, params: Record<string, string>): string[] {
  switch (module) {
    case 'SaveAndCaptureDocumentNumber':
      return [params.captureAs || 'poNumber'];
    case 'CaptureDocumentNumberFromSuccessDialog':
      return [
        params.captureAs || 'documentNumber',
        ...(params.fiscalYearCaptureAs ? [params.fiscalYearCaptureAs] : []),
      ];
    case 'CreateAutomationRunReference':
      return [
        params.captureAs || 'automationReference',
        params.ownerCaptureAs || 'automationOwner',
        'transactionFailureDisposition',
      ];
    case 'AssertDocumentCreationBlocked':
      return [params.captureAs || 'negativeAssertionStatus'];
    case 'CaptureControlValue':
      return params.captureAs ? [params.captureAs] : [];
    case 'AddLineItem':
      return [params.lineItemCountKey || 'lineItemCount'];
    case 'QueryValidLineItemData':
      return [
        params.materialKey || 'material',
        params.plantKey || 'plant',
        params.quantityKey || 'quantity',
      ];
    case 'MatchGrossAmountToPoReference':
      return [params.amountKey || 'invoiceAmount'];
    case 'ReceiveOpenLineItem':
      return [params.receivedQuantityKey || 'receivedQuantity'];
    default:
      return [];
  }
}

/**
 * Derives an explicit compatibility contract from today's placeholder/capture
 * conventions. A placeholder produced earlier inside the same Test remains
 * internal state and is not exposed as a Test input.
 */
export function inferLegacyTestContract(testCase: TestCase): TestContract {
  if (testCase.contract) return testCase.contract;
  const inputs = new Set<string>();
  const outputs = new Set<string>();
  const availableInsideTest = new Set<string>();

  for (const step of testCase.steps) {
    for (const value of Object.values(step.params)) {
      for (const name of placeholders(value)) {
        if (!availableInsideTest.has(name)) inputs.add(name);
      }
    }
    for (const name of capturesForStep(step.module, step.params)) {
      availableInsideTest.add(name);
      outputs.add(name);
    }
  }

  return {
    version: 1,
    inputs: [...inputs].map((name) => ({
      name,
      type: 'string',
      required: true,
      sensitivity: name === 'password' ? 'secret' : name === 'username' ? 'personal' : 'business',
    })),
    outputs: [...outputs].map((name) => ({
      name,
      type: 'string',
      producedByStep: testCase.steps.find((step) => capturesForStep(step.module, step.params).includes(name))?.module,
    })),
  };
}

function defaultAppId(asset: LegacyTestAsset, fallback?: string): string {
  return asset.appId
    ?? asset.testCase.steps.find((step) => step.appId)?.appId
    ?? fallback
    ?? 'default';
}

function assetSnapshot(asset: LegacyTestAsset, index: number, fallbackAppId?: string): TestAssetSnapshot {
  const contract = inferLegacyTestContract(asset.testCase);
  return {
    assetId: stableId(asset.file.replace(/\.[^.]+$/, ''), `test-${index + 1}`),
    file: asset.file.replace(/\\/g, '/'),
    name: asset.testCase.name,
    appId: defaultAppId(asset, fallbackAppId),
    contentHash: hashTest(asset.testCase),
    contractMode: asset.testCase.contract ? 'declared' : 'legacy-inferred',
    contract,
    transaction: asset.testCase.transaction,
  };
}

function dataBinding(
  dataFile: string | undefined,
  scope: DataBinding['scope'],
  maxRecords?: number,
  explicitSource?: FileDataSource,
  dataFilter?: DataFilter
): DataBinding[] {
  if (!dataFile && !explicitSource) return [];
  const selection = maxRecords || dataFilter ? { maxRecords, filter: dataFilter } : undefined;
  if (explicitSource) {
    return [{
      bindingId: 'data',
      scope,
      source: explicitSource,
      selection,
    }];
  }
  const normalized = dataFile!.replace(/\\/g, '/');
  return [{
    bindingId: 'data',
    scope,
    source: {
      kind: 'file',
      format: normalized.toLowerCase().endsWith('.json') ? 'json' : 'csv',
      files: [normalized],
    },
    selection,
  }];
}

function bindInput(
  name: string,
  bindingAvailable: boolean,
  priorProducer: Map<string, { stageId: string; output: string }>
): InputBinding {
  const systemKey = SYSTEM_BINDINGS[name];
  if (systemKey) return { source: 'systemContext', key: systemKey };
  const producer = priorProducer.get(name);
  if (producer) return { source: 'stageOutput', ...producer };
  if (bindingAvailable) return { source: 'processData', bindingId: 'data', path: name };
  return { source: 'literal', value: '' };
}

function singleSpec(
  asset: LegacyTestAsset,
  dataFile: string | undefined,
  appId?: string,
  options: Pick<LegacyPlanOptions, 'sessionPolicy' | 'iterationFailurePolicy' | 'maxRecords' | 'dataFilter' | 'dataSource'> = {}
): SingleTestSpec {
  const test = assetSnapshot(asset, 0, appId);
  const hasData = Boolean(dataFile || options.dataSource);
  return {
    kind: 'singleTest',
    testExecution: {
      test,
      inputBindings: Object.fromEntries(
        (test.contract?.inputs ?? []).map((input) => [input.name, bindInput(input.name, hasData, new Map())])
      ),
    },
    dataBindings: dataBinding(dataFile, 'test', options.maxRecords, options.dataSource, options.dataFilter),
    iterationPolicy: {
      session: options.sessionPolicy ?? 'fresh-per-iteration',
      onIterationFailure: options.iterationFailurePolicy ?? 'continue-next-iteration',
      sequential: true,
    },
  };
}

function businessProcessSpec(
  assets: LegacyTestAsset[],
  dataFile: string | undefined,
  fallbackAppId?: string,
  onIterationFailure: 'stop-execution' | 'continue-next-iteration' = 'stop-execution',
  sessionPolicy: 'fresh-per-iteration' | 'reuse-within-process' = 'fresh-per-iteration',
  maxRecords?: number,
  explicitSource?: FileDataSource,
  dataFilter?: DataFilter
): BusinessProcessSpec {
  const priorProducer = new Map<string, { stageId: string; output: string }>();
  const hasData = Boolean(dataFile || explicitSource);
  const stages = assets.map((asset, index) => {
    const test = assetSnapshot(asset, index, fallbackAppId);
    const stageId = stableId(`stage-${index + 1}-${test.assetId}`, `stage-${index + 1}`);
    const inputBindings = Object.fromEntries(
      (test.contract?.inputs ?? []).map((input) => [
        input.name,
        bindInput(input.name, hasData, priorProducer),
      ])
    );
    for (const output of test.contract?.outputs ?? []) {
      priorProducer.set(output.name, { stageId, output: output.name });
    }
    return {
      stageId,
      test,
      inputBindings,
    };
  });
  return {
    kind: 'businessProcess',
    stages,
    dataBindings: dataBinding(dataFile, 'process', maxRecords, explicitSource, dataFilter),
    iterationPolicy: {
      session: sessionPolicy,
      onIterationFailure,
      sequential: true,
    },
  };
}

function planBase(options: LegacyPlanOptions) {
  return {
    schemaVersion: EXECUTION_PLAN_SCHEMA_VERSION,
    planId: stableId(options.planId ?? `legacy-${options.name}`, 'legacy-plan'),
    name: options.name,
    target: { provider: 'sap' as const, profileRef: options.profileRef },
    evidence: { enabled: true, canonical: true as const },
  };
}

/** A saved Test plus optional dataset becomes one Single Test plan. */
export function translateLegacySingleTest(
  test: LegacyTestAsset,
  options: LegacyPlanOptions
): ExecutionPlan {
  return {
    ...planBase(options),
    ...singleSpec(test, options.dataFile, test.appId, options),
  };
}

/** Legacy `run`/Chain translates to a Business Process. */
export function translateLegacyChain(
  tests: LegacyTestAsset[],
  options: LegacyPlanOptions
): ExecutionPlan {
  return {
    ...planBase(options),
    ...businessProcessSpec(
      tests,
      options.dataFile,
      undefined,
      options.iterationFailurePolicy ?? 'continue-next-iteration',
      options.sessionPolicy,
      options.maxRecords,
      options.dataSource,
      options.dataFilter
    ),
  };
}

/** Legacy Suite translates to isolated Single Test members in a Regression Pack. */
export function translateLegacySuite(
  tests: LegacyTestAsset[],
  options: LegacyPlanOptions
): ExecutionPlan {
  return {
    ...planBase(options),
    kind: 'regressionPack',
    members: tests.map((asset, index) => ({
      memberId: stableId(`member-${index + 1}-${asset.file.replace(/\.[^.]+$/, '')}`, `member-${index + 1}`),
      name: asset.testCase.name,
      executable: singleSpec(asset, options.dataFile, undefined, options),
    })),
    onMemberFailure: 'continue-next-member',
    sequential: true,
  };
}

/** Legacy Batch translates each Group to an independently isolated Business Process. */
export function translateLegacyBatch(
  groups: LegacyGroupAsset[],
  options: Omit<LegacyPlanOptions, 'dataFile'>
): ExecutionPlan {
  return {
    ...planBase(options),
    kind: 'regressionPack',
    members: groups.map((group, index) => ({
      memberId: stableId(`group-${index + 1}-${group.name}`, `group-${index + 1}`),
      name: group.name,
      executable: businessProcessSpec(
        group.tests,
        group.dataFile,
        group.appId,
        options.iterationFailurePolicy,
        options.sessionPolicy,
        options.maxRecords,
        group.dataSource,
        options.dataFilter
      ),
    })),
    onMemberFailure: 'continue-next-member',
    sequential: true,
  };
}
