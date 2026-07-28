import { Module } from '../module';

const DEFAULT_SERVICE_PATH = '/sap/opu/odata/sap/MM_PUR_PO_MAINT_V2_SRV';

interface DraftRow {
  PurchaseOrder: string;
  DraftUUID: string;
}

interface ODataV2Response<T> {
  d?: { results?: T[] };
}

/**
 * Deletes every abandoned (never-saved) draft purchase order — debris left
 * behind by test runs that failed or were interrupted before a real save.
 * Only targets drafts (IsActiveEntity=false), via the standard OData
 * draft-delete operation (the same thing "Discard Draft" does in the UI). An
 * already-Ordered PO is a real business document and is never touched here —
 * there's no header-level Delete for one even in the UI.
 */
export const CleanupAbandonedDrafts: Module = {
  name: 'CleanupAbandonedDrafts',
  describe: {
    label: 'Cleanup Abandoned Drafts',
    category: 'Procurement',
    description: 'Deletes every never-saved draft purchase order left behind by failed/interrupted runs. Never touches a real Ordered document.',
    params: [
      { key: 'url', label: 'Tenant URL', required: true },
      { key: 'servicePath', label: 'OData service path', required: false },
    ],
    narrate: ({ runState }) => `Deleted ${runState.deletedDraftCount ?? 0} abandoned draft PO(s)`,
  },
  async execute({ adapter, params, runState }) {
    const servicePath = params.servicePath ?? DEFAULT_SERVICE_PATH;
    const baseUrl = params.url.replace(/\/$/, '');

    const listUrl = `${baseUrl}${servicePath}/C_PurchaseOrderTP?$filter=IsActiveEntity eq false&$format=json`;
    const response = (await adapter.apiGet(listUrl)) as ODataV2Response<DraftRow>;
    const drafts = response?.d?.results ?? [];

    let deleted = 0;
    for (const draft of drafts) {
      const key = `PurchaseOrder='${draft.PurchaseOrder}',DraftUUID=guid'${draft.DraftUUID}',IsActiveEntity=false`;
      const deleteUrl = `${baseUrl}${servicePath}/C_PurchaseOrderTP(${key})`;
      await adapter.apiDelete(deleteUrl);
      deleted++;
    }

    runState[params.deletedCountKey ?? 'deletedDraftCount'] = deleted;
  },
};
