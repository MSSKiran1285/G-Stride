import { randomUUID } from 'node:crypto';
import { Module } from '../module';

function compactTimestamp(date: Date): string {
  return date.toISOString().slice(2, 10).replaceAll('-', '');
}

/**
 * Creates a short, unique correlation key before any transactional SAP step.
 * It does not modify SAP. The key links the run, evidence, and every document
 * number captured later in the same run.
 */
export const CreateAutomationRunReference: Module = {
  name: 'CreateAutomationRunReference',
  describe: {
    label: 'Create Automation Run Reference',
    category: 'Governance',
    description:
      'Creates a unique owner-linked correlation reference before a transactional run. Failed SAP documents are retained for compliance review.',
    params: [
      { key: 'prefix', label: 'Reference prefix', required: true, placeholder: 'Q4H' },
      { key: 'owner', label: 'Run owner', required: true },
      { key: 'captureAs', label: 'Reference capture key', required: false, placeholder: 'automationReference', literalOnly: true, advanced: true, default: 'automationReference' },
      { key: 'ownerCaptureAs', label: 'Owner capture key', required: false, placeholder: 'automationOwner', literalOnly: true, advanced: true, default: 'automationOwner' },
      { key: 'maxLength', label: 'Maximum reference length', required: false, placeholder: '16', type: 'number', advanced: true, default: '16' },
    ],
    narrate: ({ params, runState }) =>
      `Created automation reference ${String(runState[params.captureAs || 'automationReference'] ?? '')} for ${params.owner}`,
  },
  async execute({ params, runState }) {
    const owner = params.owner?.trim();
    if (!owner) throw new Error('CreateAutomationRunReference requires a non-empty owner.');

    /**
     * Reuse an existing reference rather than overwriting it.
     *
     * CAUTION — this guard does NOT currently deliver one reference per execution, and the
     * comment that used to sit here claimed it did. An external review challenged the claim on
     * 18 Aug 2026 and it does not survive contact with the engine.
     *
     * executeTestCaseChain declares `const runState = {}` at the top of each call, and
     * executionOrchestrator calls it ONCE PER STAGE with a single-element array. So every stage
     * of a Business Process starts with an empty runState, this guard never sees the previous
     * stage's value, and a three-stage process mints three unrelated references. Measured
     * directly against the built engine: Sales Order, Delivery and Billing produced
     * Q4HO2C2608187FA7, Q4HO2C260818AEF9 and Q4HO2C260818EF07.
     *
     * The guard is real, but only within ONE call — the legacy path that passes several Tests to
     * executeTestCaseChain together. On the orchestrator path, which is what the Studio runs, it
     * is inert.
     *
     * Values do hand forward between stages, but through a different mechanism entirely:
     * contract outputs into stageOutputs, then stageInputRow into the next stage's dataRow. A
     * reference that is meant to be per-execution has to travel that way, or be minted above the
     * stage loop. Tracked as BL-064; do not assume this guard covers it.
     */
    const referenceKey = params.captureAs || 'automationReference';
    const existing = runState[referenceKey];
    if (typeof existing === 'string' && existing.trim()) {
      // Still assert the disposition — a later stage must not be able to weaken it.
      runState.transactionFailureDisposition = 'retain-for-review';
      return;
    }

    const maxLength = Number(params.maxLength ?? '16');
    if (!Number.isInteger(maxLength) || maxLength < 12 || maxLength > 64) {
      throw new Error('CreateAutomationRunReference maxLength must be an integer from 12 to 64.');
    }

    const safePrefix = (params.prefix || 'Q4H').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6) || 'Q4H';
    const suffix = randomUUID().replaceAll('-', '').slice(0, 5).toUpperCase();
    const reference = `${safePrefix}${compactTimestamp(new Date())}${suffix}`.slice(0, maxLength);

    runState[params.captureAs || 'automationReference'] = reference;
    runState[params.ownerCaptureAs || 'automationOwner'] = owner;
    runState.transactionFailureDisposition = 'retain-for-review';
  },
};
