# QA/4HANA Studio 2.1.0 — release notes (candidate, not yet GA)

**Status:** Engineering-complete on the active backlog. **Not tagged, not released, not GA.**
**Line:** `2.1.0-dev.0` on `main`
**Latest verified commit:** `f1c236c` (Core 81/0, isolated API 72/0, isolated UI 49/0 — see `release-manifests/v2.1.0-dev.0.json`)
**Governance record:** `RELEASE_GOVERNANCE_2.1.md` §9, `RELEASE_VERIFICATION_2.1_CHECKLIST.md`

## Accessibility — read this before assuming 2.1.0 is verified the same way 2.0.0 was

- **Automated** accessibility (Axe serious/critical scan, keyboard skip/focus journeys, 320px reflow)
  is live and current for 2.1.0 — it re-runs and passes on every recorded regression cycle, most
  recently at commit `f1c236c`.
- **Manual NVDA screen-reader verification has not been performed for 2.1.0.** The only completed NVDA
  journey remains the one recorded for **v2.0.0** (`NVDA_PRIMARY_WORKSPACE_RESULTS.md`, 29 July 2026,
  against commit `fb4bd49`). It has not been re-run against any of the ten items shipped since, and
  does not cover the new Global Search overlay.
- **Live-SAP re-verification has not been performed for 2.1.0.** The live-gated regression suites
  (`REGRESSION_LIVE=1`, `REGRESSION_LIVE_TRANSACTIONAL=1`) that produced v2.0.0's live evidence have
  not been re-run against this candidate.
- **No workspace-owner sign-off has been given for 2.1.0.** The 30 July 2026 sign-off in
  `RELEASE_SIGN_OFF_2.0.md` approved v2.0.0 specifically.

In short: what you see automated (Axe, regression) is current; what requires a human or a live SAP
target (NVDA, live-SAP, sign-off) is still the v2.0.0 evidence and has not been repeated here.

## What shipped since v2.0.0

15 items completed on the 2.1.0 line:

| Item | Title |
| --- | --- |
| BL-012 | Provide stable artifact and run routes |
| BL-018 | Complete the task-focused Automation Overview |
| BL-019 | Add filterable execution value and trend analytics |
| BL-020 | Provide a routeable Test Library |
| BL-021 | Build typed, validated Single Tests |
| BL-022 | Complete the Control Object Repository workbench |
| BL-023 | Complete guided live-screen capture |
| BL-024 | Add selector health, history and governance |
| BL-025 | Provide a routeable Test Data Library |
| BL-028 | Separate Business Processes and Regression Packs |
| BL-029 | Build Processes and Packs visually |
| BL-031 | Complete hierarchical execution monitoring |
| BL-032 | Provide focused failure diagnosis |
| BL-035 | Complete searchable Audit and Evidence history |
| BL-037 | Add global artifact search and dependency impact |

## Scope exclusions for 2.1.0 (formal decision)

- **BL-039** (multi-user roles) — excluded, no confirmed multi-user requirement.
- **BL-040** (scheduling/parallelism) — excluded, isolation for parallel execution not proven.

See `RELEASE_GOVERNANCE_2.1.md` §9.1 for the decision record.

## What is required before this becomes v2.1.0 GA

1. Manual NVDA screen-reader journey across all seven workspaces plus the Global Search overlay.
2. Live-SAP re-verification (read-only + authorised transactional) against this candidate commit.
3. Explicit workspace-owner sign-off of the consolidated 2.1.0 evidence.

Row-by-row checklist for all three: `RELEASE_VERIFICATION_2.1_CHECKLIST.md`. None of the three have
been executed as of this note. No `v2.1.0` git tag exists.
