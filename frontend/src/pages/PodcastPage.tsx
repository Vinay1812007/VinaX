import { memo, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { getPodcast, type Podcast } from '@/services/api';
import { usePageMeta } from '@/hooks/usePageMeta';
import { usePlayerStore } from '@/store/playerStore';
import { EntityAction, EntityHeader, EntityMenu, EntityMeta, PlayFab } from '@/components/EntityHeader';
import { HeaderSkeleton, ListSkeleton } from '@/components/Skeletons';
import { EmptyState, ErrorState, InlineError } from '@/components/States';
import { TrackMenu } from '@/components/TrackMenu';
import { Chip } from '@/components/Chip';
import { Button } from '@/components/Button';
import { MicIcon, PlayIcon, ShareIcon } from '@/components/Icons';
import { getEpisodePage, type Episode } from '@/features/podcasts/api';
import { podcastPath } from '@/features/podcasts/paths';
import { languageLabel } from '@/constants/languages';
import { bestImage, FALLBACK_ART } from '@/utils/images';
import { artistPath, extractId } from '@/utils/slug';
import { formatCount } from '@/utils/format';
import { shareLink } from '@/utils/share';
import { cn } from '@/utils/cn';
import '@/styles/pages/tracklist.css';
import '@/styles/pages/podcasts.css';

const PAGE_SIZE = 20;

/** "11 Oct 2017" — the catalogue's date is a calendar day, so it is read as UTC. */
export function episodeDate(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

/** "39 sec", "29 min", "1 hr 5 min". */
export function episodeLength(sec: number | null): string {
  if (!sec || sec <= 0) return '';
  if (sec < 60) return `${Math.round(sec)} sec`;
  const mins = Math.round(sec / 60);
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h} hr ${m} min` : `${h} hr`;
}

const EpisodeRow = memo(function EpisodeRow({ ep, list, index }: { ep: Episode; list: Episode[]; index: number }) {
  const { song } = ep;
  const isCurrent = usePlayerStore((s) => s.queue[s.index]?.id === song.id);
  const isPlaying = usePlayerStore((s) => s.isPlaying && s.queue[s.index]?.id === song.id);
  const meta = [ep.number != null ? `Episode ${ep.number}` : null, episodeDate(ep.releaseDate), episodeLength(song.duration)]
    .filter(Boolean)
    .join(' · ');
  return (
    <div data-song-id={song.id} className={cn('vx-track-row vx-episode group', isCurrent && 'is-current', isPlaying && 'is-playing')}>
      <button
        type="button"
        className="vx-track-play"
        aria-label={`Play ${song.title}`}
        aria-current={isCurrent ? 'true' : undefined}
        onClick={() => usePlayerStore.getState().playQueue(list.map((e) => e.song), index)}
      >
        <span className="vx-track-art">
          <img
            src={bestImage(song.images, 150)}
            onError={(e) => ((e.target as HTMLImageElement).src = FALLBACK_ART)}
            alt=""
            loading="lazy"
            decoding="async"
            width={72}
            height={72}
          />
          <span className="vx-track-art-over" aria-hidden>
            {isPlaying && <span className="vx-eq"><i /><i /><i /></span>}
            <PlayIcon className="vx-track-art-glyph" />
          </span>
        </span>
        <span className="vx-track-text">
          {meta && <span className="vx-episode-meta">{meta}</span>}
          <span className="vx-track-title">
            <span>{song.title}</span>
            {song.explicit && <span className="vx-explicit" title="Explicit">E</span>}
          </span>
          {ep.description && <span className="vx-episode-desc">{ep.description}</span>}
        </span>
      </button>
      <span className="vx-track-more hover-reveal"><TrackMenu song={song} /></span>
    </div>
  );
});

/** The newest season (highest number), or null when the show lists none. */
function latestSeason(p: Podcast): number | null {
  const nums = p.seasons.map((s) => s.number).filter((n): n is number => n != null);
  return nums.length ? Math.max(...nums) : null;
}

function PodcastView({ id }: { id: string }) {
  const show = useQuery({
    queryKey: ['podcast', id],
    queryFn: ({ signal }) => getPodcast(id, null, { signal, priority: 'interactive' }),
    staleTime: 30 * 60_000,
  });
  const podcast = show.data;
  const [picked, setPicked] = useState<number | null>(null);
  const season = picked ?? (podcast ? latestSeason(podcast) : null);
  const seasonInfo = podcast?.seasons.find((s) => s.number === season) ?? null;
  const total = seasonInfo?.episodeCount ?? null;

  const eps = useInfiniteQuery({
    queryKey: ['podcast-episodes', id, season, PAGE_SIZE],
    queryFn: ({ pageParam, signal }) => getEpisodePage(id, { season, page: pageParam, limit: PAGE_SIZE }, { signal }),
    initialPageParam: 1,
    getNextPageParam: (last, all) => {
      if (last.length < PAGE_SIZE) return undefined;
      if (total != null && all.reduce((n, p) => n + p.length, 0) >= total) return undefined;
      return all.length + 1;
    },
    enabled: !!podcast,
    staleTime: 30 * 60_000,
  });
  const episodes = useMemo(() => {
    const seen = new Set<string>();
    return (eps.data?.pages ?? []).flat().filter((e) => !seen.has(e.song.id) && (seen.add(e.song.id), true));
  }, [eps.data]);
  const songs = useMemo(() => episodes.map((e) => e.song), [episodes]);

  const canonicalPath = podcast ? podcastPath(podcast) : undefined;
  usePageMeta({
    title: podcast ? `${podcast.name} — Podcast` : undefined,
    description: podcast ? (podcast.description ?? `Listen to ${podcast.name} free on VinaX.`).slice(0, 160) : undefined,
    image: podcast ? bestImage(podcast.images, 500) : undefined,
    type: 'website',
    canonicalPath,
  });

  if (show.isLoading) return <div className="max-w-screen-xl mx-auto"><HeaderSkeleton /><ListSkeleton /></div>;
  if (show.isError || !podcast) return <ErrorState title="Couldn’t load this podcast" retry={() => void show.refetch()} />;

  const art = bestImage(podcast.images, 500);
  const seasons = [...podcast.seasons].filter((s) => s.number != null).sort((a, b) => (a.number ?? 0) - (b.number ?? 0));

  return (
    <div className="vx-entity">
      <EntityHeader
        kind="Podcast"
        title={podcast.name}
        titleText={podcast.name}
        artUrl={art}
        art={<img src={art} onError={(e) => ((e.target as HTMLImageElement).src = FALLBACK_ART)} alt="" data-deter-context />}
        description={podcast.description ?? undefined}
        meta={
          <EntityMeta
            items={[
              podcast.hosts.length
                ? podcast.hosts.slice(0, 3).map((h, i) => (
                    <span key={h.id || h.name}>
                      {i > 0 && ', '}
                      {h.id ? <Link to={artistPath(h)}>{h.name}</Link> : h.name}
                    </span>
                  ))
                : null,
              podcast.followerCount ? `${formatCount(podcast.followerCount)} followers` : null,
              podcast.language && languageLabel(podcast.language),
              seasons.length > 1 ? `${seasons.length} seasons` : null,
              total ? `${total} episode${total === 1 ? '' : 's'}` : null,
            ]}
          />
        }
        actions={
          <>
            <PlayFab size="lg" label="Play all" disabled={!songs.length} onClick={() => usePlayerStore.getState().playQueue(songs, 0)} />
            <EntityAction label="Share" onClick={() => void shareLink(podcastPath(podcast), podcast.name)}><ShareIcon /></EntityAction>
            <EntityMenu items={[songs.length > 0 && { label: 'Add to queue', onSelect: () => usePlayerStore.getState().enqueueAll(songs) }]} />
          </>
        }
      />

      {seasons.length > 1 && (
        <div className="vx-season-rail" role="group" aria-label="Season">
          {seasons.map((s) => (
            <Chip key={s.id || s.number} active={s.number === season} onClick={() => setPicked(s.number)}>
              {s.name || `Season ${s.number}`}
            </Chip>
          ))}
        </div>
      )}

      {eps.isPending ? (
        <ListSkeleton rows={6} />
      ) : !episodes.length && eps.isError ? (
        <InlineError label="the episodes" retry={() => void eps.refetch()} />
      ) : !episodes.length ? (
        <EmptyState icon={<MicIcon className="w-7 h-7" />} title="No episodes yet" message="This season has no episodes we can play right now." />
      ) : (
        <>
          <div className="vx-tracklist vx-episodes" aria-label="Episodes">
            {episodes.map((ep, i) => (
              <EpisodeRow key={ep.song.id} ep={ep} list={episodes} index={i} />
            ))}
          </div>
          {eps.isFetchNextPageError ? (
            <div className="mt-5"><InlineError label="more episodes" retry={() => void eps.fetchNextPage()} /></div>
          ) : (
            eps.hasNextPage && (
              <div className="vx-episodes-more">
                <Button variant="secondary" busy={eps.isFetchingNextPage} onClick={() => void eps.fetchNextPage()} className="px-6 min-h-[44px] rounded-full">
                  {eps.isFetchingNextPage ? 'Loading…' : 'Load more episodes'}
                </Button>
              </div>
            )
          )}
        </>
      )}
    </div>
  );
}

/**
 * 1.3 — one podcast: the show's header, a season picker when it has more
 * than one, and its episodes a page at a time. Episodes play like songs
 * (episodeToSong); tapping one queues the episodes listed from there.
 */
export default function PodcastPage() {
  const { id: rawId } = useParams();
  const id = extractId(rawId);
  if (!id) return <ErrorState title="Podcast not found" message="This link doesn’t point to a podcast." />;
  // Keyed by id: a new show starts on its own latest season.
  return <PodcastView key={id} id={id} />;
}
