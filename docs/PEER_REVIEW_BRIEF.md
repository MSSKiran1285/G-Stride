# G-Stride — external peer review brief

> Hand this whole file to the reviewer. It is written to be pasted verbatim into an AI
> assistant with repository access, or read by a human engineer before they open the code.
> Everything in the "What we already know is wrong" section is deliberate: a review that
> spends its time rediscovering our known list is a review we did not need.

---

## Your role

You are an external reviewer with no prior involvement in this codebase. You have been asked
for an independent, sceptical assessment. We are not looking for reassurance, and we are not
looking for a list of style nits. We want the things that would embarrass us in front of an
auditor, a customer, or a new engineer.

Assume good faith but verify everything. Where this brief makes a claim about the code, check
it — several claims we made internally turned out to be wrong when someone finally ran them.

---

## What the product is

G-Stride is a test-automation platform for SAP S/4HANA. A user captures reusable UI controls
from live SAP screens, composes them into Tests, binds Tests to data, sequences Tests into
Business Processes, and executes them against a real SAP tenant.

Three properties make it different from an ordinary UI-test tool, and they are what the review
should be weighted toward:

1. **It creates real business documents.** A run posts real Sales Orders, Deliveries, Goods
   Receipts, Supplier Invoices and Billing Documents into a customer's SAP system. There is no
   dry-run mode and no rollback. A defect here does not fail a test; it puts a wrong document
   into a system of record.

2. **It ships signed audit evidence.** Every run produces an evidence PDF with screenshots,
   captured document numbers, an owner-linked automation reference and a failure disposition.
   That evidence is intended to be shown to auditors. `audit-evidence/` is treated as frozen
   and is never edited after the fact.

3. **It is a single-user local workspace.** The Studio binds to loopback by default. There is
   no multi-tenancy, no RBAC beyond a single workspace owner, and state lives in local SQLite
   files alongside the repository.

## Shape of the codebase

| | |
|---|---|
| Language | TypeScript throughout, React 19 front end, Express server, Playwright driver |
| Source | ~28,900 lines across 7 workspace packages |
| `studio-web` | 13,700 lines — the React Studio UI |
| `studio-server` | 6,100 lines — Express API, preflight, execution orchestration entry |
| `engine` | 3,200 lines — the execution engine and 28 step modules |
| `core` | 2,700 lines — domain types, execution plan, data sets, object repository |
| `adapter-fiori` | 1,100 lines — the SAP Fiori/UI5 automation adapter |
| `cli`, `reporting` | ~2,000 lines |
| Tests | 57 regression files; 113 core, 85 API, 55 UI passing at v2.2.0 |
| Persistence | 5 SQLite stores: objects, runs, documents, tags, column schema |
| Backlog | 63 items, 18 open, in `docs/ui-ux/PRODUCT_BACKLOG_TRACKER.html` |

Start with `HANDOVER.md`, then `packages/core/src/domain/executionPlan.ts`,
`packages/engine/src/executionOrchestrator.ts` and
`packages/studio-server/src/executionPreflight.ts`. Those four describe the model.

## The safety model, as designed

Before any run, a preflight builds an immutable execution plan and refuses to proceed on any
blocking finding. The controls that exist today:

- A Test that creates documents may only run against a target explicitly classified
  **non-production**, and that classification must have been verified live.
- Such a run must use **stop-execution** on iteration failure — it may not continue past a
  failed transaction.
- Every transactional Test must declare `retain-for-review` as its failure disposition and
  must require an accountable run owner.
- Every transactional Test must carry an owner-linked **automation reference** step, and that
  reference is idempotent across the stages of one process, so one execution has one
  correlation key.
- Credentials resolve from system context or an encrypted store, **never** from test data.
- The approved data set is hashed into a snapshot at preflight and that exact snapshot is what
  Start reuses.

**We would like this model attacked.** Specifically: can you construct a sequence — through the
API, through a crafted artefact on disk, through a race between preflight and start, through
a rerun, or through a Regression Pack member — that gets a document created without every one
of those controls having been satisfied?

---

## What we already know is wrong

Do not spend time rediscovering these. Do tell us if you think our reading of any of them is
mistaken, or if you find the same root cause somewhere we have not looked.

**A duplicate line item reached nineteen real Sales Orders.** `AddLineItem` clicked the grid's
add control after the last row as well as between rows; on a Fiori creation-row table that
leaves the row populated for the save step to commit again. Every order the O2C suite created
between 24 Jul and 17 Aug 2026 carries one line more than its data specified. Fixed in
`39ec4cb`. The documents themselves are **not** yet corrected (BL-053).

**It went undetected for three weeks because nothing verifies outcomes.** The module reports
what it was *fed*, never what the document ended up holding, so signed evidence for SO 336722
records one line item while SAP holds two. There is no post-condition anywhere that compares
intent to result (BL-052). We consider this the most serious structural gap in the product.

**Nothing in the Object Repository has ever been verified.** All 74 captured controls across 12
App IDs carry `verification_status: "never"`. `RECONCILE ALL` exists and appears never to have
been used, so a drifted selector is indistinguishable from a good one until a run breaks
(BL-054).

**Every Sales Order the product creates is flagged Incomplete by SAP**, and the Test dismisses
that warning by design. Probably a missing Customer Reference; SAP's incompleteness log is
authoritative and has not been read (BL-058).

**15 UI tests are skipped**, 11 of them deprecated by a rebrand, and several say outright that
the acceptance criteria they covered are now uncovered (BL-056).

**A design language was built, passed all gates, and was reverted** at the owner's instruction;
it survives on tag `backup/design-language-189607d`. Five modules were never structurally
converted (BL-051).

The full list is BL-051 through BL-063 in the backlog tracker, tagged
`Open items review, 18 Aug 2026`.

---

## What we want from you

Answer these directly. Where you have no evidence, say so rather than speculating.

### 1. The safety model
Is the preflight actually sufficient, or is it theatre in places? We are most worried about
paths that bypass it: the rerun flow, Regression Pack members, artefacts hand-edited on disk,
and anything that reaches the engine without going through `executionPreflight`. Is the
snapshot genuinely what executes, or can the data change between approval and start?

### 2. Evidence integrity
Could the evidence a run produces ever misrepresent what happened in SAP — beyond the
line-count gap we already know about? Consider partial failures, cancellation, a browser
crash mid-transaction, and a document created but not captured. Is "frozen" enforced, or a
convention?

### 3. The execution model's ceiling
One data row drives one pass through every stage of a Business Process. Stage outputs hand
forward automatically by name. We know document-level fan-out is unsupported (BL-061). What
else does this model make hard or impossible that a real SAP test programme would need? Is
the name-based hand-off — where a later stage's output silently shadows a data column of the
same name — a good idea?

### 4. Correctness of the domain logic
`packages/core/src/domain/` and `packages/engine/src/` are where a bug becomes a wrong
document. Read `resolveParams`, `loadTransactionData`, `stageInputRow`, `bindInput` and the
step modules with real suspicion. Data flows through several representations — CSV cell, JSON
blob in a cell, joined child collection, `${placeholder}`, run-state key — and we would like to
know where that chain leaks.

### 5. Test suite quality, not quantity
253 tests pass. Are they testing behaviour or implementation? Which of the product's actual
risks are uncovered? We know of no test that asserts a created document matches its input.
What else is missing that a reviewer would expect for software with this blast radius?

### 6. What a new engineer would get wrong
The codebase carries long explanatory comments, deliberately. Do they help, or are they
covering for a design that should be simpler? Where would a competent newcomer cause damage
in their first week?

### 7. The thing we have not asked about
Tell us what we should have put in this brief and did not.

---

## Ground rules

- **Do not run anything against SAP.** Live execution requires explicit owner authorisation
  per run. `REGRESSION_LIVE` and `REGRESSION_LIVE_TRANSACTIONAL` must stay unset.
- **Do not modify `audit-evidence/`.** It is signed and frozen.
- Read-only analysis is preferred. If you want to run the suites:
  `npm run build && npm run test:quality:core && npm run test:api:isolated && npm run test:ui:isolated`.
- Please separate **findings you verified by reading or running code** from **concerns you
  are raising on suspicion**. We will act on both, but not in the same way.
- Rank by consequence, not by how easy the fix is. A single wrong document in a customer's
  system of record outranks any amount of duplicated CSS.
