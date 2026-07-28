import { Module } from '../module';
import { waitForControl, clickControl } from '../controlAccess';

/** Clicks a control identified by logical name in the object repository — reusable for any button-like action. */
export const ClickButton: Module = {
  name: 'ClickButton',
  describe: {
    label: 'Click Button',
    category: 'Built-In Modules',
    description: 'Clicks a control identified by its logical name in the object repository.',
    params: [{ key: 'control', label: 'Control name', required: true, placeholder: 'e.g. CreateButton', objectKind: ['clickable'] }],
    narrate: ({ params }) => `Clicked "${params.control}"`,
  },
  async execute({ adapter, objectRepository, appId, params }) {
    await waitForControl(adapter, objectRepository, appId, params.control);
    await clickControl(adapter, objectRepository, appId, params.control);
  },
};
