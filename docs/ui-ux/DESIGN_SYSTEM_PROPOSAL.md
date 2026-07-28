# SAP S/4HANA Test Automation Studio — Design-System Assessment and Proposal

## Executive assessment

The project has the beginning of a design system, not a coherent implementation.

Strengths:

- CSS custom properties already map light and dark themes.
- A restrained blue/slate visual direction is broadly appropriate.
- Shared radius and shadow values exist.
- Native HTML controls limit dependency weight.
- Lucide provides a consistent icon family.
- Generic panel, button, input, and table rules provide a usable base.

Material gaps:

- The current stylesheet does not define many classes used by functional screens, including layout, status, feedback, run, evidence, and ordered-list classes.
- Most design decisions are global element selectors or inline styles rather than explicit reusable components.
- Colour names mix raw palette and semantic intent.
- Typography, spacing, breakpoints, density, focus, disabled, error, and read-only states are incomplete.
- Dashboard-only media queries do not establish application-wide responsive standards.
- Status colours have not been measured for WCAG contrast in both themes.
- Custom pickers, drawer, notifications, skeletons, tooltips, and empty states lack shared interaction contracts.

The proposal below deliberately uses CSS variables and small React primitives. It does not require a large component framework.

## Design principles

1. **Operational truth over decoration.** Never style sample, stale, or unverified information like live system status.
2. **Calm hierarchy.** One page title, one primary action, and progressive disclosure for technical detail.
3. **Business first, technical second.** Show a plain-language label with module/App ID/file details available where useful.
4. **Status is text plus shape/icon, never colour alone.**
5. **Keyboard is a first-class input.**
6. **Responsive means task-complete, not merely horizontally scrollable.**
7. **Density is controlled.** Default comfortable density; compact tables only by user choice or clearly high-volume contexts.
8. **Small composable primitives.** Add no large dependency unless an audited accessible primitive cannot reasonably be implemented.
9. **Preserve Fiori familiarity without cloning SAP screens.** Use predictable enterprise patterns, semantic status conventions, and restrained elevation.

## Token architecture

Use three layers:

1. **Reference palette:** raw colour values, rarely consumed directly.
2. **Semantic tokens:** surface, text, border, action, status, focus.
3. **Component tokens:** optional local mappings such as table-header background.

Component code must consume semantic tokens. Raw hex values belong only in the token definitions.

### Semantic colour tokens

Values are proposed starting points and must be verified with an automated contrast check in both themes before implementation.

```css
:root {
  /* Surfaces */
  --color-canvas: #f7f9fb;
  --color-surface: #ffffff;
  --color-surface-subtle: #f1f4f7;
  --color-surface-raised: #ffffff;
  --color-surface-inverse: #1d2a35;

  /* Text */
  --color-text: #1d2a35;
  --color-text-secondary: #475e70;
  --color-text-muted: #667d8f;
  --color-text-inverse: #ffffff;
  --color-text-link: #0057a3;

  /* Borders and focus */
  --color-border: #d5dadd;
  --color-border-strong: #89919a;
  --color-focus: #005fcc;
  --focus-ring: 0 0 0 3px rgba(0, 95, 204, 0.28);

  /* Actions */
  --color-action: #0064d9;
  --color-action-hover: #004f9f;
  --color-action-pressed: #003b75;
  --color-action-subtle: #eaf3fc;

  /* Semantic status */
  --color-success-text: #256f3a;
  --color-success-surface: #edf7ed;
  --color-success-border: #70a470;
  --color-warning-text: #8d5800;
  --color-warning-surface: #fff8d6;
  --color-warning-border: #e2b93b;
  --color-error-text: #aa0808;
  --color-error-surface: #ffebeb;
  --color-error-border: #e57373;
  --color-info-text: #004b76;
  --color-info-surface: #e5f2f9;
  --color-info-border: #5f9fbd;
  --color-neutral-text: #475e70;
  --color-neutral-surface: #eef1f3;
  --color-neutral-border: #a9b4be;
}
```

Dark theme remaps the same semantic names. Do not use a separate component branch for dark mode.

### Status conventions

| Concept | Label | Colour family | Icon/shape | Notes |
|---|---|---|---|---|
| Not started | Not started | Neutral | Circle/outline | Do not imply failure |
| Draft/changed | Unsaved | Warning | Dot/pencil | Persistent until saved |
| Queued | Queued | Information | Clock | Distinct from running |
| Running | Running | Information | Spinner/progress | Announced politely |
| Passed | Passed | Success | Check | Always render text |
| Failed | Failed | Error | Error/cross | Move focus/announce only when appropriate |
| Cancelled | Cancelled | Neutral | Stop | Record who/why if supported |
| Warning/partial | Passed with warnings / Partial | Warning | Triangle | Do not call this passed |
| Unavailable | Unavailable | Neutral or error by impact | Broken connection | Include recovery action |
| Production target | Production | Error-emphasis safety chip | Shield | Not a run-status colour |

Reserve red for errors, destructive actions, and production-target risk. Do not use green simply to mean “connected”; connection can be neutral/information unless it establishes a verified safe state.

## Typography

Use the system UI stack already available. Do not name remote fonts unless they are actually bundled and permitted.

```css
--font-family-sans: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
--font-family-mono: "SFMono-Regular", Consolas, "Liberation Mono", monospace;

--font-size-100: 0.75rem;   /* 12px metadata only */
--font-size-200: 0.875rem;  /* 14px compact controls/table */
--font-size-300: 1rem;      /* 16px body/default */
--font-size-400: 1.125rem;  /* 18px section lead */
--font-size-500: 1.25rem;   /* 20px h3 */
--font-size-600: 1.5rem;    /* 24px h2 */
--font-size-700: 1.875rem;  /* 30px h1 */

--line-height-tight: 1.25;
--line-height-normal: 1.5;
--line-height-relaxed: 1.65;
```

Guidance:

- Default body: 16px comfortable, 14px compact application density.
- Never render essential text below 12px.
- Uppercase is limited to short status/metadata labels.
- Page title uses `h1`; sections use sequential headings.
- Monospace is limited to identifiers, placeholders, modules, logs, and code.
- Truncated identifiers require an accessible full-value mechanism.

## Spacing and layout

Use a 4px base:

```css
--space-0: 0;
--space-1: 0.25rem;  /* 4 */
--space-2: 0.5rem;   /* 8 */
--space-3: 0.75rem;  /* 12 */
--space-4: 1rem;     /* 16 */
--space-5: 1.25rem;  /* 20 */
--space-6: 1.5rem;   /* 24 */
--space-8: 2rem;     /* 32 */
--space-10: 2.5rem;  /* 40 */
--space-12: 3rem;    /* 48 */
```

Layout primitives:

- `Page`: maximum readable width, full-width variant for grids, responsive gutters.
- `Stack`: vertical flow with tokenised gap.
- `Inline`: wrapping horizontal flow with alignment and gap.
- `Cluster`: actions that wrap together.
- `Grid`: responsive repeat/minmax layout.
- `Split`: sidebar/detail layout that collapses at a declared breakpoint.
- `Section`: heading, description, actions, and content.

Proposed widths:

- Shell content maximum: 1440px.
- Reading/form column: 720–880px.
- Dense workbench/table: full available width.
- Drawer: 360px comfortable, full-screen on narrow displays.
- Minimum touch target: 44×44 CSS px where practical; never below 32×32 for compact desktop tables.

## Radius and elevation

```css
--radius-1: 0.25rem;  /* compact controls/badges */
--radius-2: 0.5rem;   /* inputs/buttons/panels */
--radius-3: 0.75rem;  /* dialogs/large cards */
--radius-round: 999px;

--elevation-0: none;
--elevation-1: 0 1px 2px rgba(18, 33, 45, 0.08);
--elevation-2: 0 4px 12px rgba(18, 33, 45, 0.12);
--elevation-3: 0 12px 32px rgba(18, 33, 45, 0.18);
```

- Default panels use border plus elevation 0 or 1.
- Sticky shell regions use elevation 1.
- Popovers use elevation 2.
- Dialogs/drawers use elevation 3.
- Hover must not create large layout-shifting movement.

## Responsive standards

Content-driven breakpoints:

```css
--breakpoint-sm: 36rem;  /* 576px */
--breakpoint-md: 48rem;  /* 768px */
--breakpoint-lg: 64rem;  /* 1024px */
--breakpoint-xl: 80rem;  /* 1280px */
```

Behaviour:

| Width | Shell | Forms | Tables | Drawers/actions |
|---|---|---|---|---|
| `<36rem` | Modal navigation; context condensed | One column | Card/list alternative or deliberate horizontal region | Full-screen drawer; sticky bottom primary action only where safe |
| `36–48rem` | Collapsed nav | One column; paired fields stack | Prioritised columns, scroll with visible affordance | Action bars wrap |
| `48–64rem` | Collapsible side nav | Two columns where labels remain clear | Horizontal table allowed | Side drawer overlays |
| `64–80rem` | Full side nav optional | Workbench layouts | Full common columns | Drawer may be persistent |
| `>80rem` | Full shell | Max-width/readability constraints | Full dense workbench | Avoid stretching reading content |

Required checks:

- 320 CSS px viewport.
- 1280×720 laptop.
- 1366×768 laptop.
- 1440×900 desktop.
- 200% browser zoom at 1280px.
- Landscape tablet.

## Density

Offer two semantic density modes only after the base components are stable:

- **Comfortable (default):** 40–44px controls/rows, 16px body.
- **Compact:** 32–36px controls/rows, 14px body; intended for high-volume tables.

Density must not reduce focus visibility, target separation, labels, or error text. Do not mix densities arbitrarily within a page.

## Component standards

### Application shell

- One primary navigation.
- One verified context area.
- Utility actions: help, theme, profile.
- Responsive nav drawer.
- Skip link to main content.
- No hard-coded health/compliance claims.

### Page header

- Breadcrumb.
- One `h1`.
- Optional concise description.
- One primary action; secondary actions in a group/overflow.
- Optional status/readiness summary.

### Buttons

Variants:

- `primary`: one per action group.
- `secondary`: common safe alternative.
- `tertiary/ghost`: low emphasis.
- `destructive`: explicit destructive action.
- `icon`: requires accessible name and tooltip only as supplemental help.

States:

- default, hover, pressed, focus-visible, disabled, loading.
- Loading retains width and exposes `aria-busy`.
- Disabled action should have nearby explanation when the reason is not obvious.

### Forms

- `Field` owns label, control ID, description, required/optional indicator, error, and `aria-describedby`.
- Do not use placeholder as the label.
- Mark optional fields when most fields are required; otherwise mark required consistently.
- Validate on submit and after touched blur, not on every keystroke for expensive rules.
- Place format examples in help text.
- Use fieldsets/legends for mode and option groups.
- Show a validation summary for long Composer/Execution forms.

### Selectors and comboboxes

- Native select when grouping/search is not needed.
- Accessible combobox/listbox for Object Picker.
- Accessible grouped combobox or tree-combobox for Grouped Picker.
- Escape closes, Arrow keys navigate, Enter selects, Tab exits.
- Popup relationship, result count, current option, and selection are announced.
- “Show incompatible objects” is an explicit filter state, not hidden fallback.

### Tabs/segmented controls

- Use tabs only to switch peer content in place; use links for routes.
- Chain/Suite/Batch should initially use selectable cards or radios because each changes configuration semantics.
- If tabs are used, implement `tablist`, `tab`, `tabpanel`, arrow navigation, and selected state.

### Panels and cards

- `Panel` groups form/workbench content.
- `CardLink` is a semantic link covering the card.
- Cards do not imitate buttons through clickable `div`.
- Avoid nested panels unless hierarchy is meaningful.

### Tables

Baseline:

- Caption or accessible name.
- Correct header scope.
- Loading/empty/error row.
- Sticky header for long tables.
- Sort buttons announce direction.
- Row actions include row identity.
- Selection uses labelled checkboxes/radios.
- Reordering has buttons/menu plus optional drag.
- Responsive priority: preserve identity, status, and primary action; move metadata into expandable row details.
- Horizontal scrolling region is keyboard focusable and visibly indicated.

Use a third-party grid only after measured needs exceed native-table capability (large row count, advanced column pinning, complex selection). Document bundle, accessibility, and licensing impact first.

### Status, alerts, and notifications

- `StatusBadge`: compact persistent status with text and icon.
- `MessageStrip`: page/section warning, information, success, or error with optional action.
- `InlineError`: field-specific.
- `Toast`: transient confirmation for non-critical completed actions; never the only record of failure.
- `RunStatusBanner`: persistent live status with `role="status"` and explicit last update.
- `AlertDialog`: destructive or side-effect confirmation.

### Dialogs and drawers

- Clear accessible name/description.
- Initial focus, focus containment, Escape behaviour, and focus return.
- Destructive confirmation defaults to the safe action.
- Non-modal help drawer must still expose region name and keyboard close.
- Full-screen on narrow viewports.

### Tooltips

- Supplemental information only.
- Appear on hover and keyboard focus.
- Do not contain required instructions or interactive content.
- `title` alone is insufficient.

### Loading and skeletons

- Use skeleton only when layout is known and wait is perceptible.
- Use a labelled progress indicator for commands.
- Preserve previous data during filter refresh only when clearly marked refreshing.
- Every async area distinguishes initial loading, empty, error, stale, and success.

### Empty states

An empty state contains:

- Plain statement of what is absent.
- Why it matters.
- One appropriate next action.
- Optional help link.

Never substitute sample business records. Demo mode, if required, must be globally and persistently labelled.

### Charts and metrics

- Use summary numbers only when sourced and timestamped.
- Always provide text/table equivalent.
- Pass rate states numerator, denominator, date range, and filter.
- Avoid decorative trend arrows without a comparison basis.
- No charting library is justified for the current dashboard.

### Run and failure components

- `RunScopeSummary`: target, tests, data rows, mode, options, possible side effects.
- `PreflightChecklist`: environment, credentials, objects, data, dependencies.
- `RunProgress`: completed/total/current/elapsed/last update.
- `FailureSummary`: first failure, category, step, expected/actual, error, screenshot.
- `EvidenceViewer`: provenance, sensitivity, permanence, zoom/download.
- `RerunActions`: failed scope/full scope and parent-run linkage.

## Interaction states

Every interactive component must define:

- Rest.
- Hover (pointer enhancement).
- Focus-visible.
- Active/pressed.
- Selected/current.
- Disabled plus reason where needed.
- Read-only.
- Loading.
- Error.
- Success where persistent confirmation is appropriate.

Never encode selected/current solely through background colour. Never remove outline without a replacement.

## Accessibility requirements

Target WCAG 2.2 AA where practical:

- Text contrast at least 4.5:1; large text 3:1.
- Non-text UI/focus contrast at least 3:1.
- Keyboard access to all functions.
- Visible, non-obscured focus.
- Skip link and semantic landmarks.
- One `h1` per page and logical headings.
- Associated labels and descriptions.
- Errors identified in text and linked to fields.
- 24×24 minimum target size under WCAG 2.2, with 44×44 product target where practical.
- Reflow without loss at 320 CSS px/400% zoom where applicable.
- Status not conveyed by colour alone.
- `aria-live` for meaningful asynchronous status.
- Reduced-motion support.
- Accessible names for icon buttons and new-tab disclosures.
- Dialog/drawer/combobox/listbox patterns follow ARIA Authoring Practices.
- Evidence images have meaningful alt text; decorative images have empty alt.
- Logs/code support wrapping or a labelled scroll region.

Automation:

- Playwright keyboard smoke tests.
- Axe scans of each stable route and key open states.
- Theme contrast script/token test.
- Reduced-motion and forced-colours smoke checks.

Manual:

- Keyboard-only core journeys.
- NVDA with Chromium on Windows, aligned to primary-user environment.
- 200% zoom and narrow viewport.
- Light/dark/high-contrast inspection.

## Recommended primitive set

Implement locally under a future `src/ui` directory:

```text
src/ui/
├── layout/
│   ├── Page.tsx
│   ├── Stack.tsx
│   ├── Inline.tsx
│   └── Section.tsx
├── actions/
│   ├── Button.tsx
│   ├── IconButton.tsx
│   └── ActionGroup.tsx
├── forms/
│   ├── Field.tsx
│   ├── Select.tsx
│   ├── Combobox.tsx
│   └── ValidationSummary.tsx
├── feedback/
│   ├── StatusBadge.tsx
│   ├── MessageStrip.tsx
│   ├── AsyncState.tsx
│   └── ToastRegion.tsx
├── data/
│   ├── TableFrame.tsx
│   ├── EmptyState.tsx
│   └── OrderedTransferList.tsx
└── overlays/
    ├── Drawer.tsx
    ├── Dialog.tsx
    └── Tooltip.tsx
```

This is a target structure, not permission for a broad rewrite. Add primitives only as an approved work package needs them.

## Migration sequence

1. Restore missing compatibility classes so current functional screens remain usable.
2. Add semantic token aliases without deleting existing variables.
3. Add focus-visible, reduced-motion, and base typography/spacing corrections.
4. Introduce `Page`, `Stack`, `Inline`, `Button`, `Field`, `StatusBadge`, and `AsyncState`.
5. Migrate shell and navigation.
6. Upgrade Grouped Picker and Object Picker to accessible patterns.
7. Add table and ordered-list patterns.
8. Migrate each workflow in approved modules, deleting legacy CSS only when no references remain.
9. Add density/theme preference after both themes pass accessibility checks.

## Design-system acceptance criteria

- No component consumes raw colour values outside approved visualisation exceptions.
- Every interactive primitive has all required states in light and dark themes.
- Every functional-screen class is defined or removed through migration.
- No required instruction depends on placeholder, colour, hover, or `title`.
- Core pages work at required breakpoints and 200% zoom.
- Axe has no serious/critical violations in audited routes and open component states.
- Tokens and primitives are documented with examples and tested without adding a large framework.
