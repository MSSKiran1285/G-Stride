# Execution Plan examples

These Stage 1 examples make the proposed Execution Center terminology and contract reviewable before orchestration or UI behaviour changes.

| Example | Demonstrates |
|---|---|
| `single-test.plan.json` | One independently executable Test repeated for each selected transaction record |
| `business-process.plan.json` | Create Sales Order → Delivery → Billing with declared, namespaced output hand-offs |
| `regression-pack.plan.json` | Independent Single Test and Business Process members with isolated state |
| `sales-orders.sample.json` | Two transaction headers with different child line-item counts |

All targets refer to the logical `default` credential profile. No URL, username, password, token, or live tenant data is stored in these plans.

## Binding language

```text
process.orders.header.orderType
stages.createSalesOrder.outputs.salesOrderNumber
system.sap.password
```

- `processData` reads from an immutable dataset snapshot.
- `stageOutput` can reference only an earlier stage’s declared output.
- `systemContext` is resolved by the server and never contains the secret value in the plan.
- `literal` is available for non-secret configuration only.

## Default policies

- Transaction iterations execute sequentially.
- Each transaction receives a fresh browser session.
- A Business Process stops the execution after an iteration failure.
- A Regression Pack continues to its next independent member.
- Canonical evidence is enabled.

The files are validated by `regression/execution-plan-contract.test.js`.

