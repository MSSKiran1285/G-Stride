# G-Stride — handover

Paste this whole file to Claude Code as the opening prompt on a new machine. It is written to be
read by an agent picking the work up cold, and by a human doing the setup.

---

## 1. What this project is

**G-Stride** is a SAP S/4HANA test automation platform: capture UI controls from a live Fiori app
into an object repository, compose Tests from reusable modules against those controls, group them
into Processes and Packs, execute them against a real tenant, and produce signed compliance
evidence.

It is a **fork of QA/4HANA Studio**, rebranded. That matters constantly:

| Remote | URL | Use |
|---|---|---|
| `gstride` | `https://github.com/MSSKiran1285/G-Stride.git` | **This is the one to push to.** |
| `origin` | `https://github.com/MSSKiran1285/sap-s4hana-studio-ui-redesign.git` | The **parent** product. Do **not** push G-Stride work here. |

The local branch tracks `origin/main` for historical reasons. **Always push explicitly:
`git push gstride main`.**

---

## 2. Setting up on a new machine

### Prerequisites
- **Node ≥ 20** (developed on v24.11.1, npm 11.6.2)
- **Git**
- Windows is the developed-on platform. The repo has PowerShell and Bash tooling; either works.

### Steps

```bash
git clone https://github.com/MSSKiran1285/G-Stride.git
cd G-Stride

# Installs all workspaces AND downloads the Playwright Chromium build via postinstall.
# This step needs network access and takes a few minutes.
npm install

# tsc -b across every package, then the Vite build for the web app
npm run build

# Start Studio. The default port is 4500 — pass --port for anything else.
node packages/cli/dist/index.js studio --port 3000
```

Then open `http://127.0.0.1:3000`.

### Corporate TLS interception (Zscaler) breaks `npm install`

On a machine behind Zscaler (the owner's work PC), `npm install` fails to fetch
**better-sqlite3**'s prebuilt binary, because the TLS interception breaks the download. This is
not optional to work around: `better-sqlite3` is a hard, top-level `import` in five core modules
with no fallback path —

```
packages/core/src/domain/dataColumnSchema.ts
packages/core/src/domain/documentLog.ts
packages/core/src/domain/objectRepository.ts
packages/core/src/domain/runHistoryStore.ts
packages/core/src/domain/tagStore.ts
```

— so nothing that touches the object repository, run history, tags, documents or data-column
schema will even load. The **same wall blocks the Playwright Chromium download**, which the
`postinstall` hook runs.

Fix either way:

```bash
# Point Node at the Zscaler root certificate
export NODE_EXTRA_CA_CERTS=/path/to/zscaler-root.crt
# …or, on Node 22+, trust the OS certificate store
export NODE_OPTIONS=--use-system-ca
```

Not an issue on a machine outside the interception — verified working there on Node v24.11.1
with better-sqlite3 11.10.0 and the Chromium build present.

### What does NOT come across with the clone

`.studio/` is **gitignored** and holds machine-local state, including
`credentials.enc.json` and `credential-key`. On a new machine:

- **You must re-enter the SAP connection in Settings** — target URL, username, password. There is
  no way to copy the encrypted store across, and it is not in the repo by design.
- Nothing will run against a tenant until that is done and the target's safety class is set.
- `audit-evidence/`, `reports/` and `regression/results/raw/` are also gitignored, so historical
  evidence does not travel. That is deliberate.

### Verify the setup

```bash
npm run test:ui:isolated
```

Expected today: **68 tests — 53 pass, 0 fail, 15 skipped.** The harness starts its own server on
port 4500 with an isolated workspace, so it does not touch your real data. If port 4500 is already
taken by a Studio instance, stop it first.

---

## 3. Layout

```
packages/
  core/           domain types, execution plan, tag store, run history
  engine/         modules (the verbs: ClickButton, EnterHeaderField, Wait, …) + registry
  adapter-fiori/  ui5Inspector — the live control capture pipeline
  studio-server/  Express API + scan sessions
  studio-web/     React UI (Vite)
  cli/            `studio`, `run`, `suite`, `batch`
  reporting/      evidence PDF generation
regression/       node:test + Playwright suites; run-isolated-ui.js is the main one
docs/ui-ux/       PRODUCT_BACKLOG_TRACKER.html is the live backlog
testcases/  data/  testgroups/   the workspace's real artefacts (tracked in git)
```

---

## 4. Conventions and constraints that are in force

These are not preferences. Several were set explicitly by the owner.

- **Push only when told to.** Commit freely; never push unprompted.
- **Live transactional tests** (`REGRESSION_LIVE_TRANSACTIONAL=1`) need **explicit owner
  authorisation before each run**. They write to a real SAP tenant.
- **Never modify `audit-evidence/`.** It holds signed, frozen evidence. `v2.0.0` evidence in the
  parent line is frozen and must not be touched.
- **Credentials resolve from system context or the encrypted store — never from CSV test data.**
- The release manifest (`scripts/generate-release-manifest.mjs`) **fails closed**: recorded runs
  must be commit-matched, source-tree-clean and zero-failure.
- **Verify before claiming.** This codebase has repeatedly punished assumption. Measure the
  rendered result, re-read the value back through the API, run the suite.

### Traps this repo has actually sprung

1. **PowerShell mangles source files.** `Get-Content -Raw` + `Set-Content` corrupted every em-dash
   into `â€"` across 7 files in one pass. **Edit source with Node, Python, or the editor tools —
   never PowerShell text I/O.** Check `git diff` for mojibake before committing.
2. **The server caches module metadata in memory at startup.** After changing anything under
   `packages/engine/src/modules/`, rebuild **and restart the server**, or the UI keeps serving the
   old parameter descriptors.
3. **`npm run build` at root does not rebuild the web app alone** — use
   `npm run build --workspace @taf/studio-web` when iterating on UI.
4. **The tracker is a data-driven HTML page.** After editing
   `docs/ui-ux/PRODUCT_BACKLOG_TRACKER.html`, validate it:
   ```bash
   node -e "const h=require('fs').readFileSync('docs/ui-ux/PRODUCT_BACKLOG_TRACKER.html','utf8');
   new Function([...h.matchAll(/<script>([\s\S]*?)<\/script>/g)][0][1]); console.log('parses')"
   ```
   A dropped line in the `backlog` or `changes` array blanks the whole page silently.
5. **`.responsive-table` rules carry `!important` throughout.** Base `table` rules never win.
6. **Playwright `dragTo` works** for the drag-and-drop features; assert the persisted result
   through the API, not just the DOM.
7. **`literalOnly` on a param removes a real capability, not just a dropdown.** Marking
   `Wait.ms` as `literalOnly` to tidy the form silently deleted the ability to bind a delay to a
   dataset column — `typed-test-authoring.test.js` caught it. Presentation changes to the step
   form must not narrow what can be bound. The same applies to `type: 'boolean' | 'enum'`: a
   checkbox has nowhere to put a `${placeholder}`, so `StepEditor` falls back to the text+chip
   control whenever the current value is already a binding, or saving the step would overwrite it.
8. **The Bash tool's heredocs eat backslashes even when quoted** (`<<'EOF'`). A regex written as
   `\\{\\s*` arrives as `{s*` and silently matches nothing. Write the script to a file and run
   it, rather than piping it through a heredoc.
9. **The shell's working directory silently drifts to the parent repo.** Both G-Stride and
   `SAP-S4HANA-Studio-UI-Redesign` have the same `packages/studio-web` layout, so a bare
   `npm run build --workspace @taf/studio-web` will happily build the *wrong product* and
   report success. It cost a debugging cycle on 14 Aug 2026 — a rebuilt UI that "would not
   apply" was being built into the parent while the server served G-Stride's older bundle.
   **Prefix build/test commands with an absolute `cd`,** and if a change appears not to take,
   check which `assets/index-*.js` the page actually loaded against `dist/index.html`.
10. **The studio server reads `dist/index.html` once at startup.** Rebuilding the web app
    while it runs leaves it serving the previous hashed bundle, so a verified-looking change
    never reaches the browser. Restart the server after every web build, not just after
    changing engine modules (trap #2).

---

## 5. Where the product actually stands

Recent work, newest first — all committed and pushed to `gstride/main`:

- **Compose authoring overhaul.** The owner timed close to an hour to compose four steps and rated
  it 1/10. Six root causes fixed: dataset-column suggestions wired to the real CSVs (they had been
  fed from the Test's own contract inputs, which are empty on a new Test); `literalOnly` params
  render one box instead of asking for a value source; DUPLICATE step; delete for Tests and
  folders; read-only Identifier; collapsed contract panel.
- **Typography** applied from a specified scale, with Inter **self-hosted** via
  `@fontsource-variable/inter` (it had been named but never loaded, so it was silently falling back).
- **Vocabulary settled on "Test"**, not "test case".
- **Test Library rebuilt** as a Windows-Explorer-style workspace matching the Object Library:
  folder tree by process area, centre-pane editing, folder create/delete, drag and drop between
  folders.
- **Object Library panel alignment** and a product-wide bottom-bar overlap fix.
- **Scan session hang fix** — `browser.close()` can hang rather than reject.

### Open items

| Item | State |
|---|---|
| **NVDA accessibility gate** | Open, LOW priority by owner direction. Explicitly **not** closed. The recorded run at `regression/results/nvda/primary-workspaces-2026-07-29.log` is now **stale** — it announces "Open test case" and "New test case file name", which the vocabulary change renamed. Re-record when next run. |
| **BL-044 divergence** | The Process area control is a dropdown now, not the combobox its criteria specify. The criteria's *intent* is still met (see the tracker entry). **Needs owner ratification.** |
| **Automation run reference** | Owner asked whether it can be determined at runtime. Assessed: `automationReference`, `automationOwner` and `transactionFailureDisposition` are rendered into the **evidence PDF**, so automating it changes signed compliance evidence. **Governance decision, deliberately not taken.** |
| **BL-045** | Held pending a design decision. |
| **BL-046** | Not started. A previous implementation was reverted after owner review; what specifically made it worse was never established. |
| **Compose redesign** | Re-timed 14 Aug 2026 via `regression/compose-authoring-timing.js`. Modelled expert floor **144 interactions / ~5m53s** for the 16-step build; **observed human run 25 min** (~4x the floor, first time, following a written checklist). UI latency is not a factor — the same 144 interactions run in ~5s of machine wall-clock. **Ground-up redesign NOT taken**; the step form was streamlined instead (see below). Decision on anything further still open. |
| **Step form streamlining** | Done 14 Aug 2026, on owner direction after reviewing the Fill Table Cell form. `ModuleParamDescriptor` gained `type` / `options` / `advanced`; the value-source dropdown collapsed to an inline chip; booleans and enums render a checkbox/select; defaulted params fold into a collapsed "Options". **Controls on screen: −43% to −60% on the table/grid modules, −10% on the simpler Sales Order ones.** Interaction count is unchanged (a wash) — the gain is visual load, which KLM does not measure. |
| **Docs vocabulary** | `docs/ui-ux/PRODUCT_BACKLOG.md` (BL-020 AC3) and `USER_JOURNEYS.md` still say "business name". Left for owner ratification. |
| **`nanoid` advisory** | High-severity transitive vuln via `vite → postcss`. Build-time only, deliberately accepted. |

### Regression coverage gaps

15 UI tests are **skipped with documented reasons** — they asserted markup the G-Stride redesign
removed. Each skip names what is now uncovered. Currently **UNCOVERED**:

- **BL-035** AC1/AC3/AC4 — the audit run list moved from cards to a table
- **BL-023** AC4 — contextual-capture dialog contract
- **BL-018** AC1/AC3 — the "Needs attention" panel no longer exists
- **BL-019** AC1/AC3 — impact-scope disclosure replaced
- **HC-008** — pre-filtered failed-runs link

These are deprecations pending a decision, not silent deletions. Ask the owner whether each
requirement was **withdrawn or merely moved** before rewriting or dropping.

---

## 6. How to work here

Read `CLAUDE.md` in the repo root first — it carries the standing instructions.

The working style this project expects:

- **Measure, then change.** Capture the real rendered geometry, the real API response, the real
  computed style. Several bugs here looked like one thing and were another.
- **Run the full UI suite before committing.** It has caught genuine errors that looked like test
  breakage — including an over-broad change that would have quietly removed a working capability.
- **Report faithfully.** If a test fails, say so with the output. If something was skipped or
  assumed, say that. Do not describe work as verified that was not.
- **Flag divergences from written acceptance criteria** rather than quietly implementing over them.
- **Clean up workspace artefacts** you create while verifying — `testcases/`, `data/` and the tag
  store are the user's real data, not a scratch pad.
