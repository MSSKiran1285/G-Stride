'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { AnthropicResolver, DEFAULT_ANTHROPIC_MODEL } = require('../packages/studio-server/dist');

const ORIGINAL_ENV_KEY = process.env.TAF_AI_ANTHROPIC_API_KEY;

function withApiKey(value, fn) {
  process.env.TAF_AI_ANTHROPIC_API_KEY = value;
  return fn().finally(() => {
    if (ORIGINAL_ENV_KEY === undefined) delete process.env.TAF_AI_ANTHROPIC_API_KEY;
    else process.env.TAF_AI_ANTHROPIC_API_KEY = ORIGINAL_ENV_KEY;
  });
}

function fakeFetch(handler) {
  return async (url, init) => handler(url, init);
}

test('complete() sends the api key, model and prompt, and returns the text content block', () =>
  withApiKey('sk-ant-test-key', async () => {
    let capturedUrl;
    let capturedInit;
    const resolver = new AnthropicResolver(
      'claude-haiku-4-5',
      fakeFetch(async (url, init) => {
        capturedUrl = url;
        capturedInit = init;
        return {
          ok: true,
          json: async () => ({ content: [{ type: 'text', text: 'createPurchaseRequisition' }] }),
        };
      })
    );

    const result = await resolver.complete('Resolve: Create a purchase requisition');

    assert.equal(result, 'createPurchaseRequisition');
    assert.equal(capturedUrl, 'https://api.anthropic.com/v1/messages');
    assert.equal(capturedInit.headers['x-api-key'], 'sk-ant-test-key');
    assert.equal(capturedInit.headers['anthropic-version'], '2023-06-01');
    const body = JSON.parse(capturedInit.body);
    assert.equal(body.model, 'claude-haiku-4-5');
    assert.equal(body.messages[0].content, 'Resolve: Create a purchase requisition');
  }));

test('the default model is Opus 5 (owner chose reliability over cost for this agentic, multi-step decision task)', () =>
  withApiKey('sk-ant-test-key', async () => {
    assert.equal(DEFAULT_ANTHROPIC_MODEL, 'claude-opus-5');
    let capturedBody;
    const resolver = new AnthropicResolver(
      undefined,
      fakeFetch(async (_url, init) => {
        capturedBody = JSON.parse(init.body);
        return { ok: true, json: async () => ({ content: [{ type: 'text', text: 'ok' }] }) };
      })
    );
    await resolver.complete('anything');
    assert.equal(capturedBody.model, 'claude-opus-5');
  }));

test('complete() throws a clear error on a non-200 response, including the response body', () =>
  withApiKey('sk-ant-test-key', async () => {
    const resolver = new AnthropicResolver(
      'claude-haiku-4-5',
      fakeFetch(async () => ({ ok: false, status: 401, text: async () => '{"error":"invalid api key"}' }))
    );
    await assert.rejects(() => resolver.complete('anything'), /Anthropic API request failed \(401\).*invalid api key/s);
  }));

test('complete() throws a clear error when the response has no text content block', () =>
  withApiKey('sk-ant-test-key', async () => {
    const resolver = new AnthropicResolver(
      'claude-haiku-4-5',
      fakeFetch(async () => ({ ok: true, json: async () => ({ content: [{ type: 'tool_use' }] }) }))
    );
    await assert.rejects(() => resolver.complete('anything'), /did not include a text content block/);
  }));

test('complete() fails clearly (via getAiApiKey) when no API key is configured at all', async () => {
  const original = process.env.TAF_AI_ANTHROPIC_API_KEY;
  delete process.env.TAF_AI_ANTHROPIC_API_KEY;
  process.env.TAF_DISABLE_OS_CREDENTIAL_STORE = '1';
  process.env.TAF_AI_CREDENTIAL_STORE_PATH = require('node:path').join(require('node:os').tmpdir(), `qa4hana-ai-unset-${Date.now()}.json`);
  try {
    const resolver = new AnthropicResolver('claude-haiku-4-5', fakeFetch(async () => {
      throw new Error('fetch should never be called without a resolved API key');
    }));
    await assert.rejects(() => resolver.complete('anything'), /No API key stored for AI provider "anthropic"/);
  } finally {
    if (original === undefined) delete process.env.TAF_AI_ANTHROPIC_API_KEY;
    else process.env.TAF_AI_ANTHROPIC_API_KEY = original;
    delete process.env.TAF_DISABLE_OS_CREDENTIAL_STORE;
    delete process.env.TAF_AI_CREDENTIAL_STORE_PATH;
  }
});
