# QA/4HANA Studio 2.0 accessibility and release verification

Date: 29 July 2026  
Backlog item: BL-017  
Current decision: complete and signed; BL-041 technical hold cleared and QA/4HANA Studio 2.0 approved for GA on 30 July 2026

## Automated accessibility result

The isolated Chromium suite validates every primary workspace:

| Workspace | Route | Axe serious/critical | Skip link and keyboard entry | 320 CSS px reflow |
| --- | --- | --- | --- | --- |
| Automation Overview | `/` | Pass | Pass | Pass |
| Control Object Repository | `/objects` | Pass | Pass | Pass |
| Compose | `/compose` | Pass | Pass | Pass |
| Test Data | `/data` | Pass | Pass | Pass |
| Process Suites | `/process-suites` | Pass | Pass | Pass |
| Execution Center | `/execute/new` | Pass | Pass | Pass |
| Audit and Evidence | `/audit-evidence` | Pass | Pass | Pass |

`npm run test:accessibility` passed 3/3 checks:

- Axe reported no serious or critical violations using WCAG 2.0 A/AA, 2.1 A/AA and 2.2 AA tags.
- The skip link received first focus, moved focus to each workspace main region and exposed the next interactive control within that region.
- All seven workspaces rendered without horizontal document overflow at 320 CSS pixels. This is the layout equivalent of a 640-pixel browser viewport at 200% zoom.

The scan caused three product corrections:

- the execution-outcome graphic now has a valid image role for its accessible label;
- active coral and disabled-control states now meet contrast requirements;
- the exact `/audit-evidence` workspace route no longer conflicts with the protected evidence-file mount.

No Axe rule was suppressed or added to an exception list.

## Automated release evidence

| Gate | Command | Result |
| --- | --- | --- |
| Build and typecheck | `npm run build` | Pass |
| Typecheck/lint gate | `npm run lint` | Pass |
| Repository secret scan | `npm run test:secrets` | Pass — 252 non-ignored files |
| Isolated API regression | `npm run test:api:isolated` | Pass — 28 passed, 4 approved live-only skips |
| Isolated browser regression | `npm run test:ui:isolated` | Pass — 32 passed, 4 approved live-only skips |
| Focused accessibility regression | `npm run test:accessibility` | Pass — 3 passed |

The live-only skips are deliberate authorization boundaries. This accessibility verification did not initiate a new SAP transaction. The separate BL-041 record now includes the previously approved headed P2P/O2C evidence and the authorised negative remediation pass; see `RELEASE_SIGN_OFF_2.0.md`.

## NVDA journey record

NVDA 2026.1.1 was run with headed Google Chrome 150 against the isolated synthetic workspace. The official installer checksum was verified before creating a disposable portable copy. Spoken output was recorded at NVDA input/output log level and reviewed against the expected landmarks, labels, roles, values and states.

| Workspace | Required journey | Status |
| --- | --- | --- |
| Automation Overview | Page hierarchy, summary metrics, recent work, impact model and first action | Pass |
| Control Object Repository | Scan form, target context, object filters and first action | Pass |
| Compose | Workspace hierarchy, test selector, new-test fields and first action | Pass |
| Test Data | Dataset selector, creation controls, relational builder and validation actions | Pass |
| Process Suites | Process selector, creation controls and first action | Pass |
| Execution Center | Type, inputs, policies, preparation steps and preflight action | Pass |
| Audit and Evidence | Summary, governance, search/filters, run record and canonical PDF link | Pass |

Detailed evidence and limitations are recorded in `NVDA_PRIMARY_WORKSPACE_RESULTS.md`; the raw speech transcript is `regression/results/nvda/primary-workspaces-2026-07-29.log`.

## Sign-off

| Approval | Owner | Status |
| --- | --- | --- |
| Accessibility / NVDA | Verification executor and workspace owner | Signed |
| Security and secret-scan evidence | Verification executor and workspace owner | Signed |
| Approved live SAP evidence | Verification executor and product/test owner | Signed |
| Release decision | Product owner / release owner | QA/4HANA Studio 2.0 approved for GA |

BL-017 has all 3 acceptance criteria complete. Workspace owner Sathyanarayanan Kiran signed the consolidated evidence on 29 July 2026 at 21:18:11 +05:30. BL-041 and BL-038 subsequently completed on 30 July 2026, and the owner explicitly approved QA/4HANA Studio 2.0 for General Availability.
