import { Command } from 'commander';
import { setCredentials } from '@taf/core';
import readline from 'node:readline/promises';

export function registerCredentialsCommand(program: Command): void {
  const credentials = program.command('credentials').description('Manage stored SAP credentials');

  credentials
    .command('set')
    .description('Store SAP credentials securely for Studio and CLI executions')
    .option('--profile <name>', 'credential profile name', 'default')
    .requiredOption('--url <url>', 'SAP system URL')
    .requiredOption('--username <username>', 'SAP username')
    .action(async (opts) => {
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      const password = await rl.question('Password: ');
      rl.close();
      await setCredentials(opts.profile, { url: opts.url, username: opts.username, password });
      console.log(`Stored credentials securely for profile "${opts.profile}".`);
    });
}
