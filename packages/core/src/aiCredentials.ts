import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Storage for a single AI provider API key (BL-047 Phase 2's natural-language resolution and
 * shell-screen fallback need a model call — see docs/ui-ux/AUTONOMOUS_TEST_AUTHORING_DESIGN.md).
 * Deliberately a parallel module to credentials.ts rather than a generalisation of it: this
 * store holds one secret string per provider, not SAP's three-field url/username/password
 * shape, and keeping it separate means this new, less battle-tested code can never affect the
 * already-hardened SAP credential path. Same security properties throughout: OS-native
 * credential store first (keytar), AES-256-GCM encrypted file fallback, environment variable
 * override for CI — and a non-secret status accessor for Settings/target-status UI.
 */

const SERVICE = 'sap-taf-ai';
const FILE_STORE_VERSION = 1;
const CREDENTIAL_STORE_PATH =
  process.env.TAF_AI_CREDENTIAL_STORE_PATH || path.resolve('.studio', 'ai-credentials.enc.json');
const CREDENTIAL_KEY_PATH =
  process.env.TAF_AI_CREDENTIAL_KEY_PATH || path.resolve('.studio', 'ai-credential-key');

export interface AiCredentialStatus {
  configured: boolean;
  source: 'environment' | 'credential-store' | 'none';
}

interface EncryptedSecret {
  iv: string;
  tag: string;
  ciphertext: string;
}

interface EncryptedCredentialStore {
  version: number;
  secrets: Record<string, EncryptedSecret>;
}

function loadFileStore(): EncryptedCredentialStore {
  if (!existsSync(CREDENTIAL_STORE_PATH)) return { version: FILE_STORE_VERSION, secrets: {} };
  try {
    const parsed = JSON.parse(readFileSync(CREDENTIAL_STORE_PATH, 'utf8')) as EncryptedCredentialStore;
    if (parsed.version !== FILE_STORE_VERSION || !parsed.secrets) throw new Error('Unsupported AI credential store');
    return parsed;
  } catch {
    throw new Error('The encrypted AI provider credential store is unreadable. Re-enter the API key in Settings.');
  }
}

function loadOrCreateFileKey(): Buffer {
  mkdirSync(path.dirname(CREDENTIAL_KEY_PATH), { recursive: true });
  if (existsSync(CREDENTIAL_KEY_PATH)) {
    const key = Buffer.from(readFileSync(CREDENTIAL_KEY_PATH, 'utf8').trim(), 'base64');
    if (key.length !== 32) throw new Error('The Studio AI credential encryption key is invalid.');
    return key;
  }
  const key = randomBytes(32);
  writeFileSync(CREDENTIAL_KEY_PATH, key.toString('base64'), { encoding: 'utf8', mode: 0o600 });
  return key;
}

function writeFileSecret(provider: string, apiKey: string): void {
  const key = loadOrCreateFileKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(`${SERVICE}:${provider}`, 'utf8'));
  const ciphertext = Buffer.concat([cipher.update(apiKey, 'utf8'), cipher.final()]);
  const store = loadFileStore();
  store.secrets[provider] = {
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    ciphertext: ciphertext.toString('base64'),
  };
  mkdirSync(path.dirname(CREDENTIAL_STORE_PATH), { recursive: true });
  const tempPath = `${CREDENTIAL_STORE_PATH}.${process.pid}.tmp`;
  writeFileSync(tempPath, `${JSON.stringify(store, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  renameSync(tempPath, CREDENTIAL_STORE_PATH);
}

function readFileSecret(provider: string): string | null {
  const store = loadFileStore();
  const encrypted = store.secrets[provider];
  if (!encrypted) return null;
  try {
    const key = loadOrCreateFileKey();
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(encrypted.iv, 'base64'));
    decipher.setAAD(Buffer.from(`${SERVICE}:${provider}`, 'utf8'));
    decipher.setAuthTag(Buffer.from(encrypted.tag, 'base64'));
    const plaintext = Buffer.concat([decipher.update(Buffer.from(encrypted.ciphertext, 'base64')), decipher.final()]);
    return plaintext.toString('utf8');
  } catch {
    throw new Error('The saved AI provider API key could not be decrypted. Re-enter it in Settings.');
  }
}

function removeFileSecret(provider: string): void {
  if (!existsSync(CREDENTIAL_STORE_PATH)) return;
  const store = loadFileStore();
  if (!store.secrets[provider]) return;
  delete store.secrets[provider];
  const tempPath = `${CREDENTIAL_STORE_PATH}.${process.pid}.tmp`;
  writeFileSync(tempPath, `${JSON.stringify(store, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  renameSync(tempPath, CREDENTIAL_STORE_PATH);
}

async function loadKeytar() {
  if (process.env.TAF_DISABLE_OS_CREDENTIAL_STORE === '1') return null;
  try {
    const mod = await import('keytar');
    return (mod as unknown as { default?: typeof mod }).default ?? mod;
  } catch {
    return null;
  }
}

async function keytarGetPassword(
  keytar: NonNullable<Awaited<ReturnType<typeof loadKeytar>>>,
  account: string
): Promise<string | null> {
  try {
    return await keytar.getPassword(SERVICE, account);
  } catch {
    return null;
  }
}

/** Stores an AI provider's API key — OS-native credential store first, AES-256-GCM encrypted
 *  file fallback otherwise, exactly the same resilience SAP credentials already rely on. */
export async function setAiApiKey(provider: string, apiKey: string): Promise<void> {
  const keytar = await loadKeytar();
  if (!keytar) {
    writeFileSecret(provider, apiKey);
    return;
  }
  try {
    await keytar.setPassword(SERVICE, `${provider}:apiKey`, apiKey);
    removeFileSecret(provider);
  } catch {
    writeFileSecret(provider, apiKey);
  }
}

function apiKeyFromEnv(provider: string): string | null {
  return process.env[`TAF_AI_${provider.toUpperCase()}_API_KEY`] || null;
}

/** Resolves an AI provider's API key — environment variable first (the CI path), then the
 *  encrypted store (the local dev / Settings-entered path). Throws with clear next steps
 *  rather than returning an empty string, so a caller can never silently proceed unconfigured. */
export async function getAiApiKey(provider: string): Promise<string> {
  const envKey = apiKeyFromEnv(provider);
  if (envKey) return envKey;

  const fileKey = readFileSecret(provider);
  if (fileKey) return fileKey;

  const keytar = await loadKeytar();
  if (!keytar) {
    throw new Error(
      `No API key stored for AI provider "${provider}". Add it in Studio Settings, or set TAF_AI_${provider.toUpperCase()}_API_KEY.`
    );
  }
  const key = await keytarGetPassword(keytar, `${provider}:apiKey`);
  if (!key) {
    throw new Error(
      `No API key stored for AI provider "${provider}". Add it in Studio Settings, or set TAF_AI_${provider.toUpperCase()}_API_KEY.`
    );
  }
  return key;
}

/** Non-secret status for Settings — never returns the key itself. */
export async function getAiCredentialStatus(provider: string): Promise<AiCredentialStatus> {
  if (apiKeyFromEnv(provider)) return { configured: true, source: 'environment' };
  if (readFileSecret(provider)) return { configured: true, source: 'credential-store' };

  const keytar = await loadKeytar();
  if (!keytar) return { configured: false, source: 'none' };
  const key = await keytarGetPassword(keytar, `${provider}:apiKey`);
  return { configured: Boolean(key), source: key ? 'credential-store' : 'none' };
}

/** Removes a stored AI provider API key from both the OS credential store and the encrypted
 *  file fallback — Settings' "remove" action must not have to guess which one holds it. */
export async function removeAiApiKey(provider: string): Promise<void> {
  removeFileSecret(provider);
  const keytar = await loadKeytar();
  if (!keytar) return;
  try {
    await keytar.deletePassword(SERVICE, `${provider}:apiKey`);
  } catch {
    // Nothing stored there either — removal is still a success.
  }
}
