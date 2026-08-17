'use strict';

/**
 * The Test library reports which Tests create SAP business documents.
 *
 * The Execution Center cannot read a Test file, so without this it could not tell that "stop
 * after the first failed transaction" is mandatory for a selection — and it defaulted by MODE
 * instead. Single Test therefore always opened on "Continue to next transaction", which preflight
 * blocks outright for anything transactional, so every transactional single-Test run hit that
 * wall on first use and had to be corrected by hand.
 */

const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const { api, assertServerReachable } = require('../lib/apiClient');

before(assertServerReachable);

function testCase(name, transaction) {
  return {
    version: 1,
    lifecycle: 'draft',
    application: 'SAP',
    name,
    ...(transaction ? { transaction } : {}),
    steps: [{ module: 'Wait', params: { ms: '1' } }],
  };
}

async function libraryEntry(file) {
  const { status, body } = await api.get('/api/testcases/library');
  assert.equal(status, 200);
  return body.find((item) => item.file === file);
}

test('the Test library says which Tests create SAP documents', async () => {
  await api.put(
    '/api/testcases/transactional-flag-creates.json',
    testCase('Transactional Flag Creates', {
      creates: ['salesOrder'],
      failureDisposition: 'retain-for-review',
      ownershipRequired: true,
    })
  );
  await api.put('/api/testcases/transactional-flag-readonly.json', testCase('Transactional Flag Read Only'));

  try {
    assert.equal((await libraryEntry('transactional-flag-creates.json')).transactional, true);
    assert.equal((await libraryEntry('transactional-flag-readonly.json')).transactional, false);
  } finally {
    await api.delete('/api/testcases/transactional-flag-creates.json?force=true');
    await api.delete('/api/testcases/transactional-flag-readonly.json?force=true');
  }
});

test('a transaction block that names no document is not transactional', async () => {
  // An empty creates list, and a string where a list belongs, both mean "no document is
  // declared". Reporting either as transactional would lock the failure policy for a Test that
  // does not need it.
  await api.put(
    '/api/testcases/transactional-flag-empty.json',
    testCase('Transactional Flag Empty', {
      creates: [],
      failureDisposition: 'retain-for-review',
      ownershipRequired: true,
    })
  );
  await api.put(
    '/api/testcases/transactional-flag-malformed.json',
    testCase('Transactional Flag Malformed', { creates: 'salesOrder' })
  );

  try {
    assert.equal((await libraryEntry('transactional-flag-empty.json')).transactional, false);

    const malformed = await libraryEntry('transactional-flag-malformed.json');
    assert.ok(malformed, 'a malformed transaction block must not drop the Test from the library');
    assert.equal(malformed.transactional, false, 'only a non-empty array counts');
  } finally {
    await api.delete('/api/testcases/transactional-flag-empty.json?force=true');
    await api.delete('/api/testcases/transactional-flag-malformed.json?force=true');
  }
});
