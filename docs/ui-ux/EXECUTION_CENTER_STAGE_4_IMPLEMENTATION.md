# Execution Center — Stage 4 implementation

## Outcome

Stage 4 adds transaction-aware data execution and a refresh-safe hierarchical
monitor to the Stage 3 preflight/start flow.

## Delivered

- Nested JSON datasets preserve a header and its owned child collections as one
  transaction.
- Relational CSV datasets join a header file and child file using explicit
  header/foreign keys and a named child collection.
- Duplicate headers, orphan children, missing join values, and collection-name
  collisions are rejected before execution.
- The Execution Center can select either a single CSV/nested JSON source or a
  header-and-child relational CSV source.
- Preflight calculates transaction, stage, step, and known child-work counts.
- Every approved preflight creates an immutable plan-and-data snapshot. The
  snapshot is passed to the CLI and saved as `execution-snapshot.json` in the
  Studio run folder.
- Test-asset hashes are checked by the runtime so an asset changed after
  preflight cannot run under the earlier approval.
- `AddLineItem` emits bounded per-child progress and identifies the exact child
  row/key that failed.
- Single Test, Business Process, Regression Pack, and Batch orchestration expose
  the same progress structure.
- Studio persists `run-state.json`; a bookmarked `/execute/runs/:id` route can
  reconstruct a prior run after a server restart.
- The run monitor shows Process → Transaction hierarchy with status and
  canonical evidence links.
- Evidence metadata includes execution, plan, snapshot, member, and iteration
  lineage when a run was started from an approved snapshot.

Credentials remain runtime-only system context. They are not written into the
plan, data snapshot, progress file, or evidence lineage.

## Verification

- Production TypeScript and Vite build: passed.
- Focused execution contract/data/orchestration/preflight tests: 24 passed.
- Non-destructive Execution Center browser tests: 3 passed.
- Execution-enabled and live SAP browser tests remain deliberately opt-in and
  were not run because they can create or change SAP business documents.

## Runtime

The validated Stage 4 build is available locally at:

`http://127.0.0.1:4510/execute/new`

