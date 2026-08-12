import { FieldEvidence } from '@taf/core';
import { chromium } from 'playwright';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

export interface EvidenceRun {
  runIndex: number;
  testCaseName: string;
  status: 'passed' | 'failed';
  /** The data-driven input row for this run (credentials excluded) — shown as "input" columns in the summary table. */
  inputFields: Record<string, string>;
  /** Values captured during the run (e.g. a PO number) — shown as "output" columns in the summary table. */
  outputFields: Record<string, unknown>;
  fieldEvidence: FieldEvidence[];
}

function escapeHtml(value: unknown): string {
  return String(value).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string
  );
}

function imageToDataUri(path: string): string {
  const buffer = readFileSync(path);
  return `data:image/png;base64,${buffer.toString('base64')}`;
}

/**
 * Compiles annotated "field = value" screenshots and a colored input/output
 * summary table from one or more runs into a single PDF — a static, harder
 * to silently tamper with format than an editable Word document. Built as
 * HTML and printed via a throwaway headless Chromium instance (Playwright is
 * already a dependency), which also gives us a genuine repeating page header.
 */
export async function writeEvidencePdf(
  runs: EvidenceRun[],
  outPath: string,
  scenarioName: string,
  executionStartedAt: string
): Promise<void> {
  const inputKeys = Array.from(new Set(runs.flatMap((r) => Object.keys(r.inputFields))));
  const outputKeys = Array.from(new Set(runs.flatMap((r) => Object.keys(r.outputFields))));

  const runSections = runs
    .map(
      (run, index) => `
        <section${index > 0 ? ' style="page-break-before: always;"' : ''}>
          <h1>${escapeHtml(run.testCaseName)} — Run ${run.runIndex} (${run.status.toUpperCase()})</h1>
          ${run.fieldEvidence
            .map(
              (e) => `
                <h2>${escapeHtml(e.label)}</h2>
                <img class="evidence" src="${imageToDataUri(e.screenshotPath)}" />
              `
            )
            .join('\n')}
        </section>
      `
    )
    .join('\n');

  const summaryTable = `
    <section style="page-break-before: always;">
      <h1>Summary</h1>
      <table class="summary">
        <thead>
          <tr>
            <th>Run</th>
            ${inputKeys.map((k) => `<th class="input-col">${escapeHtml(k)} (input)</th>`).join('')}
            ${outputKeys.map((k) => `<th class="output-col">${escapeHtml(k)} (output)</th>`).join('')}
          </tr>
        </thead>
        <tbody>
          ${runs
            .map(
              (run) => `
                <tr>
                  <td>${run.runIndex}</td>
                  ${inputKeys.map((k) => `<td class="input-col">${escapeHtml(run.inputFields[k] ?? '')}</td>`).join('')}
                  ${outputKeys
                    .map((k) => `<td class="output-col">${escapeHtml(run.outputFields[k] ?? '')}</td>`)
                    .join('')}
                </tr>
              `
            )
            .join('')}
        </tbody>
      </table>
    </section>
  `;

  const html = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>
      * { font-family: Calibri, Arial, sans-serif; box-sizing: border-box; }
      body { font-size: 12pt; }
      h1 { font-size: 16pt; margin: 16px 0 8px; }
      h2 { font-size: 12pt; margin: 12px 0 4px; }
      img.evidence { max-width: 100%; border: 2px solid #333; border-radius: 4px; margin-bottom: 12px; }
      table.summary { border-collapse: collapse; width: 100%; margin-top: 8px; }
      table.summary th, table.summary td { border: 1px solid #999; padding: 6px 8px; font-size: 10pt; text-align: left; }
      table.summary th { font-weight: bold; }
      .input-col { background-color: #dbe9f9; }
      .output-col { background-color: #dcf3dc; }
    </style>
  </head>
  <body>
    ${runSections}
    ${summaryTable}
  </body>
</html>`;

  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'load' });
    await page.pdf({
      path: outPath,
      format: 'A4',
      printBackground: true,
      margin: { top: '60px', bottom: '40px', left: '30px', right: '30px' },
      displayHeaderFooter: true,
      headerTemplate: `
        <div style="font-size:8px; width:100%; text-align:center; font-family:Calibri, Arial, sans-serif; color:#555; padding-top:4px;">
          ${escapeHtml(scenarioName)} &mdash; Executed ${escapeHtml(executionStartedAt)}
        </div>
      `,
      footerTemplate: `<div style="font-size:8px; width:100%; text-align:center; color:#999;"><span class="pageNumber"></span> / <span class="totalPages"></span></div>`,
    });
  } finally {
    await browser.close();
  }
}

export interface AuditStep {
  module: string;
  /** Plain-English, run-specific account of what this step actually did — see Module.describe.narrate. */
  description: string;
  status: 'passed' | 'failed';
  durationMs: number;
  error?: string;
  screenshotPath?: string;
}

export interface AuditStage {
  testCaseName: string;
  status: 'passed' | 'failed';
  steps: AuditStep[];
  /** A screenshot of the final page state — only present on a passed stage; see BL-13. */
  finalScreenshotPath?: string;
  /** Annotated "field = value" screenshots captured specifically during this stage — lets the
   * PDF group evidence under the right chapter instead of one flat list at the end. */
  fieldEvidence: FieldEvidence[];
  /** Hand-authored training/audit content for this stage (see TestCase) — every field is
   * optional, and its section simply doesn't render when not supplied, so an unfamiliar test
   * case still gets a correct (if plainer) chapter instead of a broken or fabricated one. */
  objective?: string;
  preconditions?: string;
  learningObjectives?: string[];
  commonErrorsAndTips?: string[];
}

export interface GlossaryEntry {
  term: string;
  meaning: string;
}

export interface TrainingSupplement {
  /** Field label -> value to use, shown as a "repeat this yourself" table. */
  practiceFields: Record<string, string>;
  /** One checkpoint note per stage, in order, telling the reader what to write down before moving on. */
  checkpoints: string[];
  quiz: { question: string; answer: string }[];
}

export interface AuditEvidenceInput {
  runId: string;
  executionId?: string;
  planHash?: string;
  snapshotHash?: string;
  planSchemaVersion?: string | number;
  snapshotSchemaVersion?: string | number;
  dataVersions?: string[];
  targetHostname?: string;
  targetSafetyClass?: 'unknown' | 'non-production' | 'production-like';
  targetVerifiedAt?: string;
  redactionState?: 'enforced';
  memberId?: string;
  iterationId?: string;
  mode: 'chain' | 'suite' | 'batch';
  appId: string;
  status: 'passed' | 'failed';
  executedBy: string;
  startedAt: string;
  finishedAt: string;
  stages: AuditStage[];
  fieldEvidence: FieldEvidence[];
  inputFields: Record<string, string>;
  outputFields: Record<string, unknown>;
  /** Set only when the whole run failed before any stage could even start (e.g. a batch
   * group with a bad file reference) — stages will be empty in that case. */
  startFailure?: string;
  /** Hand-authored process description for "2. Process Overview" — omitted (not fabricated)
   * when the caller doesn't supply one for this particular flow. */
  narrative?: string;
  /** SAP codes/terms this flow's fields use (e.g. "OR" = Standard Order) — same reasoning as narrative. */
  glossary?: GlossaryEntry[];
  /** Renders "5. Training Supplement" when supplied. */
  trainingSupplement?: TrainingSupplement;
  /** Optional document identity supplied by a process suite. Generic, evidence-based
   * fallbacks are used when these are absent. */
  documentTitle?: string;
  documentSubtitle?: string;
  testCaseId?: string;
}

/** Locale-formatted with an explicit timezone abbreviation (e.g. "Jul 23, 2026, 8:00:59 AM GMT+5:30")
 * — a bare ISO timestamp or toLocaleString() without timeZoneName leaves the reader guessing which
 * timezone a run's timestamps are in, which matters once this ledger outlives one person's desk. */
function formatTimestamp(iso: string): string {
  // dateStyle/timeStyle can't be combined with timeZoneName per the Intl spec (they're
  // mutually exclusive with any individual component option) — spell out the components.
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    timeZoneName: 'short',
  }).format(new Date(iso));
}

function formatTotalDuration(startedAt: string, finishedAt: string): string {
  const durationSeconds = Math.max(
    0,
    Math.round((new Date(finishedAt).getTime() - new Date(startedAt).getTime()) / 1000)
  );
  const minutes = Math.floor(durationSeconds / 60);
  const seconds = durationSeconds % 60;
  return `${minutes} min ${seconds} s (${durationSeconds} s)`;
}

function inferTenant(stages: AuditStage[]): string {
  for (const step of stages.flatMap((stage) => stage.steps)) {
    const url = step.description.match(/https?:\/\/[^\s)]+/i)?.[0];
    if (!url) continue;
    try {
      return `${new URL(url).hostname} (SAP S/4HANA Cloud)`;
    } catch {
      // Continue looking rather than presenting a malformed host as verified metadata.
    }
  }
  return 'Not captured by execution';
}

function executionModeLabel(input: AuditEvidenceInput): string {
  const mode = input.mode.charAt(0).toUpperCase() + input.mode.slice(1);
  if (input.mode === 'batch') return `${mode} (chained group: ${input.appId || 'not provided'})`;
  if (input.mode === 'chain') return `${mode} (continuous browser session)`;
  return `${mode} (independent test cases)`;
}

function defaultDocumentTitle(input: AuditEvidenceInput): string {
  if (input.stages.length > 1) return 'Business Process Automation — Test Evidence & Training Guide';
  return `${input.stages[0]?.testCaseName ?? 'Automation Run'} — Test Evidence`;
}

function defaultDocumentSubtitle(input: AuditEvidenceInput): string {
  return input.stages.map((stage) => stage.testCaseName).join(' → ') || 'Execution did not start';
}

interface ResultDescriptor {
  label: string;
  producedIn: string;
}

function describeOutput(key: string, stageCount: number): ResultDescriptor {
  const known: Record<string, ResultDescriptor> = {
    soNumber: { label: 'Sales Order', producedIn: 'Scenario 1 — Create Sales Order' },
    deliveryNumber: { label: 'Outbound Delivery', producedIn: 'Scenario 2 — Create Outbound Delivery' },
    materialDocumentNumber: { label: 'Material Document (Goods Issue)', producedIn: 'Scenario 2 — Post Goods Issue' },
    billingDocumentNumber: { label: 'Billing Document (Invoice)', producedIn: 'Scenario 3 — Create Billing Document' },
    poNumber: { label: 'Purchase Order', producedIn: 'Purchase order scenario' },
    goodsReceiptNumber: { label: 'Material Document (Goods Receipt)', producedIn: 'Goods receipt scenario' },
    invoiceNumber: { label: 'Supplier Invoice', producedIn: 'Invoice scenario' },
  };
  return known[key] ?? {
    label: humanizeIdentifier(key),
    producedIn: stageCount === 1 ? 'Scenario 1' : 'See scenario step tables',
  };
}

function explainStep(step: AuditStep, action: string): string {
  if (step.status === 'failed') return step.error ? `Execution stopped: ${step.error}` : 'Execution stopped at this action';
  if (step.module === 'Login') return 'Establish an authenticated session before the business transaction begins';
  if (step.module === 'NavigateToApp') return 'Open the SAP Fiori application required for this process step';
  if (/^Entered|^Selected|^Added|^Filled/i.test(action)) return 'Provide the business data required to complete this process step';
  if (/^Captured|^Read/i.test(action)) return 'Record the generated value for audit traceability and downstream use';
  if (/^Clicked/i.test(action)) return 'Apply or advance the current business action';
  if (/^Dismissed/i.test(action)) return 'Handle an optional confirmation without changing the business outcome';
  return 'Execute the configured automation step';
}

function imageToDataUriSafe(path: string): string | null {
  if (!existsSync(path)) return null;
  try {
    return imageToDataUri(path);
  } catch {
    return null;
  }
}

/** "45935" -> "45.9 s" — plain-language duration, with a performance flag past 30s so a
 * reader scanning the table can spot the outliers without doing the ms->s math themselves. */
function formatDuration(ms: number): string {
  const seconds = (ms / 1000).toFixed(1);
  return ms > 30000 ? `${seconds} s <span class="flag">⚠ &gt;30s</span>` : `${seconds} s`;
}

/**
 * Folds any PASSED "Wait" step into the PRECEDING row as a small note instead of giving
 * it a row of its own — a bare "Waited 3000 ms" line carries no information a reader
 * needs on its own; it only matters as context for the action right before it (e.g. "a
 * settle wait after this click"). A failed Wait (essentially never happens, but not
 * impossible) is kept as its own row since that failure IS the information.
 */
function foldWaitSteps(steps: AuditStep[]): { step: AuditStep; notes: string[] }[] {
  const folded: { step: AuditStep; notes: string[] }[] = [];
  for (const step of steps) {
    if (step.module === 'Wait' && step.status === 'passed' && folded.length > 0) {
      folded[folded.length - 1].notes.push(`+ ${formatDuration(step.durationMs).replace(/<[^>]+>/g, '')} wait`);
    } else {
      folded.push({ step, notes: [] });
    }
  }
  return folded;
}

/** "salesOrderTypeField" -> "Sales Order Type", "continueButton" -> "Continue", "DisplayLogButton"
 * -> "Display Log" — splits an object-repository identifier on camelCase boundaries and drops the
 * generic control-kind suffix, since that's implementation detail rather than what a reader cares
 * about. Falls back to the identifier unchanged if it isn't in this camelCase-with-suffix shape
 * (e.g. already-human text like "Post GI" passed through ClickByText comes back unchanged). */
function humanizeIdentifier(id: string): string {
  const words = id
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[\s_]+/)
    .filter(Boolean);
  const suffixes = ['Field', 'Button', 'Checkbox', 'Column', 'Link'];
  while (words.length > 1 && suffixes.includes(words[words.length - 1])) words.pop();
  return words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

/**
 * Splits a step's own narrate() description into a plain-language action and (when present)
 * the value it acted on — e.g. "Entered salesOrderTypeField = "OR"" -> action "Entered Sales
 * Order Type", value "OR". Built against the fixed, known set of narrate() templates this
 * codebase's built-in modules actually use (see each module's describe.narrate); anything that
 * doesn't match one of those shapes is shown as-is with no value column, which is always safe —
 * it just means one less column filled in for an unrecognized module, never a wrong split.
 */
function splitStepDescription(description: string): { action: string; value: string | null } {
  let m = description.match(/^(.*?)\s*=\s*"(.*)"$/);
  if (m) {
    const action = m[1].replace(/[A-Za-z][A-Za-z0-9]*(?:Field|Button|Checkbox|Column|Link)\b/g, (id) => humanizeIdentifier(id));
    return { action, value: m[2] };
  }
  m = description.match(/^(Captured .*?)\s*=\s*(.+)$/);
  if (m) return { action: m[1], value: m[2] };
  m = description.match(/^Navigated to https?:\/\/[^#\s]+#([^?\s]+)/);
  if (m) {
    const appName = humanizeIdentifier(m[1].replace(/[-/]+/g, ' '));
    return { action: `Opened the ${appName} app`, value: `App: ${m[1]}` };
  }
  m = description.match(/^Selected row (\d+)$/);
  if (m) return { action: 'Selected row', value: m[1] };
  m = description.match(/^Selected storage location "(.*)" for line item\(s\)$/);
  if (m) return { action: 'Selected storage location', value: m[1] };
  m = description.match(/^Clicked "(.*)"$/);
  if (m) return { action: `Clicked ${humanizeIdentifier(m[1])}`, value: null };
  return { action: description, value: null };
}

function screenshotFigures(stage: AuditStage): { label: string; path: string }[] {
  return [
    ...(stage.finalScreenshotPath ? [{ label: 'Final state — proof of successful completion', path: stage.finalScreenshotPath }] : []),
    ...stage.fieldEvidence.map((e) => ({ label: e.label, path: e.screenshotPath })),
    ...stage.steps
      .filter((s) => s.status === 'failed' && s.screenshotPath)
      .map((s) => ({ label: `${s.description} — failure`, path: s.screenshotPath! })),
  ];
}

/**
 * Compiles ONE run's complete audit evidence into a single PDF, matching the full training/
 * audit document structure: numbered sections (Executive Summary, Process Overview, Scenario
 * Chapters, Traceability, Training Supplement, Appendix), a chapter per stage with its own
 * Objective/Preconditions/Learning Objectives/Screenshot Evidence/Common Errors, and a plain-
 * language step table (module descriptions split into Action + Value, seconds instead of ms, a
 * >30s performance flag). All of the hand-authored content (narrative, glossary, per-stage
 * objective/preconditions/learningObjectives/commonErrorsAndTips, trainingSupplement) is
 * optional and simply omitted when the caller hasn't supplied it for a given flow — see
 * TestCase and this file's own type docs. This keeps the generator itself flow-agnostic while
 * still producing the full document for any flow someone has taken the time to annotate.
 * Unlike writeEvidencePdf (which batches every data row of one CLI invocation into a single
 * multi-run document, opt-in via --evidence-doc), this is always one PDF per individual audit
 * ledger entry (see RunHistoryStore) — the Documents tab links straight to it.
 */
export async function writeAuditEvidencePdf(input: AuditEvidenceInput, outPath: string): Promise<void> {
  const inputKeys = Object.keys(input.inputFields);
  const outputKeys = Object.keys(input.outputFields);
  const multiStage = input.stages.length > 1;
  const documentTitle = input.documentTitle ?? defaultDocumentTitle(input);
  const documentSubtitle = input.documentSubtitle ?? defaultDocumentSubtitle(input);
  const totalDuration = formatTotalDuration(input.startedAt, input.finishedAt);
  const tenant = inferTenant(input.stages);
  const modeLabel = executionModeLabel(input);
  // HC-029: only Batch-mode config ever sets this. Chain/Suite runs structurally never do, so the
  // old "[Not assigned]" fallback put a permanently-empty field in the evidence of most runs and
  // read as missing data rather than as inapplicable. Owner's decision (10 Aug 2026): drop it.
  // Kept when it is genuinely set — for a Batch run it is real traceability, not noise.
  const testCaseId = input.testCaseId;
  const documentOutputs = outputKeys.filter(
    (key) => !/count$/i.test(key) && !['automationReference', 'automationOwner', 'transactionFailureDisposition'].includes(key)
  );
  const automationReference = input.outputFields.automationReference;
  const automationOwner = input.outputFields.automationOwner;
  const retainsFailedState = input.outputFields.transactionFailureDisposition === 'retain-for-review';

  const metadataRows = `
    <tr><td>Run ID</td><td><code>${escapeHtml(input.runId)}</code></td></tr>
    ${input.executionId ? `<tr><td>Execution ID</td><td><code>${escapeHtml(input.executionId)}</code></td></tr>` : ''}
    ${input.memberId ? `<tr><td>Plan Member</td><td><code>${escapeHtml(input.memberId)}</code></td></tr>` : ''}
    ${input.iterationId ? `<tr><td>Transaction Iteration</td><td><code>${escapeHtml(input.iterationId)}</code></td></tr>` : ''}
    ${input.planHash ? `<tr><td>Plan Hash</td><td><code>${escapeHtml(input.planHash)}</code></td></tr>` : ''}
    ${input.snapshotHash ? `<tr><td>Snapshot Hash</td><td><code>${escapeHtml(input.snapshotHash)}</code></td></tr>` : ''}
    ${input.planSchemaVersion ? `<tr><td>Plan Schema Version</td><td>${escapeHtml(input.planSchemaVersion)}</td></tr>` : ''}
    ${input.snapshotSchemaVersion ? `<tr><td>Snapshot Schema Version</td><td>${escapeHtml(input.snapshotSchemaVersion)}</td></tr>` : ''}
    ${input.dataVersions?.length ? `<tr><td>Data Versions</td><td>${input.dataVersions.map((value) => `<code>${escapeHtml(value)}</code>`).join('<br>')}</td></tr>` : ''}
    <tr><td>Execution Mode</td><td>${escapeHtml(modeLabel)}</td></tr>
    <tr><td>Started</td><td>${escapeHtml(formatTimestamp(input.startedAt))}</td></tr>
    <tr><td>Finished</td><td>${escapeHtml(formatTimestamp(input.finishedAt))}</td></tr>
    <tr><td>Total Duration</td><td>${escapeHtml(totalDuration)}</td></tr>
    <tr><td>Executed By</td><td>${escapeHtml(input.executedBy)}</td></tr>
    <tr><td>Time Zone</td><td>${escapeHtml(Intl.DateTimeFormat().resolvedOptions().timeZone || 'Runtime local time zone')}</td></tr>
    <tr><td>Tenant / Environment</td><td>${escapeHtml(input.targetHostname ?? tenant)}</td></tr>
    <tr><td>Target Safety Class</td><td>${escapeHtml(input.targetSafetyClass ?? 'Not captured')}</td></tr>
    <tr><td>Target Verified At</td><td>${escapeHtml(input.targetVerifiedAt ? formatTimestamp(input.targetVerifiedAt) : 'Not captured')}</td></tr>
    <tr><td>Redaction</td><td>${input.redactionState === 'enforced' ? 'Enforced — credentials excluded; execution logs filtered' : 'Not captured'}</td></tr>
    ${testCaseId ? `<tr><td>Test Case ID</td><td>${escapeHtml(testCaseId)}</td></tr>` : ''}
  `;

  const cover = `
    <section class="cover">
      <div class="cover-eyebrow">G-STRIDE &nbsp;·&nbsp; TEST AUTOMATION EVIDENCE</div>
      <h1>${escapeHtml(documentTitle)}</h1>
      <p class="cover-subtitle">${escapeHtml(documentSubtitle)}</p>
      <div class="cover-status status-bg-${input.status}">
        ${input.status === 'passed' ? '✓' : '×'} OVERALL RESULT: ${input.status.toUpperCase()}
      </div>
      <table class="meta cover-meta">
        <tbody>${metadataRows}</tbody>
      </table>
      <div class="cover-brand">G-Stride</div>
    </section>
  `;

  const flowDiagram = `
    <div class="flow">
      ${input.stages
        .map(
          (stage, i) =>
            `<div class="flow-step"><span class="flow-index">${i + 1}</span>${escapeHtml(stage.testCaseName)}</div>` +
            (i < input.stages.length - 1 ? '<div class="flow-arrow">&rarr;</div>' : '')
        )
        .join('')}
    </div>
  `;

  const glossarySection =
    input.glossary && input.glossary.length > 0
      ? `
        <h3>2.3 Glossary</h3>
        <table class="io glossary">
          <thead><tr><th>Code / Term</th><th>Meaning</th></tr></thead>
          <tbody>
            ${input.glossary.map((g) => `<tr><td>${escapeHtml(g.term)}</td><td>${escapeHtml(g.meaning)}</td></tr>`).join('')}
          </tbody>
        </table>
      `
      : '';

  const processOverview = `
    <h2 class="chapter">2. Process Overview</h2>
    ${input.narrative ? `<h3>2.1 Business Narrative</h3><p>${escapeHtml(input.narrative)}</p>` : ''}
    <h3>2.2 Process Flow</h3>
    ${flowDiagram}
    ${glossarySection}
  `;

  const keyResultsSection =
    documentOutputs.length > 0
      ? `
        <h3>1.2 Key Results at a Glance</h3>
        <table class="io">
          <thead><tr><th>Document</th><th>Number</th><th>Produced In</th></tr></thead>
          <tbody>
            ${documentOutputs.map((key) => {
              const descriptor = describeOutput(key, input.stages.length);
              return `<tr><td>${escapeHtml(descriptor.label)}</td><td><b>${escapeHtml(String(input.outputFields[key]))}</b></td><td>${escapeHtml(descriptor.producedIn)}</td></tr>`;
            }).join('')}
          </tbody>
        </table>
        ${multiStage ? `<p>All ${input.stages.length} scenarios were executed as one traceable business-process run. Captured outputs are carried forward by the automation where downstream steps reference them.</p>` : ''}
      `
      : '';

  const executiveSummary = `
    <h2 class="chapter">1. Cover &amp; Executive Summary</h2>
    <h3>1.1 Run Metadata</h3>
    <table class="meta full-width executive-meta">
      <thead><tr><th>Field</th><th>Value</th></tr></thead>
      <tbody>${metadataRows}</tbody>
    </table>
    ${input.startFailure ? `<p class="status-failed">Failed to start: ${escapeHtml(input.startFailure)}</p>` : ''}
    ${
      automationReference || automationOwner || retainsFailedState
        ? `<div class="compliance-box">
            <b>Transactional compliance disposition</b>
            ${automationReference ? `<p>Automation reference: <code>${escapeHtml(String(automationReference))}</code></p>` : ''}
            ${automationOwner ? `<p>Accountable run owner: ${escapeHtml(String(automationOwner))}</p>` : ''}
            <p>${input.status === 'failed'
              ? 'Execution stopped at the failed step. Created SAP documents and the failed system state were retained unchanged for compliance review; no automatic reversal was performed.'
              : 'If a transactional step fails, execution stops and the resulting SAP state is retained unchanged for compliance review; no automatic reversal is performed.'}</p>
          </div>`
        : ''
    }
    ${keyResultsSection}
  `;

  const scenarioChaptersHeading = '';

  const stageSections = input.stages
    .map((stage, stageIndex) => {
      const rows = foldWaitSteps(stage.steps);
      const images = screenshotFigures(stage);
      const chapterLabel = multiStage ? `Chapter ${stageIndex + 1} — ${escapeHtml(stage.testCaseName)}` : escapeHtml(stage.testCaseName);

      const objectiveBlock =
        stage.objective || stage.preconditions
          ? `${stage.objective ? `<p><b>Objective:</b> ${escapeHtml(stage.objective)}</p>` : ''}${
              stage.preconditions ? `<p><b>Preconditions:</b> ${escapeHtml(stage.preconditions)}</p>` : ''
            }`
          : '';

      const learningObjectivesBlock =
        stage.learningObjectives && stage.learningObjectives.length > 0
          ? `<div class="obj-box"><b>Learning Objectives</b><ul>${stage.learningObjectives.map((lo) => `<li>${escapeHtml(lo)}</li>`).join('')}</ul></div>`
          : '';

      const commonErrorsBlock =
        stage.commonErrorsAndTips && stage.commonErrorsAndTips.length > 0
          ? `<section class="common-errors-section">
               <h3>Common Errors &amp; Tips <i>(guidance, not observed failures)</i></h3>
               <div class="errors-box"><ol>${stage.commonErrorsAndTips.map((e) => `<li>${escapeHtml(e)}</li>`).join('')}</ol></div>
             </section>`
          : '';

      return `
        <section class="scenario-intro">
          ${stageIndex === 0 && multiStage ? '<h2>3. Scenario Chapters</h2>' : ''}
          <h3 class="chapter-title">${chapterLabel}</h3>
          ${objectiveBlock}
          ${learningObjectivesBlock}
        </section>
        <section class="step-table-section">
          <h4>Step Table</h4>
          <table class="modules business-steps">
            <thead>
              <tr><th>#</th><th>Business Action</th><th>Value Entered</th><th>Why</th><th>Result</th><th>Duration</th></tr>
            </thead>
            <tbody>
              ${rows
                .map(({ step: s, notes }, i) => {
                  const { action, value } = splitStepDescription(s.description);
                  return `
                    <tr>
                      <td>${stageIndex + 1}.${i + 1}</td>
                      <td title="${escapeHtml(s.module)}">${escapeHtml(action)}${s.error ? `<div class="error-cell">${escapeHtml(s.error)}</div>` : ''}</td>
                      <td>${value !== null ? `<b>${escapeHtml(value)}</b>` : '—'}</td>
                      <td>${escapeHtml(explainStep(s, action))}</td>
                      <td class="status-${s.status}">${s.status === 'passed' ? 'Passed' : 'Failed'}</td>
                      <td>${formatDuration(s.durationMs)}${notes.length ? `<div class="note">(${notes.map(escapeHtml).join(', ')})</div>` : ''}</td>
                    </tr>
                  `;
                })
                .join('')}
            </tbody>
          </table>
          <p class="captured-output status-${stage.status}">${stage.status === 'passed' ? '✓ Scenario completed successfully' : '× Scenario failed — see the error detail above'}</p>
        </section>
        ${
          images.length > 0
            ? `<section class="screenshot-section"><h4>Screenshot Evidence</h4>${images
                .map((img, imageIndex) => {
                  const dataUri = imageToDataUriSafe(img.path);
                  return dataUri
                    ? `<figure class="fig"><figcaption><b>Fig ${stageIndex + 1}.${imageIndex + 1} —</b> ${escapeHtml(img.label)}. Captured automatically during Scenario ${stageIndex + 1}.</figcaption><img class="evidence" src="${dataUri}" /></figure>`
                    : '';
                })
                .join('\n')}</section>`
            : ''
        }
        ${commonErrorsBlock}
      `;
    })
    .join('\n');

  const traceabilitySection =
    inputKeys.length > 0 || outputKeys.length > 0
      ? `
        <h2 class="chapter">4. Traceability &amp; Results Matrix</h2>
        <h3>4.1 Input / Output Table</h3>
        <table class="io">
          <thead><tr><th>Field</th><th>Type</th><th>Value</th><th>Produced / Consumed In</th>${testCaseId ? '<th>Test Case ID</th>' : ''}</tr></thead>
          <tbody>
            ${inputKeys
              .map((k) => `<tr><td>${escapeHtml(k)}</td><td class="input-col">Input</td><td>${escapeHtml(input.inputFields[k])}</td><td>Execution input</td>${testCaseId ? `<td>${escapeHtml(testCaseId)}</td>` : ''}</tr>`)
              .join('')}
            ${outputKeys
              .map((key) => {
                const descriptor = describeOutput(key, input.stages.length);
                return `<tr><td>${escapeHtml(key)}</td><td class="output-col">Output</td><td><b>${escapeHtml(String(input.outputFields[key]))}</b></td><td>${escapeHtml(descriptor.producedIn)}</td>${testCaseId ? `<td>${escapeHtml(testCaseId)}</td>` : ''}</tr>`;
              })
              .join('')}
          </tbody>
        </table>
      `
      : '';

  const trainingSupplementSection = input.trainingSupplement
    ? `
        <h2 class="chapter">5. Training Supplement</h2>
        <h3>5.1 Hands-On Practice Exercise</h3>
        <p>Repeat the full flow using the same master data as this run:</p>
        <table class="meta full-width">
          <thead><tr><th>Field</th><th>Value to Use</th></tr></thead>
          <tbody>
            ${Object.entries(input.trainingSupplement.practiceFields)
              .map(([k, v]) => `<tr><td>${escapeHtml(k)}</td><td>${escapeHtml(v)}</td></tr>`)
              .join('')}
          </tbody>
        </table>
        <h3>5.2 Checkpoints</h3>
        <ol>${input.trainingSupplement.checkpoints.map((c) => `<li>${escapeHtml(c)}</li>`).join('')}</ol>
        <h3>5.3 Self-Check Quiz</h3>
        ${input.trainingSupplement.quiz
          .map((qa, i) => `<p class="quiz-q">Q${i + 1}. ${escapeHtml(qa.question)}</p><p class="quiz-a">${escapeHtml(qa.answer)}</p>`)
          .join('')}
      `
    : '';

  const appendixSection = `
    <h2 class="chapter">${input.trainingSupplement ? '6' : '5'}. Appendix — Audit Detail (Raw Step Log, Verbatim)</h2>
    ${input.stages
      .map(
        (stage) => `
          <h3>${escapeHtml(stage.testCaseName)} — ${stage.status.toUpperCase()}</h3>
          <table class="modules">
            <thead><tr><th>Action</th><th>Status</th><th>Duration</th><th>Error</th></tr></thead>
            <tbody>
              ${stage.steps
                .map(
                  (s) => `
                    <tr>
                      <td>${escapeHtml(s.description)}</td>
                      <td class="status-${s.status}">${s.status.toUpperCase()}</td>
                      <td>${Math.round(s.durationMs)} ms</td>
                      <td class="error-cell">${escapeHtml(s.error ?? '')}</td>
                    </tr>
                  `
                )
                .join('')}
            </tbody>
          </table>
        `
      )
      .join('\n')}
  `;

  const html = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(documentTitle)}</title>
    <style>
      * { font-family: Calibri, Arial, sans-serif; box-sizing: border-box; }
      body { margin: 0; font-size: 10.5pt; line-height: 1.45; color: #20252a; }
      p { margin: 0 0 10px; }
      h1 { font-size: 23pt; line-height: 1.22; color: #0b3b60; margin: 0; }
      h2 { font-size: 16pt; color: #0b3b60; border-bottom: 2px solid #0b3b60; padding-bottom: 5px; margin: 0 0 18px; }
      h2.chapter { page-break-before: always; }
      h3.chapter-title { font-size: 14pt; color: #0b527c; margin: 0 0 16px; }
      h3 { font-size: 13pt; color: #0b527c; margin: 20px 0 10px; }
      h4 { font-size: 12pt; color: #0b527c; margin: 0 0 10px; }
      code { padding: 1px 5px; border-radius: 4px; background: #f0f3f5; font-family: Consolas, monospace; font-size: 0.92em; }
      .cover {
        display: flex;
        min-height: 220mm;
        align-items: center;
        flex-direction: column;
        justify-content: center;
        text-align: center;
        page-break-after: always;
      }
      .cover-eyebrow { margin-bottom: 22px; color: #687078; font-size: 10pt; letter-spacing: 0.2em; }
      .cover h1 { max-width: 650px; margin: 0 auto; }
      .cover-subtitle { max-width: 680px; margin: 14px auto 20px; color: #4e5459; font-size: 13pt; }
      .cover-status { min-width: 350px; margin-bottom: 28px; padding: 8px 24px; border-radius: 999px; color: #fff; font-size: 15pt; font-weight: 700; }
      .status-bg-passed { background: #187b4d; }
      .status-bg-failed { background: #b3261e; }
      .cover-brand { margin-top: 18px; color: #0b3b60; font-size: 10pt; font-weight: 700; }
      .cover-brand span { margin-left: 4px; color: #52606b; font-weight: 400; }
      .cover-brand b { color: #f36f64; }
      .badge { display: inline-block; font-weight: 700; padding: 3px 14px; border-radius: 14px; font-size: 11pt; color: #fff; }
      .badge.status-passed { background: #157347; }
      .badge.status-failed { background: #b3261e; }
      table.meta { width: 100%; border-collapse: collapse; margin: 10px 0 16px; text-align: left; }
      table.meta td, table.meta th { border: 1px solid #b9c4cc; padding: 6px 9px; font-size: 9.5pt; }
      table.meta td:first-child { width: 34%; color: #20252a; background: #f0f4f6; font-weight: 700; }
      table.meta tr:nth-child(even) td:not(:first-child) { background: #f7fafb; }
      table.meta th { color: #0b3b60; background: #eaf1f5; }
      table.cover-meta { width: 72%; margin: 0 auto; }
      table.executive-meta { margin-bottom: 22px; }
      table.modules, table.io { border-collapse: collapse; width: 100%; margin-bottom: 12px; font-size: 9pt; }
      table.modules th, table.modules td, table.io th, table.io td { border: 1px solid #b9c4cc; padding: 5px 8px; text-align: left; vertical-align: top; }
      table.modules th, table.io th { font-weight: 700; background: #eaf1f6; color: #0b3b60; }
      table.modules tr:nth-child(even) td, table.io tr:nth-child(even) td { background: #f7fafc; }
      table.glossary td:first-child { width: 22%; font-weight: 600; white-space: nowrap; }
      table.business-steps th:nth-child(1) { width: 5%; }
      table.business-steps th:nth-child(2) { width: 25%; }
      table.business-steps th:nth-child(3) { width: 18%; }
      table.business-steps th:nth-child(4) { width: 29%; }
      table.business-steps th:nth-child(5) { width: 10%; }
      table.business-steps th:nth-child(6) { width: 13%; }
      .status-passed { color: #157347; font-weight: 600; }
      .status-failed { color: #b3261e; font-weight: 600; }
      .error-cell { margin-top: 3px; color: #b3261e; font-size: 8.5pt; }
      .input-col { background-color: #dbe9f9 !important; }
      .output-col { background-color: #dcf3dc !important; }
      .note { color: #555; font-style: italic; font-weight: normal; }
      .flag { color: #b3541e; font-weight: 700; }
      .captured-output { margin: 10px 0 0; font-weight: 700; }
      .scenario-intro, .step-table-section, .screenshot-section, .common-errors-section { page-break-before: always; }
      .scenario-intro h2 { margin-bottom: 24px; }
      .fig { margin: 0 0 18px; page-break-inside: avoid; }
      .fig figcaption { margin-bottom: 7px; color: #343a40; font-size: 9.5pt; }
      img.evidence { display: block; max-width: 100%; max-height: 310px; margin: 0 auto; border: 1px solid #cfd8dd; object-fit: contain; }
      .flow { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin: 12px 0 22px; }
      .flow-step { border: 1px solid #b9c4cc; border-radius: 4px; padding: 8px 11px; font-size: 9.5pt; background: #f5f8fa; }
      .flow-index { display: inline-block; background: #0b3b60; color: #fff; border-radius: 50%; width: 18px; height: 18px; line-height: 18px; text-align: center; font-size: 8pt; margin-right: 6px; }
      .flow-arrow { color: #0b3b60; font-weight: 700; }
      .obj-box { background: #eef3fb; border-left: 5px solid #2c5f8a; padding: 10px 14px; margin: 10px 0; border-radius: 3px; }
      .obj-box ul { margin: 6px 0 0 18px; padding: 0; }
      .errors-box { background: #fff8ec; border-left: 5px solid #d68910; padding: 8px 12px; margin: 10px 0; border-radius: 3px; }
      .errors-box ol { margin: 4px 0 0 16px; padding: 0; }
      .compliance-box { background: #fff8ec; border: 1px solid #e7bd74; border-left: 5px solid #d68910; padding: 10px 14px; margin: 12px 0 20px; border-radius: 3px; }
      .compliance-box p { margin: 5px 0 0; }
      .errors-box li { margin-bottom: 5px; }
      .common-errors-section h3 { margin-top: 0; }
      .common-errors-section h3 i { color: #687078; font-size: 9pt; font-weight: 400; }
      .quiz-q { font-weight: 600; margin-top: 10px; margin-bottom: 2px; }
      .quiz-a { color: #145a32; margin: 0 0 0 10px; }
    </style>
  </head>
  <body>
    ${cover}
    ${executiveSummary}
    ${processOverview}
    ${scenarioChaptersHeading}
    ${stageSections}
    ${traceabilitySection}
    ${trainingSupplementSection}
    ${appendixSection}
  </body>
</html>`;

  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'load' });
    await page.pdf({
      path: outPath,
      format: 'A4',
      printBackground: true,
      margin: { top: '72px', bottom: '45px', left: '52px', right: '52px' },
      displayHeaderFooter: true,
      headerTemplate: `
        <div style="position:relative;z-index:1000;display:flex;width:100%;align-items:center;gap:9px;margin:0 52px;padding:8px 0 5px;color:#0b3b60;border-bottom:1px solid #cbd5dc;background:#fff;font-family:Calibri,Arial,sans-serif;">
          <strong style="flex:1;overflow:hidden;font-size:8.5pt;letter-spacing:0.08em;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(documentSubtitle.toUpperCase())}</strong>
          <span style="color:#0284c7;font-size:8pt;font-weight:700;white-space:nowrap;">G-STRIDE</span>
        </div>
      `,
      footerTemplate: '<div></div>',
    });
  } finally {
    await browser.close();
  }
}
