import { Module } from '../module';
import { FIELD_EVIDENCE_KEY } from '../executionEngine';

const DOCUMENT_NUMBER_PATTERN = /^\d{4,}(\/\d{4})?$/;
// Fallback for when the number isn't its own isolated text node (P2P's dialogs) but embedded in
// a full sentence instead — e.g. Manage Sales Orders' "Standard Order 333700 has been saved."
// Unanchored, so it matches a same-shaped number anywhere in the string.
const EMBEDDED_DOCUMENT_NUMBER_PATTERN = /\d{4,}(\/\d{4})?/;

/**
 * SAP posting actions (Post Goods Receipt, Post Supplier Invoice) confirm via
 * a generic "Success" dialog reading "1 document(s) created: <Doc Type>
 * <Number>" — the number itself is a separate control with no stable id
 * (runtime-generated per document), so it's parsed out of the dialog's own
 * text contents rather than looked up by id.
 *
 * Some Fiori Elements v4 apps (e.g. Manage Sales Orders) surface the same kind
 * of confirmation inside a "Warning" popover instead of a dedicated "Success"
 * one — bundling an unrelated non-blocking warning ("Document is incomplete")
 * together with the success message in the same popover — so the expected
 * title is configurable rather than hardcoded, defaulting to "Success" to
 * keep every existing test case (Post Goods Receipt, Post Supplier Invoice)
 * working unchanged.
 */
export const CaptureDocumentNumberFromSuccessDialog: Module = {
  name: 'CaptureDocumentNumberFromSuccessDialog',
  describe: {
    label: 'Capture Document Number from Success Dialog',
    category: 'Procurement',
    description: 'Parses a generated document number (e.g. Material Document, Supplier Invoice) out of the generic Success/Warning dialog and dismisses it.',
    params: [
      { key: 'captureAs', label: 'Capture as (runState key)', required: false, placeholder: 'materialDocumentNumber', literalOnly: true },
      { key: 'label', label: 'Evidence label', required: false, placeholder: 'Material Document Number' },
      { key: 'buttonText', label: 'Dismiss button text', required: false, placeholder: 'OK' },
      { key: 'timeoutMs', label: 'Timeout (ms)', required: false, placeholder: '15000', type: 'number', advanced: true, default: '15000' },
      { key: 'dialogTitles', label: 'Dialog title(s) to expect, ";"-separated', required: false, placeholder: 'Success', literalOnly: true },
    ],
    narrate: ({ params, runState }) => {
      const value = runState[params.captureAs ?? 'documentNumber'];
      return value ? `Captured ${params.label ?? 'document number'} = ${value}` : `Captured ${params.label ?? 'document number'}`;
    },
  },
  async execute({ adapter, params, runState, evidenceDir }) {
    const timeoutMs = Number(params.timeoutMs ?? '15000');
    const expectedTitles = (params.dialogTitles ?? 'Success').split(';').map((s) => s.trim()).filter(Boolean);
    const title = await adapter.findVisibleText(expectedTitles, timeoutMs);
    if (!title || !expectedTitles.includes(title)) {
      throw new Error(`Expected one of [${expectedTitles.join(', ')}] confirmation dialog within ${timeoutMs}ms but none appeared`);
    }

    const texts = await adapter.readDialogText();
    const documentNumber =
      texts.find((t) => DOCUMENT_NUMBER_PATTERN.test(t)) ??
      texts.map((t) => t.match(EMBEDDED_DOCUMENT_NUMBER_PATTERN)?.[0]).find((m): m is string => Boolean(m));
    if (!documentNumber) {
      throw new Error(`Success dialog appeared but no document number found among: ${JSON.stringify(texts)}`);
    }

    const label = params.label ?? 'Document Number';
    runState[params.captureAs ?? 'documentNumber'] = documentNumber;

    if (evidenceDir) {
      const fileName = `${Date.now()}-${label.replace(/[^a-z0-9]/gi, '_').slice(0, 60)}.png`;
      const screenshotPath = `${evidenceDir}/${fileName}`;
      await adapter.screenshot(screenshotPath);
      const log = (runState[FIELD_EVIDENCE_KEY] as { label: string; screenshotPath: string }[] | undefined) ?? [];
      log.push({ label: `${label} = ${documentNumber}`, screenshotPath });
      runState[FIELD_EVIDENCE_KEY] = log;
    }

    await adapter.clickByText(params.buttonText ?? 'OK', 5000).catch(() => undefined);
  },
};
