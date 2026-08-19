'use strict';

/**
 * The Object Library has to survive a move between machines.
 *
 * Every SQLite store in this product is gitignored, so cloning the repository onto a second
 * machine brings the Tests and none of the controls they name: the Object Library comes up with
 * zero controls and the first object lookup of the first Test fails. That is not hypothetical —
 * it is exactly what happened moving this project between two PCs on 19 Aug 2026.
 *
 * `objects export` writes the library as reviewable JSON that IS committed, and `objects import`
 * loads it. These tests pin what "the same library" has to mean, because three of the four parts
 * are easy to lose and none of them announces its absence:
 *
 *   - the controls themselves, with the locator fields a run depends on
 *   - the entry-point URLs NavigateToApp offers, which are learned rather than authored
 *   - the App ID process-area tags, without which every App ID lands in "(untagged)"
 *   - the display order, which lives in a sort_order column that ControlDefinition does not
 *     carry, so upsert cannot restore it and it has to be replayed through reorder()
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, rmSync, writeFileSync, readFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { ObjectRepository, TagStore } = require('../packages/core/dist');

function workspace() {
  const dir = mkdtempSync(path.join(tmpdir(), 'object-library-'));
  return {
    dir,
    objects: path.join(dir, 'objects.db'),
    tags: path.join(dir, 'tags.db'),
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

function control(appId, name, overrides = {}) {
  return {
    appId,
    name,
    controlId: `${name}-id`,
    bindingPath: null,
    controlType: 'sap.m.Input',
    tableId: null,
    label: `${name} label`,
    parentControlId: null,
    ...overrides,
  };
}

/** The export/import shape, exercised through the same repository API the CLI uses. */
function exportLibrary(objectsDb, tagsDb) {
  const repo = new ObjectRepository(objectsDb);
  const tags = new TagStore(tagsDb);
  try {
    const controls = [];
    const entryPoints = [];
    const order = {};
    for (const appId of repo.listAppIds()) {
      order[appId] = repo.listByApp(appId).map((c) => c.name);
      for (const c of repo.listByApp(appId)) controls.push(c);
      for (const e of repo.listEntryPoints(appId)) entryPoints.push({ appId, url: e.url });
    }
    return {
      formatVersion: 1,
      exportedAt: new Date().toISOString(),
      controls,
      entryPoints,
      verifications: [],
      order,
      appIdTags: tags.listTags('appId'),
      processAreas: tags.listProcessAreas(),
    };
  } finally {
    repo.close();
    tags.close();
  }
}

function importLibrary(payload, objectsDb, tagsDb) {
  const repo = new ObjectRepository(objectsDb);
  const tags = new TagStore(tagsDb);
  try {
    for (const c of payload.controls) repo.upsert(c);
    for (const e of payload.entryPoints ?? []) repo.recordEntryPoint(e.appId, e.url);
    for (const [appId, names] of Object.entries(payload.order ?? {})) {
      if (names.length) repo.reorder(appId, names);
    }
    for (const area of payload.processAreas ?? []) tags.addProcessArea(area);
    for (const [appId, area] of Object.entries(payload.appIdTags ?? {})) tags.setTag('appId', appId, area);
  } finally {
    repo.close();
    tags.close();
  }
}

test('a library exported on one machine arrives complete on an empty one', () => {
  const source = workspace();
  const target = workspace();
  try {
    const repo = new ObjectRepository(source.objects);
    const tags = new TagStore(source.tags);
    repo.upsert(control('createSalesOrder', 'soldToPartyField'));
    repo.upsert(control('createSalesOrder', 'salesOrderTypeField'));
    repo.upsert(control('createSalesOrder', 'lineItemProductField', {
      controlType: 'sap.ui.table.Column',
      tableId: 'items-table',
    }));
    repo.recordEntryPoint('createSalesOrder', '${urlBase}/ui#SalesOrder-manage');
    tags.addProcessArea('Sales');
    tags.setTag('appId', 'createSalesOrder', 'Sales');
    repo.close();
    tags.close();

    const payload = exportLibrary(source.objects, source.tags);
    importLibrary(payload, target.objects, target.tags);

    const targetRepo = new ObjectRepository(target.objects);
    const targetTags = new TagStore(target.tags);
    try {
      assert.deepEqual(targetRepo.listAppIds(), ['createSalesOrder']);
      const arrived = targetRepo.listByApp('createSalesOrder');
      assert.equal(arrived.length, 3);

      // The locator fields are what a run actually needs; a control that arrives without its
      // tableId cannot fill a grid cell.
      const lineItem = arrived.find((c) => c.name === 'lineItemProductField');
      assert.equal(lineItem.tableId, 'items-table');
      assert.equal(lineItem.controlType, 'sap.ui.table.Column');

      assert.deepEqual(
        targetRepo.listEntryPoints('createSalesOrder').map((e) => e.url),
        ['${urlBase}/ui#SalesOrder-manage'],
        'NavigateToApp offers learned entry points; they are not in any Test file'
      );
      assert.equal(targetTags.listTags('appId').createSalesOrder, 'Sales',
        'without the tag the App ID lands in (untagged) and the folder tree is gone');
    } finally {
      targetRepo.close();
      targetTags.close();
    }
  } finally {
    source.cleanup();
    target.cleanup();
  }
});

test('a hand-arranged display order survives the move', () => {
  const source = workspace();
  const target = workspace();
  try {
    const repo = new ObjectRepository(source.objects);
    for (const name of ['alpha', 'beta', 'gamma']) repo.upsert(control('app', name));
    // Deliberately not alphabetical and not insertion order — the arrangement an author chose.
    repo.reorder('app', ['gamma', 'alpha', 'beta']);
    repo.close();

    importLibrary(exportLibrary(source.objects, source.tags), target.objects, target.tags);

    const targetRepo = new ObjectRepository(target.objects);
    try {
      assert.deepEqual(
        targetRepo.listByApp('app').map((c) => c.name),
        ['gamma', 'alpha', 'beta'],
        'sort_order is not part of ControlDefinition, so upsert alone loses the arrangement'
      );
    } finally {
      targetRepo.close();
    }
  } finally {
    source.cleanup();
    target.cleanup();
  }
});

test('importing over an existing library updates rather than duplicates, and leaves local work alone', () => {
  const source = workspace();
  const target = workspace();
  try {
    const repo = new ObjectRepository(source.objects);
    repo.upsert(control('app', 'shared', { label: 'updated upstream' }));
    repo.close();

    const targetRepo = new ObjectRepository(target.objects);
    targetRepo.upsert(control('app', 'shared', { label: 'stale local copy' }));
    targetRepo.upsert(control('app', 'capturedHere'));
    targetRepo.close();

    importLibrary(exportLibrary(source.objects, source.tags), target.objects, target.tags);

    const after = new ObjectRepository(target.objects);
    try {
      const names = after.listByApp('app').map((c) => c.name).sort();
      assert.deepEqual(names, ['capturedHere', 'shared'], 'import must upsert, never insert twice');
      assert.equal(after.get('app', 'shared').label, 'updated upstream');
      assert.ok(after.get('app', 'capturedHere'), 'a control captured on this machine is not dropped');
    } finally {
      after.close();
    }
  } finally {
    source.cleanup();
    target.cleanup();
  }
});

test('the committed object-library.json is a valid export of this repository', () => {
  // The point of committing it is that a fresh clone can restore from it. A malformed or
  // half-written file would only be discovered on the machine that needed it.
  const file = path.join(__dirname, '..', 'object-library.json');
  const payload = JSON.parse(readFileSync(file, 'utf8'));

  assert.equal(payload.formatVersion, 1);
  assert.ok(Array.isArray(payload.controls) && payload.controls.length > 0, 'export carries controls');
  assert.ok(payload.order && typeof payload.order === 'object', 'export carries display order');
  assert.ok(payload.appIdTags && typeof payload.appIdTags === 'object', 'export carries the folder tags');

  for (const c of payload.controls) {
    assert.ok(c.appId && c.name && c.controlId,
      `every control needs appId, name and controlId: ${JSON.stringify(c).slice(0, 80)}`);
  }

  // Every App ID with an order must name controls that are actually in the file, or reorder()
  // silently does nothing on the receiving machine.
  const byApp = new Map();
  for (const c of payload.controls) {
    if (!byApp.has(c.appId)) byApp.set(c.appId, new Set());
    byApp.get(c.appId).add(c.name);
  }
  for (const [appId, names] of Object.entries(payload.order)) {
    for (const name of names) {
      assert.ok(byApp.get(appId)?.has(name), `order names ${appId}.${name}, which is not in controls`);
    }
  }
});
