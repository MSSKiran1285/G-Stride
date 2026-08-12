'use strict';

const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const { api, assertServerReachable, BASE_URL } = require('../lib/apiClient');
const { withBrowser, withPage } = require('../lib/browserSession');

before(assertServerReachable);

// The Test this creates is removed again afterwards: the Test Library tree and the Automation
// Overview both read the real workspace, so a stray draft would fail an unrelated file.
async function withTestCase(file, testCase, body) {
  await api.put(`/api/testcases/${file}`, testCase);
  try {
    await body();
  } finally {
    await api.delete(`/api/testcases/${file}?force=true`).catch(() => undefined);
  }
}

// apiClient.get returns the whole response envelope, so the tag map is under .body.
const tagOf = async (file) => (await api.get('/api/tags/testCase')).body[file];

// Folder names distinctive enough that they cannot collide with fixture or workspace data.
const SOURCE_AREA = 'DndSourceArea';
const TARGET_AREA = 'DndTargetArea';

test('a Test can be dragged between process area folders, and out of one entirely', async () => {
  const file = 'dnd-move-regression.json';
  // The test owns both folders rather than borrowing whatever the workspace happens to contain.
  for (const area of [SOURCE_AREA, TARGET_AREA]) {
    await api.post('/api/process-areas', { name: area }).catch(() => undefined);
  }
  try {
    await withTestCase(file, { name: 'Drag And Drop Regression', application: 'SAP', version: 1, lifecycle: 'draft', steps: [] }, async () => {
      await api.put(`/api/tags/testCase/${file}`, { processArea: SOURCE_AREA });

      await withBrowser(async (browser) => {
        await withPage(browser, 'test-library-drag-drop', async (page) => {
          await page.goto(`${BASE_URL}/compose`);
          const tree = page.locator('.obj-lib-tree-aside');
          await tree.locator('.obj-tree-folder-row', { hasText: SOURCE_AREA }).click();

          const dragged = tree.locator('.obj-tree-child-item', { hasText: 'Drag And Drop Regression' });
          await dragged.waitFor();

          // Dropping on a folder retags the Test to that process area.
          await dragged.dragTo(tree.locator('.obj-tree-folder-row', { hasText: TARGET_AREA }));
          await tree
            .locator('.tree-folder-group', { hasText: TARGET_AREA })
            .locator('.obj-tree-child-item', { hasText: 'Drag And Drop Regression' })
            .waitFor();
          assert.equal(await tagOf(file), TARGET_AREA, 'the drop should persist the new process area');

          // (untagged) is a view of "no process area", so dropping there clears the tag rather than
          // storing "(untagged)" as though it were a real folder.
          const moved = tree.locator('.obj-tree-child-item', { hasText: 'Drag And Drop Regression' });
          await moved.dragTo(tree.locator('.obj-tree-folder-row', { hasText: '(untagged)' }));
          await tree
            .locator('.tree-folder-group', { hasText: '(untagged)' })
            .locator('.obj-tree-child-item', { hasText: 'Drag And Drop Regression' })
            .waitFor();
          assert.equal(await tagOf(file) || '', '', 'drop on (untagged) should clear the process area');
        });
      });
    });
  } finally {
    for (const area of [SOURCE_AREA, TARGET_AREA]) {
      await api.delete(`/api/process-areas/${encodeURIComponent(area)}`).catch(() => undefined);
    }
  }
});

test('Test Library filters by name, process area, application and readiness', async () => {
  await api.put('/api/tags/testCase/create-po.json', { processArea: 'Procurement' });

  await withBrowser(async (browser) => {
    await withPage(browser, 'test-library-filters', async (page) => {
      await page.goto(`${BASE_URL}/compose`);
      await page.getByRole('heading', { name: 'Test Library' }).waitFor();

      // The explorer tree is the process-area filter now, so narrowing means opening the folder.
      await page.locator('.obj-lib-tree-aside .obj-tree-folder-row', { hasText: 'Procurement' }).click();
      await page.getByLabel('Filter by application').selectOption('SAP');
      await page.getByLabel('Filter by status').selectOption('ready');
      await page.getByLabel('Search').fill('purchase order');

      const results = page.getByRole('region', { name: 'Test Library results' });
      const createPoRow = results.locator('tr', { hasText: 'create-po.json' });
      await createPoRow.waitFor();
      assert.match(await createPoRow.innerText(), /Create Purchase Order - Happy Path/);
      assert.match(await createPoRow.innerText(), /Procurement/);
      assert.match(await createPoRow.innerText(), /ready/i);

      await page.getByLabel('Filter by status').selectOption('draft');
      await results.getByText('No Tests match the current filters.').waitFor();
    });
  });
});

test('guided creation copies a template and restores the stable Test route', async () => {
  await withBrowser(async (browser) => {
    await withPage(browser, 'test-library-template-create', async (page) => {
      await page.goto(`${BASE_URL}/compose`);
      await page.getByRole('button', { name: 'Compose New Test' }).click();
      await page.getByLabel('Test name').fill('Template Clone Regression');
      await page.getByLabel('Test application').selectOption('Oracle');
      // Process area is a folder dropdown now, so a brand-new area is created through it.
      await page.getByLabel('Process area').selectOption('__new_process_area__');
      await page.getByLabel('New folder name').fill('Finance');
      await page.getByRole('button', { name: 'Create Folder' }).click();
      await page.getByLabel('Starting point').selectOption('template');
      await page.getByLabel('Template Test').selectOption('cleanup-abandoned-drafts.json');
      await page.getByRole('button', { name: 'Create Test' }).click();

      await page.waitForURL('**/compose/tests/template-clone-regression.json');
      assert.equal(await page.getByLabel('Test name').inputValue(), 'Template Clone Regression');
      assert.equal(await page.getByLabel('Test application').inputValue(), 'Oracle');
      await page.locator('.step-module', { hasText: 'Wait' }).waitFor();

      await page.reload();
      await page.getByLabel('Test name').waitFor();
      assert.equal(await page.getByLabel('Test application').inputValue(), 'Oracle');
      await page.getByRole('button', { name: 'Back to Test Library' }).click();

      await page.getByLabel('Filter by application').selectOption('Oracle');
      await page.locator('.obj-lib-tree-aside .obj-tree-folder-row', { hasText: 'Finance' }).click();
      const results = page.getByRole('region', { name: 'Test Library results' });
      const cloneRow = results.locator('tr', { hasText: 'template-clone-regression.json' });
      await cloneRow.waitFor();
      assert.match(await cloneRow.innerText(), /draft/i);
    });
  });
});
