import { Link } from 'react-router-dom';
import { usePageMeta } from '@/hooks/usePageMeta';
import { useJsonLd } from '@/hooks/useSeo';
import { SITE_ORIGIN } from '@/utils/schema';
import { songPath } from '@/utils/slug';
import { flattenSongPages, useInfiniteSongs } from '@/features/search/useInfiniteSongs';
import { InfiniteSentinel } from '@/components/InfiniteSentinel';
import { usePlayerStore } from '@/store/playerStore';
import { SongRow } from '@/components/SongRow';
import { ListSkeleton } from '@/components/Skeletons';
import { EmptyState, ErrorState } from '@/components/States';
import { HUB_LANGUAGES, languageLabel } from '@/constants/languages';
import type { MoodHub } from '@/constants/hubs';
import { SectionHeader } from '@/components/SectionHeader';
import { ChevronRightIcon, MusicIcon, ShuffleIcon } from '@/components/Icons';
import { EntityAction, EntityHeader, EntityMeta, PlayFab, songsLabel } from '@/components/EntityHeader';
import { HubCover } from '@/features/discover/HubCover';
import { HUB_TONE, HubMoodTiles } from '@/features/discover/HubMoodTiles';
import { shuffledSongs } from '@/features/search/workspace';
import '@/styles/pages/browse.css';
import { AdSlot } from '@/components/AdSlot';

/**
 * Mood × language landing page (/telugu-romantic-songs …): a real, playable
 * page for the exact queries people type into Google — 72 of them, all
 * sourced live from the catalog and edge-rendered for crawlers (see
 * functions/_lib/render.ts renderHub).
 */
export default function MoodHubPage({ language, mood }: { language: string; mood: MoodHub }) {
  const label = languageLabel(language);
  const q = useInfiniteSongs(`${label} ${mood.query}`);
  const songs = flattenSongPages(q.data?.pages);
  const playQueue = usePlayerStore((s) => s.playQueue);
  const path = `/${language}-${mood.slug}-songs`;
  const [tone, Icon] = HUB_TONE[mood.slug] ?? [1, MusicIcon];
  const title = `${label} ${mood.label.toLowerCase()} songs`;

  usePageMeta({
    title: `${label} ${mood.label} Songs — Stream Free`,
    description: `The best ${label} ${mood.label.toLowerCase()} songs — ${mood.blurb}. Stream free on VinaX, no login, tuned to you.`,
    canonicalPath: path,
  });
  useJsonLd(
    songs.length > 0 && {
      '@context': 'https://schema.org',
      '@type': 'ItemList',
      name: `${label} ${mood.label} Songs`,
      numberOfItems: Math.min(songs.length, 25),
      itemListElement: songs.slice(0, 25).map((s, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        url: `${SITE_ORIGIN}${songPath(s)}`,
      })),
    },
  );

  return (
    <div className="vx-browse vx-browse-page max-w-screen-2xl mx-auto">
      <Link to={`/${language}-songs`} className="bx-crumb">
        <ChevronRightIcon /> {label} songs
      </Link>
      <div className={`vx-tone-${tone}`}>
        <EntityHeader
          kind="Mood"
          title={title}
          titleText={title}
          tone="var(--tone)"
          art={<HubCover songs={songs} icon={<Icon />} />}
          description={<span className="bx-cap">{mood.blurb}.</span>}
          meta={<EntityMeta items={[label, songs.length > 0 && songsLabel(songs.length)]} />}
          actions={
            songs.length > 0 && (
              <>
                <PlayFab label="Play all" onClick={() => playQueue(songs, 0)} />
                <EntityAction label="Shuffle" onClick={() => playQueue(shuffledSongs(songs), 0)}>
                  <ShuffleIcon />
                </EntityAction>
              </>
            )
          }
        />
      </div>

      <section className="vx-section">
        {q.isLoading && <ListSkeleton />}
        <div className="vx-track-list">
          {songs.map((song, i) => (
            <SongRow key={song.id} song={song} songs={songs} index={i} />
          ))}
        </div>
        {/* The old copy said "Pull to refresh" on a page with no pull-to-refresh,
            and did not tell a failure from an empty result. */}
        {q.isError && songs.length === 0 && <ErrorState retry={() => void q.refetch()} />}
        {!q.isLoading && !q.isError && songs.length === 0 && (
          <EmptyState
            title="Nothing here right now"
            message={`No ${label} ${mood.label.toLowerCase()} songs surfaced from the catalog just now.`}
            action={
              <button type="button" onClick={() => void q.refetch()} className="btn-secondary min-h-touch">
                Try again
              </button>
            }
          />
        )}
        <InfiniteSentinel
          onVisible={() => q.hasNextPage && !q.isFetchingNextPage && q.fetchNextPage()}
          disabled={!q.hasNextPage}
          loading={q.isFetchingNextPage}
        />
      </section>

      <section className="vx-section" aria-label={`More ${label} moods`}>
        <SectionHeader title={`More ${label} moods`} />
        <HubMoodTiles language={language} exclude={mood.slug} />
      </section>

      <section className="vx-section" aria-label={`${mood.label} songs in other languages`}>
        <SectionHeader title="In other languages" explanation={`${mood.label} songs in every hub language`} />
        <div className="vx-chip-row">
          {HUB_LANGUAGES.filter((l) => l !== language).slice(0, 8).map((l) => (
            <Link key={l} to={`/${l}-${mood.slug}-songs`} className="vx-link-chip">
              {languageLabel(l)} {mood.label.toLowerCase()} songs
            </Link>
          ))}
        </div>
      </section>
      <AdSlot />
    </div>
  );
}
