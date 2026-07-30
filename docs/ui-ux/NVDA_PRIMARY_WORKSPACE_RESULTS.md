# NVDA primary-workspace verification

Date: 29 July 2026  
Screen reader: NVDA 2026.1.1 portable, verified official SHA-256 `6e0289eb5a3aa076eb97ea99c5d5465cb48b5ecc6a3257dc3d811f881a1747c9`  
Browser: Google Chrome 150.0.7871.115, headed  
Data: isolated synthetic workspace; no live SAP execution  
Raw speech log: `regression/results/nvda/primary-workspaces-2026-07-29.log`

## Result

All seven primary workspaces passed the recorded screen-reader journey. NVDA:

- announced the “Skip to main content” link;
- moved to and announced the main landmark;
- announced the workspace heading and hierarchy;
- announced form labels, roles, values, states and availability;
- exposed the first actionable control after main focus.

| Workspace | NVDA speech evidence | Result |
| --- | --- | --- |
| Automation Overview | Main landmark; “Good morning” level-1 heading; Create test/New execution buttons; actual/modeled execution metrics and selected-test details | Pass |
| Control Object Repository | Main landmark; level-1 workspace heading; SAP page URL and App ID edits; Open scan session button; object-domain combo box | Pass |
| Compose | Main landmark; level-1 workspace heading; Open test case menu button; new test-case name edit and Create action | Pass |
| Test Data | Main landmark; level-1 workspace heading; Open dataset menu; format/name/column controls; relational CSV builder and validation actions | Pass |
| Process Suites | Main landmark; level-1 workspace heading; Open group menu; new group file-name edit and Create action | Pass |
| Execution Center | Main landmark; level-1 workspace heading; controlled-run level-2 heading; four preparation steps; execution types, inputs, policies and Run preflight action | Pass |
| Audit and Evidence | Main landmark; level-1 and level-2 headings; immutable-record summary; governance; search/filter controls; selected record and canonical Evidence PDF link | Pass |

The paced headed run also passed:

- Axe serious/critical: 0 findings;
- skip navigation and keyboard entry: all seven workspaces;
- 320 CSS-pixel reflow: all seven workspaces.

## Observations

The first unpaced run exposed a real Chrome-only 6-pixel overflow in Execution Center. The root application width was changed from `100vw` to `100%`, and the paced NVDA/Chrome rerun passed.

The raw NVDA input/output log contains transient IAccessible/COM warnings when Playwright closes short-lived Chrome windows. They occur after usable spoken output has been produced and are not application accessibility failures. The final result is based on the recorded workspace announcements and the green browser assertions, not on an absence of tool teardown warnings.

## Verification signature

Verification executor: `/s/ OpenAI Codex`  
Role: test execution and evidence consolidation agent  
Decision: Pass for recorded NVDA/Chrome workspace coverage  
Limitation: this is a sighted-developer speech-log review, not an independent blind-user usability study.
