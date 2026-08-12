import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import type { DiscoveredControl, ScanSessionInfo } from '../types';
import { CurationList } from './CurationList';
import type { CurationListHandle } from './CurationList';
import { ObjectBrowser } from './ObjectBrowser';
import { AsyncFeedback } from './WorkspacePrimitives';

export function ObjectScanner({
  initialAppId,
  initialObjectName,
  onSelectionChange,
  captureTarget,
}: {
  initialAppId?: string;
  initialObjectName?: string;
  onSelectionChange?: (appId: string, objectName?: string) => void;
  /** Set by ContextualCapturePanel when this scanner is embedded as an overlay launched
   *  from a specific Compose field, rather than opened directly from Control Object
   *  Repository — see BL-023 AC4. */
  captureTarget?: { appId: string; fieldLabel: string; onUse: (name: string) => void };
} = {}) {
  const [url, setUrl] = useState('');
  const [appId, setAppId] = useState(captureTarget?.appId ?? '');
  const [domain, setDomain] = useState(() => localStorage.getItem('taf.objectScanner.domain') ?? '');
  const [processAreas, setProcessAreas] = useState<string[]>([]);
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
    // A contextual capture session already knows exactly which App ID it's for — the last
    // App ID typed in some unrelated earlier session is never a better default here.
    if (!captureTarget) {
      const savedAppId = localStorage.getItem('taf.objectScanner.appId');
      if (savedAppId) setAppId(savedAppId);
    }
    api
      .getIntegrationSettings()
      .then((settings) => {
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

  useEffect(() => {
    api.listProcessAreas().then(setProcessAreas).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (domain) localStorage.setItem('taf.objectScanner.domain', domain);
  }, [domain]);

  async function syncAppIdTag() {
    if (appId.trim() && domain.trim()) {
      await api.setTag('appId', appId.trim(), domain.trim()).catch(() => undefined);
    }
  }

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
    let formattedUrl = url.trim();
    if (!formattedUrl) {
      setError('Enter a URL to open first.');
      return;
    }
    if (!/^https?:\/\//i.test(formattedUrl)) {
      formattedUrl = `https://${formattedUrl}`;
      setUrl(formattedUrl);
    }
    setError(null);
    setBusy(true);
    try {
      await syncAppIdTag();
      const info = await api.openScanSession(formattedUrl);
      setSession(info);
      setControls(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function capture() {
    if (!appId.trim()) {
      setError('Enter an APP ID for this screen before capturing.');
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await syncAppIdTag();
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

  const scannerContent = (
    <div className="stack" style={{ gap: '1rem' }}>
      <div className="panel stack cozy-scanner-panel" style={{ gap: '0.6rem' }}>
        {captureTarget && (
          <p className="fiori-message-strip" role="status">
            Capturing for <strong>{captureTarget.fieldLabel}</strong> (APP ID: {captureTarget.appId}) — save an object below and use it to fill that field.
          </p>
        )}

        <div className="cozy-scanner-grid">
          <div className="cozy-field-group field-url">
            <label className="cozy-label">Application URL</label>
            <input
              type="text"
              aria-label="Application URL"
              placeholder="Configure the SAP target URL, e.g. https://my-sap.corp/..."
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              className="cozy-input"
            />
          </div>

          <div className="cozy-field-group field-domain">
            <label className="cozy-label">Domain</label>
            <div className="cozy-input-wrapper">
              <input
                type="text"
                list="scanner-domain-options"
                aria-label="Domain"
                placeholder="Select or type new domain..."
                value={domain}
                onChange={(e) => setDomain(e.target.value)}
                className="cozy-input"
              />
              <datalist id="scanner-domain-options">
                {processAreas.map((area) => (
                  <option key={area} value={area} />
                ))}
              </datalist>
            </div>
          </div>

          <div className="cozy-field-group field-appid">
            <label className="cozy-label">APP ID</label>
            <input
              type="text"
              aria-label="APP ID"
              placeholder="e.g. C_SalesOrderManage"
              value={appId}
              onChange={(e) => setAppId(e.target.value)}
              className="cozy-input"
            />
          </div>

          <div className="cozy-field-group field-action">
            <label className="cozy-label">&nbsp;</label>
            <div className="cozy-btn-group">
              <button className="cozy-btn cozy-btn-open" onClick={open} disabled={busy || Boolean(session)}>
                {busy ? 'Opening…' : session ? 'Session Open' : 'Open scan session'}
              </button>

              <button className="cozy-btn cozy-btn-capture" onClick={capture} disabled={busy || !session}>
                Capture
              </button>

              <button
                className={`cozy-btn ${picking === 'waiting' ? 'danger-solid' : 'cozy-btn-select'}`}
                onClick={picking === 'waiting' ? stopPicking : startPicking}
                disabled={busy || !session}
              >
                {picking === 'waiting' ? 'Stop picking' : 'Select Now'}
              </button>

              {pickedControls.length > 0 && session && (
                <button
                  className="cozy-btn cozy-btn-capture"
                  disabled={busy || pickSaveState.ready === 0 || pickSaveState.busy}
                  onClick={() => curationListRef.current?.saveAll()}
                >
                  {pickSaveState.busy ? 'Saving…' : `Save all (${pickSaveState.ready})`}
                </button>
              )}

              <button className="cozy-btn cozy-btn-close" onClick={close} disabled={busy || !session}>
                Close Session
              </button>
            </div>
          </div>
        </div>

        {error && <AsyncFeedback state="error" message={error} onRetry={open} compact />}
      </div>

      {pickedControls.length > 0 && (
        <CurationList
          ref={curationListRef}
          controls={pickedControls}
          defaultAppId={appId}
          onDismiss={dismissPicked}
          showSaveAll={false}
          onSaveAllStateChange={setPickSaveState}
          captureTarget={captureTarget && { fieldLabel: captureTarget.fieldLabel, onUse: captureTarget.onUse }}
        />
      )}

      {controls && (
        <div className="panel stack">
          <p className="section-title">
            {controls.length} control{controls.length === 1 ? '' : 's'} discovered
            {pageUrl && <span className="hint"> — {pageUrl}</span>}
          </p>

          <div className="row" style={{ alignItems: 'center' }}>
            <span className="hint" style={{ flex: 1 }}>
              {showAll
                ? `Showing all ${controls.length} controls, raw.`
                : `${controls.filter((c) => c.category !== 'structural').length} of ${controls.length} shown, grouped by section.`}
            </span>
            <button className="ghost" onClick={() => setShowAll((v) => !v)}>
              {showAll ? 'Back to curation view' : 'Show all raw'}
            </button>
          </div>

          {!showAll && (
            <CurationList
              controls={controls}
              defaultAppId={appId}
              captureTarget={captureTarget && { fieldLabel: captureTarget.fieldLabel, onUse: captureTarget.onUse }}
            />
          )}

          {showAll && (
            <div className="table-responsive">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Control ID</th>
                    <th>Type</th>
                    <th>Text / Label</th>
                  </tr>
                </thead>
                <tbody>
                  {controls.map((c) => (
                    <tr key={c.controlId}>
                      <td><code>{c.controlId}</code></td>
                      <td><code>{c.controlType}</code></td>
                      <td>{c.text || '—'}</td>
                    </tr>
                  ))}
                  {controls.length === 0 && (
                    <tr>
                      <td colSpan={3} className="hint">
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

  return (
    <ObjectBrowser
      initialAppId={initialAppId}
      initialObjectName={initialObjectName}
      onSelectionChange={onSelectionChange}
      scannerContent={scannerContent}
    />
  );
}
