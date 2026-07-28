import { useEffect, useState } from 'react';
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
  Sliders,
  X,
  Zap,
} from 'lucide-react';
import { api } from './api';
import { AutomationOverview } from './components/AutomationOverview';
import { AccountMenu } from './components/AccountMenu';
import { DataEditor } from './components/DataEditor';
import { DocumentsPanel } from './components/DocumentsPanel';
import { ErrorBoundary } from './components/ErrorBoundary';
import { GroupEditor } from './components/GroupEditor';
import { LoginScreen } from './components/LoginScreen';
import { ObjectScanner } from './components/ObjectScanner';
import { RunPanel } from './components/RunPanel';
import { SettingsPanel } from './components/SettingsPanel';
import { TestCaseEditor } from './components/TestCaseEditor';
import type { AuthState, IntegrationSettings, SapIntegrationStatus } from './types';

export type View = 'launchpad' | 'objects' | 'editor' | 'data' | 'groups' | 'run' | 'documents';

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
    label: 'Process Suites',
    num: 4,
    icon: <Layers size={19} />,
    desc: 'Organise test cases into process suites',
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
  const [view, setView] = useState<View>('launchpad');
  const [theme, setTheme] = useState<'light' | 'dark'>(() => localStorage.getItem('qa4hana.theme') === 'dark' ? 'dark' : 'light');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [helperDrawerOpen, setHelperDrawerOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsInitialIntegration, setSettingsInitialIntegration] = useState<'sap' | 'salesforce' | 'oracle' | 'servicenow'>('sap');
  const [activeViewDirty, setActiveViewDirty] = useState(false);
  const [auth, setAuth] = useState<AuthState | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [integrationSettings, setIntegrationSettings] = useState<IntegrationSettings | null>(null);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('qa4hana.theme', theme);
  }, [theme]);

  useEffect(() => {
    api.getAuthState().then(setAuth).catch((reason) => setAuthError(String(reason)));
  }, []);

  useEffect(() => {
    if (!auth?.authenticated) return;
    api.getIntegrationSettings().then(setIntegrationSettings).catch(() => setIntegrationSettings(null));
  }, [auth?.authenticated]);

  if (authError) {
    return <main className="login-screen"><section className="login-card"><h1>Studio could not start</h1><p className="error-text">{authError}</p></section></main>;
  }
  if (!auth) {
    return <main className="login-screen"><section className="login-card"><p>Loading workspace…</p></section></main>;
  }
  if (!auth.authenticated) {
    return <LoginScreen auth={auth} onAuthenticated={setAuth} />;
  }

  const pipelineSteps = navSteps.filter((step) => step.num !== undefined);
  const currentPipelineIdx = pipelineSteps.findIndex((step) => step.id === view);
  const currentStep = navSteps.find((step) => step.id === view) ?? navSteps[0];

  const navigateTo = (nextView: View) => {
    if (nextView === view) return;
    if (activeViewDirty && !window.confirm('You have unsaved changes. Discard them and leave this page?')) return;
    setActiveViewDirty(false);
    setView(nextView);
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
    if (!integrationSettings?.sap.configured) return 'No SAP target configured';
    try {
      return `SAP · ${new URL(integrationSettings.sap.url).hostname}`;
    } catch {
      return 'SAP target configured';
    }
  })();

  const handleSapSaved = (sap: SapIntegrationStatus) => {
    setIntegrationSettings((current) => current ? { ...current, sap } : null);
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
                aria-label={sidebarCollapsed ? step.label : undefined}
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
              className={`context-target${integrationSettings?.sap.configured ? ' configured' : ''}`}
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
                  <AutomationOverview onNavigate={navigateTo} />
                ) : view === 'objects' ? (
                  <ObjectScanner />
                ) : view === 'editor' ? (
                  <TestCaseEditor selectedTxTemplate={null} onDirtyChange={setActiveViewDirty} />
                ) : view === 'data' ? (
                  <DataEditor onDirtyChange={setActiveViewDirty} />
                ) : view === 'groups' ? (
                  <GroupEditor onDirtyChange={setActiveViewDirty} />
                ) : view === 'documents' ? (
                  <DocumentsPanel />
                ) : (
                  <RunPanel />
                )}
              </div>
            </ErrorBoundary>
          </main>

          {helperDrawerOpen && (
            <aside id="authoring-reference" className="engineer-side-drawer" aria-label="Help and authoring reference">
              <div className="drawer-header">
                <h3><BookOpen size={18} aria-hidden="true" /> Help and reference</h3>
                <button type="button" className="ghost" onClick={() => setHelperDrawerOpen(false)} aria-label="Close help">
                  <X size={16} aria-hidden="true" />
                </button>
              </div>

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
    </div>
  );
}

export default App;
