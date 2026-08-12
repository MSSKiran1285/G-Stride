import { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Database,
  FileCheck2,
  FileCode2,
  HelpCircle,
  Layers,
  LayoutGrid,
  PanelLeftClose,
  PanelLeftOpen,
  Play,
  Scan,
  Search,
  Sliders,
  Tag,
  Zap,
} from 'lucide-react';
import { api } from './api';
import { AutomationOverview } from './components/AutomationOverview';
import { AccountMenu } from './components/AccountMenu';
import { DataEditor } from './components/DataEditor';
import { DocumentsPanel } from './components/DocumentsPanel';
import { ContextualCapturePanel } from './components/ContextualCapturePanel';
import { GlobalSearchPanel } from './components/GlobalSearchPanel';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ProcessPacksWorkspace } from './components/ProcessPacksWorkspace';
import { LoginScreen } from './components/LoginScreen';
import { ObjectScanner } from './components/ObjectScanner';
import { RunPanel } from './components/RunPanel';
import { SettingsPanel } from './components/SettingsPanel';
import { TestLibrary } from './components/TestLibrary';
import { AsyncFeedback, DrawerHeader } from './components/WorkspacePrimitives';
import type { AuthState, CaptureRequest, IntegrationSettings, SapIntegrationStatus, WorkspaceContext } from './types';
import { parseStudioRoute, studioRoutes, VIEW_PATHS } from './routes';
import type { WorkspaceView } from './routes';

export type View = WorkspaceView;

interface NavStep {
  id: View;
  label: string;
  num?: number;
  icon: React.ReactNode;
  desc: string;
}

const navSteps: NavStep[] = [
  {
    id: 'launchpad',
    label: 'Overview',
    icon: <LayoutGrid size={18} />,
    desc: 'Continue recent work and review execution activity',
  },
  {
    id: 'objects',
    label: 'Object Library',
    icon: <Scan size={18} />,
    desc: 'Discover and curate reusable page controls',
  },
  {
    id: 'editor',
    label: 'Compose Tests',
    icon: <FileCode2 size={18} />,
    desc: 'Build modular, executable Tests',
  },
  {
    id: 'data',
    label: 'Test Data',
    icon: <Database size={18} />,
    desc: 'Manage datasets and variables',
  },
  {
    id: 'groups',
    label: 'Processes & Packs',
    icon: <Layers size={18} />,
    desc: 'Compose sequenced Business Processes and independent Regression Packs',
  },
  {
    id: 'run',
    label: 'Execution Center',
    icon: <Play size={18} />,
    desc: 'Configure, review, and monitor executions',
  },
  {
    id: 'documents',
    label: 'Evidence Vault',
    icon: <FileCheck2 size={18} />,
    desc: 'View and manage automated test execution evidence and audit trails',
  },
];

export function App() {
  const [routePath, setRoutePath] = useState(window.location.pathname);
  const routePathRef = useRef(window.location.pathname);
  const [view, setView] = useState<View>(() => parseStudioRoute(window.location.pathname).view);
  const [theme, setTheme] = useState<'light' | 'dark'>(() => localStorage.getItem('qa4hana.theme') === 'dark' ? 'dark' : 'light');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [helperDrawerOpen, setHelperDrawerOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsInitialIntegration, setSettingsInitialIntegration] = useState<'sap' | 'salesforce' | 'oracle' | 'servicenow'>('sap');
  const [activeViewDirty, setActiveViewDirty] = useState(false);
  // HC-008: Overview's "Needs attention" failed-runs link seeds Audit and Evidence's status
  // filter on the mount it triggers, then clears once the workspace is left — a plain sidebar
  // click into Audit and Evidence must never inherit a stale filter from an earlier visit.
  const [auditInitialStatusFilter, setAuditInitialStatusFilter] = useState<'' | 'passed' | 'failed'>('');
  // Rendered as a sibling overlay (like settingsOpen/SettingsPanel below), never a route
  // change — so a Compose field can launch a capture session without tripping the
  // activeViewDirty navigation guard or losing in-progress Test edits (BL-023 AC4).
  const [captureRequest, setCaptureRequest] = useState<CaptureRequest | null>(null);
  // BL-037: global search is another app-level sibling overlay for the same reason —
  // it must stay reachable from every workspace without tripping the dirty-navigation guard.
  const [searchOpen, setSearchOpen] = useState(false);
  const [auth, setAuth] = useState<AuthState | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [integrationSettings, setIntegrationSettings] = useState<IntegrationSettings | null>(null);
  const [workspaceContext, setWorkspaceContext] = useState<WorkspaceContext | null>(null);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('qa4hana.theme', theme);
  }, [theme]);

  useEffect(() => {
    api.getAuthState().then(setAuth).catch((reason) => setAuthError(String(reason)));
  }, []);

  useEffect(() => {
    const handlePopState = () => {
      const nextPath = window.location.pathname;
      const nextView = parseStudioRoute(nextPath).view;
      if (activeViewDirty && !window.confirm('You have unsaved changes. Discard them and leave this page?')) {
        window.history.pushState({}, '', routePathRef.current);
        return;
      }
      setActiveViewDirty(false);
      routePathRef.current = nextPath;
      setRoutePath(nextPath);
      setView(nextView);
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [activeViewDirty, routePath]);

  useEffect(() => {
    if (!auth?.authenticated) return;
    api.getIntegrationSettings().then(setIntegrationSettings).catch(() => setIntegrationSettings(null));
    api.getWorkspaceContext().then(setWorkspaceContext).catch(() => setWorkspaceContext(null));
  }, [auth?.authenticated]);

  useEffect(() => {
    if (view !== 'documents' && auditInitialStatusFilter) setAuditInitialStatusFilter('');
  }, [view, auditInitialStatusFilter]);

  if (authError) {
    return <main className="login-screen"><section className="login-card"><h1>Studio could not start</h1><p className="error-text">{authError}</p></section></main>;
  }
  if (!auth) {
    return <main className="login-screen"><section className="login-card"><AsyncFeedback state="loading" message="Loading workspace…" /></section></main>;
  }
  if (!auth.authenticated) {
    return <LoginScreen auth={auth} onAuthenticated={setAuth} />;
  }

  const route = parseStudioRoute(routePath);
  const currentStep = navSteps.find((step) => step.id === view) ?? navSteps[0];

  const navigateTo = (nextView: View) => {
    if (nextView === view && routePath === VIEW_PATHS[nextView]) return;
    if (activeViewDirty && !window.confirm('You have unsaved changes. Discard them and leave this page?')) return;
    setActiveViewDirty(false);
    const nextPath = VIEW_PATHS[nextView];
    window.history.pushState({}, '', nextPath);
    routePathRef.current = nextPath;
    setRoutePath(nextPath);
    setView(nextView);
  };

  const navigateToPath = (nextPath: string, respectDirty = true) => {
    if (nextPath === routePath) return;
    if (respectDirty && activeViewDirty && !window.confirm('You have unsaved changes. Discard them and leave this page?')) return;
    setActiveViewDirty(false);
    window.history.pushState({}, '', nextPath);
    routePathRef.current = nextPath;
    setRoutePath(nextPath);
    setView(parseStudioRoute(nextPath).view);
  };

  const updateDetailPath = (nextPath: string) => {
    if (nextPath === routePath) return;
    window.history.pushState({}, '', nextPath);
    routePathRef.current = nextPath;
    setRoutePath(nextPath);
    setView(parseStudioRoute(nextPath).view);
  };

  const openRunRoute = (runId: string) => {
    navigateToPath(studioRoutes.run(runId), false);
  };

  const goToNextStep = () => {
    const idx = navSteps.findIndex((s) => s.id === view);
    if (idx >= 0 && idx < navSteps.length - 1) {
      navigateTo(navSteps[idx + 1].id);
    }
  };

  const goToPrevStep = () => {
    const idx = navSteps.findIndex((s) => s.id === view);
    if (idx > 0) {
      navigateTo(navSteps[idx - 1].id);
    }
  };

  const openSettings = (integration: 'sap' | 'salesforce' | 'oracle' | 'servicenow' = 'sap') => {
    setSettingsInitialIntegration(integration);
    setSettingsOpen(true);
  };

  const targetLabel = (() => {
    if (!workspaceContext?.target.configured) return 'No SAP target configured';
    const classLabel = workspaceContext.target.safetyClass === 'non-production'
      ? 'Non-production'
      : workspaceContext.target.safetyClass === 'production-like'
        ? 'Production-like'
        : 'Unclassified';
    const verification = workspaceContext.target.verificationStatus === 'live-verified'
      ? 'Verified'
      : 'Verification required';
    return `SAP · ${workspaceContext.target.hostname ?? 'configured'} · ${classLabel} · ${verification}`;
  })();

  const handleSapSaved = (sap: SapIntegrationStatus) => {
    setIntegrationSettings((current) => current ? { ...current, sap } : null);
    api.getWorkspaceContext().then(setWorkspaceContext).catch(() => setWorkspaceContext(null));
  };

  const signOut = async () => {
    await api.signOut();
    setAuth(await api.getAuthState());
  };

  return (
    <div className={`app-layout canvas-shell ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
      <a className="skip-link" href="#main-content">Skip to main content</a>

      <aside className="lhs-panel" aria-label="Primary application navigation">
        <div className="lhs-brand-header">
          <button
            type="button"
            className="lhs-brand-logo"
            onClick={() => navigateTo('launchpad')}
            aria-label="G-Stride — go to Automation Overview"
          >
            <img src="/g-stride-logo.png" alt="G-Stride" className="brand-logo-icon" width="22" height="22" />
            {!sidebarCollapsed && (
              <span className="brand-title-wrap">
                <span className="brand-name">G-Stride</span>
              </span>
            )}
          </button>
          <button
            type="button"
            className="lhs-collapse-btn"
            onClick={() => setSidebarCollapsed((collapsed) => !collapsed)}
            title={sidebarCollapsed ? 'Expand navigation' : 'Collapse navigation'}
            aria-label={sidebarCollapsed ? 'Expand navigation' : 'Collapse navigation'}
            aria-expanded={!sidebarCollapsed}
          >
            {sidebarCollapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}
          </button>
        </div>

        <nav className="lhs-nav" aria-label="Workspace">
          {navSteps.map((step) => {
            const isActive = view === step.id;
            return (
              <button
                type="button"
                key={step.id}
                className={`lhs-nav-item ${isActive ? 'active' : ''}`}
                onClick={() => navigateTo(step.id)}
                title={sidebarCollapsed ? step.label : step.desc}
                aria-current={isActive ? 'page' : undefined}
                aria-label={step.label}
              >
                <span className="nav-item-icon-wrap" aria-hidden="true">{step.icon}</span>
                {!sidebarCollapsed && <span className="nav-item-label">{step.label}</span>}
              </button>
            );
          })}
        </nav>

        <div className="lhs-footer">
          <AccountMenu
            user={auth.user!}
            collapsed={sidebarCollapsed}
            canSignOut={auth.ownerRegistered}
            onSettings={() => openSettings()}
            onHelp={() => setHelperDrawerOpen(true)}
            onSignOut={() => void signOut()}
          />
        </div>
      </aside>

      <div className="workspace-container">
        <header className="workspace-header">
          <div className="workspace-header-left">
            <div className="breadcrumb-path" aria-label="Breadcrumb">
              <button type="button" className="bc-app" onClick={() => navigateTo('launchpad')}>
                Workspace
              </button>
              <span className="bc-sep" aria-hidden="true">/</span>
              <span className="bc-current">{currentStep.label}</span>
            </div>
          </div>
        </header>

        <div className="workspace-stage">
          <main className="workspace-body" id="main-content" tabIndex={-1}>
            {view !== 'launchpad' && <h1 className="sr-only">{currentStep.label}</h1>}
            <ErrorBoundary key={view}>
              <div className="view-transition-wrapper">
                {view === 'launchpad' ? (
                  <AutomationOverview
                    onNavigate={navigateTo}
                    onNavigateToRoute={(path) => navigateToPath(path)}
                    onOpenFailedRuns={() => {
                      setAuditInitialStatusFilter('failed');
                      navigateTo('documents');
                    }}
                    workspaceContext={workspaceContext}
                  />
                ) : view === 'objects' ? (
                  <ObjectScanner
                    initialAppId={route.objectAppId}
                    initialObjectName={route.objectName}
                    onSelectionChange={(appId, objectName) => updateDetailPath(studioRoutes.object(appId, objectName ?? undefined))}
                  />
                ) : view === 'editor' ? (
                  <TestLibrary
                    initialFile={route.testFile}
                    onSelectedFileChange={(file) => updateDetailPath(file ? studioRoutes.test(file) : VIEW_PATHS.editor)}
                    onDirtyChange={setActiveViewDirty}
                    onRequestCapture={setCaptureRequest}
                  />
                ) : view === 'data' ? (
                  <DataEditor
                    initialFile={route.dataFile}
                    onSelectedFileChange={(file) => updateDetailPath(studioRoutes.data(file))}
                    onDirtyChange={setActiveViewDirty}
                  />
                ) : view === 'groups' ? (
                  <ProcessPacksWorkspace
                    initialSection={route.processWorkspace}
                    initialProcessFile={route.processFile}
                    initialPackFile={route.packFile}
                    onProcessFileChange={(file) => updateDetailPath(studioRoutes.process(file))}
                    onPackFileChange={(file) => updateDetailPath(studioRoutes.pack(file))}
                    onSectionChange={(section) => updateDetailPath(section === 'packs' ? studioRoutes.packs() : VIEW_PATHS.groups)}
                    onDirtyChange={setActiveViewDirty}
                  />
                ) : view === 'documents' ? (
                  <DocumentsPanel
                    selectedRunId={route.auditRunId}
                    onSelectedRunChange={(runId) => updateDetailPath(runId ? studioRoutes.auditRun(runId) : VIEW_PATHS.documents)}
                    onNavigateToRoute={(path) => navigateToPath(path)}
                    initialStatusFilter={auditInitialStatusFilter}
                  />
                ) : (
                  <RunPanel
                    initialRunId={route.runId}
                    onRunStarted={openRunRoute}
                    onNavigateToRoute={(path) => navigateToPath(path)}
                    onOpenSapSettings={() => openSettings('sap')}
                    onDirtyChange={setActiveViewDirty}
                  />
                )}
              </div>
            </ErrorBoundary>
          </main>

          {helperDrawerOpen && (
            <aside id="authoring-reference" className="engineer-side-drawer" aria-label="Help and authoring reference">
              <DrawerHeader
                title="Help and reference"
                icon={<BookOpen size={18} aria-hidden="true" />}
                closeLabel="Close help"
                onClose={() => setHelperDrawerOpen(false)}
              />

              <div className="drawer-body">
                <details className="drawer-section" open>
                  <summary><Zap size={14} aria-hidden="true" /> Placeholder examples</summary>
                  <div className="token-chips-stack">
                    <div className="token-item">
                      <code>{'{{step1.capturedDocNumber}}'}</code>
                      <span>Value captured by an earlier step</span>
                    </div>
                    <div className="token-item">
                      <code>{'{{data.SupplierField}}'}</code>
                      <span>Dynamic value from the selected dataset</span>
                    </div>
                  </div>
                </details>

                <details className="drawer-section" open>
                  <summary><HelpCircle size={14} aria-hidden="true" /> Response examples</summary>
                  <div className="sap-codes-list">
                    <div className="code-row">
                      <span className="code-badge success">200 OK</span>
                      <span>Document created successfully</span>
                    </div>
                    <div className="code-row">
                      <span className="code-badge warning">M8 082</span>
                      <span>Invoice gross amount mismatch</span>
                    </div>
                    <div className="code-row">
                      <span className="code-badge error">ME 023</span>
                      <span>Supplier not maintained in Purchasing Org</span>
                    </div>
                  </div>
                </details>

                <details className="drawer-section">
                  <summary><HelpCircle size={14} aria-hidden="true" /> Guides</summary>
                  <div className="help-guide-list">
                    <details className="help-guide-item">
                      <summary>What is a legacy Test contract?</summary>
                      <p>A Test with no declared contract runs fine as raw ModuleCall JSON, but it can't be Published — Published status requires reviewed, typed inputs and outputs Studio can validate before execution and use to safely bind hand-offs between stages. "Legacy ready" just means it's executable but not yet contract-declared.</p>
                    </details>
                    <details className="help-guide-item">
                      <summary>What does "Use inferred contract" do?</summary>
                      <p>It scans the Test's own steps and their value bindings (dataset columns, system-context values, prior-step outputs) and generates a starting contract — typed inputs and outputs — for you to review and adjust, instead of declaring one from scratch.</p>
                    </details>
                    <details className="help-guide-item">
                      <summary>What does publishing a Test do?</summary>
                      <p>It moves the Test from Draft to Published once its contract is complete and valid: every input/output is typed, every object reference resolves, and every value binding resolves to a real source. Only Published Tests can be used as members of a Regression Pack.</p>
                    </details>
                    <details className="help-guide-item">
                      <summary>What does the target classification note mean?</summary>
                      <p>"Non-production" vs "Production-like" records how safe this SAP target is to run transactional tests against — Studio applies stricter fail-stop and authorisation rules for production-like targets. "Verification required" means the connection details are saved but haven't been confirmed live yet; use "Verify connection" in Settings.</p>
                    </details>
                    <details className="help-guide-item">
                      <summary>Why does capturing a login/SSO screen find 0 controls?</summary>
                      <p>A SAML or corporate SSO login page isn't part of the target SAP Fiori app — it's a separate identity-provider page with no UI5 control tree for Studio to scan, so 0 controls discovered there is expected, not an error. Capture the actual application screen after login instead.</p>
                    </details>
                    <details className="help-guide-item">
                      <summary>What are the text boxes on the capture screen for?</summary>
                      <p>The URL field is the SAP page to scan (from your saved target, editable per capture). The App ID field groups everything you capture under one identifier so later Tests and the Object Repository can find it. The small field beside "Capture" lets you type an expected value to compare against, when the module you're curating supports it (e.g. a Read/assert control).</p>
                    </details>
                    <details className="help-guide-item">
                      <summary>How does a dataset's column schema work?</summary>
                      <p>Each column can declare a type (string, number, date…), a sensitivity level (public, business, credential) and an example value — the same vocabulary a Test's own typed contract inputs use. This lets Compose validate a dataset binding against what a Test actually expects, and keeps sensitive columns flagged wherever they're used.</p>
                    </details>
                    <details className="help-guide-item">
                      <summary>How do I use the Relational CSV builder?</summary>
                      <p>Pick a header CSV and a child CSV, then declare the header key and the child's matching foreign key — this joins one header row to all of its owned child rows (e.g. a sales order to its line items) without flattening them into one file. Give the relationship a name and a child collection name, then Validate before Save; it blocks duplicate header keys, missing keys, and orphan child rows.</p>
                    </details>
                    <details className="help-guide-item">
                      <summary>What is stage topology and a typed hand-off?</summary>
                      <p>A Business Process is an ordered list of stages, each running one Test. A typed hand-off lets a later stage's input be bound to an earlier stage's captured output (e.g. stage 2 uses the PO number stage 1 created) instead of hard-coding it — Studio blocks forward references and cycles so hand-offs always flow from an earlier stage to a later one.</p>
                    </details>
                    <details className="help-guide-item">
                      <summary>What's the difference between Chain, Suite, Batch and Pack?</summary>
                      <p><strong>Chain</strong> runs one Test once. <strong>Suite</strong> runs several independent Tests in one session. <strong>Batch</strong> runs one Business Process across every row of a dataset, each row an isolated transaction. A <strong>Regression Pack</strong> runs a saved, published mix of Tests and Processes together, each with its own data and session policy — the closest thing to a full regression cycle.</p>
                    </details>
                  </div>
                </details>

                <details className="drawer-section release-notes-section" open>
                  <summary><Tag size={14} aria-hidden="true" /> Release notes</summary>

                  <article className="release-note-entry">
                    <div className="release-note-heading">
                      <strong>2.1.0</strong>
                      <span className="badge warning">Candidate — not yet released</span>
                    </div>
                    <p className="release-note-summary">
                      15 items shipped since 2.0.0: Automation Overview alerts and impact analytics,
                      the Object Repository workbench and selector health, a routeable Test/Data
                      Library, visual Business Processes and Regression Packs, hierarchical execution
                      monitoring with focused failure diagnosis, searchable Audit and Evidence
                      history with lineage, and global artifact search with dependency-aware
                      rename/delete.
                    </p>
                    <p className="release-note-caveat">
                      Automated accessibility checks (Axe, keyboard, reflow) are current for this
                      candidate. <strong>Manual NVDA screen-reader verification and live-SAP
                      re-verification have not been performed for 2.1.0</strong> — the accessibility
                      sign-off on file remains the one recorded for 2.0.0. No workspace-owner sign-off
                      or release tag exists yet for 2.1.0.
                    </p>
                    <p className="release-note-ref">Full detail: docs/ui-ux/RELEASE_NOTES_2.1.0.md</p>
                  </article>

                  <article className="release-note-entry">
                    <div className="release-note-heading">
                      <strong>2.0.0</strong>
                      <span className="badge success">Released — General Availability</span>
                    </div>
                    <p className="release-note-summary">
                      The signed GA baseline: verified execution context, protected artifacts,
                      responsive shell, nested/relational transaction data, authoritative preflight
                      and rerun lineage, canonical evidence, and secured identity/target
                      administration across 24 backlog items.
                    </p>
                    <p className="release-note-caveat">
                      Accessibility was fully verified for this release, including a completed
                      manual NVDA 2026.1.1 screen-reader journey across all seven workspaces, live-SAP
                      read-only and authorised transactional verification, and explicit
                      workspace-owner sign-off.
                    </p>
                    <p className="release-note-ref">Full detail: docs/ui-ux/RELEASE_NOTES_2.0.0.md</p>
                  </article>
                </details>
              </div>
            </aside>
          )}
        </div>

        <footer className="workspace-bottom-bar" aria-label="Workspace navigation and context">
          <div className="workspace-bottom-left">
            <button
              type="button"
              className="header-search-trigger"
              onClick={() => setSearchOpen(true)}
              title="Search Tests, Objects, Datasets, Processes, Packs and Runs"
            >
              <Search size={13} aria-hidden="true" /> Search
            </button>
            <button
              type="button"
              className={`context-target${workspaceContext?.target.configured ? ' configured' : ''}`}
              onClick={() => openSettings('sap')}
              title="Open SAP target settings"
            >
              <Sliders size={13} aria-hidden="true" />
              <span>{targetLabel}</span>
            </button>
          </div>

          <div className="workspace-bottom-right">
            <div className="workflow-step-actions" aria-label="Workflow navigation">
              {view !== 'launchpad' && (
                <button type="button" className="step-nav-btn" onClick={goToPrevStep}>
                  <ArrowLeft size={13} aria-hidden="true" /> Back
                </button>
              )}
              {view !== 'documents' && (
                <button type="button" className="step-nav-btn primary" onClick={goToNextStep}>
                  Next <ArrowRight size={13} aria-hidden="true" />
                </button>
              )}
            </div>
          </div>
        </footer>
      </div>
      {settingsOpen && (
        <SettingsPanel
          theme={theme}
          auth={auth}
          integrationSettings={integrationSettings}
          initialIntegration={settingsInitialIntegration}
          onThemeChange={setTheme}
          onAuthChange={setAuth}
          onSapSaved={handleSapSaved}
          onClose={() => setSettingsOpen(false)}
        />
      )}
      {captureRequest && (
        <ContextualCapturePanel request={captureRequest} onClose={() => setCaptureRequest(null)} />
      )}
      {searchOpen && (
        <GlobalSearchPanel
          onNavigate={(path) => {
            setSearchOpen(false);
            navigateToPath(path);
          }}
          onClose={() => setSearchOpen(false)}
        />
      )}
    </div>
  );
}

export default App;
