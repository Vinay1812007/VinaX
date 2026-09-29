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
import { SparkleIcon } from '@/components/Icons';
import { useSessionState } from '@/hooks/useSessionState';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { getSong } from '@/services/api';
import type { TrendsSnapshot, VerifiedTrend } from '@/services/trends/client';
import { PageHeader } from '@/components/PageHeader';
import { Chip } from '@/components/Chip';
import { moodTone } from '@/features/discover/tones';
import '@/styles/pages/browse.css';
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

const MOODS: Array<{ id: string; label: string; to: string }> = [
  { id: 'romance', label: 'Romance', to: '/moods' },
  { id: 'party', label: 'Party', to: '/moods' },
  { id: 'chill', label: 'Chill', to: '/moods' },
  { id: 'workout', label: 'Workout', to: '/moods' },
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

function Notice({ children, retry }: { children: ReactNode; retry?: () => void }) {
  return (
    <div role="status" className="vx-chart-notice">
      <span className="min-w-0">{children}</span>
      {retry && (
        <button type="button" onClick={retry} className="vx-pill-btn shrink-0">
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
      <div className="vx-chart-row">
        <span className="vx-chart-rank">{item.sourceKind === 'editorial' ? 'Pick' : `#${item.sourceRank}`}</span>
        <button type="button" onClick={onPlay} className="min-w-0 flex-1 text-left" aria-label={`Play ${item.title}`}>
          <span className="vx-chart-title">{item.title}</span>
          <span className="vx-chart-sub">{item.artist}</span>
          <span className="vx-chart-sub !text-[12px]">{provenanceLine(item)}</span>
        </button>
        {marker && (
          <span title={marker.title} className="search-type-pill">
            {marker.text}
          </span>
        )}
        {item.sourceUrl && (
          <a
            href={item.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Evidence for ${item.title}: ${item.sourceKind === 'editorial' ? 'editorial source' : item.sourceLabel}`}
            className="vx-text-action shrink-0 inline-flex items-center underline underline-offset-2"
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
    <div className="vx-section-header">
      <h2 id="verified-charts">Public charts</h2>
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
        <ul className="mb-3 space-y-0.5" aria-label="Chart sources">
          {lines.map((l) => (
            <li key={l.id} className={cn('text-[12px] font-semibold', l.stale ? 'text-ink-100' : 'text-ink-400')}>
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
              <div className="vx-chip-row mb-3" role="group" aria-label="Filter by source">
                {[{ id: 'all', label: 'All sources', stale: false }, ...chips].map((c) => (
                  <Chip key={c.id} active={active === c.id} onClick={() => setFilter(c.id)}>
                    {c.stale ? `${c.label} · out of date` : c.label}
                  </Chip>
                ))}
              </div>
            )}
            <ul className="vx-track-list">
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
    <section className="vx-section" aria-labelledby="verified-charts">
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
    <div className="vx-browse vx-browse-page max-w-screen-2xl mx-auto">
      <PageHeader title="Charts" />

      <div className="vx-chart-layout">
        <div className="min-w-0">
          <VerifiedCharts region={region} />

          {/* catalogue list — labelled as what it is */}
          <section aria-labelledby="catalogue-popular">
            <div className="vx-section-header flex-wrap">
              <h2 id="catalogue-popular">{CATALOGUE_LIST_TITLE}</h2>
              <div className="vx-chip-row" role="group" aria-label="Catalogue list">
                {PERIODS.map((p) => (
                  <Chip key={p.id} active={period === p.id} onClick={() => setPeriod(p.id)}>
                    {p.label}
                  </Chip>
                ))}
              </div>
            </div>
            <p className="vx-chart-note">{CATALOGUE_LIST_NOTE}</p>
            {songsQ.isLoading ? (
              <ListSkeleton />
            ) : songsQ.isError ? (
              <ErrorState retry={() => void songsQ.refetch()} />
            ) : (
              <ul className="vx-track-list">
                {songs.map((s, i) => (
                  <li key={s.id}>
                    <button type="button" onClick={() => playQueue(songs, i)} className="vx-chart-row">
                      <span className="vx-chart-rank">{i + 1}</span>
                      <img
                        src={bestImage(s.images, 96)}
                        onError={(e) => ((e.target as HTMLImageElement).src = FALLBACK_ART)}
                        alt=""
                      />
                      <span className="min-w-0 flex-1">
                        <span className="vx-chart-title">{s.title}</span>
                        <span className="vx-chart-sub">{s.subtitle}</span>
                      </span>
                      <span className="vx-chart-plays">{fmtPlays(s.playCount)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        {/* moods · hubs · weekly */}
        <aside className="min-w-0" aria-label="More to browse">
          <section className="vx-section">
            <div className="vx-section-header"><h2>Moods</h2></div>
            <div className="vx-browse-tiles is-compact !mb-0">
              {MOODS.map((m) => (
                <Link key={m.label} to={m.to} className={cn('vx-browse-tile', moodTone(m.id))}>
                  <span className="vx-browse-tile-title">{m.label}</span>
                </Link>
              ))}
            </div>
          </section>

          <section className="vx-section">
            <div className="vx-section-header"><h2>Language hubs</h2></div>
            <div className="vx-chip-row">
              {HUB_LANGUAGES.slice(0, 8).map((l) => (
                <Link key={l} to={`/${l}-songs`} className="vx-link-chip">
                  {languageLabel(l)}
                </Link>
              ))}
            </div>
          </section>

          <Link to="/weekly" className="vx-browse-tile vx-tone-8 !h-auto !min-h-[104px]">
            <span className="vx-browse-tile-title">Your Week {isoWeek()} mix {new Date().getDay() === 5 ? 'is here' : 'drops Friday'}</span>
            <span className="vx-browse-tile-meta !max-w-[75%] !whitespace-normal">{playsCount > 0 ? `Built from your last ${Math.min(playsCount, 500)} plays` : 'Builds from what you play this week'}</span>
            <span className="vx-browse-tile-art" aria-hidden><SparkleIcon /></span>
          </Link>
        </aside>
      </div>
    </div>
  );
}
