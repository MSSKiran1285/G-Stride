# G-Stride Setup & Developer Guide

## Prerequisites

- **Node.js**: `>=20`
- **Playwright Chromium Browser**:
  After running `npm install`, ensure the Playwright Chromium browser binary is installed by running:
  ```bash
  npx playwright install chromium
  ```
  *(Note: A `postinstall` hook in `package.json` automatically runs this when not in a CI environment).*

## Quick Start

```bash
# Install dependencies
npm install

# Start G-Stride Studio Server (runs Web App on http://127.0.0.1:3000)
npm run dev
```

## Environment Requirements

- **Browser Scanning**: Scans SAP Fiori and web applications using headed Chromium managed by Playwright.
- **Node Engines**: Node `>=20` is required across root and subpackages (`@taf/studio-server`, `@taf/cli`, `@taf/engine`).
