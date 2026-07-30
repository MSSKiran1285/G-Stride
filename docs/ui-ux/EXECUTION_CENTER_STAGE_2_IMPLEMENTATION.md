# Execution Center Redesign — Stage 2 Implementation

**Date:** 28 July 2026  
**Status:** Implemented; ready for review  
**Scope:** Unified orchestration and legacy compatibility

## Outcome

Chain, Suite, and Batch now translate into the versioned Execution Plan from
Stage 1 and execute through one orchestration engine:

| Existing entry point | Execution Plan translation |
|---|---|
| Chain / `taf run` | Business Process |
| Suite / `taf suite` | Regression Pack of Single Tests |
| Batch / `taf batch` | Regression Pack of Business Processes |

This removes the three independent execution loops while retaining the current
CLI and Studio request contracts during migration.

## Delivered backlog stories

### EXC-003 — One orchestrator

- Executes Single Tests, Business Processes, and Regression Packs.
- Uses explicit process-data, system-context, literal, and stage-output
  bindings.
- Shares a browser only inside the selected process/iteration policy.
- Creates isolated runtime state for every transaction iteration.
- Stops subsequent Business Process stages on failure.
- Supports stop/continue policies between iterations and pack members.
- Emits execution, member, iteration, stage, and step lifecycle events.

### EXC-004 — Legacy compatibility

- Infers compatibility contracts from existing `${placeholder}` references and
  capture-module conventions.
- Maps SAP URL, username, password, and runtime date to protected system
  context.
- Maps a prior stage's captured output to the later stage input explicitly.
- Preserves current command names, command arguments, reports, history records,
  and canonical evidence locations.

### EXC-005 — Batch first-row defect

- Every row in a Group data file now creates a separate process iteration.
- Each iteration starts with isolated session and output state.
- Each iteration creates its own immutable history and evidence reference.
- Studio calculates the Batch work total from Group dataset row counts.
- Batch progress remains determinate for a single Group and now reflects its
  transaction iterations.

### EXC-007 / EXC-012 — Namespaced hand-offs and isolated iterations

- Stage outputs are stored under their producing stage ID.
- Later stages can only consume declared outputs from earlier stages.
- Outputs do not leak between transaction iterations or Regression Pack
  members.

## Runtime defaults

- Business Process: fresh session per transaction; stop after a failed
  iteration.
- Legacy Chain compatibility: continue to later data rows after one iteration
  fails, matching the existing command.
- Regression Pack: isolate members; continue to the next member after failure.
- Legacy Suite: fresh session for every test/data-record combination.
- Legacy Batch: fresh session for every Group data record.
- Evidence: one canonical PDF per executed transaction iteration.

## Compatibility limitations retained for later stages

- The existing screen still presents Chain, Suite, and Batch. The redesigned
  Single Test / Business Process / Regression Pack workspace is a later UI
  stage.
- Legacy contract inference treats untyped placeholders and captures as
  strings. Authored typed contracts take precedence.
- The compatibility runtime accepts one file dataset per executable.
- Nested JSON and relational CSV data modelling are scheduled for the data and
  looping stage.
- Cancellation, retry/resume, and stable refresh-safe run URLs remain later
  backlog items.
- Live SAP execution is deliberately excluded from automated verification
  unless the execution opt-in flags are enabled.

## Verification

- Full TypeScript and web production build: passed.
- Execution Plan/orchestrator/progress tests: 13 passed.
- Isolated Studio UI suite: 12 passed, 3 live/execution tests skipped by
  safety flags.
- Current repository Test and Group assets translate with zero plan validation
  errors.
- Synthetic Batch verification executes three records rather than one.

## Review checkpoint

Before the next stage, review:

1. Whether each Group data row should produce a separate evidence PDF (current
   implementation) or a parent PDF with one section per iteration.
2. Whether legacy Suite result ordering may move from its historical
   data-first order to the new member-first Regression Pack order.
3. Whether a failed Business Process should stop later transaction iterations
   by default (current approved decision) or expose continue as the initial UI
   default.
