/**
 * The frame of /login, /signup and /forgot-password: the VinaX mark, one
 * card with the page's form, and a footer with the legal pages and a way to
 * browse first. No app navigation, no marketing panels, no ads.
 *
 * Signed in (already, or the moment a form or Google's button succeeds),
 * the page moves on to `?next=` (services/auth/next).
 */
import { useEffect, useState, type ReactNode } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router-dom';
import { useAccount } from '@/components/useAccount';
import { GoogleSignIn } from '@/components/GoogleSignIn';
import { GetAppSlot } from '@/components/GetAppSlot';
import { rememberGuestBrowse } from '@/services/auth/gate';
import { authHref, safeNext, type AuthPath } from '@/services/auth/next';
import { takeResume } from '@/services/auth/resume';
import '@/styles/auth.css';

/** `next` and the email typed so far, read once from the address. */
export function useAuthQuery(): { next: string; email: string; setEmail: (v: string) => void; href: (path: AuthPath) => string } {
  const [params] = useSearchParams();
  const next = safeNext(params.get('next'));
  const [email, setEmail] = useState(() => (params.get('email') ?? '').slice(0, 254));
  return { next, email, setEmail, href: (path) => authHref(path, { next, email }) };
}

export function AuthShell({ title, lede, next, google = false, children, switcher }: { title: string; lede: string; next: string; google?: boolean; children: ReactNode; switcher: ReactNode }): ReactNode {
  const account = useAccount();
  // Signed in: back on `next`, finish what the sign-in sheet interrupted (play, like).
  // Navigate's own effect runs first, so this lands after the page change.
  useEffect(() => {
    if (!account) return;
    const run = takeResume(next);
    if (run) setTimeout(run, 0);
  }, [account, next]);
  if (account) return <Navigate to={next} replace />;
  // VinaX AI's address sends here too, with a line about the chat.
  const forChat = /^\/vinaxai(\/|$|\?)/i.test(next);
  return (
    <>
      <GetAppSlot />
      <main className="vx-auth" aria-labelledby="vx-auth-title">
        <a href="/" className="vx-auth-brand" aria-label="VinaX home">
          <img src="/icons/icon.svg?v=14" alt="" width={40} height={40} />
          <span>VinaX</span>
        </a>
        <section className="vx-auth-card vx-mat-thick">
          <h1 id="vx-auth-title" className="vx-auth-title">
            {title}
          </h1>
          <p className="vx-auth-lede">{forChat ? 'Sign in to chat with VinaX AI, the assistant built into VinaX. Your chats are saved with your account.' : lede}</p>
          {google && (
            <>
              <div className="vx-auth-google">
                <GoogleSignIn emailLinks={false} />
              </div>
              <span className="vx-or" aria-hidden="true">
                or
              </span>
            </>
          )}
          {children}
        </section>
        <p className="vx-auth-switch">{switcher}</p>
        <footer className="vx-auth-foot">
          <p>
            Free, with nothing to pay. By continuing you agree to the <Link to="/terms">Terms</Link> and the <Link to="/privacy">Privacy policy</Link>.
          </p>
          <Link to="/discover" className="vx-auth-explore" onClick={rememberGuestBrowse}>
            Explore VinaX first <span aria-hidden>→</span>
          </Link>
          <nav className="vx-auth-links" aria-label="About VinaX">
            <Link to="/about">About</Link> · <Link to="/help">Help</Link> · <Link to="/download">Get the app</Link> · <Link to="/contact">Contact</Link>
          </nav>
        </footer>
      </main>
    </>
  );
}
