# Execution Center — Stage 5 implementation

## Scope

Stage 5 implements Wave 3 of the approved Execution Center backlog:

- EXC-016 — safe cancellation and recovery
- EXC-023 — failure diagnosis and traceable reruns
- EXC-027 — execution health and planning metrics
- EXC-028 — recovery regression coverage

## Delivered

### Safe cancellation

- A running execution can be changed to `cancelling`.
- The cancellation request is persisted in the run directory.
- The orchestrator checks cancellation between transaction iterations and
  Regression Pack members.
- The active transaction is allowed to finish; no later transaction or member
  starts.
- The terminal state is `cancelled`, distinct from `failed`.
- Refreshing or reopening the run page retains the cancellation state and
  requested timestamp.

This is deliberately a graceful transaction-boundary cancellation. It is not a
force-kill control and does not claim that an individual SAP action can be
rolled back.

### Traceable reruns

- Completed, failed, and cancelled runs expose a rerun workspace.
- A reason is required.
- The user can choose the full original scope or failed/unattempted scope.
- Failed-scope reruns create a new snapshot containing only eligible
  transactions or Pack members.
- The original run, snapshot, results, and evidence remain immutable.
- The new run stores its parent run ID, reason, scope, and request key.
- Repeated requests with the same key return the already-created rerun.

### Failure diagnosis

- The server derives a safe root-failure record from persisted results,
  hierarchy, child progress, and logs.
- The diagnosis identifies member, transaction, stage, step, child key/index,
  failure category, safe message, and screenshot when available.
- Execution Center presents this information together above the diagnostic log.

### Operational metrics

The authenticated metrics endpoint and the collapsed Execution Center health
panel expose:

- execution totals and status counts;
- average execution duration and start latency;
- completed transaction iterations and throughput;
- evidence expected versus available;
- failure-category counts;
- blocked preflight count and blocking-finding taxonomy.

Metrics contain no credential values or transaction data.

## API additions

- `POST /api/runs/:id/cancel`
- `POST /api/runs/:id/rerun`
- `GET /api/execution-metrics`

## Verification

- Production TypeScript and Vite build passes.
- Cooperative-cancellation regression verifies that the active transaction
  completes and later iterations do not start.
- Rerun regression verifies full-scope and failed-scope immutable snapshots.
- The existing data, child-progress, preflight, contract, orchestration, and
  non-destructive browser suites remain part of the Stage 5 release check.
- Live SAP execution remains explicitly opt-in.

