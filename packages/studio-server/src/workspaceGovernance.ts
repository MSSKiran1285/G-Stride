import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { SapCredentialStatus } from '@taf/core';
import type { TargetSafetyClass, TargetVerificationStatus } from './executionContext';

const STORE_VERSION = 1;
export const SAP_VERIFICATION_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export interface SapTargetGovernance {
  safetyClass: TargetSafetyClass;
  verificationStatus: TargetVerificationStatus;
  verifiedAt: string | null;
  verifiedFingerprint: string | null;
  verificationMessage: string | null;
}

export interface EvidenceGovernance {
  retentionPolicy: 'retain-until-workspace-owner-deletes';
  automaticDeletion: false;
  executionSnapshots: 'retained with the Studio run';
  executionEvents: 'retained with the Studio run';
  canonicalEvidence: 'retained in the audit evidence archive';
  redaction: {
    status: 'enforced';
    credentials: 'excluded';
    executionLogs: 'filtered';
    evidenceValues: 'policy-controlled';
  };
  rationale: string;
}

interface WorkspaceGovernanceFile {
  version: number;
  sap: SapTargetGovernance;
}

const DEFAULT_SAP_GOVERNANCE: SapTargetGovernance = {
  safetyClass: 'unknown',
  verificationStatus: 'not-configured',
  verifiedAt: null,
  verifiedFingerprint: null,
  verificationMessage: null,
};

export const EVIDENCE_GOVERNANCE: EvidenceGovernance = {
  retentionPolicy: 'retain-until-workspace-owner-deletes',
  automaticDeletion: false,
  executionSnapshots: 'retained with the Studio run',
  executionEvents: 'retained with the Studio run',
  canonicalEvidence: 'retained in the audit evidence archive',
  redaction: {
    status: 'enforced',
    credentials: 'excluded',
    executionLogs: 'filtered',
    evidenceValues: 'policy-controlled',
  },
  rationale: 'Automatic deletion remains disabled until the workspace owner approves and implements a time-based retention period.',
};

function fingerprint(status: SapCredentialStatus): string | null {
  if (!status.configured) return null;
  let origin = status.url;
  try {
    origin = new URL(status.url).origin;
  } catch {
    // The credential endpoint validates URLs. Retain the raw value only for a
    // one-way fingerprint if an environment-provided profile is malformed.
  }
  return createHash('sha256')
    .update(JSON.stringify({ origin, username: status.username, source: status.source }))
    .digest('hex');
}

export class WorkspaceGovernanceStore {
  constructor(private readonly filePath: string) {}

  private read(): WorkspaceGovernanceFile {
    if (!existsSync(this.filePath)) {
      return { version: STORE_VERSION, sap: { ...DEFAULT_SAP_GOVERNANCE } };
    }
    try {
      const parsed = JSON.parse(readFileSync(this.filePath, 'utf8')) as Partial<WorkspaceGovernanceFile>;
      if (parsed.version !== STORE_VERSION || !parsed.sap) throw new Error('Unsupported governance file');
      const safetyClass = ['unknown', 'non-production', 'production-like'].includes(parsed.sap.safetyClass)
        ? parsed.sap.safetyClass
        : 'unknown';
      return {
        version: STORE_VERSION,
        sap: {
          ...DEFAULT_SAP_GOVERNANCE,
          ...parsed.sap,
          safetyClass,
        },
      };
    } catch {
      throw new Error('The Studio workspace-governance file is unreadable. Restore it or re-save the SAP target settings.');
    }
  }

  private write(value: WorkspaceGovernanceFile): void {
    mkdirSync(path.dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.${process.pid}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    renameSync(temporary, this.filePath);
  }

  getSap(status: SapCredentialStatus): SapTargetGovernance {
    const stored = this.read().sap;
    if (!status.configured) {
      return { ...stored, verificationStatus: 'not-configured', verifiedAt: null };
    }
    if (
      stored.verificationStatus === 'live-verified'
      && stored.verifiedFingerprint === fingerprint(status)
      && stored.verifiedAt
      && Date.parse(stored.verifiedAt) >= Date.now() - SAP_VERIFICATION_MAX_AGE_MS
    ) {
      return stored;
    }
    return {
      ...stored,
      verificationStatus: 'saved-not-live-verified',
      verifiedAt: stored.verifiedFingerprint === fingerprint(status) ? stored.verifiedAt : null,
      verifiedFingerprint: null,
    };
  }

  saveConfiguration(status: SapCredentialStatus, safetyClass: TargetSafetyClass): SapTargetGovernance {
    const existing = this.read();
    const currentFingerprint = fingerprint(status);
    const stillVerified =
      existing.sap.verificationStatus === 'live-verified'
      && existing.sap.verifiedFingerprint === currentFingerprint;
    existing.sap = {
      safetyClass,
      verificationStatus: status.configured && stillVerified ? 'live-verified' : status.configured ? 'saved-not-live-verified' : 'not-configured',
      verifiedAt: stillVerified ? existing.sap.verifiedAt : null,
      verifiedFingerprint: stillVerified ? existing.sap.verifiedFingerprint : null,
      verificationMessage: stillVerified ? existing.sap.verificationMessage : null,
    };
    this.write(existing);
    return existing.sap;
  }

  recordVerification(
    status: SapCredentialStatus,
    result: { verified: boolean; verifiedAt: string; message: string }
  ): SapTargetGovernance {
    const existing = this.read();
    existing.sap = {
      ...existing.sap,
      verificationStatus: result.verified ? 'live-verified' : status.configured ? 'saved-not-live-verified' : 'not-configured',
      verifiedAt: result.verified ? result.verifiedAt : null,
      verifiedFingerprint: result.verified ? fingerprint(status) : null,
      verificationMessage: result.message.slice(0, 300),
    };
    this.write(existing);
    return existing.sap;
  }
}
