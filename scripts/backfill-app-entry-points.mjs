/**
 * Seeds App-ID entry points from the NavigateToApp steps already in the workspace's Tests.
 *
 * Entry points are normally learned when a scanned control is saved — the scan session knows
 * which screen it was on. That only helps from the next capture onward, so App IDs captured
 * before the feature existed have none, and NavigateToApp's screen picker comes up empty for
 * exactly the apps that have been in use longest.
 *
 * Every URL it needs is already sitting in the Tests. This reads them back out.
 *
 *   node scripts/backfill-app-entry-points.mjs           # dry run
 *   node scripts/backfill-app-entry-points.mjs --apply
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const apply = process.argv.includes('--apply');

const { ObjectRepository } = require(path.join(REPO_ROOT, 'packages/core/dist'));
const testCasesDir = path.join(REPO_ROOT, 'testcases');

/** The App ID a step runs under: its own override, else the Test's first step that declares one
 *  (legacyExecutionPlans.defaultAppId). NavigateToApp usually has no override of its own. */
function appIdFor(testCase, step) {
  return step.appId || testCase.steps.find((s) => s.appId)?.appId || null;
}

const found = [];
for (const file of readdirSync(testCasesDir).filter((f) => f.endsWith('.json'))) {
  let testCase;
  try {
    testCase = JSON.parse(readFileSync(path.join(testCasesDir, file), 'utf8'));
  } catch {
    continue;
  }
  for (const step of testCase.steps ?? []) {
    if (step.module !== 'NavigateToApp') continue;
    const url = step.params?.url?.trim();
    const appId = appIdFor(testCase, step);
    if (!url || !appId) {
      if (url) console.log(`  skipped  ${file}: "${url}" has no App ID to attach to`);
      continue;
    }
    found.push({ appId, url, file });
  }
}

const repo = new ObjectRepository(path.join(REPO_ROOT, 'object-repository.db'));
let added = 0;
for (const { appId, url, file } of found) {
  const already = repo.listEntryPoints(appId).some((e) => e.url === url);
  if (already) {
    console.log(`  present  ${appId.padEnd(24)} ${url}`);
    continue;
  }
  console.log(`  ${apply ? 'ADDED   ' : 'would add'} ${appId.padEnd(24)} ${url}   [${file}]`);
  if (apply) repo.recordEntryPoint(appId, url);
  added++;
}

console.log('');
for (const appId of repo.listAppIds()) {
  const entries = repo.listEntryPoints(appId);
  if (entries.length) console.log(`  ${appId.padEnd(24)} ${entries.length} screen${entries.length === 1 ? '' : 's'}`);
}
repo.close();
console.log('');
console.log(apply ? `${added} entry point(s) recorded.` : `${added} would be recorded — pass --apply to write.`);
