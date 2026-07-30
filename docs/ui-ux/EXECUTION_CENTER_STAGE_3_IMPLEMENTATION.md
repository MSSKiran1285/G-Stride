# Execution Center Redesign — Stage 3 Implementation

**Date:** 28 July 2026  
**Status:** Implemented; ready for product review  
**Scope:** Configuration workspace, authoritative preflight, impact review, and protected Start

## Outcome

Execution Center now separates preparation from execution. The user chooses a
Single Test, Business Process, or Regression Pack; selects data and policies;
runs a server-side preflight; reviews the calculated execution matrix and safe
findings; acknowledges the target warning; and only then starts the run.

No SAP browser or network session is opened during preflight.

## Delivered

### New-execution workspace

- Stable `/execute/new` route with browser refresh and Back/Forward support.
- Stable `/execute/runs/:runId` route for an execution started from the
  workspace.
- Primary product language is Single Test, Business Process, and Regression
  Pack. Chain, Suite, and Batch remain compatibility values only.
- Preparation steps are shown as Scope, Data and policies, Preflight, and
  Review.
- Single Test selection is limited to one Test.
- Business Process uses an explicitly ordered Test sequence.
- Regression Pack can use independent Tests or saved Business Processes.
- Leaving or refreshing a configured execution is protected.

### Policies

- Fresh browser per transaction or reuse within a process.
- Stop after iteration failure or continue to the next transaction.
- Optional maximum transaction-record count.
- Sequential execution remains explicit and mandatory.
- Canonical evidence remains mandatory.
- The selected policies are carried through the server, CLI translators, and
  unified orchestrator rather than being display-only settings.

### Authoritative server preflight

- Validates the versioned Execution Plan.
- Validates referenced Tests, Business Processes, modules, and Object
  Repository references.
- Validates target credential availability without returning secrets.
- Validates selected datasets and required mapped input paths.
- Rejects empty datasets and required inputs without a source.
- Calculates members, transaction iterations, stages, steps, and known child
  records.
- Returns structured findings with code, severity, area, reference, and
  correction target.
- Produces a SHA-256 plan hash and an expiring, five-minute preflight token.

### Review and protected Start

- Review shows target hostname, sources, App ID, dataset, browser mode,
  policies, record limit, and canonical evidence policy.
- Review displays the calculated execution matrix.
- Blocking findings disable Start.
- The saved-target warning requires deliberate acknowledgement.
- Start rejects expired tokens, configuration drift, plan-hash mismatch, and
  missing warning acknowledgement.
- Repeated Start with the same approved token resolves to the existing run
  instead of launching a duplicate.

## Backlog coverage

| Story | Stage 3 status |
|---|---|
| EXC-014 | Session, iteration-failure, and maximum-record policies implemented |
| EXC-015 | Test-only and Business-Process-only Regression Packs supported; mixed members remain a later refinement |
| EXC-017 | New-execution route, staged workspace, navigation protection, and responsive layout implemented |
| EXC-018 | Business execution types and ordered/independent scope are represented; detailed contract/hand-off cards remain |
| EXC-020 | Server preflight contract, findings, expiry, hash, and Start verification implemented |
| EXC-021 | Calculated impact review and warning acknowledgement implemented |
| EXC-025 | Authentication boundary retained; credentials remain server-injected and absent from plan/preflight responses |
| EXC-026 | Keyboard-native controls, semantic progress steps, responsive review, and focus-managed dialog implemented |
| EXC-028 | Preflight contract and updated isolated UI coverage implemented |

## Deliberate follow-on work

- A Regression Pack cannot yet mix Single Tests and Business Processes in the
  same launch request.
- Detailed input/output contract cards and editable hand-off mapping are not
  yet exposed in this workspace.
- Record filters are not yet available; maximum-record selection is available.
- Preflight findings identify their correction area but do not yet deep-link to
  a particular Compose/Object/Data editor field.
- Nested JSON and relational CSV modelling, child-level progress, and the
  hierarchical persisted monitor remain the next data/monitoring stage.
- Live SAP execution remains gated by explicit opt-in tests.

## Verification

- Full TypeScript and web production build: passed.
- Execution Plan, orchestrator, preflight, and progress tests: 17 passed.
- Isolated Studio UI suite: 12 passed; 3 execution/live tests skipped by safety
  flags.
- UI coverage includes direct `/execute/new` refresh, approved execution
  language, type switching, filtering, blocking preflight, review, and cancel.
- `git diff --check`: passed.
