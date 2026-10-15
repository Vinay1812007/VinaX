/**
 * 13.0 — the screen every route shows until a Google account is signed in (see AuthGate).
 *
 * 13.3.0 — the page answers what a new listener asks before handing over an
 * account: what VinaX is, what it costs, what signing in shares and what
 * stays on the device. No ads here, and no data fetching: plain text that
 * loads with the card. Every claim must be true today — keep it in step with
 * the Privacy page and HomeAbout.
 *
 * 13.4.0 — "What you get" and "Free, and how it stays free" stand on the left
 * and right of the sign-in card (each line with its own drawn icon) instead
 * of hiding behind a "What you get with VinaX" link below it. On a narrow
 * screen they follow the card. What signing in shares and the questions
 * stay further down.
 */
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { GoogleSignIn } from './GoogleSignIn';
import '@/styles/signin.css';

/** Line icons for the side panels: 24-unit grid, drawn in the current colour. */
const ICON_PATHS: Record<string, ReactNode> = {
  languages: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M3.5 12h17M12 3.5c2.4 2.4 3.5 5.3 3.5 8.5s-1.1 6.1-3.5 8.5c-2.4-2.4-3.5-5.3-3.5-8.5s1.1-6.1 3.5-8.5z" />
    </>
  ),
  upnext: (
    <>
      <path d="M4 7h10M4 12h10M4 17h6" />
      <path d="M16 14.5v5l4-2.5z" />
      <path d="M18.5 4.5l.6 1.4 1.4.6-1.4.6-.6 1.4-.6-1.4-1.4-.6 1.4-.6z" />
    </>
  ),
  lyrics: (
    <>
      <path d="M5 5.5h14a1.5 1.5 0 0 1 1.5 1.5v8a1.5 1.5 0 0 1-1.5 1.5h-7l-4 3.5v-3.5H5A1.5 1.5 0 0 1 3.5 15V7A1.5 1.5 0 0 1 5 5.5z" />
      <path d="M8 9.5h8M8 12.5h5" />
    </>
  ),
  together: (
    <>
      <circle cx="9" cy="8.5" r="3" />
      <circle cx="16.5" cy="9.5" r="2.4" />
      <path d="M3.5 19c.8-3 3-4.6 5.5-4.6s4.7 1.6 5.5 4.6M14.5 14.6c.6-.2 1.3-.3 2-.3 2 0 3.6 1.3 4.2 3.7" />
    </>
  ),
  android: (
    <>
      <rect x="6.5" y="2.5" width="11" height="19" rx="2.5" />
      <path d="M12 8v6M9.5 11.5L12 14l2.5-2.5M10.5 18.5h3" />
    </>
  ),
  everyone: (
    <>
      <path d="M12 20s-7.5-4.4-7.5-10A4.3 4.3 0 0 1 12 7.3 4.3 4.3 0 0 1 19.5 10c0 5.6-7.5 10-7.5 10z" />
    </>
  ),
  rupee: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M9 7.5h6M9 10.5h6M9 7.5c3.2 0 3.2 6 0 6l4.5 3" />
    </>
  ),
  noads: (
    <>
      <rect x="3.5" y="6" width="17" height="12" rx="2" />
      <path d="M8 15l1.6-6h.8L12 15M8.6 12.8h2.8M14 9v6h1.2a2 2 0 0 0 2-2v-2a2 2 0 0 0-2-2z" />
      <path d="M4 4l16 16" />
    </>
  ),
  lock: (
    <>
      <rect x="5" y="10.5" width="14" height="10" rx="2" />
      <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5M12 14.5v2.5" />
    </>
  ),
  sync: (
    <>
      <path d="M19.5 12a7.5 7.5 0 0 1-13 5.1M4.5 12a7.5 7.5 0 0 1 13-5.1" />
      <path d="M17.5 3.5v3.4h-3.4M6.5 20.5v-3.4h3.4" />
    </>
  ),
  shield: (
    <>
      <path d="M12 3.5l7 2.6v5.4c0 4.4-3 7.8-7 9-4-1.2-7-4.6-7-9V6.1z" />
      <path d="M9 12l2.2 2.2L15.5 10" />
    </>
  ),
  child: (
    <>
      <circle cx="12" cy="7" r="3" />
      <path d="M6.5 20.5l1.5-7h8l1.5 7M9 13.5l-3-2.5M15 13.5l3-2.5" />
    </>
  ),
};

function PanelIcon({ name }: { name: string }): ReactNode {
  return (
    <span className="vx-signin-icon" aria-hidden="true">
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        {ICON_PATHS[name]}
      </svg>
    </span>
  );
}

interface PanelItem {
  icon: string;
  title: string;
  text: string;
}

/** Left of the card: what the app does. */
const FEATURES: PanelItem[] = [
  { icon: 'languages', title: 'Music in 12 languages', text: 'Telugu, Hindi, Tamil, Punjabi, Kannada, Malayalam and more, each with its own charts, new releases and moods.' },
  { icon: 'upnext', title: 'Up next, picked for you', text: 'Tap a song and VinaX lines up the next ones from it, learning from what you finish, like and skip.' },
  { icon: 'lyrics', title: 'Lyrics, AI Radio and VinaX AI', text: 'Sing along with synced lyrics, play endless radio from a song or a few words, or describe a mood to get a playlist.' },
  { icon: 'together', title: 'Listen Together', text: 'Share a room with friends and hear the same song at the same moment, on any device.' },
  { icon: 'android', title: 'The Android app', text: 'Background playback and offline downloads, with the same account and library as the website.' },
  { icon: 'everyone', title: 'Made for every listener', text: 'A sleep timer, Drive mode, weekly mixes from your listening and six app styles to choose from.' },
];

/** Right of the card: what it costs and what happens to your data. */
const FACTS: PanelItem[] = [
  { icon: 'rupee', title: '₹0, always', text: 'No subscription, no premium tier, no in-app purchases. Nothing asks for a card.' },
  { icon: 'noads', title: 'No ads where you listen', text: 'None here, in the player, the queue, your library, VinaX AI, the Android app or Kid mode. The website shows one labelled ad at the end of song, artist, album, language and mood pages.' },
  { icon: 'lock', title: 'Nothing sold', text: 'Your listening history, favourites, taste profile and AI chats are never shared with advertisers.' },
  { icon: 'sync', title: 'Your library on every device', text: 'Playlists, history, taste and settings follow your account. Sign in on a new phone and it is all there.' },
  { icon: 'child', title: 'Kid mode', text: 'Hides songs the catalogue marks explicit, keeps a separate taste profile and shows no ads.' },
];

function Panel({ id, side, title, items }: { id: string; side: 'left' | 'right'; title: string; items: PanelItem[] }): ReactNode {
  return (
    <section className={`vx-signin-side is-${side}`} aria-labelledby={id}>
      <h2 id={id} className="vx-signin-side-title">
        {title}
      </h2>
      <ul className="vx-signin-side-list">
        {items.map((it) => (
          <li key={it.title}>
            <PanelIcon name={it.icon} />
            <span>
              <strong>{it.title}</strong>
              <span>{it.text}</span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

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
    a: 'Yes, any time: Settings → Profile → Delete account removes the account and everything synced with it. Settings → Your data can export your whole profile as one file first.',
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
        <Panel id="vx-signin-what" side="left" title="What you get" items={FEATURES} />
        <Panel id="vx-signin-free" side="right" title="Free, and how it stays free" items={FACTS} />
      </div>

      <div className="vx-signin-more">
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
            <Link to="/about">About</Link> · <Link to="/help">Help</Link> · <Link to="/download">Get the app</Link> · <Link to="/privacy">Privacy</Link> · <Link to="/terms">Terms</Link> · <Link to="/contact">Contact</Link>
          </p>
        </div>
      </div>
    </main>
  );
}
