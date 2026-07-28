import { createStudioServer, StudioServerOptions } from './server';

export { createStudioServer, StudioServerOptions } from './server';

export interface StudioStartOptions extends StudioServerOptions {
  /** Local workstation is the safe default. Non-loopback binding must be an explicit caller choice. */
  host?: string;
}

export function startStudioServer(port: number, options: StudioStartOptions = {}): Promise<{ url: string; close: () => void }> {
  const app = createStudioServer(options);
  const host = options.host ?? '127.0.0.1';
  return new Promise((resolve, reject) => {
    const server = app.listen(port, host, () => {
      resolve({ url: `http://${host}:${port}`, close: () => server.close() });
    });
    server.once('error', reject);
  });
}
