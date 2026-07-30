# Execution Center Stage 1 — Contracts and Safety Foundation

**Status:** Ready for product review  
**Date:** 28 July 2026  
**Runtime impact:** None; existing Chain, Suite, and Batch paths are unchanged

## Outcome

Stage 1 establishes the shared contract and safety boundary required before the new orchestrator or Execution Center UI is implemented.

Delivered:

- Approved terminology represented as typed execution kinds:
  - Single Test
  - Business Process
  - Regression Pack
- Versioned `ExecutionPlan` and immutable `ExecutionPlanSnapshot` contracts.
- Optional typed Test input/output contracts without breaking existing Test JSON.
- Explicit input bindings for literal, process data, prior-stage output, and server-injected system context.
- Validation that a Business Process may reference only declared outputs from earlier stages.
- Type compatibility checks for output-to-input hand-offs.
- Isolated data-binding namespaces for Regression Pack members.
- Deterministic SHA-256 plan, data, and combined snapshot hashes.
- Deep-cloned and frozen submission snapshots.
- Credential-value rejection from plans and data snapshots.
- Safe relative-file validation for Test and Dataset references.
- Synthetic example plans and transaction data.
- Isolated contract regression tests.

## Story progress

| Story | Stage 1 status | Remaining work |
|---|---|---|
| EXC-001 | Contract foundation complete | Apply approved language to the redesigned UI and compatibility help |
| EXC-002 | Contract complete for review | Persist snapshots and events when the orchestrator is introduced |
| EXC-006 | Contract schema complete | Add declared contracts to production Tests and expose authoring support |
| EXC-007 | Static validation complete | Resolve namespaced values in the new orchestrator |
| EXC-008 | Immutable snapshot contract complete | Persist snapshots and implement source-file loading through preflight |
| EXC-025 | Plan/data secret boundary complete | Add authoritative target verification to preflight and execution |
| EXC-028 | Initial contract tests complete | Expand with orchestrator, UI, accessibility, migration, and live-approved tests |

No story whose acceptance criteria include orchestration, persistence, UI, or live SAP behaviour is marked fully done yet.

## Review artefacts

| Artefact | Review focus |
|---|---|
| `execution-plan-examples/single-test.plan.json` | One Test and one dataset binding repeated per transaction record |
| `execution-plan-examples/business-process.plan.json` | Ordered O2C stages and explicit Sales Order → Delivery → Billing hand-offs |
| `execution-plan-examples/regression-pack.plan.json` | Independent members, isolated data namespace, and continue-on-member-failure policy |
| `execution-plan-examples/sales-orders.sample.json` | Two order headers with two and three line items respectively |
| `execution-plan-examples/README.md` | Binding language and safe default policies |

## Contract decisions represented in the examples

1. A plan references the logical credential profile `default`; it never stores URL, username, password, or token values.
2. Every referenced Test is snapshotted by stable asset ID and content hash.
3. Tests without a declared contract remain supported through `legacy-inferred` mode.
4. Declared required inputs must have bindings.
5. A captured output can be consumed only by a later stage.
6. Contract types must match across a hand-off.
7. Every transaction iteration uses a fresh browser and stops the execution after failure by default.
8. Regression Pack members remain independent and continue to the next member by default.
9. Pack data snapshot IDs are qualified as `<memberId>:<bindingId>` to prevent collisions.
10. Canonical evidence is mandatory in every Stage 1 plan.

## Validation

```text
npm run build --workspace=@taf/core
node --test regression/execution-plan-contract.test.js
npm run build
npm run test:ui:isolated
```

Results at delivery:

```text
Execution Plan contract: 6 passed, 0 failed
Repository build: passed
Isolated UI: 12 passed, 3 intentionally skipped, 0 failed
```

The broad `npm run test:regression` command is not an isolated runner. It currently reports unrelated baseline failures because API tests expect fixture names that are not in the repository (`suppliers.csv` and `cleanup-drafts.json`) and UI tests target a shared server. Those UI tests pass under `npm run test:ui:isolated`. Stage 1 does not change or conceal that existing harness limitation.

## Review boundary

Stage 1 intentionally does not:

- Execute an `ExecutionPlan`.
- Change current Chain, Suite, or Batch behaviour.
- Fix Batch first-row-only execution.
- Persist plan snapshots in the run ledger.
- Add new APIs or routes.
- Change the current Execution Center UI.
- Launch SAP or use live credentials.

Those changes begin only after the example contracts and default policies are approved.
