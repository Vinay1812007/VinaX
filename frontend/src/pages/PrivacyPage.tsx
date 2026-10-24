import { usePageTitle } from '@/hooks/usePageTitle';
import { Link } from 'react-router-dom';
import { PageHeader } from '@/components/PageHeader';
import '@/styles/pages/secondary.css';

const H = ({ children }: { children: string }) => <h2>{children}</h2>;

export default function PrivacyPage() {
  usePageTitle('Privacy');
  return (
    <div className="vx-sec">
      <PageHeader title="Privacy" subtitle="Last updated October 2026" />
      <div className="vx-doc">
        <H>Your account and what syncs</H>
        <p>
          You sign in with Google. VinaX stores your Google account ID, email, name and profile photo, and keeps a copy
          of your library and playlists, listening history, taste profile, smart collections, bookmarks, Home layout and
          settings with your account, so they follow you to every device you sign in on. This copy is stored by our
          database provider and is only readable by VinaX&rsquo;s server. <strong>VinaX AI chats, downloads, searches
          and your queue are not synced</strong> — they stay on the device. Delete account (Settings → Profile)
          removes the account and its synced copy.
        </p>
        <p>
          To run the service, your account also records where and on what you last signed in: the city, region and
          country our network sees for the connection (worked out by our hosting provider; the IP address itself is never
          stored), whether you use the web app or the Android app, the app version, and when you were last active.
          VinaX&rsquo;s owner can see your account details — name, email, profile photo and these sign-in facts — in the
          admin console, to support listeners and keep the service safe. What you play and search is not part of this:
          that is the anonymous usage sharing described below, which you can switch off.
        </p>
        <H>What we receive — anonymous usage, on unless you switch it off</H>
        <p>
          Anonymous usage sharing is on by default: the welcome screen shows it as a ticked box you can untick, and
          Settings &rarr; Region &amp; privacy has the switch. While it is on, the app sends events like &ldquo;a song
          was played&rdquo; or &ldquo;a search found nothing&rdquo; with a random device ID, your app version, platform
          and city-level location, to VinaX&rsquo;s own database and nowhere else. <strong>IP addresses are never
          stored.</strong> No names, no emails, no precise location and no advertising identifiers. Switching it off
          stops this entirely, at once.
        </p>
        <p>
          A song counts as played once you have heard at least 5 seconds of it, the same rule your taste profile uses,
          so flipping past a song is not counted. The same sharing sends two short reports about the songs VinaX adds to
          your queue by itself. When it adds a batch: which version of the recommender chose it, whether the on-device
          engine or the AI chose the order (and why not the AI, if it didn&rsquo;t), how long it took, how many songs it
          added, how many were by artists you haven&rsquo;t played or by different artists, whether a queue rule had to
          be relaxed, and which test group your device is in, if any. When one of those songs stops: its place in the
          batch, how many seconds of it you heard out of its length, whether you finished it, skipped it or liked it, and
          the same test group. <strong>Neither report names the song.</strong>
        </p>
        <H>Session insights — only if you opt in</H>
        <p>
          A separate switch in Settings &rarr; Region &amp; privacy, off by default, turns on anonymous session
          insights: heatmaps and replays of how the app is used (taps, scrolls and which screens load), processed by
          an analytics provider so we can find confusing spots and fix them. <strong>All text on screen is masked on
          your device before anything is sent</strong> — song titles, your name, your history and your AI chats never
          appear in them. This provider sets its own analytics cookies, and only if you opted in; if you didn&rsquo;t,
          it never loads.
        </p>
        <H>Push notifications</H>
        <p>
          If you turn notifications on, your browser gives us a delivery address (a push endpoint) — that&rsquo;s all
          we store, and turning notifications off deletes it. At most one song suggestion per day, plus rare owner
          announcements.
        </p>
        <H>AI features</H>
        <p>
          When the AI picks songs or builds your home screen, it receives a short, capped summary of your taste: your
          languages and liked styles, and short lists of songs you recently played, finished, skipped or liked (titles
          and artists only, at most a few dozen) so it can avoid repeats and follow your mood. It never receives your
          name, your username or anything else that identifies you. VinaX AI chats are stored only
          in your browser; the messages you send are processed to generate a reply and are not used to identify you.
          Voice chat and mic dictation use your device&rsquo;s speech engine — in supporting browsers and in the
          Android app, speech is recognised on your device — and VinaX never stores audio.
        </p>
        <H>Listen Together</H>
        <p>
          Rooms are ephemeral: a room code, first names, and the shared queue exist while the session lives and are
          cleaned up afterwards. To count who is in a room, your device sends a random device ID that VinaX stores on
          this device; it is not linked to your name or account.
        </p>
        <H>Trackers and ads — the honest version</H>
        <p>
          VinaX sets no tracking cookies of its own, and runs no third-party analytics unless you opt in to session
          insights above — and even then, your taste profile, history and favorites never leave your device.
        </p>
        <p>
          <b>Where ads appear.</b> On the website, one clearly labelled advertisement sits at the end of browsing pages:
          song, artist, album, language and mood pages. There are never ads in the player, the queue, VinaX AI, your
          library, the Android app or Kid mode, and the ad code is not loaded on those screens at all.
        </p>
        <p>
          <b>Who serves them.</b> Those ads are served by Google. Third-party vendors, including Google, use cookies to
          serve ads based on your prior visits to this website or other websites. Google&rsquo;s use of advertising
          cookies enables it and its partners to serve ads to you based on your visits to this site and/or other sites
          on the internet. You can opt out of personalised advertising in{' '}
          <a href="https://adssettings.google.com" target="_blank" rel="noreferrer">
            Ads Settings
          </a>
          , or opt out of third-party vendors&rsquo; cookies for personalised advertising at{' '}
          <a href="https://www.aboutads.info/choices" target="_blank" rel="noreferrer">
            aboutads.info
          </a>
          . Visitors in regions that require consent are asked before any advertising cookie is set. Nothing VinaX
          stores about your listening — history, favorites, taste profile, AI chats — is ever shared with an
          advertiser.
        </p>
        <H>Your controls</H>
        <p>
          Settings → Your data can export your entire profile as one file, import it on a new device, or erase
          everything in one tap. Because nothing personal is on our servers, local erase is total erase.
        </p>
        <p className="vx-doc-end">
          The enforced technical rules behind this page live in the project&rsquo;s privacy baseline. Questions?{' '}
          <Link to="/contact">Contact us</Link>.
        </p>
      </div>
    </div>
  );
}
