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
        <div className="login-brand-header">
          <img src="/g-stride-logo.png" alt="G-Stride" className="login-logo-img" width="36" height="36" />
          <span className="canvas-eyebrow">Secure single-user workspace</span>
        </div>
        <h1 id="login-title">Sign in to G-Stride</h1>
        <p>
          Continue with the Google account registered as this workspace’s owner. Your existing execution history,
          object repository, test data, and evidence remain in the same local workspace.
        </p>
        <GoogleSignInButton clientId={auth.googleClientId} onCredential={signIn} />
      </section>
    </main>
  );
}
