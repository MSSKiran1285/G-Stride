import { createHash, randomUUID } from 'node:crypto';
import {
  DataSensitivity,
  TestContract,
  TestContractInput,
  TestContractOutput,
  TestValueType,
  validateTestContract,
} from './testContract';
import type { TestTransactionPolicy } from './testCase';

export const EXECUTION_PLAN_SCHEMA_VERSION = 1 as const;
export const EXECUTION_SNAPSHOT_SCHEMA_VERSION = 1 as const;

export type ExecutionPlanKind = 'singleTest' | 'businessProcess' | 'regressionPack';

export const EXECUTION_KIND_LABELS: Readonly<Record<ExecutionPlanKind, string>> = Object.freeze({
  singleTest: 'Single Test',
  businessProcess: 'Business Process',
  regressionPack: 'Regression Pack',
});

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export type SystemContextKey =
  | 'sap.url'
  | 'sap.urlBase'
  | 'sap.username'
  | 'sap.password'
  | 'runtime.today';

export type InputBinding =
  | { source: 'literal'; value: JsonValue }
  | { source: 'processData'; bindingId: string; path: string }
  | { source: 'stageOutput'; stageId: string; output: string }
  | { source: 'systemContext'; key: SystemContextKey };

export interface TestAssetSnapshot {
  assetId: string;
  file: string;
  name: string;
  appId: string;
  contentHash: string;
  contractMode: 'declared' | 'legacy-inferred';
  contract?: TestContract;
  transaction?: TestTransactionPolicy;
}

export interface FileDataSource {
  kind: 'file';
  format: 'csv' | 'json' | 'relational-csv';
  files: string[];
  relation?: {
    headerKey: string;
    childForeignKey: string;
    collectionPath: string;
  };
}

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

export interface DataSelection {
  filter?: DataFilter;
  maxRecords?: number;
}

export interface DataBinding {
  bindingId: string;
  scope: 'test' | 'process' | 'stage' | 'pack-member';
  source: FileDataSource;
  selection?: DataSelection;
}

export interface IterationPolicy {
  session: 'fresh-per-iteration' | 'reuse-within-process';
  onIterationFailure: 'stop-execution' | 'continue-next-iteration';
  sequential: true;
}

export interface EvidencePolicy {
  enabled: boolean;
  canonical: true;
}

export interface ExecutionTargetReference {
  provider: 'sap';
  profileRef: string;
  contextId?: string;
}

export interface TestExecutionSpec {
  test: TestAssetSnapshot;
  inputBindings: Record<string, InputBinding>;
}

export interface SingleTestSpec {
  kind: 'singleTest';
  testExecution: TestExecutionSpec;
  dataBindings: DataBinding[];
  iterationPolicy: IterationPolicy;
}

export interface BusinessProcessStage extends TestExecutionSpec {
  stageId: string;
}

export interface BusinessProcessSpec {
  kind: 'businessProcess';
  stages: BusinessProcessStage[];
  dataBindings: DataBinding[];
  iterationPolicy: IterationPolicy;
}

export interface RegressionPackMember {
  memberId: string;
  name: string;
  executable: SingleTestSpec | BusinessProcessSpec;
}

export interface RegressionPackSpec {
  kind: 'regressionPack';
  members: RegressionPackMember[];
  onMemberFailure: 'continue-next-member' | 'stop-pack';
  sequential: true;
}

interface ExecutionPlanBase {
  schemaVersion: typeof EXECUTION_PLAN_SCHEMA_VERSION;
  planId: string;
  name: string;
  target: ExecutionTargetReference;
  evidence: EvidencePolicy;
}

export type ExecutionPlan = ExecutionPlanBase & (SingleTestSpec | BusinessProcessSpec | RegressionPackSpec);

export interface ExecutionPlanValidationIssue {
  code: string;
  path: string;
  message: string;
}

export interface ExecutionDataSnapshotInput {
  bindingId: string;
  records: JsonValue[];
}

export interface ExecutionDataSnapshot {
  bindingId: string;
  recordCount: number;
  contentHash: string;
  records: JsonValue[];
}

export interface ExecutionPlanSnapshot {
  schemaVersion: typeof EXECUTION_SNAPSHOT_SCHEMA_VERSION;
  executionId: string;
  createdAt: string;
  planHash: string;
  snapshotHash: string;
  plan: ExecutionPlan;
  data: ExecutionDataSnapshot[];
}

export class ExecutionPlanValidationError extends Error {
  constructor(public readonly issues: ExecutionPlanValidationIssue[]) {
    super(issues.map((issue) => `${issue.path}: ${issue.message}`).join('\n'));
    this.name = 'ExecutionPlanValidationError';
  }
}

const ID_PATTERN = /^[A-Za-z][A-Za-z0-9_-]*$/;
const CONTRACT_HASH_PATTERN = /^[a-f0-9]{64}$/i;
const SYSTEM_CONTEXT_KEYS = new Set<SystemContextKey>([
  'sap.url',
  'sap.urlBase',
  'sap.username',
  'sap.password',
  'runtime.today',
]);
const SYSTEM_CONTEXT_INPUT_KEYS: Readonly<Record<string, SystemContextKey>> = Object.freeze({
  url: 'sap.url',
  urlbase: 'sap.urlBase',
  username: 'sap.username',
  password: 'sap.password',
  passwd: 'sap.password',
  pwd: 'sap.password',
});
const SECRET_INPUT_NAMES = /^(?:password|passwd|pwd|token|accessToken|refreshToken|clientSecret|apiKey|privateKey)$/i;
const SECRET_PROPERTY_NAMES = /^(?:password|passwd|pwd|username|userName|token|accessToken|refreshToken|clientSecret|apiKey|privateKey|sapUrl|targetUrl)$/i;
const DATA_PATH_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*(?:\.(?:[A-Za-z_][A-Za-z0-9_]*|\d+))*$/;
const DATA_FILTER_OPERATORS = new Set<DataFilterOperator>([
  'equals',
  'not-equals',
  'contains',
  'starts-with',
  'ends-with',
  'is-empty',
  'is-not-empty',
]);

function valueAtPath(record: Record<string, JsonValue>, dataPath: string): JsonValue | undefined {
  let current: JsonValue | undefined = record;
  for (const segment of dataPath.split('.')) {
    if (Array.isArray(current)) {
      if (!/^\d+$/.test(segment)) return undefined;
      current = current[Number(segment)];
    } else if (current !== null && typeof current === 'object') {
      current = current[segment];
    } else {
      return undefined;
    }
  }
  return current;
}

function isEmptyFilterValue(value: JsonValue | undefined): boolean {
  return value === undefined
    || value === null
    || value === ''
    || (Array.isArray(value) && value.length === 0);
}

function comparableFilterValue(value: JsonValue | undefined): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

export function applyDataSelection<T extends Record<string, JsonValue>>(
  records: readonly T[],
  selection?: DataSelection
): T[] {
  let selected = [...records];
  const filter = selection?.filter;
  if (filter) {
    selected = selected.filter((record) => {
      const actual = valueAtPath(record, filter.path);
      const expected = filter.value ?? '';
      const comparable = comparableFilterValue(actual);
      switch (filter.operator) {
        case 'equals':
          return comparable === expected;
        case 'not-equals':
          return comparable !== expected;
        case 'contains':
          return comparable.toLocaleLowerCase().includes(expected.toLocaleLowerCase());
        case 'starts-with':
          return comparable.toLocaleLowerCase().startsWith(expected.toLocaleLowerCase());
        case 'ends-with':
          return comparable.toLocaleLowerCase().endsWith(expected.toLocaleLowerCase());
        case 'is-empty':
          return isEmptyFilterValue(actual);
        case 'is-not-empty':
          return !isEmptyFilterValue(actual);
      }
    });
  }
  if (selection?.maxRecords !== undefined) {
    selected = selected.slice(0, selection.maxRecords);
  }
  return selected;
}

function issue(
  issues: ExecutionPlanValidationIssue[],
  code: string,
  path: string,
  message: string
): void {
  issues.push({ code, path, message });
}

function validateId(
  value: string,
  path: string,
  issues: ExecutionPlanValidationIssue[],
  label: string
): void {
  if (!ID_PATTERN.test(value)) {
    issue(issues, 'invalid-id', path, `${label} must start with a letter and contain only letters, numbers, underscores, or hyphens.`);
  }
}

function validateSafeRelativePath(
  value: string,
  path: string,
  issues: ExecutionPlanValidationIssue[]
): void {
  const normalized = value.replace(/\\/g, '/');
  if (!value || normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized) || normalized.split('/').includes('..')) {
    issue(issues, 'unsafe-file-reference', path, 'File references must be non-empty relative paths without parent traversal.');
  }
}

function validateAsset(
  asset: TestAssetSnapshot,
  path: string,
  issues: ExecutionPlanValidationIssue[]
): void {
  validateId(asset.assetId, `${path}.assetId`, issues, 'Asset ID');
  validateSafeRelativePath(asset.file, `${path}.file`, issues);
  if (!asset.name.trim()) issue(issues, 'missing-asset-name', `${path}.name`, 'Test name is required.');
  if (!asset.appId.trim()) issue(issues, 'missing-app-id', `${path}.appId`, 'A default App ID is required.');
  if (!CONTRACT_HASH_PATTERN.test(asset.contentHash)) {
    issue(issues, 'invalid-content-hash', `${path}.contentHash`, 'Test content hash must be a SHA-256 hexadecimal value.');
  }
  if (asset.contractMode === 'declared' && !asset.contract) {
    issue(issues, 'missing-test-contract', `${path}.contract`, 'A declared contract must be included in the immutable test snapshot.');
  }
  if (asset.contract) {
    for (const contractIssue of validateTestContract(asset.contract, `${path}.contract`)) {
      issues.push(contractIssue);
    }
  }
}

function validateDataBindings(
  bindings: DataBinding[],
  path: string,
  issues: ExecutionPlanValidationIssue[]
): Set<string> {
  const ids = new Set<string>();
  bindings.forEach((binding, index) => {
    const bindingPath = `${path}[${index}]`;
    validateId(binding.bindingId, `${bindingPath}.bindingId`, issues, 'Data binding ID');
    if (ids.has(binding.bindingId)) {
      issue(issues, 'duplicate-data-binding', `${bindingPath}.bindingId`, `Duplicate data binding "${binding.bindingId}".`);
    }
    ids.add(binding.bindingId);
    if (!Array.isArray(binding.source.files) || binding.source.files.length === 0) {
      issue(issues, 'missing-data-files', `${bindingPath}.source.files`, 'At least one data file is required.');
    } else {
      binding.source.files.forEach((file, fileIndex) =>
        validateSafeRelativePath(file, `${bindingPath}.source.files[${fileIndex}]`, issues)
      );
    }
    if (binding.source.format === 'relational-csv' && binding.source.files.length !== 2) {
      issue(
        issues,
        'invalid-relational-source',
        `${bindingPath}.source.files`,
        'A relational CSV source must reference exactly one header file and one child file.'
      );
    }
    if (binding.source.format === 'relational-csv') {
      const relation = binding.source.relation;
      if (!relation) {
        issue(
          issues,
          'missing-relational-join',
          `${bindingPath}.source.relation`,
          'A relational CSV source requires header key, child foreign key, and collection path.'
        );
      } else {
        for (const [key, value] of Object.entries(relation)) {
          if (!value.trim()) {
            issue(
              issues,
              'invalid-relational-join',
              `${bindingPath}.source.relation.${key}`,
              'Relational join fields must be non-empty.'
            );
          }
        }
        if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(relation.collectionPath)) {
          issue(
            issues,
            'invalid-collection-path',
            `${bindingPath}.source.relation.collectionPath`,
            'The initial relational collection path must be one property name.'
          );
        }
      }
    } else if (binding.source.relation !== undefined) {
      issue(
        issues,
        'unexpected-relational-join',
        `${bindingPath}.source.relation`,
        'Join metadata is only valid for relational CSV sources.'
      );
    }
    if (binding.selection?.maxRecords !== undefined && (!Number.isInteger(binding.selection.maxRecords) || binding.selection.maxRecords < 1)) {
      issue(issues, 'invalid-max-records', `${bindingPath}.selection.maxRecords`, 'Maximum records must be a positive integer.');
    }
    if (binding.selection?.filter) {
      const filterPath = `${bindingPath}.selection.filter`;
      const filter = binding.selection.filter;
      if (!DATA_PATH_PATTERN.test(filter.path)) {
        issue(
          issues,
          'invalid-data-filter-path',
          `${filterPath}.path`,
          'Filter path must be a dot-separated data property path.'
        );
      }
      if (!DATA_FILTER_OPERATORS.has(filter.operator)) {
        issue(issues, 'invalid-data-filter-operator', `${filterPath}.operator`, 'Filter operator is not supported.');
      }
      if (
        !['is-empty', 'is-not-empty'].includes(filter.operator)
        && (filter.value === undefined || filter.value === '')
      ) {
        issue(issues, 'missing-data-filter-value', `${filterPath}.value`, 'This filter operator requires a value.');
      }
    }
  });
  return ids;
}

function contractInput(asset: TestAssetSnapshot, name: string): TestContractInput | undefined {
  return asset.contract?.inputs.find((input) => input.name === name);
}

function contractOutput(asset: TestAssetSnapshot, name: string): TestContractOutput | undefined {
  return asset.contract?.outputs.find((output) => output.name === name);
}

function bindingType(
  binding: InputBinding,
  priorStages: Map<string, BusinessProcessStage>
): TestValueType | undefined {
  if (binding.source !== 'stageOutput') return undefined;
  const producer = priorStages.get(binding.stageId);
  return producer ? contractOutput(producer.test, binding.output)?.type : undefined;
}

function validateBinding(
  inputName: string,
  binding: InputBinding,
  dataBindingIds: Set<string>,
  path: string,
  issues: ExecutionPlanValidationIssue[],
  input: TestContractInput | undefined,
  priorStages: Map<string, BusinessProcessStage>,
  allowStageOutput: boolean
): void {
  const requiredSystemKey = SYSTEM_CONTEXT_INPUT_KEYS[inputName.toLowerCase()];
  if (requiredSystemKey || SECRET_INPUT_NAMES.test(inputName) || input?.sensitivity === 'secret') {
    if (binding.source !== 'systemContext') {
      issue(
        issues,
        'secret-must-use-system-context',
        path,
        `Protected input "${inputName}" must reference server-injected system context.`
      );
    } else if (requiredSystemKey && binding.key !== requiredSystemKey) {
      issue(
        issues,
        'incorrect-system-context',
        `${path}.key`,
        `Input "${inputName}" must reference "${requiredSystemKey}", not "${binding.key}".`
      );
    }
  }

  if (binding.source === 'processData') {
    if (!dataBindingIds.has(binding.bindingId)) {
      issue(issues, 'unknown-data-binding', `${path}.bindingId`, `Unknown data binding "${binding.bindingId}".`);
    }
    if (!binding.path.trim()) issue(issues, 'missing-data-path', `${path}.path`, 'A process-data path is required.');
  } else if (binding.source === 'stageOutput') {
    if (!allowStageOutput) {
      issue(issues, 'stage-output-not-allowed', path, 'A Single Test cannot reference another stage output.');
      return;
    }
    const producer = priorStages.get(binding.stageId);
    if (!producer) {
      issue(
        issues,
        'future-or-unknown-stage-output',
        `${path}.stageId`,
        `Stage output must reference a previously declared stage; "${binding.stageId}" is not available.`
      );
      return;
    }
    const output = contractOutput(producer.test, binding.output);
    if (!output) {
      issue(
        issues,
        'unknown-stage-output',
        `${path}.output`,
        `Stage "${binding.stageId}" does not declare output "${binding.output}".`
      );
    } else if (input && bindingType(binding, priorStages) !== input.type) {
      issue(
        issues,
        'incompatible-stage-output',
        path,
        `Output type "${output.type}" is not compatible with input type "${input.type}".`
      );
    }
  } else if (binding.source === 'systemContext') {
    if (!SYSTEM_CONTEXT_KEYS.has(binding.key)) {
      issue(issues, 'unknown-system-context', `${path}.key`, `Unknown system context key "${String(binding.key)}".`);
    }
  }
}

function validateTestExecution(
  execution: TestExecutionSpec,
  dataBindingIds: Set<string>,
  path: string,
  issues: ExecutionPlanValidationIssue[],
  priorStages = new Map<string, BusinessProcessStage>(),
  allowStageOutput = false
): void {
  validateAsset(execution.test, `${path}.test`, issues);
  const contract = execution.test.contract;
  if (contract) {
    for (const input of contract.inputs) {
      if (input.required && execution.inputBindings[input.name] === undefined) {
        issue(
          issues,
          'missing-required-input-binding',
          `${path}.inputBindings.${input.name}`,
          `Required input "${input.name}" is not bound.`
        );
      }
    }
  }

  for (const [inputName, binding] of Object.entries(execution.inputBindings)) {
    const input = contractInput(execution.test, inputName);
    if (contract && !input) {
      issue(
        issues,
        'unknown-input-binding',
        `${path}.inputBindings.${inputName}`,
        `Input "${inputName}" is not declared by this Test contract.`
      );
    }
    validateBinding(
      inputName,
      binding,
      dataBindingIds,
      `${path}.inputBindings.${inputName}`,
      issues,
      input,
      priorStages,
      allowStageOutput
    );
  }
}

function validateIterationPolicy(
  policy: IterationPolicy,
  path: string,
  issues: ExecutionPlanValidationIssue[]
): void {
  if (policy.sequential !== true) {
    issue(issues, 'parallel-execution-not-supported', `${path}.sequential`, 'Stage 1 plans must execute sequentially.');
  }
}

function validateExecutable(
  executable: SingleTestSpec | BusinessProcessSpec,
  path: string,
  issues: ExecutionPlanValidationIssue[]
): void {
  const dataBindingIds = validateDataBindings(executable.dataBindings, `${path}.dataBindings`, issues);
  validateIterationPolicy(executable.iterationPolicy, `${path}.iterationPolicy`, issues);

  if (executable.kind === 'singleTest') {
    validateTestExecution(executable.testExecution, dataBindingIds, `${path}.testExecution`, issues);
    return;
  }

  if (!Array.isArray(executable.stages) || executable.stages.length === 0) {
    issue(issues, 'missing-process-stages', `${path}.stages`, 'A Business Process requires at least one stage.');
    return;
  }
  const stageIds = new Set<string>();
  const priorStages = new Map<string, BusinessProcessStage>();
  executable.stages.forEach((stage, index) => {
    const stagePath = `${path}.stages[${index}]`;
    validateId(stage.stageId, `${stagePath}.stageId`, issues, 'Stage ID');
    if (stageIds.has(stage.stageId)) {
      issue(issues, 'duplicate-stage-id', `${stagePath}.stageId`, `Duplicate stage ID "${stage.stageId}".`);
    }
    stageIds.add(stage.stageId);
    validateTestExecution(stage, dataBindingIds, stagePath, issues, priorStages, true);
    priorStages.set(stage.stageId, stage);
  });
}

function collectDataBindingIds(plan: ExecutionPlan): string[] {
  if (plan.kind === 'regressionPack') {
    return plan.members.flatMap((member) =>
      member.executable.dataBindings.map((binding) => `${member.memberId}:${binding.bindingId}`)
    );
  }
  return plan.dataBindings.map((binding) => binding.bindingId);
}

function inspectSecretValues(
  value: unknown,
  path: string,
  issues: ExecutionPlanValidationIssue[],
  seen = new Set<object>()
): void {
  if (value === null || value === undefined) return;
  if (typeof value === 'string') {
    if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(value)) {
      issue(issues, 'embedded-private-key', path, 'Private key material cannot be stored in an execution plan or data snapshot.');
    }
    return;
  }
  if (typeof value !== 'object') return;
  if (seen.has(value)) {
    issue(issues, 'cyclic-plan-value', path, 'Execution plans and data snapshots must be acyclic JSON values.');
    return;
  }
  seen.add(value);
  if (Array.isArray(value)) {
    value.forEach((entry, index) => inspectSecretValues(entry, `${path}[${index}]`, issues, seen));
  } else {
    for (const [key, entry] of Object.entries(value)) {
      if (SECRET_PROPERTY_NAMES.test(key) && (entry === null || typeof entry !== 'object')) {
        issue(
          issues,
          'embedded-secret-value',
          `${path}.${key}`,
          `Property "${key}" cannot contain a credential value; use a system-context reference.`
        );
      }
      inspectSecretValues(entry, `${path}.${key}`, issues, seen);
    }
  }
  seen.delete(value);
}

export function validateExecutionPlan(plan: ExecutionPlan): ExecutionPlanValidationIssue[] {
  const issues: ExecutionPlanValidationIssue[] = [];
  if (plan.schemaVersion !== EXECUTION_PLAN_SCHEMA_VERSION) {
    issue(
      issues,
      'unsupported-plan-version',
      'plan.schemaVersion',
      `Execution Plan schema version must be ${EXECUTION_PLAN_SCHEMA_VERSION}.`
    );
  }
  validateId(plan.planId, 'plan.planId', issues, 'Plan ID');
  if (!plan.name.trim()) issue(issues, 'missing-plan-name', 'plan.name', 'Plan name is required.');
  if (plan.target.provider !== 'sap') {
    issue(issues, 'unsupported-target-provider', 'plan.target.provider', 'Stage 1 supports SAP targets only.');
  }
  if (!plan.target.profileRef.trim()) {
    issue(issues, 'missing-profile-reference', 'plan.target.profileRef', 'A credential-profile reference is required.');
  }
  if (/^https?:\/\//i.test(plan.target.profileRef)) {
    issue(issues, 'target-url-in-profile-reference', 'plan.target.profileRef', 'Use a profile reference, not a target URL.');
  }
  if (plan.evidence.canonical !== true) {
    issue(issues, 'non-canonical-evidence', 'plan.evidence.canonical', 'Execution plans must use canonical evidence.');
  }

  if (plan.kind === 'regressionPack') {
    if (!Array.isArray(plan.members) || plan.members.length === 0) {
      issue(issues, 'missing-pack-members', 'plan.members', 'A Regression Pack requires at least one member.');
    } else {
      const memberIds = new Set<string>();
      plan.members.forEach((member, index) => {
        const memberPath = `plan.members[${index}]`;
        validateId(member.memberId, `${memberPath}.memberId`, issues, 'Pack member ID');
        if (memberIds.has(member.memberId)) {
          issue(issues, 'duplicate-member-id', `${memberPath}.memberId`, `Duplicate Pack member ID "${member.memberId}".`);
        }
        memberIds.add(member.memberId);
        if (!member.name.trim()) issue(issues, 'missing-member-name', `${memberPath}.name`, 'Pack member name is required.');
        validateExecutable(member.executable, `${memberPath}.executable`, issues);
      });
    }
    if (plan.sequential !== true) {
      issue(issues, 'parallel-pack-not-supported', 'plan.sequential', 'Stage 1 Regression Packs must execute sequentially.');
    }
  } else {
    validateExecutable(plan, 'plan', issues);
  }

  inspectSecretValues(plan, 'plan', issues);
  return issues;
}

function normalizeJson(value: unknown, path: string): JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError(`${path} contains a non-finite number.`);
    return value;
  }
  if (Array.isArray(value)) return value.map((entry, index) => normalizeJson(entry, `${path}[${index}]`));
  if (typeof value === 'object') {
    const normalized: Record<string, JsonValue> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const entry = (value as Record<string, unknown>)[key];
      if (entry === undefined) continue;
      normalized[key] = normalizeJson(entry, `${path}.${key}`);
    }
    return normalized;
  }
  throw new TypeError(`${path} contains a non-JSON value.`);
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(normalizeJson(value, 'value'));
}

function hashJson(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}

export function createExecutionPlanSnapshot(
  plan: ExecutionPlan,
  dataInputs: ExecutionDataSnapshotInput[],
  options: { executionId?: string; createdAt?: string } = {}
): ExecutionPlanSnapshot {
  const issues = validateExecutionPlan(plan);
  const expectedBindingIds = collectDataBindingIds(plan);
  const expected = new Set(expectedBindingIds);
  const supplied = new Set<string>();

  dataInputs.forEach((input, index) => {
    if (supplied.has(input.bindingId)) {
      issue(issues, 'duplicate-data-snapshot', `dataInputs[${index}].bindingId`, `Duplicate data snapshot "${input.bindingId}".`);
    }
    supplied.add(input.bindingId);
    if (!expected.has(input.bindingId)) {
      issue(issues, 'unknown-data-snapshot', `dataInputs[${index}].bindingId`, `No plan binding matches "${input.bindingId}".`);
    }
    inspectSecretValues(input.records, `dataInputs[${index}].records`, issues);
  });
  for (const bindingId of expected) {
    if (!supplied.has(bindingId)) {
      issue(issues, 'missing-data-snapshot', 'dataInputs', `Data snapshot "${bindingId}" is required.`);
    }
  }
  if (issues.length > 0) throw new ExecutionPlanValidationError(issues);

  const planClone = normalizeJson(plan, 'plan') as unknown as ExecutionPlan;
  const data: ExecutionDataSnapshot[] = dataInputs
    .map((input) => {
      const records = normalizeJson(input.records, `data.${input.bindingId}`) as JsonValue[];
      return {
        bindingId: input.bindingId,
        recordCount: records.length,
        contentHash: hashJson(records),
        records,
      };
    })
    .sort((left, right) => left.bindingId.localeCompare(right.bindingId));
  const planHash = hashJson(planClone);
  const createdAt = options.createdAt ?? new Date().toISOString();
  if (Number.isNaN(Date.parse(createdAt))) throw new TypeError('Snapshot createdAt must be an ISO-compatible date.');

  const snapshot: ExecutionPlanSnapshot = {
    schemaVersion: EXECUTION_SNAPSHOT_SCHEMA_VERSION,
    executionId: options.executionId ?? randomUUID(),
    createdAt,
    planHash,
    snapshotHash: hashJson({
      planHash,
      data: data.map(({ bindingId, contentHash, recordCount }) => ({ bindingId, contentHash, recordCount })),
    }),
    plan: planClone,
    data,
  };
  return deepFreeze(snapshot);
}

export function describeBinding(binding: InputBinding): string {
  switch (binding.source) {
    case 'literal':
      return 'Literal value';
    case 'processData':
      return `process.${binding.bindingId}.${binding.path}`;
    case 'stageOutput':
      return `stages.${binding.stageId}.outputs.${binding.output}`;
    case 'systemContext':
      return `system.${binding.key}`;
  }
}

export function sensitivityOfInput(input: TestContractInput | undefined): DataSensitivity {
  return input?.sensitivity ?? 'business';
}
