# Release Governance Correction — 2.1.0 line opened

**Date:** 30 July 2026
**Status:** Decision record — supersedes nothing, clarifies the version boundary around `v2.0.0`
**Raised by:** Cross-check between the QA/4HANA Studio 2.0 documentation set and repository/git evidence
**Applies to:** `package.json`, `docs/ui-ux/PRODUCT_BACKLOG_TRACKER.html`, release tooling

## 1. What was found

`RELEASE_SIGN_OFF_2.0.md` and the Status Report describe a signed, GA-approved `v2.0.0` build.
Verification against the repository showed:

| Fact | Evidence |
|---|---|
| `v2.0.0` tag targets commit `fb4bd49` | `git rev-parse v2.0.0` / `git show v2.0.0` |
| GA commit time | `fb4bd49` — 30 Jul 2026, 08:07:59 +05:30 |
| A further commit landed on `main` afterward | `109a86d` — 30 Jul 2026, 11:40:12 +05:30 (+3,546/-262 across 42 files, "feat: complete visual processes and saved packs") |
| Test-catalogue size at the GA tag | **125 tests** (`git show fb4bd49:apps/test-operations/data/test-catalog.json`) |
| Test-catalogue size on current `main` | **149 tests** |
| `package.json` version at the time of this correction | still read `2.0.0`, unchanged since the tag |

`109a86d` is not a defect fix — it completes BL-012 (stable artifact/run routes), BL-020 (Test
Library), BL-021 (typed Single Tests), BL-028 (Business Process / Regression Pack separation) and
BL-029 (visual Processes/Packs canvas), all additive product features. The backlog tracker's own
change log records this work as completed *after* the GA-approval entry, still labeled under the
original T2 (Beta) / T3 (RC) planning tranches, which made it look like part of the signed release.

## 2. Decision

1. **`v2.0.0` remains frozen and unchanged.** Its tag, commit (`fb4bd49`), and signed evidence in
   `RELEASE_SIGN_OFF_2.0.md` are not modified or reopened. The 125-test catalogue is the evidence
   base that backed that GA decision, and that decision stands as recorded.
2. **`main` is reclassified as the 2.1.0 development line.** Because the post-GA work is additive
   (new features, not fixes), the next release is **2.1.0**, not 2.0.1. `package.json` now reads
   `2.1.0-dev.0`.
3. **BL-012, BL-020, BL-021, BL-028 and BL-029 belong to 2.1.0's actual delivery.** In the tracker,
   each item now
   carries both:
   - `plannedTranche` — unchanged, reflects original scoping (T2 · 2.0 Beta / T3 · 2.0 RC).
   - `actualRelease: "2.1.0"` — records which version the delivered state actually shipped in.
   Only the 24 items already Implemented at `fb4bd49` carry `actualRelease: "2.0.0"`. Future items
   never default into the frozen baseline merely because their status later becomes Implemented.
4. **The 149-test `main` build requires its own 2.1.0 verification and release decision** before it
   can be called anything other than `-dev`. It is not automatically covered by the 2.0.0 sign-off.
   If `main` were instead to keep calling itself `2.0.0`, GA would need to be formally revisited —
   that is explicitly not the path taken here.
5. **No 2.1.0 tag or release approval is created by this note.** This is a labeling and tooling
   correction, not a release event.

## 3. Related backlog provenance — reconciled

A direct comparison of the tracker at `fb4bd49` with `109a86d` confirmed the same post-GA pattern
for BL-012 and BL-028:

| Item | State at frozen `v2.0.0` | State after `109a86d` | Actual release |
|---|---|---|---|
| BL-012 | Partial, 2/3 | Implemented, 3/3 | 2.1.0 |
| BL-028 | Partial, 3/4 | Implemented, 4/4 | 2.1.0 |

The systematic comparison found no other item that changed from Partial, Not started or Deferred to
Implemented after the tag. The explicit 2.0.0 baseline set therefore contains 24 items; the five
items listed in Decision 3 form the current 2.1.0 delivery set.

## 4. Live SAP evidence — verified, not just asserted

BL-041's live evidence used a real non-production SAP S/4HANA Cloud tenant, not the isolated mocked
test layer. This is corroborated by repository evidence: the run IDs it cites
(`299669f8-75b6-471d-9c56-ed0375011fc5`, `4b4f15d7-32df-4348-be70-23fe5243ff7a`, and others) exist as
real folders under `audit-evidence/` with generated PDFs, SAP-hosted target metadata, Fiori
navigation events, SAP validation messages and document identifiers. These artifacts establish the
target class and recorded interaction. They do not provide an independent third-party attestation
that every underlying SAP state transition occurred exactly as recorded.

## 5. Verification independence

The GA sign-off documents list `/s/ OpenAI Codex` as verification executor. Per Codex's own account,
it acted as both the engineering implementation agent for this tranche *and* the automated
verification executor. The workspace owner (Sathyanarayanan Kiran) provided separate release
acceptance, but that is not the same as an independent reviewer re-running the checks. Going forward,
release documents should describe this precisely:

> Automated build, test and evidence verification executed by Codex; release acceptance provided by
> the workspace owner.

Stronger independence for a future release would mean a reviewer/agent with no implementation context
for that tranche, or human QA validation against an immutable candidate commit.

## 6. Shared foundation for BL-022 / BL-024 / BL-037

BL-022 (Object Repository workbench), BL-024 (selector health/history/governance) and BL-037 (global
artifact search + dependency impact) all require the same underlying data: what exists, what version
it's at, and what references what. Building them independently risks three incompatible definitions
of "usage" and "dependency." Recommended shared foundation, built in this order:

1. **Artifact registry + dependency-edge index** — `ArtifactNode` (Test, dataset, object, Process,
   Pack, run source), `ArtifactVersion` (lifecycle/application/domain/version), `DependencyEdge`
   (source, target, relationship type, exact reference path), one indexer that extracts references
   from Tests, contracts, Processes, Packs and datasets, one authorization-aware query service.
2. **BL-022** consumes it for object usage and dependency-safe rename/delete.
3. **BL-024** adds `SelectorVerificationEvent` history on top of the same registry.
4. **BL-037** exposes global search and dependency traversal through the same index — last, once the
   foundation is proven by BL-022/024.

## 7. Release-count drift — root cause and fix

The 44/40-isolated-API/UI-vs-28/32 discrepancy (and the 259/256/251/252-file secret-scan drift) found
across the three PDFs happened because counts were hand-copied into markdown at each milestone as the
suite grew, with no single source of truth pinned to a specific commit. This is now addressed
mechanically:

- `regression/reporters/result-capture.js` now stamps every recorded run with `commitSha`,
  `worktreeClean` and `sourceTreeClean` at record time. `sourceTreeClean` permits only generated
  quality-history/catalogue outputs to differ, so sequential recorded suites remain possible
  without allowing uncommitted product code into a release candidate.
- `scripts/generate-release-manifest.mjs` (`npm run release:manifest -- --version <semver>`) reads
  `regression/results/quality-history.json`, requires the **latest** Core / isolated-API /
  isolated-UI run to (a) exist, (b) carry the candidate `commitSha`, (c) have
  `sourceTreeClean === true`, and (d) contain no failed, cancelled or todo tests. It also requires
  the package version to match the requested manifest version, verifies that the current source tree
  has only generated quality-output changes, and runs the repository secret scan. It fails closed
  and writes nothing when any gate fails. The existing history cannot qualify because it predates
  this complete provenance contract; fresh commit-matched Core/API/UI runs are required.
- `npm run test:release:recorded` is the cross-platform candidate workflow. It builds, typechecks,
  scans for secrets, and records Core, isolated API and isolated UI through the same provenance
  reporter before catalogue regeneration. Run it only after committing the intended candidate;
  then run the manifest command while only generated quality outputs differ.
- Once a manifest exists, release documents should render their count tables from it, and any
  hand-written number that disagrees with the manifest should be treated as a documentation defect.

## 8. What this note does *not* do

- Does not create or push a `v2.1.0` tag.
- Does not claim 2.1.0 release approval — that requires a fresh, commit-matched manifest and an
  explicit owner decision, neither of which has happened yet.
- Does not modify `RELEASE_SIGN_OFF_2.0.md`, `ACCESSIBILITY_RELEASE_VERIFICATION.md`, or any other
  signed 2.0.0 evidence document.
- Does not claim that existing pre-provenance quality runs qualify for 2.1.0; fresh recorded runs
  against the eventual candidate commit remain required.

## 9. 2.1.0 release-qualification decision — 31 July 2026

**Raised by:** Workspace owner Sathyanarayanan Kiran, on completion of BL-037 (the last non-deferred
backlog item).

### 9.1 BL-039 and BL-040 formally excluded from 2.1.0 scope

Both items were already `Deferred` / `T5 · Post-2.0` / `P3` in the tracker, but that classification
described *when they might start*, not a formal decision that they are out of the 2.1.0 candidate.
This section is that decision:

- **BL-039 (multi-user roles and capabilities)** — no multi-user deployment requirement has been
  confirmed. The product continues to use one preserved owner identity through 2.1.0.
- **BL-040 (scheduling, notification and controlled parallelism)** — isolation for parallel execution
  has not been proven. 2.1.0 continues with the current sequential orchestration model.

Neither item's absence blocks 2.1.0 GA. Their tracker `coverage` fields now reference this section
directly.

### 9.2 2.1.0 GA readiness status

With BL-039/BL-040 excluded, every item in the active 2.1.0 scope is `Implemented`. That is
deliberately a narrower claim than "the entire backlog is complete":

| Statement | Status |
|---|---|
| Functional active backlog (every non-deferred item) | **Complete** |
| Entire backlog, including deferred scope (BL-039/BL-040) | **Not complete** — by design, per §9.1 |
| 2.1.0 release verification | **Not yet complete** — see §9.3 |
| Ready to tag `v2.1.0` GA | **Not yet** |

### 9.3 What is, and is not, refreshed for the 2.1.0 candidate

BL-017's evidence (`ACCESSIBILITY_RELEASE_VERIFICATION.md`, `NVDA_PRIMARY_WORKSPACE_RESULTS.md`,
`RELEASE_SIGN_OFF_2.0.md`) is frozen 2.0.0 evidence: it was recorded 29-30 Jul 2026 against the GA
commit `fb4bd49`, and the tracker's `frozen20Implemented` set already attributes it to `actualRelease:
"2.0.0"`, not 2.1.0. It has not been claimed as 2.1.0 evidence at any point and does not become 2.1.0
evidence by the passage of time or by unrelated 2.1.0 features shipping.

| Verification | Refreshed for the 2.1.0 candidate? | Evidence |
|---|---|---|
| Automated accessibility (Axe serious/critical, keyboard skip/focus, 320px reflow) | **Yes** — commit-matched, part of every recorded isolated-UI run | `regression/ui/accessibility.test.js`, `regression/results/quality-history.json` |
| Isolated Core / API / UI regression | **Yes** — commit-matched, zero-failure, re-verified after every 2.1.0 item including BL-037 | `release-manifests/v2.1.0-dev.0.json` |
| Manual NVDA screen-reader journeys | **No** — last recorded 29 Jul 2026 against `fb4bd49`; the 2.1.0 candidate adds Overview alerts/impact analytics (BL-018/019), the Object Repository workbench (BL-022/024), the Dataset Library (BL-025), Business Process/Pack canvases (BL-029), execution-hierarchy/diagnosis UI (BL-031/032), the Audit ledger UI (BL-035) and Global Search (BL-037) — none of which NVDA has verified | checklist prepared, not executed — `RELEASE_VERIFICATION_2.1_CHECKLIST.md` §2 |
| Live-SAP verification (read-only + authorised transactional) | **No** — last recorded 30 Jul 2026 against `fb4bd49`; not re-run against the 2.1.0 candidate | checklist prepared, not executed — `RELEASE_VERIFICATION_2.1_CHECKLIST.md` §3 |
| Workspace-owner sign-off of consolidated release evidence | **No** — the 30 Jul 2026 sign-off approved 2.0.0 GA specifically; no equivalent 2.1.0 sign-off has been given | checklist prepared, not executed — `RELEASE_VERIFICATION_2.1_CHECKLIST.md` §4 |

### 9.4 Why this note does not perform the manual refresh itself

The three outstanding items in §9.3 are deliberately not something an engineering agent can generate
on its own behalf, and none were attempted here:

- **NVDA re-verification** requires an actual NVDA installation and a human (or an equivalent
  screen-reader-capture pipeline) to record real spoken output — not something a code-editing agent
  can fabricate or approximate from Axe's static analysis, which already runs automatically and
  passes but is not a substitute for a screen-reader journey.
- **Live-SAP re-verification** requires a real, credentialed, owner-approved non-production SAP
  target. The existing `REGRESSION_LIVE=1` / `REGRESSION_LIVE_TRANSACTIONAL=1` live-gated regression
  suites already exist and are ready to run the moment such a target is configured and authorised for
  the 2.1.0 candidate commit — they are not a design gap, only an un-run gate.
- **Owner sign-off** is, by this product's own single-owner governance model, an act only the
  workspace owner can perform — recording one on the owner's behalf would misrepresent who verified
  the release.

`RELEASE_VERIFICATION_2.1_CHECKLIST.md` is the concrete, row-by-row checklist for all three items
against the surfaces added since the 2.0.0 NVDA/live-SAP evidence — prepared now, execution deferred
to whenever NVDA access, a live SAP target, and the owner's time are available.

### 9.5 What this section does *not* do

- Does not create or push a `v2.1.0` tag.
- Does not claim 2.1.0 release approval.
- Does not claim BL-017's frozen 2.0.0 evidence covers the 2.1.0 candidate.
- Does not mark BL-039 or BL-040 `Implemented` — they remain `Deferred`, now with an explicit 2.1.0
  scope-exclusion decision recorded against them.
