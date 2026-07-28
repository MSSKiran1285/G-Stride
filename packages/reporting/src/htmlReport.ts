import { RunResult } from '@taf/core';
import { writeFileSync } from 'node:fs';

export function writeHtmlReport(result: RunResult, outPath: string): void {
  const rows = result.steps
    .map(
      (s) => `<tr class="${s.status}">
        <td>${s.module}</td>
        <td>${s.status}</td>
        <td>${s.durationMs.toFixed(0)} ms</td>
        <td>${s.error ?? ''}</td>
        <td>${s.screenshotPath ? `<a href="${s.screenshotPath}">screenshot</a>` : ''}</td>
      </tr>`
    )
    .join('\n');

  const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Test Run: ${result.testCaseName}</title>
  <style>
    body { font-family: sans-serif; margin: 2rem; }
    table { border-collapse: collapse; width: 100%; }
    td, th { border: 1px solid #ccc; padding: 0.5rem; text-align: left; }
    tr.passed { background: #eafaf0; }
    tr.failed { background: #fdecea; }
    h1 { margin-bottom: 0; }
    .status-passed { color: #1a7f37; }
    .status-failed { color: #c0392b; }
  </style>
</head>
<body>
  <h1>${result.testCaseName}</h1>
  <p class="status-${result.status}">Status: ${result.status.toUpperCase()} — ${result.durationMs.toFixed(0)} ms</p>
  <table>
    <thead><tr><th>Module</th><th>Status</th><th>Duration</th><th>Error</th><th>Evidence</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <h2>Captured values</h2>
  <pre>${JSON.stringify(result.capturedValues, null, 2)}</pre>
</body>
</html>`;

  writeFileSync(outPath, html, 'utf-8');
}
