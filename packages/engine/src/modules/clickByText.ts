import { Module } from '../module';

/**
 * Clicks any control on the page by its visible text, without needing a
 * stored object-repository control id — for buttons that only exist on a
 * transient view (e.g. the "Post" button on the Simulation Results page,
 * distinct from the entry screen's own Post button), or whose id regenerates
 * every page load (so it could never be saved into the object repository
 * reliably in the first place).
 */
export const ClickByText: Module = {
  name: 'ClickByText',
  describe: {
    label: 'Click by Text',
    category: 'Built-In Modules',
    description: 'Clicks any visible control by its text — for buttons on a transient view, or with an unstable id.',
    params: [
      { key: 'text', label: 'Button/control text', required: true },
      { key: 'timeoutMs', label: 'Timeout (ms)', required: false, placeholder: '10000' },
      {
        key: 'matchMode',
        label: 'Match mode',
        required: false,
        placeholder: 'exact (default) or contains — for text with a dynamic suffix, e.g. "Copy Picking Quantity (2)"',
      },
    ],
    narrate: ({ params }) => `Clicked "${params.text}"`,
  },
  async execute({ adapter, params }) {
    const matchMode = params.matchMode === 'contains' ? 'contains' : 'exact';
    await adapter.clickByText(params.text, Number(params.timeoutMs ?? '10000'), matchMode);
  },
};
