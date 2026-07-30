# Execution Center Product Backlog v2.0

**Product:** QA/4HANA Studio  
**Scope:** Authoritative consolidated backlog for the Execution Center redesign  
**Baseline:** Original EXC-001–EXC-028 backlog, implementation Stages 1–6, and closure assessment  
**Date:** 29 July 2026  
**Status:** Superseded historical baseline — tracked in Product Backlog Tracker

> **Superseded on 29 July 2026.** Execution Center stories, coverage and Stages
> 7–10 are now consolidated with every Studio workspace in the authoritative
> [Product Backlog Tracker](./PRODUCT_BACKLOG_TRACKER.html). Retain this document
> for detailed historical acceptance wording; do not update it independently.

## Purpose

This is the single source of truth for the Execution Center redesign. It
consolidates the original 28-story backlog, the decisions and scenario catalogue
agreed in Stages 1–6, and the six closure workstreams identified by the Stage 6
assessment.

The EXC2 stories group the unfinished acceptance criteria into implementable
release work. They do not narrow or remove the original requirements. Completed
EXC stories remain mandatory regression requirements, and partially completed
EXC stories remain open until both their original criteria and their mapped
EXC2 closure criteria pass.

## Consolidation and governance

- This document owns prioritisation, implementation status, sequencing, release
  gates, and acceptance decisions from 29 July 2026 onward.
- `EXECUTION_CENTER_PRODUCT_BACKLOG.md` is retained as the immutable historical
  baseline for its detailed story wording, examples, and decisions. It is
  superseded for planning and must not be updated independently.
- The original scenario catalogue SC-01–SC-26 and Examples A and B remain
  binding test inputs.
- EXC-004 and EXC-005 are carried forward as compatibility and regression
  obligations even though their implementation is substantially complete.
- No original acceptance criterion may be removed through an EXC2 grouping.
  Any intentional scope change requires a dated product decision in this file.
- A story is complete only when the implementation, automated tests, release
  evidence, and all mapped original acceptance criteria are complete.

## Consolidated traceability

| Original ID | Consolidated disposition | Closure owner |
|---|---|---|
| EXC-001 | Near complete; retain terminology regression and finish visual composition | EXC2-003 |
| EXC-002 | Near complete; retain versioned-plan regression and expose full hierarchy | EXC2-004 |
| EXC-003 | Partial; complete unified orchestration visibility and hierarchy | EXC2-004 |
| EXC-004 | Implemented baseline; preserve legacy translation compatibility | Regression baseline |
| EXC-005 | Complete; permanently protect multi-row Batch behavior | Regression baseline |
| EXC-006 | Partial; finish contracts in mapping and visual composition | EXC2-002, EXC2-003 |
| EXC-007 | Partial; finish namespaced hand-offs and builder representation | EXC2-002, EXC2-003 |
| EXC-008 | Partial; finish scope binding, snapshot preview, and lineage | EXC2-002 |
| EXC-009 | Partial; finish nested header/child design and preview | EXC2-002 |
| EXC-010 | Partial; finish relational dataset design and validation | EXC2-002 |
| EXC-011 | Materially outstanding; implement mapping, preview, and validation UI | EXC2-002 |
| EXC-012 | Near complete; surface isolated iterations in the monitor | EXC2-004 |
| EXC-013 | Near complete; surface granular child progress in the monitor | EXC2-004 |
| EXC-014 | Partial; expose and validate session, failure, filter, and iteration policies | EXC2-002 |
| EXC-015 | Partial; finish Pack scheduling design and monitor hierarchy | EXC2-002, EXC2-004 |
| EXC-016 | Partial; finish safe recovery, differences, and rerun UX | EXC2-004, EXC2-005 |
| EXC-017 | Near complete; finish accessible visual workspace behavior | EXC2-003, EXC2-006 |
| EXC-018 | Materially outstanding; implement visual composition | EXC2-003 |
| EXC-019 | Materially outstanding; implement data and iteration design | EXC2-002 |
| EXC-020 | Partial; finish authoritative preflight, identity, and security coverage | EXC2-001, EXC2-002, EXC2-006 |
| EXC-021 | Partial; finish calculated matrix review and rerun differences | EXC2-002, EXC2-005 |
| EXC-022 | Partial; finish stable hierarchy and accessibility | EXC2-004, EXC2-006 |
| EXC-023 | Partial; finish diagnosis, correction paths, and rerun lineage | EXC2-005, EXC2-006 |
| EXC-024 | Partial; close artifact access, evidence lineage, and monitor lineage | EXC2-001, EXC2-004, EXC2-005 |
| EXC-025 | Partial; close authentication, target safety, and secret isolation | EXC2-001, EXC2-006 |
| EXC-026 | Partial; finish keyboard, screen-reader, responsive, and visual behavior | EXC2-003, EXC2-004, EXC2-006 |
| EXC-027 | Partial; finish hierarchy-backed operational metrics | EXC2-004, EXC2-006 |
| EXC-028 | Partial; complete security, migration, data, recovery, and release regressions | EXC2-001, EXC2-002, EXC2-005, EXC2-006 |

### Binding scenario coverage

| Scenario group | Original scenarios | Primary closure owner |
|---|---|---|
| Run modes and compatibility | SC-01–SC-04 | Regression baseline, EXC2-003 |
| Nested and relational data | SC-05–SC-10 | EXC2-002 |
| Hand-offs and execution isolation | SC-11–SC-16 | EXC2-002, EXC2-003, EXC2-004 |
| Filters, limits, and failure policies | SC-17–SC-20 | EXC2-002, EXC2-004 |
| Recovery and cancellation | SC-21–SC-23 | EXC2-004, EXC2-005 |
| Migration, accessibility, and evidence | SC-24–SC-26 | EXC2-001, EXC2-006 |

Every scenario below must be represented in automated contract, integration, or
UI tests before 2.0 GA:

| ID | Scenario | Required outcome |
|---|---|---|
| SC-01 | Single Test without a dataset | One iteration uses configured constants and safe system context |
| SC-02 | Single Test with one data record | One isolated iteration is created |
| SC-03 | Single Test with multiple data records | One iteration is created for each selected record |
| SC-04 | Business Process with one transaction | Stages run in order and declared outputs feed later stages |
| SC-05 | One sales-order header with multiple line items | One order is created and the inner loop processes every item |
| SC-06 | Multiple sales orders with multiple line items | One isolated process iteration runs per order |
| SC-07 | Stage-specific input override | The override affects only that stage and appears in review and evidence |
| SC-08 | Process output hand-off | Each downstream stage receives its declared upstream output |
| SC-09 | Missing required hand-off | Preflight blocks Start and links to the unmapped input |
| SC-10 | Duplicate data/output name | Namespaces prevent collisions and ambiguous legacy placeholders are rejected or migrated |
| SC-11 | Regression Pack with independent Single Tests | Members use isolated contexts and may bind different datasets |
| SC-12 | Regression Pack containing Business Processes | Each process retains its stages, iterations, hand-offs, and evidence |
| SC-13 | Failure inside a Business Process | Remaining stages in that iteration do not run |
| SC-14 | Failure in one Regression Pack member | The next independent member runs unless execution is cancelled |
| SC-15 | Continue after an iteration failure | Only an explicit policy permits it, and failed outputs never leak |
| SC-16 | Stop all work after an iteration failure | The safe Process default prevents later iterations from starting |
| SC-17 | Nested JSON dataset | Headers and child arrays are validated, previewed, snapshotted, and executed |
| SC-18 | Relational CSV dataset | Declared keys join headers and children; duplicates and orphans are reported |
| SC-19 | Dataset filter and maximum limit | Preflight and review use the effective filtered and limited count |
| SC-20 | Browser/session reuse | Review shows the policy and execution does not share transaction outputs |
| SC-21 | Cancellation | No new unit starts and active work reaches a defined safe boundary |
| SC-22 | Refresh during execution | The stable run URL rehydrates progress and status from persisted server state |
| SC-23 | Legacy Chain request | Translation produces an equivalent Business Process plan |
| SC-24 | Legacy Suite request | Translation produces an equivalent Regression Pack plan |
| SC-25 | Legacy Batch with multiple Group rows | Every intended row executes; first-row-only behavior cannot regress |
| SC-26 | Canonical evidence access | Execution Center and Audit and Evidence resolve the same archived document |

## Product outcomes

1. Execution reports and evidence are accessible only to the authenticated
   workspace owner.
2. Users can inspect and validate effective data mappings before SAP is opened.
3. Tests, Business Processes, and Regression Packs can be composed visually.
4. Monitoring exposes the complete execution hierarchy without flattening
   stages, steps, or child work.
5. A rerun clearly explains its source, scope, differences, and expected impact.
6. Accessibility and live-SAP release evidence are sufficient for production
   approval.

## Prioritisation

| Priority | Meaning |
|---|---|
| **P0** | Security, execution correctness, or production-release requirement |
| **P1** | Required to complete the agreed product experience |
| **P2** | Operational refinement that can follow the first approved release |

## Backlog summary

| ID | Story | Priority | Points | Depends on |
|---|---|---:|---:|---|
| EXC2-001 | Secure execution artifacts and record initiating identity | P0 | 13 | Stage 6 authentication and snapshot lineage |
| EXC2-002 | Design, map, preview, and filter execution data | P0 | 13 | Execution Plan data bindings and preflight |
| EXC2-003 | Build Tests, Business Processes, and Regression Packs visually | P1 | 13 | EXC2-002 and Test contracts |
| EXC2-004 | Complete the hierarchical execution monitor | P1 | 13 | Persisted events and Stage 5 recovery state |
| EXC2-005 | Review, diagnose, and rerun with explicit differences | P1 | 13 | EXC2-002 and EXC2-004 |
| EXC2-006 | Complete accessibility and production release verification | P0 | 13 | EXC2-001 through EXC2-005 |

**Total:** 78 story points

---

## EXC2-001 — Secure execution artifacts and record initiating identity

**Priority:** P0  
**Points:** 13

### User story

As the workspace owner, I want reports, screenshots, evidence, execution
controls, and audit records protected by authenticated identity so that
sensitive business information cannot be accessed outside the approved
workspace session.

### Acceptance criteria

1. `/reports` and `/audit-evidence` require the same authenticated-owner check
   as execution and audit APIs.
2. Unauthenticated artifact requests return `401`; authenticated non-owner
   requests return `403`.
3. Evidence and screenshot URLs continue to open from Execution Center and
   Audit and Evidence after protection is enabled.
4. Canonical artifact URLs retain traversal and absolute-path protections.
5. Every preflight, Start, cancel, rerun, result, and evidence access records the
   authenticated initiating or requesting identity as appropriate.
6. Execution state records the initiating user ID, display name, and email
   without copying authentication tokens.
7. Evidence identifies the executor and safe target hostname.
8. A changed, stale, unavailable, or mismatched SAP target invalidates
   preflight before Start.
9. Production-like target rules support a stronger warning and explicit
   acknowledgement.
10. Passwords, tokens, cookies, authorization headers, and credential-store
    values are absent from frontend state, snapshots, events, state files,
    history, logs, screenshots, evidence, metrics, and error responses.
11. Automated security tests inspect persisted and returned artifacts for known
    synthetic secrets.
12. Security headers and `Cache-Control: no-store` remain enabled for protected
    artifact responses.

### Design considerations

- Use authenticated streaming or guarded static-file middleware without
  exposing absolute filesystem paths.
- Preserve browser PDF/image viewing and download behavior.
- Do not place session tokens in query strings or canonical evidence URLs.
- Existing canonical evidence references must remain stable.

### Scenarios

- Unauthenticated evidence request
- Authenticated owner evidence request
- Path traversal attempt
- Target changed between preflight and Start
- Synthetic credential present in a child-process error
- Rerun initiated by the authenticated owner

---

## EXC2-002 — Design, map, preview, and filter execution data

**Priority:** P0  
**Points:** 13

### User story

As an execution configurator, I want to inspect transaction data, child
collections, and effective input mappings before execution so that I understand
exactly what will run and can correct errors before SAP is opened.

### Acceptance criteria

1. The UI distinguishes process-level, stage-level, and Pack-member data
   bindings.
2. Every required Test or Process input appears beside its effective source:
   literal, system context, process data, or prior-stage output.
3. Missing inputs, unresolved outputs, type mismatches, duplicate mappings,
   ambiguous legacy placeholders, and unused fields are reported separately.
4. Nested JSON transactions display header fields and expandable owned child
   collections.
5. Relational CSV preview groups child rows beneath the correct parent record.
6. The preview clearly distinguishes transaction count from total child-record
   count.
7. Users can inspect the effective mapping and values for a selected
   transaction without exposing credentials or disallowed sensitive values.
8. Record selection and a bounded filter expression can be configured.
9. Filtering parent transactions automatically retains only their owned child
   rows.
10. Maximum iteration count and record filters update the execution matrix
    immediately.
11. Pack members may bind different datasets and policies without sharing
    runtime outputs.
12. Large datasets use bounded preview, pagination, or virtualisation and remain
    keyboard accessible.
13. Preflight and execution consume the same validated mapping and filtered
    snapshot.
14. Validation errors include a correction link to the affected Test, Stage,
    Dataset, or mapping.
15. Downloadable nested-JSON and relational-CSV examples are available.

### Design considerations

- Preview only a safe, bounded subset; snapshot the complete selected data on
  the server.
- Apply contract sensitivity metadata consistently.
- Do not allow the browser to declare a mapping valid independently of server
  preflight.
- Preserve scalar CSV/JSON compatibility.

### Scenarios

- One order with multiple line items
- Multiple orders with different line-item counts
- Relational CSV with an orphan child
- Duplicate parent key
- Required input missing from one selected transaction
- Filtered dataset with maximum iteration count
- Regression Pack members using different datasets

---

## EXC2-003 — Build Tests, Business Processes, and Regression Packs visually

**Priority:** P1  
**Points:** 13

### User story

As a process author, I want a visual execution canvas so that sequence,
independence, data bindings, and output hand-offs are understandable without
interpreting filenames or legacy runtime modes.

### Acceptance criteria

1. A Single Test appears as one executable card showing its application,
   contract, data binding, readiness, and expected iteration count.
2. A Business Process appears as ordered stage cards connected by directional
   hand-offs.
3. A Regression Pack appears as independent member lanes and does not visually
   imply shared runtime state.
4. A Pack can contain Single Tests, Business Processes, or both.
5. Cards show display name first; technical filename and legacy mode remain
   secondary metadata.
6. Selecting a stage shows declared inputs, outputs, effective mappings, and
   readiness findings.
7. Selecting a hand-off shows source output, destination input, data type,
   sensitivity, compatibility, and fallback.
8. Invalid future-stage references, circular dependencies, and incompatible
   mappings are blocked.
9. Add, remove, move up, move down, and map operations are available without
   drag-and-drop.
10. Drag-and-drop, if retained, is an optional enhancement rather than the only
    interaction.
11. Reordering updates stage IDs and references safely without silently changing
    declared semantics.
12. The canvas reflows at supported laptop widths, 320 CSS pixels, and 200%
    zoom.
13. The complete canvas can be operated with keyboard and assistive technology.

### Design considerations

- Reuse the existing Canvas First visual system, coral actions, and deep navy
  typography.
- Keep configuration separate from the live run monitor.
- Do not alter source Test or Process artifacts merely by configuring a run.
- Preserve browser Back/Forward and unsaved-change protection.

### Scenarios

- Single reusable Test with data
- Three-stage O2C Business Process
- Explicit Sales Order → Delivery → Billing hand-offs
- Regression Pack containing a Test and two Business Processes
- Keyboard-only stage reordering

---

## EXC2-004 — Complete the hierarchical execution monitor

**Priority:** P1  
**Points:** 13

### User story

As a tester, I want the monitor to follow the actual execution hierarchy so that
I can identify exactly what is running, completed, failed, cancelled, skipped,
or not attempted.

### Acceptance criteria

1. The monitor presents:
   `Execution → Pack member → Iteration → Stage → Step → Child work`.
2. Every level exposes a stable ID, safe label, status, start time, duration,
   and available evidence.
3. Iteration statuses distinguish planned, running, passed, failed, cancelled,
   skipped, and not attempted.
4. The summary shows target hostname, executor, elapsed time, last update,
   monitor connectivity, and overall progress.
5. Monitor connectivity is visually and semantically separate from execution
   status.
6. Current member, transaction, stage, step, and child position are visible
   where known.
7. Progress uses real known work totals and never simulates completion.
8. Unknown totals alone use indeterminate progress.
9. Child progress reconciles correctly on success, failure, and cancellation.
10. Refresh, temporary disconnect, server restart, and browser reopening
    rehydrate the same run without starting new work.
11. Persisted execution events can reconstruct the latest safe hierarchy when a
    summary or progress file is incomplete.
12. Completed units link to their canonical evidence.
13. Meaningful changes are announced accessibly without announcing every poll.
14. Large Packs and transaction sets use progressive disclosure or
    virtualisation.

### Design considerations

- Do not flatten stage and step data into separate unrelated tables.
- Preserve partial results after cancellation or interruption.
- Make the first root failure easy to locate without hiding successful prior
  work.
- Monitor rendering must not depend on the original browser session.

### Scenarios

- One transaction with five child line items
- Multiple transactions in one Business Process
- Regression Pack containing multiple Business Processes
- Cancellation during an active transaction
- Browser refresh and server restart during execution
- Temporary monitor connectivity loss

---

## EXC2-005 — Review, diagnose, and rerun with explicit differences

**Priority:** P1  
**Points:** 13

### User story

As an automation engineer, I want failed work and reruns explained in context so
that I can correct the actual cause and avoid recreating successful SAP
documents.

### Acceptance criteria

1. A failed run opens with the first root failure selected.
2. Diagnosis shows member, transaction, safe transaction label, stage, step,
   child index/key, category, duration, and safe error.
3. Relevant mapped inputs, prior-stage outputs, expected/actual values,
   screenshot, evidence, and bounded log context appear together when
   available.
4. Correction links open the implicated Test, Process mapping, Object Repository
   entry, or Dataset and retain a return link to the run.
5. The user can choose full original scope or eligible failed/unattempted scope.
6. Before rerun, the UI performs a new authoritative preflight and shows the
   resulting execution matrix.
7. Rerun review highlights scope, data, mapping, target, and policy differences
   from the parent.
8. The user must enter a rerun reason.
9. The new execution records parent ID, initiating identity, reason, scope, and
   idempotency key.
10. The original snapshot, results, logs, history, and evidence are never
    overwritten.
11. Parent and child runs link to one another and to their canonical evidence.
12. “Resume” is never shown unless completed side effects can be proven safely.
13. Cancellation and rerun tests cover before start, during a stage, between
    iterations, and between Pack members.

### Design considerations

- A rerun is always a new execution.
- Default failed-scope behavior must not include previously successful
  side-effectful transactions.
- Differences must be calculated on the server from immutable snapshots.
- Sensitive input/output values remain redacted.

### Scenarios

- Failed second transaction in a three-transaction process
- Failed child item within a sales order
- Failed Pack member with later members not attempted
- Full rerun after a corrected Object Repository entry
- Duplicate rerun submission with the same request key

---

## EXC2-006 — Complete accessibility and production release verification

**Priority:** P0  
**Points:** 13

### User story

As the workspace owner, I want objective accessibility, migration, security, and
live-SAP release evidence so that production approval is based on verified
behavior rather than implementation assumptions.

### Acceptance criteria

1. Axe reports no serious or critical issues for new execution, data mapping,
   visual composition, preflight, monitor, failure, cancellation, and rerun
   states.
2. All supported execution journeys complete keyboard-only.
3. Dialogs and drawers manage focus entry, containment, Escape, and return.
4. Errors are associated with fields/cards and summarized through focusable
   correction links.
5. Views retain functionality at 320 CSS pixels and 200% zoom.
6. Light, dark, reduced-motion, and Windows forced-colour states are verified.
7. NVDA/Chromium results, test steps, and any approved exceptions are
   documented.
8. Isolated tests cover every non-live scenario in the original Scenario
   Catalogue.
9. Data tests cover scalar JSON/CSV, nested JSON, relational CSV, filters,
   limits, duplicates, orphans, blank keys, and malformed child collections.
10. UI tests cover mapping, preview, visual composition, preflight, matrix
    review, refresh-safe monitoring, cancellation, diagnosis, and rerun.
11. Execution-disabled fixtures cannot spawn the CLI or mutate production
    reports, history, evidence, credentials, or repositories.
12. Live SAP tests require an explicit flag, approved identity, target, test
    data, expected business documents, cleanup/reconciliation steps, and owner
    approval.
13. Approved live tests verify positive execution, negative behavior,
    cancellation, failed-scope rerun, evidence reconciliation, and no duplicate
    documents.
14. Build, typecheck, lint, isolated regression, accessibility automation,
    secret scanning, and approved live checks pass before production release.
15. Test execution leaves no credentials, reports, databases, evidence, or
    synthetic fixtures in version control.

### Release evidence

- Automated test output
- Axe reports
- NVDA test record
- Live SAP execution IDs and expected document reconciliation
- Secret-scan result
- Artifact-access security result
- Approved retention-policy record

---

## Stage-wise release plan

Stages 1–6 established the terminology, execution-plan contract, unified
orchestration, multi-row execution, persisted snapshots and events, recovery
state, evidence lineage, authentication foundation, and the current release
candidate. The following stages close the consolidated backlog.

### Stage 7 — Security, identity, and governance closure

**Release:** 2.0 Alpha  
**Primary scope:** EXC2-001 and the security foundations of EXC2-006  
**Original traceability:** EXC-020, EXC-024, EXC-025, EXC-028

**Entry gate**

- Stage 6 authentication, execution snapshot, event store, and canonical
  evidence behavior remain green in isolated regression.
- Artifact routes, identity fields, secret-bearing paths, and retention targets
  are inventoried.

**Delivery scope**

- Protect reports, evidence, execution details, downloads, and related artifacts
  with the same owner authentication and authorization policy as the API.
- Persist the initiating owner identity and safe target classification against
  every new execution.
- Apply denial behavior that does not reveal artifact existence.
- Complete log, event, evidence, and diagnostic redaction checks.
- Add artifact-access, identity-lineage, secret-scan, and retention-policy tests.
- Record the product decisions for target classification, diagnostic visibility,
  and retention.

**Exit gate**

- Anonymous and non-owner artifact access is denied.
- The authenticated owner can access existing workspace history without data
  migration or loss.
- Executor identity and target classification reconcile across run, history,
  metrics, evidence, and audit views.
- Secret scanning and artifact-access security tests pass.
- Retention behavior is approved and documented.

### Stage 8 — Data mapping and iteration design

**Release:** 2.0 Beta  
**Primary scope:** EXC2-002  
**Original traceability:** EXC-006–EXC-011, EXC-014, EXC-015,
EXC-019–EXC-021, EXC-028

**Entry gate**

- Stage 7 security gates pass.
- Test input/output contracts and current execution bindings are documented.
- Synthetic nested and relational fixtures exist for one-to-many and
  many-to-many iteration cases.

**Delivery scope**

- Add source selection, field mapping, type validation, defaults, required
  fields, and member-specific binding.
- Preview the exact immutable snapshot that execution will consume.
- Support nested JSON and relational CSV header/item relationships.
- Design outer transaction iterations and inner child-item loops separately.
- Add filters, maximum-iteration limits, empty-result behavior, and policy
  validation.
- Show hand-off sources, namespaced outputs, calculated execution counts, and
  correction links before Start.
- Ensure preview, preflight, and execution use the same authoritative mapping
  model and snapshot.

**Exit gate**

- SC-05–SC-10 and SC-17–SC-20 pass with deterministic counts and values.
- One header with many items and many headers with many items can be previewed
  and executed without flattening or cross-iteration data leakage.
- Invalid mappings and policies block Start with an actionable correction path.
- Review counts reconcile with snapshot, monitor, history, metrics, and evidence.

### Stage 9 — Visual composition and complete monitoring

**Release:** 2.0 Release Candidate  
**Primary scope:** EXC2-003 and EXC2-004  
**Original traceability:** EXC-001–EXC-003, EXC-006, EXC-007,
EXC-012, EXC-013, EXC-015, EXC-017, EXC-018, EXC-022, EXC-024,
EXC-026, EXC-027

**Entry gate**

- Stage 8 mappings, contracts, policies, and calculated matrix are stable.
- Persisted event contracts contain identifiers for every required hierarchy
  level.

**Delivery scope**

- Provide accessible visual builders for Tests, Business Processes, and
  Regression Packs.
- Represent sequence, parallel lanes, input/output contracts, hand-offs,
  bindings, policies, validation, and version status without hidden semantics.
- Render the full hierarchy: Pack, Process, Test, Iteration, Step, and Child
  Item.
- Reconstruct monitor state from persisted events after refresh or reconnect.
- Preserve stable row identity, progress totals, status, duration, failure
  location, lineage, and evidence links.
- Back metrics with the same hierarchy and event data used by the monitor.

**Exit gate**

- The builder supports keyboard-only composition, validation, and saving.
- SC-01–SC-04 and SC-11–SC-16 can be composed or inspected without editing raw
  plan JSON.
- Monitor counts and status survive refresh/reconnect without starting duplicate
  work.
- All six hierarchy levels are independently inspectable and reconcile with
  history and evidence.

### Stage 10 — Recovery experience and production approval

**Release:** 2.0 General Availability  
**Primary scope:** EXC2-005 and the remaining EXC2-006 verification  
**Original traceability:** EXC-016, EXC-021, EXC-023–EXC-028

**Entry gate**

- Stages 7–9 exit gates pass.
- Approved live SAP identity, target, test data, expected outcomes, cleanup, and
  reconciliation procedure are recorded.

**Delivery scope**

- Add review and diagnosis views with failure location, correction links,
  source snapshot, plan version, and evidence lineage.
- Preview rerun scope and explicitly compare source and rerun plan, data,
  policies, target, and expected business impact.
- Preserve parent/child lineage for iteration, test, process, and pack reruns.
- Complete Axe, keyboard, NVDA, responsive, migration, cancellation, resume,
  evidence, and artifact-security verification.
- Execute only the approved live SAP cases and reconcile expected business
  documents to prove that retries and reruns do not duplicate side effects.
- Produce the signed release-evidence pack.

**Exit gate**

- SC-21–SC-26 and all mapped original acceptance criteria pass.
- Reruns cannot start until their scope and differences are reviewed.
- Axe reports contain no unapproved serious or critical findings, and NVDA
  verification is signed.
- Approved live SAP cases reconcile with no duplicate business documents.
- There is one canonical evidence document per run/group, referenced from both
  Execution Center and Audit and Evidence.
- Product, security, accessibility, and release owners approve 2.0 GA.

### Dependency and release rules

1. Stage 7 is the production security gate and cannot be deferred past Alpha.
2. Stage 8 must stabilize the data model before Stage 9 binds visual components
   to it.
3. Stage 9 hierarchy and persisted event behavior must stabilize before Stage 10
   signs off diagnosis and rerun behavior.
4. EXC2-006 automation may be added continuously, but final manual accessibility
   and live SAP evidence belongs to Stage 10.
5. A stage may be demonstrated before its exit gate, but the next named release
   cannot be promoted until every exit criterion and mapped regression passes.

### Release evidence by stage

| Stage | Release artifact | Minimum evidence |
|---|---|---|
| 7 | 2.0 Alpha | Artifact authorization, owner identity lineage, secret scan, retention approval |
| 8 | 2.0 Beta | Mapping/preview tests, nested and relational fixtures, matrix reconciliation |
| 9 | 2.0 RC | Keyboard builder record, hierarchy/event reconstruction tests, metrics reconciliation |
| 10 | 2.0 GA | Rerun lineage, Axe and NVDA records, approved live SAP reconciliation, signed release pack |

## Definition of Ready

A story is ready when:

1. Its API, persistence, UI, security, evidence, and compatibility impacts are
   identified.
2. Safe synthetic fixtures cover the isolated acceptance criteria.
3. Sensitive fields and redaction behavior are specified.
4. Accessibility behavior is testable.
5. Any live SAP validation has approved identity, target, data, expected
   outputs, and cleanup/reconciliation steps.

## Definition of Done

A story is done when:

1. Every acceptance criterion passes.
2. Contracts and migration behavior are typed and documented.
3. Server and browser validation use the same authoritative model.
4. Build, typecheck, lint, isolated regression, applicable Axe checks, and
   secret scanning pass.
5. No live SAP action occurs without explicit approval.
6. No credentials, temporary databases, generated reports, evidence, or
   synthetic fixtures remain in version control.
7. Errors are safe, actionable, and associated with a correction path.
8. Counts reconcile across snapshot, monitor, history, metrics, and evidence.
9. The product documentation is updated in the same change.

## Consolidated product decisions

### Decisions already agreed

1. User-facing scope is **Single Test**, **Business Process**, and
   **Regression Pack**; Chain, Suite, and Batch are compatibility terms only.
2. A Business Process stops safely after a failed transaction iteration unless
   the user explicitly selects a different supported policy.
3. Transaction iterations default to isolated browser/session and output
   contexts.
4. Nested JSON and relational two-file CSV are the supported one-to-many data
   formats for the 2.0 release.
5. Execution Center and Audit and Evidence reference one canonical evidence
   artifact rather than generating competing versions.
6. Parallel execution, calendar scheduling, multi-user roles, and production
   execution for Salesforce, Oracle, and ServiceNow remain outside 2.0 unless
   added through an approved scope decision.

### Decisions required before the named gate

| Decision | Required by |
|---|---|
| Approve production-like target classification rules | Stage 7 exit |
| Approve which business values may remain visible in diagnostics and evidence | Stage 7 exit |
| Approve a finite retention period or retain-until-owner-deletes policy | Stage 7 exit |
| Choose whether correction links open in place, in a new tab, or in a side drawer | Stage 8 exit |
| Approve live SAP identity, data, expected outputs, cleanup, and reconciliation | Stage 10 entry |
| Approve any documented NVDA or Axe exception | Stage 10 exit |
