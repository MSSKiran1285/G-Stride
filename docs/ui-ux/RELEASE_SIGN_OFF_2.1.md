# QA/4HANA Studio 2.1 consolidated release sign-off

Prepared: 10 August 2026
Scope: the 2.1.0 development line opened by `RELEASE_GOVERNANCE_2.1.md`, tagged `v2.1.0`
Release state: **APPROVED FOR GENERAL AVAILABILITY, WITH ONE VERIFICATION GATE KNOWINGLY NOT RE-RUN**

## Consolidated decision

The workspace owner authorised the 2.1.0 GA tag on 10 August 2026, having been shown which of
`RELEASE_GOVERNANCE_2.1.md` §9.3's gates were open at the time and having directed that the live-SAP
gate be closed first.

This document states the residual risk in its own heading rather than in a footnote, because the
2.0.0 line's central lesson — recorded in `AUTONOMOUS_TEST_AUTHORING_DESIGN.md` §1 — was that an
artifact which *reads* as verified without the verification having happened is worse than an
unverified one. One gate here was not re-run. It is named below, in the summary table, and in the
release notes.

## Gate status against this candidate

| Gate (governance §9.3) | 2.1.0 result | Evidence |
| --- | --- | --- |
| Automated accessibility — Axe serious/critical, keyboard skip/focus, 320px reflow | **Pass**, commit-matched | `regression/ui/accessibility.test.js`, part of every recorded isolated-UI run |
| Isolated Core / API / UI regression | **Pass**, commit-matched, zero-failure | `release-manifests/v2.1.0.json` |
| Live-SAP read-only, API — Chain / Suite / Batch | **Pass**, re-run 10 Aug 2026 against the real tenant | `regression/api/runs.test.js`, run log below |
| Live-SAP read-only, Studio UI — Chain / Suite / Batch | **Pass**, re-run 10 Aug 2026 against the real tenant | `regression/ui/run-tab.test.js`, run log below |
| Authorised negative transactional (create-PO blocked without a line item) | **Not run** — requires explicit owner authorisation before each run, which was not given for this candidate | checklist §3 row 3 |
| Manual NVDA screen-reader journey | **NOT RE-RUN** — see below | last recorded 29 Jul 2026 against `fb4bd49` |
| Workspace-owner sign-off | **Given** — 10 Aug 2026 | this document |

## The gate that was not re-run, stated plainly

NVDA screen-reader verification was last executed on 29 July 2026 against commit `fb4bd49`, the
2.0.0 GA build. Since that commit the 2.1.0 candidate has added Automation Overview alerts and
impact analytics (BL-018/BL-019), the Control Object Repository workbench (BL-022/BL-024), the
Dataset Library (BL-025), the Business Process and Regression Pack canvases (BL-029), the
execution-hierarchy and diagnosis UI (BL-031/BL-032), the Audit and Evidence ledger UI (BL-035),
Global Search (BL-037), and the T5 usability changes of 10 Aug 2026 (BL-042/BL-043/BL-044/BL-048).

**None of that has been through a screen-reader journey.**

Automated accessibility passes across all of it, and that is real evidence — but governance §9.3
already records why it is not a substitute: Axe is static analysis, and a screen-reader journey
tests what is actually announced. The 2.0.0 sign-off's NVDA row should not be read as covering any
screen listed above.

Closing this gate needs a human with NVDA following `RELEASE_VERIFICATION_2.1_CHECKLIST.md` §2. It
is the one item on this release that no amount of engineering work substitutes for.

## Live-SAP re-verification, 10 August 2026

Run against the configured non-production target `my426318.s4hana.cloud.sap`
(`safetyClass: non-production`, `verificationStatus: live-verified`), read-only only — authentication
and navigation, with evidence PDF capture. No transactional writes were attempted.

| Test | Result | Duration |
| --- | --- | --- |
| live: read-only Chain authenticates and opens Manage Purchase Orders, with evidence PDF | Pass | 45.2 s |
| live: read-only Suite runs independent login and procurement navigation tests | Pass | 114.5 s |
| live: read-only Batch runs two independent SAP smoke groups | Pass | 90.4 s |
| live: Run tab read-only Chain authenticates and opens Manage Purchase Orders | Pass | 70.3 s |
| live: Run tab read-only Suite runs two independent SAP smoke tests | Pass | 94.4 s |
| live: Run tab read-only Batch runs two independent SAP smoke groups | Pass | 115.4 s |

### How these were run, and why not the way the checklist says

`RELEASE_VERIFICATION_2.1_CHECKLIST.md` §3 documents these as
`REGRESSION_LIVE=1 npm run test:api:isolated` / `npm run test:ui:isolated`. That command does not do
what it says. Both isolated harnesses hardcode the SAP target to
`https://synthetic.non-production.invalid` with their own throwaway credential store, and neither
reads `REGRESSION_LIVE` at all — so running the live suites through them exercises a fake host, not
the tenant. Following the checklist literally could not have closed this gate.

The runs above were therefore executed directly against a Studio server using the real, owner-
configured credential store, with `REGRESSION_LIVE=1` and `REGRESSION_ALLOW_EXECUTION=1`. The
synthetic tests in those same files fail under that mode because their fixtures exist only inside
the isolated harness; only the `live:` cases are evidence here, and only those are recorded above.

This checklist defect is logged as **BL-050** so the documented procedure is corrected rather than
left to mislead the next person who runs it.

## Quality baseline at the tagged commit

| Suite | Result |
| --- | --- |
| Recorded core regression | 90 passed, 0 failed |
| Recorded isolated API regression | 75 passed, 0 failed, 4 live-gated |
| Recorded isolated UI regression | 61 passed, 0 failed, 4 live-gated |
| High-confidence repository secret scan | Pass |

Manifest: `release-manifests/v2.1.0.json`, generated from commit-matched, clean-tree, zero-failure
recorded runs per the provenance contract in governance §7.

## Scope explicitly excluded from 2.1.0

- **BL-039** (multi-user roles) and **BL-040** (scheduling, notification, controlled parallelism) —
  excluded by the 31 Jul 2026 release-qualification decision, governance §9.1.
- **BL-047** (autonomous test authoring) — deferred 4 Aug 2026 and removed from `main` in `469e815`
  rather than shipped unused, so this release carries none of it.
- **BL-045** and **BL-046** — held by the owner on 10 Aug 2026 pending design decisions.

## Signatures

Verification executor: `/s/ Claude Sonnet 5`, 10 August 2026 — automated suites, live-SAP read-only
re-verification, and this consolidated evidence. Did **not** perform NVDA verification; see above.

Workspace-owner acceptance: `/s/ Sathyanarayanan Kiran`, workspace owner, 10 August 2026 —
authorised the 2.1.0 GA tag knowing the NVDA gate had not been re-run.
