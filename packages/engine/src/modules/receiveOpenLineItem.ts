import { Module } from '../module';
import { waitForTableCell, readTableCellValue, fillTableCell } from '../controlAccess';

// sap.m.Table (responsive table) cells carry data-sap-ui-column (not -colid like a grid
// table). rowIndex below is a plain 0-based logical row index — fioriAdapter's
// locateTableCell is solely responsible for translating that into the actual
// aria-rowindex attribute value (1-based, header counted as row 1, so logical row 0
// becomes aria-rowindex 2) whenever rowIndexAttr is 'aria-rowindex'. Passing an
// already-offset value here would get offset a second time.
const RESPONSIVE_TABLE_STYLE = { columnAttr: 'data-sap-ui-column', rowIndexAttr: 'aria-rowindex' };

/**
 * Receives every open line item in the Post Goods Receipt app — the number of
 * lines comes from runState.lineItemCount (set by AddLineItem), so this loops
 * over however many the PO actually has rather than assuming one. For each
 * line it reads the "Open Quantity" cell and copies that into "Delivered
 * Quantity", UNLESS params.deliveredQuantity supplies a ";"-delimited
 * override list — a non-empty entry at that line's index receives only that
 * (smaller) quantity instead of the full open amount, leaving the PO open
 * for the remainder (partial goods receipt). The row's selection checkbox is
 * disabled until a quantity is entered and then auto-enables/auto-checks
 * itself — clicking it manually risks unchecking an already-checked row, so
 * this only fills the quantity and leaves selection to the app's own
 * behavior.
 */
export const ReceiveOpenLineItem: Module = {
  name: 'ReceiveOpenLineItem',
  describe: {
    label: 'Receive Open Line Item(s)',
    category: 'Procurement',
    description:
      'Receives every open PO line in full by default. Supply ";"-separated quantities to receive less than the open amount (partial receipt, PO stays open).',
    params: [{ key: 'deliveredQuantity', label: 'Delivered quantity override(s)', required: false, placeholder: 'leave blank to receive in full' }],
    narrate: ({ params, runState }) => {
      const value = runState[params.receivedQuantityKey ?? 'receivedQuantity'];
      return value ? `Received line item(s) — quantity ${value}` : 'Received open line item(s)';
    },
  },
  async execute({ adapter, objectRepository, appId, params, runState, evidenceDir }) {
    const lineItemCount = Number(runState[params.lineItemCountKey ?? 'lineItemCount'] ?? '1');
    const overrides = params.deliveredQuantity ? params.deliveredQuantity.split(';').map((s) => s.trim()) : [];

    const received: string[] = [];
    for (let i = 0; i < lineItemCount; i++) {
      await waitForTableCell(adapter, objectRepository, appId, 'OpenQuantityColumn', i, RESPONSIVE_TABLE_STYLE);
      const openQuantityText = await readTableCellValue(adapter, objectRepository, appId, 'OpenQuantityColumn', i, RESPONSIVE_TABLE_STYLE);
      // The ObjectNumber cell renders "10.000 PC" (number + unit) as one string — the
      // Delivered Quantity input is numeric-only, so strip the unit before filling it.
      const openQuantity = openQuantityText.trim().split(/\s+/)[0];
      const deliverQuantity = overrides[i] || openQuantity;

      await fillTableCell(
        adapter,
        objectRepository,
        appId,
        'DeliveredQuantityColumn',
        i,
        deliverQuantity,
        RESPONSIVE_TABLE_STYLE,
        { evidenceDir, runState }
      );
      received.push(deliverQuantity);
    }

    runState[params.receivedQuantityKey ?? 'receivedQuantity'] = received.join(';');
  },
};
