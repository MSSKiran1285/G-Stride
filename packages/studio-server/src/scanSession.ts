import { chromium, Browser, Page } from 'playwright';
import { randomUUID } from 'node:crypto';
import { inspectUi5Controls, DiscoveredControl } from '@taf/adapter-fiori';

export interface ScanSessionInfo {
  sessionId: string;
  url: string;
  openedAt: string;
}

interface ActiveSession extends ScanSessionInfo {
  browser: Browser;
  page: Page;
  /** Playwright throws if the same exposeFunction name is registered twice on one page — only do it once per session. */
  pickExposed?: boolean;
}

export interface PickResult {
  status: 'idle' | 'waiting';
  /** Every control picked since the last startPick() — picking is continuous (stays active across
   *  multiple clicks) until explicitly stopped, so this can grow across several polls. */
  picks: DiscoveredControl[];
}

// A scan session is a real, visible browser window a human drives by hand (log in,
// navigate) across several separate HTTP requests — open, then capture whenever they
// click it, then close. That's fundamentally different from every other Studio
// execution feature (which spawns the CLI once and lets it run to completion), so
// unlike those, this holds the live Playwright Browser/Page in this process directly.
// Only one at a time: it's a real OS window taking up screen space for one person to
// drive, not something that makes sense to parallelize.
let session: ActiveSession | null = null;
let pickResult: PickResult = { status: 'idle', picks: [] };

function toInfo(s: ActiveSession): ScanSessionInfo {
  return { sessionId: s.sessionId, url: s.url, openedAt: s.openedAt };
}

export async function openScanSession(rawUrl: string): Promise<ScanSessionInfo> {
  let targetUrl = rawUrl.trim();
  if (!targetUrl) {
    throw Object.assign(new Error('A valid URL is required to open a scan session.'), { status: 400 });
  }

  // Prepend https:// if no protocol scheme is provided
  if (!/^https?:\/\//i.test(targetUrl)) {
    targetUrl = `https://${targetUrl}`;
  }

  // Automatically close any prior open scan session cleanly
  if (session) {
    await closeScanSession().catch(() => undefined);
  }

  // A headed browser needs an interactive desktop session to draw on. Started from a normal
  // terminal that is always true; started as a service, inside a container, or under WSL it is
  // not — and launch() still SUCCEEDS, it just shows nobody a window. That failure is otherwise
  // completely silent, which is why it gets stated here rather than discovered by guesswork.
  const headlessOnly = process.platform === 'win32'
    ? !process.env.SESSIONNAME
    : !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY;
  console.log(
    `[scan] opening ${targetUrl} — headed Chrome, `
    + (headlessOnly
      ? 'NO interactive desktop session detected: a window will NOT be visible from this process'
      : 'desktop session present')
  );

  let browser: Browser;
  try {
    browser = await chromium.launch({
      headless: false,
      args: ['--start-maximized'],
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[scan] chromium.launch failed: ${message}`);
    throw Object.assign(
      new Error(`Could not launch the scan browser: ${message}`),
      { status: 500 }
    );
  }
  let page: Page;
  try {
    const context = await browser.newContext({ viewport: null });
    page = await context.newPage();
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });
  } catch (error) {
    await browser.close().catch(() => undefined);
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('ERR_NETWORK_ACCESS_DENIED')) {
      throw Object.assign(
        new Error('The scanner process is not permitted to access the SAP network. Restart Studio with outbound network access and try again.'),
        { status: 502 }
      );
    }
    throw error;
  }

  const next: ActiveSession = { sessionId: randomUUID(), url: targetUrl, openedAt: new Date().toISOString(), browser, page };
  session = next;

  // Fires if the human closes the window by hand instead of clicking "Close session"
  browser.on('disconnected', () => {
    if (session?.sessionId === next.sessionId) session = null;
  });

  pickResult = { status: 'idle', picks: [] };
  return toInfo(next);
}

export function getScanStatus(): { active: boolean; session?: ScanSessionInfo } {
  if (!session) return { active: false };
  return { active: true, session: toInfo(session) };
}

export async function captureScan(): Promise<{ controls: DiscoveredControl[]; capturedAt: string; pageUrl: string }> {
  if (!session) {
    throw Object.assign(new Error('No active scan session — open one first.'), { status: 400 });
  }
  const controls = await inspectUi5Controls(session.page);
  return { controls, capturedAt: new Date().toISOString(), pageUrl: session.page.url() };
}

/**
 * Scrolls a captured control into view in the live scan window and flashes a red outline
 * around it — lets you point at a row in Studio's curation list and confirm exactly which
 * on-screen element it is before naming it. Tries every frame (Fiori apps commonly render
 * inside one, same as inspectUi5Controls) since a captured control's originating frame
 * isn't tracked through the pipeline.
 */
export async function highlightControl(controlId: string): Promise<{ found: boolean }> {
  if (!session) {
    throw Object.assign(new Error('No active scan session — open one first.'), { status: 400 });
  }
  for (const frame of session.page.frames()) {
    const found = await frame
      .evaluate((id) => {
        const core = (window as any).sap?.ui?.getCore?.();
        const control = core?.byId?.(id);
        const el: HTMLElement | null | undefined = control?.getDomRef?.();
        if (!el) return false;
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        const prevOutline = el.style.outline;
        const prevOffset = el.style.outlineOffset;
        el.style.outline = '4px solid #ff3d00';
        el.style.outlineOffset = '2px';
        setTimeout(() => {
          el.style.outline = prevOutline;
          el.style.outlineOffset = prevOffset;
        }, 3000);
        return true;
      }, controlId)
      .catch(() => false);
    if (found) return { found: true };
  }
  return { found: false };
}

export interface ReverificationResult {
  outcome: 'verified' | 'drifted' | 'missing';
  /** Present unless outcome is "missing". */
  live?: Pick<DiscoveredControl, 'controlId' | 'controlType' | 'bindingPath' | 'text'>;
}

/**
 * Compares one stored control against the live screen without writing anything — BL-024
 * AC3's "reverification can compare live metadata without overwriting silently." Re-runs
 * the same full capture pipeline captureScan() already uses (inspectUi5Controls) rather than
 * a single-id DOM query, so a same-id match is exact and a suffix match reuses real,
 * already-classified control data instead of a second bespoke DOM query — same suffix idea as
 * FioriPlaywrightAdapter's healIdBySuffix, just without needing a live Page reference of its own.
 */
export async function reverifyControl(controlId: string, controlType?: string): Promise<ReverificationResult> {
  if (!session) {
    throw Object.assign(new Error('No active scan session — open one first.'), { status: 400 });
  }
  const controls = await inspectUi5Controls(session.page);
  const exact = controls.find((c) => c.controlId === controlId);
  if (exact) return { outcome: 'verified', live: pickLive(exact) };

  const suffix = controlId.split(/--|::/).at(-1);
  const bySuffix = suffix
    ? controls.find((c) => c.controlId !== controlId && c.controlId.endsWith(suffix) && (!controlType || c.controlType === controlType))
    : undefined;
  if (bySuffix) return { outcome: 'drifted', live: pickLive(bySuffix) };

  return { outcome: 'missing' };
}

function pickLive(c: DiscoveredControl): Pick<DiscoveredControl, 'controlId' | 'controlType' | 'bindingPath' | 'text'> {
  return { controlId: c.controlId, controlType: c.controlType, bindingPath: c.bindingPath, text: c.text };
}

async function handlePicked(candidateIds: string[]): Promise<void> {
  if (!session) return;
  // The in-page listener only knows DOM ids — it can't run classifyControl/classifyScope
  // itself (Node-side TS, not available in the browser context), so re-run the same full
  // capture pipeline Capture already uses and classify every candidate from that. Same
  // category/scope/text/bindingPath/parentId treatment as a bulk scan, zero duplicated logic.
  //
  // candidateIds is the full ancestor chain from whatever was literally clicked (innermost)
  // up to the document root, filtered to ones that resolve to a real UI5 control. A tile's
  // icon and title text are each their own addressable control nested inside the tile itself
  // — clicking the icon should still pick "the tile", not its icon. So prefer the OUTERMOST
  // candidate that classifies as actionable, then the outermost informational one, and only
  // fall back to the innermost (literal click target) if nothing in the chain qualifies —
  // found via a real capture (clicking a Launchpad tile's icon resolved to sap.m.ImageContent,
  // several levels below the actual sap.m.GenericTile a QA engineer would mean to pick).
  const controls = await inspectUi5Controls(session.page);
  const byId = new Map(controls.map((c) => [c.controlId, c]));
  const candidates = candidateIds.map((id) => byId.get(id)).filter((c): c is DiscoveredControl => Boolean(c));

  const control =
    [...candidates].reverse().find((c) => c.category === 'actionable') ??
    [...candidates].reverse().find((c) => c.category === 'informational') ??
    candidates[0];

  if (control && !pickResult.picks.some((c) => c.controlId === control.controlId)) {
    pickResult = { status: pickResult.status, picks: [...pickResult.picks, control] };
  }
}

/**
 * Starts "pick a control" mode in the live scan window: hovering outlines whatever's under
 * the cursor, and every click is intercepted (never reaches the real app — you don't want
 * clicking "Create" to actually fire it while you're just trying to select it) and reported
 * back here instead. Continuous — stays active across multiple clicks so you can pick several
 * controls in a row (e.g. a handful of Launchpad tiles) without re-clicking "Pick a control"
 * before every single one — until cancelPick() explicitly stops it.
 */
export async function startPick(): Promise<void> {
  if (!session) {
    throw Object.assign(new Error('No active scan session — open one first.'), { status: 400 });
  }

  if (!session.pickExposed) {
    await session.page.exposeFunction('__tafReportPick', (candidateIds: string[]) => {
      handlePicked(candidateIds).catch(() => undefined);
    });
    session.pickExposed = true;
  }

  pickResult = { status: 'waiting', picks: [] };

  for (const frame of session.page.frames()) {
    await frame
      .evaluate(() => {
        const w = window as any;
        if (w.__tafPickActive) return;
        w.__tafPickActive = true;

        // Picking only engages while Ctrl (Cmd on Mac) is held — a plain click behaves
        // completely normally, so you can still type into fields, navigate, or otherwise use
        // the app while a picking session is open. Without this, picking mode had to be an
        // all-or-nothing modal state: on to select controls, off to do anything else,
        // which made it impossible to interleave "type this value, then pick that field."
        const isPickModifier = (e: any) => e.ctrlKey || e.metaKey;

        let hovered: HTMLElement | null = null;
        const onMouseOver = (e: MouseEvent) => {
          if (!isPickModifier(e)) return;
          hovered = e.target as HTMLElement;
          hovered.style.outline = '2px dashed #2f6feb';
          hovered.style.outlineOffset = '1px';
        };
        const onMouseOut = (e: MouseEvent) => {
          if (hovered && hovered === e.target) hovered.style.outline = '';
        };

        // A plain "click" listener isn't enough to stop every control's own behavior — e.g.
        // an IconTabFilter switches tabs (navigates) on an earlier event in the gesture
        // sequence (mousedown/pointerdown/touchstart), and if UI5 has its own delegated
        // listener registered on `document` at app bootstrap, a listener added here later
        // would fire *after* it, too late to matter. Registering on `window` instead of
        // `document` guarantees ours runs first regardless of registration order (capture
        // phase walks window -> document -> ... -> target), and blocking every event in the
        // press/release sequence — not just click — stops whichever one the control actually
        // reacts to. `click` alone is still what's used to identify what got picked, since by
        // then the DOM hasn't changed (the earlier events never reached the app).
        const suppress = (e: any) => {
          if (!isPickModifier(e)) return;
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation();
        };
        const onClick = (e: MouseEvent) => {
          if (!isPickModifier(e)) return;
          suppress(e);
          if (hovered) hovered.style.outline = '';
          // Collect every ancestor id (innermost first) that resolves to a real UI5 control —
          // not every element with an id is one (e.g. a Button's inner bidi-text wrapper span
          // has its own id but isn't registered with core.byId()) — and let the Node side
          // (which can actually classify them) pick the most sensible one, since the literal
          // click target is often a sub-part (an icon, a text label) of the thing worth naming.
          const core = (window as any).sap?.ui?.getCore?.();
          const candidateIds: string[] = [];
          let el: HTMLElement | null = e.target as HTMLElement;
          while (el) {
            if (el.id && core?.byId?.(el.id)) candidateIds.push(el.id);
            // A line-item cell's actual editor is a per-row clone (excluded elsewhere as
            // unstable) — but a Column is never its ancestor in the control tree; both are
            // just children of the table, in different aggregations. UI5 renders the cell's
            // <td> with a data-sap-ui-colid (grid table) / data-sap-ui-column (responsive
            // table) attribute pointing straight at the real, stable Column control instead —
            // the same attribute convention controlAccess.ts's TableCellLocator already
            // relies on for row-indexed access. Found via real DOM inspection of a line-item
            // cell, not guessed up front.
            const colId = el.getAttribute?.('data-sap-ui-colid') ?? el.getAttribute?.('data-sap-ui-column');
            if (colId && core?.byId?.(colId) && !candidateIds.includes(colId)) candidateIds.push(colId);
            el = el.parentElement;
          }

          // A disabled/pending control (e.g. a field waiting on another field to be filled
          // first) typically has pointer-events removed from its interactive sub-elements —
          // the browser's own hit-testing (which e.target is built from) skips it entirely,
          // so the click resolves to whatever's rendered behind/around it instead (observed:
          // clicking a greyed-out "Sales Organization" input inside a dialog resolved only to
          // the Dialog itself). getBoundingClientRect() doesn't care about pointer-events, so
          // scanning every UI5-registered element for one whose box actually contains the
          // click point finds the real target regardless of its enabled state. Smallest-area
          // match first (most specific), pushed last so it wins the same outermost-preferred
          // slot handlePicked's reversal already uses for a deliberate, precise hit.
          const px = e.clientX;
          const py = e.clientY;
          const geometryMatches: { id: string; area: number }[] = [];
          document.querySelectorAll('[id]').forEach((node) => {
            const id = (node as HTMLElement).id;
            if (!id || candidateIds.includes(id) || !core?.byId?.(id)) return;
            const rect = (node as HTMLElement).getBoundingClientRect();
            if (rect.width === 0 || rect.height === 0) return;
            if (px >= rect.left && px <= rect.right && py >= rect.top && py <= rect.bottom) {
              geometryMatches.push({ id, area: rect.width * rect.height });
            }
          });
          geometryMatches.sort((a, b) => b.area - a.area);
          for (const m of geometryMatches) candidateIds.push(m.id);

          // Deliberately no cleanup() here — picking stays active so the next click is
          // intercepted too; only cancelPick() (Stop picking) removes these listeners.
          if (candidateIds.length > 0) w.__tafReportPick(candidateIds);
        };
        const suppressedTypes = ['pointerdown', 'mousedown', 'touchstart', 'mouseup', 'touchend'];
        function cleanup() {
          document.removeEventListener('mouseover', onMouseOver, true);
          document.removeEventListener('mouseout', onMouseOut, true);
          window.removeEventListener('click', onClick, true);
          for (const type of suppressedTypes) window.removeEventListener(type, suppress, true);
          w.__tafPickActive = false;
        }
        w.__tafPickCleanup = cleanup;

        document.addEventListener('mouseover', onMouseOver, true);
        document.addEventListener('mouseout', onMouseOut, true);
        window.addEventListener('click', onClick, true);
        for (const type of suppressedTypes) window.addEventListener(type, suppress, true);
      })
      .catch(() => undefined);
  }
}

export function getPickResult(): PickResult {
  return pickResult;
}

/** Permanently drops one control from the accumulated pick list — server-side, so a
 * dismissed "already saved"/junk row stays gone across a page reload or tab switch
 * instead of reappearing the next time the client re-fetches the full list. */
export function dismissPick(controlId: string): void {
  pickResult = { status: pickResult.status, picks: pickResult.picks.filter((c) => c.controlId !== controlId) };
}

/** Stops picking (removes the live-page listeners) — the accumulated picks stay in the result. */
export async function cancelPick(): Promise<void> {
  if (!session) {
    pickResult = { status: 'idle', picks: pickResult.picks };
    return;
  }
  for (const frame of session.page.frames()) {
    await frame.evaluate(() => (window as any).__tafPickCleanup?.()).catch(() => undefined);
  }
  pickResult = { status: 'idle', picks: pickResult.picks };
}

/**
 * Closes a browser without ever being able to block the caller.
 *
 * browser.close() can hang indefinitely rather than reject — a wedged renderer, a modal the
 * page is blocked on, or a Chrome process that was killed from outside all produce a promise
 * that simply never settles. A plain `.catch()` does not help: there is no rejection to catch.
 *
 * That mattered because openScanSession() awaits this before opening a new session. A hung
 * close meant POST /api/scan/open never responded at all, so the client's await never resolved
 * and its busy flag was never cleared — the "Open scan session" button went permanently dead
 * with no error shown anywhere. Always on the SECOND open, never the first, which is what made
 * it look intermittent.
 *
 * Racing the close against a timeout turns that into at worst a few seconds of delay. The
 * session reference is dropped by the caller either way, so a browser we could not close
 * cleanly is orphaned rather than allowed to block every future scan.
 */
async function closeBrowserSafely(browser: Browser, timeoutMs = 5000): Promise<void> {
  await Promise.race([
    browser.close().catch(() => undefined),
    new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
  ]);
}

export async function closeScanSession(): Promise<void> {
  if (!session) return;
  const current = session;
  session = null;
  pickResult = { status: 'idle', picks: [] };
  await closeBrowserSafely(current.browser);
}
