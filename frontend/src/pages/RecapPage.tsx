import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useHistoryStore } from '@/store/historyStore';
import { useLibraryStore } from '@/store/libraryStore';
import { loadProfile } from '@/services/personalization/storage';
import { buildRecap, recapReady } from '@/features/recap/recap';
import { languageLabel } from '@/constants/languages';
import { getLocal } from '@/services/storage/local';
import { KEYS } from '@/constants/storage-keys';
import { toast } from '@/store/toastStore';
import { PageHeader } from '@/components/PageHeader';
import { ShareIcon, SparkleIcon } from '@/components/Icons';
import '@/styles/pages/secondary.css';

const hourLabel = (h: number): string => {
  const twelve = h % 12 === 0 ? 12 : h % 12;
  return `${twelve} ${h < 12 ? 'AM' : 'PM'}`;
};

/** "Your Year in Music" — Wrapped-style recap, computed and rendered entirely
 *  on-device. The share button paints a local PNG; nothing is uploaded. */
export default function RecapPage() {
  usePageTitle('Your Year in Music');
  const entries = useHistoryStore((s) => s.entries);
  const favorites = useLibraryStore((s) => s.favorites);
  const [sharing, setSharing] = useState(false);

  const recap = useMemo(
    () => buildRecap(loadProfile(), entries, favorites.length, Date.now()),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- profile is read once per visit
    [entries.length, favorites.length],
  );

  const shareCard = async (): Promise<void> => {
    setSharing(true);
    try {
      const [{ renderRecapCard }, { shareOrSaveImage }] = await Promise.all([
        import('@/features/recap/shareCard'),
        import('@/utils/shareImage'),
      ]);
      const name = getLocal<string>(KEYS.userName, '');
      const blob = await renderRecapCard(recap, name);
      await shareOrSaveImage(blob, `vinax-${recap.year}-recap.png`, `My ${recap.year} in Music`);
    } catch {
      toast('Could not build the card — try again');
    } finally {
      setSharing(false);
    }
  };

  if (!recapReady(recap)) {
    return (
      <div className="vx-empty-page">
        <span className="vx-empty-icon" aria-hidden>
          <SparkleIcon className="w-8 h-8" />
        </span>
        <h1>Your year in music</h1>
        <p>Your recap unlocks after about 20 plays. Every song is counted on this device only.</p>
        <Link to="/" className="px-6 py-3 rounded-full btn-primary">Play something</Link>
      </div>
    );
  }

  const numbers: Array<[string, string]> = [
    [String(recap.totalPlays), 'Songs played'],
    [`≈${recap.estMinutes.toLocaleString('en-IN')}`, 'Minutes (about)'],
    [String(recap.completes), 'Played to the end'],
    [String(recap.favorites), 'Favorites'],
  ];

  return (
    <div className="vx-sec">
      <PageHeader
        title={`Your ${recap.year} in music`}
        subtitle="Computed on this device · never uploaded"
        actions={
          <button onClick={() => void shareCard()} disabled={sharing} className="px-5 py-2.5 rounded-full btn-primary text-sm inline-flex items-center gap-2 disabled:opacity-60">
            <ShareIcon className="w-4 h-4" />
            {sharing ? 'Painting…' : 'Share card'}
          </button>
        }
      />

      {/* persona hero */}
      <section className="vx-sec-block vx-feature" aria-label="Your listening persona">
        <p className="text-[13px] font-semibold text-ink-300">Your listening persona</p>
        <p className="vx-display mt-2">{recap.persona}</p>
        <p className="mt-3 text-[14px] font-medium text-ink-300">
          Peak hour {hourLabel(recap.peakHour)} · {recap.daysTogether} days of music together
        </p>
      </section>

      <div className="vx-sec-block vx-kpis is-four">
        {numbers.map(([n, l]) => (
          <div key={l} className="vx-kpi">
            <span className="vx-kpi-label">{l}</span>
            <span className="vx-kpi-value">{n}</span>
          </div>
        ))}
      </div>

      <div className="grid gap-10 md:grid-cols-2 md:gap-8 vx-sec-block">
        {recap.topArtists.length > 0 && (
          <section aria-labelledby="vx-recap-artists">
            <h2 id="vx-recap-artists" className="vx-sec-title">Top artists</h2>
            <ol className="vx-group">
              {recap.topArtists.map((a, i) => (
                <li key={a.name} className="vx-row">
                  <span className="vx-row-rank">{i + 1}</span>
                  <span className="vx-row-main vx-row-label truncate">{a.name}</span>
                  <span className="vx-row-value">{a.plays} plays</span>
                </li>
              ))}
            </ol>
          </section>
        )}

        {recap.topLanguages.length > 0 && (
          <section aria-labelledby="vx-recap-langs">
            <h2 id="vx-recap-langs" className="vx-sec-title">Your languages</h2>
            <div className="vx-group is-padded space-y-4">
              {recap.topLanguages.map((l) => (
                <div key={l.id}>
                  <div className="flex justify-between text-[14px] mb-2">
                    <span className="font-semibold text-ink-100">{languageLabel(l.id)}</span>
                    <span className="text-ink-400 tabular-nums">{l.pct}%</span>
                  </div>
                  <div className="vx-bar" aria-hidden>
                    <span style={{ width: `${l.pct}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>

      {recap.onRepeat && (
        <section className="vx-sec-block" aria-labelledby="vx-recap-repeat">
          <h2 id="vx-recap-repeat" className="vx-sec-title">On repeat lately</h2>
          <div className="vx-group">
            <div className="vx-row">
              <span className="vx-row-main">
                <span className="vx-row-label truncate">{recap.onRepeat.title}</span>
                <span className="vx-row-hint truncate">{recap.onRepeat.subtitle}</span>
              </span>
              <span className="vx-row-value">{recap.onRepeat.count} recent plays</span>
            </div>
          </div>
        </section>
      )}

      <p className="vx-sec-foot">
        Counts are lifetime, from your on-device taste profile. Minutes are an estimate.
      </p>
    </div>
  );
}
