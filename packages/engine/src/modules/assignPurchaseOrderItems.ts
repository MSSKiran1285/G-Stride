import { Module } from '../module';
import { fillControl } from '../controlAccess';
import { dismissInvoiceDialogs, closeMessagesPopoverIfOpen } from './dismissInvoiceDialogs';

/**
 * Typing a PO number into the header's "Purchase Order / Scheduling Agreement"
 * field only attaches a reference token — it does NOT pull the PO's GR-received
 * line items into the Items table (confirmed by inspecting the table's live
 * data binding: it stays at length 0). The real mechanism is the "Advanced
 * Selection" dialog: search by Purchasing Document, then Assign the found
 * item(s) onto the invoice, which is what actually binds real line-item data
 * (amount, quantity, PO reference) into the Items table.
 */
export const AssignPurchaseOrderItems: Module = {
  name: 'AssignPurchaseOrderItems',
  describe: {
    label: 'Assign Purchase Order Items',
    category: 'Procurement',
    description: 'Drives the Advanced Selection dialog to search and assign a PO\'s GR-received line items onto the invoice.',
    params: [{ key: 'purchaseOrder', label: 'Purchase Order number', required: true, placeholder: '${poNumber}' }],
    narrate: ({ params }) => `Assigned PO ${params.purchaseOrder}'s open items to the invoice`,
  },
  async execute({ adapter, objectRepository, appId, params, runState, evidenceDir }) {
    const evidence = { evidenceDir, runState };
    await dismissInvoiceDialogs(adapter, 3000);
    await closeMessagesPopoverIfOpen(adapter);

    // The Advanced Selection dialog's search appears to key off the header's
    // own PO reference token — leaving it empty produced "No data available"
    // even for a PO with a genuinely open, GR-received item.
    await fillControl(adapter, objectRepository, appId, 'PurchaseOrderReferenceField', params.purchaseOrder, undefined, evidence);
    await adapter.waitForPageSettled();
    await new Promise((resolve) => setTimeout(resolve, 1500));
    await dismissInvoiceDialogs(adapter, 3000);
    await closeMessagesPopoverIfOpen(adapter);

    await adapter.clickByText('Advanced Selection', 8000);
    await adapter.waitForPageSettled();
    await new Promise((resolve) => setTimeout(resolve, 2000));

    await fillControl(adapter, objectRepository, appId, 'AdvancedSelectionPurchasingDocumentField', params.purchaseOrder, undefined, evidence);
    await adapter.clickByText('Go', 5000);
    // The search is a real backend OData round-trip with variable latency under
    // load — wait for it to actually finish (networkidle) rather than guessing a
    // fixed delay, which was observed to race the results grid and click Assign
    // before any row had rendered, silently assigning nothing.
    await adapter.waitForPageSettled();
    await new Promise((resolve) => setTimeout(resolve, 3000));

    await adapter.clickByText('Assign', 8000);
    await adapter.waitForPageSettled();
    await new Promise((resolve) => setTimeout(resolve, 2000));

    await dismissInvoiceDialogs(adapter, 3000);
    await closeMessagesPopoverIfOpen(adapter);
  },
};
