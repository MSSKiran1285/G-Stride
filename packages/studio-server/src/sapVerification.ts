import type { SapCredentials } from '@taf/core';
import { FioriPlaywrightAdapter } from '@taf/adapter-fiori';
import type { ObjectRepository } from '@taf/core';
import type { ModuleRegistry } from '@taf/engine';

export interface SapVerificationResult {
  verified: boolean;
  verifiedAt: string;
  message: string;
}

/**
 * Opens an isolated headless browser, performs only the Login module, and
 * closes the session. It does not navigate to a business app or invoke any
 * transaction module, so verification cannot create or modify SAP documents.
 */
export async function verifySapConnection(
  credentials: SapCredentials,
  objectRepository: ObjectRepository,
  registry: ModuleRegistry
): Promise<SapVerificationResult> {
  const adapter = new FioriPlaywrightAdapter({ headless: true });
  try {
    await registry.get('Login').execute({
      adapter,
      objectRepository,
      appId: 'login',
      params: {
        url: credentials.url,
        username: credentials.username,
        password: credentials.password,
      },
      runState: {},
    });
    return {
      verified: true,
      verifiedAt: new Date().toISOString(),
      message: 'Reachability and SAP authentication verified in a non-transactional browser session.',
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      verified: false,
      verifiedAt: new Date().toISOString(),
      message: `Verification failed: ${message}`,
    };
  } finally {
    await adapter.close().catch(() => undefined);
  }
}
