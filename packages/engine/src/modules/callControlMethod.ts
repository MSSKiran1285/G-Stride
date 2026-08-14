import { Module } from '../module';

/**
 * Calls a UI5 control's own JS API method directly (e.g. a table's selectAll()) — for
 * actions that don't map cleanly onto a normal click/fill, because the rendered DOM
 * element doesn't reliably drive the same behavior a real API call does. Found on a
 * due-list's "select all" header checkbox: its native <input> renders at zero size (the
 * visible box is a separate sibling), and even a script-dispatched click on it toggled
 * only its own visual state — never the underlying table's selectionChange handling
 * that a "Create Deliveries" button's enabled-state binding depends on. Calling the
 * table's own selectAll() sidesteps DOM interaction (and its actionability/trust-event
 * quirks) entirely by using the same API a real user interaction ultimately triggers.
 *
 * method:"selectAll" specifically routes to IAutomationAdapter.selectAllInTable rather
 * than a bare zero-arg call — verified live that selectAll() alone updates the table's
 * own selection state but never fires the selectionChange event a dependent button's
 * enabled binding actually listens for; selectAllInTable does both, matching what a real
 * user click triggers in one gesture.
 */
export const CallControlMethod: Module = {
  name: 'CallControlMethod',
  describe: {
    label: 'Call Control Method',
    category: 'Built-In Modules',
    description:
      "Calls a UI5 control's own JS API method directly (e.g. selectAll()) — for actions that don't map cleanly onto a click/fill.",
    params: [
      { key: 'field', label: 'Field (object repository name)', required: true },
      { key: 'method', label: 'Method name', required: false, placeholder: 'default: selectAll' },
      { key: 'target', label: 'Target', required: false, placeholder: "parent (default) or self", type: 'enum', options: ['parent', 'self'] },
    ],
    narrate: ({ params }) => `Called ${params.method ?? 'selectAll'}() on ${params.field}`,
  },
  async execute({ adapter, objectRepository, appId, params }) {
    const control = objectRepository.get(appId, params.field);
    const targetId = params.target === 'self' ? control.controlId : control.parentControlId ?? control.controlId;
    const method = params.method ?? 'selectAll';
    if (method === 'selectAll') {
      await adapter.selectAllInTable(targetId);
    } else {
      await adapter.callControlMethod(targetId, method);
    }
  },
};
