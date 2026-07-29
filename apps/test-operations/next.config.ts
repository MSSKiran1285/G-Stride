import type { NextConfig } from 'next';
import path from 'node:path';

const nextConfig: NextConfig = {
  output: 'export',
  reactStrictMode: true,
  turbopack: {
    root: path.resolve(import.meta.dirname),
  },
};

export default nextConfig;
