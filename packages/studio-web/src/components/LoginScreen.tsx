import { api } from '../api';
import type { AuthState } from '../types';
import { GoogleSignInButton } from './GoogleSignInButton';

export function LoginScreen({
  auth,
  onAuthenticated,
}: {
  auth: AuthState;
  onAuthenticated: (next: AuthState) => void;
}) {
  async function signIn(credential: string) {
    await api.signInWithGoogle(credential);
    onAuthenticated(await api.getAuthState());
  }

  return (
    <main className="login-screen">
      <section className="login-card" aria-labelledby="login-title">
        <span className="login-logo-pair" aria-hidden="true">
          <img className="brand-logo-light" src="/ai-elk-logo-transparent.png" alt="" />
          <img className="brand-logo-dark" src="/ai-elk-logo-dark.png" alt="" />
        </span>
        <span className="canvas-eyebrow">Secure single-user workspace</span>
        <h1 id="login-title">Sign in to QA/4HANA Studio</h1>
        <p>
          Continue with the Google account registered as this workspace’s owner. Your existing execution history,
          object repository, test data, and evidence remain in the same local workspace.
        </p>
        <GoogleSignInButton clientId={auth.googleClientId} onCredential={signIn} />
      </section>
    </main>
  );
}
