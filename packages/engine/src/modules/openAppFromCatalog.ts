import { Module } from '../module';

/**
 * Opens an app via the Fiori Launchpad App Finder catalog rather than a bare
 * deep-link URL — some apps (e.g. Post Goods Receipt for Purchasing Document)
 * don't resolve reliably from a bookmark alone and need the catalog navigation
 * flow instead.
 */
export const OpenAppFromCatalog: Module = {
  name: 'OpenAppFromCatalog',
  describe: {
    label: 'Open App from Catalog',
    category: 'Built-In Modules',
    description: "Opens a Fiori app via the Launchpad App Finder — for apps that don't resolve reliably from a bare deep link.",
    params: [
      { key: 'catalogUrl', label: 'Catalog URL', required: true },
      { key: 'appTitle', label: 'App tile title', required: true },
    ],
    narrate: ({ params }) => `Opened "${params.appTitle}" from the App Finder`,
  },
  async execute({ adapter, params }) {
    await adapter.openAppFromCatalog(params.catalogUrl, params.appTitle);
  },
};
