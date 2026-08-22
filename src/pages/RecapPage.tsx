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
      <div className="glass-card rounded-3xl max-w-md mx-auto my-24 px-10 py-14 text-center flex flex-col items-center gap-4">
        <p className="text-2xl font-extrabold">Your Year in Music</p>
        <p className="text-sm text-ink-300">
          Your recap unlocks after about 20 plays. Keep listening — every song you play is counted on this
          device only, never uploaded.
        </p>
        <Link to="/" className="px-5 py-2.5 rounded-full btn-primary text-sm font-bold">
          Play something
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto pb-8 space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-[26px] font-extrabold tracking-tight">Your {recap.year} in Music</h1>
          <p className="text-xs font-semibold text-ink-400">Computed on this device · never uploaded</p>
        </div>
        <button
          onClick={() => void shareCard()}
          disabled={sharing}
          className="h-[38px] px-4 rounded-full btn-primary text-xs font-bold transition active:scale-95 shrink-0 disabled:opacity-60"
        >
          {sharing ? 'Painting…' : '↑ Share card'}
        </button>
      </div>

      {/* persona hero */}
      <div
        className="rounded-3xl border border-ember-400/25 p-6"
        style={{ background: 'linear-gradient(130deg, rgba(99,102,241,0.22), rgba(45,212,191,0.10))' }}
      >
        <p className="text-[11px] font-bold tracking-widest text-ink-300">YOUR LISTENING PERSONA</p>
        <p className="text-[30px] font-extrabold tracking-tight mt-1">{recap.persona}</p>
        <p className="text-xs font-semibold text-ink-300 mt-1.5">
          Peak hour: {hourLabel(recap.peakHour)} · {recap.daysTogether} days of music together
        </p>
      </div>

      {/* numbers */}
      <div className="grid grid-cols-2 gap-2">
        {[
          [String(recap.totalPlays), 'SONGS PLAYED'],
          [`≈${recap.estMinutes.toLocaleString('en-IN')}`, 'MINUTES (ABOUT)'],
          [String(recap.completes), 'PLAYED TO THE END'],
          [String(recap.favorites), 'FAVORITES'],
        ].map(([n, l]) => (
          <div key={l} className="rounded-[18px] bg-[var(--tile)] border border-[var(--glass-border)] p-4">
            <p className="text-[26px] font-extrabold leading-tight">{n}</p>
            <p className="text-[11px] font-bold tracking-widest text-ink-400">{l}</p>
          </div>
        ))}
      </div>

      {/* top artists */}
      {recap.topArtists.length > 0 && (
        <section className="rounded-[18px] bg-[var(--tile)] border border-[var(--glass-border)] p-4">
          <h2 className="text-sm font-extrabold mb-3">Top artists</h2>
          <ol className="space-y-2">
            {recap.topArtists.map((a, i) => (
              <li key={a.name} className="flex items-center gap-3">
                <span className={`w-7 text-center text-sm font-extrabold ${i === 0 ? 'text-ember-400' : 'text-ink-400'}`}>
                  {i + 1}
                </span>
                <span className="text-sm font-bold truncate flex-1">{a.name}</span>
                <span className="text-[11px] font-semibold text-ink-400 shrink-0">{a.plays} plays</span>
              </li>
            ))}
          </ol>
        </section>
      )}

      {/* languages */}
      {recap.topLanguages.length > 0 && (
        <section className="rounded-[18px] bg-[var(--tile)] border border-[var(--glass-border)] p-4">
          <h2 className="text-sm font-extrabold mb-3">Your languages</h2>
          <div className="space-y-2.5">
            {recap.topLanguages.map((l) => (
              <div key={l.id}>
                <div className="flex justify-between text-[11px] font-bold mb-1">
                  <span>{languageLabel(l.id)}</span>
                  <span className="text-ink-400">{l.pct}%</span>
                </div>
                <div className="h-2 rounded-full bg-[var(--track)] overflow-hidden">
                  <div className="h-full rounded-full bg-ember-500" style={{ width: `${l.pct}%` }} />
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* on repeat lately */}
      {recap.onRepeat && (
        <div className="rounded-[18px] bg-[var(--tile)] border border-[var(--glass-border)] p-4">
          <p className="text-[11px] font-bold tracking-widest text-ink-400 mb-1">ON REPEAT LATELY</p>
          <p className="text-[15px] font-extrabold truncate">{recap.onRepeat.title}</p>
          <p className="text-xs font-semibold text-ink-400 truncate">
            {recap.onRepeat.subtitle} · {recap.onRepeat.count} recent plays
          </p>
        </div>
      )}

      <p className="text-[11px] text-ink-400 text-center pt-2">
        Counts are lifetime, from your on-device taste profile. Minutes are an estimate. Nothing here ever
        leaves your phone.
      </p>
    </div>
  );
}
