'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { withBrowser, withPage } = require('./lib/browserSession');
const { inspectUi5Controls } = require('../packages/adapter-fiori/dist');

// Real finding: the Fiori Launchpad keeps a previously-opened app's whole UI5 component alive
// in the DOM (hidden, not destroyed) after navigating to a different app. A live capture on
// createPurchaseRequisition's own tenant — after navigating Home -> Procurement -> Process
// Purchase Requisitions — still contained 40 sap.m.GenericTile controls from the Home page,
// none destroyed, all still resolving through core.byId(). This stub reproduces that shape
// with a minimal fake UI5 core rather than a real Fiori app: a visible control, one hidden via
// its own display:none, and one hidden via a hidden ancestor (the actual real-world shape —
// the whole kept-alive component subtree hidden at its root, not each control individually).
const STUB_HTML = `<!doctype html>
<html>
<body>
  <div id="visible-tile">Visible</div>
  <div id="self-hidden-tile" style="display:none">Self hidden</div>
  <div id="hidden-ancestor" style="display:none">
    <div id="stale-tile">Stale kept-alive tile</div>
  </div>
  <script>
    function makeControl(id, controlType, text) {
      return {
        getId: () => id,
        getMetadata: () => ({ getName: () => controlType }),
        getText: () => text,
        getDomRef: () => document.getElementById(id),
      };
    }
    const registry = {
      'visible-tile': makeControl('visible-tile', 'sap.m.GenericTile', 'Visible'),
      'self-hidden-tile': makeControl('self-hidden-tile', 'sap.m.GenericTile', 'Self hidden'),
      'stale-tile': makeControl('stale-tile', 'sap.m.GenericTile', 'Stale kept-alive tile'),
    };
    window.sap = { ui: { getCore: () => ({ byId: (id) => registry[id] }) } };
  </script>
</body>
</html>`;

test('inspectUi5Controls excludes controls whose DOM element is not actually rendered (kept-alive stale components)', async () => {
  await withBrowser(async (browser) => {
    await withPage(browser, 'ui5-inspector-visibility', async (page) => {
      await page.setContent(STUB_HTML);
      const controls = await inspectUi5Controls(page);
      const ids = controls.map((c) => c.controlId);

      assert.ok(ids.includes('visible-tile'), 'expected the genuinely visible control to be captured');
      assert.ok(!ids.includes('self-hidden-tile'), 'expected a display:none control to be excluded');
      assert.ok(!ids.includes('stale-tile'), 'expected a control inside a hidden ancestor (the real kept-alive shape) to be excluded');
    });
  });
});
