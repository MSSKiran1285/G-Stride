import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const SERVICE = 'sap-taf';
const FILE_STORE_VERSION = 1;
const CREDENTIAL_STORE_PATH =
  process.env.TAF_CREDENTIAL_STORE_PATH || path.resolve('.studio', 'credentials.enc.json');
const CREDENTIAL_KEY_PATH =
  process.env.TAF_CREDENTIAL_KEY_PATH || path.resolve('.studio', 'credential-key');

export interface SapCredentials {
  url: string;
  username: string;
  password: string;
}

export interface SapCredentialStatus {
  configured: boolean;
  url: string;
  username: string;
  source: 'environment' | 'credential-store' | 'none';
}

interface EncryptedProfile {
  iv: string;
  tag: string;
  ciphertext: string;
}

interface EncryptedCredentialStore {
  version: number;
  profiles: Record<string, EncryptedProfile>;
}

function loadFileStore(): EncryptedCredentialStore {
  if (!existsSync(CREDENTIAL_STORE_PATH)) return { version: FILE_STORE_VERSION, profiles: {} };
  try {
    const parsed = JSON.parse(readFileSync(CREDENTIAL_STORE_PATH, 'utf8')) as EncryptedCredentialStore;
    if (parsed.version !== FILE_STORE_VERSION || !parsed.profiles) throw new Error('Unsupported credential store');
    return parsed;
  } catch {
    throw new Error('The encrypted Studio credential store is unreadable. Re-enter the SAP connection in Settings.');
  }
}

function loadOrCreateFileKey(): Buffer {
  mkdirSync(path.dirname(CREDENTIAL_KEY_PATH), { recursive: true });
  if (existsSync(CREDENTIAL_KEY_PATH)) {
    const key = Buffer.from(readFileSync(CREDENTIAL_KEY_PATH, 'utf8').trim(), 'base64');
    if (key.length !== 32) throw new Error('The Studio credential encryption key is invalid.');
    return key;
  }
  const key = randomBytes(32);
  writeFileSync(CREDENTIAL_KEY_PATH, key.toString('base64'), { encoding: 'utf8', mode: 0o600 });
  return key;
}

function writeFileCredentials(profile: string, creds: SapCredentials): void {
  const key = loadOrCreateFileKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(`${SERVICE}:${profile}`, 'utf8'));
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(creds), 'utf8'),
    cipher.final(),
  ]);
  const store = loadFileStore();
  store.profiles[profile] = {
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    ciphertext: ciphertext.toString('base64'),
  };
  mkdirSync(path.dirname(CREDENTIAL_STORE_PATH), { recursive: true });
  const tempPath = `${CREDENTIAL_STORE_PATH}.${process.pid}.tmp`;
  writeFileSync(tempPath, `${JSON.stringify(store, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  renameSync(tempPath, CREDENTIAL_STORE_PATH);
}

function readFileCredentials(profile: string): SapCredentials | null {
  const store = loadFileStore();
  const encrypted = store.profiles[profile];
  if (!encrypted) return null;
  try {
    const key = loadOrCreateFileKey();
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(encrypted.iv, 'base64'));
    decipher.setAAD(Buffer.from(`${SERVICE}:${profile}`, 'utf8'));
    decipher.setAuthTag(Buffer.from(encrypted.tag, 'base64'));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(encrypted.ciphertext, 'base64')),
      decipher.final(),
    ]);
    return JSON.parse(plaintext.toString('utf8')) as SapCredentials;
  } catch {
    throw new Error('The saved SAP credentials could not be decrypted. Re-enter the connection in Settings.');
  }
}

function removeFileCredentials(profile: string): void {
  if (!existsSync(CREDENTIAL_STORE_PATH)) return;
  const store = loadFileStore();
  if (!store.profiles[profile]) return;
  delete store.profiles[profile];
  const tempPath = `${CREDENTIAL_STORE_PATH}.${process.pid}.tmp`;
  writeFileSync(tempPath, `${JSON.stringify(store, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  renameSync(tempPath, CREDENTIAL_STORE_PATH);
}

// keytar is a native module backed by the OS credential store (Windows Credential
// Manager, macOS Keychain, libsecret on Linux). It's lazy-loaded so that CI runners —
// which supply credentials via env vars instead and may not have a working native
// keyring at all — never touch it.
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
    // Native keytar can fail either synchronously or asynchronously when a
    // detached Windows process has no Credential Manager logon session.
    return null;
  }
}

/**
 * Stores SAP credentials in the OS-native credential store. If that store is
 * unavailable (for example, a detached Windows process has no Credential
 * Manager logon session), it falls back to an AES-256-GCM encrypted local store
 * shared by the Studio server and its CLI execution child processes.
 */
export async function setCredentials(profile: string, creds: SapCredentials): Promise<void> {
  const keytar = await loadKeytar();
  if (!keytar) {
    writeFileCredentials(profile, creds);
    return;
  }
  try {
    await keytar.setPassword(SERVICE, `${profile}:url`, creds.url);
    await keytar.setPassword(SERVICE, `${profile}:username`, creds.username);
    await keytar.setPassword(SERVICE, `${profile}:password`, creds.password);
    removeFileCredentials(profile);
  } catch {
    writeFileCredentials(profile, creds);
  }
}

function credentialsFromEnv(profile: string): SapCredentials | null {
  const prefix = `TAF_${profile.toUpperCase()}_`;
  const url = process.env[`${prefix}URL`];
  const username = process.env[`${prefix}USERNAME`];
  const password = process.env[`${prefix}PASSWORD`];
  if (url && username && password) return { url, username, password };
  return null;
}

/**
 * Resolves SAP credentials for a profile — from TAF_<PROFILE>_URL/USERNAME/PASSWORD
 * environment variables first (the CI path), falling back to the OS credential store
 * (the local dev path, set via "taf credentials set").
 */
export async function getCredentials(profile: string): Promise<SapCredentials> {
  const envCreds = credentialsFromEnv(profile);
  if (envCreds) return envCreds;

  const fileCreds = readFileCredentials(profile);
  if (fileCreds) return fileCreds;

  const keytar = await loadKeytar();
  if (!keytar) {
    throw new Error(
      `No credentials stored for profile "${profile}". Enter the SAP connection in Studio Settings, ` +
        `run "taf credentials set --profile ${profile}", or set TAF_${profile.toUpperCase()}_URL/USERNAME/PASSWORD.`
    );
  }
  const [url, username, password] = await Promise.all([
    keytarGetPassword(keytar, `${profile}:url`),
    keytarGetPassword(keytar, `${profile}:username`),
    keytarGetPassword(keytar, `${profile}:password`),
  ]);
  if (!url || !username || !password) {
    throw new Error(
      `No credentials stored for profile "${profile}". Run "taf credentials set --profile ${profile}", ` +
        `or set TAF_${profile.toUpperCase()}_URL/USERNAME/PASSWORD environment variables (e.g. in CI).`
    );
  }
  return { url, username, password };
}

/** Returns non-secret profile metadata for Settings and target-status UI. */
export async function getCredentialStatus(profile: string): Promise<SapCredentialStatus> {
  const envCreds = credentialsFromEnv(profile);
  if (envCreds) {
    return {
      configured: true,
      url: envCreds.url,
      username: envCreds.username,
      source: 'environment',
    };
  }

  const fileCreds = readFileCredentials(profile);
  if (fileCreds) {
    return {
      configured: true,
      url: fileCreds.url,
      username: fileCreds.username,
      source: 'credential-store',
    };
  }

  const keytar = await loadKeytar();
  if (!keytar) {
    return { configured: false, url: '', username: '', source: 'none' };
  }
  const [url, username, password] = await Promise.all([
    keytarGetPassword(keytar, `${profile}:url`),
    keytarGetPassword(keytar, `${profile}:username`),
    keytarGetPassword(keytar, `${profile}:password`),
  ]);
  return {
    configured: Boolean(url && username && password),
    url: url ?? '',
    username: username ?? '',
    source: url || username || password ? 'credential-store' : 'none',
  };
}
