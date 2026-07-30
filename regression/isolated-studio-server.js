'use strict';

const path = require('node:path');
const { createStudioServer } = require('../packages/studio-server/dist/server.js');
const { createSyntheticRunService } = require('./synthetic-run-service');

const tempRoot = process.env.ISOLATED_STUDIO_ROOT;
const webDistPath = process.env.ISOLATED_STUDIO_WEB_DIST;
if (!tempRoot || !webDistPath) {
  throw new Error('ISOLATED_STUDIO_ROOT and ISOLATED_STUDIO_WEB_DIST are required.');
}

const app = createStudioServer({
  objectDbPath: path.join(tempRoot, 'objects.db'),
  documentDbPath: path.join(tempRoot, 'documents.db'),
  tagDbPath: path.join(tempRoot, 'tags.db'),
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
