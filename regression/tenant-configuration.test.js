'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { resolveParams } = require('../packages/core/dist');

test('SAP test cases derive navigation URLs from the configured credential profile', () => {
  const files = [
    'create-po.json',
    'create-so.json',
    'create-delivery.json',
    'create-billing.json',
  ];

  for (const file of files) {
    const testCase = JSON.parse(readFileSync(path.join(__dirname, '..', 'testcases', file), 'utf8'));
    const navigationUrls = testCase.steps
      .filter((step) => step.module === 'NavigateToApp')
      .map((step) => step.params.url);

    assert.ok(navigationUrls.length > 0, `${file} should contain a navigation step`);
    for (const url of navigationUrls) {
      assert.match(url, /^\$\{urlBase\}\//, `${file} must use the configured SAP base URL`);
      assert.doesNotMatch(url, /s4hana\.cloud\.sap/i, `${file} must not contain a tenant hostname`);
      const resolved = resolveParams({ url }, { urlBase: 'https://tenant.example' }, {});
      assert.match(resolved.url, /^https:\/\/tenant\.example\/ui#/);
    }
  }
});
