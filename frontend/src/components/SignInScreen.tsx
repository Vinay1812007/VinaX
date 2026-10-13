/** 13.0 — the screen every route shows until a Google account is signed in (see AuthGate). */
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { GoogleSignIn } from './GoogleSignIn';
import '@/styles/signin.css';

export default function SignInScreen(): ReactNode {
  return (
    <main className="vx-signin" aria-labelledby="vx-signin-title">
      <div className="vx-signin-card vx-mat-thick">
        <img src="/icons/icon.svg" alt="" width={64} height={64} className="vx-signin-logo" />
        <h1 id="vx-signin-title" className="vx-signin-title">
          Welcome to VinaX
        </h1>
        <p className="vx-signin-lede">Sign in with your Google account to start listening. Your library, playlists, history and taste follow you to every device.</p>
        <div className="vx-signin-button">
          <GoogleSignIn />
        </div>
        <p className="vx-signin-fine">
          Free, with nothing to pay. By signing in you agree to the <Link to="/terms">Terms</Link> and the <Link to="/privacy">Privacy policy</Link>.
        </p>
      </div>
    </main>
  );
}

