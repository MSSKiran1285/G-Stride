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

test('one reference per execution, not one per Test in a chain', async () => {
  // executeTestCaseChain shares a single runState across every stage. Once every transactional
  // Test carried its own CreateAutomationRunReference step (15 Aug 2026), unconditional
  // assignment meant a three-Test Process minted three references, each overwriting the last —
  // three unrelated identifiers for one run, in the evidence that exists to correlate it.
  const module = new ModuleRegistry().get('CreateAutomationRunReference');
  const params = { prefix: 'Q4HP2P', owner: 'kiran' };

  const runState = {};
  await module.execute({ params, runState });
  const fromLeadStage = runState.automationReference;
  assert.ok(fromLeadStage, 'the lead stage must create one');

  // Later stages run their own step and must leave the first one standing — including when a
  // later Test declares a different owner, which must not be able to rewrite accountability
  // partway through a run.
  await module.execute({ params, runState });
  await module.execute({ params: { ...params, prefix: 'OTHER', owner: 'someone-else' }, runState });

  assert.equal(runState.automationReference, fromLeadStage, 'the chain must share one reference');
  assert.equal(runState.automationOwner, 'kiran', 'the accountable owner must not be rewritten mid-run');
  assert.equal(runState.transactionFailureDisposition, 'retain-for-review', 'a later stage must not weaken the disposition');

  // A separate execution starts from a fresh runState and gets its own reference.
  const nextRun = {};
  await module.execute({ params, runState: nextRun });
  assert.notEqual(nextRun.automationReference, fromLeadStage, 'a new execution must not reuse the previous one');

  // A Test that captures under its own key is a genuinely different reference, not this one.
  const custom = { ...runState };
  await module.execute({ params: { ...params, captureAs: 'secondaryReference' }, runState: custom });
  assert.equal(custom.automationReference, fromLeadStage);
  assert.ok(custom.secondaryReference && custom.secondaryReference !== fromLeadStage);
});
