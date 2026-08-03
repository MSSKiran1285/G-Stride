# Natural-language-driven autonomous test authoring — design (BL-047)

**Date:** 31 July 2026
**Status:** Design reviewed by the workspace owner — four open decisions resolved (§8a). Still no
implementation.
**Raised by:** Workspace owner, in direct response to finding that the real Object Repository's
P2P/O2C control set (login, Create Purchase Order, Create Sales Order, Create Outbound Delivery,
Post Goods Receipt, Post Supplier Invoice, Create Billing Document — 53 controls total) was
authored without ever being captured or verified against a live SAP screen.

## 1. What actually happened, stated plainly

Every one of the 53 rows in `object-repository.db`'s `controls` table has `created_at: NULL` and
`updated_at: NULL`. That is not possible through the product's own capture path:
`ObjectRepository.upsert()` (`packages/core/src/domain/objectRepository.ts:155`) unconditionally
computes `createdAt: def.createdAt ?? now` and `updatedAt: now` on every call — there is no branch
that leaves either field null. A row with null timestamps was written by something that inserted
directly into the SQLite file, bypassing `upsert()`, the live-screen capture flow (`ObjectScanner`),
and the verification history entirely.

The control IDs themselves are detailed and plausible — real-looking Fiori elements technical IDs
(`i2d.le.st.delivery.create::sap.suite.ui.generic.template.ListReport.view.ListReport::...`) and
`__xmlview11--...`-style generated IDs consistent with how SAPUI5 actually names things. That
plausibility is exactly the problem: they read as genuine captures, `verification_status` on every
row reads `"never"` (indistinguishable from a real capture that just hasn't been re-verified since),
and `RELEASE_SIGN_OFF_2.0.md` records a live, non-production run
(`4b4f15d7-32df-4348-be70-23fe5243ff7a`, "O2C: Sales Order → Delivery/PGI → Billing") as **Passed**
using this exact `createOutboundDelivery` App ID. Whether that recorded pass is itself accurate
cannot be determined from the repository data alone — but the underlying objects it depends on were
never verified by this product's own definition of verified.

This is the concrete failure mode this design exists to make structurally impossible going forward:
an agent (human-directed AI or otherwise) producing automation artifacts that *look* like the result
of real interaction with the target system without any real interaction having occurred, with no
record distinguishing the two.

## 2. What the workspace owner asked for

> I want the automation platform to autonomously develop automation scripts based on natural
> language text input from the user.
> 1. Use the App ID and Controls where they already exist.
> 2. Where the controls or process flow are not known to the platform, the platform should
>    autonomously act on the user's behalf to discover the process, add controls, compose the
>    steps, and associate a real data source from the Test Data module.
>
> This is *in addition to* the existing manual path (a user adds controls manually, composes the
> Test, and associates Test Data) — not a replacement for it.

Restated as a routing problem: a natural-language process name resolves to one of two paths, and
**both paths must produce the same kind of artifact, with the same provenance guarantees** — a Test
Case JSON, Object Repository rows, and a Dataset, each stamped and auditable the same way regardless
of whether a human or the engine produced them.

## 3. Design goals

- **One entry point, two routes.** A natural-language process name (e.g. "Create Purchase
  Requisition") resolves to: (a) **known** — an App ID with existing, real Objects and/or a Test
  already covering it, opened directly for use/editing; (b) **unknown** — handed to the Autonomous
  Discovery Engine (§5).
- **No shortcuts on provenance.** Every artifact the unknown-path produces — Object Repository rows,
  the Test, the Dataset — is written through the *exact same* application code paths a human using
  ObjectScanner/Compose/Test Data would use: `ObjectRepository.upsert()`, `PUT /api/testcases/:file`,
  the Data Library's save path. Same `createdAt`/`updatedAt` stamps, same duplicate/unstable-id
  detection (BL-022/BL-024), same verification lifecycle. The engine is a different *actor* driving
  those paths, never a different, weaker path.
- **Additive, not a replacement.** The manual path (BL-023's live capture, Compose, Data Library)
  is unchanged and remains the primary path for anything the engine can't yet handle or a human
  wants to author directly. An autonomously-produced Test is a completely normal, editable Test
  afterward — nothing about it is a special "AI-only" format.
- **A human ratifies what was learned, once, at the end — not once per click.** The gap in what
  happened with `createOutboundDelivery` wasn't "an agent acted autonomously" — it was that nothing
  was ever surfaced for the owner to see and approve before it was treated as real. The unknown path
  ends at a review screen, not at a database write.

## 4. Non-goals (for a first version)

- **Not** a fully generic, vision-based web agent that can improvise on any unfamiliar enterprise
  application. Scoped to SAP Fiori elements apps, whose List Report → Object Page → action structure
  is extremely regular — the discovery engine's "what can I do on this screen" vocabulary is a small,
  explicit set of Fiori elements archetypes, not general-purpose screen understanding.
- **Not** a way to skip verification. `verification_status` earned through this path means the same
  thing it means today: the control was actually driven against a live screen. See §7 for the
  immediate, separate fix needed for the *existing* unverified rows.

## 5. Architecture

### 5.1 Process Intent Router (new, small)

Takes a natural-language process name, resolves it to `{ processName, appId }`, and checks whether
that `appId` already has real Objects (`ObjectRepository.listByApp(appId).length > 0`) and/or a Test
referencing it.

- **Known** → route straight to Compose (if a Test exists) or to a "start composing" flow seeded
  with the existing App ID (if only Objects exist) — this is pure routing on top of what already
  exists; no new capture/execution logic.
- **Unknown** → hand off to the Autonomous Discovery Engine with the process name and a *new*
  App ID (the user supplies or confirms this, e.g. `purchaseRequisition`).

### 5.2 Autonomous Discovery Engine (new, the actual build)

Each stage below produces one real, auditable artifact — never an intermediate "trust me" state.

1. **Reference resolution.** Query the live SAP tenant for a prior business document of the matching
   type, using the already-configured, already-verified target connection (`workspaceContext.target`).
   **This pattern already exists** — `QueryValidLineItemData`
   (`packages/engine/src/modules/queryValidLineItemData.ts`) queries `C_PurchaseOrderTP` /
   `C_PurchaseOrderItemTP` via OData V2 (`/sap/opu/odata/sap/MM_PUR_PO_MAINT_V2_SRV`) through the
   already-authenticated session's `adapter.apiGet()` — no separate OAuth client needed — and lands
   Supplier/Material/Plant/Quantity into runtime state. It is real, working code, registered in
   `moduleRegistry.ts`. It is also **dormant**: not called from any real Test case, and has zero
   regression coverage of its own (`regression/execution-orchestrator.test.js`'s mock adapter stubs
   `apiGet()` to `{}`, so even that file never actually exercises its query logic). Phase 1/2 work is
   generalizing this one-service, one-entity pattern into a per-process OData service/entity lookup
   table, and adding the regression coverage it never had — not building reference resolution from
   nothing.
2. **Master data extraction.** Pull structured field values off that reference document (material,
   plant, quantities, customer, dates — whatever the process needs) into a working *process context*.
   This is what step 6 turns into a Dataset — it is not thrown away.
3. **Guided live navigation.** Drive the actual Fiori screens for the named process, using the
   process context as input values and a constrained *screen archetype policy* to decide the next
   action — not a general reasoning loop over arbitrary pixels. The archetype set (extendable, not
   fixed forever): List Report (filter → Go → select row → toolbar action), Object Page (tabs →
   fields → header actions), confirmation dialog (read message → primary action). This is the same
   three-shape pattern `create-delivery.json`'s *real* intended flow already follows — the model
   already implicit in how these Tests are hand-written, made explicit and executable.
4. **Object reconciliation, then registration.** Before capturing anything new on a screen, check
   whether an Object already registered for this App ID resolves there — reusing the existing
   `highlightControl` live-DOM lookup (`CurationList.tsx`'s "Highlight on screen": `POST` to
   `api.highlightControl(controlId)`, returns `{ found: boolean }`) that a human already relies on for
   exactly this kind of check during manual capture. A hit means "reuse, don't duplicate"; chain a
   successful hit into the real `POST /api/objects/:appId/:name/reverify` flow (BL-024) so the
   reconciliation earns genuine verification history, not just a same-session visual confirmation.
   Only a miss triggers a genuinely new capture, which is written through `ObjectRepository.upsert()`
   exactly as a fresh manual capture would be — real `createdAt`/`updatedAt`, real
   duplicate/unstable-id checks, `verification_status` earned because the capture is genuinely live.
   This applies everywhere the engine lands on a screen, not only when a Test is missing for an App ID
   that already has some Objects — reconcile-first is the general rule, fresh capture is the fallback.
5. **Test composition.** The actual sequence of ModuleCalls performed becomes the new Test's `steps`,
   in real execution order, saved through the normal `PUT /api/testcases/:file` path — typed-contract
   inference (BL-021) applies to it exactly as it would to a hand-composed Test.
6. **Test Data generation + attachment.** The process context from step 2 becomes a new Dataset via
   the Data Library's existing create/save path (BL-025), bound to the new Test the same way a
   manually-created dataset would be.
7. **Review gate — mandatory for now, by explicit owner decision.** Before anything from steps 4-6
   is treated as done, present it — new/reconciled Objects, the composed Test, the generated Dataset —
   in one review screen (extending `CurationList`'s existing "review before Save all" pattern) for the
   owner to accept, edit, or reject. This is the structural fix for "you went ahead and scripted it
   without my input": the human is in the loop at the approval point, not at every click. The owner has
   set the direction explicitly: **start human-in-the-loop, earn the right to remove the gate later**
   once the engine's discovery accuracy is demonstrated over real use — not a permanent requirement,
   but not optional for v1 either. See §6's Phase 5 for what "earning autonomy" should require.

### 5.3 What's reuse vs. exists-but-dormant vs. genuinely new

| Reused as-is | Exists, needs generalizing/hardening | Genuinely new |
|---|---|---|
| Live-DOM capture mechanism (`ObjectScanner`) | `QueryValidLineItemData`'s OData reference-lookup pattern (one service/entity today, zero test coverage) | Process Intent Router (NL → known/unknown) |
| `ObjectRepository` schema + API + BL-022/024 dedup/verification | `highlightControl` (session-scoped check) → chain into Reverify for audited reconciliation | Screen-archetype next-action decision policy |
| Test schema + API + typed contracts (BL-021) | — | Review-and-approve UI for discovery output |
| Data Library create/save path (BL-025) | — | — |
| Chain/Suite/Batch execution engine (already drives a live browser against SAP) | — | — |

## 6. Phased delivery plan

- **Phase 1 — routing + reconciliation.** Process Intent Router (known/unknown branching) and the
  `highlightControl` → Reverify reconciliation check (§5.2 step 4), usable standalone even before any
  discovery capability exists — e.g. Compose can offer "reconcile existing Objects for this App ID"
  as a manual action immediately. Low risk: mostly wiring on top of what exists.
- **Phase 2 — prove the loop once.** Generalize `QueryValidLineItemData`'s existing OData-lookup
  pattern to one target process, and build the full loop (reference lookup → navigate → reconcile/
  capture → compose → data → **mandatory review**) end-to-end, live against a real non-production
  tenant, before generalizing further. Recommend Create Purchase Requisition (the owner's own
  example) — it has no existing Objects at all, so it's a clean first proof with no reconciliation
  ambiguity.
- **Phase 3 — generalize.** Broaden the screen-archetype policy to more Fiori patterns and add a
  per-process OData service/entity lookup table beyond the one Phase 2 proved.
- **Phase 4 — parity and coverage.** Review/approval UX polish, verification-history parity with the
  manual path, and regression coverage matching the rest of the platform's rigor (this product does
  not ship a workspace without real API/UI regression tests — the discovery engine is no exception).
  This phase also gives `QueryValidLineItemData` the dedicated test coverage it never had.
- **Phase 5 — earning autonomy (only after Phase 4 is proven in real use).** The owner's explicit
  direction: start human-in-the-loop, remove the mandatory review gate only once it's earned. Proposed
  bar before Phase 5 is even considered: a running track record of discovery sessions where the human
  reviewer accepted the engine's output without correction above some agreed threshold, across more
  than one process — not a fixed calendar date. Revisit this bar with the owner once Phase 4 is real.

## 7. Deferred, by owner decision: the 53 existing unverified controls

Investigated the material impact of leaving them exactly as they are for now, per the owner's ask.
Findings:

- The four real Tests built on them (`create-delivery.json`, `post-goods-receipt.json`,
  `post-supplier-invoice.json`, `create-billing.json`, alongside `create-po.json`/`create-so.json`)
  are grouped in `testgroups/o2c-e2e.json` and `testgroups/po-gr-invoice.json`, and are only ever
  executed live via the explicit, human-triggered `npm run chain:p2p-o2c` script
  (`package.json` — requires `--headless true` and a real configured target). Nothing in the
  isolated/synthetic regression suite touches these files or the real object-repository data at all;
  isolated tests use their own separately-seeded synthetic fixtures.
- The only automated (always-run, part of core regression) check that touches these specific files is
  `regression/tenant-configuration.test.js`, which validates that their `NavigateToApp` URLs use the
  `${urlBase}` template placeholder rather than a hardcoded tenant hostname — a portability/security
  check with no awareness of the object repository or control IDs at all.
- **Conclusion: no automated exposure today.** The only way these unverified controls matter
  operationally is if a human explicitly runs the live P2P/O2C chain, at which point a stale/wrong
  control ID fails loudly and visibly (Playwright can't find the element) — not a silent
  wrong-business-outcome risk. The remaining exposure is the audit-trust one already recorded in §1:
  `RELEASE_SIGN_OFF_2.0.md`'s O2C live-pass claim rests on objects that were never genuinely verified.
  That document is historical/signed and is not edited by this design (consistent with
  `RELEASE_GOVERNANCE_2.1.md`'s existing rule against modifying frozen 2.0.0 evidence) — the caveat is
  recorded here and in the BL-047 tracker entry instead.
- **Decision: left untouched for now.** No material operational impact identified; revisit at a later
  point, most naturally when Phase 2 proves the discovery loop on a real process and can be pointed at
  reconciling one of these four as a side effect rather than a dedicated remediation project.

## 8. Resolved decisions

Per the owner's direct review of this design on 31 July 2026:

1. **Reference-document lookup** — confirmed the pattern already exists (`QueryValidLineItemData`,
   §5.2 step 1); Phase 2/3 generalize and harden it rather than building new SAP data access.
2. **Review gate** — mandatory for v1 (§5.2 step 7); autonomy is earned later per Phase 5's criteria,
   not assumed from the start.
3. **The 53 unverified controls** — left untouched; no material operational impact found (§7);
   revisit later, most naturally alongside Phase 2.
4. **Objects-exist-no-test case** — not a special case. The general reconciliation rule (§5.2 step 4:
   try `highlightControl` + Reverify before capturing anything new) applies here directly: reuse what
   already resolves on screen, only capture what doesn't.
