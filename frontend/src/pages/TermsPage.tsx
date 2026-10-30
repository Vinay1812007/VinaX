import { usePageTitle } from '@/hooks/usePageTitle';
import { Link } from 'react-router-dom';
import { PageHeader } from '@/components/PageHeader';
import '@/styles/pages/secondary.css';

const H = ({ children }: { children: string }) => <h2>{children}</h2>;

export default function TermsPage() {
  usePageTitle('Terms');
  return (
    <div className="vx-sec">
      <PageHeader title="Terms of use" subtitle="Last updated July 2026" />
      <div className="vx-doc">
        <H>What VinaX is</H>
        <p>
          VinaX is a free music player for Indian and international music. It streams songs, artwork and lyrics from
          independent third-party public catalogs. VinaX does not host, own or sell any music, and displays titles,
          artists and film credits exactly as the catalog provides them.
        </p>
        <H>Free means free</H>
        <p>
          There are no subscriptions, no premium tiers and no in-app purchases — and no plans for any. The website
          is supported by one labelled advertisement at the end of browsing pages (never in the player, the queue,
          the Android app or Kid mode; see <Link to="/privacy">Privacy</Link>). If you ever see VinaX asking for
          money, it isn&rsquo;t VinaX.
        </p>
        <H>Your account</H>
        <p>
          You sign in with your Google account; VinaX never sees or stores a password. Your library, playlists,
          history, taste profile and settings are kept with your account so they follow you to every device, and you
          can delete the account at any time in Settings → Profile. Don&rsquo;t share your Google account to give
          others access. See the <Link to="/privacy">Privacy page</Link> for exactly what is stored.
        </p>
        <H>Availability</H>
        <p>
          Catalog sources can be briefly unavailable or remove content without notice. The app fails over between
          sources automatically, but no track&rsquo;s availability is guaranteed.
        </p>
        <H>Fair use of the service</H>
        <p>
          Don&rsquo;t abuse the service: no scraping at scale, no attacking the infrastructure, no using Listen
          Together or the feedback form to harass people, and no attempting to re-sell access to something that is
          free. We may block abusive clients to protect everyone else.
        </p>
        <H>Rights holders</H>
        <p>
          If content should not be available, tell us via the{' '}
          <Link to="/dmca">Copyright &amp; takedowns page</Link>. Verified
          requests are honored by removing the content from search, playback and recommendations across all clients.
        </p>
        <H>Changes and endings</H>
        <p>
          Features may change, improve or be retired at any time — the in-app changelog documents every release. If
          VinaX ever had to shut down, your data would not be lost: it&rsquo;s already on your device, and Settings →
          Your data exports everything.
        </p>
        <H>No warranty</H>
        <p>
          VinaX is provided &ldquo;as is&rdquo;, without warranty of any kind. To the maximum extent permitted by law,
          VinaX and its maker are not liable for damages arising from use of the service. Use it in line with the laws
          of your region.
        </p>
        <p className="vx-doc-end">
          Questions? <Link to="/contact">Contact us</Link>.
        </p>
      </div>
    </div>
  );
}
