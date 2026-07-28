import { Module } from '../module';
import { waitForControl, fillControl } from '../controlAccess';

/** Searches the Post Goods Receipt app for a purchase order by number. */
export const SearchGoodsReceiptByPO: Module = {
  name: 'SearchGoodsReceiptByPO',
  describe: {
    label: 'Search Goods Receipt by PO',
    category: 'Procurement',
    description: 'Searches the Post Goods Receipt app for a purchase order by number.',
    params: [{ key: 'purchaseOrder', label: 'Purchase Order number', required: true, placeholder: '${poNumber}' }],
    narrate: ({ params }) => `Searched Goods Receipt for PO ${params.purchaseOrder}`,
  },
  async execute({ adapter, objectRepository, appId, params, runState, evidenceDir }) {
    await waitForControl(adapter, objectRepository, appId, 'POSearchField');
    await fillControl(adapter, objectRepository, appId, 'POSearchField', params.purchaseOrder, { pressKey: 'Enter' }, { evidenceDir, runState });
  },
};
