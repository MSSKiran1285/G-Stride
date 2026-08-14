import { Module } from '../module';
import { clickControl, waitForControl, readControlValue, captureControlEvidence } from '../controlAccess';

const POLL_INTERVAL_MS = 300;

/**
 * Saves a document (PO, Sales Order, etc.) and captures the resulting document
 * number into run state as evidence. The header title control is visible before
 * saving too (showing a placeholder like "New Purchase Order"), so a plain
 * visibility wait returns immediately — this polls until the backend has
 * actually assigned a number and the title text updates, rather than reading
 * it the instant the click resolves. The object repository entries this looks
 * up default to "SaveButton" and "PoNumberDisplay" (both reusable across apps,
 * looked up per-appId), but are now overridable via params — a Sales Order's
 * save button and title display are almost certainly different captured
 * objects than a Purchase Order's, even though the save-then-poll-then-capture
 * shape of the flow is identical.
 */
export const SaveAndCaptureDocumentNumber: Module = {
  name: 'SaveAndCaptureDocumentNumber',
  describe: {
    label: 'Save & Capture Document Number',
    category: 'Procurement',
    description: 'Saves the document and polls the header title until the real document number replaces the placeholder.',
    params: [
      { key: 'placeholderTitle', label: 'Placeholder title to wait past', required: true, placeholder: 'New Purchase Order' },
      { key: 'captureAs', label: 'Capture as (runState key)', required: false, placeholder: 'poNumber', literalOnly: true },
      { key: 'timeoutMs', label: 'Timeout (ms)', required: false, placeholder: '30000', type: 'number', advanced: true, default: '30000' },
      {
        key: 'saveButtonField',
        label: 'Save/Order button (object name)',
        required: false,
        placeholder: 'default: SaveButton',
        objectKind: ['clickable'],
      },
      {
        key: 'titleField',
        label: 'Title display (object name)',
        required: false,
        placeholder: 'default: PoNumberDisplay',
        objectKind: ['readable'],
      },
    ],
    narrate: ({ params, runState }) => {
      const value = runState[params.captureAs ?? 'poNumber'];
      return value ? `Saved and captured document number ${value}` : 'Saved the document';
    },
  },
  async execute({ adapter, objectRepository, appId, params, runState, evidenceDir }) {
    const timeoutMs = Number(params.timeoutMs ?? '30000');
    const placeholderTitle = params.placeholderTitle;
    const saveButtonField = params.saveButtonField || 'SaveButton';
    const titleField = params.titleField || 'PoNumberDisplay';

    await clickControl(adapter, objectRepository, appId, saveButtonField);
    await waitForControl(adapter, objectRepository, appId, titleField, timeoutMs);

    const deadline = Date.now() + timeoutMs;
    let documentNumber = await readControlValue(adapter, objectRepository, appId, titleField);
    while (documentNumber.includes(placeholderTitle) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      documentNumber = await readControlValue(adapter, objectRepository, appId, titleField);
    }
    if (documentNumber.includes(placeholderTitle)) {
      throw new Error(`Document number was not assigned within ${timeoutMs}ms — title still reads "${documentNumber}"`);
    }

    runState[params.captureAs ?? 'poNumber'] = documentNumber;
    await captureControlEvidence(adapter, objectRepository, appId, titleField, documentNumber, { evidenceDir, runState });
  },
};
