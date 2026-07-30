import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = path.resolve(import.meta.dirname, '..');
const files = execFileSync(
  'git',
  ['ls-files', '--cached', '--others', '--exclude-standard'],
  { cwd: root, encoding: 'utf8' },
)
  .split(/\r?\n/)
  .filter(Boolean);

const binaryExtensions = new Set([
  '.7z', '.db', '.gif', '.ico', '.jpeg', '.jpg', '.pdf', '.png', '.sqlite', '.webp', '.zip',
]);
const syntheticMarkers = /(?:\$\{|process\.env|REDACTED|synthetic|isolated|example(?:\.com|\.invalid)?|dummy|placeholder|TopSecret|test-secret|verification-secret|sap\.password)/i;
const rules = [
  { name: 'private key', pattern: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/g },
  { name: 'AWS access key', pattern: /\bAKIA[0-9A-Z]{16}\b/g },
  { name: 'Google API key', pattern: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { name: 'GitHub token', pattern: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{30,}\b/g },
  { name: 'Slack token', pattern: /\bxox[baprs]-[0-9A-Za-z-]{20,}\b/g },
  { name: 'JWT', pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g },
  {
    name: 'credential-bearing URL',
    pattern: /https?:\/\/[^/\s:@]{3,}:[^/\s@]{6,}@[A-Za-z0-9.-]+/g,
  },
  {
    name: 'literal credential assignment',
    pattern: /\b(?:password|passwd|client[_-]?secret|api[_-]?key|access[_-]?token)\b\s*[:=]\s*["'][^"'\r\n]{8,}["']/gi,
  },
];

const findings = [];
for (const relative of files) {
  const extension = path.extname(relative).toLowerCase();
  if (binaryExtensions.has(extension)) continue;
  let content;
  try {
    content = readFileSync(path.join(root, relative), 'utf8');
  } catch {
    continue;
  }
  if (content.includes('\u0000')) continue;
  const lines = content.split(/\r?\n/);
  lines.forEach((line, index) => {
    if (line.includes('secret-scan: allow')) return;
    for (const rule of rules) {
      rule.pattern.lastIndex = 0;
      const matches = [...line.matchAll(rule.pattern)];
      if (matches.some((match) => !syntheticMarkers.test(match[0]))) {
        findings.push(`${relative}:${index + 1} · ${rule.name}`);
      }
    }
  });
}

if (findings.length > 0) {
  console.error('High-confidence secret scan findings:');
  findings.forEach((finding) => console.error(`- ${finding}`));
  process.exitCode = 1;
} else {
  console.log(`Secret scan passed: ${files.length} non-ignored repository files checked.`);
}
