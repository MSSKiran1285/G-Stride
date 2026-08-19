export interface TableCellLocator {
  /** DOM id of the table itself (sap.ui.table.Table or sap.m.Table). */
  tableId: string;
  /** DOM id of the column — stable across sessions, unlike per-row cell ids. */
  columnId: string;
  rowIndex: number;
  /**
   * DOM attribute the table renders on each <td> identifying its column — differs
   * by table type: sap.ui.table.Table (grid table) uses "data-sap-ui-colid".
   * sap.m.Table (responsive table) uses "data-sap-ui-column". Defaults to the
   * grid-table convention for backward compatibility.
   */
  columnAttr?: string;
  /**
   * DOM attribute the table renders on its <tr> to mark row position — differs
   * by table type: sap.ui.table.Table (grid table) uses "data-sap-ui-rowindex",
   * 0-based, data rows only. sap.m.Table (responsive table) uses "aria-rowindex",
   * 1-based, with the header row counted as row 1. Defaults to the grid-table
   * convention for backward compatibility.
   */
  rowIndexAttr?: string;
}

export interface ObjectLocator {
  /** Plain element id lookup. Mutually exclusive with tableCell. */
  controlId?: string;
  controlType?: string;
  /**
   * Grid-table cell lookup by (table id, column id, row index) instead of a
   * per-cell id. Grid tables (sap.ui.table.Table) render item rows/cells with
   * runtime-generated "clone" ids that change across sessions, so individual
   * cells can't be targeted by id the way header fields can.
   */
  tableCell?: TableCellLocator;
}

export interface ActionResult {
  /**
   * Set when the control was found via a self-healing fallback rather than at
   * the exact stored controlId — the id that actually worked, so the caller
   * can persist the fix back to the object repository. Absent (or equal to
   * the requested controlId) when no healing occurred. Not set for tableCell
   * locators — see healedTableId/healedColumnId instead.
   */
  healedControlId?: string;
  /** tableCell equivalent of healedControlId, for the table's own id. */
  healedTableId?: string;
  /** tableCell equivalent of healedControlId, for the column's own id. */
  healedColumnId?: string;
}

/**
 * Common interface every UI automation technology implements. The execution
 * engine and modules only ever talk to this interface, so a future SAP GUI
 * Scripting adapter can be added without touching engine or module code.
 */
export interface IAutomationAdapter {
  open(url: string): Promise<void>;
  navigate(url: string): Promise<void>;
  /** Waits for the browser's own in-flight navigation/redirect chain to settle (e.g. after a login submit). */
  waitForPageSettled(timeoutMs?: number): Promise<void>;
  /**
   * Opens an app via the Fiori Launchpad App Finder catalog rather than a bare
   * deep-link URL — some apps don't resolve reliably from a bookmark alone and
   * need the catalog navigation flow (find tile by title, click it, wait for
   * the shell's app title to actually change).
   */
  openAppFromCatalog(catalogUrl: string, appTitle: string, timeoutMs?: number): Promise<void>;
  /**
   * Finds a control anywhere on the page by its visible text (label,
   * title, header, etc.) and clicks it — e.g. selecting an option from a
   * value-help list/dialog whose items have runtime-generated ids. matchMode
   * 'contains' (default 'exact') is for text that includes a dynamic suffix —
   * e.g. a button reading "Copy Picking Quantity (2)" where the count varies
   * by how many delivery items exist, not something a test author can hardcode.
   */
  clickByText(text: string, timeoutMs?: number, matchMode?: 'exact' | 'contains'): Promise<void>;
  /**
   * Returns whichever of the given texts is currently visible on the page, or
   * null if none appear within the timeout — for distinguishing between
   * multiple possible dialogs (e.g. by title) before deciding which button
   * to click, rather than guessing from button text alone.
   */
  findVisibleText(texts: string[], timeoutMs?: number): Promise<string | null>;
  /**
   * Reads the visible text of every text/title/header control inside the
   * topmost open dialog or popover — for parsing dynamic confirmation values
   * (e.g. a generated document number like "5000066366/2026") out of a
   * generic Success dialog without knowing any control id in advance.
   */
  readDialogText(): Promise<string[]>;
  waitFor(locator: ObjectLocator, timeoutMs?: number): Promise<ActionResult>;
  performAction(
    locator: ObjectLocator,
    action: 'click' | 'fill',
    value?: string,
    options?: { pressKey?: string }
  ): Promise<ActionResult>;
  readValue(locator: ObjectLocator): Promise<{ value: string } & ActionResult>;
  /** GET an OData/REST endpoint reusing the already-authenticated browser session's cookies. */
  apiGet(path: string): Promise<unknown>;
  /** DELETE an OData entity, handling the CSRF token handshake. Used for draft cleanup, not active business documents. */
  apiDelete(path: string): Promise<void>;
  /**
   * Calls a zero-argument method directly on a UI5 control via its own JS API (e.g.
   * `table.selectAll()`) — for actions that don't map cleanly onto a DOM click/fill,
   * because the rendered element doesn't reliably drive the same behavior a real API
   * call does. Found on a due-list's "select all" header checkbox: a programmatic click
   * toggled the checkbox's own visible state but never fired the underlying table's
   * selectionChange handling (which a "Create Deliveries" button's enabled-state binding
   * depends on) — `event.isTrusted` is false for a script-dispatched click, and something
   * in that chain evidently checks it.
   */
  callControlMethod(controlId: string, methodName: string): Promise<void>;
  /**
   * Selects every row in a table AND fires its selectionChange event — a plain
   * `callControlMethod(tableId, 'selectAll')` was verified live to update the table's own
   * selection state (getSelectedItems().length becomes correct) but NOT to enable a
   * dependent "Create Deliveries"-style button, because that button's enabled binding
   * reacts to the selectionChange *event*, which selectAll() alone never fires — a real
   * user click does both in one gesture, so this method reproduces both halves.
   */
  selectAllInTable(tableId: string): Promise<void>;
  /**
   * Selects (checks) row N's own checkbox in a responsive table (sap.m.Table), given the
   * table's own captured control id. Verified live: a due-list's "select all" HEADER
   * checkbox visually toggles and even updates the raw table's own selection state, but a
   * Fiori Elements List Report template's own selection tracking never picks it up (the
   * dependent "Create Deliveries" button stays disabled) — clicking the actual ROW's own
   * checkbox instead works correctly. Located via UI5's stable "sapMListTblSelCol"
   * selection-cell class (every row's selection cell carries it) plus the row's
   * aria-rowindex, not the row's own DOM id, which is a per-render "__cloneNNN" that
   * regenerates on every load and can't be captured into the object repository at all.
   */
  selectTableRow(tableId: string, rowIndex: number, timeoutMs?: number): Promise<void>;
  /**
   * Highlights a control with a colored outline and a floating text label,
   * screenshots it, then removes the highlight — evidence of exactly which
   * field was set and to what value, for documentation/audit purposes.
   */
  captureFieldEvidence(locator: ObjectLocator, label: string, path: string): Promise<void>;
  screenshot(path: string): Promise<void>;
  close(): Promise<void>;
}
