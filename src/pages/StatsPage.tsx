import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useHistoryStore } from '@/store/historyStore';
import { useLibraryStore } from '@/store/libraryStore';
import { getStreak, getBestStreak } from '@/utils/streak';
import { toast } from '@/store/toastStore';

const BAR_COLORS = ['#22d3ee', '#60a5fa', '#a78bfa', '#67e8f9', '#c4b5fd'];

function fmtHours(totalSec: number): string {
  const h = totalSec / 3600;
  return h >= 10 ? String(Math.round(h)) : h.toFixed(1);
}

/** Canvas 4a — Your VinaX: on-device analytics, never uploaded. */
export default function StatsPage() {
  usePageTitle('Your VinaX');
  const entries = useHistoryStore((s) => s.entries);
  const favorites = useLibraryStore((s) => s.favorites);

  const stats = useMemo(() => {
    const artistCount = new Map<string, number>();
    const langCount = new Map<string, number>();
    let seconds = 0;
    for (const e of entries) {
      const s = e.song;
      seconds += s.duration ?? 0;
      const artist = s.artists?.[0]?.name ?? s.subtitle?.split(',')[0]?.trim() ?? 'Unknown';
      artistCount.set(artist, (artistCount.get(artist) ?? 0) + 1);
      const lang = s.language ? s.language[0].toUpperCase() + s.language.slice(1) : 'Other';
      langCount.set(lang, (langCount.get(lang) ?? 0) + 1);
    }
    const topArtists = [...artistCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
    const langs = [...langCount.entries()].sort((a, b) => b[1] - a[1]);
    const top4 = langs.slice(0, 4);
    const rest = langs.slice(4).reduce((n, [, c]) => n + c, 0);
    const langRows = rest > 0 ? [...top4, ['Other', rest] as [string, number]] : top4;
    const totalLang = langRows.reduce((n, [, c]) => n + c, 0) || 1;
    return {
      plays: entries.length,
      hours: fmtHours(seconds),
      artists: artistCount.size,
      topArtists,
      maxArtist: topArtists[0]?.[1] ?? 1,
      langs: langRows.map(([name, c]) => ({ name, pct: Math.round((c / totalLang) * 100) })),
    };
  }, [entries]);

  const streak = getStreak();
  const best = getBestStreak();

  const share = (): void => {
    const text = `My VinaX: ${stats.plays} plays · ${stats.hours}h listened · ${streak}-day streak 🎵 sirimillavinay.online`;
    if (navigator.share) {
      void navigator.share({ text }).catch(() => undefined);
    } else {
      void navigator.clipboard?.writeText(text).then(() => toast('Copied — paste it anywhere'));
    }
  };

  if (!entries.length) {
    return (
      <div className="glass-card rounded-3xl max-w-md mx-auto my-24 px-10 py-14 text-center flex flex-col items-center gap-4">
        <p className="text-2xl font-extrabold">Your VinaX</p>
        <p className="text-sm text-ink-300">Play a few songs and your on-device stats bloom here — never uploaded, always yours.</p>
        <Link to="/" className="px-5 py-2.5 rounded-full btn-primary text-sm font-bold">Start listening</Link>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto pb-8 space-y-5">
      {/* header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-[26px] font-extrabold tracking-tight">Your VinaX</h1>
          <p className="text-xs font-semibold text-ink-400">Computed on this device · never uploaded</p>
        </div>
        <button
          onClick={share}
          className="h-[38px] px-4 rounded-full bg-[var(--tile-2)] border border-[var(--glass-border)] text-xs font-bold text-ink-200 hover:bg-[var(--tile-hover)] transition active:scale-95 shrink-0"
        >
          ↑ Share
        </button>
      </div>

      {/* stat grid */}
      <div className="grid grid-cols-2 gap-2">
        {[
          [String(stats.plays), 'PLAYS'],
          [`${stats.hours}h`, 'LISTENED'],
          [String(favorites.length), 'FAVORITES'],
          [String(stats.artists), 'ARTISTS'],
        ].map(([n, l]) => (
          <div key={l} className="rounded-[18px] bg-[var(--tile)] border border-[var(--glass-border)] p-4">
            <p className="text-[26px] font-extrabold leading-tight">{n}</p>
            <p className="text-[11px] font-bold tracking-widest text-ink-400">{l}</p>
          </div>
        ))}
      </div>

      {/* streak */}
      <div
        className="rounded-[20px] border border-ember-400/20 p-4 flex items-center gap-3.5"
        style={{ background: 'linear-gradient(120deg, rgba(34,211,238,0.16), rgba(96,165,250,0.08))' }}
      >
        <span className="text-[28px]" aria-hidden>🔥</span>
        <span>
          <span className="block text-[15px] font-extrabold">
            {streak > 0 ? `${streak}-day streak` : 'Start a streak tonight'}
          </span>
          <span className="block text-[11px] font-semibold text-ink-300">
            Best: {Math.max(best, streak)} days · keep the music alive
          </span>
        </span>
      </div>

      {/* top artists */}
      <section>
        <h2 className="text-base font-extrabold mb-2.5">Top artists</h2>
        <ul className="space-y-2">
          {stats.topArtists.map(([name, count], i) => (
            <li key={name} className="flex items-center gap-3">
              <span className="w-5 text-[13px] font-extrabold text-ink-500">{i + 1}</span>
              <span
                className="w-[38px] h-[38px] rounded-full flex items-center justify-center text-sm font-extrabold text-white shrink-0"
                style={{ background: `linear-gradient(135deg, ${BAR_COLORS[i % BAR_COLORS.length]}55, #164e63)` }}
              >
                {name[0]?.toUpperCase()}
              </span>
              <span className="flex-1 min-w-0 text-[13px] font-bold truncate">{name}</span>
              <span className="w-[110px] h-1.5 rounded-full bg-[var(--track)] overflow-hidden shrink-0">
                <span
                  className="block h-full rounded-full"
                  style={{ width: `${Math.max(8, (count / stats.maxArtist) * 100)}%`, background: 'linear-gradient(90deg, #22d3ee, #a78bfa)' }}
                />
              </span>
              <span className="w-8 text-right text-[11px] font-bold text-ink-400 shrink-0">{count}</span>
            </li>
          ))}
        </ul>
      </section>

      {/* languages */}
      <section>
        <h2 className="text-base font-extrabold mb-2.5">Languages</h2>
        <div className="h-3.5 rounded-full overflow-hidden flex border border-[var(--glass-border)]">
          {stats.langs.map((l, i) => (
            <span key={l.name} style={{ width: `${l.pct}%`, background: BAR_COLORS[i % BAR_COLORS.length] }} />
          ))}
        </div>
        <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1.5">
          {stats.langs.map((l, i) => (
            <span key={l.name} className="inline-flex items-center gap-1.5 text-[11px] font-bold text-ink-300">
              <span className="w-[9px] h-[9px] rounded-[3px]" style={{ background: BAR_COLORS[i % BAR_COLORS.length] }} />
              {l.name} {l.pct}%
            </span>
          ))}
        </div>
      </section>
    </div>
  );
}
