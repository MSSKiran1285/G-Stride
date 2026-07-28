import { RunResult } from '@taf/core';
import { writeFileSync } from 'node:fs';

export function writeJsonReport(result: RunResult, outPath: string): void {
  writeFileSync(outPath, JSON.stringify(result, null, 2), 'utf-8');
}
