# SAP S/4HANA Test Automation Studio — UI/UX Inventory

## Scope and verification status

This inventory is based on static inspection of `packages/studio-web`, the Express routes used by it in `packages/studio-server`, shared domain code, project briefs, and regression tests. The TypeScript and Vite production build passed on 27 July 2026. The application was not connected to a live SAP tenant and protected SQLite stores were not opened for this audit, so runtime behaviour, visual rendering, responsive layouts, and live execution are marked as unverified where relevant.

The frontend is one React application at `/`. It has no URL router; `App.tsx` swaps seven in-memory views. The “route” values below are therefore proposed audit identifiers, not currently addressable URLs. Refreshing or opening a link always returns to the overview.

## Frontend architecture inventory

| Area | Current implementation | Primary files | Assessment |
|---|---|---|---|
| Entry point | React 19 root rendered in `StrictMode` | `packages/studio-web/src/main.tsx` | One frontend entry point |
| Navigation | Local `view` state with seven values | `packages/studio-web/src/App.tsx` | No deep links, history, or route guards |
| State | Component-local `useState`, `useEffect`, `useMemo`, and refs | `App.tsx`; all screen components | Appropriate for small isolated forms, but no shared project/environment/session model |
| API client | Typed wrapper over relative `fetch` calls | `packages/studio-web/src/api.ts` | Central endpoint list; no cancellation, timeout, auth, schema validation, or global error policy |
| Types | Browser-local interfaces mirroring server/core models | `packages/studio-web/src/types.ts` | Type-safe at compile time but contracts can drift |
| Styling | One global CSS file with variables, light/dark themes, shell and overview rules | `packages/studio-web/src/index.css` | Token seed exists; many classes used by functional screens have no current definition |
| Icons | Lucide React | Root `package.json`; `App.tsx`; `AutomationOverview.tsx` | Useful consistent set, but dependency is owned by the wrong workspace |
| Forms | Native inputs, selects, checkboxes, buttons, and custom pickers | Screen components | No form library or common validation model |
| Tables | Native tables, usually inside `.table-wrap` | Composer, data, objects, execution, audit | No grid library; suitable at current scale but limited sorting, filtering, keyboard support, and responsive behaviour |
| Charts | CSS bars and metric cards only | `AutomationOverview.tsx` | No chart library |
| Error boundary | View-level class component | `components/ErrorBoundary.tsx` | Prevents a blank content view; does not catch event-handler or asynchronous errors |
| Server | Express REST API, static web/report/evidence hosting | `packages/studio-server/src/server.ts` | Local single-user architecture; unauthenticated |
| Execution | Server spawns the CLI and frontend polls run status | `studio-server/src/runs.ts`; `RunPanel.tsx` | Preserves one execution path; no run cancellation in UI |
| Capture | Long-lived visible Playwright browser session | `studio-server/src/scanSession.ts`; `ObjectScanner.tsx` | Separate interactive workload with local-session assumptions |
| Storage | JSON test/group files, CSV data, SQLite objects/tags/documents/audit | `studio-server/src/server.ts`; `packages/core/src/domain/*` | File/database-backed local workstation model |
| Tests | Node test runner plus Playwright UI helpers | `regression/api`; `regression/ui` | End-to-end oriented; no component, visual, or accessibility suite |

## Screen inventory

### S01 — Automation Overview

- **Current route/URL:** `/` with `view="launchpad"`; proposed stable route `/overview`.
- **User purpose:** Orient to the product, inspect high-level activity, launch a workflow area, or start from a process template.
- **Primary users:** Test manager, automation engineer, functional consultant, stakeholder.
- **Main actions:** Open composer, execution, object capture, audit evidence, or a hard-coded process template; search templates.
- **Important components:** Application shell, metric cards, workflow cards, process-template cards, assistant insights, captured-document feed.
- **Data source:** `GET /api/app-ids`, `/api/objects/:appId`, `/api/documents`, and `/api/audit/runs`; several values and fallback records are hard-coded.
- **Loading state:** Metric values show `...`; no labelled busy state or skeleton.
- **Empty state:** Replaces absent records with realistic sample counts and business document numbers rather than a truthful empty state.
- **Error state:** API failures are swallowed per request and replaced by fallback data; only a console error is possible for an outer failure.
- **Responsive behaviour:** Stats collapse at 1024px; overview columns at 1100px; card grids at 900px. Narrower phone layout is not defined.
- **Accessibility concerns:** Clickable cards are non-interactive `div` elements; no keyboard activation or accessible role/name. Search has no programmatic label. Motion has no reduced-motion alternative.
- **Suspected usability issues:** Operational-looking sample data can be mistaken for real audit information; “Use Template” only passes a transaction code and does not construct a preloaded test sequence; dashboard density is high and heavily engineer-oriented.

### S02 — UI Control Repository

- **Current route/URL:** `/` with `view="objects"`; proposed stable route `/design/objects`.
- **User purpose:** Browse saved UI5 objects, open a live SAP page, capture or pick controls, curate names, edit/reorder/delete objects, and visually highlight them.
- **Primary users:** Automation engineer, SAP functional consultant.
- **Main actions:** Choose domain/App ID, filter objects, edit metadata, delete/reorder, open/close scan session, capture all controls, pick individual controls, save curated controls.
- **Important components:** `ObjectScanner`, `ObjectBrowser`, `CurationList`, `DomainTag`.
- **Data source:** Object, tag, process-area, and scan APIs; scanner state is partly server-side and App ID is restored from `localStorage`.
- **Loading state:** Buttons use `busy` labels/disabled states; object/tag loads have no skeleton or explicit initial loading indicator.
- **Empty state:** Raw scan and browser tables provide contextual messages; no first-use onboarding for an empty repository.
- **Error state:** Inline raw error strings; highlight failures are reduced to “not found”.
- **Responsive behaviour:** Tables can scroll horizontally, but the scan toolbar and multi-column curation table have no dedicated narrow layout.
- **Accessibility concerns:** Reordering is pointer drag-only; curation is a very wide table; live pick/highlight changes are not announced; radio selection lacks an explicit text label; URL and App ID labels are placeholder-only.
- **Suspected usability issues:** Scan, browse, edit, pick, curate, and raw-inspection functions compete on one long page; “Close session” consequence is not explained; App ID remains technical and manually typed.

### S03 — Test Step Composer

- **Current route/URL:** `/` with `view="editor"`; proposed stable routes `/design/tests` and `/design/tests/:file`.
- **User purpose:** Create/open a test case, define its name/domain, compose and reorder executable steps, select objects, and save.
- **Primary users:** Automation engineer, functional consultant, advanced manual tester.
- **Main actions:** Open/create a test file, tag domain, add/edit/remove/reorder steps, select module/object parameters, save.
- **Important components:** `TestCaseEditor`, `StepEditor`, `TableRowsEditor`, `ObjectPicker`, `GroupedPicker`, `DomainTag`.
- **Data source:** Test-case, module, object, group, tag, and process-area APIs.
- **Loading state:** No explicit loading state while files, modules, groups, preceding test cases, and objects load.
- **Empty state:** New test starts with an empty steps table but lacks a task-focused first-step prompt.
- **Error state:** One page-level raw error string; field validation is minimal.
- **Responsive behaviour:** Wide six-column steps table and parameter grids have no screen-specific breakpoints.
- **Accessibility concerns:** Step reordering is drag-only; table action buttons repeat without row-specific accessible names; labels are not associated via `htmlFor`; custom pickers have incomplete keyboard/ARIA behaviour.
- **Suspected usability issues:** “Template active” implies preloading although no sequence is created; default App ID is inferred from the first step with an App ID; file names are exposed as primary identities; parameter syntax and hand-off tokens demand substantial technical knowledge.

### S04 — Test Data Matrix

- **Current route/URL:** `/` with `view="data"`; proposed stable routes `/data/datasets` and `/data/datasets/:file`.
- **User purpose:** Create/open CSV datasets and edit rows, scalar values, lists, or nested line-item data.
- **Primary users:** Automation engineer, functional consultant, business analyst, data-focused tester.
- **Main actions:** Open/create dataset, enter column names, tag domain, add/remove rows, change cell editing mode, save.
- **Important components:** `DataEditor`, `ListCell`, `TableRowsEditor`, `GroupedPicker`, `DomainTag`.
- **Data source:** Dataset, tag, and process-area APIs.
- **Loading state:** No explicit file/dataset loading indicator.
- **Empty state:** “No rows yet” with an add-row action nearby.
- **Error state:** One raw inline error; no per-cell or schema validation.
- **Responsive behaviour:** Horizontal table scrolling only; nested row editors can require at least 20rem inside a cell.
- **Accessibility concerns:** Icon-character buttons depend on `title`; cell context is hard to perceive with assistive technology; delete actions have no confirmation or undo.
- **Suspected usability issues:** No dirty-state protection; column names cannot be edited after creation; nested JSON/list concepts are hidden behind unexplained glyphs; large datasets have no pagination, virtualization, import preview, or bulk editing.

### S05 — Process Suites

- **Current route/URL:** `/` with `view="groups"`; proposed stable routes `/design/suites` and `/design/suites/:file`.
- **User purpose:** Create/open an ordered business-process group, assign an App ID and data file, and select ordered test cases.
- **Primary users:** Automation engineer, test manager, SAP functional consultant.
- **Main actions:** Open/create group, set title/domain/App ID/data file, add/remove/reorder test cases, save.
- **Important components:** `GroupEditor`, `FileChainPicker`, `GroupedPicker`, `DomainTag`.
- **Data source:** Group, test-case, dataset, tag, and process-area APIs.
- **Loading state:** No explicit loading state.
- **Empty state:** Available/selected lists explain when empty, but there is no guidance on Chain/Suite/Batch relationship here.
- **Error state:** Page-level raw error; validates only presence of a selected test case in the UI, while the server additionally requires App ID.
- **Responsive behaviour:** Two-column picker has no narrow breakpoint.
- **Accessibility concerns:** Move buttons use arrow glyphs without item-specific accessible names; list semantics do not expose reorder feedback; labels are not explicitly associated.
- **Suspected usability issues:** “Group”, “suite”, “chain”, and “batch” overlap conceptually; App ID and data-file scope are not explained at point of use; no duplicate/copy workflow.

### S06 — Execution Engine

- **Current route/URL:** `/` with `view="run"`; proposed routes `/execute`, `/execute/new`, and `/execute/runs/:id`.
- **User purpose:** Configure Chain/Suite/Batch execution, start it, monitor status, inspect failures, screenshots, captured values, evidence, and log tail.
- **Primary users:** Automation engineer, test manager, functional consultant.
- **Main actions:** Choose mode and members, set App ID/data/headless/evidence options, run, monitor, open evidence PDF.
- **Important components:** `RunPanel`, `FileChainPicker`, `CompletionBanner`, result tables, evidence gallery.
- **Data source:** Test-case, group, dataset, and run APIs; polling every two seconds.
- **Loading state:** “Running”, “waiting for first…” messages, and disabled Run button; no determinate progress, queue position, elapsed time, or cancel action.
- **Empty state:** Member picker explains empty selection; no run-history landing state.
- **Error state:** Start errors inline; polling does not catch request failures; failure log displays the final 4,000 characters.
- **Responsive behaviour:** Multiple wide tables and evidence images; no execution-specific narrow layout.
- **Accessibility concerns:** Mode switch is visually a tab set but has no tab semantics; live run updates are not announced; status banners have no live region; result tables lack captions; focus does not move to failure.
- **Suspected usability issues:** Run can create real SAP documents without a target summary or confirmation; the shell environment selector is disconnected from execution; default App ID may be wrong; failure investigation is embedded below configuration and difficult to scan.

### S07 — Audit & Evidence

- **Current route/URL:** `/` with `view="documents"`; proposed routes `/analyse/runs` and `/analyse/runs/:id`.
- **User purpose:** Search immutable run history and open archived evidence PDFs.
- **Primary users:** Test manager, auditor, automation engineer, programme stakeholder.
- **Main actions:** Filter by App ID/status, expand date groups, open evidence.
- **Important components:** `DocumentsPanel`, nested native `details`, run table.
- **Data source:** `GET /api/audit/runs`; the full-entry endpoint exists but is unused by the UI.
- **Loading state:** Search button changes to “Loading”; prior results remain present and no region is marked busy.
- **Empty state:** “No runs recorded yet.”
- **Error state:** Raw inline API error.
- **Responsive behaviour:** Horizontal table scrolling; nested indentation reduces available width.
- **Accessibility concerns:** No page heading; filter labels are placeholders; status and results updates are not announced; table has no caption; evidence opens a new tab without visible indication.
- **Suspected usability issues:** Navigation calls this “Audit & Evidence” while component copy says “Audit log” and the code name says “Documents”; no on-screen run details, comparison, export, saved filters, or link back to the originating test.

## Application-shell inventory

| Element | Current purpose | Data/state | Key concerns |
|---|---|---|---|
| Left navigation | Select overview or one of six numbered workflow stages | Local `view` state | Assumes a linear sequence; labels are long and technical |
| Collapse control | Reduce sidebar width | Local state | Icon-only collapsed navigation relies on `title`; state is not persisted |
| Breadcrumb | Repeats app, step number, and current label | Derived from local view | Not linked to URLs and uses clickable `span` |
| Environment selector | Appears to select DEV/QA/Cloud target | Local `sapEnv` only | Does not affect APIs or execution; presents unsafe false confidence |
| Engineer Tools drawer | Displays matcher health, tokens, and SAP response examples | Hard-coded | No dialog/drawer semantics, focus trap, Escape handling, or verified data |
| Pipeline tracker | Repeats six stages and allows navigation | Derived from local view | Clickable `div` elements; duplicated navigation; horizontally scrolls |
| Workflow footer | Repeats previous/next navigation and compliance statement | Derived/hard-coded | Compliance and engine claims are not runtime-derived; consumes vertical space |
| Theme control | Switch light/dark CSS mappings | Local state; `data-theme` | No persistence or OS preference initialization |

## Reusable-component inventory

| Component | File | Current purpose | Screens using it | Genuinely reusable? | Duplication/inconsistency | Recommended action |
|---|---|---|---|---|---|---|
| `App` shell | `src/App.tsx` | Shell, navigation, theme, environment, drawer, view switching | All | Partly | Shell mixes verified controls with hard-coded assistant/demo content | Split shell, navigation model, context selector, and help drawer after IA approval |
| `AutomationOverview` | `components/AutomationOverview.tsx` | Dashboard and launchpad | Overview | No | Repeats shell navigation; mixes data, fallback samples, and marketing content | Keep screen-specific; replace fallback data with explicit states |
| `ObjectScanner` | `components/ObjectScanner.tsx` | Scan-session orchestration and page composition | Objects | No | Combines session toolbar, browser, capture, pick, and raw output | Split into session controller and capture results without changing API behaviour |
| `ObjectBrowser` | `components/ObjectBrowser.tsx` | Browse/edit/delete/reorder saved objects | Objects | Mostly screen-specific | Reimplements async/error/action patterns | Extract only common table toolbar/status patterns |
| `CurationList` | `components/CurationList.tsx` | Group and save discovered controls | Objects | Yes within capture flows | Very wide table; imperative `saveAll` contract | Preserve shared capture use; redesign responsive row layout and accessible actions |
| `TestCaseEditor` | `components/TestCaseEditor.tsx` | Test-file lifecycle and steps table | Composer | No | Reimplements file open/create/tag/save patterns also found in Data and Groups | Extract an artifact-header pattern after workflows are validated |
| `StepEditor` | `components/StepEditor.tsx` | Schema-driven module parameter form | Composer | Yes within composition | Validation and help are ad hoc | Keep schema-driven core; add field metadata, validation summary, and accessible grouping |
| `TableRowsEditor` | `components/TableRowsEditor.tsx` | Edit dynamic table-row JSON or placeholder | Composer, Data via `ListCell` | Yes | Glyph-only actions and state initialized only on mount | Retain; add synchronized value handling, explicit labels, keyboard-safe actions |
| `ObjectPicker` | `components/ObjectPicker.tsx` | Editable, filtered object combobox | Composer, table-row editor | Yes | Custom combobox has no ARIA combobox/listbox semantics | Promote to design-system combobox and complete APG keyboard/ARIA contract |
| `DataEditor` | `components/DataEditor.tsx` | Dataset lifecycle and table editing | Data | No | Repeats artifact lifecycle UI | Keep screen-specific; share artifact shell and async states |
| `ListCell` | `components/ListCell.tsx` | Switch scalar/list/rows representation | Data | Yes within data tables | Unexplained symbols and hidden mode change | Retain behaviour; replace glyphs with labelled menu/segmented control |
| `GroupEditor` | `components/GroupEditor.tsx` | Group lifecycle and configuration | Suites | No | Repeats artifact lifecycle UI | Keep workflow; share artifact shell and validation primitives |
| `FileChainPicker` | `components/FileChainPicker.tsx` | Filter, select, order, and remove files/groups | Suites, Execution | Yes | Reorder controls have weak accessible names and no bulk actions | Promote to shared ordered-transfer component |
| `GroupedPicker` | `components/GroupedPicker.tsx` | Grouped file/module selection | Composer, Data, Suites, Step Editor | Yes | Clickable `div` tree lacks full keyboard/ARIA behaviour | Replace with an accessible grouped combobox/tree pattern |
| `DomainTag` | `components/DomainTag.tsx` | Edit process-area tag and reuse known values | Objects, Composer, Data, Suites | Yes | Errors are swallowed; text input plus buttons behaves inconsistently | Retain shared API; add error state, label contract, combobox/chip semantics |
| `RunPanel` | `components/RunPanel.tsx` | Configure, start, poll, and display runs | Execution | No | Configuration, monitoring, results, and failure analysis are one component | Split by state into configuration, live monitor, summary, and failure detail |
| `CompletionBanner` | Inside `RunPanel.tsx` | Summarise run state and evidence link | Execution | Potentially | Not exported; missing live-region semantics | Extract as shared `RunStatusBanner` |
| `DocumentsPanel` | `components/DocumentsPanel.tsx` | Filter and list audit runs | Audit | No | Naming differs between code/navigation/content | Rename conceptually to Run History during IA migration |
| `ErrorBoundary` | `components/ErrorBoundary.tsx` | Recover from render errors | Every view | Yes | Raw error message; retry only clears boundary state | Keep; add safe support text, reset callback, logging hook, and accessible alert |

## API and server integration inventory

| Capability | Frontend methods | Server endpoints | Persistence/side effects |
|---|---|---|---|
| Modules | `listModules` | `GET /api/modules` | Engine registry, read-only |
| Test cases | list/get/save | `GET/PUT /api/testcases` | Reads/writes JSON under `testcases` |
| Groups | list/get/save | `GET/PUT /api/groups` | Reads/writes JSON under `testgroups` |
| Data | list/get/save | `GET/PUT /api/data` | Reads/writes CSV under `data` |
| Tags | list/set/process areas | `GET/PUT /api/tags`; `GET /api/process-areas` | SQLite tag store |
| Objects | list/save/rename/delete/reorder | `GET/PUT/DELETE /api/objects` | SQLite object repository |
| Scan session | open/status/capture/close/highlight/pick | `/api/scan/*` | Launches and controls visible Playwright browser state |
| Execution | start/get | `POST /api/runs`; `GET /api/runs/:id` | Spawns CLI; can create SAP records, reports, screenshots, and audit entries |
| Documents/audit | list documents/runs/get run | `GET /api/documents`; `GET /api/audit/runs` | Reads SQLite document and append-only run stores |

## Inventory counts

- **Frontend entry points:** 1.
- **Logical screens:** 7.
- **Application-shell regions:** 7 significant regions.
- **Component source files:** 17 under `src/components`.
- **Reusable or potentially reusable components:** 10.
- **Frontend API methods:** 31.
- **Express API route handlers used or available to the frontend:** 31, plus static report/evidence hosting.
- **Dedicated settings, authentication, project/workspace, notification-centre, or route-not-found screens:** 0.
