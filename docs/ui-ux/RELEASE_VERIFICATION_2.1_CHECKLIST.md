# QA/4HANA Studio 2.1.0 release verification checklist — outstanding manual/live work

Date prepared: 31 July 2026
Backlog item: BL-017 (manual accessibility and release verification), refreshed scope for 2.1.0
Status: **checklist only — not executed.** See `RELEASE_GOVERNANCE_2.1.md` §9 for the decision record
this checklist implements. Nothing in this file may be treated as a passed check until each row is
filled in against a real, commit-matched candidate run.

This is not a new backlog item. It is the concrete list of what BL-017's 2.0.0 evidence
(`ACCESSIBILITY_RELEASE_VERIFICATION.md`, `NVDA_PRIMARY_WORKSPACE_RESULTS.md`,
`RELEASE_SIGN_OFF_2.0.md`) does not cover, because it was recorded against commit `fb4bd49` before
BL-018, BL-019, BL-022, BL-024, BL-025, BL-029, BL-031, BL-032, BL-035 and BL-037 existed.

## 0. Before starting any row below

- [ ] Pick the exact candidate commit on `main` this verification will run against, and record its
      short SHA at the top of the eventual results doc (mirroring how `fb4bd49` anchors the 2.0.0
      evidence).
- [ ] Confirm `git status` is clean at that commit — a dirty tree invalidates every row below the
      same way it invalidates `scripts/generate-release-manifest.mjs`.
- [ ] Re-run `npm run test:release:recorded` against that exact commit immediately beforehand, so the
      automated rows in §1 are freshly commit-matched, not stale from an earlier BL-037-era run.

## 1. Automated accessibility — already covered, re-confirm at the chosen candidate commit

These already run as part of every recorded isolated-UI suite and do not need new tooling — just a
fresh run at the frozen candidate commit so the result in the eventual sign-off doc is provably
current, not inherited from an earlier point in 2.1.0 development.

| Check | Command | 2.0.0 result | 2.1.0 candidate result |
| --- | --- | --- | --- |
| Axe serious/critical, all primary workspaces | `npm run test:accessibility` | Pass | ☐ pending |
| Skip link + keyboard entry, all primary workspaces | `npm run test:accessibility` | Pass | ☐ pending |
| 320 CSS-pixel reflow, all primary workspaces | `npm run test:accessibility` | Pass | ☐ pending |
| Build, lint, secret scan | `npm run test:release:recorded` | Pass | ☐ pending |
| Core / isolated API / isolated UI regression | `npm run test:release:recorded` | Pass | Pass as of commit `f1c236c` (81/72/49, see `release-manifests/v2.1.0-dev.0.json`) — re-run only if the candidate commit moves past this |

## 2. Manual NVDA screen-reader journey — needs a human with NVDA installed

Not executable by an engineering agent: this environment has no NVDA installation and no
audio/speech-capture tooling, so the spoken-output review the 2.0.0 evidence describes cannot be
approximated here. Follow the same method `NVDA_PRIMARY_WORKSPACE_RESULTS.md` used (official NVDA
installer, checksum-verified; headed Chrome; paced journey; raw speech log saved under
`regression/results/nvda/`), extended to the surfaces below that did not exist in that run.

| Workspace | Route | 2.0.0 journey (already verified) | New 2.1.0 surface to add to the journey | Status |
| --- | --- | --- | --- | --- |
| Automation Overview | `/` | Page hierarchy, summary metrics, recent work, impact model, first action | Needs Attention panel (BL-018); Execution impact filters, scope disclosure line, weekly trend table (BL-019) | ☐ pending |
| Control Object Repository | `/objects` | Scan form, target context, object filters, first action | Object detail panel's usage list and last-verified state; Reverify action and its outcome (BL-022/BL-024) | ☐ pending |
| Compose | `/compose` | Workspace hierarchy, test selector, new-test fields, first action | Global Search trigger in the shared header (BL-037) — verify it announces correctly from this workspace | ☐ pending |
| Test Data | `/data` | Dataset selector, creation controls, relational builder, validation actions | Dataset Library section (search/filter/rename/delete) and column-schema editor (BL-025) | ☐ pending |
| Process Suites | `/process-suites` | Process selector, creation controls, first action | Business Process stage canvas and typed hand-offs (BL-029); Regression Pack tab, member list, delete/rename (BL-029/BL-037) | ☐ pending |
| Execution Center | `/execute/new` | Type, inputs, policies, preparation steps, preflight action | Execution hierarchy display down to child-item progress (BL-031); failure diagnosis panel and its correction link (BL-032) | ☐ pending |
| Audit and Evidence | `/audit-evidence` | Summary, governance, search/filters, run record, canonical PDF link | Full AC1 filter set, pagination/sort, lineage links, per-run documents panel (BL-035) | ☐ pending |
| Global Search overlay | Header trigger, any workspace | *(did not exist in 2.0.0)* | Search input, typed result list with kind/domain/App ID/lifecycle, usage panel expand, dependency-aware delete confirmation (BL-037) | ☐ pending |

Record the result the same way as before: a dated `NVDA_PRIMARY_WORKSPACE_RESULTS_2.1.md`-style
summary, a raw speech log under `regression/results/nvda/`, and an explicit pass/fail per row above —
not a blanket "still passes."

## 3. Live-SAP re-verification — needs a real, authorised non-production target

The live-gated suites already exist and require no new code — only a configured, owner-authorised
non-production SAP target and explicit opt-in env vars:

| Check | How to run | 2.0.0 result | 2.1.0 candidate result |
| --- | --- | --- | --- |
| Live read-only Chain/Suite/Batch, API | ~~`REGRESSION_LIVE=1 npm run test:api:isolated`~~ — see BL-050; the isolated harness hardcodes a synthetic target and never reads `REGRESSION_LIVE`. Run directly against a server using the real credential store: `REGRESSION_LIVE=1 REGRESSION_ALLOW_EXECUTION=1 node --test regression/api/runs.test.js` | Pass | **Pass** — 10 Aug 2026, `RELEASE_SIGN_OFF_2.1.md` |
| Live read-only Chain/Suite/Batch, Studio UI | ~~`REGRESSION_LIVE=1 npm run test:ui:isolated`~~ — same defect, see BL-050. Run `REGRESSION_LIVE=1 REGRESSION_ALLOW_EXECUTION=1 node --test regression/ui/run-tab.test.js` | Pass | **Pass** — 10 Aug 2026, `RELEASE_SIGN_OFF_2.1.md` |
| Authorised negative transactional (create-PO blocked without a line item) | `REGRESSION_LIVE_TRANSACTIONAL=1 npm run test:api:isolated` — **requires explicit owner authorisation before each run**, per the fail-stop/retained-state policy already in force for BL-041 | Pass (run `299669f8-75b6-471d-9c56-ed0375011fc5`) | **Not run** — no owner authorisation given for this candidate |

Any new positive transactional case (P2P/O2C) beyond what BL-041 already covers needs its own
explicit test-data ownership and owner authorisation before it is attempted — this checklist does not
pre-approve one.

## 4. Workspace-owner sign-off

- [x] Owner reviews §1–§3 results against this exact candidate commit. — 10 Aug 2026
- [x] Owner explicitly signs `RELEASE_SIGN_OFF_2.1.md`, naming the candidate commit,
      the verification executor, and the decision — mirroring `RELEASE_SIGN_OFF_2.0.md`'s structure.
- [ ] Only after that sign-off does `RELEASE_GOVERNANCE_2.1.md` get a closing note recording 2.1.0 as
      ready to tag. No tag is created by this checklist or by completing any row above alone.
