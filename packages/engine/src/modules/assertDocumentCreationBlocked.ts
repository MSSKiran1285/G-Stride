import { Module } from '../module';
import { clickControl, readControlValue, waitForControl } from '../controlAccess';

const DEFAULT_VALIDATION_MESSAGES = [
  'At least one item',
  'Enter at least one item',
  'No items exist',
  'Document contains no items',
  'Document is incomplete',
  'Purchase order is incomplete',
];

function expectedMessages(raw?: string): string[] {
  if (!raw?.trim()) return DEFAULT_VALIDATION_MESSAGES;
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.every((value) => typeof value === 'string')) {
      return parsed.map((value) => value.trim()).filter(Boolean);
    }
  } catch {
    // A pipe-separated value is easier to author in Compose than JSON.
  }
  return raw.split('|').map((value) => value.trim()).filter(Boolean);
}

/**
 * Attempts the document action and passes only when SAP both:
 *  1. leaves the title on its unsaved placeholder, and
 *  2. presents an expected business-validation message.
 *
 * A navigation/network failure therefore cannot be mistaken for a successful
 * negative test. If SAP unexpectedly creates a document, the changed title
 * fails the step and the execution stops immediately.
 */
export const AssertDocumentCreationBlocked: Module = {
  name: 'AssertDocumentCreationBlocked',
  describe: {
    label: 'Assert Document Creation Blocked',
    category: 'Validation',
    description:
      'Clicks the save/order action and verifies that SAP retained the unsaved title and displayed an expected validation message.',
    params: [
      {
        key: 'actionField',
        label: 'Save/Order button (object name)',
        required: false,
        placeholder: 'default: SaveButton',
        objectKind: ['clickable'],
      },
      {
        key: 'titleField',
        label: 'Document title (object name)',
        required: false,
        placeholder: 'default: PoNumberDisplay',
        objectKind: ['readable'],
      },
      {
        key: 'placeholderTitle',
        label: 'Unsaved title',
        required: true,
        placeholder: 'New Purchase Order',
      },
      {
        key: 'expectedMessages',
        label: 'Expected validation text (JSON array or | separated)',
        required: false,
        placeholder: 'At least one item|Document is incomplete',
      },
      {
        key: 'timeoutMs',
        label: 'Validation timeout (ms)',
        required: false,
        placeholder: '10000', type: 'number', advanced: true, default: '10000' },
      {
        key: 'captureAs',
        label: 'Capture as (runState key)',
        required: false,
        placeholder: 'negativeAssertionStatus',
      },
    ],
    narrate: ({ params, runState }) => {
      const result = runState[params.captureAs || 'negativeAssertionStatus'];
      return typeof result === 'string'
        ? `Verified document creation was blocked: ${result}`
        : 'Verified document creation was blocked';
    },
  },
  async execute({ adapter, objectRepository, appId, params, runState }) {
    const actionField = params.actionField || 'SaveButton';
    const titleField = params.titleField || 'PoNumberDisplay';
    const placeholderTitle = params.placeholderTitle;
    const timeoutMs = Number(params.timeoutMs || '10000');
    const messages = expectedMessages(params.expectedMessages);

    if (!placeholderTitle?.trim()) {
      throw new Error('AssertDocumentCreationBlocked requires a non-empty placeholderTitle.');
    }
    if (!Number.isFinite(timeoutMs) || timeoutMs < 500 || timeoutMs > 60000) {
      throw new Error('AssertDocumentCreationBlocked timeoutMs must be from 500 to 60000.');
    }
    if (messages.length === 0) {
      throw new Error('AssertDocumentCreationBlocked requires at least one expected validation message.');
    }

    await waitForControl(adapter, objectRepository, appId, titleField, timeoutMs);
    const before = await readControlValue(adapter, objectRepository, appId, titleField);
    if (!before.includes(placeholderTitle)) {
      throw new Error(
        `Negative assertion cannot start because "${titleField}" is already "${before}", not the unsaved title "${placeholderTitle}".`
      );
    }

    await clickControl(adapter, objectRepository, appId, actionField);

    const deadline = Date.now() + timeoutMs;
    let title = before;
    let dialogTexts: string[] = [];
    let matchedMessage: string | null = null;
    while (Date.now() < deadline) {
      title = await readControlValue(adapter, objectRepository, appId, titleField);
      if (!title.includes(placeholderTitle)) {
        throw new Error(
          `SAP assigned or navigated to document title "${title}" when creation was expected to be blocked. Execution stopped; do not continue or auto-reverse.`
        );
      }

      dialogTexts = await adapter.readDialogText();
      matchedMessage = messages.find((expected) =>
        dialogTexts.some((actual) => actual.toLocaleLowerCase().includes(expected.toLocaleLowerCase()))
      ) ?? null;
      if (!matchedMessage) {
        matchedMessage = await adapter.findVisibleText(messages, 300);
      }
      if (matchedMessage) break;
      await new Promise((resolve) => setTimeout(resolve, 300));
    }

    if (!matchedMessage) {
      throw new Error(
        `SAP left "${titleField}" unsaved but did not display an expected business-validation message. ` +
        `Observed dialog text: ${JSON.stringify(dialogTexts)}.`
      );
    }

    const captureKey = params.captureAs || 'negativeAssertionStatus';
    runState[captureKey] = `${placeholderTitle} retained; validation matched "${matchedMessage}"`;
    runState.transactionFailureDisposition = 'retain-for-review';
  },
};
