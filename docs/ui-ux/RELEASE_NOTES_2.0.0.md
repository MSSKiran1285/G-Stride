# QA/4HANA Studio 2.0.0 — release notes

**Status:** Signed and released for General Availability
**Tag / commit:** `v2.0.0` → `fb4bd49`
**GA approved:** 30 July 2026, 08:00:18 +05:30, by workspace owner Sathyanarayanan Kiran
**Full evidence:** `RELEASE_SIGN_OFF_2.0.md`, `ACCESSIBILITY_RELEASE_VERIFICATION.md`, `NVDA_PRIMARY_WORKSPACE_RESULTS.md`

## Accessibility

Accessibility was fully verified for this release:

- Axe automated scan: zero serious/critical findings across all seven primary workspaces.
- Keyboard skip-link, focus and first-control journeys: pass across all seven workspaces.
- **Manual NVDA 2026.1.1 screen-reader journey** (headed Chrome 150, official checksum-verified
  installer): pass across all seven workspaces, with spoken landmarks, headings, labels, roles,
  values and states recorded in `NVDA_PRIMARY_WORKSPACE_RESULTS.md`.
- 320 CSS-pixel / 200%-zoom-equivalent reflow: pass across all seven workspaces.
- Light/dark contrast regression: pass.

This is the only release to date with a completed manual NVDA journey and live-SAP re-verification —
see the 2.1.0 notes below for what has and has not been refreshed since.

## What shipped

The 24-item 2.0.0 baseline, all Implemented and verified at the GA commit:

| Item | Title |
| --- | --- |
| BL-001 | Show verified execution context |
| BL-002 | Review execution impact before Start |
| BL-003 | Use truthful dashboard states |
| BL-004 | Restrict local Studio exposure |
| BL-005 | Restore functional workspace styling |
| BL-006 | Preserve correct UI encoding |
| BL-007 | Protect unsaved artifact work |
| BL-008 | Provide baseline keyboard and screen-reader support |
| BL-009 | Run isolated frontend regression tests |
| BL-010 | Recover live monitoring connections |
| BL-011 | Consolidate design tokens and workspace primitives |
| BL-013 | Complete the responsive application shell |
| BL-014 | Provide authoritative workspace and environment context |
| BL-015 | Standardise async and feedback states |
| BL-016 | Upgrade complex pickers, ordering and tables |
| BL-017 | Pass accessibility and production release verification |
| BL-026 | Author nested and relational transaction data |
| BL-027 | Map, preview and snapshot effective execution data |
| BL-030 | Complete authoritative preflight and execution review |
| BL-033 | Rerun safely with lineage and explicit differences |
| BL-034 | Secure canonical evidence and provenance |
| BL-036 | Secure identity, target and integration administration |
| BL-038 | Protect compatibility, migration and execution correctness |
| BL-041 | Close authoritative Chain, Suite and Batch validation |

## Release evidence summary

| Gate | Result |
| --- | --- |
| Build, typecheck, lint | Pass |
| Repository secret scan | Pass — 251 non-ignored files (frozen release set) |
| Core regression | Pass — 57 tests |
| Isolated API regression | Pass — 28 tests, 4 intentionally live-gated |
| Isolated UI regression | Pass — 32 tests, 4 intentionally live-gated |
| Live-SAP read-only (Chain/Suite/Batch) | Pass |
| Live-SAP positive transactional (P2P, O2C) | Pass — runs `d55cd0f0…`, `4b4f15d7…` |
| Live-SAP authorised negative transactional | Pass — run `299669f8…`, after explicit owner authorisation |

## Known scope exclusions

- **BL-039** (multi-user roles) and **BL-040** (scheduling/parallelism) were out of scope for 2.0.0
  by design — single-owner product decision.

Full detail, signatures and evidence links: `RELEASE_SIGN_OFF_2.0.md`.
