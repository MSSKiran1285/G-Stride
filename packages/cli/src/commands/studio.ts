import { Command } from 'commander';
import path from 'node:path';
import { startStudioServer } from '@taf/studio-server';

export function registerStudioCommand(program: Command): void {
  program
    .command('studio')
    .description('Start the Studio web UI for composing and running test cases from the browser')
    .option('--port <number>', 'port to listen on', '4500')
    .option('--host <host>', 'host interface to bind (use non-loopback only on a secured network)', '127.0.0.1')
    .action(async (opts) => {
      const webDistPath = path.resolve(__dirname, '../../../studio-web/dist');
      if (opts.host !== '127.0.0.1' && opts.host !== 'localhost' && opts.host !== '::1') {
        console.warn(`Warning: Studio has no authentication and will be exposed on ${opts.host}. Use only on a secured, trusted network.`);
      }
      const { url } = await startStudioServer(Number(opts.port), { webDistPath, host: opts.host });
      console.log(`Studio running at ${url}`);
    });
}
