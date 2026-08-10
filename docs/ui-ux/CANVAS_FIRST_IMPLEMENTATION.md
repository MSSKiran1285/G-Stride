# Canvas First Implementation

**Direction approved:** 28 July 2026
**Brand:** QA/4HANA Studio
**Accent:** Coral
**Primary light-surface text:** Deep navy

## Locked navigation

1. Automation Overview
2. Control Object Repository
3. Compose
4. Test Data
5. Process Suites
6. Execution Center
7. Audit and Evidence

## Slice 1 — Shared shell and Automation Overview

Status: **Implemented and validated**

The persistent shell now uses a single compact navigation list. Redundant step badges, navigation subtitles, engineer-shortcut cards, pipeline tracker, and transition footer were removed. Workflow navigation remains available through the left navigation and contextual Previous/Next actions.

Automation Overview now uses an open Canvas First layout with:

- One primary Create Test action and one secondary New Execution action.
- Real API-backed counts for tests, process suites, controls, and evidence.
- An execution-impact dashboard with actual run totals, passed/failed outcomes, and aggregate runtime.
- Explicitly modeled manual effort, time saved, full automation total cost of ownership (TCO), and potential net cost saved.
- A selectable list of saved test cases.
- A contextual inspector for the selected test.
- Recent immutable execution records.
- An evidence summary that does not expose captured values.
- Truthful loading, empty, unavailable, and unverified-target states.

No server contract or execution behavior changed.

### Execution-impact model

Actual measures come from immutable run-history records:

- Total executions.
- Passed and failed executions.
- Aggregate automation runtime from `startedAt` and `finishedAt`.

The remaining measures are scenario estimates because the run ledger does not contain observed manual duration or financial rates. For each run, estimated manual effort is the larger of:

```text
automation duration × manual slowdown factor
test count × assumed manual minutes per test
```

The manual slowdown factor estimates how much longer a human needs than the recorded automated runtime for the same work. A value of 3 means that 10 automated minutes imply 30 manual minutes. For each run, the model uses the larger of this duration-based estimate and the per-test floor, so short automated runs do not produce implausibly small manual estimates.

Default manual assumptions are 12 manual minutes per test, a 3× slowdown factor, and USD 50 manual labor per hour. Users can adjust every assumption in the dashboard. The displayed lower/upper range is a scenario range, not a statistical confidence interval.

Potential cost saved is:

```text
estimated manual hours × manual hourly cost
minus
runtime + allocated build/setup + maintenance labor + licenses/tooling + fixed infrastructure
+ execution review + failure triage + other period cost
```

Default automation assumptions are USD 2 runtime per hour, USD 75 automation engineering labor per hour, 40 initial build/setup hours amortized over 12 months, 4 maintenance hours per month, USD 100 licenses/tooling per month, USD 50 fixed infrastructure per month, 3 review minutes per execution, 15 triage minutes per failed run, and USD 0 other period cost.

The dashboard derives the billing months represented by the run-history period (minimum one month when runs exist), allocates build/setup cost across the configured amortization period, and presents every cost component in a visible breakdown. Test design, training, migration, governance, security, procurement, vendor support, or other applicable costs can be entered in the catch-all period cost.

Potential cost saved is the plausible manual cost minus full automation TCO. A negative result is shown as a cost gap and explicitly indicates that the automation investment has not yet been recovered. These defaults are planning placeholders, not accounting or ROI guarantees; they must be replaced with the organization's actual commercial and labor inputs.

## Validation

```text
npm run build
npm run lint --workspace=@taf/studio-web
npm run test:ui:isolated
```

Result: 11 UI tests passed, 3 execution/live tests intentionally skipped, 0 failed. Frontend lint retains one pre-existing Fast Refresh warning in `ObjectPicker.tsx`.

## Remaining screen slices

1. Control Object Repository
2. Compose
3. Test Data
4. Process Suites
5. Execution Center
6. Audit and Evidence

Each screen should reuse the new shell and Canvas First patterns while preserving existing business behavior, protected-data boundaries, and execution safety.
