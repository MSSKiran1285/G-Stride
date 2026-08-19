import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { Command } from 'commander';
import { ObjectRepository, TagStore } from '@taf/core';

/**
 * The shape written by `objects export` and read by `objects import`.
 *
 * Every SQLite store in this product is gitignored, so cloning the repository onto a second
 * machine brings the Tests and none of the controls they name — the Object Library comes up with
 * zero controls and every Test fails its first object lookup. Copying the .db file works but is
 * a binary blob: it cannot be reviewed, cannot be merged, and carries whatever else happened to
 * be in that database.
 *
 * This is the reviewable form. It carries the four things that make an Object Library whole:
 * the controls themselves, the entry-point URLs NavigateToApp offers, the verification history
 * (so a control that WAS verified does not come back looking never-checked), and the App ID
 * process-area tags that build the folder tree — without which every App ID lands in
 * "(untagged)" and the library looks nothing like the one you left.
 */
interface ObjectLibraryExport {
  formatVersion: 1;
  exportedAt: string;
  controls: Array<Record<string, unknown>>;
  entryPoints: Array<{ appId: string; url: string }>;
  verifications: Array<Record<string, unknown>>;
  /** Display order per App ID. Reordering writes a sort_order column that ControlDefinition does
   *  not carry, so upsert cannot restore it — the order has to travel separately and be replayed
   *  through reorder(). Without this the library arrives alphabetical-ish by rowid and every
   *  drag-and-drop arrangement the author made is silently lost. */
  order: Record<string, string[]>;
  appIdTags: Record<string, string>;
  processAreas: string[];
}

export function registerObjectsCommand(program: Command): void {
  const objects = program.command('objects').description('Manage the object repository');

  objects
    .command('add')
    .description('Add or update a control definition in the object repository')
    .requiredOption('--app-id <appId>', 'logical app id (e.g. "login", "launchpad", or your app name)')
    .requiredOption('--name <name>', 'logical control name referenced by modules/test cases')
    .requiredOption('--control-id <controlId>', 'UI5 control id (from "taf inspect")')
    .option('--binding-path <bindingPath>', 'OData binding path, if any')
    .option('--control-type <controlType>', 'UI5 control type, e.g. sap.m.Input')
    .option(
      '--table-id <tableId>',
      'grid table DOM id, if --control-id is a column id rather than a control id (see AddLineItem)'
    )
    .option('--label <label>', 'human-readable name for evidence captions/reports, e.g. "Delivered Quantity"')
    .option('--parent-id <parentControlId>', 'the captured UI5 control id of this control\'s parent, if known (see "taf inspect" output)')
    .option('--db <path>', 'object repository SQLite path', 'object-repository.db')
    .action((opts) => {
      const repo = new ObjectRepository(opts.db);
      repo.upsert({
        appId: opts.appId,
        name: opts.name,
        controlId: opts.controlId,
        bindingPath: opts.bindingPath,
        controlType: opts.controlType,
        tableId: opts.tableId,
        label: opts.label,
        parentControlId: opts.parentId,
      });
      repo.close();
      console.log(`Saved "${opts.name}" for app "${opts.appId}" -> ${opts.controlId}`);
    });

  objects
    .command('export')
    .description('Write the whole Object Library to a reviewable JSON file that can be committed')
    .option('--db <path>', 'object repository SQLite path', 'object-repository.db')
    .option('--tags-db <path>', 'tag store SQLite path, for the App ID folder tree', 'tags.db')
    .option('--out <path>', 'output file', 'object-library.json')
    .action((opts) => {
      const repo = new ObjectRepository(opts.db);
      const tags = new TagStore(opts.tagsDb);
      try {
        const controls: Array<Record<string, unknown>> = [];
        const entryPoints: Array<{ appId: string; url: string }> = [];
        const verifications: Array<Record<string, unknown>> = [];

        const order: Record<string, string[]> = {};

        for (const appId of repo.listAppIds()) {
          // listByApp orders by sort_order, so the sequence it returns IS the display order.
          order[appId] = repo.listByApp(appId).map((control) => control.name);
          for (const control of repo.listByApp(appId)) {
            controls.push(control as unknown as Record<string, unknown>);
            for (const event of repo.listVerifications(appId, control.name)) {
              verifications.push(event as unknown as Record<string, unknown>);
            }
          }
          for (const entry of repo.listEntryPoints(appId)) {
            entryPoints.push({ appId, url: entry.url });
          }
        }

        const payload: ObjectLibraryExport = {
          formatVersion: 1,
          exportedAt: new Date().toISOString(),
          controls,
          entryPoints,
          verifications,
          order,
          appIdTags: tags.listTags('appId'),
          processAreas: tags.listProcessAreas(),
        };

        mkdirSync(path.dirname(path.resolve(opts.out)), { recursive: true });
        writeFileSync(opts.out, `${JSON.stringify(payload, null, 2)}\n`);
        console.log(
          `Wrote ${controls.length} controls, ${entryPoints.length} entry points, `
          + `${verifications.length} verification events and `
          + `${Object.keys(payload.appIdTags).length} App ID tags to ${opts.out}`
        );
      } finally {
        repo.close();
        tags.close();
      }
    });

  objects
    .command('import')
    .description('Load an Object Library export into this machine\'s repository')
    .option('--db <path>', 'object repository SQLite path', 'object-repository.db')
    .option('--tags-db <path>', 'tag store SQLite path', 'tags.db')
    .requiredOption('--file <path>', 'the JSON written by "objects export"')
    .action((opts) => {
      const payload = JSON.parse(readFileSync(opts.file, 'utf8')) as ObjectLibraryExport;
      if (payload.formatVersion !== 1 || !Array.isArray(payload.controls)) {
        throw new Error(`${opts.file} is not an Object Library export (formatVersion 1).`);
      }

      const repo = new ObjectRepository(opts.db);
      const tags = new TagStore(opts.tagsDb);
      try {
        // upsert, not insert: importing over an existing library updates what it names and
        // leaves anything captured locally alone, so this is safe to re-run.
        for (const control of payload.controls) repo.upsert(control as never);
        for (const entry of payload.entryPoints ?? []) repo.recordEntryPoint(entry.appId, entry.url);
        for (const event of payload.verifications ?? []) repo.recordVerification(event as never);

        // Replayed after every control exists, because reorder() only sets sort_order on rows it
        // can find.
        for (const [appId, names] of Object.entries(payload.order ?? {})) {
          if (names.length) repo.reorder(appId, names);
        }

        // The folder tree. Process areas are created first so a tag never points at an area the
        // receiving machine does not have.
        for (const area of payload.processAreas ?? []) tags.addProcessArea(area);
        for (const [appId, area] of Object.entries(payload.appIdTags ?? {})) {
          tags.setTag('appId', appId, area);
        }

        console.log(
          `Imported ${payload.controls.length} controls, ${(payload.entryPoints ?? []).length} entry points, `
          + `${(payload.verifications ?? []).length} verification events and `
          + `${Object.keys(payload.appIdTags ?? {}).length} App ID tags from ${opts.file}`
        );
      } finally {
        repo.close();
        tags.close();
      }
    });

  objects
    .command('list')
    .description('List control definitions for an app')
    .requiredOption('--app-id <appId>', 'logical app id')
    .option('--db <path>', 'object repository SQLite path', 'object-repository.db')
    .action((opts) => {
      const repo = new ObjectRepository(opts.db);
      console.log(repo.listByApp(opts.appId));
      repo.close();
    });
}
