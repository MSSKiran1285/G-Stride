'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { OverviewPreferencesStore } = require('../packages/studio-server/dist/overviewPreferences.js');

function tempPath() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'overview-prefs-')), 'overview-preferences.json');
}

test('getImpactAssumptions returns defaults when no preference file exists yet', () => {
  const store = new OverviewPreferencesStore(tempPath());
  const defaults = store.getImpactAssumptions();
  assert.equal(defaults.manualMinutesPerTest, 12);
  assert.equal(defaults.automationHourlyCost, 2);
  assert.equal(defaults.otherAutomationCost, 0);
});

test('saveImpactAssumptions persists a merged, valid update across a new store instance (BL-019 AC2)', () => {
  const filePath = tempPath();
  const first = new OverviewPreferencesStore(filePath);
  first.saveImpactAssumptions({ manualHourlyCost: 65, automationEngineerHourlyCost: 90 });

  const second = new OverviewPreferencesStore(filePath);
  const saved = second.getImpactAssumptions();
  assert.equal(saved.manualHourlyCost, 65);
  assert.equal(saved.automationEngineerHourlyCost, 90);
  // Unspecified fields keep their default rather than being reset or dropped.
  assert.equal(saved.manualMinutesPerTest, 12);
});

test('saveImpactAssumptions ignores unrecognized, negative, or non-finite fields', () => {
  const store = new OverviewPreferencesStore(tempPath());
  store.saveImpactAssumptions({
    manualHourlyCost: -5,
    automationHourlyCost: Number.POSITIVE_INFINITY,
    buildAndSetupHours: 'not-a-number',
    notARealField: 999,
  });
  const saved = store.getImpactAssumptions();
  assert.equal(saved.manualHourlyCost, 50, 'a negative value must not overwrite the default');
  assert.equal(saved.automationHourlyCost, 2, 'a non-finite value must not overwrite the default');
  assert.equal(saved.buildAndSetupHours, 40, 'a non-numeric value must not overwrite the default');
  assert.equal(saved.notARealField, undefined, 'an unrecognized field must not be persisted');
});
