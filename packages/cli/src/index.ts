#!/usr/bin/env node
import { Command } from 'commander';
import { registerRunCommand } from './commands/run';
import { registerCredentialsCommand } from './commands/credentials';
import { registerInspectCommand } from './commands/inspect';
import { registerObjectsCommand } from './commands/objects';
import { registerStudioCommand } from './commands/studio';
import { registerSuiteCommand } from './commands/suite';
import { registerBatchCommand } from './commands/batch';

const program = new Command();
program.name('taf').description('SAP S/4HANA test automation CLI').version('0.1.0');

registerRunCommand(program);
registerCredentialsCommand(program);
registerInspectCommand(program);
registerObjectsCommand(program);
registerStudioCommand(program);
registerSuiteCommand(program);
registerBatchCommand(program);

program.parseAsync(process.argv);
