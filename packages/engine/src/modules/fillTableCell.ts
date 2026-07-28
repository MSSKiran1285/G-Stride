import { Module } from '../module';
import { fillTableCell } from '../controlAccess';

const RESPONSIVE_TABLE_STYLE = { columnAttr: 'data-sap-ui-column', rowIndexAttr: 'aria-rowindex' };

/**
 * Fills a single cell in a grid/table by (captured column object, row index) — for rows that
 * already exist on screen (e.g. a delivery's pre-populated item list), unlike AddLineItem,
 * which always clicks an "add" control first to create a new row. Reusable for any case
 * needing one or two known-index rows filled directly — e.g. Picking Quantity per delivery
 * item — without the row-creation semantics AddLineItem is built around.
 */
export const FillTableCell: Module = {
  name: 'FillTableCell',
  describe: {
    label: 'Fill Table Cell',
    category: 'Built-In Modules',
    description: "Fills a single cell in a grid/table by (column object, row index) — for a row that already exists, unlike Add Line Item(s).",
    params: [
      { key: 'field', label: 'Column (object repository name)', required: true, objectKind: ['tableColumn'] },
      { key: 'rowIndex', label: 'Row index', required: false, placeholder: 'default: 0' },
      { key: 'value', label: 'Value', required: true },
      { key: 'gridTable', label: 'Grid table (sap.ui.table.Table) instead of responsive', required: false, placeholder: 'false' },
    ],
    narrate: ({ params }) => `Entered ${params.field} (row ${params.rowIndex ?? '0'}) = "${params.value}"`,
  },
  async execute({ adapter, objectRepository, appId, params, runState, evidenceDir }) {
    const rowIndex = Number(params.rowIndex ?? '0');
    const style = params.gridTable === 'true' ? undefined : RESPONSIVE_TABLE_STYLE;
    await fillTableCell(adapter, objectRepository, appId, params.field, rowIndex, params.value, style, { evidenceDir, runState });
  },
};
