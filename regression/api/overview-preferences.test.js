'use strict';

const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const { api, assertServerReachable } = require('../lib/apiClient');

before(assertServerReachable);

test('GET/PUT /api/settings/overview-preferences persists cost assumptions as a workspace preference (BL-019 AC2)', async () => {
  const initial = await api.get('/api/settings/overview-preferences');
  assert.equal(initial.status, 200);
  assert.equal(typeof initial.body.manualHourlyCost, 'number');

  const saved = await api.put('/api/settings/overview-preferences', {
    manualHourlyCost: 72,
    automationEngineerHourlyCost: 88,
  });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.manualHourlyCost, 72);
  assert.equal(saved.body.automationEngineerHourlyCost, 88);
  // Fields not included in the PUT keep their previously saved value, not just the default.
  assert.equal(saved.body.manualMinutesPerTest, initial.body.manualMinutesPerTest);

  const reread = await api.get('/api/settings/overview-preferences');
  assert.equal(reread.body.manualHourlyCost, 72);
  assert.equal(reread.body.automationEngineerHourlyCost, 88);
});

test('PUT /api/settings/overview-preferences rejects a non-object body', async () => {
  const rejected = await api.put('/api/settings/overview-preferences', ['not', 'an', 'object']);
  assert.equal(rejected.status, 400);
});
