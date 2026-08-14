import { Module } from '../module';
import { waitForControl, readControlValue, captureControlEvidence, waitForTableCell, readTableCellValue } from '../controlAccess';

// sap.m.Table (responsive table) cells carry data-sap-ui-column (not -colid like a grid
// table), and rows carry aria-rowindex — the same convention every other responsive-table
// reader in this codebase uses (ReceiveOpenLineItem, SelectStorageLocation, FillTableCell,
// ClickTableCell). Most tables a "read the captured value back" step targets (a delivery
// log's own Deliveries table, a due-list) are this type, not the grid-table default the
// underlying fillTableCell/readTableCellValue helpers otherwise assume.
const RESPONSIVE_TABLE_STYLE = { columnAttr: 'data-sap-ui-column', rowIndexAttr: 'aria-rowindex' };

/**
 * Reads a captured control's current text/value and stores it into runState — for
 * confirmation values that update a field in place on the same page (e.g. a Material
 * Document number appearing in a delivery's own "Goods Issue" status area) rather than
 * via a save-button-triggered title change (SaveAndCaptureDocumentNumber) or a separate
 * confirmation dialog (CaptureDocumentNumberFromSuccessDialog). Neither of those fit when
 * the triggering click itself has no stable id to capture (e.g. a "Post GI" button whose
 * id regenerates every page load) — that click is driven by ClickByText instead, and this
 * module only handles reading the result afterward.
 */
export const CaptureControlValue: Module = {
  name: 'CaptureControlValue',
  describe: {
    label: 'Capture Control Value',
    category: 'Built-In Modules',
    description:
      "Reads a control's current value and stores it into runState — for a confirmation value that updates in " +
      'place on the same page, rather than appearing in a dialog or a document title.',
    params: [
      { key: 'field', label: 'Field (object repository name)', required: true, objectKind: ['readable'] },
      { key: 'captureAs', label: 'Capture as (runState key)', required: true, literalOnly: true },
      { key: 'label', label: 'Evidence label', required: false },
      { key: 'timeoutMs', label: 'Timeout (ms)', required: false, placeholder: '15000', type: 'number', advanced: true, default: '15000' },
      { key: 'rowIndex', label: 'Row index (only if field is a table column)', required: false, placeholder: 'default: 0', type: 'number', advanced: true, default: '0' },
      { key: 'gridTable', label: 'Grid table (sap.ui.table.Table) instead of responsive', required: false, placeholder: 'false', type: 'boolean', advanced: true, default: 'false' },
      {
        key: 'retryWhilePrefix',
        label: 'Re-read while value starts with this prefix (e.g. "TMP")',
        required: false,
        placeholder: 'e.g. TMP — for a value that starts as a placeholder before the real one appears',
      },
      {
        key: 'allowEmpty',
        label: 'Allow an empty captured value',
        required: false,
        placeholder: 'false — fails the step if the value is blank, since that almost always means the action that should have populated it silently failed (e.g. an error dialog blocked it)', type: 'boolean', advanced: true, default: 'false' },
    ],
    narrate: ({ params, runState }) => {
      const value = runState[params.captureAs];
      const label = params.label ?? params.field;
      return value ? `Captured ${label} = ${value}` : `Captured ${label}`;
    },
  },
  async execute({ adapter, objectRepository, appId, params, runState, evidenceDir }) {
    const timeoutMs = Number(params.timeoutMs ?? '15000');
    const control = objectRepository.get(appId, params.field);
    let value: string;
    if (control.tableId) {
      const rowIndex = Number(params.rowIndex ?? '0');
      const style = params.gridTable === 'true' ? undefined : RESPONSIVE_TABLE_STYLE;
      await waitForTableCell(adapter, objectRepository, appId, params.field, rowIndex, style, timeoutMs);
      value = await readTableCellValue(adapter, objectRepository, appId, params.field, rowIndex, style);
    } else {
      await waitForControl(adapter, objectRepository, appId, params.field, timeoutMs);
      value = await readControlValue(adapter, objectRepository, appId, params.field);

      // Some documents (e.g. a billing document right after "Save") briefly show a
      // placeholder value ("TMP0000689") before the server assigns the real one and the
      // UI repaints — a fixed Wait before this step is a guess that can lose the race
      // under slower response times. Re-reading here polls past that exact gap instead
      // of hoping the preceding wait was long enough.
      if (params.retryWhilePrefix) {
        const deadline = Date.now() + timeoutMs;
        while (value.startsWith(params.retryWhilePrefix) && Date.now() < deadline) {
          await new Promise((resolve) => setTimeout(resolve, 500));
          value = await readControlValue(adapter, objectRepository, appId, params.field);
        }
      }

      await captureControlEvidence(adapter, objectRepository, appId, params.field, value, { evidenceDir, runState });
    }

    // An empty capture here has always meant the SAME thing in practice: the action that
    // was supposed to populate this field (a "Post GI"/"Post" click, say) silently didn't
    // complete — most often because it triggered an error dialog (e.g. a stock deficit)
    // that nothing in the test case checked for. Without this, that failure reads as a
    // clean "passed" with a blank captured value, which is worse than a loud failure: it
    // looks like nothing went wrong. params.allowEmpty opts out for the rare case where
    // blank really is a legitimate outcome.
    if (!value.trim() && params.allowEmpty !== 'true') {
      throw new Error(
        `CaptureControlValue: "${params.field}" resolved to an empty value — the action expected to populate it may not have completed ` +
          `(e.g. an error dialog may have blocked it). Set allowEmpty: "true" if a blank value is actually expected here.`
      );
    }

    runState[params.captureAs] = value;
  },
};
