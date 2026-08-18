import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// Self-hosted so the interface renders in Inter on a machine that does not have it installed, and
// without reaching a CDN — this Studio is expected to run offline against a customer's SAP host.
// The variable build is required, not the static one: the stylesheet uses weights 550, 650 and 750.
import '@fontsource-variable/inter'
// IBM Plex carries the tables. Only the weights the grids actually render, so nothing ships a
// face it never draws: 400 for cells, 600 for heads, and Mono for file names and identifiers.
import '@fontsource/ibm-plex-sans/400.css'
import '@fontsource/ibm-plex-sans/600.css'
import '@fontsource/ibm-plex-mono/400.css'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
