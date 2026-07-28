import { Module } from '../module';
import { waitForControl, fillControl, clickControl } from '../controlAccess';

/**
 * Logs into the SAP system. Control ids belong to the identity provider's
 * login page, not the target Fiori app, so they're stored under the fixed
 * appId "login" in the object repository. (Note: it's a plain HTML page, not
 * UI5, so self-healing doesn't apply here — there's no sap.ui control registry
 * to fuzzy-match against.)
 *
 * SAP ID (Cloud Identity Authentication) is a two-step wizard, not a single
 * form: enter username, click Continue/Sign In, THEN the password field
 * renders — so it needs a wait between the two fills, and clicks the same
 * submit control twice.
 */
export const Login: Module = {
  name: 'Login',
  describe: {
    label: 'Login',
    category: 'Built-In Modules',
    description: 'Logs into the SAP system via the two-step SAP ID wizard (username, then password).',
    params: [
      { key: 'url', label: 'Tenant URL', required: true },
      { key: 'username', label: 'Username', required: true },
      { key: 'password', label: 'Password', required: true },
    ],
    // Deliberately doesn't echo username/password — same reasoning as the noEvidence
    // fill below: keep credentials out of anything that ends up in a report.
    narrate: () => 'Logged into the SAP tenant',
  },
  async execute({ adapter, objectRepository, params }) {
    // Deliberately never captures field evidence — fillControl's evidence param is
    // required everywhere else specifically so a module can't silently omit it by
    // accident (see PROJECT_BRIEF_v2.0.md BL-13), but a screenshot/caption of this
    // fill would put the username and, worse, the plaintext password into the
    // evidence PDF. This is the one deliberate, explicit exception.
    const noEvidence = { evidenceDir: undefined, runState: undefined };

    await adapter.open(params.url);

    await waitForControl(adapter, objectRepository, 'login', 'UsernameField');
    await fillControl(adapter, objectRepository, 'login', 'UsernameField', params.username, undefined, noEvidence);
    await clickControl(adapter, objectRepository, 'login', 'SubmitButton');

    await waitForControl(adapter, objectRepository, 'login', 'PasswordField');
    await fillControl(adapter, objectRepository, 'login', 'PasswordField', params.password, undefined, noEvidence);
    await clickControl(adapter, objectRepository, 'login', 'SubmitButton');

    // The final submit triggers a multi-hop redirect chain back to the tenant. Without
    // this, callers that touch the page immediately after Login (e.g. an OData query)
    // can race an in-flight top-level navigation and lose their JS execution context.
    await adapter.waitForPageSettled();
  },
};
