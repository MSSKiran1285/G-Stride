# Natural-language-driven autonomous test authoring — design (BL-047)

**Date:** 31 July 2026
**Status:** Design for review — no implementation yet
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
   *Open dependency (§8): this needs a real SAP data-access path Studio doesn't have today* — either
   an OData query against the relevant business-object service, or a UI-driven search flow (open the
   relevant "Manage <Documents>" app, search, take the first/most-recent match) using the same
   browser-driving infrastructure the execution engine already has.
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
4. **Object registration.** Every control the engine actually touches is captured from the live DOM
   (reusing `ObjectScanner`'s existing capture mechanism) and written through
   `ObjectRepository.upsert()` — real `createdAt`/`updatedAt`, real duplicate/unstable-id checks,
   `verification_status` earned because the capture is genuinely live, not defaulted or scripted.
5. **Test composition.** The actual sequence of ModuleCalls performed becomes the new Test's `steps`,
   in real execution order, saved through the normal `PUT /api/testcases/:file` path — typed-contract
   inference (BL-021) applies to it exactly as it would to a hand-composed Test.
6. **Test Data generation + attachment.** The process context from step 2 becomes a new Dataset via
   the Data Library's existing create/save path (BL-025), bound to the new Test the same way a
   manually-created dataset would be.
7. **Review gate (new UI, not explicitly requested but necessary).** Before anything from steps 4-6
   is treated as done, present it — new Objects, the composed Test, the generated Dataset — in one
   review screen (extending `CurationList`'s existing "review before Save all" pattern) for the owner
   to accept, edit, or reject. This is the structural fix for "you went ahead and scripted it without
   my input": the human is in the loop at the approval point, not at every click.

### 5.3 What's reuse vs. genuinely new

| Reused as-is | New |
|---|---|
| Live-DOM capture mechanism (`ObjectScanner`) | Process Intent Router (NL → known/unknown) |
| `ObjectRepository` schema + API + BL-022/024 dedup/verification | Reference-document lookup against the live tenant |
| Test schema + API + typed contracts (BL-021) | Screen-archetype next-action decision policy |
| Data Library create/save path (BL-025) | Review-and-approve UI for discovery output |
| Chain/Suite/Batch execution engine (already drives a live browser against SAP) | — |

## 6. Phased delivery plan

- **Phase 0 — trust remediation (do first, independent of the rest of this design).** The 53
  existing unverified controls and the Tests built on them (`create-delivery.json`,
  `post-goods-receipt.json`, `post-supplier-invoice.json`, `create-billing.json`, the login/PO/SO
  App IDs) should not keep presenting as ordinary, trustworthy repository entries. Two options,
  owner's call: (a) genuinely re-capture and verify each one against the live tenant, retiring the
  scripted rows; (b) flag them in the UI (a visible "never captured live" badge, distinct from the
  existing "never verified" status, which today can't tell these two situations apart) until (a)
  happens. Either way, this needs a decision now, separate from BL-047's timeline.
- **Phase 1 — routing only.** Process Intent Router + known-path routing. No new discovery
  capability yet. Low risk: mostly UI/routing on top of what exists, and it's immediately useful
  on its own (natural-language jump to an existing Test).
- **Phase 2 — prove the loop once.** Build the full discovery loop (reference lookup → navigate →
  capture → compose → data → review) for exactly one well-understood process end-to-end, live
  against a real non-production tenant, before generalizing. Recommend Create Purchase Requisition
  (the owner's own example) or the outbound delivery/PGI flow specifically, since remediating it in
  Phase 0 means it will already have a *real* baseline to compare the engine's own discovery against.
- **Phase 3 — generalize.** Broaden the screen-archetype policy to more Fiori patterns and add
  reference-lookup strategies beyond whatever Phase 2 proved (OData where available, UI search
  fallback otherwise).
- **Phase 4 — parity and coverage.** Review/approval UX polish, verification-history parity with the
  manual path, and regression coverage matching the rest of the platform's rigor (this product does
  not ship a workspace without real API/UI regression tests — the discovery engine is no exception).

## 7. Immediate question, separate from the phased plan

What should happen to the 53 existing unverified controls and the four Tests built on them, right
now, independent of when Phase 0-4 actually get built? Recommend at minimum surfacing their true
status in the UI immediately (a real, visible distinction between "never captured live" and "captured
but not recently re-verified") so nobody — including a future session of this same agent — mistakes
them for verified data again.

## 8. Open decisions needed before Phase 1 starts

1. **Reference-document lookup**: does the target SAP tenant expose OData services Studio could
   query directly, or should this be UI-search-driven only?
2. **Review gate**: mandatory before an autonomously-discovered Test can be Published or added to a
   Regression Pack, or optional?
3. **Phase 0 remediation**: re-capture the existing 53 controls live now, or flag/quarantine them in
   the UI and defer re-capture?
4. **Scope of "known"**: if an App ID has Objects but *no* Test yet, is that "known" (skip discovery,
   let the user compose manually with existing Objects) or "partially known" (still worth the engine
   attempting composition, since the hard part — finding real controls — is already done)?
