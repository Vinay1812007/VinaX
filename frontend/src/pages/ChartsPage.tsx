import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { usePageTitle } from '@/hooks/usePageTitle';
import { HUB_LANGUAGES, languageLabel } from '@/constants/languages';
import { flattenSongPages, useInfiniteSongs } from '@/features/search/useInfiniteSongs';
import { useRegion } from '@/features/location/useRegion';
import { usePlayerStore } from '@/store/playerStore';
import { useHistoryStore } from '@/store/historyStore';
import { bestImage, FALLBACK_ART } from '@/utils/images';
import { ListSkeleton } from '@/components/Skeletons';
import { ErrorState } from '@/components/States';
import { cn } from '@/utils/cn';
import { useSessionState } from '@/hooks/useSessionState';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { getSong } from '@/services/api';
import type { TrendsSnapshot, VerifiedTrend } from '@/services/trends/client';
import { CATALOGUE_LIST_NOTE, CATALOGUE_LIST_TITLE, movementMarker, provenanceLine, sourceChips, sourceLine, verifiedView } from '@/services/trends/present';

/**
 * 7.2 — two different things, labelled as what they are:
 *   - "Public charts": catalogue songs the server matched with confidence to
 *     an outside chart entry or an editorial pick, each with its source, rank,
 *     region, update time and evidence link (services/trends). "Rising" and
 *     "New entry" appear only when the snapshot carries them.
 *   - "Popular in the catalogue": catalogue search results for popular songs.
 *     Not a chart, and never called one.
 * The trends client is loaded lazily, and neither section waits for the other.
 */

// Catalogue searches. The labels describe the search, not a chart position.
const PERIODS = [
  { id: 'today', label: 'Popular', q: 'trending songs india' },
  { id: 'week', label: 'Recent hits', q: 'top hits this week india' },
  { id: 'all', label: 'All-time hits', q: 'all time hit songs india' },
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

function useVerifiedTrends(region: string) {
  return useQuery<TrendsSnapshot | null>({
    queryKey: ['verified-trends', region],
    // Lazy: the client (and its validation) stays out of the first-load bundle.
    queryFn: ({ signal }) => import('@/services/trends/client').then((m) => m.fetchVerifiedTrends({ region, limit: 50, signal })),
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
    retry: false,
  });
}

const pillClass = 'h-9 px-4 rounded-full text-xs transition active:scale-95 border';
const pillOn = 'font-extrabold text-ink-100 border-ember-400/30';
const pillOff = 'font-bold bg-[var(--tile)] border-[var(--glass-border)] text-ink-300 hover:bg-[var(--tile-hover)]';
const pillOnStyle = { background: 'linear-gradient(135deg, rgba(34,211,238,0.22), rgba(96,165,250,0.14))' };

function Notice({ children, retry }: { children: ReactNode; retry?: () => void }) {
  return (
    <div role="status" className="flex items-center justify-between gap-3 rounded-2xl border border-glass bg-[var(--tile)] px-4 py-3 text-sm text-ink-300">
      <span className="min-w-0">{children}</span>
      {retry && (
        <button type="button" onClick={retry} className="btn-secondary shrink-0 px-4 text-xs min-h-[44px]">
          Retry
        </button>
      )}
    </div>
  );
}

function VerifiedRow({ item, onPlay, state }: { item: VerifiedTrend; onPlay: () => void; state: 'idle' | 'loading' | 'failed' }) {
  const marker = movementMarker(item);
  return (
    <li>
      <div className="w-full rounded-2xl bg-[var(--tile-2)] border border-[var(--glass-border)] p-3 flex items-center gap-3">
        <span className="w-10 text-[15px] font-extrabold shrink-0 text-ink-300">{item.sourceKind === 'editorial' ? 'Pick' : `#${item.sourceRank}`}</span>
        <button type="button" onClick={onPlay} className="min-w-0 flex-1 text-left" aria-label={`Play ${item.title}`}>
          <span className="block text-sm font-bold truncate">{item.title}</span>
          <span className="block text-xs font-semibold text-ink-400 truncate">{item.artist}</span>
          <span className="block text-[11px] font-semibold text-ink-400 truncate">{provenanceLine(item)}</span>
        </button>
        {marker && (
          <span title={marker.title} className="shrink-0 rounded-full border border-ember-400/30 px-2 py-0.5 text-[11px] font-extrabold text-ember-300">
            {marker.text}
          </span>
        )}
        {item.sourceUrl && (
          <a
            href={item.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Evidence for ${item.title}: ${item.sourceKind === 'editorial' ? 'editorial source' : item.sourceLabel}`}
            className="shrink-0 text-xs font-bold text-ink-300 underline underline-offset-2 hover:text-ink-100"
          >
            Source
          </a>
        )}
      </div>
      {state === 'loading' && <p className="px-3 pt-1 text-[11px] text-ink-400" role="status">Loading from the catalogue…</p>}
      {state === 'failed' && <p className="px-3 pt-1 text-[11px] text-ink-300" role="alert">Couldn’t load this song from the catalogue. Try again.</p>}
    </li>
  );
}

function VerifiedCharts({ region }: { region: string }) {
  const online = useOnlineStatus();
  const q = useVerifiedTrends(region);
  const [filter, setFilter] = useSessionState<string>('vinax.charts.source.v1', 'all');
  const playQueue = usePlayerStore((s) => s.playQueue);
  const [rowState, setRowState] = useState<{ id: string; state: 'loading' | 'failed' } | null>(null);

  const play = async (item: VerifiedTrend): Promise<void> => {
    setRowState({ id: `${item.source}:${item.catalogId}`, state: 'loading' });
    try {
      const song = await getSong(item.catalogId);
      setRowState(null);
      playQueue([song], 0);
    } catch {
      setRowState({ id: `${item.source}:${item.catalogId}`, state: 'failed' });
    }
  };

  const retry = (): void => void q.refetch();
  const header = (
    <div className="mb-2.5">
      <h2 id="verified-charts" className="text-[17px] font-extrabold">
        Public charts
      </h2>
      <p className="text-xs font-semibold text-ink-400">Catalogue songs matched to public chart entries and editorial picks, each with its source.</p>
    </div>
  );

  let body: ReactNode;
  if (q.isLoading) {
    body = (
      <p className="text-sm text-ink-400" role="status" aria-busy="true">
        Checking public charts…
      </p>
    );
  } else {
    const snapshot = q.data ?? null;
    const view = verifiedView(q.isError ? null : snapshot);
    if (view.kind !== 'items' && !online) {
      body = <Notice retry={retry}>You’re offline. Public charts need a connection; the catalogue lists below may also be unavailable.</Notice>;
    } else if (view.kind === 'unavailable') {
      body = <Notice retry={retry}>Public charts are unavailable right now.</Notice>;
    } else if (view.kind === 'not_connected') {
      body = <Notice>No public chart is connected yet, so there is nothing verified to show. The lists below are popular songs in the catalogue, not a chart.</Notice>;
    } else {
      const lines = view.sources.map((s) => ({ id: s.id, stale: s.status === 'stale', text: sourceLine(s) })).filter((l) => l.text);
      const status = (
        <ul className="mb-2.5 space-y-0.5" aria-label="Chart sources">
          {lines.map((l) => (
            <li key={l.id} className={cn('text-[11px] font-semibold', l.stale ? 'text-ember-300' : 'text-ink-400')}>
              {l.text}
            </li>
          ))}
        </ul>
      );
      if (view.kind === 'empty' || !snapshot) {
        body = (
          <>
            {status}
            <Notice retry={retry}>No chart entries have been matched to catalogue songs yet.</Notice>
          </>
        );
      } else {
        const chips = sourceChips(snapshot);
        const active = chips.some((c) => c.id === filter) ? filter : 'all';
        const items = active === 'all' ? snapshot.items : snapshot.items.filter((i) => i.source === active);
        body = (
          <>
            {status}
            {chips.length > 1 && (
              <div className="flex flex-wrap items-center gap-2 mb-2.5" role="group" aria-label="Filter by source">
                {[{ id: 'all', label: 'All sources', stale: false }, ...chips].map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    aria-pressed={active === c.id}
                    onClick={() => setFilter(c.id)}
                    className={cn(pillClass, active === c.id ? pillOn : pillOff)}
                    style={active === c.id ? pillOnStyle : undefined}
                  >
                    {c.stale ? `${c.label} · out of date` : c.label}
                  </button>
                ))}
              </div>
            )}
            <ul className="space-y-2">
              {items.map((item) => {
                const key = `${item.source}:${item.catalogId}`;
                return <VerifiedRow key={key} item={item} onPlay={() => void play(item)} state={rowState?.id === key ? rowState.state : 'idle'} />;
              })}
            </ul>
          </>
        );
      }
    }
  }

  return (
    <section className="mb-7" aria-labelledby="verified-charts">
      {header}
      {body}
    </section>
  );
}

/** Canvas 4c — Charts & Discover. */
export default function ChartsPage() {
  usePageTitle('Charts');
  const regionInfo = useRegion();
  const country = (regionInfo?.country ?? '').toUpperCase();
  const region = /^[A-Z]{2}$/.test(country) ? country : 'IN';
  const [period, setPeriod] = useSessionState<(typeof PERIODS)[number]['id']>('vinax.charts.period.v1', 'today');
  const q = PERIODS.find((p) => p.id === period)?.q ?? PERIODS[0].q;
  const songsQ = useInfiniteSongs(q);
  const songs = flattenSongPages(songsQ.data?.pages).slice(0, 20);
  const playQueue = usePlayerStore((s) => s.playQueue);
  const playsCount = useHistoryStore((s) => s.entries.length);

  return (
    <div className="max-w-screen-xl mx-auto pb-8 vx-stagger">
      <div className="mb-5">
        <h1 className="text-page-title">Charts</h1>
        <p className="text-xs font-semibold text-ink-400">Public charts with their sources, and what’s popular in the catalogue</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px] items-start">
        <div>
          <VerifiedCharts region={region} />

          {/* catalogue list — labelled as what it is */}
          <section aria-labelledby="catalogue-popular">
            <div className="flex flex-wrap items-end justify-between gap-3 mb-2.5">
              <div>
                <h2 id="catalogue-popular" className="text-[17px] font-extrabold">
                  {CATALOGUE_LIST_TITLE}
                </h2>
                <p className="text-xs font-semibold text-ink-400">{CATALOGUE_LIST_NOTE}</p>
              </div>
              <div className="flex items-center gap-2" role="group" aria-label="Catalogue list">
                {PERIODS.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    aria-pressed={period === p.id}
                    onClick={() => setPeriod(p.id)}
                    className={cn(pillClass, period === p.id ? pillOn : pillOff)}
                    style={period === p.id ? pillOnStyle : undefined}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
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
                      <span className="w-7 text-[15px] font-bold shrink-0 text-ink-400">{i + 1}</span>
                      <img
                        src={bestImage(s.images, 96)}
                        onError={(e) => ((e.target as HTMLImageElement).src = FALLBACK_ART)}
                        alt=""
                        className="w-12 h-12 rounded-lg object-cover shrink-0"
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
          </section>
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
                  className="h-[76px] rounded-2xl border border-[var(--glass-border)] flex items-end p-3 text-sm font-extrabold hover:brightness-110 transition card-lift"
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
            className="block rounded-2xl border border-ember-400/20 p-4 card-lift"
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
