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

test('GET /api/testcases/:file/references reports every Object a Test\'s own steps use (BL-037 AC2 outgoing)', async () => {
  await api.put(`/api/objects/testUsageRegressionApp/RegressionRefButton`, {
    controlId: '__xmlview1--RegressionRefButton',
    controlType: 'sap.m.Button',
  });
  const testCase = {
    name: 'Regression Reference Source',
    steps: [{ module: 'ClickButton', appId: 'testUsageRegressionApp', params: { control: 'RegressionRefButton' } }],
  };
  await api.put('/api/testcases/regression-reference-source.json', testCase);

  const references = await api.get('/api/testcases/regression-reference-source.json/references');
  assert.equal(references.status, 200);
  assert.deepEqual(references.body, { objects: [{ appId: 'testUsageRegressionApp', name: 'RegressionRefButton' }] });
});

test('Test usage, dependency-aware rename and delete blocking across Processes and Packs (BL-037 AC2/AC3)', async () => {
  const testFile = 'regression-test-usage.json';
  await api.put(`/api/testcases/${testFile}`, {
    name: 'Regression Test Usage Source',
    steps: [{ module: 'Wait', params: { ms: '1' } }],
  });

  const emptyUsage = await api.get(`/api/testcases/${testFile}/usage`);
  assert.equal(emptyUsage.status, 200);
  assert.deepEqual(emptyUsage.body, { groups: [], packs: [] });

  const groupFile = 'regression-test-usage-group.json';
  await api.put(`/api/groups/${groupFile}`, {
    name: 'Regression Test Usage Group',
    appId: 'regressionTestUsageApp',
    testCaseFiles: [testFile],
  });

  const packFile = 'regression-test-usage-pack.json';
  await api.put(`/api/packs/${packFile}`, {
    version: 1,
    name: 'Regression Test Usage Pack',
    lifecycle: 'draft',
    members: [{
      id: 'direct-test-member',
      kind: 'test',
      file: testFile,
      sessionPolicy: 'fresh-per-iteration',
      iterationFailurePolicy: 'continue-next-iteration',
    }],
  });

  const usage = await api.get(`/api/testcases/${testFile}/usage`);
  assert.deepEqual(usage.body, { groups: [groupFile], packs: [packFile] });

  const blockedDelete = await api.delete(`/api/testcases/${testFile}`);
  assert.equal(blockedDelete.status, 409);
  assert.deepEqual(blockedDelete.body.usage, { groups: [groupFile], packs: [packFile] });

  const renamed = 'regression-test-usage-renamed.json';
  const rename = await api.put(`/api/testcases/${testFile}/rename`, { newName: renamed });
  assert.equal(rename.status, 200);
  assert.deepEqual(rename.body, { ok: true, updatedGroups: [groupFile], updatedPacks: [packFile] });

  const groupAfterRename = await api.get(`/api/groups/${groupFile}`);
  assert.deepEqual(groupAfterRename.body.testCaseFiles, [renamed]);
  const packAfterRename = await api.get(`/api/packs/${packFile}`);
  assert.equal(packAfterRename.body.members[0].file, renamed);

  const usageAfterRename = await api.get(`/api/testcases/${renamed}/usage`);
  assert.deepEqual(usageAfterRename.body, { groups: [groupFile], packs: [packFile] });

  const forcedDelete = await api.delete(`/api/testcases/${renamed}?force=true`);
  assert.equal(forcedDelete.status, 200);
  assert.deepEqual(forcedDelete.body.usage, { groups: [groupFile], packs: [packFile] });

  const goneAfterDelete = await api.get(`/api/testcases/${renamed}`);
  assert.equal(goneAfterDelete.status, 404);

  // Clean up the referencing Pack — this file runs after packs.test.js's own exact-list
  // assertion, but tidying up avoids leaking state into any later addition to that suite.
  await api.delete(`/api/packs/${packFile}`);
});

test('DELETE /api/testcases/:file removes an unreferenced Test outright', async () => {
  const testFile = 'regression-test-unreferenced.json';
  await api.put(`/api/testcases/${testFile}`, { name: 'Unreferenced', steps: [] });
  const del = await api.delete(`/api/testcases/${testFile}`);
  assert.equal(del.status, 200);
  assert.deepEqual(del.body, { ok: true, usage: { groups: [], packs: [] } });
  const get = await api.get(`/api/testcases/${testFile}`);
  assert.equal(get.status, 404);
});

test('PUT /api/testcases/:file/rename rejects a missing source or a name collision', async () => {
  const missing = await api.put('/api/testcases/does-not-exist.json/rename', { newName: 'whatever.json' });
  assert.equal(missing.status, 404);

  const sourceFile = 'regression-rename-collision-source.json';
  await api.put(`/api/testcases/${sourceFile}`, { name: 'Source', steps: [] });
  const collision = await api.put(`/api/testcases/${sourceFile}/rename`, { newName: 'create-po.json' });
  assert.equal(collision.status, 409);
});

test('publishing rejects a literal that is really an unbound dataset column', async () => {
  // The failure this exists for: on 16 Aug 2026 an observed authoring run saved
  // CreateAutomationRunReference with prefix/owner typed as plain text while the value source
  // was still Literal. Every other check passes it — a literal is by definition a valid literal
  // — so the step reads as filled in and puts the string "automationOwner" where the accountable
  // run owner belongs, all the way into signed evidence.
  const file = 'regression-literal-column.json';
  const candidate = {
    name: 'Literal column regression',
    lifecycle: 'published',
    contract: { version: 1, inputs: [], outputs: [] },
    steps: [
      {
        module: 'CreateAutomationRunReference',
            // 'supplier' is a real column in this harness's p2p-e2e.csv fixture. The live incident
        // used 'automationOwner'; the mechanism is identical — a column name saved as fixed text.
        params: { prefix: 'automationReference', owner: 'supplier' },
      },
    ],
  };

  const blocked = await api.put(`/api/testcases/${file}`, candidate);
  assert.equal(blocked.status, 400);
  const flagged = blocked.body.issues.filter((issue) => issue.code === 'literal-matches-dataset-column');
  // Only "supplier" collides with a real column, so only it is caught. "automationReference" is
  // nobody's column name and passes — which is exactly why the merged picker matters more than
  // this backstop: the check can only ever see the half that collides with a column that exists.
  assert.equal(flagged.length, 1);
  assert.equal(flagged[0].path, 'steps[0].params.owner');

  // Bound properly, the same step publishes without that finding.
  const bound = await api.put(`/api/testcases/${file}`, {
    ...candidate,
    contract: {
      version: 1,
      inputs: [
        { name: 'automationReferencePrefix', type: 'string', required: true },
        { name: 'supplier', type: 'string', required: true },
      ],
      outputs: [],
    },
    steps: [
      {
        module: 'CreateAutomationRunReference',
        params: { prefix: '${automationReferencePrefix}', owner: '${supplier}' },
        valueBindings: {
          prefix: { source: 'dataset', key: 'automationReferencePrefix' },
          owner: { source: 'dataset', key: 'supplier' },
        },
      },
    ],
  });
  assert.equal(bound.status, 200);

  await api.delete(`/api/testcases/${file}`);
});
