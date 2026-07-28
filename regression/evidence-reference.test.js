'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { evidenceArchiveUrl, readEvidenceManifest } = require('../packages/studio-server/dist/runs.js');

test('Execution Center resolves the same canonical evidence URLs as Audit and Evidence', () => {
  const reportDir = mkdtempSync(path.join(tmpdir(), 'qa4hana-evidence-manifest-'));
  try {
    writeFileSync(
      path.join(reportDir, 'evidence-manifest.json'),
      JSON.stringify({
        documents: [
          {
            runId: '11111111-1111-4111-8111-111111111111',
            label: 'Create Sales Order',
            archivePath: '11111111-1111-4111-8111-111111111111/evidence.pdf',
          },
          {
            runId: '22222222-2222-4222-8222-222222222222',
            label: 'Create Billing Document',
            archivePath: '22222222-2222-4222-8222-222222222222/evidence.pdf',
          },
        ],
      }),
    );

    assert.deepEqual(readEvidenceManifest(reportDir), [
      {
        runId: '11111111-1111-4111-8111-111111111111',
        label: 'Create Sales Order',
        url: '/audit-evidence/11111111-1111-4111-8111-111111111111/evidence.pdf',
      },
      {
        runId: '22222222-2222-4222-8222-222222222222',
        label: 'Create Billing Document',
        url: '/audit-evidence/22222222-2222-4222-8222-222222222222/evidence.pdf',
      },
    ]);
  } finally {
    rmSync(reportDir, { recursive: true, force: true });
  }
});

test('canonical evidence URL mapping rejects absolute and traversal paths', () => {
  assert.equal(evidenceArchiveUrl('run-id/evidence.pdf'), '/audit-evidence/run-id/evidence.pdf');
  assert.equal(evidenceArchiveUrl('../reports/evidence.pdf'), null);
  assert.equal(evidenceArchiveUrl('C:\\reports\\evidence.pdf'), null);
  assert.equal(evidenceArchiveUrl('/reports/evidence.pdf'), null);
});
