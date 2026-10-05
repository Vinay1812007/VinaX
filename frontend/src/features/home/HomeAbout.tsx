import { Link } from 'react-router-dom';
import { HUB_LANGUAGES, languageLabel } from '@/constants/languages';
import '@/styles/pages/secondary.css';

/**
 * 8.4.0 — "About VinaX" at the foot of Home: what the app is, how it works and
 * how it stays free, in plain words. No stores and no data fetching, so the
 * build prerenders exactly this markup into the home page HTML
 * (scripts/prerender.mjs) — crawlers and listeners read the same text.
 * Every claim here must be true today.
 *
 * 10.0.0 — "Free, and how it stays free" leads, as a card of four plain
 * facts, because it is the first thing a new listener wants to know; the
 * article follows.
 */
export function HomeAbout() {
  return (
    <section className="vx-section vxh-about" aria-labelledby="vx-home-about">
      <div className="vxh-free">
        <h2 id="vx-home-free" className="vxh-free-title">Free, and how it stays free</h2>
        <ul className="vxh-free-facts">
          <li>
            <strong>₹0, always</strong>
            <span>No subscriptions, no premium tier and no in-app purchases.</span>
          </li>
          <li>
            <strong>No sign-up</strong>
            <span>No email, no password and no login. Open VinaX and press play.</span>
          </li>
          <li>
            <strong>One labelled ad, on the website only</strong>
            <span>At the end of song, artist, album, language and mood pages. Never in the player, the queue, VinaX AI, your library, the Android app or Kid mode.</span>
          </li>
          <li>
            <strong>Your taste stays yours</strong>
            <span>Listening history, favourites and taste profile stay on your device and are never shared with advertisers.</span>
          </li>
        </ul>
      </div>

      <div className="vx-article">
        <h2 id="vx-home-about">About VinaX</h2>
        <p>
          VinaX is a free music app for India. It plays Telugu, Hindi, Tamil, Punjabi, Kannada, Malayalam, Bengali,
          Marathi, Bhojpuri, Gujarati, Urdu and English songs with no login and no account: open it and press play.
          It works in the browser and as an Android app with background playback and offline downloads.
        </p>

        <h2>Music in your languages</h2>
        <p>
          Every language has its own page with trending songs, new releases, top artists, albums and a short guide to
          the music: the composers, singers and traditions behind it. Mood pages go one step further, gathering
          romantic, sad, party, devotional, melody and workout songs for each language.
        </p>
        <p>
          {HUB_LANGUAGES.map((l, i) => (
            <span key={l}>
              {i > 0 && ' · '}
              <Link to={`/${l}-songs`}>{languageLabel(l)} songs</Link>
            </span>
          ))}
        </p>

        <h2>Recommendations that stay on your device</h2>
        <p>
          VinaX learns what you like from the languages you pin and the songs you finish, like and skip. That taste
          profile is worked out on your device, not on a server, and the Taste Profile page shows everything it has
          learned. When you tap a song, the DJ builds the next five songs from it, led by that song’s language, and
          keeps adding more as you listen. Choose Familiar, Balanced or Discover in Settings to decide how many new
          artists it brings in.
        </p>

        <h2>More than a player</h2>
        <p>
          Synced lyrics you can sing along to, AI Radio that plays endlessly from a song, an artist or a few words,
          Listen Together rooms for sharing a queue with friends, a sleep timer, Drive mode, weekly mixes built from
          your listening, and VinaX AI, a chat assistant that can answer questions and turn a described mood into a
          playlist you can play straight away.
        </p>

        <p className="vxh-about-links">
          <Link to="/about">About</Link> · <Link to="/help">Help and FAQ</Link> · <Link to="/privacy">Privacy</Link> ·{' '}
          <Link to="/terms">Terms</Link> · <Link to="/dmca">Copyright and takedowns</Link> ·{' '}
          <Link to="/contact">Contact</Link>
        </p>
      </div>
    </section>
  );
}
