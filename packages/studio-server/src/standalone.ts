import { startStudioServer } from './index';

const port = Number(process.env.PORT) || 3000;
const host = process.env.HOST || '127.0.0.1';
startStudioServer(port, { host })
  .then(({ url }) => {
    console.log(`Studio server running at ${url}`);
  })
  .catch((err) => {
    console.error('Failed to start studio server:', err);
    process.exit(1);
  });
