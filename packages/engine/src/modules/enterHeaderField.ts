import { Module } from '../module';
import { waitForControl, fillControl } from '../controlAccess';

/** Fills a single header field, looked up by logical name in the current app's object repository entries. */
export const EnterHeaderField: Module = {
  name: 'EnterHeaderField',
  describe: {
    label: 'Enter Header Field',
    category: 'Built-In Modules',
    description: 'Fills a single header field, looked up by its logical name in the object repository.',
    params: [
      {
        key: 'field',
        label: 'Field (object repository name)',
        required: true,
        placeholder: 'e.g. SupplierField',
        objectKind: ['fillable', 'toggleable'],
      },
      { key: 'value', label: 'Value', required: true },
      { key: 'pressKey', label: 'Key to press after filling (e.g. Enter)', required: false, placeholder: 'none', literalOnly: true },
    ],
    narrate: ({ params }) => `Entered ${params.field} = "${params.value}"`,
  },
  async execute({ adapter, objectRepository, appId, params, runState, evidenceDir }) {
    await waitForControl(adapter, objectRepository, appId, params.field);
    const options = params.pressKey ? { pressKey: params.pressKey } : undefined;
    await fillControl(adapter, objectRepository, appId, params.field, params.value, options, { evidenceDir, runState });
  },
};
