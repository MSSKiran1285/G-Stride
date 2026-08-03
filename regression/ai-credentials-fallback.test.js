'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, readFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function run(script, env) {
  return spawnSync(process.execPath, ['-e', script], { cwd: path.resolve(__dirname, '..'), env, encoding: 'utf8' });
}

test('encrypted AI provider API key persists securely across processes, separate from SAP credentials', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'qa4hana-ai-credentials-'));
  const storePath = path.join(root, 'ai-credentials.enc.json');
  const keyPath = path.join(root, 'ai-credential-key');
  const env = {
    ...process.env,
    TAF_DISABLE_OS_CREDENTIAL_STORE: '1',
    TAF_AI_CREDENTIAL_STORE_PATH: storePath,
    TAF_AI_CREDENTIAL_KEY_PATH: keyPath,
  };

  try {
    const save = run("require('./packages/core/dist').setAiApiKey('anthropic','sk-ant-synthetic-secret').catch(e=>{console.error(e);process.exit(1)})", env);
    assert.equal(save.status, 0, save.stderr);

    const read = run("require('./packages/core/dist').getAiApiKey('anthropic').then(k=>console.log(k)).catch(e=>{console.error(e);process.exit(1)})", env);
    assert.equal(read.status, 0, read.stderr);
    assert.equal(read.stdout.trim(), 'sk-ant-synthetic-secret');

    const status = run("require('./packages/core/dist').getAiCredentialStatus('anthropic').then(s=>console.log(JSON.stringify(s))).catch(e=>{console.error(e);process.exit(1)})", env);
    assert.equal(status.status, 0, status.stderr);
    assert.deepEqual(JSON.parse(status.stdout), { configured: true, source: 'credential-store' });

    const encrypted = readFileSync(storePath, 'utf8');
    assert.equal(encrypted.includes('sk-ant-synthetic-secret'), false, 'API key must not appear in the credential file');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('an environment variable takes precedence over a stored key, and status reports its source', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'qa4hana-ai-credentials-env-'));
  const storePath = path.join(root, 'ai-credentials.enc.json');
  const keyPath = path.join(root, 'ai-credential-key');
  const env = {
    ...process.env,
    TAF_DISABLE_OS_CREDENTIAL_STORE: '1',
    TAF_AI_CREDENTIAL_STORE_PATH: storePath,
    TAF_AI_CREDENTIAL_KEY_PATH: keyPath,
    TAF_AI_ANTHROPIC_API_KEY: 'sk-ant-from-env',
  };

  try {
    run("require('./packages/core/dist').setAiApiKey('anthropic','sk-ant-stored').catch(e=>{console.error(e);process.exit(1)})", env);

    const read = run("require('./packages/core/dist').getAiApiKey('anthropic').then(k=>console.log(k)).catch(e=>{console.error(e);process.exit(1)})", env);
    assert.equal(read.status, 0, read.stderr);
    assert.equal(read.stdout.trim(), 'sk-ant-from-env');

    const status = run("require('./packages/core/dist').getAiCredentialStatus('anthropic').then(s=>console.log(JSON.stringify(s))).catch(e=>{console.error(e);process.exit(1)})", env);
    assert.deepEqual(JSON.parse(status.stdout), { configured: true, source: 'environment' });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('getAiApiKey throws a clear, actionable error when nothing is configured', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'qa4hana-ai-credentials-unset-'));
  const env = {
    ...process.env,
    TAF_DISABLE_OS_CREDENTIAL_STORE: '1',
    TAF_AI_CREDENTIAL_STORE_PATH: path.join(root, 'ai-credentials.enc.json'),
    TAF_AI_CREDENTIAL_KEY_PATH: path.join(root, 'ai-credential-key'),
  };
  delete env.TAF_AI_ANTHROPIC_API_KEY;

  try {
    const read = run("require('./packages/core/dist').getAiApiKey('anthropic').then(k=>console.log(k)).catch(e=>{console.error(e.message);process.exit(1)})", env);
    assert.notEqual(read.status, 0);
    assert.match(read.stderr, /No API key stored for AI provider "anthropic"/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('removeAiApiKey clears a stored key so status reverts to not configured', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'qa4hana-ai-credentials-remove-'));
  const env = {
    ...process.env,
    TAF_DISABLE_OS_CREDENTIAL_STORE: '1',
    TAF_AI_CREDENTIAL_STORE_PATH: path.join(root, 'ai-credentials.enc.json'),
    TAF_AI_CREDENTIAL_KEY_PATH: path.join(root, 'ai-credential-key'),
  };
  delete env.TAF_AI_ANTHROPIC_API_KEY;

  try {
    run("require('./packages/core/dist').setAiApiKey('anthropic','sk-ant-to-remove').catch(e=>{console.error(e);process.exit(1)})", env);
    const remove = run("require('./packages/core/dist').removeAiApiKey('anthropic').then(()=>console.log('ok')).catch(e=>{console.error(e);process.exit(1)})", env);
    assert.equal(remove.status, 0, remove.stderr);

    const status = run("require('./packages/core/dist').getAiCredentialStatus('anthropic').then(s=>console.log(JSON.stringify(s))).catch(e=>{console.error(e);process.exit(1)})", env);
    assert.deepEqual(JSON.parse(status.stdout), { configured: false, source: 'none' });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
