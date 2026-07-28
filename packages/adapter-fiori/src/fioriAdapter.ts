import { Browser, BrowserContext, Locator, Page, chromium } from 'playwright';
import { ActionResult, IAutomationAdapter, ObjectLocator, TableCellLocator } from '@taf/engine';

/**
 * Drives Fiori/UI5 apps via Playwright. Locators are plain element ids —
 * UI5 renders stable `id` attributes for Fiori Elements apps, so we look
 * controls up by id rather than generated CSS classes or XPath.
 */
export class FioriPlaywrightAdapter implements IAutomationAdapter {
  private browser?: Browser;
  private context?: BrowserContext;
  private page?: Page;

  constructor(private options: { headless?: boolean } = {}) {}

  async open(url: string): Promise<void> {
    const headless = this.options.headless ?? true;
    // --start-maximized + viewport:null (use the actual window size instead of a fixed
    // viewport) run the browser full-screen in headed mode, for fuller evidence screenshots.
    this.browser = await chromium.launch({ headless, args: headless ? [] : ['--start-maximized'] });
    this.context = await this.browser.newContext({ viewport: headless ? undefined : null });
    this.page = await this.context.newPage();
    await this.page.goto(url, { waitUntil: 'domcontentloaded' });
  }

  async navigate(url: string): Promise<void> {
    if (!this.page) throw new Error('Adapter not opened — call open() first');
    await this.page.goto(url, { waitUntil: 'domcontentloaded' });
  }

  async waitForPageSettled(timeoutMs = 20000): Promise<void> {
    if (!this.page) throw new Error('Adapter not opened — call open() first');
    await this.page.waitForLoadState('networkidle', { timeout: timeoutMs }).catch(() => undefined);
  }

  /** Scans every frame's UI5 control registry for a control whose text/title/header/subheader matches exactly. */
  private async findControlIdByText(text: string, timeoutMs: number): Promise<string | null> {
    if (!this.page) throw new Error('Adapter not opened — call open() first');
    const page = this.page;
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      for (const frame of page.frames()) {
        const id = await frame
          .evaluate((t) => {
            const core = (window as any).sap?.ui?.getCore?.();
            if (!core?.byId) return null;
            const ids = Array.from(document.querySelectorAll('[id]')).map((el) => el.id);
            const getters = ['getText', 'getTitle', 'getHeader', 'getSubheader'];
            for (const candidateId of ids) {
              const control = core.byId(candidateId);
              if (!control) continue;
              for (const g of getters) {
                if (typeof control[g] === 'function' && control[g]() === t) return candidateId;
              }
            }
            return null;
          }, text)
          .catch(() => null);
        if (id) return id;
      }
      await page.waitForTimeout(300);
    }
    return null;
  }

  /**
   * Same idea as findControlIdByText, but collects EVERY matching control and
   * returns the first one that's actually visible — a stale/hidden control
   * with the same text can linger in the DOM (e.g. an entry screen's own
   * "Post" button, still present but covered once a Simulation Results view
   * is showing its own "Post" button), and clicking the wrong one just hangs
   * on Playwright's actionability wait until it times out.
   */
  private async findVisibleControlIdByText(
    text: string,
    timeoutMs: number,
    matchMode: 'exact' | 'contains' = 'exact'
  ): Promise<string | null> {
    if (!this.page) throw new Error('Adapter not opened — call open() first');
    const page = this.page;
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      for (const frame of page.frames()) {
        const ids = await frame
          .evaluate(
            ({ t, mode }) => {
              const core = (window as any).sap?.ui?.getCore?.();
              if (!core?.byId) return [];
              const allIds = Array.from(document.querySelectorAll('[id]')).map((el) => el.id);
              const getters = ['getText', 'getTitle', 'getHeader', 'getSubheader'];
              const matches: string[] = [];
              for (const candidateId of allIds) {
                const control = core.byId(candidateId);
                if (!control) continue;
                for (const g of getters) {
                  if (typeof control[g] !== 'function') continue;
                  const value = control[g]();
                  if (typeof value !== 'string') continue;
                  if (mode === 'contains' ? value.includes(t) : value === t) {
                    matches.push(candidateId);
                    break;
                  }
                }
              }
              return matches;
            },
            { t: text, mode: matchMode }
          )
          .catch(() => []);
        for (const id of ids) {
          const el = frame.locator(`[id="${id}"]`);
          if ((await el.count().catch(() => 0)) > 0 && (await el.first().isVisible().catch(() => false))) {
            return id;
          }
        }
      }
      await page.waitForTimeout(300);
    }
    return null;
  }

  async clickByText(text: string, timeoutMs = 20000, matchMode: 'exact' | 'contains' = 'exact'): Promise<void> {
    if (!this.page) throw new Error('Adapter not opened — call open() first');
    const page = this.page;
    const id = await this.findVisibleControlIdByText(text, timeoutMs, matchMode);
    if (!id) throw new Error(`No visible control found with text "${text}" within ${timeoutMs}ms`);
    for (const frame of page.frames()) {
      const el = frame.locator(`[id="${id}"]`);
      if ((await el.count()) > 0) {
        await el.first().click();
        return;
      }
    }
    throw new Error(`Control "${id}" matched text "${text}" but its element could not be located to click`);
  }

  async findVisibleText(texts: string[], timeoutMs = 3000): Promise<string | null> {
    if (!this.page) throw new Error('Adapter not opened — call open() first');
    const page = this.page;
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      for (const frame of page.frames()) {
        const found = await frame
          .evaluate((candidates) => {
            const core = (window as any).sap?.ui?.getCore?.();
            if (!core?.byId) return null;
            const ids = Array.from(document.querySelectorAll('[id]')).map((el) => el.id);
            const getters = ['getText', 'getTitle', 'getHeader', 'getSubheader'];
            for (const id of ids) {
              const control = core.byId(id);
              if (!control) continue;
              for (const g of getters) {
                if (typeof control[g] === 'function') {
                  const v = control[g]();
                  if (typeof v === 'string' && candidates.includes(v)) return v;
                }
              }
            }
            return null;
          }, texts)
          .catch(() => null);
        if (found) return found;
      }
      await page.waitForTimeout(300);
    }
    return null;
  }

  async readDialogText(): Promise<string[]> {
    if (!this.page) throw new Error('Adapter not opened — call open() first');
    for (const frame of this.page.frames()) {
      const texts = await frame
        .evaluate(() => {
          const containers = Array.from(document.querySelectorAll('.sapMDialog, .sapMPopover'));
          if (containers.length === 0) return null;
          const container = containers[containers.length - 1];
          const core = (window as any).sap?.ui?.getCore?.();
          if (!core?.byId) return null;
          const ids = Array.from(container.querySelectorAll('[id]')).map((el) => el.id);
          const getters = ['getText', 'getTitle', 'getHeader'];
          const results: string[] = [];
          for (const id of ids) {
            const control = core.byId(id);
            if (!control) continue;
            for (const g of getters) {
              if (typeof control[g] === 'function') {
                const v = control[g]();
                if (typeof v === 'string' && v.trim()) results.push(v.trim());
              }
            }
          }
          return results;
        })
        .catch(() => null);
      if (texts && texts.length > 0) return texts;
    }
    return [];
  }

  async openAppFromCatalog(catalogUrl: string, appTitle: string, timeoutMs = 30000): Promise<void> {
    if (!this.page) throw new Error('Adapter not opened — call open() first');
    const page = this.page;

    await page.goto(catalogUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle', { timeout: timeoutMs }).catch(() => undefined);

    const tileId = await this.findControlIdByText(appTitle, timeoutMs);
    if (!tileId) throw new Error(`App tile "${appTitle}" not found in catalog within ${timeoutMs}ms`);

    for (const frame of page.frames()) {
      const el = frame.locator(`[id="${tileId}"]`);
      if ((await el.count()) > 0) {
        // App Finder tiles have BOTH the navigation area and a "pin to home" checkbox inside
        // the same bounding box — a default center-click can land on either depending on
        // rendering, and hitting the checkbox just toggles it instead of opening the app.
        // Click near the top-left (icon/title area) to reliably avoid the checkbox.
        await el.first().click({ position: { x: 10, y: 10 } });
        break;
      }
    }

    const titleDeadline = Date.now() + timeoutMs;
    while (Date.now() < titleDeadline) {
      for (const frame of page.frames()) {
        const shellTitle = await frame
          .evaluate(() => (window as any).sap?.ui?.getCore?.()?.byId?.('shellAppTitle')?.getText?.() ?? null)
          .catch(() => null);
        if (shellTitle === appTitle) return;
      }
      await page.waitForTimeout(300);
    }
    throw new Error(`App "${appTitle}" did not open within ${timeoutMs}ms after clicking its catalog tile`);
  }

  /**
   * Fiori Launchpad apps commonly render inside a nested iframe rather than the
   * top-level document, and which frame varies by app and can appear only after
   * navigation settles. We poll every frame for a matching selector until one
   * has it or the timeout elapses, rather than assuming the top-level page.
   */
  private async locateBySelector(selector: string, timeoutMs: number, describe: string): Promise<Locator> {
    if (!this.page) throw new Error('Adapter not opened — call open() first');
    const page = this.page;
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      for (const frame of page.frames()) {
        const candidate = frame.locator(selector);
        if ((await candidate.count().catch(() => 0)) > 0) {
          return candidate.first();
        }
      }
      await page.waitForTimeout(200);
    }
    throw new Error(`${describe} not found in any frame within ${timeoutMs}ms`);
  }

  /**
   * A sap.ui.table.Table (grid table — e.g. Fiori Elements Object Page item tables) renders a
   * FIXED pool of DOM row slots (its visibleRowCount — confirmed live at 6, elsewhere 12,
   * depending on viewport), recycling/rebinding them to different data rows as you scroll,
   * rather than one DOM row per data row. Two consequences, both confirmed against a real PO
   * with 9 items and visibleRowCount 6:
   *   1. `data-sap-ui-rowindex` on a `<tr>` is the SLOT position (always 0..visibleRowCount-1),
   *      NOT the absolute data row index — after scrolling so the table's firstVisibleRow is 3,
   *      `table.getRows()` showed control-level indexes 3..8 (the real, absolute row indexes)
   *      each still rendering `data-sap-ui-rowindex` 0..5 (the slot, unchanged). Building a
   *      selector like `tr[data-sap-ui-rowindex="7"]` to mean "absolute row 7" can never work —
   *      that attribute value never exceeds visibleRowCount-1 no matter which row is scrolled in.
   *   2. A rowIndex outside the currently-rendered window has no matching row control at all yet
   *      (only 6-12 of it are ever instantiated), so it must be scrolled into view first via
   *      setFirstVisibleRow (the grid table's own public API for this; a no-op when already
   *      visible) before its slot can be resolved.
   * The fix: scroll the absolute row into the rendered window, then ask the table which SLOT
   * currently holds it (`getRows().find(r => r.getIndex() === rowIndex)`), and use THAT slot's
   * own `data-sap-ui-rowindex` value in the selector — not the absolute rowIndex. Verified live:
   * absolute row 7 (PO item 00080) resolved to slot "4", and `tr[data-sap-ui-rowindex="4"]`
   * correctly returned that exact item's cells.
   * sap.m.Table (responsive table) has no such virtualization — every row is a real, permanently
   * rendered control with its own stable id — so `getRows`/`setFirstVisibleRow` don't exist on
   * it, and this whole step is skipped, falling back to the literal rowIndex unchanged.
   */
  private async resolveGridTableRowSlot(tableId: string, rowIndex: number, timeoutMs: number): Promise<{ isGridTable: boolean; slot: string | null }> {
    if (!this.page) return { isGridTable: false, slot: null };
    const deadline = Date.now() + timeoutMs;
    let result: { isGridTable: boolean; slot: string | null } = { isGridTable: false, slot: null };

    while (Date.now() < deadline) {
      for (const frame of this.page.frames()) {
        const frameResult = await frame
          .evaluate(
            ({ id, row }) => {
              const core = (window as any).sap?.ui?.getCore?.();
              const table = core?.byId?.(id);
              if (!table || typeof table.getRows !== 'function') return null; // not a grid table (or wrong frame)

              const firstVisible = table.getFirstVisibleRow?.() ?? 0;
              const visibleRowCount = table.getVisibleRowCount?.() ?? 10;
              if (row < firstVisible || row >= firstVisible + visibleRowCount) {
                table.setFirstVisibleRow?.(Math.max(0, row - Math.floor(visibleRowCount / 2)));
              }

              const match = table.getRows().find((r: any) => r.getIndex() === row);
              const slot = match?.getDomRef()?.getAttribute('data-sap-ui-rowindex') ?? null;
              return { isGridTable: true, slot };
            },
            { id: tableId, row: rowIndex }
          )
          .catch(() => null);
        if (frameResult) {
          result = frameResult;
          if (result.slot !== null) return result;
        }
      }
      if (!result.isGridTable) return result; // never a grid table in any frame — no point polling
      await this.page.waitForTimeout(200);
    }
    return result;
  }

  /**
   * Same suffix-matching idea as healControlId, but without the control-type check that
   * requires a stored controlType — TableCellLocator only carries tableId/columnId strings,
   * no type. Needed because freestyle-view table/column ids (e.g. "__xmlview121--
   * S1DeliveryItemsTable") carry a per-session view-instance number and go stale on every
   * single run, not just occasionally like Fiori Elements ids — so this has to run before
   * every table-cell lookup on such a view, not just as a rare fallback.
   */
  private async healIdBySuffix(staleId: string, timeoutMs: number): Promise<string | null> {
    if (!this.page) return null;
    const hasFeHierarchy = staleId.includes('::');
    const segments = staleId.split(hasFeHierarchy ? '::' : '--');
    if (segments.length < 2) return null;
    // 3 segments where available: the last 2 alone are often a generic annotation-driven
    // tail (e.g. "com.sap.vocabularies.UI.v1.LineItem::responsiveTable") shared by every
    // UI.LineItem table on an Object Page — the 3rd-from-last segment is usually the facet
    // name ("...--Deliveries" vs "...--Messages") that actually disambiguates them.
    const feSegmentCount = Math.min(3, segments.length);
    const suffix = hasFeHierarchy ? segments.slice(-feSegmentCount).join('::') : segments.slice(-1).join('--');

    const page = this.page;
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      for (const frame of page.frames()) {
        const candidateId = await frame
          .evaluate((sfx) => Array.from(document.querySelectorAll('[id]')).map((el) => el.id).find((id) => id.endsWith(sfx)) ?? null, suffix)
          .catch(() => null);
        if (candidateId) return candidateId;
      }
      await page.waitForTimeout(200);
    }
    return null;
  }

  private async locateTableCell(
    { tableId, columnId, rowIndex, columnAttr = 'data-sap-ui-colid', rowIndexAttr = 'data-sap-ui-rowindex' }: TableCellLocator,
    timeoutMs: number
  ): Promise<Locator> {
    try {
      return await this.locateTableCellOnce(tableId, columnId, rowIndex, columnAttr, rowIndexAttr, timeoutMs);
    } catch (err) {
      // Only heal after the real ids have been given the full timeout to render — trying
      // suffix-matching as an eager pre-check (rather than a genuine failure fallback) was
      // found live to mis-fire: it ran a single, unpolled existence check before the correct
      // Fiori Elements table had even rendered, then "healed" onto a DIFFERENT sibling facet
      // table that happens to share the same generic annotation-driven id tail (e.g. both a
      // "Deliveries" and a "Messages" table on the same Object Page end in
      // "::com.sap.vocabularies.UI.v1.LineItem::responsiveTable") — a false-positive heal
      // that a real "not found after full polling" failure would never have triggered.
      const healTimeout = Math.min(timeoutMs, 8000);
      const healedTableId = await this.healIdBySuffix(tableId, healTimeout);
      const healedColumnId = await this.healIdBySuffix(columnId, healTimeout);
      if (!healedTableId && !healedColumnId) throw err;
      return this.locateTableCellOnce(healedTableId ?? tableId, healedColumnId ?? columnId, rowIndex, columnAttr, rowIndexAttr, timeoutMs);
    }
  }

  private async locateTableCellOnce(
    tableId: string,
    columnId: string,
    rowIndex: number,
    columnAttr: string,
    rowIndexAttr: string,
    timeoutMs: number
  ): Promise<Locator> {
    const { isGridTable, slot } = await this.resolveGridTableRowSlot(tableId, rowIndex, timeoutMs);
    if (isGridTable && slot === null) {
      // No bound row exists at this index yet. Some Fiori Elements v4 (MDC) tables render
      // an always-present "Creation Row" instead — a dedicated inline-add form that's NOT
      // part of the table's own row aggregation until you actually commit it, so getRows()
      // genuinely has zero entries even though a fillable row is visibly on screen. Its
      // cells carry the exact same stable column-id attribute as a normal row's cells, just
      // under a plain <tr> with no row-index (there's only ever one Creation Row). Found via
      // a real capture on Manage Sales Orders V2 — a grid table whose getRows() stayed at 0
      // while a "New Item" row was visibly editable on screen.
      // The Creation Row's own id is NOT nested under the table's id — both are siblings
      // derived from the same base ("...LineItem-innerTable" vs "...LineItem::CreationRow-inner"),
      // so strip the table's own "-innerTable" suffix before appending, rather than treating
      // tableId as a literal prefix.
      const creationRowBase = tableId.replace(/-innerTable$/, '');
      const creationRowSelector = `[id="${creationRowBase}::CreationRow-inner"] td[${columnAttr}="${columnId}"]`;
      const creationRowLocator = this.page!.locator(creationRowSelector);
      if ((await creationRowLocator.count().catch(() => 0)) > 0) {
        return this.locateBySelector(creationRowSelector, timeoutMs, `Creation row cell (table=${tableId}, column=${columnId})`);
      }
    }
    // aria-rowindex (responsive tables) is 1-based with the header counted as row 1, so
    // row 0 is aria-rowindex 2 — same convention selectTableRow() and controlAccess.ts's
    // RESPONSIVE_TABLE_STYLE callers already assume. data-sap-ui-rowindex (grid tables)
    // is 0-based, so rowIndex is used as-is there.
    const effectiveRow =
      isGridTable && slot !== null ? slot : rowIndexAttr === 'aria-rowindex' ? String(rowIndex + 2) : String(rowIndex);
    const selector = `[id="${tableId}"] tr[${rowIndexAttr}="${effectiveRow}"] td[${columnAttr}="${columnId}"]`;
    return this.locateBySelector(selector, timeoutMs, `Table cell (table=${tableId}, column=${columnId}, row=${rowIndex})`);
  }

  // SAP Cloud systems can be slow to navigate/re-render, especially under the repeated
  // load of test runs — 10s was too tight and caused a transient failure mid-navigation.
  private static readonly DEFAULT_TIMEOUT_MS = 20000;

  /**
   * Fuzzy fallback for when a stored controlId no longer exists: Fiori Elements
   * ids are hierarchical (view-path::...::LogicalName::Field), and the tail
   * segments tend to survive even when a prefix hash regenerates. We scan every
   * DOM id ending in the stale id's last two segments and confirm the match via
   * the UI5 control registry's own type metadata (not just an id guess), so a
   * coincidental suffix match on the wrong control can't slip through.
   *
   * Freestyle (non-Fiori-Elements) views — e.g. "Pick Outbound Delivery" — don't
   * use "::" hierarchy at all: their ids are "__xmlviewNNN--LogicalName", where
   * the numeric view instance id regenerates every session. Found live: a stored
   * id like "__xmlview115--S1ReferenceDocumentInput" has zero "::" occurrences,
   * so the Fiori Elements suffix logic never even attempted healing. Falling back
   * to the id's final "--"-separated segment covers this case the same way.
   */
  private async healControlId(staleControlId: string, controlType: string | undefined, timeoutMs: number): Promise<string | null> {
    if (!this.page || !controlType) return null;
    const hasFeHierarchy = staleControlId.includes('::');
    const segments = staleControlId.split(hasFeHierarchy ? '::' : '--');
    if (segments.length < 2) return null;
    const feSegmentCount = Math.min(3, segments.length);
    const suffix = hasFeHierarchy ? segments.slice(-feSegmentCount).join('::') : segments.slice(-1).join('--');

    const page = this.page;
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      for (const frame of page.frames()) {
        const candidateId = await frame
          .evaluate(
            ({ sfx, type }) => {
              const core = (window as any).sap?.ui?.getCore?.();
              if (!core?.byId) return null;
              const ids = Array.from(document.querySelectorAll('[id]'))
                .map((el) => el.id)
                .filter((id) => id.endsWith(sfx));
              for (const id of ids) {
                const control = core.byId(id);
                if (control?.getMetadata?.().getName?.() === type) return id;
              }
              return null;
            },
            { sfx: suffix, type: controlType }
          )
          .catch(() => null);
        if (candidateId) return candidateId;
      }
      await page.waitForTimeout(200);
    }
    return null;
  }

  private async locate(
    locator: ObjectLocator,
    timeoutMs = FioriPlaywrightAdapter.DEFAULT_TIMEOUT_MS
  ): Promise<{ handle: Locator; healedControlId?: string }> {
    if (locator.tableCell) {
      const handle = await this.locateTableCell(locator.tableCell, timeoutMs);
      return { handle };
    }
    if (!locator.controlId) {
      throw new Error('ObjectLocator must specify either controlId or tableCell');
    }

    try {
      const handle = await this.locateBySelector(`[id="${locator.controlId}"]`, timeoutMs, `Control "${locator.controlId}"`);
      return { handle };
    } catch (err) {
      const healedId = await this.healControlId(locator.controlId, locator.controlType, Math.min(timeoutMs, 10000));
      if (!healedId) throw err;
      const handle = await this.locateBySelector(`[id="${healedId}"]`, timeoutMs, `Healed control "${healedId}"`);
      return { handle, healedControlId: healedId };
    }
  }

  async waitFor(locator: ObjectLocator, timeoutMs = FioriPlaywrightAdapter.DEFAULT_TIMEOUT_MS): Promise<ActionResult> {
    const { handle, healedControlId } = await this.locate(locator, timeoutMs);
    await handle.waitFor({ state: 'visible', timeout: timeoutMs });
    return { healedControlId };
  }

  async performAction(
    locator: ObjectLocator,
    action: 'click' | 'fill',
    value?: string,
    options?: { pressKey?: string }
  ): Promise<ActionResult> {
    const { handle, healedControlId } = await this.locate(locator);
    if (action === 'click') {
      // sap.m.CheckBox (and similar widgets) render a real, native <input type="checkbox">
      // deliberately sized to 0x0 — the visible box a user actually sees and clicks is a
      // separate styled sibling/wrapper, normally carrying class "sapMCb" but rendered as
      // "sapMCbBg" for at least one real control (a due-list's own "select all" header
      // checkbox) — a single-character difference our original selector didn't account
      // for, so it always fell through to the unclickable 0x0 input. Checking BOTH class
      // names (rather than just "sapMCb") and clicking whichever exists reaches the same
      // real, trusted click a user's mouse would produce — verified live: this correctly
      // updates both the raw table's selection AND a Fiori Elements List Report's own
      // smart-template selection tracking (getSelectedItems() AND a dependent button's
      // enabled state), which neither a script-dispatched .click() nor a Tab+Space
      // keyboard event on the 0x0 input managed to do — both reached the raw table only.
      const checkbox = handle.locator('.sapMCb, .sapMCbBg');
      const hasCheckbox = (await checkbox.count()) > 0;
      if (hasCheckbox) {
        await checkbox.first().click();
      } else {
        await handle.click();
      }
      return { healedControlId };
    }
    if (action === 'fill') {
      // Many UI5 controls (sap.m.Input, etc.) wrap the real <input> inside an outer div with the control's id.
      // SmartFields specifically can render a placeholder "empty display" div first and only swap
      // in the real <input> once their OData metadata loads — waitFor's plain visibility check
      // passes on that placeholder, so give the input a moment to actually attach before filling.
      const input = handle.locator('input, textarea');
      let target = handle;
      try {
        await input.first().waitFor({ state: 'attached', timeout: 10000 });
        target = input.first();
      } catch {
        if ((await input.count()) > 0) target = input.first();
      }
      await target.fill(value ?? '');
      // SAPUI5 SmartFields/Inputs typically resolve value help and fire change/validation on blur,
      // not on the input event fill() dispatches — press Tab (or a caller-specified key, e.g. Enter
      // for a search field) to commit the value like a real user would.
      await target.press(options?.pressKey ?? 'Tab');
      return { healedControlId };
    }
    throw new Error(`Unsupported action "${action}"`);
  }

  async readValue(locator: ObjectLocator): Promise<{ value: string } & ActionResult> {
    const { handle, healedControlId } = await this.locate(locator);
    const input = handle.locator('input, textarea');
    const value = (await input.count()) > 0 ? await input.first().inputValue() : ((await handle.textContent()) ?? '');
    return { value, healedControlId };
  }

  async apiGet(path: string): Promise<unknown> {
    if (!this.page) throw new Error('Adapter not opened — call open() first');
    const url = new URL(path, this.page.url()).toString();

    // Run fetch() inside the already-loaded, already-authenticated page rather than
    // a fresh tab/raw HTTP client: this tenant's session is established via a
    // JS-driven SSO relay that only runs on the first real navigation (Login already
    // completed it), so an in-page fetch with credentials:'include' reuses that
    // session directly without re-triggering the relay or losing the JS execution
    // context to an intermediate redirect.
    const result = await this.page.evaluate(async (targetUrl) => {
      const fetchOnce = async (token: string) => {
        const res = await fetch(targetUrl, {
          credentials: 'include',
          headers: { Accept: 'application/json', 'X-CSRF-Token': token },
        });
        const text = await res.text();
        return { status: res.status, token: res.headers.get('x-csrf-token'), text };
      };

      let attempt = await fetchOnce('Fetch');
      if (attempt.text.includes('CSRF token validation failed') && attempt.token) {
        attempt = await fetchOnce(attempt.token);
      }
      return attempt;
    }, url);

    try {
      return JSON.parse(result.text);
    } catch {
      throw new Error(`OData request to ${url} returned non-JSON (status ${result.status}): ${result.text.slice(0, 500)}`);
    }
  }

  async apiDelete(path: string): Promise<void> {
    if (!this.page) throw new Error('Adapter not opened — call open() first');
    const url = new URL(path, this.page.url()).toString();

    // Same in-page-fetch approach as apiGet, but fetches the CSRF token via a
    // separate safe GET first rather than retrying the DELETE itself, since a
    // state-changing request isn't something we want to blindly repeat.
    const result = await this.page.evaluate(async (targetUrl) => {
      const tokenRes = await fetch(targetUrl, {
        credentials: 'include',
        headers: { Accept: 'application/json', 'X-CSRF-Token': 'Fetch' },
      });
      const token = tokenRes.headers.get('x-csrf-token');
      await tokenRes.text();

      const deleteRes = await fetch(targetUrl, {
        method: 'DELETE',
        credentials: 'include',
        headers: { 'X-CSRF-Token': token ?? 'Fetch' },
      });
      const text = await deleteRes.text().catch(() => '');
      return { status: deleteRes.status, text };
    }, url);

    if (result.status >= 400) {
      throw new Error(`OData DELETE to ${url} failed: ${result.status} ${result.text.slice(0, 500)}`);
    }
  }

  async callControlMethod(controlId: string, methodName: string): Promise<void> {
    if (!this.page) throw new Error('Adapter not opened — call open() first');
    for (const frame of this.page.frames()) {
      const called = await frame
        .evaluate(
          ({ id, method }) => {
            const core = (window as any).sap?.ui?.getCore?.();
            const control = core?.byId?.(id);
            if (!control || typeof control[method] !== 'function') return false;
            control[method]();
            return true;
          },
          { id: controlId, method: methodName }
        )
        .catch(() => false);
      if (called) return;
    }
    throw new Error(`callControlMethod: no control "${controlId}" with a "${methodName}" method found in any frame`);
  }

  async selectAllInTable(tableId: string): Promise<void> {
    if (!this.page) throw new Error('Adapter not opened — call open() first');
    for (const frame of this.page.frames()) {
      const done = await frame
        .evaluate((id) => {
          const core = (window as any).sap?.ui?.getCore?.();
          const table = core?.byId?.(id);
          if (!table || typeof table.selectAll !== 'function') return false;
          table.selectAll();
          if (typeof table.fireSelectionChange === 'function') {
            table.fireSelectionChange({ selectAll: true, listItems: table.getSelectedItems?.() ?? [] });
          }
          return true;
        }, tableId)
        .catch(() => false);
      if (done) return;
    }
    throw new Error(`selectAllInTable: no table "${tableId}" with selectAll() found in any frame`);
  }

  async selectTableRow(tableId: string, rowIndex: number, timeoutMs = FioriPlaywrightAdapter.DEFAULT_TIMEOUT_MS): Promise<void> {
    // aria-rowindex is 1-based with the header counted as row 1, so the first data row is
    // row 2 — same convention controlAccess.ts's RESPONSIVE_TABLE_STYLE already uses for
    // every other responsive-table row lookup in this codebase.
    const ariaRow = rowIndex + 2;
    const selector =
      `[id="${tableId}"] tr[aria-rowindex="${ariaRow}"] td.sapMListTblSelCol .sapMCbBg, ` +
      `[id="${tableId}"] tr[aria-rowindex="${ariaRow}"] td.sapMListTblSelCol .sapMCb`;
    // Polls (via locateBySelector) rather than checking once — the results table isn't
    // necessarily populated yet the instant a prior "Go" click resolves, same class of
    // timing gap already handled everywhere else a control is located in this file.
    const el = await this.locateBySelector(selector, timeoutMs, `Selection checkbox (table=${tableId}, row=${rowIndex})`);
    await el.click();
  }

  async captureFieldEvidence(locator: ObjectLocator, label: string, path: string): Promise<void> {
    if (!this.page) throw new Error('Adapter not opened — call open() first');
    const { handle } = await this.locate(locator);
    await handle.scrollIntoViewIfNeeded().catch(() => undefined);

    // The field itself can resolve (locate() succeeds) well before the rest of the page has
    // finished rendering — e.g. a List Report's own skeleton/ghost rows are still visible
    // behind a freshly-opened dialog. Re-settling here (networkidle + a short paint buffer)
    // catches any in-flight OData/render cycle that started after the caller's own last
    // wait, so the background isn't mid-render in the evidence shot. Verified live this does
    // NOT help one specific case — a "Create" configuration dialog whose backing object page
    // genuinely doesn't exist until "Continue" is clicked, so its ghost background is the
    // real state, not a timing gap — no amount of waiting changes that one.
    await this.page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => undefined);
    await this.page.waitForTimeout(400);

    const badgeId = `taf-evidence-badge-${Date.now()}`;
    await handle
      .evaluate(
        (el, { text, id }) => {
          (el as HTMLElement).setAttribute('data-taf-prev-outline', (el as HTMLElement).style.outline || '');
          (el as HTMLElement).style.outline = '3px solid #e6194b';
          (el as HTMLElement).style.outlineOffset = '2px';

          const badge = document.createElement('div');
          badge.id = id;
          badge.textContent = text;
          badge.style.position = 'absolute';
          badge.style.background = '#e6194b';
          badge.style.color = '#fff';
          badge.style.padding = '2px 6px';
          badge.style.fontSize = '12px';
          badge.style.fontFamily = 'sans-serif';
          badge.style.zIndex = '999999';
          badge.style.borderRadius = '3px';
          badge.style.whiteSpace = 'nowrap';

          const rect = el.getBoundingClientRect();
          badge.style.left = `${window.scrollX + rect.left}px`;
          badge.style.top = `${window.scrollY + Math.max(rect.top - 22, 0)}px`;
          document.body.appendChild(badge);
        },
        { text: label, id: badgeId }
      )
      .catch(() => undefined);

    await this.page.screenshot({ path, fullPage: false });

    await handle
      .evaluate(
        (el, id) => {
          (el as HTMLElement).style.outline = (el as HTMLElement).getAttribute('data-taf-prev-outline') || '';
          (el as HTMLElement).removeAttribute('data-taf-prev-outline');
          document.getElementById(id)?.remove();
        },
        badgeId
      )
      .catch(() => undefined);
  }

  async screenshot(path: string): Promise<void> {
    await this.page?.screenshot({ path, fullPage: true });
  }

  async close(): Promise<void> {
    await this.context?.close();
    await this.browser?.close();
  }
}
