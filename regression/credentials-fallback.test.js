'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, readFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

test('encrypted credential fallback persists securely across server and CLI processes', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'qa4hana-credentials-'));
  const storePath = path.join(root, 'credentials.enc.json');
  const keyPath = path.join(root, 'credential-key');
  const env = {
    ...process.env,
    TAF_DISABLE_OS_CREDENTIAL_STORE: '1',
    TAF_CREDENTIAL_STORE_PATH: storePath,
    TAF_CREDENTIAL_KEY_PATH: keyPath,
  };

  try {
    const save = spawnSync(
      process.execPath,
      ['-e', "require('./packages/core/dist').setCredentials('default',{url:'https://example.invalid',username:'tester@example.com',password:'synthetic-secret'}).catch(e=>{console.error(e);process.exit(1)})"],
      { cwd: path.resolve(__dirname, '..'), env, encoding: 'utf8' },
    );
    assert.equal(save.status, 0, save.stderr);

    const read = spawnSync(
      process.execPath,
      ['-e', "require('./packages/core/dist').getCredentials('default').then(c=>console.log(JSON.stringify({url:c.url,username:c.username,passwordLength:c.password.length}))).catch(e=>{console.error(e);process.exit(1)})"],
      { cwd: path.resolve(__dirname, '..'), env, encoding: 'utf8' },
    );
    assert.equal(read.status, 0, read.stderr);
    assert.deepEqual(JSON.parse(read.stdout), {
      url: 'https://example.invalid',
      username: 'tester@example.com',
      passwordLength: 16,
    });

    const encrypted = readFileSync(storePath, 'utf8');
    assert.equal(encrypted.includes('synthetic-secret'), false, 'password must not appear in the credential file');
    assert.equal(encrypted.includes('tester@example.com'), false, 'username must not appear in the credential file');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
