'use strict';

const BASE_URL = process.env.REGRESSION_BASE_URL || 'http://localhost:4500';

async function request(path, init) {
  let res;
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      headers: init && init.body ? { 'Content-Type': 'application/json' } : undefined,
      ...init,
    });
  } catch (err) {
    throw new Error(
      `Could not reach Studio server at ${BASE_URL}${path} — start it with "node packages/cli/dist/index.js studio" first. (${err.message})`
    );
  }
  const text = await res.text();
  const body = text ? JSON.parse(text) : undefined;
  return { status: res.status, ok: res.ok, body };
}

/** Fails fast with a clear message instead of every test in the file failing individually. */
async function assertServerReachable() {
  const { ok, status } = await request('/api/modules');
  if (!ok) {
    throw new Error(`Studio server at ${BASE_URL} responded ${status} to /api/modules — is it running and built?`);
  }
}

const api = {
  baseUrl: BASE_URL,
  get: (path) => request(path),
  put: (path, body) => request(path, { method: 'PUT', body: JSON.stringify(body) }),
  post: (path, body) => request(path, { method: 'POST', body: JSON.stringify(body) }),
  delete: (path) => request(path, { method: 'DELETE' }),
};

module.exports = { api, assertServerReachable, BASE_URL };
