import { Check, Cloud, Database, Moon, Server, Sun, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api } from '../api';
import type { AuthState, IntegrationSettings, SapIntegrationStatus } from '../types';
import { GoogleSignInButton } from './GoogleSignInButton';

type IntegrationKey = 'sap' | 'salesforce' | 'oracle' | 'servicenow';

const integrations: { key: IntegrationKey; label: string; description: string }[] = [
  { key: 'sap', label: 'SAP', description: 'Active execution and live-scan target' },
  { key: 'salesforce', label: 'Salesforce', description: 'Configuration preview · execution support later' },
  { key: 'oracle', label: 'Oracle', description: 'Configuration preview · execution support later' },
  { key: 'servicenow', label: 'ServiceNow', description: 'Configuration preview · execution support later' },
];

function integrationIcon(key: IntegrationKey) {
  if (key === 'sap') return <Server size={17} aria-hidden="true" />;
  if (key === 'oracle') return <Database size={17} aria-hidden="true" />;
  return <Cloud size={17} aria-hidden="true" />;
}

export function SettingsPanel({
  theme,
  auth,
  integrationSettings,
  initialIntegration = 'sap',
  onThemeChange,
  onAuthChange,
  onSapSaved,
  onClose,
}: {
  theme: 'light' | 'dark';
  auth: AuthState;
  integrationSettings: IntegrationSettings | null;
  initialIntegration?: IntegrationKey;
  onThemeChange: (theme: 'light' | 'dark') => void;
  onAuthChange: (auth: AuthState) => void;
  onSapSaved: (sap: SapIntegrationStatus) => void;
  onClose: () => void;
}) {
  const [selected, setSelected] = useState<IntegrationKey>(initialIntegration);
  const [googleClientId, setGoogleClientId] = useState(auth.googleClientId);
  const [url, setUrl] = useState(integrationSettings?.sap.url ?? '');
  const [username, setUsername] = useState(integrationSettings?.sap.username ?? '');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setGoogleClientId(auth.googleClientId);
  }, [auth.googleClientId]);

  useEffect(() => {
    setUrl(integrationSettings?.sap.url ?? '');
    setUsername(integrationSettings?.sap.username ?? '');
  }, [integrationSettings]);

  async function saveGoogleClientId() {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const next = await api.saveGoogleClientId(googleClientId);
      onAuthChange({ ...next, user: auth.user, authenticated: auth.authenticated });
      setMessage('Google sign-in configuration saved. Use the Google button below to register this account as the owner.');
    } catch (reason) {
      setError(String(reason));
    } finally {
      setSaving(false);
    }
  }

  async function googleCredential(credential: string) {
    await api.signInWithGoogle(credential);
    const next = await api.getAuthState();
    onAuthChange(next);
    setMessage(`${next.user?.email ?? 'Google account'} is now the registered workspace owner.`);
  }

  async function saveSap() {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const saved = await api.saveSapIntegration({ url, username, password });
      onSapSaved(saved);
      setPassword('');
      setMessage('SAP target saved securely. Execution Login and Live Scan now use this URL.');
    } catch (reason) {
      setError(String(reason));
    } finally {
      setSaving(false);
    }
  }

  const selectedMeta = integrations.find((item) => item.key === selected)!;
  const selectedAvailable = selected === 'sap';

  return (
    <div className="settings-backdrop" role="presentation">
      <section className="settings-panel" role="dialog" aria-modal="true" aria-labelledby="settings-title">
        <header className="settings-header">
          <div>
            <span className="canvas-eyebrow">Workspace preferences</span>
            <h2 id="settings-title">Settings</h2>
          </div>
          <button type="button" className="ghost" onClick={onClose} aria-label="Close settings"><X size={18} /></button>
        </header>

        <div className="settings-content">
          <section className="settings-section">
            <h3>Appearance</h3>
            <div className="settings-segmented" aria-label="Colour theme">
              <button type="button" className={theme === 'light' ? 'active' : ''} onClick={() => onThemeChange('light')}>
                <Sun size={16} /> Light
              </button>
              <button type="button" className={theme === 'dark' ? 'active' : ''} onClick={() => onThemeChange('dark')}>
                <Moon size={16} /> Dark
              </button>
            </div>
          </section>

          <section className="settings-section">
            <h3>Owner account</h3>
            <p className="settings-note">
              The first verified Google account becomes the sole owner. Linking it does not move, rename, or filter any existing workspace data.
            </p>
            <div className="settings-inline-form">
              <label>
                Google OAuth web client ID
                <input
                  type="text"
                  value={googleClientId}
                  onChange={(event) => setGoogleClientId(event.currentTarget.value)}
                  placeholder="1234567890-…apps.googleusercontent.com"
                />
              </label>
              <button type="button" onClick={saveGoogleClientId} disabled={saving}>Save client ID</button>
            </div>
            {auth.user?.provider === 'google' ? (
              <div className="settings-connected"><Check size={16} /> Connected as {auth.user.email}</div>
            ) : (
              <GoogleSignInButton clientId={auth.googleClientId} onCredential={googleCredential} />
            )}
          </section>

          <section className="settings-section">
            <h3>Test-system connections</h3>
            <div className="integration-layout">
              <nav className="integration-list" aria-label="Integration settings">
                {integrations.map((integration) => (
                  <button
                    type="button"
                    key={integration.key}
                    className={selected === integration.key ? 'active' : ''}
                    onClick={() => { setSelected(integration.key); setMessage(null); setError(null); }}
                  >
                    {integrationIcon(integration.key)}
                    <span><strong>{integration.label}</strong><small>{integration.description}</small></span>
                  </button>
                ))}
              </nav>

              <div className="integration-editor">
                <div className="integration-editor-heading">
                  <div>
                    <h4>{selectedMeta.label}</h4>
                    <p>{selectedMeta.description}</p>
                  </div>
                  {selected === 'sap' && integrationSettings?.sap.configured && <span className="badge passed">Configured</span>}
                </div>
                <label>
                  Test-system URL
                  <input
                    type="url"
                    value={selected === 'sap' ? url : ''}
                    onChange={(event) => selected === 'sap' && setUrl(event.currentTarget.value)}
                    placeholder={`https://your-${selected}.test.example`}
                    disabled={!selectedAvailable}
                  />
                </label>
                <label>
                  Username
                  <input
                    type="text"
                    value={selected === 'sap' ? username : ''}
                    onChange={(event) => selected === 'sap' && setUsername(event.currentTarget.value)}
                    disabled={!selectedAvailable}
                  />
                </label>
                <label>
                  Password
                  <input
                    type="password"
                    value={selected === 'sap' ? password : ''}
                    onChange={(event) => selected === 'sap' && setPassword(event.currentTarget.value)}
                    placeholder={selected === 'sap' && integrationSettings?.sap.configured ? 'Leave blank to keep saved password' : ''}
                    autoComplete="new-password"
                    disabled={!selectedAvailable}
                  />
                </label>
                {selectedAvailable ? (
                  <>
                    <p className="settings-note">
                      Credentials use the OS vault where available, with an encrypted local fallback for detached Windows server sessions. Passwords are never returned to this browser.
                      {integrationSettings?.sap.source === 'environment' ? ' This profile is currently controlled by server environment variables.' : ''}
                    </p>
                    <button type="button" className="primary" onClick={saveSap} disabled={saving}>
                      {saving ? 'Saving…' : 'Save SAP connection'}
                    </button>
                  </>
                ) : (
                  <p className="fiori-message-strip info">Configuration UI is reserved; execution support will be enabled in a later release.</p>
                )}
              </div>
            </div>
          </section>

          {message && <p className="fiori-message-strip success" role="status">{message}</p>}
          {error && <p className="error-text" role="alert">{error}</p>}
        </div>
      </section>
    </div>
  );
}
