'use strict';

const path = require('node:path');
const { createStudioServer } = require('../packages/studio-server/dist/server.js');
const { createSyntheticRunService } = require('./synthetic-run-service');

// BL-050: in live mode the harness must stop substituting the parts that make a live run live.
// Isolating the workspace data is fine and stays; isolating the run service, the SAP verifier and
// the target's governance record is not — with all three stubbed, `REGRESSION_LIVE=1` could only
// ever have exercised a synthetic runner against a fake host that always reported itself verified.
const LIVE_MODE = Boolean(process.env.REGRESSION_LIVE || process.env.REGRESSION_LIVE_TRANSACTIONAL);
const tempRoot = process.env.ISOLATED_STUDIO_ROOT;
const webDistPath = process.env.ISOLATED_STUDIO_WEB_DIST;
if (!tempRoot || !webDistPath) {
  throw new Error('ISOLATED_STUDIO_ROOT and ISOLATED_STUDIO_WEB_DIST are required.');
}

// In live mode the harness stops isolating the workspace at all, and that is the point rather
// than a shortcut. The live suites drive REAL Test files (verify-sap-login.json,
// open-manage-purchase-orders.json) against a REAL App ID with REAL objects and REAL credentials;
// every one of those lives in the actual workspace, so a run pointed at synthetic fixtures fails
// before it ever opens a browser — which is precisely what happened before BL-050. Live mode is
// therefore the ordinary server with execution enabled, and the recorded evidence it produces is
// the gate's evidence. Isolation remains the default for every non-live run.
const app = LIVE_MODE
  ? createStudioServer({ webDistPath, executionEnabled: true })
  : createStudioServer({
    objectDbPath: path.join(tempRoot, 'objects.db'),
    documentDbPath: path.join(tempRoot, 'documents.db'),
    tagDbPath: path.join(tempRoot, 'tags.db'),
    dataSchemaDbPath: path.join(tempRoot, 'data-column-schema.db'),
    runHistoryDbPath: path.join(tempRoot, 'run-history.db'),
    webDistPath,
    testCasesDir: path.join(tempRoot, 'testcases'),
    groupsDir: path.join(tempRoot, 'testgroups'),
    packsDir: path.join(tempRoot, 'testpacks'),
    dataDir: path.join(tempRoot, 'data'),
    reportsDir: path.join(tempRoot, 'reports'),
    evidenceArchiveDir: path.join(tempRoot, 'audit-evidence'),
    authConfigPath: path.join(tempRoot, 'auth.json'),
    governancePath: path.join(tempRoot, 'workspace-governance.json'),
    overviewPreferencesPath: path.join(tempRoot, 'overview-preferences.json'),
    executionEnabled: true,
    runService: createSyntheticRunService(tempRoot),
    verifySap: async () => ({
      verified: true,
      verifiedAt: new Date().toISOString(),
      message: 'Synthetic isolated target verification passed.',
    }),
  });

const server = app.listen(0, '127.0.0.1', () => {
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : null;
  if (!port) throw new Error('Could not determine isolated Studio port.');
  if (process.send) process.send({ url: `http://127.0.0.1:${port}` });
});

server.once('error', (error) => {
  console.error(error);
  process.exitCode = 1;
});

process.on('SIGTERM', () => {
  server.close(() => process.exit(0));
});
