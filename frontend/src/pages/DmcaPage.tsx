import { usePageTitle } from '@/hooks/usePageTitle';
import { Link } from 'react-router-dom';
import { PageHeader } from '@/components/PageHeader';

const H = ({ children }: { children: string }) => <h2 className="text-base font-extrabold mt-6 mb-1.5 text-ink-100">{children}</h2>;

export default function DmcaPage() {
  usePageTitle('Copyright & Takedowns');
  return (
    <div className="max-w-2xl mx-auto pb-10">
      <PageHeader title="Copyright & Takedowns" subtitle="For artists, labels and rights holders. Last updated July 2026." />
      <div className="text-sm text-ink-200 leading-relaxed">
        <H>Where the music comes from</H>
        <p>
          VinaX is a player over independent third-party public catalogs. We host no media files. All songs,
          recordings, compositions, artwork and lyrics remain the property of their artists, composers, labels and
          publishers — always credited exactly as the catalog provides.
        </p>
        <H>How takedowns work here</H>
        <p>
          Verified requests are honored by adding the content to a server-side blocklist. That removes it from
          search, playback, recommendations and mixes <strong>across every client within minutes</strong> — web,
          Android and TV — and we forward the request to the upstream catalog source.
        </p>
        <H>What to include</H>
        <p>
          Email{' '}
          <a href="mailto:hello@sirimillavinay.online" className="text-ember-400 hover:underline">
            hello@sirimillavinay.online
          </a>{' '}
          with: (1) the exact track, album or artist and, if possible, its link in VinaX; (2) the work it infringes
          and your relationship to it; (3) your contact details; (4) a good-faith statement that the use is not
          authorized by the rights holder; and (5) your name as signature. Plain email is fine — no forms, no fees.
        </p>
        <H>Counter-notices and mistakes</H>
        <p>
          If something was removed in error, write to the same address with the details and we&rsquo;ll review it.
          We keep a record of every block and its reason.
        </p>
        <H>Repeat content</H>
        <p>
          Because sources can re-index content under new IDs, tell us if something returns — blocking is by song
          identity and we extend it promptly.
        </p>
        <p className="mt-6 text-ink-400">
          General questions? <Link to="/contact" className="text-ember-400 hover:underline">Contact</Link> · How the
          app works? <Link to="/help" className="text-ember-400 hover:underline">Help</Link>.
        </p>
      </div>
    </div>
  );
}
