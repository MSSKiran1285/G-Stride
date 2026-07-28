import { Module } from '../module';

const DEFAULT_SERVICE_PATH = '/sap/opu/odata/sap/MM_PUR_PO_MAINT_V2_SRV';

interface ODataV2Response<T> {
  d?: { results?: T[] };
}

/**
 * Queries an existing, already-valid purchase order (header + item) via OData
 * rather than relying on hardcoded test data discovered by hand through the
 * UI — demonstrates API-based test data setup. Reuses the already-authenticated
 * browser session's cookies (see FioriPlaywrightAdapter.apiGet), so no separate
 * OAuth client needs to be provisioned to read data this way.
 *
 * Requires params.url (the tenant base URL) rather than resolving relative to
 * whatever page the browser currently happens to be on — right after Login,
 * the browser can still be mid-redirect back from the identity provider's
 * domain, so relative resolution isn't reliable here.
 */
export const QueryValidLineItemData: Module = {
  name: 'QueryValidLineItemData',
  describe: {
    label: 'Query Valid Line Item Data',
    category: 'Procurement',
    description: 'Sources a real, already-valid supplier/material/plant/quantity via OData instead of hand-picked test data.',
    params: [
      { key: 'url', label: 'Tenant URL', required: true },
      { key: 'servicePath', label: 'OData service path', required: false },
    ],
    narrate: ({ params, runState }) => {
      const supplier = runState[params.supplierKey ?? 'supplier'];
      const material = runState[params.materialKey ?? 'material'];
      return supplier || material
        ? `Queried valid line item data (Supplier ${supplier}, Material ${material})`
        : 'Queried valid line item data via OData';
    },
  },
  async execute({ adapter, params, runState }) {
    const servicePath = params.servicePath ?? DEFAULT_SERVICE_PATH;
    const baseUrl = params.url.replace(/\/$/, '');

    const headerUrl = `${baseUrl}${servicePath}/C_PurchaseOrderTP?$filter=IsActiveEntity eq true&$top=1&$format=json`;
    const header = (await adapter.apiGet(headerUrl)) as ODataV2Response<{ PurchaseOrder: string; Supplier: string }>;
    const headerItem = header?.d?.results?.[0];
    if (!headerItem) {
      throw new Error(`QueryValidLineItemData: no active purchase orders found via ${headerUrl}`);
    }

    const itemUrl =
      `${baseUrl}${servicePath}/C_PurchaseOrderItemTP?$filter=IsActiveEntity eq true and PurchaseOrder eq '${headerItem.PurchaseOrder}'` +
      `&$top=1&$format=json`;
    const itemResponse = (await adapter.apiGet(itemUrl)) as ODataV2Response<{
      ManufacturerMaterial: string;
      Plant: string;
      OrderQuantity: string;
    }>;
    const item = itemResponse?.d?.results?.[0];
    if (!item) {
      throw new Error(`QueryValidLineItemData: no items found for PO ${headerItem.PurchaseOrder} via ${itemUrl}`);
    }

    runState[params.supplierKey ?? 'supplier'] = headerItem.Supplier;
    runState[params.materialKey ?? 'material'] = item.ManufacturerMaterial;
    runState[params.plantKey ?? 'plant'] = item.Plant;
    runState[params.quantityKey ?? 'quantity'] = item.OrderQuantity;
  },
};
