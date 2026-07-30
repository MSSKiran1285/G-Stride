'use strict';

const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const { api, assertServerReachable } = require('../lib/apiClient');

before(assertServerReachable);

test('GET /api/testcases lists known fixtures', async () => {
  const { status, body } = await api.get('/api/testcases');
  assert.equal(status, 200);
  assert.ok(Array.isArray(body));
  assert.ok(body.includes('create-po.json'), 'expected create-po.json in the list');
});

test('GET /api/testcases/library returns filterable business metadata for legacy Tests', async () => {
  const { status, body } = await api.get('/api/testcases/library');
  assert.equal(status, 200);
  const createPo = body.find((item) => item.file === 'create-po.json');
  assert.deepEqual(createPo, {
    file: 'create-po.json',
    name: 'Create Purchase Order - Happy Path',
    application: 'SAP',
    processArea: '',
    status: 'ready',
    stepCount: 1,
  });
});

test('POST /api/testcases/:file creates metadata without overwriting an existing Test', async () => {
  const create = await api.post('/api/testcases/library-created.json', {
    testCase: { name: 'Library Created', application: 'Salesforce', steps: [] },
    processArea: 'Lead to Cash',
  });
  assert.equal(create.status, 201);

  const library = await api.get('/api/testcases/library');
  assert.deepEqual(library.body.find((item) => item.file === 'library-created.json'), {
    file: 'library-created.json',
    name: 'Library Created',
    application: 'Salesforce',
    processArea: 'Lead to Cash',
    status: 'draft',
    stepCount: 0,
  });

  const conflict = await api.post('/api/testcases/library-created.json', {
    testCase: { name: 'Do not overwrite', application: 'SAP', steps: [] },
    processArea: '',
  });
  assert.equal(conflict.status, 409);
  const persisted = await api.get('/api/testcases/library-created.json');
  assert.equal(persisted.body.name, 'Library Created');
});

test('Test publishing validation reports unresolved values, objects and output collisions', async () => {
  const candidate = {
    version: 1,
    lifecycle: 'published',
    application: 'SAP',
    name: 'Invalid typed Test',
    contract: {
      version: 1,
      inputs: [{ name: 'declaredInput', type: 'string', required: true, sensitivity: 'business' }],
      outputs: [
        { name: 'firstOutput', type: 'string', runtimeKey: 'collision' },
        { name: 'secondOutput', type: 'string', runtimeKey: 'collision' },
      ],
    },
    steps: [
      { module: 'ClickButton', appId: 'missingApp', params: { control: 'MissingButton' } },
      { module: 'NavigateToApp', params: { url: '' } },
      { module: 'Wait', params: { ms: '${missingInput}' }, valueBindings: { ms: { source: 'dataset', key: 'missingInput' } } },
    ],
  };
  const validation = await api.post('/api/testcases/validate', { testCase: candidate });
  assert.equal(validation.status, 200);
  assert.equal(validation.body.valid, false);
  const codes = new Set(validation.body.issues.map((issue) => issue.code));
  assert.ok(codes.has('missing-object-reference'));
  assert.ok(codes.has('missing-required-parameter'));
  assert.ok(codes.has('unresolved-step-value'));
  assert.ok(codes.has('unresolved-dataset-binding'));
  assert.ok(codes.has('duplicate-contract-runtime-key'));
  assert.ok(codes.has('unproduced-contract-output'));

  const publish = await api.put('/api/testcases/invalid-published.json', candidate);
  assert.equal(publish.status, 400);
});

test('published typed Test round-trips visual value bindings without changing executable params', async () => {
  const candidate = {
    version: 1,
    lifecycle: 'published',
    application: 'SAP',
    name: 'Typed Wait Test',
    contract: {
      version: 1,
      inputs: [{ name: 'delayMs', type: 'number', required: true, runtimeKey: 'delayMs', sensitivity: 'public' }],
      outputs: [],
    },
    steps: [{
      module: 'Wait',
      params: { ms: '${delayMs}' },
      valueBindings: { ms: { source: 'dataset', key: 'delayMs' } },
    }],
  };
  const validation = await api.post('/api/testcases/validate', { testCase: candidate });
  assert.equal(validation.status, 200);
  assert.deepEqual(validation.body, { valid: true, issues: [] });

  const put = await api.put('/api/testcases/typed-published.json', candidate);
  assert.equal(put.status, 200);
  const get = await api.get('/api/testcases/typed-published.json');
  assert.deepEqual(get.body, candidate);
  assert.equal(get.body.steps[0].params.ms, '${delayMs}');

  const library = await api.get('/api/testcases/library');
  assert.equal(library.body.find((item) => item.file === 'typed-published.json').status, 'published');
});

test('system-context and prior-output bindings validate against their canonical placeholders', async () => {
  const candidate = {
    version: 1,
    lifecycle: 'published',
    application: 'SAP',
    name: 'System and prior output binding',
    contract: {
      version: 1,
      inputs: [],
      outputs: [{ name: 'documentNumber', type: 'string', runtimeKey: 'documentNumber', sensitivity: 'business' }],
    },
    steps: [
      {
        module: 'Login',
        params: { url: '${url}', username: '${username}', password: '${password}' },
        valueBindings: {
          url: { source: 'systemContext', key: 'sap.url' },
          username: { source: 'systemContext', key: 'sap.username' },
          password: { source: 'systemContext', key: 'sap.password' },
        },
      },
      {
        module: 'CaptureDocumentNumberFromSuccessDialog',
        params: { captureAs: 'documentNumber' },
      },
      {
        module: 'Wait',
        params: { ms: '${documentNumber}' },
        valueBindings: { ms: { source: 'priorOutput', output: 'documentNumber' } },
      },
    ],
  };
  const validation = await api.post('/api/testcases/validate', { testCase: candidate });
  assert.equal(validation.status, 200);
  assert.deepEqual(validation.body, { valid: true, issues: [] });
});

test('GET /api/testcases/:file returns the parsed test case', async () => {
  const { status, body } = await api.get('/api/testcases/create-po.json');
  assert.equal(status, 200);
  assert.equal(body.name, 'Create Purchase Order - Happy Path');
  assert.ok(Array.isArray(body.steps) && body.steps.length > 0);
});

test('GET /api/testcases/:file 404s for an unknown file', async () => {
  const { status } = await api.get('/api/testcases/does-not-exist.json');
  assert.equal(status, 404);
});

test('PUT /api/testcases/:file rejects a non-.json file name', async () => {
  const { status } = await api.put('/api/testcases/evil', { name: 'x', steps: [] });
  assert.equal(status, 400);
});

test('PUT /api/testcases/:file rejects a body missing required fields', async () => {
  const { status } = await api.put('/api/testcases/regression-sample.json', { name: 'no steps field' });
  assert.equal(status, 400);
});

test('PUT then GET /api/testcases/:file round-trips (Compose positive)', async () => {
  const testCase = {
    name: 'Regression Sample',
    steps: [{ module: 'Wait', params: { ms: '100' } }],
  };
  const put = await api.put('/api/testcases/regression-sample.json', testCase);
  assert.equal(put.status, 200);
  assert.deepEqual(put.body, { ok: true });

  const get = await api.get('/api/testcases/regression-sample.json');
  assert.equal(get.status, 200);
  assert.deepEqual(get.body, testCase);

  const list = await api.get('/api/testcases');
  assert.ok(list.body.includes('regression-sample.json'));
});
