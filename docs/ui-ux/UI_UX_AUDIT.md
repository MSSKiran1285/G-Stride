# SAP S/4HANA Test Automation Studio — Heuristic UI/UX Audit

## Audit basis

This audit covers the seven significant frontend views, application shell, shared interactive components, API client, styling, and frontend regression coverage. Evidence comes from static implementation inspection and a successful production build. Live SAP workflows, screenshots, colour measurements, screen-reader output, and responsive rendering remain unverified.

### Severity definitions

- **Critical:** Likely to cause execution against the wrong target, unintended SAP side effects, or materially false audit conclusions.
- **High:** Blocks or seriously degrades a core workflow, accessibility, recovery, or operational trust.
- **Medium:** Causes recurring confusion, inefficiency, inconsistency, or limited access, with a viable workaround.
- **Low:** Local polish or clarity issue with limited task impact.
- **Enhancement:** Valuable capability beyond correcting the present experience.

## Heuristic coverage summary

| Criterion | Overview | Objects | Composer | Data | Suites | Execution | Audit |
|---|---|---|---|---|---|---|---|
| Clear purpose | Partial: marketing-heavy | Partial: too many jobs | Good | Good | Partial terminology | Good | Good |
| Visual hierarchy | Strong in code intent | Unverified/missing styles | Unverified/missing styles | Unverified/missing styles | Unverified/missing styles | Unverified/missing styles | Unverified/missing styles |
| Navigation clarity | Duplicated | Duplicated shell controls | No deep link | No deep link | No deep link | No stable run URL | No stable run URL |
| System status | Fallbacks obscure failure | Session state present | Save state present | Save state only | Dirty/save state | Partial polling status | Search loading only |
| User terminology | Mixed stakeholder/engineer | Highly technical | Highly technical | Mixed | Inconsistent collection terms | Long technical mode definitions | Documents/Audit/Runs conflict |
| Error prevention | Weak | Partial stable-ID guard | Partial unsaved guard | Weak | Partial unsaved guard | Unsafe target/run action | Read-only ledger helps |
| Error recovery | API fallback hides errors | Inline recovery | Inline recovery | Inline recovery | Inline recovery | Weak poll/failure recovery | Search retry |
| Recognition vs recall | Cards help | Domain/App ID selection | Token syntax needs recall | Placeholder mapping needs recall | Mode concepts need recall | Mode text helps but is dense | Date grouping helps |
| Expert efficiency | Search/templates | Filter/highlight | Inline edit | Direct grid | Ordered picker | Ad hoc composition | Limited filters |
| New-user learnability | Polished but misleading | Complex | Help panel present | Weak | Weak | Explanations present | Reasonable |
| Information density | Excessive | Excessive/very wide | Dense | Dense | Moderate | Excessive after run | Moderate |
| Form usability | Search unlabeled | Placeholder labels | Minimal validation | Minimal validation | Minimal validation | No preflight | Filters unlabeled |
| Table usability | Cards, no tables | Filter only | Reorder only | Basic editing | Lists | Multiple dense tables | Nested table |
| Search/filtering | Template only | Good local filter | Grouped picker only | Grouped picker only | Filter picker | Filter picker | App ID/status only |
| Action placement | Many repeated routes | Competing toolbars | Mostly contextual | Clear footer | Clear footer | Run separated from summary | Clear Search |
| Loading/empty/error | Misleading fallbacks | Partial | Weak | Weak | Weak | Partial | Partial |
| Destructive actions | None | Browser confirm | Remove no undo | Delete no confirm/undo | Remove no undo | Real-side-effect run unconfirmed | Read-only |
| Keyboard/focus | Clickable div failures | Drag and wide-table issues | Drag/custom picker issues | Glyph buttons | Reorder names weak | Tabs/live status weak | Native details mostly usable |
| Screen reader | Poor card semantics | Missing labels/live updates | Missing labels/combobox semantics | Weak cell context | Weak reorder feedback | Missing live regions | Missing labels/caption |
| Responsive | Dashboard breakpoints only | Not designed | Not designed | Not designed | Not designed | Not designed | Horizontal scroll only |

## Findings

### Critical

#### UX-001 — Environment selection is decorative, not authoritative

- **Screen/component:** Application shell and Execution.
- **File path:** `packages/studio-web/src/App.tsx`; `components/RunPanel.tsx`; `api.ts`.
- **Description/evidence:** `sapEnv` is local state used only by the shell `<select>`. `api.startRun` does not receive it, while the shell displays an active connection and named targets.
- **User impact:** A user may believe a safe QA/DEV environment is selected while execution uses whichever credential/profile the CLI resolves, potentially creating documents in the wrong SAP system.
- **Recommended correction:** Remove the unverified selector until a server-backed environment contract exists, or bind a verified environment/profile ID through preflight and execution. Display target classification and verification timestamp.
- **Effort:** Large.
- **Dependencies:** Environment/profile server model, secure credential-reference design, execution contract impact review.
- **Suggested implementation stage:** Immediate safety correction followed by Phase 1 foundation.

#### UX-002 — Execution has no target-impact review or confirmation

- **Screen/component:** Execution Engine.
- **File path:** `packages/studio-web/src/components/RunPanel.tsx`.
- **Description/evidence:** A generic `Run` button directly posts test/group selections, hard-coded default App ID, data, headless, and evidence options. There is no preflight or confirmation even though live regression comments confirm runs create real SAP documents.
- **User impact:** Accidental, duplicate, or incorrectly scoped executions can create business documents and evidence.
- **Recommended correction:** Add server-backed preflight, exact scope/target summary, side-effect classification, idempotency protection, and risk-aware confirmation before start.
- **Effort:** Large.
- **Dependencies:** UX-001, server preflight endpoint, run idempotency design.
- **Suggested implementation stage:** Immediate correction/Phase 1 Execution.

#### UX-003 — Empty dashboard presents fabricated operational and audit data

- **Screen/component:** Automation Overview.
- **File path:** `packages/studio-web/src/components/AutomationOverview.tsx`.
- **Description/evidence:** Initial/fallback counts include 148 objects, 12 scenarios/runs, five documents, 100% pass rate, realistic document numbers, resilience scores, and capability claims. API failures are caught and converted to empty arrays, which trigger these fallbacks.
- **User impact:** Test managers or auditors can mistake demo values and document numbers for real system-of-record data; API failure appears as success.
- **Recommended correction:** Never substitute sample operational records in production UI. Show truthful empty, unavailable, stale, or demo-labelled states; centralise data freshness and error status.
- **Effort:** Medium.
- **Dependencies:** Shared async/empty-state components and product decision on demo mode.
- **Suggested implementation stage:** Immediate correction.

### High

#### UX-004 — Functional screens reference a missing styling layer

- **Screen/component:** Objects, Composer, Data, Suites, Execution, Audit, and shared components.
- **File path:** `packages/studio-web/src/index.css`; all functional screen components.
- **Description/evidence:** Components extensively use classes such as `stack`, `row`, `param-grid`, `section-title`, `hint`, `error-text`, `badge`, `completion-banner`, `chain-list`, `evidence-gallery`, `app-nav`, `sticky-top`, and status/action variants. The current stylesheet defines shell/overview plus generic `panel`, buttons, inputs, and tables, but not these classes.
- **User impact:** A successful build can still ship broken layouts, missing status differentiation, poor spacing, and unusable execution/object workflows.
- **Recommended correction:** First restore a minimal, reviewed compatibility layer for every referenced class; then migrate deliberately to shared primitives. Add visual regression coverage before refactoring.
- **Effort:** Medium.
- **Dependencies:** Safe local visual runtime and baseline screenshots.
- **Suggested implementation stage:** Immediate correction.

#### UX-005 — No visible project/workspace source of truth

- **Screen/component:** Application shell.
- **File path:** `packages/studio-web/src/App.tsx`; `packages/studio-server/src/server.ts`.
- **Description/evidence:** The UI never identifies the repository/workspace supplying JSON, CSV, and SQLite data. Server directories are implicitly resolved from `REPO_ROOT`.
- **User impact:** Users cannot tell which project’s tests, objects, or audit records they are editing.
- **Recommended correction:** Add read-only server capability/context metadata and a persistent workspace label; only add switching after storage impact is designed.
- **Effort:** Medium.
- **Dependencies:** Context endpoint and naming rules.
- **Suggested implementation stage:** Phase 1 shell.

#### UX-006 — The shell claims unverified connection, compliance, and engine health

- **Screen/component:** Sidebar footer, workflow footer, Engineer Assistant, overview insights.
- **File path:** `packages/studio-web/src/App.tsx`; `components/AutomationOverview.tsx`.
- **Description/evidence:** “Connected”, “Compliance Active”, matcher percentages, response codes, and isolation/capability values are hard-coded.
- **User impact:** False system status reduces trust and can influence operational decisions.
- **Recommended correction:** Remove claims without a source. Replace with verified health/capability endpoints, explicit examples, or clearly labelled help content.
- **Effort:** Medium.
- **Dependencies:** Health/capability contract; content review.
- **Suggested implementation stage:** Immediate correction.

#### UX-007 — No stable URLs, history, or refresh recovery

- **Screen/component:** Entire application.
- **File path:** `packages/studio-web/src/App.tsx`.
- **Description/evidence:** A local `view` union controls all pages. Artifacts and run IDs are not encoded in URLs; reloading returns to overview and unmounting clears screen state.
- **User impact:** Users cannot bookmark/share a test or run, use browser navigation, or return reliably after correcting a failure.
- **Recommended correction:** Introduce lightweight client routing while preserving existing component logic and server catch-all hosting; add routes for lists, artifacts, execution, and run detail.
- **Effort:** Medium.
- **Dependencies:** IA approval and unsaved-change navigation guard.
- **Suggested implementation stage:** Phase 1 foundation.

#### UX-008 — Primary dashboard cards are pointer-only

- **Screen/component:** Overview metric, pipeline, and template cards.
- **File path:** `packages/studio-web/src/components/AutomationOverview.tsx`.
- **Description/evidence:** Navigation is attached to non-focusable `div` elements via `onClick`.
- **User impact:** Keyboard and many assistive-technology users cannot operate central navigation; semantics do not announce actions.
- **Recommended correction:** Use links/buttons with visible focus, correct names, and stable destinations.
- **Effort:** Small.
- **Dependencies:** Preferably UX-007 routes.
- **Suggested implementation stage:** Immediate accessibility correction.

#### UX-009 — Form labels are visually present but not programmatically associated

- **Screen/component:** All forms.
- **File path:** `App.tsx`; Composer, Objects, Data, Suites, Execution, Audit components.
- **Description/evidence:** Labels generally wrap text separately from controls and use no `htmlFor`/`id`; several fields rely only on placeholders.
- **User impact:** Screen-reader users lose names/context, and clicking visible labels may not focus controls.
- **Recommended correction:** Give shared fields stable IDs, associated labels, descriptions, required state, and error references.
- **Effort:** Medium.
- **Dependencies:** Shared form-field primitive.
- **Suggested implementation stage:** Accessibility foundation.

#### UX-010 — Custom grouped picker is not an accessible picker/tree

- **Screen/component:** `GroupedPicker`.
- **File path:** `packages/studio-web/src/components/GroupedPicker.tsx`.
- **Description/evidence:** A button opens clickable `div` rows/groups. There are no listbox/tree roles, keyboard traversal, `aria-expanded`, active option, or focus management.
- **User impact:** Keyboard and screen-reader users cannot reliably browse modules or grouped artifacts, blocking Composer, Data, and Suites.
- **Recommended correction:** Implement an ARIA Authoring Practices-compliant grouped combobox/listbox or use an accessible existing primitive with no large dependency.
- **Effort:** Medium.
- **Dependencies:** Design-system field/popover standards.
- **Suggested implementation stage:** Accessibility foundation.

#### UX-011 — Object picker approximates keyboard use but lacks combobox semantics

- **Screen/component:** `ObjectPicker`.
- **File path:** `packages/studio-web/src/components/ObjectPicker.tsx`.
- **Description/evidence:** Arrow/Enter/Escape handling exists, but the input has no combobox role, controls/expanded attributes, active-descendant, listbox/options, or announced result count.
- **User impact:** Screen-reader users do not know a popup exists or which object is highlighted, despite object choice being safety-critical.
- **Recommended correction:** Complete the ARIA combobox pattern and keep editable/free-text behaviour; announce hidden-kind and highlight outcomes.
- **Effort:** Medium.
- **Dependencies:** Popover/listbox primitive and object-label content model.
- **Suggested implementation stage:** Accessibility foundation.

#### UX-012 — Drag-only reordering blocks keyboard users

- **Screen/component:** Test steps and saved-object order.
- **File path:** `components/TestCaseEditor.tsx`; `components/ObjectBrowser.tsx`.
- **Description/evidence:** Rows use native pointer drag events; no move-up/down/menu alternative exists.
- **User impact:** Keyboard and touch users cannot perform a core authoring operation reliably.
- **Recommended correction:** Add explicit move actions with item-specific names and live reorder feedback; retain drag as enhancement.
- **Effort:** Small–Medium.
- **Dependencies:** Shared ordered-list pattern.
- **Suggested implementation stage:** Immediate accessibility correction.

#### UX-013 — Buttons have no global visible keyboard focus style

- **Screen/component:** Entire application.
- **File path:** `packages/studio-web/src/index.css`.
- **Description/evidence:** Inputs/selects/textareas define `:focus`; buttons and clickable card elements do not define `:focus-visible`. Many buttons use transparent ghost styling.
- **User impact:** Keyboard users can lose track of focus, contrary to WCAG 2.2 focus requirements.
- **Recommended correction:** Add a high-contrast, non-obscured `:focus-visible` ring for every interactive element and test in both themes.
- **Effort:** Small.
- **Dependencies:** Focus token and contrast validation.
- **Suggested implementation stage:** Immediate accessibility correction.

#### UX-014 — Live execution and capture updates are not announced

- **Screen/component:** Execution, object picking/curation, saving, audit search.
- **File path:** `RunPanel.tsx`; `ObjectScanner.tsx`; `CurationList.tsx`; `DocumentsPanel.tsx`.
- **Description/evidence:** Status text changes visually without `aria-live`, `role="status"`, `role="alert"`, or `aria-busy`.
- **User impact:** Screen-reader users cannot perceive run completion, failure, new picked controls, save results, or search completion.
- **Recommended correction:** Establish polite status and assertive error regions, mark busy sections, and move focus only for task-critical failures.
- **Effort:** Medium.
- **Dependencies:** Shared status/notification primitives.
- **Suggested implementation stage:** Accessibility foundation.

#### UX-015 — Responsive work is limited to the overview

- **Screen/component:** Shell and all six functional screens.
- **File path:** `packages/studio-web/src/index.css`.
- **Description/evidence:** Media queries affect dashboard grids only. The fixed sidebar, workspace header, pipeline, footer, two-column pickers, parameter grids, and wide tables have no narrow-layout rules.
- **User impact:** Common laptop zoom, tablet, and narrow windows may clip controls or force excessive two-dimensional scrolling.
- **Recommended correction:** Define shell and component breakpoints, collapsible navigation, wrapping action bars, stacked transfer lists, and responsive table strategies; validate at 320 CSS px and 200% zoom where practical.
- **Effort:** Large.
- **Dependencies:** IA and design-system responsive standards.
- **Suggested implementation stage:** Phase 1 responsive foundation.

#### UX-016 — Data editing can lose work without warning

- **Screen/component:** Test Data Matrix.
- **File path:** `packages/studio-web/src/components/DataEditor.tsx`.
- **Description/evidence:** Unlike Composer and Groups, Data has no dirty flag, navigation guard, unload guard, or unsaved indicator. Delete-row is immediate.
- **User impact:** Large or nested datasets can be lost by navigating or reloading.
- **Recommended correction:** Track dirty state, guard route/view changes, visibly distinguish saved/draft, and provide undo for row deletion.
- **Effort:** Medium.
- **Dependencies:** Shared unsaved-change guard and router integration.
- **Suggested implementation stage:** Immediate correction.

#### UX-017 — New Composer and Group drafts are initially considered clean

- **Screen/component:** Composer and Process Suites.
- **File path:** `TestCaseEditor.tsx`; `GroupEditor.tsx`.
- **Description/evidence:** `createNew` creates an unsaved object but explicitly sets `dirty(false)`.
- **User impact:** A user can leave a newly created, unsaved artifact without a warning.
- **Recommended correction:** Mark new artifacts dirty until the first successful save; distinguish draft creation from persisted creation.
- **Effort:** Small.
- **Dependencies:** None; coordinate with routing guard later.
- **Suggested implementation stage:** Immediate correction.

#### UX-018 — Template action promises behaviour it does not perform

- **Screen/component:** Overview → Composer.
- **File path:** `AutomationOverview.tsx`; `App.tsx`; `TestCaseEditor.tsx`.
- **Description/evidence:** “Use Template” passes only a transaction code; Composer claims a “Pre-loaded sequence” although no test case or steps are created.
- **User impact:** Users may assume a test is ready, save an empty case, or lose confidence in templates.
- **Recommended correction:** Either implement validated template instantiation or relabel the action as filtering/guidance and remove the preloaded claim.
- **Effort:** Small for copy correction; Large for real templates.
- **Dependencies:** Template domain model if implemented.
- **Suggested implementation stage:** Immediate correction.

#### UX-019 — Polling failures can leave the run monitor stale

- **Screen/component:** Execution monitor.
- **File path:** `packages/studio-web/src/components/RunPanel.tsx`.
- **Description/evidence:** The interval callback awaits `api.getRun` without `try/catch`; there is no freshness timestamp or retry state.
- **User impact:** A transient API failure can produce an unhandled rejection or leave “Running” indefinitely, encouraging duplicate execution.
- **Recommended correction:** Add resilient polling with abort-on-unmount, bounded backoff, last-updated indicator, recoverable disconnected state, and server status reconciliation.
- **Effort:** Medium.
- **Dependencies:** Shared query/polling utility.
- **Suggested implementation stage:** Immediate correction.

#### UX-020 — Failure analysis is not a distinct, focused workflow

- **Screen/component:** Execution results.
- **File path:** `packages/studio-web/src/components/RunPanel.tsx`.
- **Description/evidence:** Configuration, group summaries, stage tables, step tables, screenshots, captured values, evidence, and log tail all render sequentially in one component. No first-failure link/filter or failure category exists.
- **User impact:** Users scan large pages and may fix symptoms rather than the root failed step.
- **Recommended correction:** Add a stable run-detail screen with a failure summary, first-failure focus, collapsed passing steps, expected/actual/error context, and linked artifacts.
- **Effort:** Large.
- **Dependencies:** Routing, run-detail API use, failure taxonomy.
- **Suggested implementation stage:** Phase 2 Run details/failure analysis.

#### UX-021 — No safe “fix and rerun same configuration” path

- **Screen/component:** Execution → Objects/Composer/Data.
- **File path:** `App.tsx`; `RunPanel.tsx`.
- **Description/evidence:** Changing views unmounts RunPanel and loses its local configuration. Failures do not link to source artifacts, and run IDs have no URL.
- **User impact:** Users manually reconstruct runs, making comparisons unreliable and introducing configuration drift.
- **Recommended correction:** Persist immutable run configuration, add contextual artifact links, support rerun-from-run, choose failed/full scope, and record lineage.
- **Effort:** Large.
- **Dependencies:** UX-007, UX-020, server run metadata.
- **Suggested implementation stage:** Phase 2.

#### UX-022 — Character encoding corruption is visible throughout UI content

- **Screen/component:** Shell and most screens.
- **File path:** Multiple TSX files, HTML title, project text.
- **Description/evidence:** Source contains rendered sequences such as malformed dashes, arrows, ellipses, checkmarks, and multiplication symbols.
- **User impact:** Labels, status, help, and test summaries appear broken and unprofessional; some icon-character buttons become unintelligible.
- **Recommended correction:** Normalize source files to UTF-8, replace decorative glyphs with icons/text where appropriate, and add an encoding check.
- **Effort:** Small–Medium.
- **Dependencies:** Snapshot/visual review to avoid accidental content changes.
- **Suggested implementation stage:** Immediate correction.

#### UX-023 — Current local-only trust boundary is not enforced

- **Screen/component:** Entire application/API.
- **File path:** `studio-server/src/index.ts`; `studio-server/src/server.ts`.
- **Description/evidence:** Server listens on `0.0.0.0`; APIs have no authentication, authorization, CSRF protection, or origin restriction, while they can edit tests/data/objects and start execution.
- **User impact:** On an accessible network interface, another client may mutate automation assets or trigger SAP runs. The project brief calls the product single-user/local, but binding is broader than loopback.
- **Recommended correction:** Bind local workstation mode to loopback by default, issue a local session token/CSRF control, and document that hosted deployment requires real identity/RBAC.
- **Effort:** Medium.
- **Dependencies:** Deployment model decision and server security review.
- **Suggested implementation stage:** Immediate security foundation.

### Medium

#### UX-024 — Loading, empty, error, warning, and success patterns are inconsistent

- **Screen/component:** All screens.
- **File path:** All screen components; `api.ts`.
- **Description/evidence:** Screens independently use raw paragraphs, hints, button text, sample fallbacks, or no state. Errors are `String(e)` and there is no notification system.
- **User impact:** Users cannot consistently distinguish empty data, API failure, saving, stale data, and successful completion.
- **Recommended correction:** Define shared async-state, message-strip, inline field error, toast, and retry conventions; sanitise user-facing errors.
- **Effort:** Medium.
- **Dependencies:** Design-system status components and API error model.
- **Suggested implementation stage:** Phase 1 foundation.

#### UX-025 — Navigation is repeated and enforces one linear mental model

- **Screen/component:** Shell and Overview.
- **File path:** `App.tsx`; `AutomationOverview.tsx`.
- **Description/evidence:** Sidebar, pipeline tracker, previous/next header controls, footer controls, and dashboard pipeline all navigate the same six areas in a numbered order.
- **User impact:** Screen space and attention are consumed by duplication; expert users and non-linear tasks are forced into an inaccurate process.
- **Recommended correction:** Adopt one stable primary navigation and use contextual next steps only where a real dependency exists.
- **Effort:** Medium.
- **Dependencies:** Information architecture approval.
- **Suggested implementation stage:** Phase 1 shell/navigation.

#### UX-026 — Product terminology is inconsistent

- **Screen/component:** Shell, Suites, Execution, Audit.
- **File path:** `App.tsx`; `GroupEditor.tsx`; `RunPanel.tsx`; `DocumentsPanel.tsx`.
- **Description/evidence:** “Process Suites” edits Groups; execution also has Suite, Chain, and Batch; the audit area is variously Documents, Audit & Evidence, and Audit log.
- **User impact:** Users must remember implementation terminology rather than business concepts and may choose the wrong execution behaviour.
- **Recommended correction:** Establish a glossary and a collection model that distinguishes dependent processes from independent packs and execution modes.
- **Effort:** Medium.
- **Dependencies:** IA/content design and compatibility mapping.
- **Suggested implementation stage:** Phase 1 navigation; Phase 2 workflow content.

#### UX-027 — Table usability is basic for enterprise-scale data

- **Screen/component:** Objects, Composer, Data, Execution, Audit.
- **File path:** Relevant screen components.
- **Description/evidence:** Tables generally lack captions, sorting, sticky headers, column controls, pagination/virtualisation, row selection semantics, and responsive alternatives.
- **User impact:** Large repositories, datasets, or run histories become slow to scan and difficult to operate.
- **Recommended correction:** Define a shared data-table baseline with captions, sorting/filtering where useful, sticky headers, keyboard-friendly actions, density choices, and empty/loading rows. Add virtualization only when measured.
- **Effort:** Large.
- **Dependencies:** Design-system table pattern and scale measurements.
- **Suggested implementation stage:** Phase 2 per workflow.

#### UX-028 — Destructive editing lacks consistent confirmation or undo

- **Screen/component:** Objects, Composer, Data, Suites.
- **File path:** `ObjectBrowser.tsx`; `TestCaseEditor.tsx`; `DataEditor.tsx`; `FileChainPicker.tsx`.
- **Description/evidence:** Object delete uses a browser confirmation; step/row/list removal is immediate; there is no undo. Browser confirm copy does not describe downstream test impact.
- **User impact:** Accidental deletion can invalidate assets or lose data; behaviour changes by screen.
- **Recommended correction:** Use inline undo for local edits, impact-aware confirmation for persisted/dependency-heavy deletion, and consistent destructive styling.
- **Effort:** Medium.
- **Dependencies:** Dependency lookup for objects; shared confirmation/undo pattern.
- **Suggested implementation stage:** Phase 1 shared components; Phase 2 workflows.

#### UX-029 — Engineer drawer is not an accessible drawer and mixes help with status

- **Screen/component:** Engineer Assistant.
- **File path:** `packages/studio-web/src/App.tsx`.
- **Description/evidence:** Conditional `<aside>` has no labelled dialog region, focus management, Escape close, focus return, or overlay behaviour. Its metrics/status are hard-coded.
- **User impact:** Keyboard focus can move behind the drawer; users cannot distinguish documentation examples from health data.
- **Recommended correction:** Reframe as contextual Help or implement an accessible non-modal side panel with verified content, labelled structure, Escape, and focus return.
- **Effort:** Medium.
- **Dependencies:** Content review and overlay/drawer primitive.
- **Suggested implementation stage:** Phase 1 shell.

#### UX-030 — Theme behaviour is incomplete

- **Screen/component:** Shell/theme.
- **File path:** `packages/studio-web/src/App.tsx`; `index.css`.
- **Description/evidence:** Theme always starts light, ignores `prefers-color-scheme`, is not persisted, and has no token contrast verification.
- **User impact:** User preference is lost and dark theme may contain unmeasured contrast issues.
- **Recommended correction:** Default to system preference, persist explicit choice, expose Light/Dark/System, and test all semantic tokens.
- **Effort:** Small.
- **Dependencies:** Token audit.
- **Suggested implementation stage:** Phase 1 theme.

#### UX-031 — Motion does not respect reduced-motion preference

- **Screen/component:** Shell, cards, view transitions.
- **File path:** `packages/studio-web/src/index.css`.
- **Description/evidence:** Transitions, transforms, and fade animation are globally applied with no `prefers-reduced-motion` override.
- **User impact:** Users with vestibular sensitivity cannot reduce animation.
- **Recommended correction:** Disable non-essential movement and shorten transitions under reduced-motion preference.
- **Effort:** Small.
- **Dependencies:** None.
- **Suggested implementation stage:** Accessibility foundation.

#### UX-032 — UI regression tests no longer reflect current controls

- **Screen/component:** Composer, Data, Suites, Run tests.
- **File path:** `regression/ui/*.test.js`.
- **Description/evidence:** Tests still describe/select native `<select>` controls for artifact/module pickers, while the implementation now uses custom `GroupedPicker` buttons/divs. UI tests are not part of the root build.
- **User impact:** The suite can fail for obsolete reasons or miss current accessibility/visual regressions, reducing confidence in changes.
- **Recommended correction:** Update tests to role-based current interactions, add a non-mutating smoke set, and run it in CI against isolated fixtures.
- **Effort:** Medium.
- **Dependencies:** Safe test server with temporary stores/files and accessible picker semantics.
- **Suggested implementation stage:** Immediate quality correction.

#### UX-033 — No automated accessibility or component-level testing

- **Screen/component:** Frontend quality system.
- **File path:** `packages/studio-web/package.json`; `regression`.
- **Description/evidence:** Tooling includes Oxlint, TypeScript, Node tests, and Playwright, but no Axe checks, component test runner, or accessibility assertions.
- **User impact:** Keyboard, semantics, contrast, and state regressions are likely to recur.
- **Recommended correction:** Add a small testing stack using existing Playwright where possible: Axe smoke scans, keyboard journeys, and component/unit tests only where complex state merits them.
- **Effort:** Medium.
- **Dependencies:** Isolated runtime and a11y baseline.
- **Suggested implementation stage:** Accessibility foundation.

#### UX-034 — API errors expose implementation strings and lack actionable categories

- **Screen/component:** All API-backed screens.
- **File path:** `packages/studio-web/src/api.ts`; screen catch handlers.
- **Description/evidence:** The client throws server `error` strings and screens render `String(e)`. There is no error code, field mapping, correlation ID, or safe fallback.
- **User impact:** Users see technical text without recovery guidance; sensitive operational details could be exposed if future server errors include them.
- **Recommended correction:** Define typed safe error envelopes, map validation errors to fields, provide retry/support actions, and log technical context separately.
- **Effort:** Medium.
- **Dependencies:** Backend contract change assessment.
- **Suggested implementation stage:** Phase 1 foundation.

#### UX-035 — Inline styles and global selectors make consistency fragile

- **Screen/component:** Entire frontend.
- **File path:** Most TSX components; `index.css`.
- **Description/evidence:** Layout, spacing, sizing, and colours are frequently inline; global element selectors style every button/input/table. Components use many ad hoc class variants.
- **User impact:** Similar controls differ, responsive overrides are hard, and small CSS changes can affect unrelated workflows.
- **Recommended correction:** Introduce a small primitive layer (`Stack`, `Inline`, `Button`, `Field`, `Panel`, `Status`, `TableFrame`) and migrate incrementally.
- **Effort:** Large.
- **Dependencies:** Design-system proposal and visual baseline.
- **Suggested implementation stage:** Phase 1 shared components.

#### UX-036 — Run controls lack cancel, background persistence, and navigation safety

- **Screen/component:** Execution.
- **File path:** `RunPanel.tsx`; `api.ts`; server run routes.
- **Description/evidence:** Once started, only polling is available. There is no cancel endpoint/action, no navigation warning, and local run state disappears on view change.
- **User impact:** Users cannot stop an erroneous long run or monitor it after navigating.
- **Recommended correction:** First preserve run link/state on navigation; then design cooperative cancellation with clear limitations and audit recording.
- **Effort:** Large.
- **Dependencies:** Routing and server/CLI cancellation design.
- **Suggested implementation stage:** Phase 2.

#### UX-037 — Data and parameter validation happens too late

- **Screen/component:** Composer, Data, Suites, Execution.
- **File path:** `StepEditor.tsx`; `DataEditor.tsx`; `GroupEditor.tsx`; `RunPanel.tsx`.
- **Description/evidence:** Required module parameters are visually marked but not checked in `StepEditor.save`; dataset headers/shapes are not compared with placeholders; UI group validation differs from server requirements.
- **User impact:** Invalid artifacts can be saved and discovered only during expensive SAP execution.
- **Recommended correction:** Add schema-driven client validation plus authoritative server preflight; show readiness at test, collection, and execution levels.
- **Effort:** Large.
- **Dependencies:** Shared contract/schema and preflight model.
- **Suggested implementation stage:** Phase 2 core workflows.

#### UX-038 — Evidence presentation lacks sensitivity and provenance cues

- **Screen/component:** Execution evidence and Audit.
- **File path:** `RunPanel.tsx`; `DocumentsPanel.tsx`.
- **Description/evidence:** Screenshots, captured values, log tail, and PDFs are linked/rendered without classification, redaction status, permanence, or source-target metadata.
- **User impact:** Users may share sensitive evidence or confuse scratch output with the immutable audit record.
- **Recommended correction:** Label artifact type, run/environment, capture time, retention/permanence, and redaction state; avoid displaying secrets and provide governed download behaviour.
- **Effort:** Medium–Large.
- **Dependencies:** Evidence metadata and security policy.
- **Suggested implementation stage:** Phase 2 Analyse.

### Low

#### UX-039 — Page heading hierarchy is inconsistent

- **Screen/component:** All functional screens.
- **File path:** `App.tsx`; screen components.
- **Description/evidence:** Only Overview has an `h1`. Functional views depend on shell breadcrumb and paragraph-based `.section-title` labels.
- **User impact:** Document outline and screen-reader navigation are weak; page purpose is less scannable.
- **Recommended correction:** Give each routed page one `h1`, use ordered `h2`/`h3` sections, and keep breadcrumb separate.
- **Effort:** Small.
- **Dependencies:** Routing/page-layout primitive.
- **Suggested implementation stage:** Shared page layout.

#### UX-040 — Icon-only actions depend on glyphs and `title`

- **Screen/component:** Data cells, row editors, chain picker, object highlighting.
- **File path:** `ListCell.tsx`; `TableRowsEditor.tsx`; `FileChainPicker.tsx`; `ObjectPicker.tsx`.
- **Description/evidence:** Several actions render corrupted character glyphs or arrows with title-only explanations.
- **User impact:** Meanings are not consistently visible, touch users have no hover title, and accessible names lack item context.
- **Recommended correction:** Use Lucide icons with visible or screen-reader labels, tooltips for supplemental help, and minimum target sizes.
- **Effort:** Small.
- **Dependencies:** Icon-button primitive.
- **Suggested implementation stage:** Shared components.

#### UX-041 — Typography is small and heavily uppercased

- **Screen/component:** Shell, labels, badges, tables.
- **File path:** `packages/studio-web/src/index.css`.
- **Description/evidence:** Base size is 13.5px; many labels/badges use 0.55–0.78rem uppercase with added tracking.
- **User impact:** Dense enterprise screens may be difficult at laptop resolutions or zoom, especially for low-vision users.
- **Recommended correction:** Adopt a 14–16px content baseline, reserve uppercase for short status tags, and validate zoom/reflow.
- **Effort:** Medium.
- **Dependencies:** Typography and density tokens.
- **Suggested implementation stage:** Phase 1 theme.

### Enhancements

#### UX-042 — Role-aware entry points and permissions are absent

- **Screen/component:** Shell and navigation.
- **File path:** `App.tsx`; server architecture.
- **Description/evidence:** Every user sees engineer capture/composition controls and audit functions; project brief recognises multiple future roles but current product is single-user.
- **User impact:** As the product expands, business/UAT/stakeholder users will face unnecessary complexity and unsafe actions.
- **Recommended correction:** After identity exists, define capability-based navigation and action permissions rather than separate products.
- **Effort:** Large.
- **Dependencies:** Real multi-user trigger, identity, RBAC requirements.
- **Suggested implementation stage:** Future enhancement.

#### UX-043 — Cross-artifact search and impact analysis are absent

- **Screen/component:** Global experience.
- **File path:** Current APIs and screens.
- **Description/evidence:** Search is local to templates, objects, transfer lists, or audit App ID. There is no “where used” path for objects, tests, data, or groups beyond one module-usage helper.
- **User impact:** Maintaining a growing automation estate requires manual inspection and increases unsafe edits.
- **Recommended correction:** Add global search and dependency/usage views after stable artifact IDs and routes exist.
- **Effort:** Large.
- **Dependencies:** Artifact indexing, stable IDs, routing.
- **Suggested implementation stage:** Future enhancement.

## Severity summary

| Severity | Count |
|---|---:|
| Critical | 3 |
| High | 20 |
| Medium | 15 |
| Low | 3 |
| Enhancement | 2 |
| **Total** | **43** |

## Recommended correction order

1. Remove false target/status/audit information and protect execution.
2. Restore the missing compatibility styling and establish a safe visual test baseline.
3. Bind local mode securely and expose authoritative workspace/environment context.
4. Correct encoding, focus, semantic labels, interactive card semantics, and drag alternatives.
5. Add routing, shared page layout, async states, and responsive shell standards.
6. Upgrade custom pickers and live-status announcements.
7. Redesign Composer/Data/Collections around readiness and preflight.
8. Separate live monitoring, run detail, failure analysis, and rerun recovery.
9. Add governed evidence metadata, history improvements, and automated accessibility coverage.
