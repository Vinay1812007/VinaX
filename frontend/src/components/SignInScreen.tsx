/**
 * 13.0 — the screen every route shows until a Google account is signed in (see AuthGate).
 *
 * 13.3.0 — below the sign-in card, the page answers what a new listener asks
 * before handing over an account: what VinaX is, what it costs, what signing
 * in shares and what stays on the device. No ads here, and no data fetching:
 * plain text that loads with the card. Every claim must be true today — keep
 * it in step with the Privacy page and HomeAbout.
 */
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { GoogleSignIn } from './GoogleSignIn';
import '@/styles/signin.css';

const FEATURES: { title: string; text: string }[] = [
  {
    title: 'Music in 12 languages',
    text: 'Telugu, Hindi, Tamil, Punjabi, Kannada, Malayalam, Bengali, Marathi, Bhojpuri, Gujarati, Urdu and English, with trending songs, new releases, charts and mood pages for each.',
  },
  {
    title: 'Up next, picked for you',
    text: 'Tap a song and VinaX lines up the next ones from it, led by its language. It learns from the songs you finish, like and skip, and the Taste Profile page shows everything it has learned.',
  },
  {
    title: 'Lyrics, AI Radio and VinaX AI',
    text: 'Synced lyrics to sing along to, AI Radio that plays endlessly from a song, an artist or a few words, and a chat assistant that turns a described mood into a playlist.',
  },
  {
    title: 'Listen Together',
    text: 'Share a room with friends and hear the same song at the same moment, on any device.',
  },
  {
    title: 'The Android app',
    text: 'Background playback and offline downloads, with the same account and library as the website.',
  },
  {
    title: 'Made for every listener',
    text: 'Kid mode, a sleep timer, Drive mode, weekly mixes from your listening and six app styles to choose from.',
  },
];

const FAQ: { q: string; a: ReactNode }[] = [
  {
    q: 'Is VinaX really free?',
    a: 'Yes. There is no subscription, no premium tier and no in-app purchase, and nothing asks for a card.',
  },
  {
    q: 'Why do I need a Google account?',
    a: 'So your library, playlists, history and taste follow you. Sign in on a new phone or computer and everything is already there, with nothing to export or copy.',
  },
  {
    q: 'Does VinaX see my Google password?',
    a: 'No. You sign in on Google’s own screen, and VinaX only receives your account ID, email address, name and profile photo.',
  },
  {
    q: 'Can I delete my account?',
    a: 'Yes, any time: Settings → Your data → Delete account removes the account and everything synced with it. The same place can export your whole profile as one file first.',
  },
  {
    q: 'Is it safe for children?',
    a: 'Turn on Kid mode in Settings. It hides songs the catalogue marks explicit, keeps a separate taste profile and shows no ads.',
  },
  {
    q: 'Something isn’t working?',
    a: (
      <>
        Tell us on the <Link to="/contact">Contact page</Link> — it works without signing in.
      </>
    ),
  },
];

export default function SignInScreen(): ReactNode {
  const backToTop = () => {
    document.getElementById('vx-signin-title')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };
  return (
    <main className="vx-signin" aria-labelledby="vx-signin-title">
      <div className="vx-signin-hero">
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
        <a className="vx-signin-peek" href="#vx-signin-what">
          What you get with VinaX
          <svg aria-hidden="true" viewBox="0 0 24 24" width="16" height="16">
            <path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </a>
      </div>

      <div className="vx-signin-more">
        <section aria-labelledby="vx-signin-what">
          <h2 id="vx-signin-what" className="vx-signin-h2">
            What you get
          </h2>
          <p className="vx-signin-intro">VinaX is a free music app for India, on the web and on Android.</p>
          <ul className="vx-signin-features">
            {FEATURES.map((f) => (
              <li key={f.title}>
                <strong>{f.title}</strong>
                <span>{f.text}</span>
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="vx-signin-free">
          <h2 id="vx-signin-free" className="vx-signin-h2">
            Free, and how it stays free
          </h2>
          <ul className="vx-signin-facts">
            <li>
              <strong>₹0, always</strong> — no subscription, no premium tier, no in-app purchases.
            </li>
            <li>
              <strong>No ads where you listen</strong> — none on this page, in the player, the queue, your library, VinaX AI, the Android app or Kid mode. The website shows one labelled ad at the end of song, artist, album, language and mood pages.
            </li>
            <li>
              <strong>Nothing sold</strong> — your listening history, favourites, taste profile and AI chats are never shared with advertisers.
            </li>
          </ul>
        </section>

        <section aria-labelledby="vx-signin-shares">
          <h2 id="vx-signin-shares" className="vx-signin-h2">
            What signing in shares
          </h2>
          <div className="vx-signin-split">
            <div>
              <h3>VinaX receives from Google</h3>
              <p>Your account ID, email address, name and profile photo. Never your password, contacts, mail or files.</p>
            </div>
            <div>
              <h3>Synced with your account</h3>
              <p>Library and playlists, listening history, taste profile, smart collections, bookmarks, Home layout and settings.</p>
            </div>
            <div>
              <h3>Stays on this device</h3>
              <p>VinaX AI chats, downloads, searches and your queue.</p>
            </div>
          </div>
          <p className="vx-signin-note">
            The details are in the <Link to="/privacy">Privacy policy</Link>.
          </p>
        </section>

        <section aria-labelledby="vx-signin-faq">
          <h2 id="vx-signin-faq" className="vx-signin-h2">
            Questions
          </h2>
          <div className="vx-signin-faq">
            {FAQ.map((f) => (
              <details key={f.q}>
                <summary>{f.q}</summary>
                <p>{f.a}</p>
              </details>
            ))}
          </div>
        </section>

        <div className="vx-signin-end">
          <button type="button" className="vx-signin-again" onClick={backToTop}>
            Sign in and start listening
          </button>
          <p className="vx-signin-links">
            <Link to="/privacy">Privacy</Link> · <Link to="/terms">Terms</Link> · <Link to="/contact">Contact</Link>
          </p>
        </div>
      </div>
    </main>
  );
}
