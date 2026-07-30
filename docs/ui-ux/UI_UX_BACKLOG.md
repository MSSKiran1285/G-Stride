# SAP S/4HANA Test Automation Studio — Prioritised UI/UX Backlog

> **Superseded on 29 July 2026.** All work packages and their legacy IDs are
> consolidated in the authoritative
> [Product Backlog Tracker](./PRODUCT_BACKLOG_TRACKER.html). This file is retained
> for historical detail and must not be updated independently.

## Backlog rules

- No item authorises implementation; each becomes a reviewed work package.
- Backend contracts remain stable unless an item explicitly includes an impact assessment.
- Protected SQLite stores and audit evidence are never used as mutable UI-test fixtures.
- “Affected files” names the expected scope, not a licence for broad rewrites.
- Effort: **S** (small), **M** (medium), **L** (large).
- Risk: implementation/regression risk, not user-impact severity.

## Immediate corrections

These items correct misleading or broken present behaviour before broader redesign.

### IMM-01 — Remove unverified environment and connection claims

- **Category:** Foundation — Application shell.
- **User problem:** The shell shows a selectable active environment and connected state that do not control or reflect execution.
- **Proposed improvement:** Replace the selector/status with a clearly labelled “Execution target not configured in Studio” state until a server-backed contract exists; remove hard-coded compliance/health claims.
- **Affected files:** `packages/studio-web/src/App.tsx`; `components/AutomationOverview.tsx`.
- **Expected benefit:** Prevents false target confidence and restores operational trust.
- **Effort / risk:** S / Medium.
- **Prerequisites:** Approved interim copy; no backend change.
- **Acceptance criteria:** No UI element claims a verified target, connection, compliance status, or health percentage without data; build/lint pass.

### IMM-02 — Add an interim run-impact confirmation

- **Category:** Core workflow — Execution configuration.
- **User problem:** One generic click can start a run that creates SAP documents.
- **Proposed improvement:** Before POST, show mode, ordered members, App ID, data file, headless/evidence options, and an explicit warning that the backend-resolved SAP target must be verified. Require confirmation.
- **Affected files:** `components/RunPanel.tsx`.
- **Expected benefit:** Reduces accidental/duplicate real execution while authoritative preflight is designed.
- **Effort / risk:** S / Medium.
- **Prerequisites:** Approved safety copy; later replaced by EXE-01.
- **Acceptance criteria:** Run POST cannot occur before review/confirmation; confirmation defaults to cancel; keyboard focus is managed; regression test covers cancel/confirm.

### IMM-03 — Remove fabricated dashboard fallback records

- **Category:** Core workflow — Dashboard.
- **User problem:** Empty/error states show realistic but false counts, percentages, and document numbers.
- **Proposed improvement:** Render honest loading, unavailable, and empty states; label any optional demo mode persistently.
- **Affected files:** `components/AutomationOverview.tsx`; optionally `api.ts`.
- **Expected benefit:** Makes dashboard and audit information trustworthy.
- **Effort / risk:** S / Low.
- **Prerequisites:** None.
- **Acceptance criteria:** Empty APIs show zero/empty guidance; failed APIs show unavailable/retry; no fabricated business record appears.

### IMM-04 — Restore the functional-screen compatibility styles

- **Category:** Foundation — Theme and shared styles.
- **User problem:** Functional components reference many classes absent from the current stylesheet.
- **Proposed improvement:** Add the smallest token-based compatibility definitions for layout, feedback, status, chain lists, run banners, evidence, drag state, and utilities; do not redesign screens in this item.
- **Affected files:** `packages/studio-web/src/index.css`.
- **Expected benefit:** Restores predictable presentation and creates a valid visual baseline.
- **Effort / risk:** M / High.
- **Prerequisites:** Safe isolated visual runtime and before screenshots.
- **Acceptance criteria:** Every static class name used by TSX is defined or intentionally documented as utility-free; seven screens pass desktop smoke screenshots; no feature logic changes.

### IMM-05 — Normalize UI source encoding

- **Category:** Foundation — Content quality.
- **User problem:** Dashes, arrows, ellipses, multiplication marks, and status symbols display as corrupted text.
- **Proposed improvement:** Normalize UTF-8 and replace action/status glyphs with Lucide icons plus accessible text where appropriate.
- **Affected files:** `packages/studio-web/index.html`; `src/App.tsx`; `src/components/*.tsx`; repository text only where rendered.
- **Expected benefit:** Restores legibility and professional quality.
- **Effort / risk:** M / Medium.
- **Prerequisites:** Visual/text snapshot to avoid semantic changes.
- **Acceptance criteria:** No known mojibake sequences in frontend source/build output; actions retain clear accessible names; build/lint pass.

### IMM-06 — Add focus-visible and semantic dashboard actions

- **Category:** Foundation — Accessibility.
- **User problem:** Keyboard focus is not visible on buttons and overview cards are pointer-only.
- **Proposed improvement:** Add global focus tokens/styles and convert interactive cards/brand breadcrumb elements to buttons/links.
- **Affected files:** `index.css`; `AutomationOverview.tsx`; `App.tsx`.
- **Expected benefit:** Restores keyboard access to primary navigation.
- **Effort / risk:** S / Low.
- **Prerequisites:** Route links may initially remain buttons until routing.
- **Acceptance criteria:** All overview actions are tabbable and operable with Enter/Space; focus is visible in light/dark; no clickable non-interactive element remains in shell/overview.

### IMM-07 — Protect all unsaved artifact work

- **Category:** Core workflows — Composer, Data, Suites.
- **User problem:** New test/group drafts are considered clean, and datasets have no dirty tracking.
- **Proposed improvement:** Track persisted baseline and dirty state consistently; guard view unload/change; provide saved/unsaved status.
- **Affected files:** `TestCaseEditor.tsx`; `DataEditor.tsx`; `GroupEditor.tsx`; `App.tsx`.
- **Expected benefit:** Prevents accidental loss of complex edits.
- **Effort / risk:** M / Medium.
- **Prerequisites:** Shared navigation-guard interface; router version follows later.
- **Acceptance criteria:** New and edited artifacts warn before discard; successful save clears dirty state; cancelled navigation preserves edits; tests cover all three screens.

### IMM-08 — Make run polling recoverable

- **Category:** Core workflow — Execution monitoring.
- **User problem:** Transient polling failure can leave a stale running screen or unhandled rejection.
- **Proposed improvement:** Catch poll errors, show last update/disconnected state, retry with bounded backoff, and abort on unmount.
- **Affected files:** `RunPanel.tsx`; optional small polling helper.
- **Expected benefit:** Prevents duplicate reruns and communicates monitor health.
- **Effort / risk:** M / Medium.
- **Prerequisites:** None.
- **Acceptance criteria:** Simulated GET failure does not crash; user sees stale/disconnected state and recovery; polling stops when complete/unmounted.

### IMM-09 — Enforce local-workstation server binding

- **Category:** Foundation — Security.
- **User problem:** An unauthenticated mutation/execution API listens on all interfaces despite a local single-user product model.
- **Proposed improvement:** Default to loopback, document explicit opt-in for other binding, and assess local session/CSRF protection.
- **Affected files:** `packages/studio-server/src/index.ts`; `standalone.ts`; CLI studio command; documentation.
- **Expected benefit:** Aligns runtime exposure with product assumptions.
- **Effort / risk:** M / Medium.
- **Prerequisites:** CLI compatibility and deployment review.
- **Acceptance criteria:** Default listener is reachable locally but not advertised on all interfaces; intentional override is explicit; API tests pass.

### IMM-10 — Isolate and refresh frontend regression tests

- **Category:** Foundation — Quality.
- **User problem:** UI tests target stale native controls and write repository fixtures.
- **Proposed improvement:** Run server against temporary file/DB roots, update tests to current role-based interactions, and create a non-live smoke subset.
- **Affected files:** `regression/ui/*`; `regression/lib/*`; server test options; root scripts.
- **Expected benefit:** Makes visual/interaction changes reviewable without damaging project data.
- **Effort / risk:** M / Medium.
- **Prerequisites:** Temporary-storage test harness and Playwright browser availability.
- **Acceptance criteria:** Smoke suite starts isolated server, leaves repository artifacts unchanged, tests all seven views, and separates live SAP tests behind an explicit flag.

## Phase 1 redesign — Foundation

### FND-01 — Semantic tokens and theme baseline

- **Category:** Foundation — Theme and tokens.
- **User problem:** Palette names, hard-coded colours, typography, spacing, status, and interaction states are inconsistent.
- **Proposed improvement:** Add reference/semantic tokens, focus/reduced-motion rules, typography/spacing scales, and verified light/dark status colours.
- **Affected files:** `index.css`; new small token/style files if approved.
- **Expected benefit:** Consistent accessible visual language and safer incremental migration.
- **Effort / risk:** M / Medium.
- **Prerequisites:** IMM-04 baseline and contrast measurement.
- **Acceptance criteria:** Semantic tokens cover all current UI values; critical text/UI contrast passes AA; reduced motion works; no raw colour added in migrated components.

### FND-02 — Shared page/layout primitives

- **Category:** Foundation — Typography, spacing, shared page layout.
- **User problem:** Layout relies on absent classes and inline styles.
- **Proposed improvement:** Introduce `Page`, `PageHeader`, `Section`, `Stack`, and `Inline` primitives without changing business logic.
- **Affected files:** New `src/ui/layout/*`; approved screen files per migration.
- **Expected benefit:** Consistent hierarchy and responsive spacing.
- **Effort / risk:** M / Medium.
- **Prerequisites:** FND-01.
- **Acceptance criteria:** Primitive API is typed and documented; migrated page has one h1 and no equivalent inline layout styles; visual regression passes.

### FND-03 — URL routing and navigation guards

- **Category:** Foundation — Navigation.
- **User problem:** No deep links, history, refresh recovery, or stable artifact/run locations.
- **Proposed improvement:** Add lightweight routing and route-safe dirty guards, preserving current screen logic and Express catch-all.
- **Affected files:** `main.tsx`; `App.tsx`; screen entry components; `studio-server/src/server.ts` only if hosting adjustment is required.
- **Expected benefit:** Shareable/recoverable tasks and reliable failure-fix-rerun flow.
- **Effort / risk:** L / High.
- **Prerequisites:** IA approval; IMM-07; dependency justification if a router is added.
- **Acceptance criteria:** Proposed core routes load directly, refresh safely, support Back/Forward, preserve unsaved guards, and have unique titles.

### FND-04 — Simplified responsive application shell

- **Category:** Foundation — Application shell and responsive foundation.
- **User problem:** Five duplicated navigation mechanisms and no narrow shell behaviour.
- **Proposed improvement:** Implement one primary nav, server-backed context slot, responsive drawer, skip link, and utility actions; remove numbered pipeline/footer.
- **Affected files:** `App.tsx`; new shell/nav components; shell CSS.
- **Expected benefit:** More workspace, clearer IA, and accessible laptop/tablet use.
- **Effort / risk:** L / High.
- **Prerequisites:** FND-01–03; CTX-01 for authoritative context or honest unavailable state.
- **Acceptance criteria:** One primary nav; keyboard/mobile drawer works; current route indicated semantically; shell passes 320px/200% zoom checks.

### FND-05 — Shared buttons, fields, feedback, and async states

- **Category:** Foundation — Shared components.
- **User problem:** Screens implement inconsistent controls, raw errors, and loading/success feedback.
- **Proposed improvement:** Add typed `Button`, `IconButton`, `Field`, `StatusBadge`, `MessageStrip`, `AsyncState`, `EmptyState`, and toast/status regions.
- **Affected files:** New `src/ui/actions`, `forms`, `feedback`; `api.ts`; incremental consumers.
- **Expected benefit:** Predictable actions, validation, errors, and screen-reader announcements.
- **Effort / risk:** L / Medium.
- **Prerequisites:** FND-01/02 and error content guidelines.
- **Acceptance criteria:** All primitives define keyboard/focus/loading/error states; no required label uses placeholder only; live status region exists.

### FND-06 — Accessible picker and ordered-transfer patterns

- **Category:** Foundation — Shared components/accessibility.
- **User problem:** Grouped Picker and Object Picker lack complete ARIA behaviour; ordering feedback is weak.
- **Proposed improvement:** Implement accessible grouped combobox/listbox, editable object combobox, and ordered transfer list with move buttons and optional drag.
- **Affected files:** `GroupedPicker.tsx`; `ObjectPicker.tsx`; `FileChainPicker.tsx`; optional new UI primitives.
- **Expected benefit:** Unblocks keyboard/screen-reader operation across core workflows.
- **Effort / risk:** L / High.
- **Prerequisites:** FND-05; interaction tests.
- **Acceptance criteria:** APG keyboard patterns pass; roles/states are announced; ordering has named keyboard actions and live feedback; existing free-text object entry remains.

### FND-07 — Responsive table baseline

- **Category:** Foundation — Tables/responsive.
- **User problem:** Wide enterprise tables only gain horizontal scroll and lack shared semantics.
- **Proposed improvement:** Add `TableFrame`, captions, sticky headers, loading/empty rows, responsive column priority, and row action conventions.
- **Affected files:** New table primitives; table CSS; incremental screens.
- **Expected benefit:** Consistent scanability and accessibility without a large grid dependency.
- **Effort / risk:** M / Medium.
- **Prerequisites:** FND-01/02/05 and representative screen prototypes.
- **Acceptance criteria:** Keyboard-accessible scroll region, correct captions/headers, usable narrow fallback, and no lost primary action.

### FND-08 — Shared browser-safe contracts and error envelope

- **Category:** Foundation — Frontend architecture.
- **User problem:** Frontend types mirror core/server types and user errors are raw strings.
- **Proposed improvement:** Create a browser-safe contracts package or generated schema, plus typed safe API errors; preserve endpoints and payload semantics.
- **Affected files:** `packages/studio-web/src/types.ts`; `api.ts`; new shared package or core export; `studio-server/src/server.ts`.
- **Expected benefit:** Reduces contract drift and supports validation/preflight.
- **Effort / risk:** L / High.
- **Prerequisites:** Backend impact review; avoid pulling Node-only code into browser.
- **Acceptance criteria:** Frontend compiles from shared contracts; runtime responses for critical commands are validated; field/general errors are safe and actionable.

### CTX-01 — Authoritative workspace/environment context

- **Category:** Foundation — Context and safety.
- **User problem:** Workspace and execution target are implicit or decorative.
- **Proposed improvement:** Add read-only context/capability endpoint, verified target metadata, safety class, and profile reference; execution consumes the same context.
- **Affected files:** Server routes/options; CLI execution inputs; `api.ts`; shell; Run configuration.
- **Expected benefit:** Prevents wrong-workspace and wrong-environment actions.
- **Effort / risk:** L / High.
- **Prerequisites:** Security/credential architecture and backend contract impact assessment.
- **Acceptance criteria:** Shell and execution show identical server-backed context; stale/unavailable target blocks start; no secret reaches browser storage/logs.

### FND-09 — Accessibility and visual quality gate

- **Category:** Foundation — Accessibility/testing.
- **User problem:** No automated a11y, keyboard, contrast, or visual-regression gate.
- **Proposed improvement:** Add Axe route scans, keyboard journeys, semantic assertions, token contrast checks, and approved screenshots using isolated data.
- **Affected files:** Regression infrastructure; package scripts; CI configuration when present.
- **Expected benefit:** Prevents recurrence while modules migrate.
- **Effort / risk:** M / Low.
- **Prerequisites:** IMM-10 and stable routes/components.
- **Acceptance criteria:** All seven routes covered; no serious/critical Axe violations; keyboard smoke and light/dark visual baselines pass.

## Phase 1 redesign — Core workflows

### DASH-01 — Trustworthy task-focused Overview

- **Category:** Core workflow — Dashboard.
- **User problem:** Dashboard is dense, engineer-heavy, and mixes live, fallback, and marketing content.
- **Proposed improvement:** Show verified context, recent/failed runs, artifact readiness, and role-neutral task shortcuts; remove duplicate pipeline and speculative insights.
- **Affected files:** `AutomationOverview.tsx`; new dashboard subcomponents.
- **Expected benefit:** Faster orientation and attention to actionable work.
- **Effort / risk:** M / Medium.
- **Prerequisites:** CTX-01, FND-02/05, run history.
- **Acceptance criteria:** Every metric includes source/scope/freshness; empty/error states are truthful; primary tasks are keyboard-accessible; no duplicate navigation.

### TEST-01 — Test-case list and artifact header

- **Category:** Core workflow — Test-case management.
- **User problem:** Composer starts with a picker/create strip instead of a scalable test inventory.
- **Proposed improvement:** Add routeable test list with search/process-area/status and a consistent new/open artifact header; preserve JSON storage.
- **Affected files:** `TestCaseEditor.tsx`; new list/header components; routing.
- **Expected benefit:** Better discovery and stable artifact identity.
- **Effort / risk:** M / Medium.
- **Prerequisites:** FND-02/03/05; tag API.
- **Acceptance criteria:** Search/open/new are accessible; selected test has stable URL; file name is secondary metadata; existing files load unchanged.

### TEST-02 — Guided, validated Test Composer

- **Category:** Core workflow — Test composer.
- **User problem:** Technical schemas, weak validation, implicit App ID, and drag-only ordering produce runtime errors.
- **Proposed improvement:** Add explicit application scope, value-source controls, validation summary/readiness, accessible ordering, and contextual help while preserving module calls.
- **Affected files:** `TestCaseEditor.tsx`; `StepEditor.tsx`; `TableRowsEditor.tsx`; `ObjectPicker.tsx`.
- **Expected benefit:** More successful first-time authoring for functional users.
- **Effort / risk:** L / High.
- **Prerequisites:** TEST-01, FND-06/08, object/data contracts.
- **Acceptance criteria:** Required parameters cannot be silently saved invalid; literal/data/handoff source is clear; output dependencies are visible; existing test JSON round-trips.

### OBJ-01 — Object Repository workbench

- **Category:** Core workflow — Object repository.
- **User problem:** Browse, capture, curation, raw inspection, and editing compete on one long page.
- **Proposed improvement:** Separate repository list/detail from guided capture session; add first-use state, accessible actions, and usage impact before deletion.
- **Affected files:** `ObjectScanner.tsx`; `ObjectBrowser.tsx`; `CurationList.tsx`; object routes.
- **Expected benefit:** Faster reuse, safer maintenance, and clearer capture.
- **Effort / risk:** L / High.
- **Prerequisites:** FND-02/03/06/07; safe capture test setup.
- **Acceptance criteria:** Existing objects can be found before capture; capture has explicit stages/agent status; save/duplicate/unstable states are clear; API behaviour preserved.

### DATA-01 — Dataset management and validation

- **Category:** Core workflow — Test-data management.
- **User problem:** Data shape, placeholder coverage, nested rows, and unsaved state are unclear.
- **Proposed improvement:** Add dataset list/schema, explicit cell mode controls, editable columns with impact warnings, import preview, and placeholder readiness.
- **Affected files:** `DataEditor.tsx`; `ListCell.tsx`; `TableRowsEditor.tsx`; server validation only if approved.
- **Expected benefit:** Reduces runtime data failures and improves analyst usability.
- **Effort / risk:** L / High.
- **Prerequisites:** FND-03/05/07/08; TEST-02 variable model.
- **Acceptance criteria:** Scalar/list/table modes are named; missing/unused placeholders are reported; dirty guard works; CSV round-trip remains intact.

### COL-01 — Collections terminology and editor

- **Category:** Core workflow — Chains/suites/batches.
- **User problem:** Group/Process Suite/Chain/Suite/Batch terminology overlaps.
- **Proposed improvement:** Present stored Groups as dependent Business Process collections, explain execution semantics visually, validate member outputs/inputs, and retain current JSON/API.
- **Affected files:** `GroupEditor.tsx`; `FileChainPicker.tsx`; navigation/content.
- **Expected benefit:** Correct mode selection and more reliable process composition.
- **Effort / risk:** M–L / Medium.
- **Prerequisites:** IA approval, FND-06, TEST-02 readiness metadata.
- **Acceptance criteria:** Current groups open/save unchanged; collection type and execution semantics are explicit; member order is keyboard accessible; invalid dependencies are flagged.

### EXE-01 — Execution configuration and preflight

- **Category:** Core workflow — Execution configuration.
- **User problem:** Users can start expensive side-effecting runs without verified target or readiness.
- **Proposed improvement:** Create staged configuration, plain-language mode choice, scope summary, server preflight, risk-aware confirmation, and idempotency.
- **Affected files:** `RunPanel.tsx`; `api.ts`; server run/preflight routes; CLI contract if required.
- **Expected benefit:** Safer, more predictable execution.
- **Effort / risk:** L / High.
- **Prerequisites:** CTX-01, FND-08, TEST/DATA/COL readiness.
- **Acceptance criteria:** Target/tests/data rows/options/side effects are reviewed; failed preflight blocks run with fixes; repeated submit does not duplicate start.

## Phase 2 redesign

### RUN-01 — Dedicated live Run Monitor

- **Category:** Core workflow — Execution monitoring.
- **User problem:** Progress is limited to “Running/waiting” and local state disappears on navigation.
- **Proposed improvement:** Stable run URL, progress timeline, current step/test, elapsed and last-update status, background-safe monitoring, and completion notification.
- **Affected files:** Split `RunPanel.tsx`; run route/components; `api.ts`.
- **Expected benefit:** Users can confidently supervise long SAP runs.
- **Effort / risk:** L / High.
- **Prerequisites:** FND-03/05; reliable server progress data.
- **Acceptance criteria:** Refresh/reopen restores monitor; progress and disconnect are distinct; updates announced accessibly; completed run links to analysis.

### FAIL-01 — Run detail and focused failure analysis

- **Category:** Core workflow — Run details/failure analysis.
- **User problem:** Root failure is buried among configuration, tables, screenshots, and logs.
- **Proposed improvement:** Add failure summary/taxonomy, first-failure focus, collapsible passing timeline, expected/actual context, and links to source artifacts.
- **Affected files:** Run result components; `DocumentsPanel.tsx` replacement/detail; audit detail API consumption.
- **Expected benefit:** Faster diagnosis and fewer incorrect fixes.
- **Effort / risk:** L / High.
- **Prerequisites:** RUN-01, routing, richer result metadata where available.
- **Acceptance criteria:** First failure reachable in one action; step/test/environment/evidence shown together; passing detail remains available; no report contract regression.

### RERUN-01 — Correct and rerun with lineage

- **Category:** Core workflow — Failure recovery.
- **User problem:** Users manually reconstruct configuration after editing a failed artifact.
- **Proposed improvement:** Link failures to object/step/data, preserve run configuration, return after save, rerun failed/full scope, and record parent run.
- **Affected files:** Run detail, Composer/Object/Data routes, server run metadata.
- **Expected benefit:** Shorter and more trustworthy recovery loop.
- **Effort / risk:** L / High.
- **Prerequisites:** FAIL-01, stable artifact IDs/routes, backend lineage design.
- **Acceptance criteria:** Same configuration can be reviewed and rerun; differences are explicit; parent/child links appear in history.

### HIST-01 — Run History and evidence experience

- **Category:** Core workflow — Reports/Analyse.
- **User problem:** Audit filters are narrow and evidence/document concepts are fragmented.
- **Proposed improvement:** Rename to Run History, add test/date/user/run search, sorting, stable run detail, captured-document facet, and evidence provenance.
- **Affected files:** `DocumentsPanel.tsx`; new Analyse components; audit/document APIs if filters expand.
- **Expected benefit:** Reliable audit retrieval and stakeholder reporting.
- **Effort / risk:** L / Medium.
- **Prerequisites:** FND-03/07/08; RUN/FAIL detail.
- **Acceptance criteria:** Users can find a run by core identifiers/date/status; immutable PDF remains direct; scratch vs archived evidence is explicit; no sample records.

### SET-01 — Environment and application Administration

- **Category:** Core workflow — Settings.
- **User problem:** Settings do not exist while decorative environment options imply they do.
- **Proposed improvement:** Add server-backed environment metadata, connection test, capture-agent diagnostics, and evidence policy; secrets remain OS/server-side.
- **Affected files:** New Administration routes/components; server configuration APIs; credential/profile integration.
- **Expected benefit:** Authoritative, supportable configuration without leaking secrets.
- **Effort / risk:** L / High.
- **Prerequisites:** CTX-01, security review, real settings requirements.
- **Acceptance criteria:** Only authorised/appropriate local user can change settings; secret values never return to browser; connection results are timestamped and target-specific.

### A11Y-01 — Full WCAG 2.2 AA validation pass

- **Category:** Foundation — Accessibility validation.
- **User problem:** Automated checks cannot establish full keyboard/screen-reader/reflow quality.
- **Proposed improvement:** Manual NVDA/keyboard/zoom/high-contrast review of all core journeys; remediate findings.
- **Affected files:** Determined by results; accessibility audit record.
- **Expected benefit:** Practical accessibility beyond code semantics.
- **Effort / risk:** M–L / Medium.
- **Prerequisites:** Phase 1 shared patterns and representative redesigned workflows.
- **Acceptance criteria:** Core journeys complete keyboard-only; focus order/visibility and announcements verified; documented AA exceptions have rationale and mitigation.

## Future enhancements

### FUT-01 — Identity and capability-based roles

- **Category:** Foundation — Authentication/roles.
- **User problem:** A future team deployment would expose technical/destructive capabilities to everyone.
- **Proposed improvement:** Add real identity and capability-based visibility/authorization only when multi-user hosting is approved.
- **Affected files:** Shell, server middleware, audit identity, navigation, all mutation actions.
- **Expected benefit:** Safer role-appropriate experiences and attributable runs.
- **Effort / risk:** L / High.
- **Prerequisites:** Concrete multi-user trigger and deployment architecture.
- **Acceptance criteria:** Server enforces permissions; UI mirrors but does not replace enforcement; audit records stable identity.

### FUT-02 — Global search and dependency impact

- **Category:** Core workflow — Cross-product.
- **User problem:** Users cannot find artifacts globally or see where an object/data/test is used.
- **Proposed improvement:** Index/search artifacts and expose dependency/usage graph with safe edit impact.
- **Affected files:** New search API/index; shell search; artifact details.
- **Expected benefit:** Scalable maintenance and safer repository changes.
- **Effort / risk:** L / Medium.
- **Prerequisites:** Stable artifact IDs/routes and shared contracts.
- **Acceptance criteria:** Search covers tests, collections, data, objects, and runs; result permissions enforced; deletion/rename shows usage.

### FUT-03 — Reporting trends and stakeholder dashboards

- **Category:** Core workflow — Reports.
- **User problem:** History answers individual-run questions but not trend/risk questions.
- **Proposed improvement:** Add sourced, filterable pass-rate, duration, flaky-test, and failure-category trends with table alternatives.
- **Affected files:** Analyse pages; reporting aggregation API.
- **Expected benefit:** Better programme and test-management decisions.
- **Effort / risk:** L / Medium.
- **Prerequisites:** Trustworthy run metadata/taxonomy and real stakeholder requirements.
- **Acceptance criteria:** Every metric states numerator/denominator/range/filter/freshness; accessible table equivalent; no fabricated fallback.

### FUT-04 — Scheduling, notifications, and parallel execution

- **Category:** Core workflow — Execute.
- **User problem:** Unattended scale may require schedules, notifications, or parallelism.
- **Proposed improvement:** Add only from measured demand, with queue/resource/target safety and audit controls.
- **Affected files:** Execution service/CLI, server APIs, Execute UI.
- **Expected benefit:** Scales regression operations.
- **Effort / risk:** L / High.
- **Prerequisites:** Hosted execution architecture, identity, concurrency and SAP impact analysis.
- **Acceptance criteria:** Scheduling/parallelism cannot exceed approved environment limits; cancellation/audit/notifications are reliable.

## Recommended implementation sequence

1. IMM-01 through IMM-10, reviewed as separate small packages.
2. FND-01 semantic tokens and compatibility-safe theme.
3. FND-05 accessibility primitives plus FND-09 quality gate.
4. FND-03 routing and FND-04 shell/navigation.
5. FND-02 page layout, FND-06 pickers, and FND-07 tables.
6. CTX-01 authoritative context and FND-08 contracts/errors.
7. DASH-01 and TEST-01/02.
8. OBJ-01 and DATA-01.
9. COL-01 and EXE-01.
10. RUN-01, FAIL-01, and RERUN-01.
11. HIST-01 and SET-01.
12. A11Y-01 and only then evidence-led future enhancements.
