import type { SapCredentialStatus } from '@taf/core';
import type { StudioUser } from './auth';
import type { SapTargetGovernance } from './workspaceGovernance';

export type TargetSafetyClass = 'unknown' | 'non-production' | 'production-like';
export type TargetVerificationStatus = 'not-configured' | 'saved-not-live-verified' | 'live-verified';

export interface ExecutionInitiator {
  id: string;
  provider: StudioUser['provider'];
  name: string;
  email: string;
}

export interface ExecutionTargetContext {
  provider: 'SAP';
  profileRef: 'default';
  configured: boolean;
  hostname: string | null;
  origin: string | null;
  credentialSource: SapCredentialStatus['source'];
  safetyClass: TargetSafetyClass;
  verificationStatus: TargetVerificationStatus;
  verifiedAt: string | null;
  capturedAt: string;
}

export interface WorkspaceContext {
  workspaceId: 'single-owner-workspace';
  owner: ExecutionInitiator;
  target: ExecutionTargetContext;
  capturedAt: string;
}

export function executionInitiator(user: StudioUser): ExecutionInitiator {
  return {
    id: user.id,
    provider: user.provider,
    name: user.name,
    email: user.email,
  };
}

/**
 * Returns only non-secret target metadata. A saved URL and credential profile
 * are not treated as proof of live reachability or successful SAP login.
 */
export function executionTargetContext(
  status: SapCredentialStatus,
  governanceOrCapturedAt?: SapTargetGovernance | string,
  capturedAt = new Date().toISOString()
): ExecutionTargetContext {
  const governance = typeof governanceOrCapturedAt === 'string' ? undefined : governanceOrCapturedAt;
  const effectiveCapturedAt = typeof governanceOrCapturedAt === 'string' ? governanceOrCapturedAt : capturedAt;
  let hostname: string | null = null;
  let origin: string | null = null;
  try {
    const parsed = status.url ? new URL(status.url) : null;
    hostname = parsed?.hostname ?? null;
    origin = parsed?.origin ?? null;
  } catch {
    hostname = null;
    origin = null;
  }
  return {
    provider: 'SAP',
    profileRef: 'default',
    configured: status.configured,
    hostname,
    origin,
    credentialSource: status.source,
    safetyClass: governance?.safetyClass ?? 'unknown',
    verificationStatus: governance?.verificationStatus
      ?? (status.configured ? 'saved-not-live-verified' : 'not-configured'),
    verifiedAt: governance?.verifiedAt ?? null,
    capturedAt: effectiveCapturedAt,
  };
}

export function workspaceContext(
  user: StudioUser,
  credentialStatus: SapCredentialStatus,
  governance?: SapTargetGovernance,
  capturedAt = new Date().toISOString()
): WorkspaceContext {
  return {
    workspaceId: 'single-owner-workspace',
    owner: executionInitiator(user),
    target: executionTargetContext(credentialStatus, governance, capturedAt),
    capturedAt,
  };
}
