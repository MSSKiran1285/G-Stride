import { useEffect, useRef, useState } from 'react';

interface GoogleCredentialResponse {
  credential?: string;
}

interface GoogleIdentityApi {
  accounts: {
    id: {
      initialize: (options: { client_id: string; callback: (response: GoogleCredentialResponse) => void; use_fedcm_for_prompt?: boolean }) => void;
      renderButton: (parent: HTMLElement, options: Record<string, unknown>) => void;
    };
  };
}

function googleApi(): GoogleIdentityApi | undefined {
  return (window as typeof window & { google?: GoogleIdentityApi }).google;
}

function loadGoogleIdentityScript(): Promise<void> {
  if (googleApi()) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const existing = document.getElementById('google-identity-services');
    if (existing) {
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener('error', () => reject(new Error('Could not load Google Identity Services.')), { once: true });
      return;
    }
    const script = document.createElement('script');
    script.id = 'google-identity-services';
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Could not load Google Identity Services.'));
    document.head.appendChild(script);
  });
}

export function GoogleSignInButton({
  clientId,
  onCredential,
}: {
  clientId: string;
  onCredential: (credential: string) => Promise<void>;
}) {
  const buttonRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!clientId || !buttonRef.current) return;
    let active = true;
    loadGoogleIdentityScript()
      .then(() => {
        if (!active || !buttonRef.current || !googleApi()) return;
        buttonRef.current.replaceChildren();
        googleApi()!.accounts.id.initialize({
          client_id: clientId,
          use_fedcm_for_prompt: true,
          callback: (response) => {
            if (!response.credential) {
              setError('Google did not return a sign-in credential.');
              return;
            }
            setError(null);
            void onCredential(response.credential).catch((reason) => setError(String(reason)));
          },
        });
        googleApi()!.accounts.id.renderButton(buttonRef.current, {
          type: 'standard',
          theme: 'outline',
          size: 'large',
          text: 'continue_with',
          shape: 'rectangular',
          width: 280,
        });
      })
      .catch((reason) => active && setError(String(reason)));
    return () => {
      active = false;
    };
  }, [clientId, onCredential]);

  if (!clientId) {
    return <p className="settings-note">Add a Google OAuth web client ID to enable account registration.</p>;
  }

  return (
    <div className="google-signin-wrap">
      <div ref={buttonRef} />
      {error && <p className="error-text" role="alert">{error}</p>}
    </div>
  );
}
