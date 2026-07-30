'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ObjectRepository } = require('../packages/core/dist');
const { ModuleRegistry } = require('../packages/engine/dist');

function repository() {
  const repo = new ObjectRepository(':memory:');
  for (const [name, controlId, controlType] of [
    ['SaveButton', 'save', 'sap.m.Button'],
    ['PoNumberDisplay', 'title', 'sap.m.Title'],
  ]) {
    repo.upsert({
      appId: 'createPurchaseOrder',
      name,
      controlId,
      bindingPath: null,
      controlType,
      tableId: null,
      label: null,
      parentControlId: null,
    });
  }
  return repo;
}

function adapter({ titles, dialogTexts = [], visibleText = null }) {
  let titleIndex = 0;
  const actions = [];
  return {
    actions,
    waitFor: async () => ({}),
    performAction: async (locator, action) => {
      actions.push({ locator, action });
      return {};
    },
    readValue: async () => ({
      value: titles[Math.min(titleIndex++, titles.length - 1)],
    }),
    readDialogText: async () => dialogTexts,
    findVisibleText: async () => visibleText,
  };
}

async function execute(fakeAdapter) {
  const repo = repository();
  const runState = {};
  try {
    await new ModuleRegistry().get('AssertDocumentCreationBlocked').execute({
      adapter: fakeAdapter,
      objectRepository: repo,
      appId: 'createPurchaseOrder',
      params: {
        placeholderTitle: 'New Purchase Order',
        expectedMessages: 'At least one item|Document contains no items|Document is incomplete',
        timeoutMs: '500',
      },
      runState,
    });
    return runState;
  } finally {
    repo.close();
  }
}

test('negative transaction passes only when title stays unsaved and SAP validation is present', async () => {
  const fakeAdapter = adapter({
    titles: ['New Purchase Order', 'New Purchase Order'],
    dialogTexts: ['Messages', 'Other Messages', 'Document contains no items'],
  });
  const state = await execute(fakeAdapter);

  assert.equal(fakeAdapter.actions.length, 1);
  assert.equal(fakeAdapter.actions[0].locator.controlId, 'save');
  assert.match(state.negativeAssertionStatus, /Document contains no items/);
  assert.equal(state.transactionFailureDisposition, 'retain-for-review');
});

test('negative transaction fails and stops when SAP unexpectedly assigns a document', async () => {
  const fakeAdapter = adapter({
    titles: ['New Purchase Order', 'Purchase Order 4500099999'],
    dialogTexts: [],
  });

  await assert.rejects(() => execute(fakeAdapter), /assigned or navigated to document title/);
  assert.equal(fakeAdapter.actions.length, 1);
});

test('negative transaction does not treat an unchanged title without validation as a pass', async () => {
  const fakeAdapter = adapter({
    titles: ['New Purchase Order'],
    dialogTexts: ['Connection interrupted'],
  });

  await assert.rejects(() => execute(fakeAdapter), /did not display an expected business-validation message/);
  assert.equal(fakeAdapter.actions.length, 1);
});
