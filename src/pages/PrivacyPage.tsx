import { usePageTitle } from '@/hooks/usePageTitle';
import { Link } from 'react-router-dom';
import { PageHeader } from '@/components/PageHeader';

const H = ({ children }: { children: string }) => <h2 className="text-base font-extrabold mt-6 mb-1.5 text-ink-100">{children}</h2>;

export default function PrivacyPage() {
  usePageTitle('Privacy');
  return (
    <div className="max-w-2xl mx-auto pb-10">
      <PageHeader title="Privacy" subtitle="Private by design — the short version is: your listening is yours. Last updated July 2026." />
      <div className="text-sm text-ink-200 leading-relaxed">
        <H>What stays on your device</H>
        <p>
          Everything personal: your name, favorites, listening history, downloads, queue, taste profile, streaks,
          settings and every VinaX AI chat. None of it is uploaded, synced or backed up by us — which also means only
          you can lose it, and only you can export it (Settings → Your Data).
        </p>
        <H>What we receive — only if you opt in</H>
        <p>
          During onboarding you choose whether to share anonymous usage statistics. If you opt in, the app sends
          events like &ldquo;a song was played&rdquo; or &ldquo;a search found nothing&rdquo; with a random device ID,
          your app version, platform and city-level location. <strong>IP addresses are never stored.</strong> No names,
          no emails, no precise location, no advertising identifiers — those don&rsquo;t exist here. Opting out stops
          this entirely, anytime.
        </p>
        <H>Push notifications</H>
        <p>
          If you turn notifications on, your browser gives us a delivery address (a push endpoint) — that&rsquo;s all
          we store, and turning notifications off deletes it. At most one song suggestion per day, plus rare owner
          announcements.
        </p>
        <H>AI features</H>
        <p>
          When the AI picks songs or builds your home screen, it receives a short, capped, anonymous summary of your
          taste (languages and liked styles) — never your history, never your identity. VinaX AI chats are stored only
          in your browser; the messages you send are processed to generate a reply and are not used to identify you.
          Voice chat and mic dictation use your device&rsquo;s speech engine — in supporting browsers and in the
          Android app, speech is recognised on your device — and VinaX never stores audio.
        </p>
        <H>Listen Together</H>
        <p>
          Rooms are ephemeral: a room code, first names, and the shared queue exist while the session lives and are
          cleaned up afterwards.
        </p>
        <H>No cookies, no trackers, no ads</H>
        <p>
          There is no third-party analytics script, no advertising SDK, no tracking pixel and no cookie banner because
          there are no tracking cookies. The typeface, the icons and the code are all served from our own domain.
        </p>
        <H>Your controls</H>
        <p>
          Settings → Your Data can export your entire profile as one file, import it on a new device, or erase
          everything in one tap. Because nothing personal is on our servers, local erase is total erase.
        </p>
        <p className="mt-6 text-ink-400">
          The enforced technical rules behind this page live in the project&rsquo;s privacy baseline. Questions?{' '}
          <Link to="/contact" className="text-ember-400 hover:underline">Contact us</Link>.
        </p>
      </div>
    </div>
  );
}
