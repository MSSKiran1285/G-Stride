import { Module } from '../module';

interface ODataV2Response<T> {
  d?: { results?: T[] };
}

/** "Supplier:supplier,Plant:plant" -> [["Supplier","supplier"],["Plant","plant"]]. Params only
 *  carry strings (see ModuleContext), so a field map has to be a delimited string rather than
 *  a nested object — same reasoning as AddLineItem's JSON-encoded "rows" param elsewhere in
 *  this package, just simple enough here not to need JSON escaping in a params text field. */
function parseFieldMap(raw: string): Array<[source: string, runStateKey: string]> {
  return raw
    .split(',')
    .map((pair) => pair.trim())
    .filter(Boolean)
    .map((pair) => {
      const [source, key] = pair.split(':').map((part) => part.trim());
      if (!source || !key) {
        throw new Error(`QueryReferenceDocument: fieldMap entry "${pair}" must be "SourceField:runStateKey"`);
      }
      return [source, key];
    });
}

/**
 * BL-047 Phase 2: the generalized form of QueryValidLineItemData (packages/engine/src/modules/
 * queryValidLineItemData.ts) — that module works, but only ever for Purchase Orders, with the
 * service path, entities and target fields all hardcoded. This module is the same OData V2
 * header(+optional item) lookup pattern, parameterized so it works for any business object with
 * an "active entity" OData service — Purchase Requisition, Production Order, Sales Order, or
 * whatever BL-047's reference-resolution stage needs next, without a new module per process.
 *
 * Reuses the already-authenticated browser session's cookies (adapter.apiGet) exactly like
 * QueryValidLineItemData does — no separate OAuth client needs provisioning to read data this way.
 */
export const QueryReferenceDocument: Module = {
  name: 'QueryReferenceDocument',
  describe: {
    label: 'Query Reference Document',
    category: 'Procurement',
    description: 'Sources real, already-valid master data from an existing business document via OData — the generalized form of Query Valid Line Item Data, usable for any process, not just Purchase Orders.',
    params: [
      { key: 'url', label: 'Tenant URL', required: true },
      { key: 'servicePath', label: 'OData service path', required: true },
      { key: 'headerEntity', label: 'Header entity set', required: true },
      { key: 'headerFilter', label: 'Header OData $filter (default: IsActiveEntity eq true)', required: false },
      { key: 'headerKeyField', label: 'Header key field (e.g. PurchaseRequisition)', required: true },
      { key: 'itemEntity', label: 'Item entity set (omit for a header-only lookup)', required: false },
      { key: 'itemKeyField', label: 'Item key field matching the header key (defaults to headerKeyField)', required: false },
      { key: 'fieldMap', label: 'Fields to extract: "SourceField:runStateKey" pairs, comma-separated', required: true },
    ],
    narrate: ({ params }) => `Queried a reference ${params.headerEntity ?? 'document'} via OData`,
  },
  async execute({ adapter, params, runState }) {
    const baseUrl = params.url.replace(/\/$/, '');
    const headerFilter = params.headerFilter ?? 'IsActiveEntity eq true';
    const fieldMap = parseFieldMap(params.fieldMap);

    const headerUrl = `${baseUrl}${params.servicePath}/${params.headerEntity}?$filter=${encodeURIComponent(headerFilter)}&$top=1&$format=json`;
    const header = (await adapter.apiGet(headerUrl)) as ODataV2Response<Record<string, string>>;
    const headerItem = header?.d?.results?.[0];
    if (!headerItem) {
      throw new Error(`QueryReferenceDocument: no active ${params.headerEntity} found via ${headerUrl}`);
    }

    let item: Record<string, string> | undefined;
    if (params.itemEntity) {
      const keyValue = headerItem[params.headerKeyField];
      const itemKeyField = params.itemKeyField ?? params.headerKeyField;
      const itemUrl =
        `${baseUrl}${params.servicePath}/${params.itemEntity}?$filter=${encodeURIComponent(`IsActiveEntity eq true and ${itemKeyField} eq '${keyValue}'`)}` +
        `&$top=1&$format=json`;
      const itemResponse = (await adapter.apiGet(itemUrl)) as ODataV2Response<Record<string, string>>;
      item = itemResponse?.d?.results?.[0];
      if (!item) {
        throw new Error(`QueryReferenceDocument: no ${params.itemEntity} found for ${itemKeyField} ${keyValue} via ${itemUrl}`);
      }
    }

    for (const [source, key] of fieldMap) {
      const value = item?.[source] ?? headerItem[source];
      if (value === undefined) {
        throw new Error(`QueryReferenceDocument: field "${source}" not present on the queried ${item ? params.itemEntity : params.headerEntity}`);
      }
      runState[key] = value;
    }
  },
};
