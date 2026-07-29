import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputRoot = path.join(appRoot, '.open-next');
const assetsRoot = path.join(outputRoot, 'assets');
const exportRoot = path.join(appRoot, 'out');

const workerSource = `export default {
  async fetch(request, env) {
    const response = await env.ASSETS.fetch(request);

    if (response.status !== 404) {
      return response;
    }

    const fallbackUrl = new URL(request.url);
    fallbackUrl.pathname = "/index.html";
    return env.ASSETS.fetch(new Request(fallbackUrl, request));
  },
};
`;

await rm(outputRoot, { force: true, recursive: true });
await mkdir(assetsRoot, { recursive: true });
await cp(exportRoot, assetsRoot, { recursive: true });
await writeFile(path.join(outputRoot, 'worker.js'), workerSource, 'utf8');

console.log('Packaged static Next.js export for the Cloudflare Worker runtime.');
