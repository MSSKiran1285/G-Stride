import { Module } from '../module';
import { clickControl, fillTableCell } from '../controlAccess';

/**
 * Adds one or more rows to whatever grid-table you point it at. Unlike an earlier
 * version of this module, the columns aren't a fixed business concept (material/
 * plant/quantity) — each row is a free-form map of {captured object name: value},
 * so the same module drives a Purchase Order's item table, a Sales Order's item
 * table, an Invoice line table, or any other grid, entirely by which table-column
 * objects the test author picks. `rows` is JSON: an array of objects, e.g.
 * `[{"LineItemMaterialField":"MAT-A","LineItemPlantField":"1710"}]`. A row can omit
 * a key (or leave its value blank) to skip that cell for that row — e.g. leaving a
 * net price column out lets the backend auto-derive it rather than forcing a 0.00.
 * These are grid-table cells, looked up by (table id, column id, row index) rather
 * than a per-cell id — see ControlDefinition.tableId.
 */
export const AddLineItem: Module = {
  name: 'AddLineItem',
  describe: {
    label: 'Add Line Item(s)',
    category: 'Procurement',
    description:
      'Adds one or more rows to whatever grid-table you point it at. Each row is built from the table-column ' +
      'objects you pick — there\'s no fixed set of columns, so this same module works for a Purchase Order\'s ' +
      'item table, a Sales Order\'s, an Invoice\'s, or any other grid. Leave a cell blank to skip it (e.g. to let ' +
      'a price auto-derive instead of forcing 0.00).',
    params: [
      {
        key: 'addButtonField',
        // "Add button (object name)" said what to type, not what it does. The control this
        // names is the grid's own add-a-row button — the "Add Row" / "Create" control in the
        // table toolbar — and it is what "When to click Add" is timed against.
        label: 'The grid’s add-a-row button',
        required: false,
        placeholder: 'default: AddLineItemButton',
        objectKind: ['clickable'],
        default: 'AddLineItemButton',
      },
      { key: 'rows', label: 'Rows', required: true },
      { key: 'lineItemCountKey', label: 'Line count (runState key)', required: false, placeholder: 'default: lineItemCount', literalOnly: true, advanced: true, default: 'lineItemCount' },
      {
        key: 'addClickTiming',
        label: 'When to click Add relative to filling the row',
        required: false,
        placeholder: 'before (default) or after', type: 'enum', options: ['before', 'after'] },
    ],
    narrate: ({ params }) => {
      try {
        const rows = JSON.parse(params.rows);
        return `Added ${rows.length} line item row${rows.length === 1 ? '' : 's'}`;
      } catch {
        return 'Added line item row(s)';
      }
    },
  },
  async execute({ adapter, objectRepository, appId, params, runState, evidenceDir, onChildProgress }) {
    let rows: Record<string, string>[];
    try {
      rows = JSON.parse(params.rows);
    } catch {
      throw new Error('AddLineItem: "rows" must be valid JSON — an array of {object name: value} rows.');
    }
    if (!Array.isArray(rows) || rows.length === 0) {
      throw new Error('AddLineItem: at least one row is required.');
    }

    const addButtonField = params.addButtonField || 'AddLineItemButton';
    // Most grid tables need "click Add" to create the empty row before it can be filled — but
    // some Fiori Elements v4 (MDC) tables render an always-present "Creation Row" instead: a
    // single reusable inline-add form you fill first, then click Add to commit it as a real row
    // (which is also what makes that Add control enabled in the first place — it's disabled
    // until the row has a value). Found via a real capture on Manage Sales Orders V2.
    const clickAfter = params.addClickTiming === 'after';
    const evidence = { evidenceDir, runState };
    for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
      const rowKey = String(
        rows[rowIndex].lineNumber
        ?? rows[rowIndex].itemNumber
        ?? rows[rowIndex].product
        ?? rowIndex + 1
      );
      await onChildProgress?.({
        label: 'Line items',
        completed: rowIndex,
        total: rows.length,
        currentIndex: rowIndex,
        currentKey: rowKey,
        status: 'running',
      });
      try {
        if (!clickAfter) await clickControl(adapter, objectRepository, appId, addButtonField);
        for (const [fieldName, value] of Object.entries(rows[rowIndex])) {
          if (!value) continue;
          await fillTableCell(adapter, objectRepository, appId, fieldName, rowIndex, value, undefined, evidence);
        }
        if (clickAfter) await clickControl(adapter, objectRepository, appId, addButtonField);
        await onChildProgress?.({
          label: 'Line items',
          completed: rowIndex + 1,
          total: rows.length,
          currentIndex: rowIndex,
          currentKey: rowKey,
          status: 'passed',
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await onChildProgress?.({
          label: 'Line items',
          completed: rowIndex,
          total: rows.length,
          currentIndex: rowIndex,
          currentKey: rowKey,
          status: 'failed',
          error: message,
        });
        throw new Error(`AddLineItem failed at child row ${rowIndex + 1}${rowKey ? ` (${rowKey})` : ''}: ${message}`);
      }
    }

    runState[params.lineItemCountKey ?? 'lineItemCount'] = rows.length;
  },
};
