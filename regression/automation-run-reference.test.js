'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ModuleRegistry } = require('../packages/engine/dist');

test('automation run reference is short, unique, owner-linked, and retains failed state for review', async () => {
  const module = new ModuleRegistry().get('CreateAutomationRunReference');
  const execute = async () => {
    const runState = {};
    await module.execute({
      adapter: {},
      objectRepository: {},
      appId: 'synthetic',
      params: { prefix: 'Q4H-P2P', owner: 'kiran', maxLength: '16' },
      runState,
    });
    return runState;
  };

  const first = await execute();
  const second = await execute();
  assert.match(first.automationReference, /^Q4HP2P\d{6}[A-F0-9]{4}$/);
  assert.ok(first.automationReference.length <= 16);
  assert.notEqual(first.automationReference, second.automationReference);
  assert.equal(first.automationOwner, 'kiran');
  assert.equal(first.transactionFailureDisposition, 'retain-for-review');
});
