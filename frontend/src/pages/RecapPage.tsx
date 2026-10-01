import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useHistoryStore } from '@/store/historyStore';
import { useLibraryStore } from '@/store/libraryStore';
import { loadProfile } from '@/services/personalization/storage';
import { buildRecap, recapReady } from '@/features/recap/recap';
import { ArtistAvatar, Collage, artistPictures, mostPlayed } from '@/features/stats/artwork';
import { languageLabel } from '@/constants/languages';
import { getLocal } from '@/services/storage/local';
import { KEYS } from '@/constants/storage-keys';
import { toast } from '@/store/toastStore';
import { PageHeader } from '@/components/PageHeader';
import { SectionHeader } from '@/components/SectionHeader';
import { SongRow } from '@/components/SongRow';
import { ShareIcon, SparkleIcon } from '@/components/Icons';
import '@/styles/pages/secondary.css';

const hourLabel = (h: number): string => {
  const twelve = h % 12 === 0 ? 12 : h % 12;
  return `${twelve} ${h < 12 ? 'AM' : 'PM'}`;
};

/** "Your Year in Music" — a year-in-review recap, computed and rendered
 *  entirely on-device. The share button paints a local PNG; nothing is uploaded. */
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
  const covers = useMemo(() => mostPlayed(entries, 8).map((t) => t.song), [entries]);
  const pictures = useMemo(() => artistPictures([...entries.map((e) => e.song), ...favorites]), [entries, favorites]);
  // The "on repeat" pick names a title; play the song itself when history still holds it.
  const onRepeatSong = useMemo(
    () => (recap.onRepeat ? entries.find((e) => e.song.title === recap.onRepeat?.title && e.song.subtitle === recap.onRepeat?.subtitle)?.song ?? null : null),
    [entries, recap.onRepeat],
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
          <SparkleIcon className="w-9 h-9" />
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
    <div className="vx-sec is-wide">
      <PageHeader
        title={`Your ${recap.year} in music`}
        subtitle="Computed on this device · never uploaded"
        actions={
          <button type="button" onClick={() => void shareCard()} disabled={sharing} className="px-5 rounded-full btn-primary text-sm inline-flex items-center gap-2 disabled:opacity-60">
            <ShareIcon className="w-4 h-4" />
            {sharing ? 'Painting…' : 'Share card'}
          </button>
        }
      />

      {/* The persona, beside the covers you played most. */}
      <section className="vx-sec-block vx-sec-feature" aria-label="Your listening persona">
        <div className="vx-hero-row">
          <Collage songs={covers} />
          <div>
            <p className="text-[14px] font-semibold text-ink-300">Your listening persona</p>
            <p className="vx-display mt-2">{recap.persona}</p>
            <p className="mt-3 text-[14px] font-semibold text-ink-300 tabular-nums">
              Peak hour {hourLabel(recap.peakHour)} · {recap.daysTogether} {recap.daysTogether === 1 ? 'day' : 'days'} of music together
            </p>
          </div>
        </div>
      </section>

      <div className="vx-sec-block vx-kpis is-four">
        {numbers.map(([n, l]) => (
          <div key={l} className="vx-kpi">
            <span className="vx-kpi-label">{l}</span>
            <span className="vx-kpi-value">{n}</span>
          </div>
        ))}
      </div>

      <div className="vx-two vx-sec-block">
        {recap.topArtists.length > 0 && (
          <section aria-label="Top artists">
            <SectionHeader title="Top artists" explanation="Lifetime plays from your taste profile." />
            <ol className="vx-group">
              {recap.topArtists.map((a, i) => (
                <li key={a.name} className="vx-row">
                  <span className="vx-row-rank">{i + 1}</span>
                  <ArtistAvatar name={a.name} image={pictures.get(a.name.trim().toLowerCase())} size={i === 0 ? 56 : 44} />
                  <span className="vx-row-main vx-row-label truncate-1">{a.name}</span>
                  <span className="vx-row-value is-plays">{a.plays} plays</span>
                </li>
              ))}
            </ol>
          </section>
        )}

        {recap.topLanguages.length > 0 && (
          <section aria-label="Your languages">
            <SectionHeader title="Your languages" explanation="Share of your plays." />
            <div className="grid gap-5 pt-2">
              {recap.topLanguages.map((l) => (
                <div key={l.id}>
                  <div className="flex justify-between text-[15px] mb-2">
                    <span className="font-semibold text-ink-100">{languageLabel(l.id)}</span>
                    <span className="text-ink-400 font-semibold tabular-nums">{l.pct}%</span>
                  </div>
                  <span className="vx-bar" aria-hidden>
                    <span style={{ width: `${l.pct}%` }} />
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>

      {recap.onRepeat && (
        <section className="vx-sec-block" aria-label="On repeat lately">
          <SectionHeader title="On repeat lately" explanation={`${recap.onRepeat.count} plays in your recent history.`} />
          {onRepeatSong ? (
            <SongRow song={onRepeatSong} />
          ) : (
            <div className="vx-group">
              <div className="vx-row">
                <span className="vx-row-main">
                  <span className="vx-row-label truncate-1">{recap.onRepeat.title}</span>
                  <span className="vx-row-hint truncate-1">{recap.onRepeat.subtitle}</span>
                </span>
                <span className="vx-row-value">{recap.onRepeat.count} recent plays</span>
              </div>
            </div>
          )}
        </section>
      )}

      <p className="vx-sec-foot">
        Counts are lifetime, from your on-device taste profile. Minutes are an estimate.
      </p>
    </div>
  );
}
