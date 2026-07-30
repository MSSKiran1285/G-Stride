import type { TestContract } from './testContract';

export interface ModuleCall {
  module: string;
  /** Overrides the test case's default appId for this step — needed when a test case spans multiple apps/screens (e.g. Create PO, then Post Goods Receipt). */
  appId?: string;
  params: Record<string, string>;
  /** Optional visual-authoring metadata. Params remain the executable source of truth so legacy JSON and CLI execution stay compatible. */
  valueBindings?: Record<string, TestStepValueBinding>;
}

export type TestApplication = 'SAP' | 'Salesforce' | 'Oracle' | 'ServiceNow';
export type TestLifecycle = 'draft' | 'published';
export type TestSystemContextKey = 'sap.url' | 'sap.urlBase' | 'sap.username' | 'sap.password' | 'runtime.today';

export type TestStepValueBinding =
  | { source: 'literal' }
  | { source: 'dataset'; key: string }
  | { source: 'systemContext'; key: TestSystemContextKey }
  | { source: 'priorOutput'; output: string };

export type TransactionResource =
  | 'purchaseOrderDraft'
  | 'purchaseOrder'
  | 'materialDocument'
  | 'supplierInvoice'
  | 'salesOrder'
  | 'outboundDelivery'
  | 'billingDocument';

export interface TestTransactionPolicy {
  /** Business objects this Test can create or leave behind. */
  creates?: TransactionResource[];
  /** Failed transactions remain unchanged so that evidence and system state can be reviewed. */
  failureDisposition?: 'retain-for-review';
  /** A human or service owner must be attached to every transactional run. */
  ownershipRequired?: boolean;
}

export interface TestCase {
  name: string;
  steps: ModuleCall[];
  version?: 1;
  lifecycle?: TestLifecycle;
  application?: TestApplication;
  /** Declares transactional side effects for authoritative preflight. */
  transaction?: TestTransactionPolicy;
  /** Optional typed composition contract used by Execution Plan preflight.
   * Existing tests without one remain valid through the legacy-inference path. */
  contract?: TestContract;
  /** Hand-authored training/audit content, rendered by writeAuditEvidencePdf when present —
   * one sentence on what this stage accomplishes and why it's needed next. */
  objective?: string;
  /** What must already be true before this stage can run (e.g. a prior document must exist). */
  preconditions?: string;
  /** "After this section you can..." bullets for a training-doc reader. */
  learningObjectives?: string[];
  /** Realistic pitfalls a new user might hit at this stage and how to recover — guidance, not
   * failures actually observed during the run. */
  commonErrorsAndTips?: string[];
}
