import { useState } from 'react';
import { Link } from 'react-router-dom';
import { usePageTitle } from '@/hooks/usePageTitle';
import { HUB_LANGUAGES, languageLabel } from '@/constants/languages';
import { flattenSongPages, useInfiniteSongs } from '@/features/search/useInfiniteSongs';
import { usePlayerStore } from '@/store/playerStore';
import { useHistoryStore } from '@/store/historyStore';
import { bestImage, FALLBACK_ART } from '@/utils/images';
import { ListSkeleton } from '@/components/Skeletons';
import { ErrorState } from '@/components/States';
import { cn } from '@/utils/cn';

const PERIODS = [
  { id: 'today', label: 'Today', q: 'trending songs india' },
  { id: 'week', label: 'This week', q: 'top hits this week india' },
  { id: 'all', label: 'All time', q: 'all time hit songs india' },
] as const;

const MOODS: Array<{ label: string; tint: string; to: string }> = [
  { label: 'Romance', tint: 'rgba(236,72,153,0.18)', to: '/moods' },
  { label: 'Party', tint: 'rgba(34,211,238,0.18)', to: '/moods' },
  { label: 'Chill', tint: 'rgba(96,165,250,0.18)', to: '/moods' },
  { label: 'Workout', tint: 'rgba(167,139,250,0.18)', to: '/moods' },
];

function isoWeek(): number {
  const d = new Date();
  const target = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = target.getUTCDay() || 7;
  target.setUTCDate(target.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
  return Math.ceil(((target.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
}

function fmtPlays(n: number | null | undefined): string {
  if (!n) return '';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M plays`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}K plays`;
  return `${n} plays`;
}

/** Canvas 4c — Charts & Discover: what India is playing right now. */
export default function ChartsPage() {
  usePageTitle('Charts');
  const [period, setPeriod] = useState<(typeof PERIODS)[number]['id']>('today');
  const q = PERIODS.find((p) => p.id === period)?.q ?? PERIODS[0].q;
  const songsQ = useInfiniteSongs(q);
  const songs = flattenSongPages(songsQ.data?.pages).slice(0, 20);
  const playQueue = usePlayerStore((s) => s.playQueue);
  const playsCount = useHistoryStore((s) => s.entries.length);

  return (
    <div className="max-w-screen-xl mx-auto pb-8">
      {/* header + period pills */}
      <div className="flex flex-wrap items-end justify-between gap-3 mb-5">
        <div>
          <h1 className="text-3xl md:text-[34px] font-extrabold tracking-tight">Charts</h1>
          <p className="text-xs font-semibold text-ink-400">What India is playing right now</p>
        </div>
        <div className="flex items-center gap-2">
          {PERIODS.map((p) => (
            <button
              key={p.id}
              onClick={() => setPeriod(p.id)}
              className={cn(
                'h-9 px-4 rounded-full text-xs transition active:scale-95 border',
                period === p.id
                  ? 'font-extrabold text-ink-100 border-ember-400/30'
                  : 'font-bold bg-[var(--tile)] border-[var(--glass-border)] text-ink-300 hover:bg-[var(--tile-hover)]',
              )}
              style={period === p.id ? { background: 'linear-gradient(135deg, rgba(34,211,238,0.22), rgba(96,165,250,0.14))' } : undefined}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px] items-start">
        {/* chart list */}
        <div>
          {songsQ.isLoading ? (
            <ListSkeleton />
          ) : songsQ.isError ? (
            <ErrorState retry={() => void songsQ.refetch()} />
          ) : (
            <ul className="space-y-2">
              {songs.map((s, i) => (
                <li key={s.id}>
                  <button
                    onClick={() => playQueue(songs, i)}
                    className="w-full rounded-2xl bg-[var(--tile-2)] border border-[var(--glass-border)] p-3 flex items-center gap-3 text-left hover:bg-[var(--tile-hover)] transition card-lift"
                  >
                    <span
                      className={cn(
                        'w-7 text-[17px] font-extrabold shrink-0',
                        i < 3 ? 'bg-clip-text text-transparent' : 'text-ink-500',
                      )}
                      style={i < 3 ? { backgroundImage: 'linear-gradient(135deg, #22d3ee, #a78bfa)' } : undefined}
                    >
                      {i + 1}
                    </span>
                    <img
                      src={bestImage(s.images, 96)}
                      onError={(e) => ((e.target as HTMLImageElement).src = FALLBACK_ART)}
                      alt=""
                      className="w-12 h-12 rounded-[10px] object-cover shrink-0"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-bold truncate">{s.title}</span>
                      <span className="block text-xs font-semibold text-ink-400 truncate">{s.subtitle}</span>
                    </span>
                    <span className="text-xs font-bold text-ink-300 shrink-0">{fmtPlays(s.playCount)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* moods · hubs · weekly */}
        <div className="space-y-6">
          <section>
            <h2 className="text-[17px] font-extrabold mb-2.5">Moods</h2>
            <div className="grid grid-cols-2 gap-2">
              {MOODS.map((m) => (
                <Link
                  key={m.label}
                  to={m.to}
                  className="h-[76px] rounded-[18px] border border-[var(--glass-border)] flex items-end p-3 text-sm font-extrabold hover:brightness-110 transition card-lift"
                  style={{ background: `linear-gradient(135deg, ${m.tint}, rgba(255,255,255,0.04))` }}
                >
                  {m.label}
                </Link>
              ))}
            </div>
          </section>

          <section>
            <h2 className="text-[17px] font-extrabold mb-2.5">Language hubs</h2>
            <div className="flex flex-wrap gap-2">
              {HUB_LANGUAGES.slice(0, 8).map((l) => (
                <Link
                  key={l}
                  to={`/${l}-songs`}
                  className="h-[38px] px-4 rounded-full bg-[var(--tile)] border border-[var(--glass-border)] text-[13px] font-bold text-ink-200 inline-flex items-center hover:bg-[var(--tile-hover)] transition"
                >
                  {languageLabel(l)}
                </Link>
              ))}
            </div>
          </section>

          <Link
            to="/weekly"
            className="block rounded-[20px] border border-ember-400/20 p-4 card-lift"
            style={{ background: 'linear-gradient(120deg, rgba(34,211,238,0.14), rgba(96,165,250,0.07))' }}
          >
            <p className="text-[11px] font-extrabold tracking-widest text-ember-300">WEEKLY PERSONAL MIX</p>
            <p className="text-base font-extrabold mt-1">Your Week {isoWeek()} mix {new Date().getDay() === 5 ? 'is here' : 'drops Friday'}</p>
            <p className="text-xs font-semibold text-ink-300 mt-0.5">{playsCount > 0 ? `Built from your last ${Math.min(playsCount, 500)} plays` : 'Builds from what you play this week'}</p>
          </Link>
        </div>
      </div>
    </div>
  );
}
