import { Module } from '../module';

/**
 * Navigates directly to an app's deep-link URL rather than clicking a Launchpad
 * tile — deep links don't depend on the user's personalized Spaces/Pages layout,
 * which can change independently of the app itself.
 */
export const NavigateToApp: Module = {
  name: 'NavigateToApp',
  describe: {
    label: 'Navigate to App',
    category: 'Built-In Modules',
    description: "Deep-links into a Fiori app by URL, then waits for the app's own OData metadata to settle.",
    // appUrl: the form offers the entry points already learned for this step's App ID, so the
    // author recognises the screen instead of retyping a 100-character launchpad URL.
    params: [{ key: 'url', label: 'App URL', required: true, type: 'appUrl' }],
    narrate: ({ params }) => `Navigated to ${params.url}`,
  },
  async execute({ adapter, params }) {
    await adapter.navigate(params.url);
    // navigate() only waits for domcontentloaded — the app's own OData metadata
    // (which SmartFields need before their real <input> attaches) loads async
    // after that, so give it a chance to settle before any caller interacts.
    await adapter.waitForPageSettled();
  },
};
