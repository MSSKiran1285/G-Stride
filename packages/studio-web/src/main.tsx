import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// Self-hosted so the interface renders in IBM Plex on a machine that does not have it installed, and
// without reaching a CDN — this Studio is expected to run offline against a customer's SAP host.
// The product has one type family. Loaded once, here, at the four sans weights and two mono
// weights the scale actually uses — @fontsource ships each with font-display: swap, and every
// file is self-hosted so the product still renders on an air-gapped machine.
import '@fontsource/ibm-plex-sans/400.css'
import '@fontsource/ibm-plex-sans/500.css'
import '@fontsource/ibm-plex-sans/600.css'
import '@fontsource/ibm-plex-sans/700.css'
import '@fontsource/ibm-plex-mono/400.css'
import '@fontsource/ibm-plex-mono/500.css'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
