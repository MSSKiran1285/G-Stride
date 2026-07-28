# SAP S/4HANA Test Automation Studio — Information Architecture Review

## Current navigation model

The application presents a fixed sequence:

1. Automation Overview
2. UI Control Repository
3. Test Step Composer
4. Test Data Matrix
5. Process Suites
6. Execution Engine
7. Audit & Evidence

This sequence is repeated in the sidebar, overview cards, horizontal pipeline tracker, previous/next controls, and workflow footer. All destinations are states inside `/`, not routes.

### Current conceptual mapping

| Current label | Code term | Primary underlying artifact/action |
|---|---|---|
| Automation Overview | `launchpad` | Dashboard and shortcuts |
| UI Control Repository | `objects` | SQLite UI5 object definitions and live capture |
| Test Step Composer | `editor` | JSON test-case files and module steps |
| Test Data Matrix | `data` | CSV datasets |
| Process Suites | `groups` | Ordered JSON Group files |
| Execution Engine | `run` | Ad hoc Chain/Suite/Batch configuration and live results |
| Audit & Evidence | `documents` | Append-only run history and evidence-PDF links |

## Problems with the current model

### The pipeline is not the user’s actual workflow

- Existing objects are often selected while composing rather than captured first.
- Data can be created before or after test steps.
- A tester may run one existing case without visiting the first four stages.
- Failure recovery moves backward from a run to an object, step, or dataset and then forward to a rerun.
- Audit and reporting are destinations, not a final mandatory authoring step.

### Navigation duplicates consume attention

Five versions of the same workflow navigation compete with page content. The repeated step numbering suggests completion state, but “completed” is calculated only from the currently selected view, not actual artifact readiness.

### Artifact and action concepts are mixed

- Objects, tests, data, and Groups are durable artifacts.
- Run is an action and live state.
- Audit is analysis of immutable run records.
- The overview mixes navigation, metrics, templates, sample documents, and assistant content.

### Terminology does not scale

- “Process Suites” edits a `Group`, while Execution also has a “Suite” mode.
- Chain, Suite, and Batch describe runtime isolation/iteration semantics, not necessarily stored artifact types.
- “Documents”, “Audit & Evidence”, “Audit log”, “Run history”, scratch reports, and archived evidence overlap.
- “App ID” is a technical namespace that is exposed without a business application label.

### Context is confused with navigation

The shell’s environment selector appears global but is not authoritative. Project/workspace, active credential profile, target safety class, and capture-agent status are absent.

## Proposed target navigation

Use six stable top-level areas. These labels follow the repository’s capabilities while remaining understandable to non-engineers.

### 1. Overview

Purpose: orientation, verified context, recent work, actionable exceptions, and concise shortcuts.

- Overview
- My recent tests/runs (when identity exists)
- Attention required: failed runs, invalid assets, unavailable services

### 2. Design

Purpose: create and organise executable automation intent.

- Test cases
- Test case detail/composer
- Collections
  - Business process: ordered, dependent tests sharing state (current Group/Chain concept)
  - Regression pack: independent tests (current Suite concept; initially may remain ad hoc)
- Templates

### 3. Data & Objects

Purpose: maintain reusable inputs and captured application controls.

- Object repository
- Capture session
- Datasets
- Data mappings/readiness

“Objects” remains close to Composer through contextual pick/capture actions; its top-level location does not force users to leave the test they are editing.

### 4. Execute

Purpose: configure, validate, start, and monitor runs.

- New execution
- Active runs
- Run monitor
- Reusable execution profiles (future)

Runtime behaviour should be selected in plain language and summarised technically:

- **Dependent process:** shared session/state; ordered; stop on failure.
- **Independent pack:** isolated sessions; continue after individual failure.
- **Batch of processes:** multiple stored business processes, isolated from one another.

Existing API values `chain`, `suite`, and `batch` remain unchanged.

### 5. Analyse

Purpose: investigate outcomes and retrieve trustworthy evidence.

- Run history
- Run detail
- Failure analysis
- Evidence
- Captured business documents
- Reports/trends (future)

Run is the primary entity. Evidence and captured document numbers are facets of a run rather than separate top-level concepts.

### 6. Administration

Purpose: configure authoritative system-level context and policy.

- Environments
- Credential-profile references (never secret values in browser storage)
- Capture agent
- Evidence and retention policy
- Users and roles (future)
- Application settings

This area should not appear as functional until server-backed settings exist. The current decorative environment selector should not be treated as an Administration substitute.

## Proposed hierarchy

```text
Studio
├── Overview
├── Design
│   ├── Test cases
│   ├── Test case detail
│   ├── Collections
│   └── Templates
├── Data & Objects
│   ├── Object repository
│   ├── Capture session
│   ├── Datasets
│   └── Data mappings
├── Execute
│   ├── New execution
│   ├── Active runs
│   └── Run monitor
├── Analyse
│   ├── Run history
│   ├── Run detail
│   ├── Failure analysis
│   ├── Evidence
│   └── Captured documents
└── Administration
    ├── Environments
    ├── Capture agent
    ├── Evidence policy
    └── Users and roles
```

## Route mapping

| Current view/state | Proposed route | Proposed page title | Migration note |
|---|---|---|---|
| `launchpad` | `/overview` | Overview | Root `/` redirects here |
| `editor`, no file | `/design/tests` | Test Cases | Introduce list/empty state around existing editor |
| `editor`, selected file | `/design/tests/:testId` | Test Case | Initially `testId` may encode file basename safely |
| Template card | `/design/tests/new?template=:templateId` | New Test Case | Do not claim preloading until real template exists |
| `groups`, no file | `/design/collections` | Collections | UI name changes; API/files remain Groups |
| `groups`, selected file | `/design/collections/:collectionId` | Collection | Preserve Group JSON contract |
| `objects` browser | `/assets/objects` or `/data-objects/objects` | Object Repository | Final short prefix should be chosen during implementation |
| `objects` active capture | `/assets/objects/capture` | Capture UI5 Objects | Keep capture-session state server-side |
| `data`, no file | `/assets/datasets` | Datasets | Existing CSV API unchanged |
| `data`, selected file | `/assets/datasets/:datasetId` | Dataset | Add dirty-route guard |
| `run`, configuration | `/execute/new` | New Execution | Existing local form can be migrated incrementally |
| `run`, active/completed | `/execute/runs/:runId` | Run Monitor | Re-fetch from run ID after refresh |
| `documents` | `/analyse/runs` | Run History | Uses existing audit-list API |
| unused audit detail API | `/analyse/runs/:runId` | Run Detail | Use `GET /api/audit/runs/:id` |
| evidence link | `/analyse/runs/:runId/evidence` or direct file | Evidence | Direct immutable PDF remains valid |
| none | `/administration/environments` | Environments | Requires new contract; do not implement as static form |
| none | `*` | Page Not Found | Offer navigation and preserve shell |

The exact prefix for “Data & Objects” should optimise URL clarity rather than mirror the display label. `/assets` is recommended because datasets and objects are reusable test assets, but `/data-objects` is more literal.

## Navigation behaviour

### Primary navigation

- One item per top-level area.
- Active area based on URL.
- Collapsible on laptop; modal navigation drawer on narrow screens.
- No numbered completion state.
- Icons supplement text and are never the only label.

### Secondary navigation

- Shown only when an area has multiple sibling destinations.
- Use a local side navigation or compact tabs depending on width.
- Do not repeat Overview shortcuts in secondary navigation.

### Breadcrumbs

Use linked hierarchy rather than simulated step numbers:

```text
Design / Test Cases / Create Purchase Order
Analyse / Runs / Run 8B785BA0
Data & Objects / Object Repository / Manage Purchase Orders
```

On small screens, show the parent plus current page and make the complete trail available through an accessible disclosure.

### Project and environment context

A persistent context region should display:

- Workspace/project name.
- Verified execution environment and safety class.
- Connection status/freshness.
- Capture-agent state when relevant.
- Current user/credential-profile label when supported.

Context must come from the server and be consumed by execution. The context selector should not silently change a live form; changes should revalidate unsaved execution configuration.

### Global versus local actions

| Action | Placement |
|---|---|
| Global search | Shell, after cross-artifact indexing exists |
| New test | Test Cases page header |
| New dataset | Datasets page header |
| Capture objects | Object Repository page header and contextual Object Picker action |
| New collection | Collections page header |
| New execution | Execute area header |
| Save artifact | Sticky local page action area; clearly tied to current artifact |
| Delete artifact | Local overflow/danger zone with impact information |
| Run test/collection | Artifact action and Execute area; always opens reviewed configuration |
| Theme/help/profile | Shell utility area |
| Environment administration | Administration, not a decorative shell-only control |

## Page naming and content guidance

| Current label | Recommended user-facing label | Reason |
|---|---|---|
| Automation Overview | Overview | Short, stable, non-marketing |
| UI Control Repository | Object Repository | “UI5 Objects” may appear as supporting text |
| Test Step Composer | Test Case | Composer is the editor inside the detail page |
| Test Data Matrix | Datasets | Matches CSV artifact and common terminology |
| Process Suites | Collections | Avoids collision with Suite execution mode |
| Group | Business Process initially, or Collection internally | Explain dependent ordered semantics |
| Execution Engine | Execute / New Execution | Focuses on user task |
| Audit & Evidence | Run History | Run is the searchable primary entity |
| Engineer Tools | Help or Diagnostics | Use Help for static guidance, Diagnostics for verified health |

## Role-specific visibility

Current deployment is explicitly single-user/local and has no identity. The matrix below is a target for future capability-based access, not an instruction to add cosmetic role switching.

| Area/action | Test manager | Functional consultant | Automation engineer | Manual/UAT tester | Business analyst | Stakeholder/auditor |
|---|---:|---:|---:|---:|---:|---:|
| Overview | Full | Full | Full | Simplified | Simplified | Reporting-focused |
| Test cases view | Full | Full | Full | Read/comment/run | Read | Read |
| Edit technical steps | Optional | Full | Full | Hidden by default | Read | Hidden |
| Object capture/edit | Read | Full | Full | Hidden | Hidden | Hidden |
| Datasets | Full | Full | Full | Constrained edit | Full | Read |
| Collections | Full | Full | Full | Run/read | Read | Read |
| Configure execution | Full | Full | Full | Approved profiles | Read | Hidden |
| Start side-effecting run | Permission-controlled | Permission-controlled | Permission-controlled | Approved-only | Hidden | Hidden |
| Run history/evidence | Full | Full | Full | Own/assigned | Read | Full |
| Administration | Limited | Hidden | Technical settings | Hidden | Hidden | Retention/read-only |

## Migration considerations

1. **Preserve backend contracts first.** Route and label changes do not require renaming JSON files, API endpoints, `Group`, or run-mode values.
2. **Introduce routing around existing screens.** Extract selected artifact IDs from URL and keep current API calls; avoid rewriting workflow logic simultaneously.
3. **Guard unsaved changes.** Router navigation must incorporate Composer, Data, and Collection dirty state before in-memory navigation is removed.
4. **Provide redirects.** Root redirects to Overview; any temporary query/deep-link format should map to stable routes.
5. **Separate naming migration from storage migration.** Display “Collections” while adapters map to current Group APIs/types.
6. **Do not expose Administration placeholders as working configuration.** Add destinations only when backed by authoritative server data.
7. **Maintain local-workstation support.** Routing must work with Express’s existing SPA catch-all and direct refresh.
8. **Add run detail progressively.** Start with current run status by ID, then use immutable audit detail after completion.
9. **Measure role needs before RBAC.** Use capability-based design tokens/content now, but implement identity/roles only with a real multi-user requirement.
10. **Keep evidence URLs stable.** Existing archived PDF paths remain valid while the surrounding Run Detail experience improves.

## IA acceptance criteria

- Every significant page has a unique, refresh-safe URL and page title.
- Primary navigation has no duplicated pipeline tracker/footer.
- Workspace and target context are server-backed and consistent with execution.
- “Run History” is the primary analysis entry point.
- Group/Chain/Suite/Batch semantics are explained with consistent user terms without changing existing runtime contracts.
- Contextual links connect failed runs to tests, objects, and data.
- All routes work with keyboard navigation, browser Back/Forward, direct entry, and unsaved-change guards.
- Narrow layouts retain access to navigation and context without persistent horizontal page scrolling.
