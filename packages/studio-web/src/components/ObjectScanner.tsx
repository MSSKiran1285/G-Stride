import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import type { DiscoveredControl, SapIntegrationStatus, ScanSessionInfo } from '../types';
import { CurationList } from './CurationList';
import type { CurationListHandle } from './CurationList';
import { ObjectBrowser } from './ObjectBrowser';

export function ObjectScanner({
  initialAppId,
  initialObjectName,
  onSelectionChange,
}: {
  initialAppId?: string;
  initialObjectName?: string;
  onSelectionChange?: (appId: string, objectName?: string) => void;
} = {}) {
  const [url, setUrl] = useState('');
  const [sapTarget, setSapTarget] = useState<SapIntegrationStatus | null>(null);
  const [appId, setAppId] = useState('');
  const [session, setSession] = useState<ScanSessionInfo | null>(null);
  const [controls, setControls] = useState<DiscoveredControl[] | null>(null);
  const [pageUrl, setPageUrl] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [picking, setPicking] = useState<'idle' | 'waiting'>('idle');
  const [pickedControls, setPickedControls] = useState<DiscoveredControl[]>([]);
  const [pickSaveState, setPickSaveState] = useState({ ready: 0, total: 0, busy: false });
  const curationListRef = useRef<CurationListHandle>(null);
  const pickPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pickedIdsRef = useRef(new Set<string>());
  // The server keeps accumulating picks for as long as picking is active — it has no concept
  // of "dismissed". Without tracking dismissals separately, the very next poll (still running
  // while picking is active) sees a just-cancelled control still sitting in the server's list,
  // reads that as "new" again, and re-adds it right back — Cancel would silently undo itself.
  const dismissedIdsRef = useRef(new Set<string>());

  function beginPolling() {
    if (pickPollRef.current) clearInterval(pickPollRef.current);
    // Picking is continuous — stays active across several clicks (e.g. picking a handful of
    // Launchpad tiles in a row) rather than stopping after the first one, so keep polling
    // and adding whatever's new until "Stop picking" is clicked.
    pickPollRef.current = setInterval(async () => {
      const result = await api.getPickResult().catch(() => null);
      if (!result) return;
      const newOnes = result.picks.filter((c) => !pickedIdsRef.current.has(c.controlId) && !dismissedIdsRef.current.has(c.controlId));
      if (newOnes.length > 0) {
        for (const c of newOnes) pickedIdsRef.current.add(c.controlId);
        setPickedControls((prev) => [...prev, ...newOnes]);
      }
    }, 1000);
  }

  // Studio's App.tsx fully unmounts ObjectScanner when you switch tabs (not just hides it),
  // which wipes every bit of this component's local state. The live browser window and its
  // accumulated-but-not-yet-saved picks both live server-side and survive that unmount just
  // fine — this only failed to ask for them back. Restores: the scan session itself, any
  // picks already collected (even ones from before "Pick a control" was clicked this mount),
  // resumes polling if picking was still active when you navigated away, and the last App ID
  // you typed (purely a Studio-side convenience, so localStorage rather than a server field).
  useEffect(() => {
    const savedAppId = localStorage.getItem('taf.objectScanner.appId');
    if (savedAppId) setAppId(savedAppId);
    api
      .getIntegrationSettings()
      .then((settings) => {
        setSapTarget(settings.sap);
        if (settings.sap.configured && settings.sap.url) setUrl(settings.sap.url);
      })
      .catch(() => undefined);

    api
      .getScanStatus()
      .then((status) => {
        if (status.active && status.session) setSession(status.session);
      })
      .catch((e) => setError(String(e)));

    api
      .getPickResult()
      .then((result) => {
        if (result.picks.length > 0) {
          for (const c of result.picks) pickedIdsRef.current.add(c.controlId);
          setPickedControls(result.picks);
        }
        if (result.status === 'waiting') {
          setPicking('waiting');
          beginPolling();
        }
      })
      .catch(() => undefined);

    return () => {
      if (pickPollRef.current) clearInterval(pickPollRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (appId) localStorage.setItem('taf.objectScanner.appId', appId);
  }, [appId]);

  async function startPicking() {
    setError(null);
    try {
      await api.startPick();
      setPicking('waiting');
      beginPolling();
    } catch (e) {
      setError(String(e));
    }
  }

  async function stopPicking() {
    if (pickPollRef.current) {
      clearInterval(pickPollRef.current);
      pickPollRef.current = null;
    }
    setPicking('idle');
    await api.cancelPick().catch((e) => setError(String(e)));
  }

  function dismissPicked(controlId: string) {
    pickedIdsRef.current.delete(controlId);
    dismissedIdsRef.current.add(controlId);
    setPickedControls((prev) => prev.filter((c) => c.controlId !== controlId));
    // Persist the dismissal server-side too — otherwise a page reload/tab switch re-fetches
    // the server's full accumulated pick list (which never learned about the dismissal) and
    // every "already saved"/junk row silently comes back.
    api.dismissPick(controlId).catch(() => undefined);
  }

  async function open() {
    if (!url.trim()) {
      setError('Enter a URL to open first.');
      return;
    }
    if (!appId.trim()) {
      setError('Enter an App ID first — this becomes the default when saving what you curate here (shell chrome saves separately either way).');
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const info = await api.openScanSession(url.trim());
      setSession(info);
      setControls(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function capture() {
    if (!appId.trim()) {
      setError('Enter an App ID for this screen before capturing.');
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const result = await api.captureScan();
      setControls(result.controls);
      setPageUrl(result.pageUrl);
      setShowAll(false);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function close() {
    setBusy(true);
    try {
      await api.closeScanSession();
      setSession(null);
      setControls(null);
      setPageUrl(null);
      if (pickPollRef.current) {
        clearInterval(pickPollRef.current);
        pickPollRef.current = null;
      }
      setPicking('idle');
      setPickedControls([]);
      pickedIdsRef.current.clear();
      dismissedIdsRef.current.clear();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <div className="sticky-top stack">
      <div className="panel stack">
        <p className="section-title">Scan a live screen</p>

        {!session ? (
          <div className="stack">
            <div className="row">
              <input
                type="text"
                aria-label="SAP page URL to scan"
                placeholder="Configure the SAP target in Settings"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                style={{ flex: 2 }}
              />
            <input aria-label="App ID for scan" type="text" placeholder="App ID, e.g. procurement" value={appId} onChange={(e) => setAppId(e.target.value)} style={{ flex: 1 }} />
            <button className="primary" onClick={open} disabled={busy}>
              Open scan session
            </button>
            </div>
            <span className="hint">The initial URL comes from Settings → Test-system connections → SAP. You can append or replace the Fiori route for this scan.</span>
            {sapTarget?.configured && (
              <span className={`fiori-message-strip ${sapTarget.verificationStatus === 'live-verified' ? 'success' : 'warning'}`}>
                Target: {sapTarget.safetyClass === 'non-production' ? 'Non-production' : sapTarget.safetyClass === 'production-like' ? 'Production-like' : 'Unclassified'}
                {' · '}
                {sapTarget.verificationStatus === 'live-verified' && sapTarget.verifiedAt
                  ? `verified ${new Date(sapTarget.verifiedAt).toLocaleString()}`
                  : 'verification required before execution'}
              </span>
            )}
          </div>
        ) : (
          <div className="row" style={{ alignItems: 'center', flexWrap: 'wrap', gap: '0.6rem' }}>
            <span className="badge running">open</span>
            <span className="hint" style={{ flex: 1, minWidth: '10rem' }}>
              Since {new Date(session.openedAt).toLocaleTimeString()} — {session.url}
            </span>
            <input
              type="text"
              aria-label="App ID for the next capture"
              placeholder="App ID for the next capture"
              value={appId}
              onChange={(e) => setAppId(e.target.value)}
              style={{ maxWidth: '14rem' }}
              title="Change this before each Capture if you've navigated to a different app in the same window"
            />
            <button className="primary" onClick={capture} disabled={busy}>
              Capture
            </button>
            <button
              className={picking === 'waiting' ? 'danger-solid' : 'success'}
              onClick={picking === 'waiting' ? stopPicking : startPicking}
              disabled={busy}
            >
              {picking === 'waiting' ? 'Stop picking' : 'Select now'}
            </button>
            {pickedControls.length > 0 && (
              <button
                className="primary"
                disabled={busy || pickSaveState.ready === 0 || pickSaveState.busy}
                onClick={() => curationListRef.current?.saveAll()}
              >
                {pickSaveState.busy ? 'Saving…' : `Save all (${pickSaveState.ready})`}
              </button>
            )}
            <button className="neutral-solid" onClick={close} disabled={busy}>
              Close session
            </button>
          </div>
        )}

        {error && <p className="error-text">{error}</p>}
      </div>
      </div>

      <ObjectBrowser
        initialAppId={initialAppId}
        initialObjectName={initialObjectName}
        onSelectionChange={onSelectionChange}
      />

      {pickedControls.length > 0 && (
        <CurationList
          ref={curationListRef}
          controls={pickedControls}
          defaultAppId={appId}
          onDismiss={dismissPicked}
          showSaveAll={false}
          onSaveAllStateChange={setPickSaveState}
        />
      )}

      {controls && (
        <div className="panel stack">
          <p className="section-title">
            {controls.length} control{controls.length === 1 ? '' : 's'} discovered
            {pageUrl && <span className="hint"> — {pageUrl}</span>}
          </p>

          {(() => {
            const shownCount = controls.filter((c) => c.category !== 'structural').length;
            const hiddenCount = controls.length - shownCount;
            return (
              <div className="row" style={{ alignItems: 'center' }}>
                <span className="hint" style={{ flex: 1 }}>
                  {showAll
                    ? `Showing all ${controls.length} controls, raw — including structural scaffolding.`
                    : `${shownCount} of ${controls.length} shown, grouped by section — ${hiddenCount} structural control${hiddenCount === 1 ? '' : 's'} hidden.`}
                </span>
                <button className="ghost" onClick={() => setShowAll((v) => !v)}>
                  {showAll ? 'Back to curation view' : `Show all ${controls.length} raw`}
                </button>
              </div>
            );
          })()}

          {!showAll && <CurationList controls={controls} defaultAppId={appId} />}

          {showAll && (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Category</th>
                    <th>Scope</th>
                    <th>Control id</th>
                    <th>Type</th>
                    <th>Parent id</th>
                    <th>Text</th>
                  </tr>
                </thead>
                <tbody>
                  {controls.map((c, i) => (
                    <tr key={i}>
                      <td>
                        <span className={`badge ${c.category}`}>{c.category}</span>
                      </td>
                      <td>{c.scope === 'shell' && <span className="badge shell">shell</span>}</td>
                      <td style={{ wordBreak: 'break-all' }}>{c.controlId}</td>
                      <td>{c.controlType}</td>
                      <td style={{ wordBreak: 'break-all' }} className="hint">
                        {c.parentId ?? ''}
                      </td>
                      <td>{c.text ?? ''}</td>
                    </tr>
                  ))}
                  {controls.length === 0 && (
                    <tr>
                      <td colSpan={6} className="hint">
                        No UI5 controls found on the current page — is the app fully loaded?
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
