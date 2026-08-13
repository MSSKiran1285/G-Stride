# Execution Center Redesign — Product Backlog

**Product:** G-Stride  
**Scope:** Execution configuration, data binding, orchestration, monitoring, results, and evidence  
**Status:** Superseded historical baseline — do not update independently  
**Date:** 28 July 2026

> **Superseded on 29 July 2026.** Planning, implementation status, release
> sequencing, and acceptance governance now live in the authoritative
> [Product Backlog Tracker](./PRODUCT_BACKLOG_TRACKER.html).
> This file is retained unchanged below as the detailed historical baseline;
> its story criteria, scenarios, examples, and product decisions are incorporated
> into the consolidated backlog through explicit traceability.

## Purpose

This backlog defines the functional and experience redesign of Execution Center. It replaces the current presentation of Chain, Suite, and Batch as three peer modes with a clearer execution model based on the business intent of the run.

The redesign must support:

- A single independently executable test.
- An ordered end-to-end business process whose stages share outputs.
- A regression pack containing independent tests or complete business processes.
- One business-document header with multiple child line items.
- Multiple business-document headers, each with its own line items.
- Explicit test input, output, data, session, iteration, and failure policies.
- Preflight validation and an understandable calculation of the work that will run.
- Refresh-safe monitoring from execution through iteration, stage, step, and child-item progress.
- One canonical evidence source referenced consistently by Execution Center and Audit and Evidence.

This document refines and expands the Execution Center portions of `PRODUCT_BACKLOG.md`, particularly PB-012, PB-019, PB-022 through PB-029, and PB-030.

## Product outcomes

1. A user chooses what they intend to execute without needing to understand internal CLI terminology.
2. The system calculates and previews the exact execution scope before SAP is touched.
3. Data is attached at the correct scope and validated before execution.
4. Values handed from one process stage to another are explicit, typed, and traceable.
5. Outer transaction loops and inner child-record loops behave consistently.
6. Every execution can be monitored and reopened using a stable URL.
7. Results, evidence, inputs, outputs, and reruns preserve a clear audit lineage.
8. Existing Chain, Suite, Batch, test-case, Group, and CLI contracts remain operable during migration.

## Proposed user-facing terminology

| Concept | User-facing meaning | Runtime semantics |
|---|---|---|
| **Single Test** | One reusable automated test | One test definition, optionally repeated for each selected data record |
| **Business Process** | Ordered stages that together complete a business outcome | Shared process context and explicit output-to-input hand-offs; fail-fast within an iteration by default |
| **Regression Pack** | Independent tests and/or Business Processes executed as one campaign | Isolated member context; continue to the next member after a failure |
| **Execution** | One submitted, immutable run request | Contains one or more iterations and a frozen configuration/data snapshot |
| **Iteration** | One transaction-level pass through a Test or Business Process | Own input record, outputs, session policy, result, and evidence scope |
| **Stage** | One Test used inside a Business Process | Declared inputs and outputs; ordered within the process |
| **Child collection** | Repeated records owned by one transaction, such as sales-order line items | Inner loop executed within the current iteration and stage |

“Chain,” “Suite,” and “Batch” remain compatibility/runtime values during migration. They should not remain the primary product language:

- Chain translates to a Business Process.
- Suite translates to a Regression Pack of independent Single Tests.
- Batch translates to a Regression Pack whose members are Business Processes.

## Current behaviour and known gaps

| Current mode | Current behaviour | Gap to address |
|---|---|---|
| Chain | Runs selected tests in order in one browser session, shares flat `runState`, repeats the full chain per dataset row, and stops on failure | Hand-offs and data scope are implicit; the UI does not preview the execution matrix |
| Suite | Runs every selected test independently for every dataset row and continues after failure | One shared dataset is applied indiscriminately to every test; member-specific data is unavailable |
| Batch | Runs Groups independently; every Group internally behaves like a Chain | Only the first row of each Group dataset is currently executed |
| Data resolution | Flat placeholders resolve from the data row before captured runtime state | A data key can silently override a captured output with the same name |
| Line items | `AddLineItem` can consume a JSON array encoded in a parameter or CSV cell | Nested data is not first-class, schema-validated, or clearly editable |
| Monitoring | Progress is primarily stage/step based | A long-running module cannot report child-record progress; refresh-safe run routes are absent |

## Design principles

1. **Business intent before runtime mechanism.** Ask whether the user is running a Test, Business Process, or Regression Pack before exposing session or failure details.
2. **Configuration and monitoring are separate experiences.** `/execute/new` configures and preflights; `/execute/runs/:runId` monitors and reviews.
3. **Nothing implicit at execution time.** Data scope, output mappings, iteration count, session reuse, and failure policy are visible before Start.
4. **One transaction record creates one outer iteration.** Child records remain inside that transaction and never create duplicate headers.
5. **Outputs are namespaced.** Stage outputs cannot collide with process data or another stage’s outputs.
6. **Safe defaults.** Sequential execution, fresh session per transaction iteration, fail-fast Business Processes, and continue-on-failure Regression Packs.
7. **Immutable execution snapshot.** Editing a source Test, Process, Pack, or Dataset after submission cannot change the submitted execution.
8. **Secrets are system context, not test data.** Credentials never enter datasets, execution-plan JSON, browser storage, evidence, or API responses.
9. **Progress reflects real work.** The monitor reports known transaction, stage, step, and child-item completion rather than simulated percentages.
10. **Compatibility without permanent duplication.** Existing commands translate into one orchestration model rather than retaining three divergent engines.

## Scenario catalogue

Every scenario below must be represented in automated contract or UI tests before the redesign is considered complete.

| ID | Scenario | Expected behaviour |
|---|---|---|
| SC-01 | Single Test without a dataset | One iteration uses only configured constants and system context |
| SC-02 | Single Test with one data record | One isolated iteration is created |
| SC-03 | Single Test with multiple data records | One iteration is created per selected record |
| SC-04 | Business Process with one transaction | All stages run in order; declared outputs are handed to later stages |
| SC-05 | One sales-order header with multiple line items | One order is created; the inner item loop adds every child item |
| SC-06 | Multiple sales orders with multiple line items | One complete process iteration runs per order; outputs reset between orders |
| SC-07 | Stage-specific input override | The override applies only to the selected stage and is visible in review/evidence |
| SC-08 | Process output hand-off | Delivery receives the Sales Order output; Billing receives the Delivery output |
| SC-09 | Missing required hand-off | Preflight blocks execution and links to the unmapped input |
| SC-10 | Duplicate data/output name | Namespaces prevent collision; ambiguous legacy placeholders are rejected or explicitly migrated |
| SC-11 | Regression Pack with independent Single Tests | Each member uses an isolated context and may bind a different dataset |
| SC-12 | Regression Pack containing Business Processes | Every process member keeps its own stages, iterations, hand-offs, and evidence |
| SC-13 | Failure inside a Business Process | Remaining stages in that iteration do not run |
| SC-14 | Failure in one Regression Pack member | The next independent member runs unless the execution is cancelled |
| SC-15 | Continue to next transaction after iteration failure | Available only when explicitly selected; outputs from the failed iteration do not leak |
| SC-16 | Stop all work after iteration failure | Default Business Process policy prevents later transaction iterations from starting |
| SC-17 | Nested JSON dataset | Header and child arrays are validated, previewed, snapshotted, and executed |
| SC-18 | Relational CSV dataset | Header and child files join by a declared key; duplicates and orphans are reported |
| SC-19 | Dataset filtering and maximum iteration limit | Preflight and review use the filtered count, not the source-file count |
| SC-20 | Browser/session reuse | The selected policy is shown in review and honoured without sharing transaction outputs |
| SC-21 | Cancellation | No new unit starts after cancellation; the active unit reaches a defined safe boundary |
| SC-22 | Refresh during execution | The stable run URL rehydrates status and progress from the server |
| SC-23 | Legacy Chain request | Compatibility translation produces an equivalent Business Process plan |
| SC-24 | Legacy Suite request | Compatibility translation produces an equivalent Regression Pack plan |
| SC-25 | Legacy Batch with multiple Group data rows | Every intended row executes; first-row-only behaviour is eliminated |
| SC-26 | Canonical evidence access | Execution Center and Audit and Evidence resolve the same archived evidence URL |

## Prioritisation and estimation

| Priority | Meaning |
|---|---|
| **P0** | Correctness, safety, data isolation, or architectural prerequisite |
| **P1** | Required for the first complete redesigned Execution Center |
| **P2** | Advanced recovery, operational insight, or optimisation |

Story points use the existing backlog scale: 3 small, 5 moderate, 8 cross-component, and 13 architectural/cross-package.

## Backlog summary

| ID | Story | Priority | Points | Wave | Depends on |
|---|---|---:|---:|---:|---|
| EXC-001 | Adopt clear execution terminology | P0 | 5 | 0 | Product approval |
| EXC-002 | Define a versioned Execution Plan contract | P0 | 13 | 0 | EXC-001 |
| EXC-003 | Execute all run types through one orchestrator | P0 | 13 | 0 | EXC-002 |
| EXC-004 | Translate legacy Chain, Suite, and Batch requests | P0 | 8 | 0 | EXC-002, EXC-003 |
| EXC-005 | Eliminate Batch first-row-only execution | P0 | 5 | 0 | EXC-003 or safe interim patch |
| EXC-006 | Declare Test inputs and outputs | P0 | 8 | 0 | EXC-002 |
| EXC-007 | Add namespaced data and output hand-offs | P0 | 13 | 0 | EXC-006 |
| EXC-008 | Bind and snapshot data at the correct scope | P0 | 8 | 0 | EXC-002, EXC-006 |
| EXC-009 | Support nested header-and-child datasets | P1 | 13 | 2 | EXC-008 |
| EXC-010 | Support relational header-and-child CSV datasets | P1 | 13 | 2 | EXC-008, EXC-009 |
| EXC-011 | Map, preview, and validate execution data | P1 | 13 | 2 | EXC-006–EXC-010 |
| EXC-012 | Execute one isolated outer iteration per transaction | P0 | 13 | 0 | EXC-003, EXC-007, EXC-008 |
| EXC-013 | Execute child collections with granular progress | P1 | 13 | 2 | EXC-009, EXC-012 |
| EXC-014 | Configure session, failure, filter, and iteration policies | P1 | 8 | 1 | EXC-012 |
| EXC-015 | Schedule independent Regression Pack members correctly | P1 | 13 | 1 | EXC-003, EXC-012, EXC-014 |
| EXC-016 | Cancel, retry, and resume without duplicating side effects | P2 | 13 | 3 | EXC-012, EXC-015 |
| EXC-017 | Provide a dedicated new-execution workspace | P1 | 8 | 1 | Stable application routing |
| EXC-018 | Build Tests, Processes, and Packs visually | P1 | 13 | 1 | EXC-001, EXC-002, EXC-006 |
| EXC-019 | Design data and iterations before execution | P1 | 13 | 2 | EXC-008–EXC-014 |
| EXC-020 | Run authoritative server-side preflight | P0 | 13 | 1 | EXC-002, EXC-006–EXC-008 |
| EXC-021 | Review the calculated execution matrix before Start | P1 | 8 | 1 | EXC-014, EXC-020 |
| EXC-022 | Monitor execution through a stable hierarchical run page | P1 | 13 | 2 | EXC-003, stable routing |
| EXC-023 | Diagnose failures and create traceable reruns | P2 | 13 | 3 | EXC-016, EXC-022 |
| EXC-024 | Preserve canonical evidence and execution lineage | P1 | 13 | 2 | EXC-002, EXC-012, EXC-022 |
| EXC-025 | Enforce authentication, target safety, and secret isolation | P0 | 8 | 0 | Authoritative SAP context |
| EXC-026 | Make configuration and monitoring accessible and responsive | P1 | 8 | 1–2 | EXC-017–EXC-022 |
| EXC-027 | Expose execution health and planning metrics | P2 | 8 | 3 | EXC-003, EXC-022 |
| EXC-028 | Protect behaviour with migration and execution regression tests | P0 | 13 | 0–3 | All delivered stories |

## Epic A — Execution language and orchestration

### EXC-001 — Adopt clear execution terminology

**User story:** As a functional tester, I want execution choices described in business terms so that I can select the correct behaviour without understanding CLI implementation details.

**Acceptance criteria:**

1. The primary choices are Single Test, Business Process, and Regression Pack.
2. Every choice shows session sharing, hand-off, failure, and data-iteration behaviour in concise language.
3. Chain, Suite, Batch, and Group appear only as compatibility or technical metadata where required.
4. Existing saved assets remain discoverable under their new user-facing labels.
5. Help content contains a comparison table and concrete examples.
6. Product copy is consistent across Execution Center, Process Suites, Help, history, and evidence.

**Scenarios:** SC-01, SC-04, SC-11, SC-12.

### EXC-002 — Define a versioned Execution Plan contract

**User story:** As an execution service, I want one immutable and versioned plan contract so that every run type can be validated, executed, monitored, and audited consistently.

**Acceptance criteria:**

1. `ExecutionPlan` has a schema version and supports Single Test, Business Process, and Regression Pack.
2. Members and stages have stable IDs independent of filenames and display names.
3. The plan records ordered scope, data bindings, input/output mappings, session policy, failure policy, evidence policy, and target-profile reference.
4. The plan never contains credential secrets.
5. Submitting a plan creates an immutable snapshot with a unique execution ID.
6. The result hierarchy is execution → pack member → iteration → stage → step → optional child work unit.
7. Invalid or unsupported schema versions produce a safe validation error.
8. JSON-schema or equivalent contract tests cover every supported plan kind.

**Scenarios:** SC-01–SC-04, SC-11, SC-12.

### EXC-003 — Execute all run types through one orchestrator

**User story:** As a product team, we want one orchestration engine so that looping, progress, history, failure, and evidence semantics do not diverge by mode.

**Acceptance criteria:**

1. One orchestrator consumes `ExecutionPlan` and emits a consistent event/result contract.
2. Single Tests, Business Processes, and Regression Packs do not duplicate run-history, evidence, credential, or browser-lifecycle code.
3. Orchestration state is persisted sufficiently for another API request to rehydrate run status.
4. The orchestrator emits actual start, progress, output, failure, cancellation, and completion events.
5. Process stages execute in declared order.
6. Pack members execute independently and continue according to pack policy.
7. Each execution unit closes or reuses browser resources according to the declared session policy.
8. Existing result and audit information is preserved or mapped without loss.

**Scenarios:** SC-01–SC-16, SC-22.

### EXC-004 — Translate legacy Chain, Suite, and Batch requests

**User story:** As an existing CLI or API user, I want current commands to retain their behaviour while the new execution model is introduced.

**Acceptance criteria:**

1. `run`/Chain translates to a Business Process plan.
2. Suite translates to a Regression Pack containing independent Single Tests.
3. Batch translates to a Regression Pack containing Business Processes built from Group definitions.
4. Translation produces an inspectable plan and emits a deprecation notice without exposing secrets.
5. Legacy and translated execution produce equivalent stage order, input values, failure policy, captured values, and evidence for supported scenarios.
6. No existing JSON Test or Group must be manually rewritten for the first migration release.
7. A documented removal decision is required before compatibility endpoints or commands are retired.

**Scenarios:** SC-23, SC-24, SC-25.

### EXC-005 — Eliminate Batch first-row-only execution

**User story:** As a test manager, I want every intended Group data record executed so that Batch does not silently omit business scenarios.

**Acceptance criteria:**

1. A Group with multiple data records no longer defaults silently to its first row.
2. The execution preview reports the number of Group records that will execute.
3. Each Group record receives its own iteration ID and isolated output scope.
4. The configured failure policy determines whether later records run after a failure.
5. History and evidence identify the source record for every attempted iteration.
6. A regression test fails if only the first of two configured records is executed.
7. If this is delivered before the unified orchestrator, the interim behaviour remains compatible with EXC-012.

**Scenarios:** SC-06, SC-15, SC-16, SC-25.

## Epic B — Test contracts, data, and hand-offs

### EXC-006 — Declare Test inputs and outputs

**User story:** As a process author, I want Tests to declare what they require and produce so that they can be composed and preflighted safely.

**Acceptance criteria:**

1. A Test may declare required and optional inputs with name, type, description, sensitivity, and example.
2. A Test may declare outputs with name, type, description, and producing step/module.
3. Supported initial types include string, number, boolean, date, object, and collection.
4. Existing Tests without declarations continue through a clearly marked legacy-inference path.
5. Composer identifies unresolved declared inputs before save and execution.
6. Output declarations are verified against capture modules or explicitly marked runtime-only.
7. Renaming or removing a declared input/output reports affected Business Processes.

**Scenarios:** SC-04, SC-08, SC-09.

### EXC-007 — Add namespaced data and output hand-offs

**User story:** As a process author, I want explicit namespaced mappings between stage outputs and later inputs so that data cannot collide or leak between stages or iterations.

**Acceptance criteria:**

1. Process input, stage input, system context, and stage output use distinct namespaces.
2. A mapping can reference process data or a prior stage output but not an undeclared future output.
3. Example supported references include `process.orderType` and `stages.createOrder.outputs.salesOrderNumber`.
4. The same unqualified key in process data and runtime output cannot resolve silently.
5. Every iteration begins with a fresh runtime-output scope.
6. Hand-offs appear visually on the process canvas and in review, results, and evidence.
7. Sensitive values are redacted according to contract metadata.
8. Legacy flat placeholders are translated when unambiguous and rejected with correction guidance when ambiguous.

**Scenarios:** SC-08, SC-09, SC-10.

### EXC-008 — Bind and snapshot data at the correct scope

**User story:** As an execution configurator, I want data attached to the Test, Process, Pack member, or Stage where it applies so that unrelated tests do not receive incorrect values.

**Acceptance criteria:**

1. A Single Test can bind one dataset and an optional record filter.
2. A Business Process can bind process-level data and stage-specific overrides.
3. Every Regression Pack member can bind its own dataset and policies.
4. Credentials and SAP target configuration cannot be selected as ordinary dataset fields.
5. The UI displays the source and effective value origin for each required input.
6. Submission stores an immutable data snapshot or content-addressed reference.
7. Later dataset edits do not change an in-progress or historical execution.
8. Input precedence is documented and enforced without ambiguous name resolution.

**Scenarios:** SC-02, SC-03, SC-07, SC-11, SC-12.

### EXC-009 — Support nested header-and-child datasets

**User story:** As a test-data author, I want one transaction record to contain a header and one or more child records so that I can create one business document with multiple line items.

**Acceptance criteria:**

1. JSON datasets can represent a transaction object containing nested child collections.
2. Header fields and child fields have an inspectable schema.
3. One transaction record creates one outer iteration regardless of child count.
4. Child order is deterministic and preserved.
5. Empty required child collections and invalid child shapes fail validation before execution.
6. The dataset editor can add, edit, remove, reorder, and preview child records.
7. Existing scalar CSV/JSON datasets continue to work.
8. Evidence identifies the transaction record and reports child counts without exposing disallowed sensitive values.

**Scenarios:** SC-05, SC-06, SC-17.

### EXC-010 — Support relational header-and-child CSV datasets

**User story:** As a business user preparing data in spreadsheets, I want header and item CSV files joined by a key so that I can represent one-to-many transactions without embedding JSON in a cell.

**Acceptance criteria:**

1. A relational dataset can declare a header file, child file, parent key, and child foreign key.
2. Preview groups child records under the correct parent record.
3. Duplicate parent keys, missing parent keys, orphan child rows, and blank required keys are reported.
4. Child row order is deterministic through a line-number field or source order.
5. Filtering parents automatically includes only their related children.
6. CSV parsing remains RFC4180 compliant.
7. The joined immutable snapshot is available to preflight, execution, evidence, and rerun.
8. Import guidance includes a downloadable example for orders and order items.

**Scenarios:** SC-05, SC-06, SC-18.

### EXC-011 — Map, preview, and validate execution data

**User story:** As an execution configurator, I want to see how source columns map to required inputs before I run so that data errors are corrected before SAP execution.

**Acceptance criteria:**

1. Required Test and Process inputs are shown beside their mapped source or hand-off.
2. Missing required fields, type mismatches, unused fields, duplicate mappings, and unresolved outputs are visible.
3. The user can preview at least the first records and child counts without exposing secrets.
4. Mapping changes update the calculated execution count immediately.
5. Errors link to the affected Test, Stage, Dataset, or mapping.
6. Mapping configuration is keyboard accessible and does not require drag-and-drop.
7. Preflight uses the same validated mapping contract as execution.
8. Saving an execution draft is outside scope unless separately approved.

**Scenarios:** SC-05–SC-10, SC-17–SC-19.

## Epic C — Iteration, child work, and failure policies

### EXC-012 — Execute one isolated outer iteration per transaction

**User story:** As a test manager, I want each transaction record to run as one isolated process iteration so that document numbers and failures never leak into another transaction.

**Acceptance criteria:**

1. Each selected transaction record creates exactly one outer iteration.
2. The complete Business Process runs inside that iteration before the next iteration starts.
3. Stage outputs are available only within the current iteration unless explicitly published as execution summary data.
4. Iteration identity includes an immutable internal ID and a safe business-data label where configured.
5. Session creation/reuse follows the selected policy while output scope always resets.
6. Results distinguish planned, started, completed, skipped, failed, and cancelled iterations.
7. Execution count and result count reconcile.
8. Default execution is sequential.

**Scenarios:** SC-03, SC-04, SC-06, SC-13, SC-15, SC-16.

### EXC-013 — Execute child collections with granular progress

**User story:** As a tester, I want modules processing line items to report child-level progress so that long document-entry steps do not appear stalled.

**Acceptance criteria:**

1. A module can declare and emit optional child-work totals and completion events.
2. `AddLineItem` reports the current and total item count.
3. Child work remains part of one stage step rather than creating additional business-document headers.
4. A child failure records the child index or safe key and stops or continues according to the module’s declared semantics.
5. Progress never exceeds 100% and reconciles on success, failure, and cancellation.
6. The monitor announces meaningful child progress without excessive live-region updates.
7. Evidence associates child screenshots/values with the owning transaction and stage.

**Scenarios:** SC-05, SC-06.

### EXC-014 — Configure session, failure, filter, and iteration policies

**User story:** As an execution configurator, I want safe and explicit iteration policies so that I understand how much will run and what happens after a failure.

**Acceptance criteria:**

1. The user can choose a fresh browser per iteration or an approved reusable-session policy.
2. Business Process defaults are sequential, fresh session, and stop the entire execution after an iteration failure.
3. The user may explicitly choose to continue with the next transaction after failure.
4. Regression Pack defaults to isolated members and continue after member failure.
5. A record filter and maximum iteration count can be configured and previewed.
6. Policies appear in preflight, review, run monitor, history, and evidence.
7. Unsafe combinations are blocked or require explicit acknowledgement.
8. Parallel execution is labelled as future scope and is not simulated in the UI.

**Scenarios:** SC-14–SC-16, SC-19, SC-20.

### EXC-015 — Schedule independent Regression Pack members correctly

**User story:** As a test manager, I want independent Tests and Business Processes grouped into one Regression Pack so that I can run broad coverage without sharing state accidentally.

**Acceptance criteria:**

1. A Pack can contain Single Tests and Business Processes.
2. Every member has its own data binding, iteration count, session policy, and result.
3. No runtime output is shared between members.
4. A member failure does not stop later members by default.
5. Initial scheduling is sequential and deterministic.
6. Review displays total members, total iterations, total stages, and known child-work counts.
7. Cancelling the Pack prevents later members from starting.
8. History and evidence retain Pack → member → iteration hierarchy.

**Scenarios:** SC-11, SC-12, SC-14.

### EXC-016 — Cancel, retry, and resume without duplicating side effects

**User story:** As an automation engineer, I want safe recovery controls so that interrupted execution does not create duplicate SAP documents unknowingly.

**Acceptance criteria:**

1. Cancellation is persisted and prevents new iterations, stages, or members from starting.
2. The active step reaches a documented safe boundary; forced termination is distinguished from graceful cancellation.
3. Retry creates a new execution or child attempt with parent lineage.
4. The UI never presents “Resume” when it cannot prove which side-effectful steps completed.
5. A rerun can use full scope or eligible failed scope and shows the resulting execution matrix.
6. Original input, mappings, target profile, policies, and evidence remain immutable.
7. Idempotency keys prevent duplicate Start requests.
8. Recovery tests cover cancellation before start, during a stage, between iterations, and between Pack members.

**Scenarios:** SC-13–SC-16, SC-21.

## Epic D — Configuration, preflight, monitoring, and diagnosis

### EXC-017 — Provide a dedicated new-execution workspace

**User story:** As a tester, I want a focused workspace for preparing a run so that configuration is not mixed with live monitoring and historical results.

**Acceptance criteria:**

1. `/execute/new` is the stable route for new execution configuration.
2. The first decision is Single Test, Business Process, or Regression Pack.
3. The workspace presents Scope, Data and Iterations, Preflight, and Review as clear steps.
4. Changing an earlier step revalidates affected later steps.
5. Unsaved configuration is protected during navigation and refresh.
6. Existing source artifacts are not modified by configuring a run.
7. Layout works at supported laptop widths, 320 CSS px, and 200% zoom.
8. Page title, heading, landmarks, focus management, and browser Back/Forward are correct.

**Scenarios:** SC-01, SC-04, SC-11.

### EXC-018 — Build Tests, Processes, and Packs visually

**User story:** As a process author, I want a visual representation of execution scope so that sequence, independence, and hand-offs are obvious.

**Acceptance criteria:**

1. Single Test shows one executable card and its input/output contract.
2. Business Process shows ordered stage cards connected by directional hand-offs.
3. Regression Pack shows independent member lanes without implying shared state.
4. Cards show name, application, readiness, dataset binding, iteration count, and policy summary.
5. Reordering has named keyboard controls; drag-and-drop is optional.
6. Invalid future-stage references and circular dependencies are blocked.
7. Selecting a hand-off reveals source output, destination input, type compatibility, and fallback.
8. Technical filenames and legacy modes remain secondary metadata.

**Scenarios:** SC-04, SC-08–SC-12.

### EXC-019 — Design data and iterations before execution

**User story:** As a test-data author, I want a dedicated data-and-iterations view so that transaction and child loops are understandable before execution.

**Acceptance criteria:**

1. The view identifies process-level, stage-level, and Pack-member bindings separately.
2. Transaction records appear as outer iterations with safe labels.
3. Nested or joined child records appear under their owning transaction.
4. The UI distinguishes “2 sales orders” from “5 total line items.”
5. Record selection, filter, maximum count, session policy, and failure policy update the preview.
6. The user can inspect effective mappings for a selected iteration.
7. Validation distinguishes errors, blocking safety conditions, and acknowledgable warnings.
8. Large datasets use bounded preview/pagination and remain keyboard accessible.

**Scenarios:** SC-03, SC-05–SC-07, SC-17–SC-20.

### EXC-020 — Run authoritative server-side preflight

**User story:** As an automation engineer, I want the server to validate execution readiness so that the browser UI cannot incorrectly declare a run safe.

**Acceptance criteria:**

1. Preflight validates authenticated identity, SAP target context, credential availability, and target verification state.
2. It validates plan schema, referenced artifacts, Test contracts, required objects, data mappings, types, output dependencies, and policies.
3. It calculates members, iterations, stages, steps, and known child-work units from the submitted snapshot.
4. Blocking findings prevent Start and link to the affected configuration area.
5. Warnings explain impact and require explicit acknowledgement where appropriate.
6. Every result includes a code, severity, safe message, affected reference, and correction target.
7. Preflight expires when target context or relevant configuration changes.
8. Start verifies the preflight token/hash to prevent time-of-check/time-of-use drift.
9. No credential secret or raw sensitive backend response is returned.

**Scenarios:** SC-09, SC-10, SC-18, SC-19.

### EXC-021 — Review the calculated execution matrix before Start

**User story:** As a tester, I want a concise impact review so that I know exactly what will execute and what SAP documents may be created.

**Acceptance criteria:**

1. Review shows execution type, target, source assets, selected records, session policy, failure policy, evidence policy, and executor.
2. It shows total Pack members, transaction iterations, stages, steps, and known child records.
3. Business-impact estimates include expected document types/counts when declared by Test outputs.
4. Example wording distinguishes “2 sales orders” from “5 sales-order line items.”
5. Data and hand-off summaries expose no credential or disallowed sensitive values.
6. Blocking preflight results disable Start.
7. Risk warnings require deliberate acknowledgement.
8. Start is idempotent and returns one execution ID before navigation to the monitor.

**Scenarios:** SC-05, SC-06, SC-11, SC-12, SC-19, SC-20.

### EXC-022 — Monitor execution through a stable hierarchical run page

**User story:** As a tester, I want a refresh-safe monitor organised by actual execution hierarchy so that I can supervise long and data-driven runs confidently.

**Acceptance criteria:**

1. `/execute/runs/:runId` rehydrates from persisted server state.
2. Summary shows execution status, monitor connectivity, target, executor, elapsed time, last update, and overall progress.
3. Detail follows execution → member → iteration → stage → step → child work.
4. The current member, iteration, stage, step, and child position are visible where known.
5. Progress is calculated from actual known work and becomes indeterminate only when totals genuinely cannot be known.
6. Monitor connectivity is distinct from execution status.
7. Completion provides actions for results, canonical evidence, and eligible rerun.
8. Meaningful progress is announced accessibly without repeating every polling response.
9. Refresh, temporary disconnect, and browser reopening do not start a duplicate execution.

**Scenarios:** SC-05, SC-06, SC-12, SC-21, SC-22.

### EXC-023 — Diagnose failures and create traceable reruns

**User story:** As an automation engineer, I want failures linked to the exact iteration, stage, input, output, and evidence so that I can correct and verify the problem efficiently.

**Acceptance criteria:**

1. Failed execution opens with the first root failure selected.
2. Failure identifies Pack member, iteration, transaction label, stage, step, child index/key, category, duration, and safe error.
3. Relevant mapped inputs, prior outputs, expected/actual values, screenshot, and log context appear together when available.
4. Links open the implicated Test, Process mapping, Object, or Dataset without losing the run return path.
5. Rerun can select full scope or eligible failed scope.
6. Review highlights deliberate differences from the parent execution.
7. New execution records parent ID, rerun reason, scope, and initiating identity.
8. The original run and evidence are never overwritten.

**Scenarios:** SC-09, SC-13–SC-16, SC-21.

## Epic E — Evidence, security, accessibility, and quality

### EXC-024 — Preserve canonical evidence and execution lineage

**User story:** As an auditor, I want evidence to mirror the execution hierarchy and remain canonical so that I can trace every transaction without contradictory documents.

**Acceptance criteria:**

1. Execution Center and Audit and Evidence reference the same canonical archived artifact for a given evidence unit.
2. Evidence records execution ID, optional Pack/member ID, iteration ID, stage, target label, executor, timestamps/time zone, status, and source snapshot hash.
3. Inputs and outputs are attributed to their scope and redacted according to contract metadata.
4. Multiple transaction iterations are clearly separated.
5. Missing or partial evidence explains whether the unit failed before capture, was cancelled, or was not attempted.
6. Reruns link to parent evidence without altering it.
7. Evidence-generation failure does not silently convert an execution failure to success or create a second conflicting document.
8. Canonical URLs reject traversal and absolute-path injection.

**Scenarios:** SC-06, SC-12, SC-13, SC-21, SC-26.

### EXC-025 — Enforce authentication, target safety, and secret isolation

**User story:** As the workspace owner, I want execution protected by authenticated identity and verified target context so that tests cannot run with leaked secrets or against an unintended system.

**Acceptance criteria:**

1. Every preflight, Start, cancel, retry, result, and evidence API enforces server-side authentication.
2. The plan stores only a credential-profile reference; the server injects secrets at execution.
3. Passwords/tokens never appear in frontend state, plan JSON, run events, history, logs, screenshots, or evidence.
4. Target URL metadata is reduced to the approved safe label/hostname where displayed.
5. Unavailable, changed, stale, or mismatched target context invalidates preflight and blocks Start.
6. Production-like targets receive stronger warning and acknowledgement treatment.
7. Execution records the authenticated initiating identity.
8. Security regression tests inspect API responses, persisted plan snapshots, reports, and logs for secret leakage.

**Scenarios:** All execution scenarios.

### EXC-026 — Make configuration and monitoring accessible and responsive

**User story:** As a keyboard or assistive-technology user, I want to configure and monitor every execution type without losing context or functionality.

**Acceptance criteria:**

1. All configuration journeys complete keyboard-only.
2. Process and Pack builders provide non-drag move, add, remove, and map operations.
3. Errors are associated with fields/cards and summarized with focusable correction links.
4. Dialogs and drawers manage focus entry, containment, Escape, and return.
5. Progress uses appropriate `progressbar`, busy, status, and live-region semantics.
6. Hierarchical results expose an understandable heading/list/tree structure.
7. Views reflow at 320 CSS px and 200% zoom without losing actions.
8. Light, dark, reduced-motion, and Windows high-contrast states are supported.
9. Axe reports no serious/critical issues on stable configuration, preflight, monitor, and failure states.
10. NVDA/Chromium manual results and any exceptions are documented.

**Scenarios:** All UI scenarios.

### EXC-027 — Expose execution health and planning metrics

**User story:** As a product owner or operator, I want safe operational metrics so that we can improve reliability and forecast execution effort.

**Acceptance criteria:**

1. Metrics include preflight failure count/category, queue/start latency, execution duration, iteration throughput, failure category, cancellation, and evidence-generation health.
2. Metrics distinguish Test, Business Process, Regression Pack, member, and iteration scope.
3. No metric label or payload includes credentials or unapproved business data.
4. Review may show an estimated duration range only when based on documented historical data.
5. Actual and estimated values are labelled distinctly.
6. Metric collection failure cannot block execution.
7. Dashboard use is deferred until taxonomy and retention policy are approved.

**Scenarios:** SC-03, SC-06, SC-11, SC-12.

### EXC-028 — Protect behaviour with migration and execution regression tests

**User story:** As a delivery team, we want isolated and live-approved tests covering execution semantics so that redesign does not change SAP outcomes silently.

**Acceptance criteria:**

1. Isolated contract tests cover every Scenario Catalogue entry that does not require SAP.
2. Orchestrator tests use deterministic fake adapters and verify session, iteration, stage, output, failure, and cancellation boundaries.
3. Data tests cover scalar JSON, scalar CSV, nested JSON, relational CSV, filters, limits, duplicates, orphans, and malformed child collections.
4. Compatibility tests compare legacy and translated plans/results for Chain, Suite, and Batch.
5. UI tests cover configuration, mapping, preflight, review, refresh-safe monitor, cancellation, failure, and rerun.
6. Tests verify one header/many items and many headers/many items separately.
7. Execution-disabled fixtures cannot launch SAP or mutate repository evidence/data.
8. Live SAP tests require an explicit environment flag, approved data, and cleanup/reconciliation guidance.
9. Build, typecheck, lint, accessibility automation, and isolated regression pass before release.
10. Failed tests cannot leave credentials, temporary databases, reports, or evidence in version control.

**Scenarios:** SC-01–SC-26.

## Execution examples used for refinement

### Example A — One sales order with multiple items

```json
{
  "scenarioKey": "SO-001",
  "header": {
    "orderType": "OR",
    "salesOrg": "1710",
    "distributionChannel": "10",
    "division": "00",
    "soldToParty": "CUSTOMER-001"
  },
  "items": [
    { "lineNumber": 10, "product": "PRODUCT-A", "quantity": 10 },
    { "lineNumber": 20, "product": "PRODUCT-B", "quantity": 5 }
  ]
}
```

Expected calculation:

```text
1 transaction iteration
1 sales-order header
2 sales-order line items
1 Create Sales Order stage
1 Sales Order output
```

### Example B — Multiple sales orders with multiple items

```json
[
  {
    "scenarioKey": "SO-001",
    "header": { "soldToParty": "CUSTOMER-001" },
    "items": [
      { "lineNumber": 10, "product": "PRODUCT-A", "quantity": 10 },
      { "lineNumber": 20, "product": "PRODUCT-B", "quantity": 5 }
    ]
  },
  {
    "scenarioKey": "SO-002",
    "header": { "soldToParty": "CUSTOMER-002" },
    "items": [
      { "lineNumber": 10, "product": "PRODUCT-C", "quantity": 3 },
      { "lineNumber": 20, "product": "PRODUCT-D", "quantity": 1 },
      { "lineNumber": 30, "product": "PRODUCT-E", "quantity": 8 }
    ]
  }
]
```

For an O2C Business Process containing Create Sales Order → Delivery → Billing, expected calculation:

```text
2 transaction iterations
5 total sales-order line items
3 stages per iteration
6 total stage executions
2 expected Sales Order outputs
2 expected Delivery outputs
2 expected Billing outputs
```

Default order:

```text
Iteration SO-001
  Create Sales Order with 2 items
  → Create Delivery using SO-001 output
  → Create Billing using Delivery output

Iteration SO-002
  Create Sales Order with 3 items
  → Create Delivery using SO-002 output
  → Create Billing using Delivery output
```

The alternative “create all orders, then all deliveries, then all billings” is a different phase-oriented process topology and must not be inferred from the same dataset. It requires an explicitly designed future plan type or process graph.

## Release slices

### Wave 0 — Correct and unify

- EXC-001 through EXC-008.
- EXC-012.
- EXC-020 server contract.
- EXC-025.
- EXC-028 coverage for delivered behaviour.

**Exit outcome:** Existing execution behaviour runs through a safe, versioned plan; Batch no longer omits data rows; inputs and outputs cannot collide silently.

### Wave 1 — Configure and preflight

- EXC-014, EXC-015.
- EXC-017, EXC-018.
- EXC-020 UI and correction links.
- EXC-021.
- EXC-026 coverage for configuration.

**Exit outcome:** Users configure Single Tests, Business Processes, and Regression Packs through a clear workspace and review an authoritative execution matrix.

### Wave 2 — Nested data, monitoring, and evidence

- EXC-009 through EXC-011.
- EXC-013.
- EXC-019.
- EXC-022.
- EXC-024.
- EXC-026 coverage for monitor/results.

**Exit outcome:** Header/child data, multiple transactions, granular progress, stable monitoring, and canonical evidence work end-to-end.

### Wave 3 — Recovery and operational maturity

- EXC-016.
- EXC-023.
- EXC-027.
- Remaining EXC-028 live-approved regression.

**Exit outcome:** Interrupted or failed executions can be diagnosed and rerun with traceable lineage and safe operational insight.

## Definition of Ready

A story is ready when:

1. Its affected plan/schema version and backward-compatibility impact are known.
2. Required API, persistence, engine, UI, history, and evidence changes are identified.
3. Safe synthetic datasets cover relevant Scenario Catalogue entries.
4. Any live SAP validation has an approved target, identity, data, and cleanup plan.
5. Accessibility behaviour and responsive states are specified.
6. Security review identifies secrets, sensitive business values, target metadata, and logging boundaries.
7. Acceptance criteria can be exercised without relying on undocumented manual state.

## Definition of Done

A story is done when:

1. All acceptance criteria pass.
2. Plan, API, persistence, UI, and evidence contracts are typed and documented.
3. Existing compatibility behaviour is retained or intentionally migrated with tests.
4. Build, typecheck, lint, isolated regression, and applicable accessibility checks pass.
5. No test launches live SAP without explicit approval.
6. No credentials, customer identifiers, business documents, reports, evidence, or temporary databases are committed.
7. Errors are safe, actionable, persistent where necessary, and do not expose raw secrets.
8. Execution, history, and evidence counts reconcile for success, failure, cancellation, and skipped work.
9. Product documentation and terminology are updated in the same change.

## Product decisions required during refinement

1. Confirm Single Test, Business Process, and Regression Pack as the user-facing language.
2. Confirm the safe Business Process default: stop the whole execution after a failed transaction iteration.
3. Confirm whether fresh browser per iteration is the default even when a reusable session would be faster.
4. Confirm nested JSON and relational two-file CSV as the supported one-to-many formats.
5. Define which business outputs may appear unredacted in review, history, and evidence.
6. Decide whether canonical evidence is one document per transaction iteration or one execution document with clearly separated iteration sections.
7. Define the retention policy for immutable plan/data snapshots and execution events.
8. Confirm that parallel execution, scheduling, multi-user roles, and non-SAP connectors remain outside the first redesign release.
