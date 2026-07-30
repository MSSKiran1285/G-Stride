'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { ObjectRepository, validateExecutionPlan } = require('../packages/core/dist');
const {
  ModuleRegistry,
  executeExecutionPlan,
  inferLegacyTestContract,
  translateLegacyBatch,
  translateLegacyChain,
  translateLegacySuite,
} = require('../packages/engine/dist');

const HASH = 'a'.repeat(64);

class FakeAdapter {
  constructor(closed) {
    this.closed = closed;
  }
  async open() {}
  async navigate() {}
  async waitForPageSettled() {}
  async openAppFromCatalog() {}
  async clickByText() {}
  async findVisibleText() { return null; }
  async readDialogText() { return []; }
  async waitFor() { return {}; }
  async performAction() { return {}; }
  async readValue() { return { value: '' }; }
  async apiGet() { return {}; }
  async apiDelete() {}
  async callControlMethod() {}
  async selectAllInTable() {}
  async selectTableRow() {}
  async captureFieldEvidence() {}
  async screenshot() {}
  async close() { this.closed.count++; }
}

const modules = [
  {
    name: 'Produce',
    async execute({ params, runState }) {
      runState[params.key] = params.value;
    },
  },
  {
    name: 'Require',
    async execute({ params }) {
      if (params.actual !== params.expected) {
        throw new Error(`Expected ${params.expected}, received ${params.actual}`);
      }
    },
  },
  {
    name: 'FailWhen',
    async execute({ params }) {
      if (params.actual === params.value) throw new Error(`Rejected ${params.value}`);
    },
  },
];

function asset(assetId, file, name, appId, contract) {
  return {
    assetId,
    file,
    name,
    appId,
    contentHash: HASH,
    contractMode: 'declared',
    contract,
  };
}

function base(plan) {
  return {
    schemaVersion: 1,
    planId: 'test-plan',
    name: 'Orchestration test',
    target: { provider: 'sap', profileRef: 'default' },
    evidence: { enabled: true, canonical: true },
    ...plan,
  };
}

async function execute(plan, tests, dataByBinding, options = {}) {
  const scratch = mkdtempSync(path.join(tmpdir(), 'qa4-orchestrator-'));
  const repository = new ObjectRepository(path.join(scratch, 'objects.db'));
  const closed = { count: 0 };
  const events = [];
  let cancellationRequested = false;
  try {
    const result = await executeExecutionPlan(plan, {
      objectRepository: repository,
      registry: new ModuleRegistry(modules),
      loadTest: (snapshot) => tests[snapshot.file],
      loadData: (_binding, bindingId) => {
        const data = dataByBinding[bindingId] ?? [];
        if (data instanceof Error) throw data;
        return data;
      },
      createAdapter: () => new FakeAdapter(closed),
      artifactsFor: () => ({ screenshotDir: scratch }),
      systemContext: {
        'sap.url': 'https://example.invalid',
        'sap.urlBase': 'https://example.invalid',
        'sap.username': 'user',
        'sap.password': 'secret',
        'runtime.today': '07/28/2026',
      },
      onEvent: (event) => {
        events.push(event);
        if (options.cancelAfterFirstIteration && event.type === 'iteration-completed') {
          cancellationRequested = true;
        }
      },
      isCancellationRequested: () => cancellationRequested,
    });
    return { result, events, closed: closed.count };
  } finally {
    repository.close();
    rmSync(scratch, { recursive: true, force: true });
  }
}

test('Business Process runs every transaction in isolation and maps stage outputs explicitly', async () => {
  const create = {
    name: 'Create',
    contract: {
      version: 1,
      inputs: [{ name: 'order', type: 'string', required: true }],
      outputs: [{ name: 'document', type: 'string', runtimeKey: 'documentNumber' }],
    },
    steps: [{ module: 'Produce', params: { key: 'documentNumber', value: '${order}' } }],
  };
  const use = {
    name: 'Use',
    contract: {
      version: 1,
      inputs: [{ name: 'document', type: 'string', required: true }],
      outputs: [],
    },
    steps: [{ module: 'Require', params: { actual: '${document}', expected: '${document}' } }],
  };
  const plan = base({
    kind: 'businessProcess',
    stages: [
      {
        stageId: 'create',
        test: asset('create', 'create.json', 'Create', 'app', create.contract),
        inputBindings: { order: { source: 'processData', bindingId: 'orders', path: 'order' } },
      },
      {
        stageId: 'use',
        test: asset('use', 'use.json', 'Use', 'app', use.contract),
        inputBindings: { document: { source: 'stageOutput', stageId: 'create', output: 'document' } },
      },
    ],
    dataBindings: [{
      bindingId: 'orders',
      scope: 'process',
      source: { kind: 'file', format: 'json', files: ['orders.json'] },
    }],
    iterationPolicy: {
      session: 'fresh-per-iteration',
      onIterationFailure: 'stop-execution',
      sequential: true,
    },
  });

  const { result, closed } = await execute(
    plan,
    { 'create.json': create, 'use.json': use },
    { orders: [{ order: '100' }, { order: '200' }] }
  );

  assert.equal(result.status, 'passed');
  assert.equal(result.members[0].iterations.length, 2);
  assert.deepEqual(
    result.members[0].iterations.map((iteration) => iteration.stageOutputs.create.document),
    ['100', '200']
  );
  assert.equal(closed, 2, 'fresh-per-iteration must create and close an isolated adapter for each transaction');
});

test('runtime applies the same filter-before-limit selection used by preflight', async () => {
  const selected = {
    name: 'Select transaction',
    contract: {
      version: 1,
      inputs: [{ name: 'order', type: 'string', required: true }],
      outputs: [{ name: 'selectedOrder', type: 'string', runtimeKey: 'selectedOrder' }],
    },
    steps: [{ module: 'Produce', params: { key: 'selectedOrder', value: '${order}' } }],
  };
  const plan = base({
    kind: 'singleTest',
    testExecution: {
      test: asset('selected', 'selected.json', selected.name, 'app', selected.contract),
      inputBindings: { order: { source: 'processData', bindingId: 'orders', path: 'order' } },
    },
    dataBindings: [{
      bindingId: 'orders',
      scope: 'test',
      source: { kind: 'file', format: 'json', files: ['orders.json'] },
      selection: {
        filter: { path: 'region', operator: 'equals', value: 'EU' },
        maxRecords: 1,
      },
    }],
    iterationPolicy: {
      session: 'fresh-per-iteration',
      onIterationFailure: 'stop-execution',
      sequential: true,
    },
  });

  const { result } = await execute(
    plan,
    { 'selected.json': selected },
    {
      orders: [
        { order: '100', region: 'US' },
        { order: '200', region: 'EU' },
        { order: '300', region: 'EU' },
      ],
    }
  );
  assert.equal(result.status, 'passed');
  assert.equal(result.members[0].plannedIterations, 1);
  assert.equal(result.members[0].iterations[0].stageOutputs.selected.selectedOrder, '200');
});

test('Business Process stops later transaction iterations after a failed iteration by default', async () => {
  const check = {
    name: 'Check',
    contract: {
      version: 1,
      inputs: [{ name: 'order', type: 'string', required: true }],
      outputs: [],
    },
    steps: [{ module: 'FailWhen', params: { actual: '${order}', value: 'bad' } }],
  };
  const plan = base({
    kind: 'businessProcess',
    stages: [{
      stageId: 'check',
      test: asset('check', 'check.json', 'Check', 'app', check.contract),
      inputBindings: { order: { source: 'processData', bindingId: 'orders', path: 'order' } },
    }],
    dataBindings: [{
      bindingId: 'orders',
      scope: 'process',
      source: { kind: 'file', format: 'json', files: ['orders.json'] },
    }],
    iterationPolicy: {
      session: 'fresh-per-iteration',
      onIterationFailure: 'stop-execution',
      sequential: true,
    },
  });

  const { result } = await execute(
    plan,
    { 'check.json': check },
    { orders: [{ order: 'bad' }, { order: 'not-run' }] }
  );
  assert.equal(result.status, 'failed');
  assert.equal(result.members[0].plannedIterations, 2);
  assert.equal(result.members[0].iterations.length, 1);
});

test('Business Process stops at the failed stage and retains earlier captured values for review', async () => {
  const create = {
    name: 'Create document',
    contract: {
      version: 1,
      inputs: [],
      outputs: [{ name: 'document', type: 'string', runtimeKey: 'documentNumber' }],
    },
    steps: [{ module: 'Produce', params: { key: 'documentNumber', value: '4500001234' } }],
  };
  const fail = {
    name: 'Fail after creation',
    contract: { version: 1, inputs: [], outputs: [] },
    steps: [{ module: 'FailWhen', params: { actual: 'failed', value: 'failed' } }],
  };
  const forbidden = {
    name: 'Must not execute',
    contract: {
      version: 1,
      inputs: [],
      outputs: [{ name: 'forbidden', type: 'string', runtimeKey: 'forbidden' }],
    },
    steps: [{ module: 'Produce', params: { key: 'forbidden', value: 'executed' } }],
  };
  const plan = base({
    kind: 'businessProcess',
    stages: [
      { stageId: 'create', test: asset('create', 'create.json', create.name, 'app', create.contract), inputBindings: {} },
      { stageId: 'fail', test: asset('fail', 'fail.json', fail.name, 'app', fail.contract), inputBindings: {} },
      { stageId: 'forbidden', test: asset('forbidden', 'forbidden.json', forbidden.name, 'app', forbidden.contract), inputBindings: {} },
    ],
    dataBindings: [],
    iterationPolicy: {
      session: 'fresh-per-iteration',
      onIterationFailure: 'stop-execution',
      sequential: true,
    },
  });

  const { result, events } = await execute(
    plan,
    { 'create.json': create, 'fail.json': fail, 'forbidden.json': forbidden },
    {}
  );

  const iteration = result.members[0].iterations[0];
  assert.equal(result.status, 'failed');
  assert.equal(iteration.result.stages.length, 2);
  assert.equal(iteration.result.capturedValues.documentNumber, '4500001234');
  assert.equal(iteration.result.capturedValues.forbidden, undefined);
  assert.equal(events.some((event) => event.type === 'stage-progress' && event.stageId === 'forbidden'), false);
});

test('cooperative cancellation finishes the active transaction and starts no later iteration', async () => {
  const work = {
    name: 'Work',
    contract: {
      version: 1,
      inputs: [{ name: 'order', type: 'string', required: true }],
      outputs: [],
    },
    steps: [{ module: 'Require', params: { actual: '${order}', expected: '${order}' } }],
  };
  const plan = base({
    kind: 'singleTest',
    testExecution: {
      test: asset('work', 'work.json', 'Work', 'app', work.contract),
      inputBindings: { order: { source: 'processData', bindingId: 'orders', path: 'order' } },
    },
    dataBindings: [{
      bindingId: 'orders',
      scope: 'test',
      source: { kind: 'file', format: 'json', files: ['orders.json'] },
    }],
    iterationPolicy: {
      session: 'fresh-per-iteration',
      onIterationFailure: 'continue-next-iteration',
      sequential: true,
    },
  });
  const { result, events } = await execute(
    plan,
    { 'work.json': work },
    { orders: [{ order: '100' }, { order: '200' }, { order: '300' }] },
    { cancelAfterFirstIteration: true }
  );
  assert.equal(result.status, 'cancelled');
  assert.equal(result.members[0].status, 'cancelled');
  assert.equal(result.members[0].iterations.length, 1);
  assert.equal(events.filter((event) => event.type === 'iteration-started').length, 1);
});

test('Regression Pack isolates members and continues after a failed member', async () => {
  const pass = { name: 'Pass', steps: [{ module: 'Require', params: { actual: 'yes', expected: 'yes' } }] };
  const fail = { name: 'Fail', steps: [{ module: 'FailWhen', params: { actual: 'bad', value: 'bad' } }] };
  const contract = { version: 1, inputs: [], outputs: [] };
  const single = (test, file, id) => ({
    kind: 'singleTest',
    testExecution: { test: asset(id, file, test.name, 'app', contract), inputBindings: {} },
    dataBindings: [],
    iterationPolicy: {
      session: 'fresh-per-iteration',
      onIterationFailure: 'continue-next-iteration',
      sequential: true,
    },
  });
  const plan = base({
    kind: 'regressionPack',
    members: [
      { memberId: 'failure', name: 'Failure', executable: single(fail, 'fail.json', 'fail') },
      { memberId: 'success', name: 'Success', executable: single(pass, 'pass.json', 'pass') },
    ],
    onMemberFailure: 'continue-next-member',
    sequential: true,
  });

  const { result } = await execute(plan, { 'fail.json': fail, 'pass.json': pass }, {});
  assert.equal(result.status, 'failed');
  assert.equal(result.members.length, 2);
  assert.deepEqual(result.members.map((member) => member.status), ['failed', 'passed']);
});

test('Regression Pack continues when one member dataset cannot be loaded', async () => {
  const check = {
    name: 'Check',
    contract: {
      version: 1,
      inputs: [{ name: 'order', type: 'string', required: true }],
      outputs: [],
    },
    steps: [{ module: 'Require', params: { actual: '${order}', expected: '${order}' } }],
  };
  const executable = (file) => ({
    kind: 'singleTest',
    testExecution: {
      test: asset(file.replace('.json', ''), file, 'Check', 'app', check.contract),
      inputBindings: { order: { source: 'processData', bindingId: 'orders', path: 'order' } },
    },
    dataBindings: [{
      bindingId: 'orders',
      scope: 'test',
      source: { kind: 'file', format: 'json', files: [`${file}.data.json`] },
    }],
    iterationPolicy: {
      session: 'fresh-per-iteration',
      onIterationFailure: 'continue-next-iteration',
      sequential: true,
    },
  });
  const plan = base({
    kind: 'regressionPack',
    members: [
      { memberId: 'broken', name: 'Broken data', executable: executable('broken.json') },
      { memberId: 'valid', name: 'Valid data', executable: executable('valid.json') },
    ],
    onMemberFailure: 'continue-next-member',
    sequential: true,
  });

  const { result } = await execute(
    plan,
    { 'broken.json': check, 'valid.json': check },
    {
      'broken:orders': new Error('Malformed data'),
      'valid:orders': [{ order: '100' }],
    }
  );
  assert.equal(result.status, 'failed');
  assert.equal(result.members.length, 2);
  assert.match(result.members[0].error, /Malformed data/);
  assert.equal(result.members[1].status, 'passed');
});

test('Legacy compatibility translators preserve Chain, Suite, and multi-row Batch semantics', () => {
  const producer = {
    name: 'Create order',
    steps: [
      { module: 'Login', params: { url: '${url}', username: '${username}', password: '${password}' } },
      { module: 'CaptureDocumentNumberFromSuccessDialog', params: { captureAs: 'orderNumber' } },
    ],
  };
  const consumer = {
    name: 'Use order',
    steps: [{ module: 'NavigateToApp', params: { url: '${urlBase}/orders/${orderNumber}?date=${today}' } }],
  };
  const tests = [
    { file: 'producer.json', testCase: producer, appId: 'app' },
    { file: 'consumer.json', testCase: consumer, appId: 'app' },
  ];
  const options = { name: 'Legacy', profileRef: 'default', dataFile: 'records.csv' };

  const inferred = inferLegacyTestContract(producer);
  assert.deepEqual(inferred.inputs.map((input) => input.name), ['url', 'username', 'password']);
  assert.deepEqual(inferred.outputs.map((output) => output.name), ['orderNumber']);

  const chain = translateLegacyChain(tests, options);
  assert.equal(chain.kind, 'businessProcess');
  assert.deepEqual(chain.stages[1].inputBindings.orderNumber, {
    source: 'stageOutput',
    stageId: chain.stages[0].stageId,
    output: 'orderNumber',
  });
  assert.deepEqual(validateExecutionPlan(chain), []);

  const suite = translateLegacySuite(tests, options);
  assert.equal(suite.kind, 'regressionPack');
  assert.equal(suite.members.length, 2);
  assert.deepEqual(validateExecutionPlan(suite), []);

  const batch = translateLegacyBatch(
    [{ name: 'O2C', appId: 'app', tests, dataFile: 'orders.json' }],
    { name: 'Batch', profileRef: 'default' }
  );
  assert.equal(batch.kind, 'regressionPack');
  assert.equal(batch.members[0].executable.kind, 'businessProcess');
  assert.deepEqual(validateExecutionPlan(batch), []);
});

test('Translated Batch executes every Group data row instead of only the first', async () => {
  const run = {
    name: 'Run group',
    contract: {
      version: 1,
      inputs: [{ name: 'order', type: 'string', required: true }],
      outputs: [],
    },
    steps: [{ module: 'Require', params: { actual: '${order}', expected: '${order}' } }],
  };
  const plan = translateLegacyBatch(
    [{
      name: 'O2C',
      appId: 'app',
      tests: [{ file: 'run.json', testCase: run, appId: 'app' }],
      dataFile: 'orders.json',
    }],
    { name: 'Batch', profileRef: 'default' }
  );
  const bindingId = `${plan.members[0].memberId}:data`;
  const { result } = await execute(plan, { 'run.json': run }, {
    [bindingId]: [{ order: '100' }, { order: '200' }, { order: '300' }],
  });
  assert.equal(result.members[0].plannedIterations, 3);
  assert.equal(result.members[0].iterations.length, 3);
  assert.ok(result.members[0].iterations.every((iteration) => iteration.status === 'passed'));
});
