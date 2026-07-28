export interface StepResult {
  module: string;
  /** Plain-English, run-specific account of what this step actually did — see Module.describe.narrate. */
  description: string;
  status: 'passed' | 'failed';
  startedAt: string;
  durationMs: number;
  error?: string;
  screenshotPath?: string;
}

export interface FieldEvidence {
  label: string;
  screenshotPath: string;
}

/**
 * One chained test case's own slice of a run — a Chain of N test case files (or a
 * Group's N stages) produces N of these, in order. Reports use this to group step
 * tables and screenshot evidence under the right chapter, instead of one flat list
 * for the whole run with no indication of which test case each step/screenshot
 * actually belongs to.
 */
export interface RunStage {
  testCaseName: string;
  status: 'passed' | 'failed';
  startedAt: string;
  durationMs: number;
  steps: StepResult[];
  /** A screenshot of this stage's final page state — only present when this stage passed. */
  finalScreenshotPath?: string;
  /** Annotated "field = value" screenshots captured specifically during this stage, in order. */
  fieldEvidence: FieldEvidence[];
  /** Copied straight from the TestCase that produced this stage (see TestCase) — hand-authored
   * training/audit content, or absent if nobody has written it for this flow yet. */
  objective?: string;
  preconditions?: string;
  learningObjectives?: string[];
  commonErrorsAndTips?: string[];
}

export interface RunResult {
  testCaseName: string;
  status: 'passed' | 'failed';
  startedAt: string;
  durationMs: number;
  steps: StepResult[];
  capturedValues: Record<string, unknown>;
  /** Annotated "field = value" screenshots captured during the run, in order — see ModuleContext.evidenceDir. */
  fieldEvidence: FieldEvidence[];
  /** A screenshot of the final page state on a passed run — proof of completion for audit
   * purposes even when no step failed and no field fills were captioned. Unset on a failed
   * run, since the failing step's own screenshot already covers that moment. */
  finalScreenshotPath?: string;
  /** Per-chained-test-case breakdown, in order — exactly one entry for a single (non-chained)
   * test case run. steps/fieldEvidence/finalScreenshotPath above are these stages flattened
   * into one combined view, kept for existing consumers that don't care about stage boundaries. */
  stages: RunStage[];
}
