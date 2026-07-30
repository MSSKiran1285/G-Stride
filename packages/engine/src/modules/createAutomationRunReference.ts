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
      { key: 'captureAs', label: 'Reference capture key', required: false, placeholder: 'automationReference' },
      { key: 'ownerCaptureAs', label: 'Owner capture key', required: false, placeholder: 'automationOwner' },
      { key: 'maxLength', label: 'Maximum reference length', required: false, placeholder: '16' },
    ],
    narrate: ({ params, runState }) =>
      `Created automation reference ${String(runState[params.captureAs || 'automationReference'] ?? '')} for ${params.owner}`,
  },
  async execute({ params, runState }) {
    const owner = params.owner?.trim();
    if (!owner) throw new Error('CreateAutomationRunReference requires a non-empty owner.');

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
