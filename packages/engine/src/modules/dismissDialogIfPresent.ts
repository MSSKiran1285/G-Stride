import { Module } from '../module';

/**
 * Clicks a button by its visible text if it appears within a short timeout —
 * for dialogs that only sometimes show up (e.g. "Invoice Draft Exists" only
 * appears if a prior unfinished draft exists). Unlike other modules, finding
 * nothing here is success, not failure.
 */
export const DismissDialogIfPresent: Module = {
  name: 'DismissDialogIfPresent',
  describe: {
    label: 'Dismiss Dialog If Present',
    category: 'Built-In Modules',
    description: 'Clicks a button by visible text if a dialog happens to appear — finding nothing is success, not failure.',
    params: [
      { key: 'buttonText', label: 'Button text', required: true, placeholder: 'OK' },
      { key: 'timeoutMs', label: 'Timeout (ms)', required: false, placeholder: '8000' },
    ],
    narrate: ({ params }) => `Dismissed "${params.buttonText}" dialog if present`,
  },
  async execute({ adapter, params }) {
    const timeoutMs = Number(params.timeoutMs ?? '8000');
    try {
      await adapter.clickByText(params.buttonText, timeoutMs);
    } catch {
      // Not present within the timeout — nothing to dismiss.
    }
  },
};
