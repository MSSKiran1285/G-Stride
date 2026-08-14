import { Module } from '../module';
import { clickTableCell } from '../controlAccess';

const RESPONSIVE_TABLE_STYLE = { columnAttr: 'data-sap-ui-column', rowIndexAttr: 'aria-rowindex' };

/**
 * Clicks a single grid/table cell by (captured column object, row index) — the generic
 * counterpart to ClickButton for controls that live inside a table rather than standing
 * alone. Reusable wherever a cell click opens something (a value-help dialog, a quick-view
 * popover, a navigation link) rather than needing a value typed into it — SelectStorageLocation
 * already did exactly this but hardcoded to one specific column; this is the same mechanism
 * generalized. Defaults to the responsive-table (sap.m.Table) attribute convention, since
 * that's what a delivery/log worklist typically renders — override via `gridTable: "true"` for
 * a sap.ui.table.Table-backed column instead.
 */
export const ClickTableCell: Module = {
  name: 'ClickTableCell',
  describe: {
    label: 'Click Table Cell',
    category: 'Built-In Modules',
    description: 'Clicks a single cell in a grid/table by (column object, row index) — for a cell that opens something rather than needing a typed value.',
    params: [
      { key: 'field', label: 'Column (object repository name)', required: true, objectKind: ['tableColumn'] },
      { key: 'rowIndex', label: 'Row index', required: false, placeholder: 'default: 0', type: 'number', advanced: true, default: '0' },
      { key: 'gridTable', label: 'Grid table (sap.ui.table.Table) instead of responsive', required: false, placeholder: 'false', type: 'boolean', advanced: true, default: 'false' },
    ],
    narrate: ({ params }) => `Clicked ${params.field} (row ${params.rowIndex ?? '0'})`,
  },
  async execute({ adapter, objectRepository, appId, params }) {
    const rowIndex = Number(params.rowIndex ?? '0');
    const style = params.gridTable === 'true' ? undefined : RESPONSIVE_TABLE_STYLE;
    await clickTableCell(adapter, objectRepository, appId, params.field, rowIndex, style);
  },
};
