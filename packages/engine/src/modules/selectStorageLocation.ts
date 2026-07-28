import { Module } from '../module';
import { clickTableCell } from '../controlAccess';

const RESPONSIVE_TABLE_STYLE = { columnAttr: 'data-sap-ui-column', rowIndexAttr: 'aria-rowindex' };

/**
 * Storage Location is a value-help-only field (readonly, no free-text entry) —
 * clicking the cell opens a "Select Storage Location" dialog whose list items
 * have runtime-generated ids, so we open it via the normal table-cell click and
 * then pick the option by its stable visible label. Applies the same label to
 * every line item (runState.lineItemCount, set by AddLineItem) rather than
 * assuming a single line — one storage location per PO is a reasonable
 * default and keeps the data schema simple.
 */
export const SelectStorageLocation: Module = {
  name: 'SelectStorageLocation',
  describe: {
    label: 'Select Storage Location',
    category: 'Procurement',
    description: 'Picks a storage location (value-help-only field) for every line item, by its visible label.',
    params: [{ key: 'storageLocationLabel', label: 'Storage location label', required: true, placeholder: 'Std. storage 1' }],
    narrate: ({ params }) => `Selected storage location "${params.storageLocationLabel}" for line item(s)`,
  },
  async execute({ adapter, objectRepository, appId, params, runState }) {
    const lineItemCount = Number(runState[params.lineItemCountKey ?? 'lineItemCount'] ?? '1');
    for (let i = 0; i < lineItemCount; i++) {
      await clickTableCell(adapter, objectRepository, appId, 'StorageLocationColumn', i, RESPONSIVE_TABLE_STYLE);
      await adapter.clickByText(params.storageLocationLabel);
    }
  },
};
