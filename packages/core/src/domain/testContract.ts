export const TEST_CONTRACT_VERSION = 1 as const;

export type TestValueType = 'string' | 'number' | 'boolean' | 'date' | 'object' | 'collection';
export type DataSensitivity = 'public' | 'business' | 'personal' | 'secret';

export interface TestContractInput {
  name: string;
  type: TestValueType;
  required: boolean;
  /** Placeholder key used by the existing Test JSON when it differs from the business-facing name. */
  runtimeKey?: string;
  description?: string;
  example?: string;
  sensitivity?: DataSensitivity;
}

export interface TestContractOutput {
  name: string;
  type: TestValueType;
  /** runState key populated by the producing module; defaults to name. */
  runtimeKey?: string;
  description?: string;
  producedByStep?: string;
  sensitivity?: DataSensitivity;
}

export interface TestContract {
  version: typeof TEST_CONTRACT_VERSION;
  inputs: TestContractInput[];
  outputs: TestContractOutput[];
}

export interface ContractValidationIssue {
  code: string;
  path: string;
  message: string;
}

const CONTRACT_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_]*$/;
const VALUE_TYPES = new Set<TestValueType>(['string', 'number', 'boolean', 'date', 'object', 'collection']);
const SENSITIVITIES = new Set<DataSensitivity>(['public', 'business', 'personal', 'secret']);

export function validateTestContract(contract: TestContract, path = 'contract'): ContractValidationIssue[] {
  const issues: ContractValidationIssue[] = [];

  if (contract.version !== TEST_CONTRACT_VERSION) {
    issues.push({
      code: 'unsupported-contract-version',
      path: `${path}.version`,
      message: `Test contract version must be ${TEST_CONTRACT_VERSION}.`,
    });
  }
  if (!Array.isArray(contract.inputs)) {
    issues.push({ code: 'invalid-contract-inputs', path: `${path}.inputs`, message: 'Inputs must be an array.' });
  }
  if (!Array.isArray(contract.outputs)) {
    issues.push({ code: 'invalid-contract-outputs', path: `${path}.outputs`, message: 'Outputs must be an array.' });
  }
  if (!Array.isArray(contract.inputs) || !Array.isArray(contract.outputs)) return issues;

  const validateItems = (
    items: Array<TestContractInput | TestContractOutput>,
    kind: 'inputs' | 'outputs'
  ) => {
    const names = new Set<string>();
    items.forEach((item, index) => {
      const itemPath = `${path}.${kind}[${index}]`;
      if (!CONTRACT_NAME_PATTERN.test(item.name)) {
        issues.push({
          code: 'invalid-contract-name',
          path: `${itemPath}.name`,
          message: 'Contract names must start with a letter and contain only letters, numbers, and underscores.',
        });
      }
      if (names.has(item.name)) {
        issues.push({
          code: 'duplicate-contract-name',
          path: `${itemPath}.name`,
          message: `Duplicate ${kind === 'inputs' ? 'input' : 'output'} name "${item.name}".`,
        });
      }
      names.add(item.name);
      if (!VALUE_TYPES.has(item.type)) {
        issues.push({
          code: 'invalid-contract-type',
          path: `${itemPath}.type`,
          message: `Unsupported contract type "${String(item.type)}".`,
        });
      }
      if (item.sensitivity !== undefined && !SENSITIVITIES.has(item.sensitivity)) {
        issues.push({
          code: 'invalid-contract-sensitivity',
          path: `${itemPath}.sensitivity`,
          message: `Unsupported sensitivity "${String(item.sensitivity)}".`,
        });
      }
      if (item.runtimeKey !== undefined && !CONTRACT_NAME_PATTERN.test(item.runtimeKey)) {
        issues.push({
          code: 'invalid-contract-runtime-key',
          path: `${itemPath}.runtimeKey`,
          message: 'Runtime keys must start with a letter and contain only letters, numbers, and underscores.',
        });
      }
    });
  };

  validateItems(contract.inputs, 'inputs');
  validateItems(contract.outputs, 'outputs');
  return issues;
}
