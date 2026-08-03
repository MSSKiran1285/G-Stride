'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ModuleRegistry } = require('../packages/engine/dist');

const QueryReferenceDocument = new ModuleRegistry().get('QueryReferenceDocument');

function mockAdapter(responsesByEntity) {
  return {
    async apiGet(url) {
      const entity = Object.keys(responsesByEntity).find((name) => url.includes(`/${name}?`));
      if (!entity) throw new Error(`mockAdapter: no canned response for ${url}`);
      return responsesByEntity[entity];
    },
  };
}

function baseParams(overrides) {
  return {
    url: 'https://tenant.example',
    servicePath: '/sap/opu/odata/sap/MM_PUR_REQ_MAINT_V2_SRV',
    headerEntity: 'C_PurchaseRequisitionTP',
    headerKeyField: 'PurchaseRequisition',
    fieldMap: 'Requisitioner:requisitioner',
    ...overrides,
  };
}

test('header-only lookup extracts mapped fields into runState without an item query', async () => {
  const adapter = mockAdapter({
    C_PurchaseRequisitionTP: { d: { results: [{ PurchaseRequisition: '10000123', Requisitioner: 'J.DOE' }] } },
  });
  const runState = {};
  await QueryReferenceDocument.execute({ adapter, params: baseParams(), runState, appId: 'test', objectRepository: null });
  assert.deepEqual(runState, { requisitioner: 'J.DOE' });
});

test('header+item lookup joins on the header key and extracts fields from both levels', async () => {
  const adapter = mockAdapter({
    C_PurchaseRequisitionTP: { d: { results: [{ PurchaseRequisition: '10000123', Requisitioner: 'J.DOE' }] } },
    C_PurchaseRequisitionItemTP: { d: { results: [{ Material: 'MAT-001', Plant: '1010', RequestedQuantity: '5' }] } },
  });
  const runState = {};
  await QueryReferenceDocument.execute({
    adapter,
    params: baseParams({
      itemEntity: 'C_PurchaseRequisitionItemTP',
      fieldMap: 'Requisitioner:requisitioner,Material:material,Plant:plant,RequestedQuantity:quantity',
    }),
    runState,
    appId: 'test',
    objectRepository: null,
  });
  assert.deepEqual(runState, {
    requisitioner: 'J.DOE',
    material: 'MAT-001',
    plant: '1010',
    quantity: '5',
  });
});

test('throws a clear error when no active header document is found', async () => {
  const adapter = mockAdapter({ C_PurchaseRequisitionTP: { d: { results: [] } } });
  await assert.rejects(
    () => QueryReferenceDocument.execute({ adapter, params: baseParams(), runState: {}, appId: 'test', objectRepository: null }),
    /no active C_PurchaseRequisitionTP found/
  );
});

test('throws a clear error when no matching item is found for the header key', async () => {
  const adapter = mockAdapter({
    C_PurchaseRequisitionTP: { d: { results: [{ PurchaseRequisition: '10000123' }] } },
    C_PurchaseRequisitionItemTP: { d: { results: [] } },
  });
  await assert.rejects(
    () =>
      QueryReferenceDocument.execute({
        adapter,
        params: baseParams({ itemEntity: 'C_PurchaseRequisitionItemTP', fieldMap: 'Material:material' }),
        runState: {},
        appId: 'test',
        objectRepository: null,
      }),
    /no C_PurchaseRequisitionItemTP found for PurchaseRequisition 10000123/
  );
});

test('throws a clear error for a malformed fieldMap entry', async () => {
  const adapter = mockAdapter({ C_PurchaseRequisitionTP: { d: { results: [{ PurchaseRequisition: '1' }] } } });
  await assert.rejects(
    () =>
      QueryReferenceDocument.execute({
        adapter,
        params: baseParams({ fieldMap: 'NotAPair' }),
        runState: {},
        appId: 'test',
        objectRepository: null,
      }),
    /fieldMap entry "NotAPair" must be "SourceField:runStateKey"/
  );
});

test('throws a clear error when a mapped field is absent from the queried result', async () => {
  const adapter = mockAdapter({ C_PurchaseRequisitionTP: { d: { results: [{ PurchaseRequisition: '1' }] } } });
  await assert.rejects(
    () =>
      QueryReferenceDocument.execute({
        adapter,
        params: baseParams({ fieldMap: 'NoSuchField:whatever' }),
        runState: {},
        appId: 'test',
        objectRepository: null,
      }),
    /field "NoSuchField" not present/
  );
});

test('an item-level field takes precedence over a header field of the same name', async () => {
  const adapter = mockAdapter({
    C_PurchaseRequisitionTP: { d: { results: [{ PurchaseRequisition: '1', Plant: 'HEADER-PLANT' }] } },
    C_PurchaseRequisitionItemTP: { d: { results: [{ Plant: 'ITEM-PLANT' }] } },
  });
  const runState = {};
  await QueryReferenceDocument.execute({
    adapter,
    params: baseParams({ itemEntity: 'C_PurchaseRequisitionItemTP', fieldMap: 'Plant:plant' }),
    runState,
    appId: 'test',
    objectRepository: null,
  });
  assert.equal(runState.plant, 'ITEM-PLANT');
});
