import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import type { DiscoveredControl, DiscoveryState, DiscoveryStepResult, SapIntegrationStatus, ScanSessionInfo } from '../types';
import { CurationList } from './CurationList';
import type { CurationListHandle } from './CurationList';
import { ObjectBrowser } from './ObjectBrowser';

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
  const [sapTarget, setSapTarget] = useState<SapIntegrationStatus | null>(null);
  const [appId, setAppId] = useState(captureTarget?.appId ?? '');
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

  // BL-047 Phase 2: the live autonomous-discovery loop. Run drives the whole instruction on its
  // own; the loop lives server-side and outlives any one request, so this polls state while it
  // is going rather than awaiting a response. "Run one step" stays for diagnosing a single
  // decision — it is no longer how the feature is meant to be used.
  const [instructionText, setInstructionText] = useState('');
  const [discovery, setDiscovery] = useState<DiscoveryState | null>(null);
  const [lastStep, setLastStep] = useState<DiscoveryStepResult | null>(null);
  const [discoveryBusy, setDiscoveryBusy] = useState(false);
  const [discoveryError, setDiscoveryError] = useState<string | null>(null);
  const discoveryPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

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

  // Watches the server-side run. Keeps polling while it is still taking steps AND while it is
  // waiting on a human, because in that second state the steps the human performs in the live
  // window are being recorded server-side — they should appear here as they happen, not only
  // once the model is asked to resume.
  function beginDiscoveryPolling() {
    if (discoveryPollRef.current) clearInterval(discoveryPollRef.current);
    discoveryPollRef.current = setInterval(async () => {
      const state = await api.getDiscoveryState().catch(() => null);
      if (!state) return;
      setDiscovery(state.active ? state : null);
      if (!state.active || (!state.running && !state.awaitingHuman)) {
        if (discoveryPollRef.current) clearInterval(discoveryPollRef.current);
        discoveryPollRef.current = null;
      }
    }, 1500);
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
      .getDiscoveryState()
      .then((state) => {
        setDiscovery(state.active ? state : null);
        // The loop runs server-side, so it may well still be going from before this component
        // was last unmounted — pick the watch back up rather than showing a frozen snapshot.
        if (state.active && (state.running || state.awaitingHuman)) beginDiscoveryPolling();
      })
      .catch(() => undefined);

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
      if (discoveryPollRef.current) clearInterval(discoveryPollRef.current);
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

  async function startDiscoveryRun() {
    if (!appId.trim()) {
      setDiscoveryError('Enter an App ID first — this is what discovered controls get registered under.');
      return;
    }
    const instruction = instructionText.trim();
    if (!instruction) {
      setDiscoveryError('Describe what to do in plain English first, e.g. "Go to Project Management, click on Manage My Timesheet and select the task. Enter 5 hours for today and save & submit."');
      return;
    }
    setDiscoveryError(null);
    setDiscoveryBusy(true);
    try {
      const state = await api.startDiscovery(appId.trim(), instruction);
      setDiscovery(state);
      setLastStep(null);
      // Starting and then immediately running is the whole point — being asked to press a
      // second button before anything happens is exactly the friction this replaced.
      await api.runDiscovery();
      beginDiscoveryPolling();
    } catch (e) {
      setDiscoveryError(String(e));
    } finally {
      setDiscoveryBusy(false);
    }
  }

  /** Picks the instruction back up after a handover — the model now sees whatever the human
   *  did in the meantime, because those steps were recorded into the same step log. */
  async function resumeDiscoveryRun() {
    setDiscoveryError(null);
    setDiscoveryBusy(true);
    try {
      await api.runDiscovery();
      beginDiscoveryPolling();
    } catch (e) {
      setDiscoveryError(String(e));
    } finally {
      setDiscoveryBusy(false);
    }
  }

  async function nextDiscoveryStep() {
    setDiscoveryError(null);
    setDiscoveryBusy(true);
    try {
      const result = await api.runDiscoveryStep();
      setLastStep(result);
      const state = await api.getDiscoveryState();
      setDiscovery(state.active ? state : null);
    } catch (e) {
      setDiscoveryError(String(e));
    } finally {
      setDiscoveryBusy(false);
    }
  }

  // Stop means "stop taking actions, keep what you found" while the loop is going, and only
  // means "discard this run" once it has already come to rest — mirroring the server, so
  // halting a run that is going wrong never throws away the steps that already worked.
  async function stopDiscoveryRun() {
    setDiscoveryBusy(true);
    try {
      const result = await api.stopDiscovery();
      if (result.stillRunning) {
        const state = await api.getDiscoveryState().catch(() => null);
        if (state) setDiscovery(state.active ? state : null);
      } else {
        if (discoveryPollRef.current) clearInterval(discoveryPollRef.current);
        discoveryPollRef.current = null;
        setDiscovery(null);
        setLastStep(null);
      }
    } catch (e) {
      setDiscoveryError(String(e));
    } finally {
      setDiscoveryBusy(false);
    }
  }

  return (
    <div className="stack">
      <div className="sticky-top stack">
      <div className="panel stack">
        <p className="section-title">Scan a live screen</p>

        {captureTarget && (
          <p className="fiori-message-strip" role="status">
            Capturing for <strong>{captureTarget.fieldLabel}</strong> (App ID: {captureTarget.appId}) — save an object below and use it to fill that field.
          </p>
        )}

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

      {session && (
        <div className="panel stack">
          <p className="section-title">Autonomous discovery (BL-047)</p>
          <p className="hint">
            Describe what to do in plain English and it carries the whole instruction out on its own — deciding each action (navigate, fill,
            click, select) against the live screen and registering every control it touches into the Object Repository above before acting on
            it. Stop it at any point; it finishes the action it is on and keeps everything it found. If it gets stuck it hands the window back
            to you and records what you do by hand, so when you tell it to carry on it knows what happened while it was waiting.
          </p>

          {!discovery ? (
            <div className="stack">
              <textarea
                aria-label="Instruction for discovery, in plain English"
                placeholder={'Go to Project Management, click on Manage My Timesheet and select the task. Enter 5 hours for today and save & submit.'}
                value={instructionText}
                onChange={(e) => setInstructionText(e.target.value)}
                rows={3}
              />
              <div className="row">
                <button className="primary" onClick={startDiscoveryRun} disabled={discoveryBusy}>
                  {discoveryBusy ? 'Starting…' : 'Run'}
                </button>
              </div>
            </div>
          ) : (
            <div className="stack">
              <div className="row" style={{ alignItems: 'center', flexWrap: 'wrap', gap: '0.6rem' }}>
                <span className={`badge ${discovery.running ? 'running' : discovery.awaitingHuman ? 'warning' : 'neutral'}`}>
                  {discovery.running ? 'running' : discovery.awaitingHuman ? 'over to you' : 'idle'}
                </span>
                <span className="hint" style={{ flex: 1, minWidth: '10rem' }}>
                  {discovery.appId} — started {discovery.startedAt ? new Date(discovery.startedAt).toLocaleTimeString() : ''} —{' '}
                  {discovery.steps?.length ?? 0} step{(discovery.steps?.length ?? 0) === 1 ? '' : 's'} taken so far
                </span>
                {!discovery.running && (
                  <button className="primary" onClick={resumeDiscoveryRun} disabled={discoveryBusy}>
                    {discoveryBusy ? 'Working…' : discovery.awaitingHuman ? 'Carry on from here' : 'Run'}
                  </button>
                )}
                {/* Kept for diagnosing one decision in isolation — deliberately not the primary
                    action any more: pressing a button between every step is not autonomy. */}
                <button className="neutral" onClick={nextDiscoveryStep} disabled={discoveryBusy || discovery.running}>
                  Run one step
                </button>
                <button className="neutral-solid" onClick={stopDiscoveryRun} disabled={discoveryBusy}>
                  {discovery.running ? 'Stop' : 'Discard run'}
                </button>
              </div>

              {discovery.outcome && !discovery.running && (
                <div
                  className={`fiori-message-strip ${
                    discovery.outcome.kind === 'done' ? 'success' : discovery.outcome.kind === 'error' ? 'error' : 'warning'
                  }`}
                  role="status"
                >
                  {discovery.outcome.kind === 'done' && <>The instruction reports itself complete.</>}
                  {discovery.outcome.kind === 'stopped' && <>Stopped on request — everything found so far is kept.</>}
                  {discovery.outcome.kind === 'needsHuman' && (
                    <>
                      {discovery.outcome.reason} <strong>Over to you</strong> — carry on in the live window and every control you touch is
                      recorded here, then press “Carry on from here”.
                    </>
                  )}
                  {discovery.outcome.kind === 'budgetReached' && (
                    <>
                      {discovery.outcome.reason} <strong>Over to you</strong> — carry on in the live window, or press “Carry on from here” to
                      let it try again.
                    </>
                  )}
                  {discovery.outcome.kind === 'error' && <>Stopped on an error: {discovery.outcome.reason}</>}
                </div>
              )}

              {lastStep && (
                <div
                  className={`fiori-message-strip ${lastStep.decision.kind === 'needsFallback' ? 'warning' : lastStep.decision.kind === 'done' ? 'success' : 'success'}`}
                  role="status"
                >
                  {lastStep.decision.kind === 'action' && lastStep.step && (
                    <>
                      Ran <strong>{lastStep.step.module}</strong>
                      {lastStep.registeredControl && (
                        <>
                          {' '}
                          on <strong>{lastStep.registeredControl.name}</strong>
                          {lastStep.registeredControl.isNew ? ' (newly registered into the Object Repository)' : ' (already known)'}
                        </>
                      )}
                      {lastStep.step.narrate && <> — {lastStep.step.narrate}</>}
                    </>
                  )}
                  {lastStep.decision.kind === 'needsFallback' && <>Stopped: {lastStep.decision.reason} This needs a human to take over from here.</>}
                  {lastStep.decision.kind === 'done' && <>The instruction reports itself complete.</>}
                </div>
              )}

              {discovery.steps && discovery.steps.length > 0 && (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>By</th>
                        <th>Module</th>
                        <th>What happened</th>
                      </tr>
                    </thead>
                    <tbody>
                      {discovery.steps.map((s, i) => (
                        <tr key={i}>
                          <td>{i + 1}</td>
                          <td>
                            <span className={`badge ${s.byHuman ? 'warning' : 'neutral'}`}>{s.byHuman ? 'you' : 'AI'}</span>
                          </td>
                          <td>{s.module}</td>
                          <td className="hint">
                            {s.narrate ?? Object.entries(s.params).map(([k, v]) => `${k}=${v}`).join(', ')}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {discoveryError && <p className="error-text">{discoveryError}</p>}
        </div>
      )}

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
          captureTarget={captureTarget && { fieldLabel: captureTarget.fieldLabel, onUse: captureTarget.onUse }}
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

          {!showAll && (
            <CurationList
              controls={controls}
              defaultAppId={appId}
              captureTarget={captureTarget && { fieldLabel: captureTarget.fieldLabel, onUse: captureTarget.onUse }}
            />
          )}

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
