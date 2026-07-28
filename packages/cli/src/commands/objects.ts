import { Command } from 'commander';
import { ObjectRepository } from '@taf/core';

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
