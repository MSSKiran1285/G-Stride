import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const root = process.cwd();
const outputDir = path.join(root, 'docs', 'product-guides');
const trackerPath = path.join(root, 'docs', 'ui-ux', 'PRODUCT_BACKLOG_TRACKER.html');
const qualityPath = path.join(root, 'apps', 'test-operations', 'data', 'quality-history.json');
const catalogPath = path.join(root, 'apps', 'test-operations', 'data', 'test-catalog.json');
const logoPath = path.join(root, 'packages', 'studio-web', 'public', 'ai-elk-logo-transparent.png');
const generatedDate = '30 July 2026';

function html(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function compact(value, limit = 260) {
  const text = String(value ?? '')
    .replace(/\u001b\[[0-9;]*m/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

function statusClass(value) {
  const normalized = String(value).toLowerCase().replace(/\s+/g, '-');
  return `status status-${normalized}`;
}

function statusPill(value) {
  return `<span class="${statusClass(value)}">${html(value)}</span>`;
}

function metric(value, label, note = '') {
  return `<div class="metric"><strong>${html(value)}</strong><span>${html(label)}</span>${note ? `<small>${html(note)}</small>` : ''}</div>`;
}

function sectionTitle(number, title, kicker = '') {
  return `<header class="section-title">${kicker ? `<p class="eyebrow">${html(kicker)}</p>` : ''}<h2><span>${html(number)}</span>${html(title)}</h2></header>`;
}

function cover(title, subtitle, documentCode, logoData) {
  return `
    <section class="cover">
      <div class="cover-brand"><img src="${logoData}" alt="AI ELK logo"><div><strong>QA/4HANA Studio</strong><span>by aielk</span></div></div>
      <div class="cover-copy">
        <p class="eyebrow">Product documentation · Current verified build</p>
        <h1>${html(title)}</h1>
        <p class="cover-subtitle">${html(subtitle)}</p>
      </div>
      <div class="cover-meta">
        <div><span>Document</span><strong>${html(documentCode)}</strong></div>
        <div><span>Product baseline</span><strong>QA/4HANA Studio 2.1.0 development line; v2.0.0 remains frozen</strong></div>
        <div><span>Prepared</span><strong>${generatedDate}</strong></div>
        <div><span>Classification</span><strong>Internal product and training documentation</strong></div>
      </div>
      <p class="cover-note">Screens containing configured target or account information have been anonymized. Passwords and credential values are never included.</p>
    </section>`;
}

const baseStyles = `
  :root {
    --navy: #092744;
    --navy-2: #173b5c;
    --coral: #f26d60;
    --coral-dark: #b93e35;
    --coral-soft: #fff0ed;
    --green: #087f5b;
    --green-soft: #e8f8f2;
    --amber: #9a6700;
    --amber-soft: #fff6dc;
    --red: #b4232f;
    --red-soft: #ffebed;
    --blue-soft: #eef5fb;
    --line: #d7e2ec;
    --muted: #587086;
    --paper: #ffffff;
    --ink: #092744;
  }
  * { box-sizing: border-box; }
  html { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
  body { margin: 0; color: var(--ink); font-family: "Segoe UI", Arial, sans-serif; font-size: 10.2pt; line-height: 1.48; background: white; }
  @page { size: A4; margin: 18mm 14mm 18mm; }
  a { color: var(--coral-dark); text-decoration: none; }
  h1, h2, h3, h4 { margin: 0; color: var(--navy); line-height: 1.18; }
  h1 { font-size: 30pt; letter-spacing: -0.8px; }
  h2 { font-size: 20pt; margin: 0 0 5mm; }
  h3 { font-size: 14pt; margin: 5mm 0 2.5mm; }
  h4 { font-size: 11pt; margin: 4mm 0 1.5mm; }
  p { margin: 0 0 3mm; }
  ul, ol { margin: 2mm 0 4mm; padding-left: 6mm; }
  li { margin-bottom: 1.3mm; }
  .cover { min-height: 255mm; display: flex; flex-direction: column; page-break-after: always; padding: 5mm 2mm 0; }
  .cover::before { content: ""; position: absolute; inset: 0 0 auto; height: 6mm; background: var(--coral); }
  .cover-brand { display: flex; gap: 4mm; align-items: center; margin-top: 5mm; }
  .cover-brand img { width: 22mm; height: 22mm; object-fit: contain; }
  .cover-brand strong { display: block; font-size: 16pt; }
  .cover-brand span { display: block; color: var(--coral-dark); font-weight: 700; }
  .cover-copy { margin: 45mm 0 auto; max-width: 160mm; }
  .cover-subtitle { font-size: 15pt; color: var(--navy-2); max-width: 150mm; margin-top: 7mm; }
  .cover-meta { display: grid; grid-template-columns: 1fr 1fr; border-top: 1px solid var(--line); border-bottom: 1px solid var(--line); }
  .cover-meta div { padding: 4mm; border-right: 1px solid var(--line); border-bottom: 1px solid var(--line); }
  .cover-meta div:nth-child(2n) { border-right: 0; }
  .cover-meta span { display: block; text-transform: uppercase; letter-spacing: .7px; font-size: 7.5pt; color: var(--muted); }
  .cover-meta strong { display: block; margin-top: 1mm; }
  .cover-note { color: var(--muted); font-size: 8.5pt; margin: 5mm 0 0; }
  .eyebrow { color: var(--coral-dark); text-transform: uppercase; letter-spacing: 1px; font-weight: 800; font-size: 8pt; margin: 0 0 2mm; }
  .section-title { page-break-before: always; border-bottom: 2px solid var(--coral); padding-bottom: 3mm; margin-bottom: 5mm; }
  .section-title h2 { display: flex; align-items: center; gap: 3mm; margin: 0; }
  .section-title h2 span { display: grid; place-items: center; background: var(--coral); color: white; width: 10mm; height: 10mm; border-radius: 50%; font-size: 11pt; }
  .lead { font-size: 12pt; color: var(--navy-2); max-width: 175mm; }
  .note, .callout { border-left: 4px solid var(--coral); background: var(--coral-soft); padding: 3.5mm 4mm; margin: 4mm 0; break-inside: avoid; }
  .callout.warning { border-color: #c47d00; background: var(--amber-soft); }
  .callout.success { border-color: var(--green); background: var(--green-soft); }
  .metrics { display: grid; grid-template-columns: repeat(4, 1fr); gap: 3mm; margin: 5mm 0; }
  .metric { border: 1px solid var(--line); border-radius: 3mm; padding: 4mm; background: #fff; min-height: 27mm; }
  .metric strong { display: block; color: var(--navy); font-size: 21pt; line-height: 1; }
  .metric span { display: block; font-weight: 700; margin-top: 2mm; }
  .metric small { display: block; color: var(--muted); margin-top: 1mm; }
  .two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 5mm; }
  .three-col { display: grid; grid-template-columns: repeat(3, 1fr); gap: 4mm; }
  .card { border: 1px solid var(--line); border-radius: 3mm; padding: 4mm; background: white; break-inside: avoid; margin-bottom: 4mm; }
  .card h3 { margin-top: 0; }
  .card p:last-child { margin-bottom: 0; }
  .status { display: inline-block; border-radius: 99px; padding: .8mm 2.2mm; font-size: 7.5pt; font-weight: 800; white-space: nowrap; }
  .status-implemented, .status-remediated { color: var(--green); background: var(--green-soft); border: 1px solid #a6dfcb; }
  .status-partial, .status-deferred { color: var(--amber); background: var(--amber-soft); border: 1px solid #ead49a; }
  .status-not-started, .status-open { color: var(--red); background: var(--red-soft); border: 1px solid #f3b8be; }
  table { width: 100%; border-collapse: collapse; margin: 3mm 0 5mm; font-size: 8.5pt; }
  thead { display: table-header-group; }
  th { text-align: left; background: var(--navy); color: white; padding: 2.3mm; font-weight: 700; }
  td { border: 1px solid var(--line); padding: 2.2mm; vertical-align: top; }
  tr { break-inside: avoid; }
  .striped tbody tr:nth-child(even) { background: #f7fafc; }
  .small { font-size: 8pt; color: var(--muted); }
  .muted { color: var(--muted); }
  .toc { columns: 2; column-gap: 8mm; margin-top: 6mm; }
  .toc a { display: block; border-bottom: 1px dotted var(--line); padding: 2mm 0; break-inside: avoid; color: var(--navy); }
  .toc strong { display: inline-block; color: var(--coral-dark); width: 8mm; }
  .workspace-card { border-top: 4px solid var(--coral); }
  .workspace-card ul { margin-bottom: 0; }
  .backlog-item { page-break-before: always; }
  .backlog-item:first-child { page-break-before: auto; }
  .backlog-head { display: grid; grid-template-columns: 1fr auto; gap: 5mm; align-items: start; border-bottom: 1px solid var(--line); padding-bottom: 3mm; }
  .backlog-id { color: var(--coral-dark); font-weight: 900; letter-spacing: .8px; }
  .meta-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 2mm; margin: 3mm 0; }
  .meta-grid div { background: var(--blue-soft); padding: 2.5mm; border-radius: 2mm; }
  .meta-grid span { display: block; color: var(--muted); text-transform: uppercase; font-size: 7pt; letter-spacing: .5px; }
  .meta-grid strong { display: block; margin-top: 1mm; }
  .criterion { display: grid; grid-template-columns: 10mm 1fr 25mm; gap: 2mm; align-items: start; padding: 2.5mm 0; border-bottom: 1px solid var(--line); break-inside: avoid; }
  .criterion .num { display: grid; place-items: center; width: 7mm; height: 7mm; border-radius: 50%; background: var(--blue-soft); font-weight: 800; }
  .criterion .status { text-align: center; }
  .screen { border: 1px solid var(--line); border-radius: 3mm; overflow: hidden; margin: 4mm 0; break-inside: avoid; }
  .screen img { display: block; width: 100%; height: auto; }
  .screen figcaption { padding: 2.5mm 3mm; color: var(--muted); font-size: 8pt; border-top: 1px solid var(--line); }
  .procedure { counter-reset: workstep; list-style: none; padding: 0; }
  .procedure > li { counter-increment: workstep; position: relative; padding: 0 0 4mm 12mm; margin: 0; break-inside: avoid; }
  .procedure > li::before { content: counter(workstep); position: absolute; left: 0; top: 0; width: 8mm; height: 8mm; border-radius: 50%; background: var(--coral); color: white; font-weight: 900; display: grid; place-items: center; }
  .procedure strong { display: block; margin-bottom: 1mm; }
  .expected { display: block; color: var(--green); font-size: 8.5pt; margin-top: 1mm; }
  .faq { margin: 0 0 4mm; padding: 4mm; border: 1px solid var(--line); border-left: 4px solid var(--coral); border-radius: 2mm; break-inside: avoid; }
  .faq h3 { font-size: 11pt; margin: 0 0 2mm; }
  .faq p { margin: 0; }
  .page-break { page-break-before: always; }
  .keep { break-inside: avoid; }
  code { font-family: Consolas, monospace; font-size: 8.5pt; color: var(--navy); background: var(--blue-soft); padding: .4mm 1mm; border-radius: 1mm; }
`;

function documentShell(title, body) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${html(title)}</title><style>${baseStyles}</style></head><body>${body}</body></html>`;
}

async function dataUri(file) {
  const bytes = await fs.readFile(file);
  const ext = path.extname(file).slice(1);
  return `data:image/${ext === 'jpg' ? 'jpeg' : ext};base64,${bytes.toString('base64')}`;
}

async function screenFigure(file, caption) {
  const uri = await dataUri(path.join(outputDir, 'screens', file));
  return `<figure class="screen"><img src="${uri}" alt="${html(caption)}"><figcaption>${html(caption)} · anonymized current-build capture</figcaption></figure>`;
}

function readBacklog(source) {
  const start = source.indexOf('const backlog = [');
  const end = source.indexOf('\n    ];', start);
  if (start < 0 || end < 0) throw new Error('Could not locate backlog array in tracker.');
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(`${source.slice(start, end + 7)}\nresult = backlog;`, sandbox);
  return sandbox.result;
}

const criterionOverrides = {
  'BL-018': ['Open', 'Implemented', 'Open'],
  'BL-019': ['Open', 'Open', 'Open'],
  'BL-022': ['Partial', 'Partial', 'Open', 'Implemented'],
  'BL-023': ['Implemented', 'Implemented', 'Implemented', 'Open'],
  'BL-025': ['Partial', 'Open', 'Open', 'Implemented'],
  'BL-031': ['Partial', 'Implemented', 'Implemented', 'Open'],
  'BL-032': ['Implemented', 'Implemented', 'Open', 'Implemented'],
  'BL-035': ['Partial', 'Partial', 'Partial', 'Implemented'],
};

function criterionStatus(item, index) {
  if (item.status === 'Implemented') return 'Implemented';
  if (item.status === 'Deferred') return 'Deferred';
  if (item.status === 'Not started') return 'Open';
  return criterionOverrides[item.id]?.[index] ?? 'Partial';
}

const nextActions = {
  'BL-018': 'Make every recent item route to its exact artifact or run and add failure, stale-draft and readiness attention queues.',
  'BL-019': 'Persist owner cost assumptions, add explicit metric scope/freshness, filtered trends and accessible tables.',
  'BL-022': 'Add selector stability, usage and verification metadata plus dependency-safe rename and removal.',
  'BL-023': 'Carry the originating Compose field through live capture and return the saved object without losing edits.',
  'BL-024': 'Create selector health scoring, history, live comparison, similarity detection and attributable change audit.',
  'BL-025': 'Build the dataset library, typed/sensitive columns and dependency impact for rename or removal.',
  'BL-031': 'Persist the complete six-level event hierarchy and reconcile child totals across monitor, history, metrics and evidence.',
  'BL-032': 'Add exact terminal-failure correction links to the owning Test, object, dataset, mapping or setting.',
  'BL-035': 'Move filters, pagination, sorting and complete parent/child lineage traversal to the server.',
  'BL-037': 'Build an authorized cross-artifact index and dependency graph before exposing global search.',
  'BL-039': 'Keep deferred until multi-user requirements and role ownership are explicitly approved.',
  'BL-040': 'Keep deferred until schedules, notifications, target capacity and concurrency governance are designed.',
};

const workspaceFeatures = [
  {
    name: 'Automation Overview',
    purpose: 'A task-focused landing canvas for status, value, recent work and quick entry.',
    features: [
      'Live counts for Tests, Business Processes, controls and evidence records.',
      'Recorded execution totals, pass/fail outcomes and automated runtime.',
      'Transparent modeled manual effort, potential time saved and cost-saved scenarios.',
      'Recent work cards and direct Create Test / New Execution actions.',
      'Authoritative configured-target state displayed in the shared header.',
    ],
    gap: 'Exact recent-item deep links, readiness alerts, saved cost preferences and accessible historical trends remain.',
  },
  {
    name: 'Control Object Repository',
    purpose: 'Capture, curate and reuse SAP UI controls instead of duplicating selectors in Tests.',
    features: [
      'Live-screen scan starts from the configured SAP target.',
      'Bulk scan and continuous Ctrl/Cmd interactive picking with duplicate detection.',
      'Domain/App ID browsing, local filtering, stable object routes and live highlight.',
      'Object edit, delete and keyboard-accessible ordering.',
      'Explicit App ID confirmation and curation before saving.',
    ],
    gap: 'Persistent selector health/history, dependency-aware changes and contextual return to Compose remain.',
  },
  {
    name: 'Compose',
    purpose: 'Find, create, edit, validate and publish reusable Single Tests.',
    features: [
      'Routeable Test Library with name, process-area, application and readiness filters.',
      'Guided blank-or-template creation with conflict-safe persistence.',
      'Visual typed Test contracts with input/output types and sensitivity.',
      'Step values distinguish literals, datasets, system context and prior outputs.',
      'Schema-driven ModuleCall editing, reusable object selection and keyboard reordering.',
      'Publish blocking for unresolved values, missing parameters/objects and output collisions.',
    ],
    gap: 'No outstanding BL-020/BL-021 acceptance gap after the current reconciliation.',
  },
  {
    name: 'Test Data',
    purpose: 'Author reusable scalar, tabular, nested and relational transaction data.',
    features: [
      'Flat CSV creation/editing with rich RFC4180 round-trip and dirty-state protection.',
      'Nested JSON transaction authoring for one or many headers with owned line items.',
      'Relational CSV builder with header/child keys and owned collection preview.',
      'Validation for duplicate keys, orphan children, missing keys and name collisions.',
      'Effective-data preview and immutable execution snapshots through preflight.',
    ],
    gap: 'The full searchable library, typed/sensitive columns and dependency-safe rename/removal remain.',
  },
  {
    name: 'Processes & Packs',
    purpose: 'Model sequential business flows and independent regression collections visually.',
    features: [
      'Business Processes sequence Tests and carry typed outputs into later stage inputs.',
      'Visual stage ordering, lifecycle, domain, application and data bindings.',
      'Validation for unresolved inputs, cycles, forward references, unknown/duplicate outputs and type mismatch.',
      'Regression Packs contain independent Test or Business Process members.',
      'Member-specific data, application, session and failure policies with draft/published lifecycle.',
      'Stable routes and direct execution of published mixed Saved Packs.',
    ],
    gap: 'No outstanding BL-028/BL-029 acceptance gap after the current reconciliation.',
  },
  {
    name: 'Execution Center',
    purpose: 'Prepare, preflight, approve, run, monitor and safely rerun controlled automation.',
    features: [
      'Execution types: Single Test, Business Process, Pack · Tests, Pack · Processes and Saved Pack.',
      'Four-stage flow: Scope, Data & policies, Preflight and Review.',
      'Server-owned preflight validates target, credentials, artifacts, versions, data, contracts and policies.',
      'Exact effective-data preview, mapping review, plan hash and immutable snapshot.',
      'Determinate progress for known work, persisted run routes and reconnect recovery.',
      'Fail-stop transaction behavior retains earlier evidence; no automatic reversal.',
      'Rerun difference review, immutable lineage and failed-scope safety restrictions.',
    ],
    gap: 'Complete six-level event persistence/reconciliation and exact terminal-failure correction links remain.',
  },
  {
    name: 'Audit & Evidence',
    purpose: 'Search immutable execution history and open one canonical evidence record per run.',
    features: [
      'Flat newest-first run library rather than date-folder navigation.',
      'Search and client filters for outcome, mode and date.',
      'Stable audit detail routes with executor, target and source context.',
      'Canonical evidence PDF shared with Execution Center—no duplicate evidence document.',
      'Evidence branding, Test name headers, redaction and retention governance.',
      'Preserved rerun lineage and immutable execution identifiers.',
    ],
    gap: 'Server-side multi-field filtering, paging/sorting and full parent/child lineage traversal remain.',
  },
  {
    name: 'Settings, identity and account menu',
    purpose: 'Control owner identity, appearance, help and test-system connections.',
    features: [
      'Single preserved workspace-owner identity with Google registration/sign-in support.',
      'Profile menu provides Settings, Help and Sign out.',
      'Appearance selection is managed inside Settings.',
      'SAP connection captures target URL and credentials without returning passwords to the browser.',
      'OS credential vault where available and encrypted local fallback for detached Windows sessions.',
      'Salesforce, Oracle and ServiceNow connection panels retained as future configuration surfaces.',
    ],
    gap: 'Multi-user roles remain intentionally deferred; only SAP is integrated with execution and live scan.',
  },
  {
    name: 'QA/4HANA Test Operations companion app',
    purpose: 'Provide release-quality visibility across the automated product test estate.',
    features: [
      'Repository-generated 149-test catalogue grouped by feature and workspace.',
      'Latest status, execution mode and recorded duration per test.',
      'Historical execution dashboard backed by recorded runs.',
      'Persistent failure ledger including failures later remediated and passed.',
    ],
    gap: 'It is an operational companion rather than a primary Studio workspace.',
  },
];

const defectResolution = {
  'FL-0016': 'Reconciled the UI assertion with hierarchical Batch completion wording and reverified both live smoke groups.',
  'FL-0015': 'Aligned the correction journey with the route-aware dataset selection flow and reverified the exact dataset route.',
  'FL-0014': 'Corrected isolated Test fixture provisioning so the detail endpoint returns the persisted Test.',
  'FL-0013': 'Corrected isolated Test fixture discovery so known Tests appear in the list.',
  'FL-0012': 'Corrected isolated Business Process fixture identity and response expectations.',
  'FL-0011': 'Corrected isolated Business Process fixture discovery for the O2C process.',
  'FL-0010': 'Corrected isolated CSV fixture provisioning and header expectations.',
  'FL-0009': 'Corrected isolated data fixture discovery for P2P data.',
  'FL-0008': 'Reconciled Pack · Processes completion output with the two-member hierarchical result.',
  'FL-0007': 'Stabilized synthetic Pack · Tests execution completion and polling within the supported run lifecycle.',
  'FL-0006': 'Stabilized synthetic multi-stage Business Process completion and polling.',
  'FL-0005': 'Corrected the synthetic Pack · Processes execution path and verified two independent members.',
  'FL-0004': 'Corrected the synthetic Batch compatibility execution path and completion state.',
  'FL-0003': 'Corrected the synthetic Pack · Tests execution path and independent member results.',
  'FL-0002': 'Corrected the synthetic Business Process execution path and ordered stage results.',
  'FL-0001': 'Aligned the Overview fixture/API state with the approved Canvas First metrics and shell.',
};

function backlogDetails(backlog) {
  return backlog.map((item) => `
    <article class="backlog-item" id="${html(item.id)}">
      <div class="backlog-head">
        <div><p class="backlog-id">${html(item.id)}${item.legacy ? ` · ${html(item.legacy)}` : ''}</p><h3>${html(item.title)}</h3></div>
        ${statusPill(item.status)}
      </div>
      <div class="meta-grid">
        <div><span>Priority</span><strong>${html(item.priority)}</strong></div>
        <div><span>Planned tranche</span><strong>${html(item.plannedTranche ?? item.release)}</strong></div>
        <div><span>Actual release</span><strong>${html(item.actualRelease ?? 'Not yet delivered')}</strong></div>
        <div><span>Workspace</span><strong>${html((item.workspace ?? []).join(', '))}</strong></div>
        <div><span>Acceptance</span><strong>${html(item.acceptanceProgress ?? (item.status === 'Deferred' ? 'Deferred' : '0/' + item.criteria.length))}</strong></div>
      </div>
      <h4>Description</h4><p>${html(item.description)}</p>
      <h4>User story</h4><p>${html(item.story)}</p>
      <h4>Acceptance criteria</h4>
      <div>
        ${(item.criteria ?? []).map((criterion, index) => {
          const state = criterionStatus(item, index);
          return `<div class="criterion"><span class="num">${index + 1}</span><span>${html(criterion)}</span>${statusPill(state)}</div>`;
        }).join('')}
      </div>
      <h4>Implementation coverage</h4><p>${html(item.coverage)}</p>
      <p class="small"><strong>Evidence:</strong> ${html((item.evidence ?? []).join(' · ') || 'Not yet assigned')}<br><strong>Last reconciled:</strong> ${html(item.updated ?? 'Not recorded')}</p>
    </article>`).join('');
}

async function implementationReport({ backlog, quality, catalogCount, logoData }) {
  const statusCounts = Object.fromEntries(['Implemented', 'Partial', 'Not started', 'Deferred'].map(
    (state) => [state, backlog.filter((item) => item.status === state).length],
  ));
  const accepted = backlog.reduce((sum, item) => sum + Number(String(item.acceptanceProgress ?? '0/0').split('/')[0] || 0), 0);
  const criteriaTotal = backlog.reduce((sum, item) => sum + (item.criteria?.length ?? 0), 0);
  const openItems = backlog.filter((item) => item.status !== 'Implemented');
  const defects = quality.failureLedger ?? [];
  const executions = quality.executionHistory ?? [];

  const workspaceCards = workspaceFeatures.map((workspace) => `
    <article class="card workspace-card">
      <h3>${html(workspace.name)}</h3>
      <p>${html(workspace.purpose)}</p>
      <ul>${workspace.features.map((feature) => `<li>${html(feature)}</li>`).join('')}</ul>
      <p class="small"><strong>Remaining consideration:</strong> ${html(workspace.gap)}</p>
    </article>`).join('');

  const defectRows = defects.map((defect) => `
    <tr>
      <td><strong>${html(defect.id)}</strong><br>${statusPill(defect.state)}</td>
      <td>${html(defect.area)}<br><span class="small">${html(defect.mode)} · ${html(defect.targetClass)}</span></td>
      <td><strong>${html(defect.test)}</strong><br><span class="small">${html(compact(defect.error, 220))}</span></td>
      <td>${html(defectResolution[defect.id] ?? defect.remediation)}<br><span class="small">Verified: ${html(defect.remediationRunId)}</span></td>
    </tr>`).join('');

  const openRows = openItems.map((item) => {
    const remaining = item.criteria.filter((_, index) => criterionStatus(item, index) !== 'Implemented');
    return `<tr>
      <td><strong>${html(item.id)}</strong><br>${statusPill(item.status)}</td>
      <td><strong>${html(item.title)}</strong><br><span class="small">${html((item.workspace ?? []).join(', '))} · ${html(item.priority)}</span></td>
      <td><ul>${remaining.map((criterion) => `<li>${html(criterion)}</li>`).join('')}</ul></td>
      <td>${html(nextActions[item.id] ?? 'Refine and schedule the remaining acceptance criteria.')}</td>
    </tr>`;
  }).join('');

  const toc = [
    ['1', 'Executive implementation summary'],
    ['2', 'Detailed features by workspace'],
    ['3', 'Granular product backlog and acceptance status'],
    ['4', 'Defects and issues fixed'],
    ['5', 'Items requiring remediation or future delivery'],
    ['6', 'Verification evidence and recommended next sequence'],
  ].map(([n, label]) => `<a href="#section-${n}"><strong>${n}</strong>${html(label)}</a>`).join('');

  const body = `
    ${cover('Product Implementation, Backlog and Defect Status Report', 'A detailed evidence-based account of implemented functionality, every user story and acceptance criterion, remediated defects, remaining product gaps, and workspace-level capability.', 'Q4H-PROD-STATUS-2.0', logoData)}
    <section>
      <p class="eyebrow">Document map</p><h2>Contents</h2><div class="toc">${toc}</div>
      <div class="callout"><strong>Interpretation rule.</strong> “Implemented” means the tracker criterion is covered by repository evidence. “Partial” identifies delivered capability that still has acceptance work. “Open” is not yet accepted. “Deferred” is intentionally outside the current release scope.</div>
    </section>

    <section id="section-1">
      ${sectionTitle('1', 'Executive implementation summary', 'Current product position')}
      <p class="lead">QA/4HANA Studio is a working, Canvas First SAP test-automation product spanning reusable authoring, controlled execution, immutable evidence and operational quality reporting.</p>
      <div class="metrics">
        ${metric(backlog.length, 'Backlog items')}
        ${metric(statusCounts.Implemented, 'Implemented')}
        ${metric(`${accepted}/${criteriaTotal}`, 'Accepted criteria')}
        ${metric(catalogCount, 'Catalogue tests')}
      </div>
      <div class="metrics">
        ${metric(statusCounts.Partial, 'Partial items')}
        ${metric(statusCounts['Not started'], 'Not started')}
        ${metric(statusCounts.Deferred, 'Deferred')}
        ${metric(`${defects.filter((item) => item.state === 'Remediated').length}/${defects.length}`, 'Defects remediated')}
      </div>
      <div class="two-col">
        <div class="card"><h3>Delivered product spine</h3><ul>
          <li>Owner identity, encrypted SAP credential handling and authoritative target classification.</li>
          <li>Routeable Tests, datasets, Business Processes, Regression Packs, runs and audit records.</li>
          <li>Typed visual authoring from Single Test contracts through sequential hand-offs and independent Packs.</li>
          <li>Server-owned preflight, immutable effective-data snapshots, controlled execution and safe reruns.</li>
          <li>One canonical evidence PDF referenced by both Execution Center and Audit & Evidence.</li>
          <li>Accessible responsive shell, NVDA verification and release-governance evidence.</li>
        </ul></div>
        <div class="card"><h3>Current quality position</h3><ul>
          <li>Latest final source verification: 57 core, 44 isolated API and 40 isolated UI checks passed.</li>
          <li>Eight live-SAP checks remained deliberately gated in the final source verification.</li>
          <li>High-confidence secret scan passed across 259 non-ignored repository files.</li>
          <li>${html(executions.length)} recorded quality runs are retained in the current quality history.</li>
          <li>All ${html(defects.length)} recorded historical failures have a remediation run; no open ledger defect remains.</li>
        </ul></div>
      </div>
      <div class="callout warning"><strong>Important distinction.</strong> The absence of an open recorded defect does not mean the backlog is complete. ${openItems.length} items still contain partial, open or deferred acceptance scope and are listed in Section 5.</div>
    </section>

    <section id="section-2">
      ${sectionTitle('2', 'Detailed features by workspace', 'Functional inventory')}
      <p class="lead">The following inventory describes current behavior rather than the original navigation labels. Business Processes and Regression Packs share one “Processes & Packs” workspace.</p>
      ${workspaceCards}
    </section>

    <section id="section-3">
      ${sectionTitle('3', 'Granular product backlog and acceptance status', '41-item source of truth')}
      <p class="lead">Every consolidated backlog item is shown with its description, user story, release/priority metadata, criterion-by-criterion status, implementation coverage and evidence.</p>
      <table class="striped">
        <thead><tr><th>Status</th><th>Items</th><th>Meaning</th></tr></thead>
        <tbody>
          <tr><td>${statusPill('Implemented')}</td><td>${statusCounts.Implemented}</td><td>All recorded acceptance criteria are satisfied.</td></tr>
          <tr><td>${statusPill('Partial')}</td><td>${statusCounts.Partial}</td><td>Some functionality exists; one or more criteria still need delivery.</td></tr>
          <tr><td>${statusPill('Not started')}</td><td>${statusCounts['Not started']}</td><td>No acceptance criterion is complete.</td></tr>
          <tr><td>${statusPill('Deferred')}</td><td>${statusCounts.Deferred}</td><td>Deliberately outside the present release scope.</td></tr>
        </tbody>
      </table>
      ${backlogDetails(backlog)}
    </section>

    <section id="section-4">
      ${sectionTitle('4', 'Defects and issues fixed', 'Recorded failure ledger')}
      <p class="lead">The product test ledger preserves failures even after remediation. All ${defects.length} recorded failures are remediated and linked to a subsequent verifying run.</p>
      <table class="striped">
        <thead><tr><th style="width:14%">ID / status</th><th style="width:17%">Area / mode</th><th style="width:34%">Observed failure</th><th>Resolution evidence</th></tr></thead>
        <tbody>${defectRows}</tbody>
      </table>
      <div class="callout success"><strong>Open defect count: zero in the recorded ledger.</strong> This statement is limited to the repository-backed failure ledger as of ${generatedDate}; newly reported production observations must still be logged and triaged.</div>
    </section>

    <section id="section-5">
      ${sectionTitle('5', 'Items requiring remediation or future delivery', 'Remaining acceptance scope')}
      <p class="lead">These are product gaps or intentionally deferred capabilities, not unverified claims of production defects.</p>
      <table class="striped">
        <thead><tr><th style="width:13%">ID / status</th><th style="width:25%">Item</th><th style="width:37%">Criteria still requiring work</th><th>Recommended remediation</th></tr></thead>
        <tbody>${openRows}</tbody>
      </table>
    </section>

    <section id="section-6">
      ${sectionTitle('6', 'Verification evidence and recommended next sequence', 'Delivery guidance')}
      <div class="two-col">
        <div class="card"><h3>Evidence base used</h3><ul>
          <li>Authoritative HTML Product Backlog Tracker.</li>
          <li>Repository-generated ${catalogCount}-test operations catalogue.</li>
          <li>Recorded execution and failure history.</li>
          <li>Core, API, UI, accessibility, secret-scan and live-run documentation.</li>
          <li>Current production build source and anonymized workspace captures.</li>
        </ul></div>
        <div class="card"><h3>Recommended next implementation sequence</h3><ol>
          <li>BL-018 and BL-019: complete Overview deep links, alerts and governed analytics.</li>
          <li>BL-022 through BL-025: finish object and data governance foundations.</li>
          <li>BL-031, BL-032 and BL-035: close execution hierarchy, diagnosis and audit traversal.</li>
          <li>BL-037: add global search only after dependency metadata is reliable.</li>
          <li>Retain BL-039 and BL-040 as deferred until multi-user and scheduling scope is approved.</li>
        </ol></div>
      </div>
      <div class="callout"><strong>Change-control recommendation.</strong> Update the HTML tracker and regenerate this report after each accepted backlog tranche. Record every failed automated case in the durable ledger even when it is subsequently remediated.</div>
    </section>`;
  return documentShell('QA/4HANA Studio — Product Implementation Status Report', body);
}

async function trainingWorkInstruction(logoData) {
  const figures = {
    overview: await screenFigure('01-automation-overview.png', 'Automation Overview'),
    objects: await screenFigure('02-control-object-repository.png', 'Control Object Repository'),
    library: await screenFigure('03-compose-test-library.png', 'Compose — Test Library'),
    editor: await screenFigure('04-compose-test-editor.png', 'Compose — Test editor'),
    data: await screenFigure('05-test-data.png', 'Test Data'),
    processes: await screenFigure('06-business-processes.png', 'Processes & Packs — Business Process entry'),
    processEditor: await screenFigure('07-business-process-editor.png', 'Processes & Packs — Business Process editor'),
    packs: await screenFigure('08-regression-packs.png', 'Processes & Packs — Regression Packs'),
    execution: await screenFigure('09-execution-center.png', 'Execution Center — new controlled run'),
    audit: await screenFigure('10-audit-and-evidence.png', 'Audit & Evidence'),
  };

  function instruction(number, title, purpose, figure, steps, expected, cautions = []) {
    return `<section>
      ${sectionTitle(number, title, 'Screen-by-screen instruction')}
      <p class="lead">${html(purpose)}</p>
      ${figure ?? ''}
      <h3>Procedure</h3>
      <ol class="procedure">${steps.map((step) => `<li><strong>${html(step.action)}</strong>${html(step.detail)}${step.expected ? `<span class="expected">Expected: ${html(step.expected)}</span>` : ''}</li>`).join('')}</ol>
      <div class="callout success"><strong>Completion check.</strong> ${html(expected)}</div>
      ${cautions.length ? `<div class="callout warning"><strong>Watch for:</strong><ul>${cautions.map((item) => `<li>${html(item)}</li>`).join('')}</ul></div>` : ''}
    </section>`;
  }

  const body = `
    ${cover('User Training Work Instruction', 'Detailed screen-by-screen operating instruction for workspace owners, functional consultants, test authors and execution operators.', 'Q4H-WI-USER-2.0', logoData)}
    <section>
      <p class="eyebrow">Before you begin</p><h2>Audience, prerequisites and safety</h2>
      <div class="two-col">
        <div class="card"><h3>Audience</h3><ul><li>Workspace owner or administrator</li><li>Functional consultant / Test author</li><li>Automation engineer</li><li>Execution operator</li><li>Auditor or evidence reviewer</li></ul></div>
        <div class="card"><h3>Prerequisites</h3><ul><li>Access to the Studio URL</li><li>A preserved owner account</li><li>A configured non-production SAP target</li><li>Authorized test data and business references</li><li>Approved permission for transactional runs</li></ul></div>
      </div>
      <div class="callout warning"><strong>Safety rule.</strong> A failed transactional Test stops at the failing stage and retains evidence. Do not automatically reverse or delete the business transaction; doing so would remove the compliance trail. Any remediation or rerun requires a new controlled execution record.</div>
      <h3>Navigation conventions</h3>
      <table><thead><tr><th>Control</th><th>Meaning</th></tr></thead><tbody>
        <tr><td>Coral primary button</td><td>Creates, saves, advances or starts the primary action.</td></tr>
        <tr><td>Previous / Next</td><td>Moves through the workspace sequence; it does not automatically save unsaved work.</td></tr>
        <tr><td>Target badge</td><td>Shows configured application, target class and verification state; select it to review target configuration.</td></tr>
        <tr><td>Profile name</td><td>Opens Settings, Help and Sign out.</td></tr>
        <tr><td>Draft / Published</td><td>Draft permits editing; Published indicates validation has succeeded for governed use.</td></tr>
      </tbody></table>
    </section>

    ${instruction('1', 'Automation Overview', 'Use the landing canvas to understand workspace inventory, actual execution outcomes and modeled automation value, then resume or start work.',
      figures.overview,
      [
        { action: 'Confirm the target badge.', detail: ' Check the application, non-production classification and Verified state.', expected: 'The badge reflects the intended SAP test target.' },
        { action: 'Review inventory totals.', detail: ' Read Tests, Business Processes, controls and evidence record counts.', expected: 'Counts reflect current persisted workspace data.' },
        { action: 'Review execution impact.', detail: ' Separate ACTUAL metrics from MODELED manual effort, time and cost scenarios.', expected: 'Recorded and modeled values are not confused.' },
        { action: 'Inspect calculation assumptions.', detail: ' Expand the assumptions section when validating the modeled business case.' },
        { action: 'Choose the next task.', detail: ' Select Create test, New execution, Recent runs or a recent saved artifact.' },
      ],
      'You can explain the current workspace volume, recent outcome and next action without navigating date folders.',
      ['A negative potential cost saved value means the modeled automation investment has not yet been recovered.', 'Modeled metrics are scenarios, not audited financial savings.'])}

    ${instruction('2', 'Control Object Repository', 'Use the repository to scan a configured SAP screen, capture reusable controls and maintain the selector inventory.',
      figures.objects,
      [
        { action: 'Verify the scan URL.', detail: ' The initial URL is populated from Settings → SAP. Add or replace only the permitted Fiori route.' },
        { action: 'Enter or confirm the App ID.', detail: ' Use the business application identifier that owns the screen.' },
        { action: 'Open the scan session.', detail: ' The Studio opens a controlled browser session and authenticates with the stored SAP connection.', expected: 'The intended non-production SAP screen opens.' },
        { action: 'Capture controls.', detail: ' Use bulk scan or continuous Ctrl/Cmd interactive picking. Review duplicate warnings before saving.' },
        { action: 'Curate captured objects.', detail: ' Confirm business name, selector/type, domain, App ID and ordering.' },
        { action: 'Browse saved objects.', detail: ' Filter by domain and App ID, open the stable object route, and use Highlight to recheck a live control.' },
      ],
      'Each saved object has an explicit App ID, reusable identity and a stable repository route.',
      ['Never enter SAP passwords on the scan screen; credentials come from Settings.', 'A “not found” highlight requires selector review—it is not proof that the business application is unavailable.'])}

    ${instruction('3', 'Compose — Test Library', 'Use the Test Library to find existing Tests by business meaning and avoid duplicate automation assets.',
      figures.library,
      [
        { action: 'Search before creating.', detail: ' Search by Test name or file and filter by process area, application and readiness.' },
        { action: 'Open an existing Test.', detail: ' Select Open Test on the matching row.', expected: 'The browser moves to a stable /compose/tests/... route.' },
        { action: 'Create a new Test.', detail: ' Select New Test and enter business name, generated or edited file name, application and process area.' },
        { action: 'Choose a starting point.', detail: ' Use Blank for new behavior or Template to copy an existing Test without modifying the source.' },
        { action: 'Create the Test.', detail: ' Resolve any duplicate-file warning before continuing.' },
      ],
      'The Test opens on a refresh-safe route and is visible in the library with its readiness status.',
      ['File names are technical stable identifiers; use the business name for readable purpose.', 'Template creation copies steps and contract—it does not establish execution lineage.'])}

    ${instruction('4', 'Compose — Test editor', 'Define application metadata, typed inputs/outputs and executable steps, then validate and publish the reusable Test.',
      figures.editor,
      [
        { action: 'Review lifecycle and metadata.', detail: ' Confirm Test case name, application and domain.' },
        { action: 'Author the Test contract.', detail: ' Declare typed inputs and outputs; classify sensitivity where business or secret values are involved.' },
        { action: 'Use inferred contract carefully.', detail: ' Legacy Tests can infer placeholders, but publishing requires a reviewed contract.' },
        { action: 'Add or edit steps.', detail: ' Select a module, supply required parameters, choose reusable objects and set literal, dataset, system-context or prior-output value sources.' },
        { action: 'Reorder with accessible controls.', detail: ' Use the provided up/down keyboard-operable actions; do not depend on drag alone.' },
        { action: 'Save the Test.', detail: ' Save draft changes before leaving the route.' },
        { action: 'Publish the Test.', detail: ' Resolve unresolved inputs, missing objects/parameters or output collisions until validation succeeds.', expected: 'Lifecycle changes to Published or the editor shows an actionable blocking finding.' },
      ],
      'The Test round-trips to executable ModuleCall JSON and has a reviewed contract suitable for Process/Pack binding.',
      ['Do not place passwords or authorization tokens in literals, Test contracts or datasets.', 'Changing an output name can break downstream Business Process hand-offs.'])}

    ${instruction('5', 'Test Data', 'Create reusable flat, nested or relational data while preserving transaction ownership and previewing effective structures.',
      figures.data,
      [
        { action: 'Choose the model.', detail: ' Select Flat CSV, nested JSON or relational CSV based on the transaction structure.' },
        { action: 'For flat CSV, define rows and columns.', detail: ' Preserve headers and use proper CSV quoting for commas, quotes and line breaks.' },
        { action: 'For nested JSON, keep children under their owning header.', detail: ' One sales order with many line items is one transaction; multiple orders are separate transactions.' },
        { action: 'For relational CSV, configure the relationship.', detail: ' Select header file/key, child file/foreign key and child collection name.' },
        { action: 'Validate and preview.', detail: ' Resolve duplicate headers, missing keys, orphan children or collection-name collisions.' },
        { action: 'Save and reopen.', detail: ' Confirm the stable dataset route and preview are unchanged after reload.' },
      ],
      'The saved model preserves owned children and can be selected during execution preflight.',
      ['Never flatten multiple headers and line items into an ambiguous Cartesian set.', 'Treat sensitivity metadata and dependency-safe rename/removal as controlled governance work until the remaining backlog is completed.'])}

    ${instruction('6', 'Processes & Packs — workspace entry', 'Choose whether you are composing a sequential Business Process or an independent Regression Pack.',
      figures.processes,
      [
        { action: 'Select Business Processes for sequential work.', detail: ' Use this when later Tests require outputs from earlier Tests.' },
        { action: 'Select Regression Packs for independent work.', detail: ' Use this to group Tests or Processes that do not hand data to one another.' },
        { action: 'Open an existing artifact.', detail: ' Use the file picker; the selected artifact receives a stable route.' },
        { action: 'Create a new artifact.', detail: ' Enter a technical file name, create it, then supply its business name and lifecycle metadata.' },
      ],
      'You have selected the correct topology before adding Tests or data bindings.',
      ['Do not use a Pack to model sequential hand-offs.', 'Do not use a Business Process merely as a folder for unrelated Tests.'])}

    ${instruction('7', 'Business Process editor', 'Order reusable Tests into a governed scenario and map data or prior-stage outputs into each stage.',
      figures.processEditor,
      [
        { action: 'Set business name, domain and lifecycle.', detail: ' Keep the Process in Draft while changing topology.' },
        { action: 'Add Tests in business order.', detail: ' Select Tests from the available list and use up/down controls to establish the stage sequence.' },
        { action: 'Confirm App ID and data binding.', detail: ' Select the application and transaction data required by the Process.' },
        { action: 'Map stage inputs.', detail: ' Bind each required input to process data, a literal, system context or a prior-stage output.' },
        { action: 'Review hand-off validation.', detail: ' Resolve forward/cyclic references, unknown outputs, duplicate outputs and type mismatches.' },
        { action: 'Save, then publish.', detail: ' Publish only when all required contracts and policies are valid.' },
      ],
      'Every stage has an explicit ordered identity and each required input resolves from an allowed source.',
      ['A failed stage stops later stages for that transaction.', 'Outputs are namespaced by stage; avoid reusing ambiguous names.'])}

    ${instruction('8', 'Regression Pack editor', 'Create an independently executable collection of Tests and/or Business Processes with member-specific policies.',
      figures.packs,
      [
        { action: 'Create or open a Pack.', detail: ' Give it a business name, version and Draft lifecycle.' },
        { action: 'Add independent members.', detail: ' Add Test or Business Process members; each member receives a stable ID.' },
        { action: 'Set member bindings.', detail: ' Configure member data, application and allowed session/failure behavior.' },
        { action: 'Reorder for reporting intent.', detail: ' Order does not create cross-member data hand-offs.' },
        { action: 'Validate references.', detail: ' Resolve missing artifacts, data files, duplicate IDs and incompatible policies.' },
        { action: 'Publish the Pack.', detail: ' Only published Saved Packs are eligible for governed execution.' },
      ],
      'The Pack contains independent, valid members and can be selected as a Saved Pack in Execution Center.',
      ['Test members cannot use “reuse within process” session behavior.', 'Published Packs may not reference Draft Business Processes.'])}

    ${instruction('9', 'Execution Center', 'Prepare and authorize a controlled run without opening SAP until scope, data, target and policies pass preflight.',
      figures.execution,
      [
        { action: 'Select execution type.', detail: ' Choose Single Test, Business Process, Pack · Tests, Pack · Processes or Saved Pack.' },
        { action: 'Define Scope.', detail: ' Select the exact Test/Process/Pack and confirm App ID.' },
        { action: 'Set Data & policies.', detail: ' Choose the transaction data model/file, filters, limits, headed/headless behavior and permitted failure/session policies.' },
        { action: 'Run Preflight.', detail: ' Review target, credentials, artifacts, versions, contracts, effective data, mappings, calculated work and safety findings.' },
        { action: 'Correct blocking findings.', detail: ' Use exact artifact links where available, save corrections and rerun preflight.' },
        { action: 'Review immutable scope.', detail: ' Confirm members, iterations, stages, steps, child work, data snapshot and plan hash.' },
        { action: 'Acknowledge warnings and start.', detail: ' Begin only when the target, owner reference and transactional safeguards are approved.' },
        { action: 'Monitor progress.', detail: ' Use the stable run route; reconnecting rebuilds persisted top-level progress.' },
      ],
      'The run has a unique immutable ID, exact input snapshot, controlled target and visible progress/evidence state.',
      ['Do not start transactional Tests against an unclassified or production target.', 'On failure, stop downstream work and retain evidence; do not auto-reverse.', 'A rerun creates new lineage—it never overwrites the original run.'])}

    ${instruction('10', 'Audit & Evidence', 'Find an immutable run without browsing date folders and open the single canonical evidence document.',
      figures.audit,
      [
        { action: 'Search by business identity.', detail: ' Search process/Test name, App ID, run ID or executor.' },
        { action: 'Apply outcome, mode and date filters.', detail: ' Use the current client filters to narrow the newest-first list.' },
        { action: 'Open the run detail.', detail: ' Confirm stable route, outcome, duration, executor, target context and source artifacts.' },
        { action: 'Open Evidence PDF.', detail: ' Use the canonical link. Execution Center references this same document.' },
        { action: 'Review lineage and retention.', detail: ' Confirm parent/rerun identity, redaction posture and retained failure evidence.' },
      ],
      'The reviewer can identify the run and open one canonical branded evidence PDF with no duplicate version.',
      ['Server-side pagination and complete lineage traversal remain future work.', 'Evidence can contain business data; follow the displayed retention and access policy.'])}

    <section>
      ${sectionTitle('11', 'Settings, Help and account actions', 'Account menu instruction')}
      <p class="lead">Select the workspace-owner name at the lower-left to open Settings, Help or Sign out. The Settings screenshot is intentionally omitted because it can display configured connection identity.</p>
      <ol class="procedure">
        <li><strong>Open the profile menu.</strong>Select the owner name/avatar.</li>
        <li><strong>Open Settings.</strong>Choose appearance and review connection panels for SAP, Salesforce, Oracle and ServiceNow.</li>
        <li><strong>Configure SAP.</strong>Enter the non-production test-system URL, username and password, then select Save SAP connection.<span class="expected">Expected: the URL/username and non-secret credential status persist; the password is not returned to the browser.</span></li>
        <li><strong>Verify the target.</strong>Classify the target and perform the non-transactional verification required by the workspace context.</li>
        <li><strong>Use Help.</strong>Open contextual help from the profile menu.</li>
        <li><strong>Sign out.</strong>Use Sign out when leaving a shared device. Workspace artifacts remain associated with the preserved owner identity.</li>
      </ol>
      <div class="callout warning"><strong>Credential rule.</strong> Never copy passwords into screenshots, evidence, Tests, datasets, logs or support messages. The password field is write-only from the browser’s perspective.</div>
    </section>

    <section>
      ${sectionTitle('12', 'End-to-end supervised training exercise', 'Recommended practical assessment')}
      <ol class="procedure">
        <li><strong>Verify a non-production SAP target.</strong>Record the authorized owner reference.</li>
        <li><strong>Capture one reusable control.</strong>Confirm App ID and duplicate check.</li>
        <li><strong>Create one Draft Test.</strong>Add a typed input, one reusable object and a safe read-only step.</li>
        <li><strong>Create a small dataset.</strong>Preview the effective record.</li>
        <li><strong>Publish the Test.</strong>Resolve all publish findings.</li>
        <li><strong>Create a two-stage Business Process.</strong>Map one prior-stage output to a later input.</li>
        <li><strong>Create a Regression Pack.</strong>Add the Test and Process as independent members.</li>
        <li><strong>Preflight a headed non-transactional execution.</strong>Review snapshot, plan hash and calculated work.</li>
        <li><strong>Run and monitor.</strong>Reconnect once to demonstrate stable run recovery.</li>
        <li><strong>Open canonical evidence.</strong>Find the run from Audit & Evidence and explain its lineage and retention.</li>
      </ol>
      <div class="callout success"><strong>Training pass condition.</strong> The learner completes the flow without exposing credentials, bypassing preflight, confusing Process hand-offs with Pack independence, or altering the original run during a rerun.</div>
    </section>`;
  return documentShell('QA/4HANA Studio — User Training Work Instruction', body);
}

async function howToAndFaq(logoData) {
  const recipes = [
    ['Configure the SAP connection safely', ['Open the profile menu and select Settings.', 'Choose SAP under Test-system connections.', 'Enter the approved non-production URL, username and password.', 'Save the connection; confirm only non-secret status is shown afterward.', 'Classify and verify the target before live scan or execution.']],
    ['Create a reusable Single Test', ['Open Compose and search the Test Library first.', 'Select New Test; enter business name, file name, application and process area.', 'Choose Blank or copy an existing Test as a template.', 'Declare typed inputs/outputs and sensitivity.', 'Add steps, objects and value sources; save as Draft.', 'Resolve publish findings and publish.']],
    ['Model one header with many line items', ['Choose nested JSON when the children naturally belong inside each transaction.', 'Create one header object and add all owned line items to its collection.', 'Preview child count and mappings.', 'Save and use preflight to confirm one transaction with N child items.']],
    ['Model multiple headers with multiple line items', ['Create one transaction object per header, each with its own child collection; or use relational CSV.', 'For relational CSV, select unique header key and matching child foreign key.', 'Validate that there are no duplicate headers or orphan children.', 'Preview transaction and child totals before saving.']],
    ['Create a sequential Business Process', ['Open Processes & Packs → Business Processes.', 'Create or open a Draft Process.', 'Add published Tests in business order.', 'Bind each stage input from process data, literal, system context or a prior output.', 'Resolve topology/contract validation, then publish.']],
    ['Create an independent Regression Pack', ['Open Processes & Packs → Regression Packs.', 'Create a Draft Pack and add Test or Business Process members.', 'Set member-specific data/application/session/failure policies.', 'Validate references and compatible policies.', 'Publish and select it later through Saved Pack execution.']],
    ['Run a controlled Test or scenario', ['Open Execution Center and choose the execution type.', 'Select exact scope and App ID.', 'Choose data, filters, limits and headed/headless behavior.', 'Run preflight and correct all blockers.', 'Review immutable data/scope, acknowledge warnings and start.', 'Monitor the stable run route and open canonical evidence when complete.']],
    ['Rerun safely', ['Open the original run and choose rerun.', 'Choose full or eligible failed scope.', 'Review input, artifact, target and policy differences.', 'For transactional work, confirm retained state is eligible; started transactions may be blocked.', 'Start the new run and preserve the parent/child lineage.']],
    ['Find evidence', ['Open Audit & Evidence.', 'Search by process/Test, App ID, run ID or executor.', 'Filter outcome, mode and date.', 'Open the stable run detail and select Evidence PDF.', 'Confirm the Test name header, AI ELK logo, run identity, target context and redaction.']],
  ];

  const faqs = [
    ['What is the difference between a Test, Business Process and Regression Pack?', 'A Test is one reusable executable automation asset. A Business Process sequences Tests and allows typed outputs to feed later stages. A Regression Pack groups independent Tests or Processes; members do not hand data to each other.'],
    ['What happened to Chain, Suite and Batch?', 'They remain as compatibility concepts. The current business language is Single Test, Business Process, Pack · Tests, Pack · Processes and Saved Pack. Legacy plans translate into the versioned execution model.'],
    ['When should I use a Business Process?', 'Use it when order matters or a later Test requires data produced by an earlier Test—for example PO → Goods Receipt → Supplier Invoice.'],
    ['When should I use a Regression Pack?', 'Use it for independent coverage that can be reported together without cross-member data hand-offs, such as smoke, release or application-area regression collections.'],
    ['What is a Saved Pack?', 'It is a persisted, versioned Regression Pack created in Processes & Packs. A published mixed Pack can be selected and executed directly in Execution Center.'],
    ['Why is preflight mandatory?', 'Preflight is the server-owned safety gate. It validates target, credentials, artifacts, versions, contracts, objects, mappings, data, policies and calculated work before SAP is opened.'],
    ['What does the target badge mean?', 'It shows the configured application, sanitized target identity, safety classification and verification state. A stale or unverified target can block execution.'],
    ['Where are SAP credentials stored?', 'The server uses the OS credential vault where available and an encrypted local fallback for detached Windows sessions. Passwords are never returned to the browser.'],
    ['Can I use Google sign-in without losing existing data?', 'Yes. The first verified Google account becomes the preserved single workspace owner. Linking the owner does not move, rename or filter existing artifacts, history or repository data.'],
    ['Are multiple users and roles supported?', 'No. Version 2.0 intentionally uses one preserved owner identity. Multi-user roles are deferred until the requirement and authorization model are approved.'],
    ['What is the manual duration multiplier?', 'It is a modeling assumption that estimates how much longer a human execution may take relative to automation runtime. It is not an observed fact or confidence interval and should be reviewed with manual-minutes-per-Test and cost assumptions.'],
    ['Why can potential cost saved be negative?', 'The model subtracts automation runtime, development, maintenance, licensing, infrastructure and review costs from estimated manual-equivalent cost. A negative number means the modeled investment has not yet been recovered.'],
    ['What data formats are supported?', 'The Studio supports flat CSV, nested JSON transactions and relational CSV header/child models. Preflight resolves the exact effective records into an immutable snapshot.'],
    ['How do I represent one sales order with many line items?', 'Use one nested transaction with an items collection, or a unique header row joined to multiple child rows by a foreign key. Do not duplicate the header for each item unless the source contract explicitly expects that format.'],
    ['How do I represent multiple sales orders with line items?', 'Use multiple transaction objects, each owning its items, or multiple unique header rows joined to their respective child rows. Each header becomes an isolated execution iteration.'],
    ['What are Test inputs and outputs?', 'Inputs are typed values required by a Test. Outputs are typed values produced for evidence or downstream stages. Sensitivity identifies business or secret-bearing values so authoring and redaction policies can act appropriately.'],
    ['What is a prior-output binding?', 'It maps an output from an earlier Business Process stage to a required input of a later stage. Forward references, cycles, unknown outputs and incompatible types are rejected.'],
    ['Why can I save a Draft but not publish it?', 'Drafts allow incomplete authoring. Publishing requires reviewed contracts and valid parameters, objects, value sources, outputs and policies. The editor shows blocking findings that must be corrected.'],
    ['What happens when a Test fails?', 'The current transaction stops and later stages do not run. Earlier values and evidence are retained for review. The product does not automatically reverse or erase the business transaction.'],
    ['Why is there no automatic reversal?', 'Automatic reversal could destroy the compliance trail or perform an unapproved business action. Remediation is handled as a separately authorized run with its own immutable evidence.'],
    ['How does progress work for one Business Process?', 'Known stages, steps and child items contribute determinate progress. Persisted top-level progress is available after reconnect; the complete six-level reconciled event hierarchy remains an open backlog item.'],
    ['What is the difference between headed and headless execution?', 'Headed opens a visible browser for observation or training. Headless runs without a visible window. Both use the same controlled plan and evidence model; some live diagnostics are easier to observe in headed mode.'],
    ['Can a rerun overwrite the failed run?', 'No. A rerun creates a new immutable snapshot and records parent/child lineage. Difference review shows changes in data, artifacts, target and policy before execution.'],
    ['What is failed-scope rerun?', 'It creates a new run containing only eligible failed transactions or Pack members. Transactional items that already started and retain business state may be blocked for safety.'],
    ['Why is there only one evidence PDF?', 'Execution Center and Audit & Evidence resolve the same canonical evidence URL. This prevents conflicting document versions.'],
    ['What does evidence contain?', 'It includes branded Test/scenario identity, run ID, outcome, timing, steps, screenshots or observations, target/executor context and source references, subject to redaction and retention policy.'],
    ['How do I find a previous run?', 'Use Audit & Evidence search for process/Test name, App ID, run ID or executor, then filter outcome, mode and date. Server-side pagination and full lineage traversal are planned enhancements.'],
    ['How do I change the colour theme?', 'Open the profile menu, choose Settings and select the appearance option there.'],
    ['What should I do if “Scan a live screen” cannot reach SAP?', 'Confirm the configured URL, target verification, network/VPN path and session health. A network-access-denied message is an environment connectivity issue, not a cue to expose or re-enter credentials in the scan field.'],
    ['What should I do if saved SAP credentials appear unavailable in a detached Windows session?', 'Save again after the encrypted fallback is available, confirm non-secret credential status, and restart only the affected Studio server session if required. Never paste the password into logs or support tickets.'],
    ['What does “Legacy ready” mean?', 'The existing Test remains executable through inferred legacy metadata, but publishing under the typed model requires a reviewed contract and current validation.'],
    ['How are secrets kept out of logs and snapshots?', 'Execution plans and data snapshots reject credential-shaped fields, the runtime redacts known and generic authorization values, and the repository runs a high-confidence secret scan.'],
    ['Are scheduled executions and notifications available?', 'No. Scheduling, notifications and controlled parallelism are deliberately deferred until target capacity, isolation, cancellation and queue governance are designed.'],
    ['Where can I see product test quality?', 'Use the QA/4HANA Test Operations companion app. Its catalogue is generated from repository tests and recorded runs and retains historical failures even after remediation.'],
  ];

  const body = `
    ${cover('How-to Guide and Frequently Asked Questions', 'Task recipes, operating guidance, safety rules, troubleshooting and concise answers for everyday QA/4HANA Studio use.', 'Q4H-HOWTO-FAQ-2.0', logoData)}
    <section>
      <p class="eyebrow">Quick reference</p><h2>Golden path</h2>
      <div class="card"><ol>
        <li>Configure and verify a non-production SAP target.</li>
        <li>Capture reusable controls in Control Object Repository.</li>
        <li>Create and publish typed Tests in Compose.</li>
        <li>Create and validate transaction data in Test Data.</li>
        <li>Build sequential Business Processes and independent Regression Packs.</li>
        <li>Preflight, review and run from Execution Center.</li>
        <li>Review the one canonical evidence document in Audit & Evidence.</li>
      </ol></div>
      <div class="callout warning"><strong>Golden safety rules.</strong> Do not expose credentials; do not bypass preflight; do not auto-reverse failed business transactions; do not overwrite prior run evidence; and do not run transactional Tests without approved target, data ownership and owner reference.</div>
    </section>

    <section>
      ${sectionTitle('1', 'How-to recipes', 'Task-oriented guidance')}
      ${recipes.map(([title, steps], index) => `<article class="card"><p class="backlog-id">HOW-${String(index + 1).padStart(2, '0')}</p><h3>${html(title)}</h3><ol>${steps.map((step) => `<li>${html(step)}</li>`).join('')}</ol></article>`).join('')}
    </section>

    <section>
      ${sectionTitle('2', 'Troubleshooting decision guide', 'Safe recovery')}
      <table class="striped">
        <thead><tr><th>Symptom</th><th>Check first</th><th>Safe action</th></tr></thead>
        <tbody>
          <tr><td>Studio could not start; HTML was parsed as JSON</td><td>Server/API route and built client asset are from the same build.</td><td>Verify the API endpoint directly, rebuild, restart the Studio server and reload without changing workspace data.</td></tr>
          <tr><td>SAP connection cannot be saved</td><td>Credential-vault availability and encrypted fallback state.</td><td>Use the server-supported fallback, save again and confirm only non-secret status is returned.</td></tr>
          <tr><td>Live scan shows network access denied</td><td>VPN/proxy/firewall and server host reachability.</td><td>Restore the approved network path; do not work around it by embedding credentials or disabling browser security.</td></tr>
          <tr><td>Publish is blocked</td><td>Typed contract, required values, objects, parameters and output collisions.</td><td>Open each actionable finding, correct the owning artifact and rerun validation.</td></tr>
          <tr><td>Preflight is blocked</td><td>Target freshness, credentials, versions, data bindings and transactional safeguards.</td><td>Follow the exact correction link; rerun preflight to obtain a new plan hash.</td></tr>
          <tr><td>Run fails mid-transaction</td><td>Failure location, retained SAP state and evidence.</td><td>Stop downstream work, retain the run, review evidence and request authorization for any remediation.</td></tr>
          <tr><td>Rerun is not eligible</td><td>Whether the transaction already started and retains business state.</td><td>Do not force it. Create an approved remediation plan with new data/owner reference if required.</td></tr>
          <tr><td>Evidence appears different between workspaces</td><td>Canonical evidence URL and run ID.</td><td>Use the Audit & Evidence canonical PDF; report any route mismatch as a defect.</td></tr>
        </tbody>
      </table>
    </section>

    <section>
      ${sectionTitle('3', 'Frequently asked questions', `${faqs.length} product answers`)}
      ${faqs.map(([question, answer], index) => `<article class="faq"><h3>${index + 1}. ${html(question)}</h3><p>${html(answer)}</p></article>`).join('')}
    </section>

    <section>
      ${sectionTitle('4', 'Glossary', 'Product language')}
      <table class="striped"><thead><tr><th>Term</th><th>Meaning</th></tr></thead><tbody>
        <tr><td>Test</td><td>One reusable executable automation asset with steps and a typed contract.</td></tr>
        <tr><td>Business Process</td><td>An ordered sequence of Tests with explicit typed data hand-offs.</td></tr>
        <tr><td>Regression Pack</td><td>A versioned collection of independent Test and/or Business Process members.</td></tr>
        <tr><td>Iteration / transaction</td><td>One isolated effective data record and its owned children.</td></tr>
        <tr><td>Preflight</td><td>Server-owned validation and impact calculation performed before SAP is opened.</td></tr>
        <tr><td>Effective data</td><td>The exact filtered, limited and relationally resolved records that will execute.</td></tr>
        <tr><td>Immutable snapshot</td><td>Frozen plan, bindings and transaction data identified by a hash.</td></tr>
        <tr><td>Evidence</td><td>The canonical retained execution document and supporting artifacts.</td></tr>
        <tr><td>Lineage</td><td>Persistent relationship between an original run and a new rerun/remediation run.</td></tr>
        <tr><td>Fail-stop</td><td>Policy that stops later stages after failure while retaining earlier state and evidence.</td></tr>
      </tbody></table>
    </section>`;
  return documentShell('QA/4HANA Studio — How-to Guide and FAQ', body);
}

async function renderPdf(browser, htmlPath, pdfPath, title) {
  const page = await browser.newPage();
  await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'networkidle' });
  await page.emulateMedia({ media: 'print' });
  await page.pdf({
    path: pdfPath,
    format: 'A4',
    printBackground: true,
    displayHeaderFooter: true,
    margin: { top: '18mm', right: '14mm', bottom: '18mm', left: '14mm' },
    headerTemplate: `<div style="width:100%;font:8px 'Segoe UI',Arial;color:#587086;padding:0 14mm;display:flex;justify-content:space-between;"><span>QA/4HANA Studio · by aielk</span><span>${html(title)}</span></div>`,
    footerTemplate: `<div style="width:100%;font:8px 'Segoe UI',Arial;color:#587086;padding:0 14mm;display:flex;justify-content:space-between;"><span>Internal product documentation · ${generatedDate}</span><span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span></div>`,
  });
  await page.close();
}

await fs.mkdir(outputDir, { recursive: true });
const [trackerSource, qualitySource, catalogSource, logoData] = await Promise.all([
  fs.readFile(trackerPath, 'utf8'),
  fs.readFile(qualityPath, 'utf8'),
  fs.readFile(catalogPath, 'utf8'),
  dataUri(logoPath),
]);

const backlog = readBacklog(trackerSource);
const quality = JSON.parse(qualitySource);
const catalog = JSON.parse(catalogSource);
const documents = [
  {
    stem: 'QA4HANA_Product_Implementation_Status_Report',
    title: 'Implementation status',
    content: await implementationReport({ backlog, quality, catalogCount: catalog.tests.length, logoData }),
  },
  {
    stem: 'QA4HANA_User_Training_Work_Instruction',
    title: 'User training work instruction',
    content: await trainingWorkInstruction(logoData),
  },
  {
    stem: 'QA4HANA_How_To_Guide_and_FAQ',
    title: 'How-to guide and FAQ',
    content: await howToAndFaq(logoData),
  },
];

for (const document of documents) {
  await fs.writeFile(path.join(outputDir, `${document.stem}.html`), document.content, 'utf8');
}

const browser = await chromium.launch({ headless: true });
try {
  for (const document of documents) {
    const htmlPath = path.join(outputDir, `${document.stem}.html`);
    const pdfPath = path.join(outputDir, `${document.stem}.pdf`);
    await renderPdf(browser, htmlPath, pdfPath, document.title);
    const stat = await fs.stat(pdfPath);
    console.log(`Rendered ${path.basename(pdfPath)} (${Math.round(stat.size / 1024)} KB)`);
  }
} finally {
  await browser.close();
}
