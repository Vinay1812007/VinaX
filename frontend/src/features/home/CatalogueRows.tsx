import { useQuery } from '@tanstack/react-query';
import { Shelf } from '@/components/Shelf';
import { MediaCard } from '@/components/MediaCard';
import { ShelfSkeleton } from '@/components/Skeletons';
import { getPodcasts, searchPlaylists, type PodcastSummary } from '@/services/api';
import { requireAccount } from '@/services/auth/gate';
import { playArtist, playPlaylist } from '@/features/player/playEntity';
import { playArtistStation, playFeaturedStation, useRadioStations } from '@/features/radio/stations';
import { podcastPath } from '@/features/podcasts/paths';
import { useRegion } from '@/features/location/useRegion';
import { toast } from '@/store/toastStore';
import { languageLabel } from '@/constants/languages';
import { artistPath, playlistPath } from '@/utils/slug';
import { bestImage } from '@/utils/images';
import { letterAvatar } from '@/utils/avatar';
import type { Playlist, Song } from '@/types';
import { playlistSubtitle, usePinnedFeedLangs, useCatalogueCharts, useFeaturedPlaylists, useTrendingPlaylists } from './useCatalogFeeds';
import { useTrendingArtists } from './useTrendingShelves';
import { useShelfDedupe } from './shelfLedger';
import { SongShelf, useShelfLens } from './blocks/shared';

/**
 * JioSaavn-style catalogue rows for Home (signed in and signed out): Trending
 * now, chart cards, editorial picks, Best of 90s, radio and artist stations,
 * trending podcasts and "What's hot in {city}". Every row is optional: it
 * shows nothing while it loads (except Trending now) and hides quietly when
 * the catalogue has nothing or the feed route is down.
 */

const STALE = 60 * 60_000;

/** The ledger slot of the opening Trending now row: first, so later shelves thin its songs out. */
export const TRENDING_NOW_BLOCK = 'trending-now';

export function PlaylistRow({ title, playlists, explanation, seeAllTo }: { title: string; playlists: Playlist[] | undefined; explanation?: string; seeAllTo?: string }) {
  if (!playlists?.length) return null;
  return (
    <Shelf title={title} explanation={explanation} seeAllTo={seeAllTo}>
      {playlists.map((p) => (
        <MediaCard key={p.id} to={playlistPath(p)} image={bestImage(p.images)} images={p.images} title={p.title} subtitle={playlistSubtitle(p)} onPlay={() => void playPlaylist(p.id, p.title)} />
      ))}
    </Shelf>
  );
}

/** The opening row: what is trending in the listener's languages right now. */
export function TrendingNowRow({ songs, loading }: { songs: Song[] | undefined; loading: boolean }) {
  const dedupe = useShelfDedupe(TRENDING_NOW_BLOCK);
  const lens = useShelfLens();
  if (loading && !songs?.length) return <ShelfSkeleton />;
  return <SongShelf title="Trending now" songs={dedupe(lens(songs, 'discovery')).slice(0, 16)} seeAllTo="/trending" />;
}

/** The catalogue's chart playlists (Top 50s, Trending Today…) as playable cards; null when there are none. */
export function ChartCardsRow() {
  const charts = useCatalogueCharts();
  if (charts.isError || !charts.data?.length) return null;
  return <PlaylistRow title="Top charts" playlists={charts.data} seeAllTo="/charts" />;
}

/** Hand-picked playlists: the catalogue's featured (editorial) list, its trending playlists and a decade row. */
export function EditorialRows() {
  const featured = useFeaturedPlaylists();
  const trending = useTrendingPlaylists();
  const langs = usePinnedFeedLangs();
  const primary = langs[0] ?? 'hindi';
  const nineties = useQuery<Playlist[]>({
    queryKey: ['home-best-of-90s', primary],
    queryFn: async ({ signal }) => {
      const list = await searchPlaylists(`best of 90s ${primary}`, 12, { signal });
      return list.filter((p) => /90/.test(p.title));
    },
    staleTime: STALE,
    retry: false,
  });
  return (
    <>
      {!featured.isError && <PlaylistRow title="Editorial picks" explanation="Playlists the catalogue's editors put together" playlists={featured.data} />}
      {!trending.isError && <PlaylistRow title="Fresh hits" playlists={trending.data} />}
      {!nineties.isError && <PlaylistRow title={`Best of 90s · ${languageLabel(primary)}`} playlists={nineties.data} />}
    </>
  );
}

/** Starts a station, asking a signed-out visitor to sign in first (before any catalogue call). */
function startStation(label: string, open: () => Promise<unknown>, fallback?: () => Promise<unknown>): void {
  const run = () => {
    toast(`Starting ${label}…`);
    open().catch(async () => {
      if (fallback) {
        try {
          await fallback();
          return;
        } catch {
          /* fall through to the message */
        }
      }
      toast(`Couldn't start ${label} right now. Try again shortly.`);
    });
  };
  if (requireAccount('listen', run)) run();
}

/** Featured radio stations in the listener's languages. */
export function RadioStationsRow() {
  const stations = useRadioStations();
  if (stations.isError || !stations.data?.length) return null;
  return (
    <Shelf title="Radio stations" seeAllTo="/radio">
      {stations.data.slice(0, 16).map((s) => (
        <MediaCard key={`${s.language}:${s.name}`} to="/radio" image={bestImage(s.images)} images={s.images} title={s.name} subtitle={`${languageLabel(s.language)} radio`} round
          onPlay={() => startStation(s.name, () => playFeaturedStation(s))} />
      ))}
    </Shelf>
  );
}

/** Endless radio from the artists trending in the listener's languages. */
export function ArtistStationsRow() {
  const artists = useTrendingArtists();
  const list = (artists.data ?? []).filter((a) => a.id);
  if (list.length < 3) return null;
  return (
    <Shelf title="Recommended artist stations" seeAllTo="/radio">
      {list.map((a) => (
        <MediaCard key={a.id} to={artistPath(a)} image={a.image ?? letterAvatar(a.name)} title={`${a.name} radio`} subtitle="Artist station" round
          onPlay={() => startStation(`${a.name} radio`, () => playArtistStation(a.id), () => playArtist(a.id, a.name))} />
      ))}
    </Shelf>
  );
}

/** The catalogue's trending shows. */
export function PodcastsRow() {
  const podcasts = useQuery<PodcastSummary[]>({
    queryKey: ['home-podcasts'],
    queryFn: ({ signal }) => getPodcasts(1, 16, { signal }),
    staleTime: STALE,
    retry: false,
  });
  if (podcasts.isError || !podcasts.data?.length) return null;
  return (
    <Shelf title="Trending podcasts" seeAllTo="/podcasts">
      {podcasts.data.map((p) => (
        <MediaCard key={p.id} to={podcastPath(p)} image={bestImage(p.images)} images={p.images} title={p.name} subtitle={p.season ? `Podcast · Season ${p.season}` : 'Podcast'} />
      ))}
    </Shelf>
  );
}

/** The playlists named for a city ("What's Hot In Hyderabad"), title-matched so a near miss never shows. */
export function cityPlaylists(list: Playlist[], city: string): Playlist[] {
  const c = city.trim().toLowerCase();
  if (!c) return [];
  return list.filter((p) => {
    const t = p.title.toLowerCase();
    return t.includes(c) && /\bhot\b|\btop\b|\btrending\b/.test(t);
  });
}

/** "What's hot in {city}" — only when the listener's (approximate) city is known and the catalogue has its playlist. */
export function CityHotRow() {
  const region = useRegion();
  const city = region?.city?.trim() ?? '';
  const hot = useQuery<Playlist[]>({
    queryKey: ['home-city-hot', city.toLowerCase()],
    queryFn: async ({ signal }) => cityPlaylists(await searchPlaylists(`what's hot in ${city}`, 10, { signal }), city),
    enabled: city.length > 1,
    staleTime: STALE,
    retry: false,
  });
  if (!city || hot.isError || !hot.data?.length) return null;
  return <PlaylistRow title={`What's hot in ${city}`} playlists={hot.data} />;
}
