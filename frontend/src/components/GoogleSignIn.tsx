/**
 * 12.2 — the "Sign in with Google" control (required since 13.0), used by the
 * sign-in screen, the welcome sheet and Settings. On the web it is Google's own button (rendered by Google's
 * sign-in script, as Google's branding rules require); in the Android app it
 * opens the system's Google account sheet. Signed in, it shows who and offers
 * Sign out.
 *
 * Brand rule: this button is the one place VinaX shows another company's name
 * and logo — sign-in buttons must follow the provider's own branding.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { currentAccount, renderGoogleButton, signInNative, signOut, type Account, type SignInResult } from '@/services/auth/google';
import { isNativePlatform } from '@/services/native';
import { toast } from '@/store/toastStore';
import '@/styles/signin.css';

/** Google's four-colour "G", from Google's sign-in branding kit (Android button only). */
function GoogleG(): ReactNode {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}

/** The line a failed sign-in leaves. Null for a cancel (the listener closed the sheet). */
export function signInMessage(r: SignInResult): string | null {
  if (r === 'ok' || r === 'cancelled') return null;
  if (r === 'offline') return 'You’re offline — connect and try signing in again.';
  if (r === 'refused') return 'Google sign-in was not accepted. Try again.';
  return 'Sign-in is not available right now. Try again in a moment.';
}

export { useAccount } from './useAccount';
import { useAccount } from './useAccount';

export function GoogleSignIn({ onSignedIn, theme = 'dark' }: { onSignedIn?: (a: Account) => void; theme?: 'dark' | 'light' }): ReactNode {
  const account = useAccount();
  const slotRef = useRef<HTMLDivElement>(null);
  const [webFailed, setWebFailed] = useState(false);
  // Bumped by "Try again" to redraw the button after Google’s script failed to load.
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const native = isNativePlatform();
  const onSignedInRef = useRef(onSignedIn);
  onSignedInRef.current = onSignedIn;

  const settle = (r: SignInResult): void => {
    setBusy(false);
    const msg = signInMessage(r);
    if (msg) toast(msg, { duration: 5000 });
    const a = currentAccount();
    if (r === 'ok' && a) onSignedInRef.current?.(a);
  };

  // Web: Google's own button, drawn into the slot by Google's script.
  useEffect(() => {
    const slot = slotRef.current;
    if (native || account || !slot) return;
    let alive = true;
    setWebFailed(false);
    void renderGoogleButton(slot, (r) => alive && settle(r), theme).then((ok) => {
      if (alive) setWebFailed(!ok);
    });
    return () => {
      alive = false;
      slot.replaceChildren();
    };
    // settle reads refs and stable setters only.
  }, [native, account, theme, attempt]);

  if (account) {
    const u = account.user;
    return (
      <div className="vx-account" aria-live="polite">
        {u.picture ? (
          <img src={u.picture} alt="" width={32} height={32} className="vx-account-pic" referrerPolicy="no-referrer" />
        ) : (
          <span className="vx-account-pic is-letter" aria-hidden>
            {(u.name ?? u.email ?? '?').charAt(0).toUpperCase()}
          </span>
        )}
        <span className="vx-account-text">
          <span className="vx-account-name">{u.name ?? 'Signed in'}</span>
          {u.email && <span className="vx-account-email">{u.email}</span>}
        </span>
        <button type="button" className="vx-account-out" onClick={signOut}>
          Sign out
        </button>
      </div>
    );
  }

  if (native) {
    return (
      <button
        type="button"
        className="vx-google-btn"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          void signInNative().then(settle);
        }}
      >
        <GoogleG />
        <span>{busy ? 'Signing in…' : 'Sign in with Google'}</span>
      </button>
    );
  }

  return (
    <div className="vx-google-slot">
      <div ref={slotRef} className="vx-google-web" />
      {webFailed && (
        <div className="vx-google-failed" role="alert">
          <p>Google sign-in couldn’t load. Check your connection — or, if an ad or tracker blocker is on, allow accounts.google.com for this site.</p>
          <button type="button" onClick={() => setAttempt((n) => n + 1)}>
            Try again
          </button>
        </div>
      )}
    </div>
  );
}
