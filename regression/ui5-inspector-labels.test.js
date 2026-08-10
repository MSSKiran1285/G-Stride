'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { withBrowser, withPage } = require('./lib/browserSession');
const { inspectUi5Controls, classifyControl } = require('../packages/adapter-fiori/dist');

// Real finding, live on this tenant's My Timesheet screen (4 Aug 2026): of the 11 buttons
// captured there, 8 had no text of any kind — alertBtn, copyBtn, settingsBtn, groupTasks,
// msgPopoverBtn and friends are all icon-only. Capture was therefore surfacing them to callers as
// model a list of raw control ids ("...timesheetMain--copyBtn") to choose between; it picked
// one, which registered into the Object Repository under the name "Button" and then reported
// itself back as `Already clicked "undefined"`.
//
// The meaning of an icon-only button lives in its tooltip (which is also what a screen reader
// announces) and failing that in the icon name, neither of which the capture was reading.
const STUB_HTML = `<!doctype html>
<html>
<body>
  <div id="tooltip-button">icon</div>
  <div id="icon-only-button">icon</div>
  <div id="text-wins-button">Save &amp; Submit</div>
  <div id="tooltipped-layout">layout</div>
  <div id="task-row">Administration Tasks</div>
  <script>
    function makeControl(id, controlType, props) {
      return {
        getId: () => id,
        getMetadata: () => ({ getName: () => controlType }),
        getText: () => props.text,
        getTitle: () => props.title,
        getTooltip_Text: () => props.tooltip,
        getIcon: () => props.icon,
        getDomRef: () => document.getElementById(id),
      };
    }
    const registry = {
      'tooltip-button': makeControl('tooltip-button', 'sap.m.Button', { tooltip: 'Copy Previous Week' }),
      'icon-only-button': makeControl('icon-only-button', 'sap.m.Button', { icon: 'sap-icon://add-activity' }),
      'text-wins-button': makeControl('text-wins-button', 'sap.m.Button', { text: 'Save & Submit', tooltip: 'Submit the timesheet' }),
      // A layout container whose only "text" is screen-reader labelling — the exact shape
      // ALWAYS_STRUCTURAL_TYPES exists to guard against. A tooltip here must not turn it into
      // something the loop believes is worth acting on.
      'tooltipped-layout': makeControl('tooltipped-layout', 'sap.m.VBox', { tooltip: 'Toggle header' }),
      'task-row': makeControl('task-row', 'sap.m.ObjectListItem', { title: 'Administration Tasks' }),
    };
    window.sap = { ui: { getCore: () => ({ byId: (id) => registry[id] }) } };
  </script>
</body>
</html>`;

test('an icon-only button takes its label from its tooltip, so the model never sees a raw control id', async () => {
  await withBrowser(async (browser) => {
    await withPage(browser, 'ui5-inspector-labels-tooltip', async (page) => {
      await page.setContent(STUB_HTML);
      const controls = await inspectUi5Controls(page);
      const byId = new Map(controls.map((c) => [c.controlId, c]));

      assert.equal(byId.get('tooltip-button').text, 'Copy Previous Week');
    });
  });
});

test('an icon-only button with no tooltip falls back to a readable form of its icon name', async () => {
  await withBrowser(async (browser) => {
    await withPage(browser, 'ui5-inspector-labels-icon', async (page) => {
      await page.setContent(STUB_HTML);
      const controls = await inspectUi5Controls(page);
      const byId = new Map(controls.map((c) => [c.controlId, c]));

      assert.equal(byId.get('icon-only-button').text, 'add activity');
    });
  });
});

test("a control's own text always wins over its tooltip", async () => {
  await withBrowser(async (browser) => {
    await withPage(browser, 'ui5-inspector-labels-precedence', async (page) => {
      await page.setContent(STUB_HTML);
      const controls = await inspectUi5Controls(page);
      const byId = new Map(controls.map((c) => [c.controlId, c]));

      assert.equal(byId.get('text-wins-button').text, 'Save & Submit');
    });
  });
});

test('a tooltip on pure layout scaffolding never becomes a label, and never promotes it out of structural', async () => {
  await withBrowser(async (browser) => {
    await withPage(browser, 'ui5-inspector-labels-scaffolding', async (page) => {
      await page.setContent(STUB_HTML);
      const controls = await inspectUi5Controls(page);
      const byId = new Map(controls.map((c) => [c.controlId, c]));

      const layout = byId.get('tooltipped-layout');
      assert.equal(layout.text, undefined, 'screen-reader-only tooltip text must not become a display label');
      assert.equal(layout.category, 'structural');
    });
  });
});

test('the raw tooltip/icon fields never leak out of the capture — they exist only to feed the label fallback', async () => {
  await withBrowser(async (browser) => {
    await withPage(browser, 'ui5-inspector-labels-no-leak', async (page) => {
      await page.setContent(STUB_HTML);
      const controls = await inspectUi5Controls(page);

      for (const control of controls) {
        assert.ok(!('tooltip' in control), `${control.controlId} still carries a raw tooltip field`);
        assert.ok(!('icon' in control), `${control.controlId} still carries a raw icon field`);
      }
    });
  });
});

// Real finding from the same live run: the instruction said "select the task", and the four
// tasks on screen ("Administration Tasks", "Miscellaneous", "Training", "Travel Times") were all
// captured cleanly, with stable ids and correct titles — as sap.m.ObjectListItem, which
// classified as merely informational. So the one thing the instruction actually needed was
// never offered as something that could be acted on at all.
test('a list row is actionable — "select the task" has to be able to reach it', async () => {
  await withBrowser(async (browser) => {
    await withPage(browser, 'ui5-inspector-labels-listitem', async (page) => {
      await page.setContent(STUB_HTML);
      const controls = await inspectUi5Controls(page);
      const byId = new Map(controls.map((c) => [c.controlId, c]));

      const row = byId.get('task-row');
      assert.equal(row.text, 'Administration Tasks');
      assert.equal(row.category, 'actionable');
    });
  });
});

test('classifyControl treats the whole sap.m list-item family as actionable, not just ObjectListItem', () => {
  for (const controlType of [
    'sap.m.StandardListItem',
    'sap.m.ObjectListItem',
    'sap.m.CustomListItem',
    'sap.m.ColumnListItem',
    'sap.m.DisplayListItem',
    'sap.m.ActionListItem',
    'sap.m.InputListItem',
    'sap.m.FeedListItem',
  ]) {
    assert.equal(
      classifyControl({ controlId: 'app--view--someList-0', controlType, text: 'A row' }),
      'actionable',
      `${controlType} should be actionable`
    );
  }
});
