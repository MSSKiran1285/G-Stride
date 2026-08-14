import { Module } from '../module';

/**
 * Selects (checks) a specific row's own checkbox in a table — for row selection, distinct
 * from filling/clicking a business-data cell. Needs any already-captured column from the
 * target table (just to resolve the table's own id via tableId — the column itself isn't
 * touched) since the selection checkbox is a UI5-internal cell with no business meaning of
 * its own, not something you'd capture directly. See IAutomationAdapter.selectTableRow for
 * why this exists as its own mechanism rather than clicking a captured checkbox object: a
 * table's "select all" HEADER checkbox was found to visually toggle without the underlying
 * Fiori Elements template's own selection tracking picking it up, while selecting the row
 * directly works correctly.
 */
export const SelectTableRow: Module = {
  name: 'SelectTableRow',
  describe: {
    label: 'Select Table Row',
    category: 'Built-In Modules',
    description:
      "Selects (checks) a specific row's own checkbox in a table. Needs any captured column from that table, just to identify which table.",
    params: [
      { key: 'field', label: 'Any column in that table (object repository name)', required: true, objectKind: ['tableColumn'] },
      { key: 'rowIndex', label: 'Row index', required: false, placeholder: 'default: 0', type: 'number', advanced: true, default: '0' },
    ],
    narrate: ({ params }) => `Selected row ${params.rowIndex ?? '0'}`,
  },
  async execute({ adapter, objectRepository, appId, params }) {
    const control = objectRepository.get(appId, params.field);
    if (!control.tableId) {
      throw new Error(`SelectTableRow: "${params.field}" is not a table column (no tableId) — pick a captured column from the target table.`);
    }
    await adapter.selectTableRow(control.tableId, Number(params.rowIndex ?? '0'));
  },
};
