/**
 * 13.5.0 — what a signed-out visitor sees on a page VinaX publishes: Charts,
 * Top songs, Discover, language and mood hubs and the rest of the
 * prerendered set. The page's own text (written by the server for this URL,
 * see services/seo/serverPage.ts) inside the VinaX frame, with a sign-in
 * card: playing, saving and personal picks need a Google account.
 *
 * It makes no API calls — the text is already in the HTML — so a visitor or
 * a search engine reading these pages costs the request budget nothing.
 * Links are plain anchors: each page loads with its own server text.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { GoogleSignIn } from './GoogleSignIn';
import type { ServerPage } from '@/services/seo/serverPage';
import '@/styles/public.css';

/** The browse links in the bar: the public pages people look for first. */
export const PUBLIC_BROWSE: { href: string; label: string }[] = [
  { href: '/charts/', label: 'Charts' },
  { href: '/top-songs/', label: 'Top songs' },
  { href: '/discover/', label: 'Discover' },
  { href: '/languages/', label: 'Languages' },
  { href: '/moods/', label: 'Moods' },
];

export default function PublicPage({ page }: { page: ServerPage }): ReactNode {
  // The phone dock steps aside while the sign-in card itself is on screen.
  const card = useRef<HTMLElement>(null);
  const [cardSeen, setCardSeen] = useState(false);
  useEffect(() => {
    const el = card.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(([e]) => setCardSeen(e.isIntersecting), { threshold: 0.15 });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <div className="vx-public">
      <a href="#vx-public-content" className="vx-public-skip">
        Skip to content
      </a>
      <header className="vx-public-bar">
        <a href="/" className="vx-public-brand" aria-label="VinaX home">
          <img src="/icons/icon.svg" alt="" width={32} height={32} />
          <span>VinaX</span>
        </a>
        <nav className="vx-public-nav" aria-label="Browse">
          {PUBLIC_BROWSE.map((l) => (
            <a key={l.href} href={l.href} aria-current={page.path === l.href.replace(/\/$/, '') ? 'page' : undefined}>
              {l.label}
            </a>
          ))}
        </nav>
        <a href="#vx-public-signin" className="vx-public-cta">
          Sign in
        </a>
      </header>

      <div className="vx-public-body">
        {/* The server's text for this URL: escaped at render time on the server, never user input. */}
        <main id="vx-public-content" className="vx-public-content" dangerouslySetInnerHTML={{ __html: page.html }} />

        <aside ref={card} id="vx-public-signin" className="vx-public-signin vx-mat-thick" aria-labelledby="vx-public-signin-title">
          <img src="/icons/icon.svg" alt="" width={48} height={48} className="vx-public-signin-logo" />
          <h2 id="vx-public-signin-title">Listen free on VinaX</h2>
          <p>Sign in with Google to play these songs, save them to your library and get picks made for you.</p>
          <div className="vx-public-signin-button">
            <GoogleSignIn />
          </div>
          <ul className="vx-public-perks">
            <li>₹0, no subscription, nothing asks for a card</li>
            <li>No ads in the player, the queue or your library</li>
            <li>Your library on every device</li>
          </ul>
          <p className="vx-public-fine">
            By signing in you agree to the <a href="/terms/">Terms</a> and the <a href="/privacy/">Privacy policy</a>.
          </p>
        </aside>
      </div>

      <footer className="vx-public-foot">
        <a href="/about/">About</a> · <a href="/help/">Help</a> · <a href="/download/">Get the app</a> · <a href="/privacy/">Privacy</a> ·{' '}
        <a href="/terms/">Terms</a> · <a href="/contact/">Contact</a>
      </footer>

      {/* Phones: the sign-in card sits after the text; this keeps it one tap away. */}
      <a href="#vx-public-signin" className="vx-public-dock" hidden={cardSeen}>
        Sign in to listen free
      </a>
    </div>
  );
}
