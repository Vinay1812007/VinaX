import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Shelf } from '@/components/Shelf';
import { SectionHeader } from '@/components/SectionHeader';
import { MediaCard } from '@/components/MediaCard';
import { CardGridSkeleton, ShelfSkeleton } from '@/components/Skeletons';
import { InfiniteSentinel } from '@/components/InfiniteSentinel';
import { PlayIcon } from '@/components/Icons';
import { usePlayerStore } from '@/store/playerStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useLibraryStore } from '@/store/libraryStore';
import { useHistoryStore } from '@/store/historyStore';
import { useRegion } from '@/features/location/useRegion';
import { flattenSongPages } from '@/features/search/useInfiniteSongs';
import { playArtist } from '@/features/player/playEntity';
import { RadioGlyph } from '@/features/radio/RadioGlyph';
import { useWeeklyMix } from '@/features/weekly/useWeeklyMix';
import { buildUserRecommendationProfile } from '@/services/recommendation/profiles';
import { loadProfile } from '@/services/personalization/storage';
import { topLanguages } from '@/services/personalization/profile';
import { languageLabel } from '@/constants/languages';
import { albumPath, artistPath, songPath } from '@/utils/slug';
import { letterAvatar } from '@/utils/avatar';
import { FALLBACK_ART, artSrcSet, bestImage } from '@/utils/images';
import { dayPartLabel } from '@/utils/time';
import { useContinueListening, useTimeOfDayShelf } from '../useHomeShelves';
import { useDailyMix } from '../useDailyMix';
import { useMostListened, useOnRepeat } from '../usePersonalShelves';
import { useTrendingAlbums, useTrendingArtists } from '../useTrendingShelves';
import { moodRotationOfTheDay, useMoodShelf } from '../useMoodShelves';
import { GENRE_SHELVES, useGenreShelf } from '../useGenreShelves';
import { rankGenreTiles, topGenreShelves } from '../genreAffinity';
import { useSeasonalShelf } from '../useSeasonalShelf';
import { useUnlimitedFeed } from '../useUnlimitedFeed';
import { useShelfDedupe } from '../shelfLedger';
import { SongShelf, useShelfLens } from './shared';

/** The listener's genre (and language) affinity, read once when a block mounts (8.2.0). */
export function readTaste(): { genres: Record<string, number>; languages: Record<string, number> } {
  const profile = loadProfile();
  const user = buildUserRecommendationProfile(profile, useLibraryStore.getState().favorites, useHistoryStore.getState().entries);
  return { genres: user.genres, languages: Object.fromEntries(Object.entries(profile.languages).map(([k, v]) => [k, v.score])) };
}

/** Shortcuts into the listener's own collections: one quiet row of small tiles. AI Radio is always first. */
export function QuickBlock() {
  const navigate = useNavigate();
  const playQueue = usePlayerStore((s) => s.playQueue);
  const continueListening = useContinueListening();
  const favorites = useLibraryStore((s) => s.favorites);
  const onRepeat = useOnRepeat();
  const daily = useDailyMix();
  const weekly = useWeeklyMix();
  const mostListened = useMostListened();
  const tiles = [
    { label: 'AI Radio', image: '', go: () => navigate('/radio') },
    continueListening.length && { label: 'Continue listening', image: bestImage(continueListening[0].images, 120), go: () => playQueue(continueListening, 0) },
    favorites.length && { label: 'Liked songs', image: bestImage(favorites[0].images, 120), go: () => navigate('/favorites') },
    onRepeat.length && { label: 'On repeat', image: bestImage(onRepeat[0].images, 120), go: () => playQueue(onRepeat, 0) },
    (daily.data?.length ?? 0) > 0 && { label: 'VinaX Daily', image: bestImage(daily.data![0].images, 120), go: () => playQueue(daily.data!, 0) },
    (weekly.data?.length ?? 0) > 0 && { label: 'For you this week', image: bestImage(weekly.data![0].images, 120), go: () => navigate('/weekly') },
    mostListened.length && { label: 'Most listened', image: bestImage(mostListened[0].images, 120), go: () => navigate('/history') },
  ].filter((t): t is { label: string; image: string; go: () => void } => !!t).slice(0, 7);
  return (
    <div className="vxh-shortcuts" role="group" aria-label="Shortcuts">
      {tiles.map((t) => (
        <button key={t.label} type="button" onClick={t.go} className="vxh-shortcut">
          {t.image
            ? <img src={t.image} onError={(e) => ((e.target as HTMLImageElement).src = FALLBACK_ART)} alt="" width={44} height={44} loading="lazy" decoding="async" />
            : <span className="vxh-shortcut-glyph" aria-hidden><RadioGlyph /></span>}
          <span className="vxh-shortcut-label">{t.label}</span>
        </button>
      ))}
    </div>
  );
}

/** Top 50 Global / Top 50 in your country / Viral 50 — tiles into /charts. */
export function ChartsBlock() {
  const region = useRegion();
  const tiles = [
    { kicker: 'Top 50', title: 'Global', tone: 5 },
    { kicker: 'Top 50', title: region?.regionLabel ?? region?.country ?? 'Your country', tone: 3 },
    { kicker: 'Viral 50', title: 'Right now', tone: 2 },
  ];
  return (
    <section aria-label="Charts" className="vxh-section">
      <SectionHeader title="Charts" seeAllTo="/charts" />
      <div className="vxh-cat-grid is-rail-phone">
        {tiles.map((t) => (
          <Link key={`${t.kicker}-${t.title}`} to="/charts" className={`vxh-cat tone-${t.tone}`}>
            <span className="vxh-cat-kicker">{t.kicker}</span>
            <span className="vxh-cat-title">{t.title}</span>
            <span className="vxh-cat-shape" aria-hidden />
          </Link>
        ))}
      </div>
    </section>
  );
}

/** A season or event shelf, only while one matches "now". */
export function SeasonalBlock() {
  const dedupe = useShelfDedupe('seasonal');
  const lens = useShelfLens();
  const seasonal = useSeasonalShelf();
  if (!seasonal.season) return null;
  return <SongShelf title={seasonal.season.title} songs={dedupe(lens(seasonal.data, 'discovery'))} />;
}

/** Six mood tiles; a tile plays its songs, which then sit in the queue to pick from. */
export function MoodsBlock() {
  const dedupe = useShelfDedupe('moods');
  const lens = useShelfLens();
  const playQueue = usePlayerStore((s) => s.playQueue);
  const primaryLang = useSettingsStore((s) => s.pinnedLanguages[0] ?? 'hindi');
  const moods = moodRotationOfTheDay(6);
  // Six mood queries at fixed positions (rules of hooks); the rotation is stable within a UTC day.
  const moodA = useMoodShelf(moods[0].query, primaryLang, 8);
  const moodB = useMoodShelf(moods[1].query, primaryLang, 8);
  const moodC = useMoodShelf(moods[2].query, primaryLang, 8);
  const moodD = useMoodShelf(moods[3].query, primaryLang, 8);
  const moodE = useMoodShelf(moods[4].query, primaryLang, 8);
  const moodF = useMoodShelf(moods[5].query, primaryLang, 8);
  const queries = [moodA, moodB, moodC, moodD, moodE, moodF];
  if (!queries.some((q) => q.data && q.data.length > 0)) return null;
  return (
    <section className="vxh-section" aria-label="Mood playlists">
      <SectionHeader title="Mood playlists" seeAllTo="/moods" />
      <div className="vxh-cat-grid is-six">
        {moods.map((mood, idx) => {
          const songs = dedupe(lens(queries[idx].data, 'discovery'));
          if (!songs.length) return null;
          const art = bestImage(songs[0].images, 150);
          return (
            <button key={mood.id} type="button" onClick={() => playQueue(songs, 0)} aria-label={`Play ${mood.title}, ${songs.length} songs`} className={`vxh-cat tone-${(idx % 8) + 1}`}>
              <span className="vxh-cat-title">{mood.title}</span>
              {art && (
                <img className="vxh-cat-art" src={art} srcSet={artSrcSet(songs[0].images, 150)} sizes="76px" width={76} height={76} alt="" loading="lazy" decoding="async"
                  onError={(e) => { const t = e.target as HTMLImageElement; t.srcset = ''; t.src = FALLBACK_ART; }} />
              )}
              <span className="vxh-cat-play" aria-hidden><PlayIcon /></span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

/** Your top genres (8.2.0) and the genre collections, the ones you lean towards first. */
export function GenresBlock() {
  const dedupe = useShelfDedupe('genres');
  const lens = useShelfLens();
  const pinnedLang = useSettingsStore((s) => s.pinnedLanguages[0] ?? null);
  // Read once per mount: shelf titles never change under a scrolling listener.
  const [taste] = useState(readTaste);
  const language = pinnedLang ?? topLanguages(loadProfile(), 1)[0]?.id ?? null;
  const picks = useMemo(() => topGenreShelves(taste.genres, language, 2), [taste, language]);
  const tiles = useMemo(() => rankGenreTiles(GENRE_SHELVES, taste.genres, taste.languages), [taste]);
  const first = useGenreShelf(picks[0]?.query ?? '');
  const second = useGenreShelf(picks[1]?.query ?? '');
  const genreShelves = [first, second];
  return (
    <>
      {picks.map((pick, i) => {
        const q = genreShelves[i];
        if (q.isLoading) return <ShelfSkeleton key={pick.id} />;
        return (
          <SongShelf key={pick.id} title={`Your top genres · ${pick.label}`} explanation={language ? `${languageLabel(language)} ${pick.label.toLowerCase()} songs, from what you like and play` : 'From what you like and play'}
            songs={dedupe(lens(q.data, 'personal'))} seeAllTo={`/search/${encodeURIComponent(pick.query)}`} />
        );
      })}
      <Shelf title="Genres">
        {tiles.map((g, i) => (
          <Link key={g.id} to={`/search/${encodeURIComponent(g.query)}`} className={`vxh-cat is-rail tone-${((i * 3) % 8) + 1}`}>
            <span className="vxh-cat-title">{g.label}</span>
            <span className="vxh-cat-shape" aria-hidden />
          </Link>
        ))}
      </Shelf>
    </>
  );
}

export function ArtistsBlock() {
  const trendingArtists = useTrendingArtists();
  if (!trendingArtists.data || trendingArtists.data.length < 3) return null;
  return (
    <Shelf title="Trending artists">
      {trendingArtists.data.map((a) => (
        <MediaCard key={a.id || a.name} to={a.id ? artistPath(a) : `/search/${encodeURIComponent(a.name)}`} image={a.image ?? letterAvatar(a.name)} title={a.name} subtitle="Artist" round
          onPlay={a.id ? () => void playArtist(a.id, a.name) : undefined} />
      ))}
    </Shelf>
  );
}

export function AlbumsBlock() {
  const trendingAlbums = useTrendingAlbums();
  if (!trendingAlbums.data?.length) return null;
  return (
    <Shelf title="Trending albums">
      {trendingAlbums.data.map((album) => (
        <MediaCard key={album.id} to={albumPath(album)} image={bestImage(album.images)} images={album.images} title={album.title} subtitle={album.subtitle} />
      ))}
    </Shelf>
  );
}

export function DayPicksBlock() {
  const dedupe = useShelfDedupe('daypicks');
  const lens = useShelfLens();
  const timeShelf = useTimeOfDayShelf();
  if (timeShelf.isLoading) return <ShelfSkeleton />;
  return <SongShelf title={timeShelf.title} explanation={`Based on your ${dayPartLabel()} sessions`} songs={dedupe(lens(timeShelf.data, 'discovery'))} />;
}

export function LovedBlock() {
  const dedupe = useShelfDedupe('loved');
  const lens = useShelfLens();
  const favorites = useLibraryStore((s) => s.favorites);
  return <SongShelf title="Recently liked" songs={dedupe(lens(favorites.slice(0, 12), 'resume'))} seeAllTo="/favorites" />;
}

/** The endless feed: keep scrolling to load more songs. */
export function FeedBlock() {
  const playQueue = usePlayerStore((s) => s.playQueue);
  const lens = useShelfLens();
  const feed = useUnlimitedFeed();
  const feedSongs = lens(flattenSongPages(feed.data?.pages), 'discovery');
  return (
    <section className="vxh-section" aria-label="More for you">
      <SectionHeader title="More for you" />
      {feed.isLoading && <CardGridSkeleton />}
      <div className="vxh-feed-grid">
        {feedSongs.map((song, i) => (
          <MediaCard key={song.id} to={songPath(song)} image={bestImage(song.images)} images={song.images} title={song.title} subtitle={song.subtitle} fluid onPlay={() => playQueue(feedSongs, i)} />
        ))}
      </div>
      {!feed.isLoading && !feed.isError && (
        <InfiniteSentinel onVisible={() => feed.hasNextPage && !feed.isFetchingNextPage && feed.fetchNextPage()} disabled={!feed.hasNextPage} loading={feed.isFetchingNextPage} />
      )}
      {feed.isError && feedSongs.length === 0 && <p className="vxh-note">The feed is unavailable right now — try again shortly.</p>}
    </section>
  );
}
