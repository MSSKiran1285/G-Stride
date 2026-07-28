export interface ModuleCall {
  module: string;
  /** Overrides the test case's default appId for this step — needed when a test case spans multiple apps/screens (e.g. Create PO, then Post Goods Receipt). */
  appId?: string;
  params: Record<string, string>;
}

export interface TestCase {
  name: string;
  steps: ModuleCall[];
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
