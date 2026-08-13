import { Module } from '../module';
import { fillControl, readTableCellValue } from '../controlAccess';
import { dismissInvoiceDialogs, closeMessagesPopoverIfOpen } from './dismissInvoiceDialogs';

/**
 * Reads every PO-referenced line item's amount (varies per PO — different
 * price/quantity combinations across data-driven runs, and a partial goods
 * receipt reduces what's open to invoice) and sums them into the header's
 * Gross Invoice Amount so the document balances. The number of assigned rows
 * comes from runState.lineItemCount (set by AddLineItem) — the Advanced
 * Selection dialog assigns one invoice item per open PO line in one shot, so
 * this loops the same count rather than assuming a single row. Must run
 * AFTER AssignPurchaseOrderItems, which is what actually binds real
 * line-item data into the Items table.
 */
export const MatchGrossAmountToPoReference: Module = {
  name: 'MatchGrossAmountToPoReference',
  describe: {
    label: 'Match Gross Amount to PO Reference',
    category: 'Procurement',
    description: "Sums every assigned invoice line's amount into the header's Gross Invoice Amount so the document balances.",
    params: [{ key: 'amountKey', label: 'Capture as (runState key)', required: false, placeholder: 'invoiceAmount', literalOnly: true }],
    narrate: ({ params, runState }) => {
      const value = runState[params.amountKey ?? 'invoiceAmount'];
      return value ? `Matched Gross Amount = ${value}` : 'Matched Gross Amount to PO reference';
    },
  },
  async execute({ adapter, objectRepository, appId, params, runState, evidenceDir }) {
    await dismissInvoiceDialogs(adapter, 3000);
    await closeMessagesPopoverIfOpen(adapter);

    const lineItemCount = Number(runState[params.lineItemCountKey ?? 'lineItemCount'] ?? '1');
    let total = 0;
    for (let rowIndex = 0; rowIndex < lineItemCount; rowIndex++) {
      const cellText = (await readTableCellValue(adapter, objectRepository, appId, 'POItemsAmountColumn', rowIndex)).trim();
      total += Number(cellText.replace(/,/g, ''));
    }
    const amount = total.toFixed(2);

    await closeMessagesPopoverIfOpen(adapter);
    await fillControl(adapter, objectRepository, appId, 'GrossAmountField', amount, undefined, { evidenceDir, runState });
    await dismissInvoiceDialogs(adapter);
    runState[params.amountKey ?? 'invoiceAmount'] = amount;
  },
};
