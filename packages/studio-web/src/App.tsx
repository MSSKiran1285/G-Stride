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
    label: 'Automation Overview',
    icon: <LayoutGrid size={19} />,
    desc: 'Continue recent work and review execution activity',
  },
  {
    id: 'objects',
    label: 'Control Object Repository',
    num: 1,
    icon: <Scan size={19} />,
    desc: 'Discover and curate reusable page controls',
  },
  {
    id: 'editor',
    label: 'Compose',
    num: 2,
    icon: <FileCode2 size={19} />,
    desc: 'Build modular, executable test cases',
  },
  {
    id: 'data',
    label: 'Test Data',
    num: 3,
    icon: <Database size={19} />,
    desc: 'Manage datasets and variables',
  },
  {
    id: 'groups',
    label: 'Processes & Packs',
    num: 4,
    icon: <Layers size={19} />,
    desc: 'Compose sequenced Business Processes and independent Regression Packs',
  },
  {
    id: 'run',
    label: 'Execution Center',
    num: 5,
    icon: <Play size={19} />,
    desc: 'Configure, review, and monitor executions',
  },
  {
    id: 'documents',
    label: 'Audit and Evidence',
    num: 6,
    icon: <FileCheck2 size={19} />,
    desc: 'Review captured evidence and immutable run history',
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

  if (authError) {
    return <main className="login-screen"><section className="login-card"><h1>Studio could not start</h1><p className="error-text">{authError}</p></section></main>;
  }
  if (!auth) {
    return <main className="login-screen"><section className="login-card"><AsyncFeedback state="loading" message="Loading workspace…" /></section></main>;
  }
  if (!auth.authenticated) {
    return <LoginScreen auth={auth} onAuthenticated={setAuth} />;
  }

  const pipelineSteps = navSteps.filter((step) => step.num !== undefined);
  const route = parseStudioRoute(routePath);
  const currentPipelineIdx = pipelineSteps.findIndex((step) => step.id === view);
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
    if (currentPipelineIdx !== -1 && currentPipelineIdx < pipelineSteps.length - 1) {
      navigateTo(pipelineSteps[currentPipelineIdx + 1].id);
    }
  };

  const goToPrevStep = () => {
    if (currentPipelineIdx > 0) navigateTo(pipelineSteps[currentPipelineIdx - 1].id);
    else if (currentPipelineIdx === 0) navigateTo('launchpad');
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
            aria-label="QA/4HANA Studio — go to Automation Overview"
          >
            <span className="brand-logo-pair" aria-hidden="true">
              <img className="brand-logo-image brand-logo-light" src="/ai-elk-logo-transparent.png" alt="" />
              <img className="brand-logo-image brand-logo-dark" src="/ai-elk-logo-dark.png" alt="" />
            </span>
            {!sidebarCollapsed && (
              <span className="brand-title-wrap">
                <span className="brand-name">QA/4HANA Studio</span>
                <span className="brand-byline">
                  <span className="brand-by">by</span>
                  <span className="brand-wordmark" aria-label="AI ELK">
                    <span className="brand-wordmark-ai">ai</span><span className="brand-wordmark-elk">elk</span>
                  </span>
                </span>
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

          <div className="workspace-header-right">
            <button
              type="button"
              className="header-search-trigger"
              onClick={() => setSearchOpen(true)}
              title="Search Tests, Objects, Datasets, Processes, Packs and Runs"
            >
              <Search size={15} aria-hidden="true" /> Search
            </button>
            <button
              type="button"
              className={`context-target${workspaceContext?.target.configured ? ' configured' : ''}`}
              onClick={() => openSettings('sap')}
              title="Open SAP target settings"
            >
              <Sliders size={15} aria-hidden="true" />
              <span>{targetLabel}</span>
            </button>

            {view !== 'launchpad' && (
              <div className="workflow-step-actions" aria-label="Workflow navigation">
                <button type="button" className="step-nav-btn" onClick={goToPrevStep}>
                  <ArrowLeft size={14} aria-hidden="true" /> Previous
                </button>
                <button
                  type="button"
                  className="step-nav-btn primary"
                  onClick={goToNextStep}
                  disabled={currentPipelineIdx === pipelineSteps.length - 1}
                >
                  Next <ArrowRight size={14} aria-hidden="true" />
                </button>
              </div>
            )}
          </div>
        </header>

        <div className="workspace-stage">
          <main className="workspace-body" id="main-content" tabIndex={-1}>
            {view !== 'launchpad' && <h1 className="sr-only">{currentStep.label}</h1>}
            <ErrorBoundary key={view}>
              <div className="view-transition-wrapper">
                {view === 'launchpad' ? (
                  <AutomationOverview onNavigate={navigateTo} onNavigateToRoute={(path) => navigateToPath(path)} workspaceContext={workspaceContext} />
                ) : view === 'objects' ? (
                  <ObjectScanner
                    initialAppId={route.objectAppId}
                    initialObjectName={route.objectName}
                    onSelectionChange={(appId, objectName) => updateDetailPath(studioRoutes.object(appId, objectName))}
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
                <section className="drawer-section">
                  <h4><Zap size={14} aria-hidden="true" /> Placeholder examples</h4>
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
                </section>

                <section className="drawer-section">
                  <h4><HelpCircle size={14} aria-hidden="true" /> Response examples</h4>
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
                </section>
              </div>
            </aside>
          )}
        </div>
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
