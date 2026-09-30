import { HomeOpening } from '@/features/home/HomeOpening';
import { TopBarActions } from '@/components/TopBar';
import { useDiscoveryStore } from '@/store/discoveryStore';
import { invalidateRecommendationCache } from '@/services/recommendation/engine';
import { recordServed, songKey } from '@/services/recommendation/songIdentity';
import { ListeningGuide } from '@/features/home/ListeningGuide';
import { HomeStudio } from '@/features/home/HomeStudio';
import { HOME_DESIGN_KEY, loadHomeDesign, validateHomeDesign, type HomeDesign, type HomeSection } from '@/services/recommendation/homeDesign';
import { composeHomeLayout } from '@/features/home/homeLayout';
import { orderHomeBlocks, sessionHomeOrder } from '@/features/home/homeOrder';
import { attributeSong, installHomeOutcomeTracking, loadHomeSignals, noteBlockTap } from '@/features/home/homeSignals';
import { blockForTap } from '@/features/home/homeTaps';
import { genreAffinityStrength, rankGenreTiles, topGenreShelves } from '@/features/home/genreAffinity';
import { YourPlaylistsShelf } from '@/features/home/YourPlaylists';
import { RadioGlyph } from '@/features/radio/RadioGlyph';
import { buildUserRecommendationProfile } from '@/services/recommendation/profiles';
import { resetShelfLedger, setShelfBlockOrder, useShelfDedupe } from '@/features/home/shelfLedger';
import { listeningTotal } from '@/features/stats/listening';
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import '@/styles/pages/home.css';
import type { ReactNode } from 'react';
import { useClientConfig } from '@/features/home/useAppConfig';
import { PromoBanner } from '@/components/PromoBanner';
import { useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { PullToRefresh } from '@/components/PullToRefresh';
import { artistPath, songPath } from '@/utils/slug';
import { usePageTitle } from '@/hooks/usePageTitle';
import { Shelf } from '@/components/Shelf';
import { SectionHeader } from '@/components/SectionHeader';
import { MediaCard } from '@/components/MediaCard';
import { ShelfSkeleton, CardGridSkeleton } from '@/components/Skeletons';
import { InfiniteSentinel } from '@/components/InfiniteSentinel';
import { flattenSongPages } from '@/features/search/useInfiniteSongs';
import { useUnlimitedFeed } from '@/features/home/useUnlimitedFeed';
import { resetShelfDeduper } from '@/features/home/dedupeShelves';
import { Chip } from '@/components/Chip';
import { GetAppBanner } from '@/components/GetAppBanner';
import { PushPromptCard } from '@/components/PushPromptCard';
import { NotificationSheet } from '@/components/NotificationSheet';
import { DownloadCta } from '@/components/DownloadCta';
import { IconButton } from '@/components/IconButton';
import { BellIcon, MoonIcon, PlayIcon, SparkleIcon, SunIcon } from '@/components/Icons';
import { useHistoryStore } from '@/store/historyStore';
import { onThisDay } from '@/features/home/onThisDay';
import { localDateKey, pickDailyFavorite, useBecauseYouLiked } from '@/features/home/useBecauseYouLiked';
import { SongOfTheDayCard, StreakCard } from '@/features/home/DailyCards';
import { FestivalLookaheadCard } from '@/features/home/FestivalLookaheadCard';
import { getLocal } from '@/services/storage/local';
import { KEYS } from '@/constants/storage-keys';
import { toast } from '@/store/toastStore';
import {
  useContinueListening,
  useTimeOfDayShelf,
  useTrendingForLanguage,
  useTrendingNow,
  useNewReleases,
  usePopular,
} from '@/features/home/useHomeShelves';
import { useYourArtists } from '@/features/home/useYourArtists';
import { useSimilarArtists } from '@/features/home/useSimilarArtists';
import { useDailyMix } from '@/features/home/useDailyMix';
import { useWeeklyMix } from '@/features/weekly/useWeeklyMix';
import {
  useMostListened,
  useOnRepeat,
  useRepeatRewind,
  useRecentlyPlayedAlbums,
  useBecauseYouListenedTo,
} from '@/features/home/usePersonalShelves';
import { useFreshFinds, useHiddenGems, useTrendingNearYou } from '@/features/home/useDiscoveryShelves';
import { useTrendingAlbums, useTrendingArtists } from '@/features/home/useTrendingShelves';
import { useAiTrending } from '@/features/home/useAiTrending';
import { useAiHome } from '@/features/home/useAiHome';
import { useFeatureEnabled } from '@/features/home/useAppConfig';
import { moodRotationOfTheDay, useMoodShelf } from '@/features/home/useMoodShelves';
import { GENRE_SHELVES, useGenreShelf } from '@/features/home/useGenreShelves';
import { useSeasonalShelf } from '@/features/home/useSeasonalShelf';
import { useExperiment } from '@/features/experiments/useExperiment';
import { EXP_HOME_SHELF_ORDER, homeShelfOrder } from '@/features/experiments/homeShelfOrder';
import { albumPath } from '@/utils/slug';
import { playArtist } from '@/features/player/playEntity';
import { letterAvatar } from '@/utils/avatar';
import { useRecommendations } from '@/features/recommendations/useRecommendations';
import { useSettingsStore } from '@/store/settingsStore';
import { useLibraryStore } from '@/store/libraryStore';
import { usePlayerStore, useCurrentSong } from '@/store/playerStore';
import { useRegion } from '@/features/location/useRegion';
import { FALLBACK_ART, artSrcSet, bestImage } from '@/utils/images';
import { HUB_LANGUAGES, languageLabel } from '@/constants/languages';
import { dayPartLabel } from '@/utils/time';
import { getStreak } from '@/utils/streak';
import { personalMessage } from '@/features/home/personalMessage';
import { activeFestivalMusic } from '@/services/recommendation/festival';
import { loadProfile } from '@/services/personalization/storage';
import { topArtists, topLanguages } from '@/services/personalization/profile';
import { trendingSeed } from '@/constants/seeds';
import type { Song } from '@/types';
import { HomeAbout } from '@/features/home/HomeAbout';

/**
 * Mounts a home block only when it scrolls within ~800px of the viewport
 * (4.18.3 TBT pass). Until then it holds a fixed-height placeholder so the
 * page keeps scroll depth (without one, every collapsed block would sit
 * inside the observer margin at once and everything would mount together —
 * defeating the whole point). The swap happens ~a screen before the block
 * is visible, so users never see the placeholder and CLS stays 0. Falls
 * back to mounting immediately when IntersectionObserver is unavailable.
 */
function DeferredBlock({ render }: { render?: () => ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (on) return;
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') {
      setOn(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setOn(true);
      },
      { rootMargin: '800px 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [on]);
  if (on) return <>{render?.()}</>;
  return <div ref={ref} className="h-56" aria-hidden />;
}

function SongShelf({ title, explanation, songs, seeAllTo }: { title: string; explanation?: string; songs: Song[]; seeAllTo?: string }) {
  const playQueue = usePlayerStore((s) => s.playQueue);
  if (!songs.length) return null;
  return (
    <Shelf title={title} explanation={explanation} seeAllTo={seeAllTo} layout={songs.length <= 8 ? 'grid' : 'rail'}>
      {songs.map((song, i) => (
        <MediaCard
          key={song.id}
          to={songPath(song)}
          image={bestImage(song.images)} images={song.images}
          title={song.title}
          subtitle={song.subtitle}
          song={song}
          onPlay={() => playQueue(songs, i)}
        />
      ))}
    </Shelf>
  );
}

/**
 * Home blocks are self-contained components: every catalogue query a block
 * needs lives INSIDE it. Only blocks in the composed layout render at all
 * (an owner- or listener-hidden shelf never fetches), and blocks beyond the
 * first two mount through DeferredBlock as they scroll near, so an
 * unscrolled Home asks the catalogue for the hero plus two blocks — not for
 * every shelf on the page. Cross-shelf de-duplication runs through the
 * shared ledger (features/home/shelfLedger.ts) in display order.
 */
function QuickBlock() {
  const navigate = useNavigate();
  const playQueueFeed = usePlayerStore((s) => s.playQueue);
  const continueListening = useContinueListening();
  const favorites = useLibraryStore((s) => s.favorites);
  const onRepeat = useOnRepeat();
  const daily = useDailyMix();
  const weekly = useWeeklyMix();
  const mostListened = useMostListened();
  const quickTiles = [
    // 8.2.0 — AI Radio: always here, always first, so it is one tap from Home.
    { label: 'AI Radio', image: '', go: () => navigate('/radio') },
    continueListening.length && {
      label: 'Continue listening',
      image: bestImage(continueListening[0].images, 120),
      go: () => playQueueFeed(continueListening, 0),
    },
    favorites.length && {
      label: 'Liked songs',
      image: bestImage(favorites[0].images, 120),
      go: () => navigate('/favorites'),
    },
    onRepeat.length && {
      label: 'On repeat',
      image: bestImage(onRepeat[0].images, 120),
      go: () => playQueueFeed(onRepeat, 0),
    },
    (daily.data?.length ?? 0) > 0 && {
      label: 'VinaX Daily',
      image: bestImage(daily.data![0].images, 120),
      go: () => playQueueFeed(daily.data!, 0),
    },
    (weekly.data?.length ?? 0) > 0 && {
      label: 'For you this week',
      image: bestImage(weekly.data![0].images, 120),
      go: () => navigate('/weekly'),
    },
    mostListened.length && {
      label: 'Most listened',
      image: bestImage(mostListened[0].images, 120),
      go: () => navigate('/history'),
    },
  ].filter((t): t is { label: string; image: string; go: () => void } => !!t).slice(0, 7);
  // Shortcuts into your own collections: one quiet scrolling row of small tiles.
  return (
    <div className="vxh-shortcuts" role="group" aria-label="Shortcuts">
      {quickTiles.map((t) => (
        <button key={t.label} type="button" onClick={t.go} className="vxh-shortcut">
          {t.image ? (
            <img
              src={t.image}
              onError={(e) => ((e.target as HTMLImageElement).src = FALLBACK_ART)}
              alt=""
              width={48}
              height={48}
              loading="lazy"
              decoding="async"
            />
          ) : (
            <span className="vxh-shortcut-glyph" aria-hidden><RadioGlyph /></span>
          )}
          {t.label}
        </button>
      ))}
    </div>
  );
}

function PersonalBlock() {
  const dedupe = useShelfDedupe('personal');
  const historyEntries = useHistoryStore((s) => s.entries);
  const favorites = useLibraryStore((s) => s.favorites);
  const continueListening = useContinueListening();
  const memories = useMemo(() => onThisDay(historyEntries), [historyEntries]);
  const recentAlbums = useRecentlyPlayedAlbums();
  const weekly = useWeeklyMix();
  const mostListened = useMostListened();
  const onRepeat = useOnRepeat();
  const repeatRewind = useRepeatRewind();
  // Seed "Because you listened to …" from the top-played song by the user's
  // #1 artist — mostListened is already sorted by play count.
  const becauseSeed = mostListened[0];
  const because = useBecauseYouListenedTo(becauseSeed);
  // v5.17.0 — "Because you liked X": one favourite per day, catalog suggestions.
  const likedSeed = useMemo(() => pickDailyFavorite(favorites, localDateKey()), [favorites]);
  const becauseLiked = useBecauseYouLiked(likedSeed);
  const mixes = useRecommendations();
  const daily = useDailyMix();
  const yourArtists = useYourArtists();
  const similarArtists = useSimilarArtists();
  return (
    <>
      {/* v5.17.0 — streak + song of the day: compact cards, each hides itself when empty.
          v5.19.0 — plus a "Coming up" festival card when one is 1–3 days away. */}
      <div className="vxh-daily">
        <StreakCard entries={historyEntries} />
        <SongOfTheDayCard favorites={favorites} entries={historyEntries} />
        <FestivalLookaheadCard />
      </div>

      {/* 1. Continue Listening — pick up where you left off */}
      <SongShelf title="Continue listening" songs={dedupe(continueListening)} seeAllTo="/history" />

      {/* 8.2.0 — Your playlists: the ones you made and the ones you saved. Hidden when there are none. */}
      <YourPlaylistsShelf />

      {/* v5.12.0 — On this day: what you played on this date in earlier months/years */}
      {memories && (
        <SongShelf title="On this day" explanation={`You were playing these ${memories.label.toLowerCase()}`} songs={memories.songs} seeAllTo="/history" />
      )}

      {/* 3. Recently Played Albums — hydrated from local history */}
      {recentAlbums.isLoading ? (
        <ShelfSkeleton />
      ) : recentAlbums.data && recentAlbums.data.length > 0 ? (
        <SongShelf title="Recently played" songs={dedupe(recentAlbums.data)} seeAllTo="/history" />
      ) : null}

      {/* 4. For You This Week — existing weekly mix */}
      {weekly.isLoading ? (
        <ShelfSkeleton />
      ) : weekly.data && weekly.data.length > 0 ? (
        <SongShelf title="For you this week" explanation="Updates every Monday" songs={dedupe(weekly.data)} seeAllTo="/weekly" />
      ) : null}

      {/* 5. Most Listened Songs */}
      <SongShelf title="Most listened" songs={dedupe(mostListened)} seeAllTo="/history" />

      {/* 6. On Repeat */}
      <SongShelf title="On repeat" explanation="Played 3+ times in the last 14 days" songs={dedupe(onRepeat)} />

      {/* 7. Repeat Rewind */}
      <SongShelf title="Repeat rewind" explanation="Old favourites you haven't played lately" songs={dedupe(repeatRewind)} />

      {/* 8. Because You Listened To … */}
      {because.isLoading ? (
        <ShelfSkeleton />
      ) : because.data && because.data.length > 0 && becauseSeed ? (
        <SongShelf
          title={`Because you listened to ${becauseSeed.subtitle}`}
          songs={dedupe(because.data)}
        />
      ) : null}

      {/* v5.17.0 — 8b. Because you liked “X” — suggestions seeded by one favourite, rotating daily */}
      {likedSeed && becauseLiked.isLoading ? (
        <ShelfSkeleton />
      ) : likedSeed && becauseLiked.data && becauseLiked.data.length > 0 ? (
        <SongShelf
          title={`Because you liked “${likedSeed.title}”`}
          songs={dedupe(becauseLiked.data)}
          seeAllTo="/favorites"
        />
      ) : null}

      {/* 9. Recommendations mixes (existing) */}
      {mixes.isLoading && <ShelfSkeleton />}
      {mixes.data?.slice(0, 2).map((mix) => (
        <SongShelf key={mix.id} title={mix.title} explanation={mix.explanation} songs={dedupe(mix.songs)} seeAllTo="/made-for-you" />
      ))}

      {/* VinaX Daily — personalized daily mix */}
      {daily.isLoading ? (
        <ShelfSkeleton />
      ) : (
        <SongShelf title="VinaX Daily" explanation="A fresh mix for today" songs={dedupe(daily.data ?? [])} />
      )}

      {/* 10. Your Favorite Artists (existing Your Artists) */}
      {yourArtists.length >= 3 && (
        <Shelf title="Your favourite artists">
          {yourArtists.map((a) => (
            <MediaCard
              key={a.id || a.name}
              to={a.id ? artistPath(a) : `/search/${encodeURIComponent(a.name)}`}
              image={a.image ?? letterAvatar(a.name)}
              title={a.name}
              subtitle={`${a.plays} plays`}
              round
              onPlay={a.id ? () => void playArtist(a.id, a.name) : undefined}
            />
          ))}
        </Shelf>
      )}

      {/* 8.5.0 — Similar artists: the catalogue's own lists for your top artists, minus the ones you already play. */}
      {(similarArtists.data?.length ?? 0) >= 3 && (
        <Shelf title="Similar artists" explanation="Artists you haven’t played yet, like the ones you do">
          {similarArtists.data!.map((a) => (
            <MediaCard
              key={a.id}
              to={artistPath(a)}
              image={a.image || letterAvatar(a.name)}
              title={a.name}
              subtitle={`Like ${a.because}`}
              round
              onPlay={() => void playArtist(a.id, a.name)}
            />
          ))}
        </Shelf>
      )}
    </>
  );
}

/** v6.2.0 — "Designed for you": AI-titled shelves resolved against the catalogue. Renders nothing until they exist. */
function AiHomeBlock() {
  const dedupe = useShelfDedupe('aihome');
  const allowed = useFeatureEnabled('aiHome');
  const shelves = useAiHome(allowed);
  if (!allowed || !shelves.data?.length) {
    return shelves.isLoading && allowed ? <ShelfSkeleton /> : null;
  }
  return (
    <section aria-label="Designed for you" className="mb-2">
      <h2 className="vxh-band-title">Designed for you</h2>
      {shelves.data.map((shelf) => (
        <SongShelf key={shelf.title} title={shelf.title} explanation={shelf.description || shelf.reason} songs={dedupe(shelf.songs)} seeAllTo={`/search/${encodeURIComponent(shelf.query)}`} />
      ))}
    </section>
  );
}

function DiscoveryBlock() {
  const dedupe = useShelfDedupe('discovery');
  const region = useRegion();
  const pinned = useSettingsStore((s) => s.pinnedLanguages);
  const primaryLang = pinned[0] ?? 'hindi';
  // More generated shelves (4.16.0): a decade rewind in the primary language
  // and trending from the listener's SECOND pinned language. Hook order stays
  // static — the second-language query just goes unused when there isn't one.
  const secondLang = pinned[1] && pinned[1] !== primaryLang ? pinned[1] : null;
  const nearYou = useTrendingNearYou();
  const trendingNow = useAiTrending();
  const trending = useTrendingForLanguage(primaryLang);
  const newReleases = useNewReleases();
  const popular = usePopular();
  const freshFinds = useFreshFinds();
  const hiddenGems = useHiddenGems();
  const decadeRewind = useMoodShelf(`90s ${primaryLang} hits`, primaryLang, 12);
  const trendingSecond = useTrendingForLanguage(secondLang ?? primaryLang);
  return (
    <>
      {/* 11. Trending Near You */}
      {nearYou.isLoading ? (
        <ShelfSkeleton />
      ) : nearYou.data && nearYou.data.length > 0 ? (
        <SongShelf
          title={region?.country ? `Trending near you · ${region.regionLabel ?? region.country}` : 'Trending near you'}
          songs={dedupe(nearYou.data)}
        />
      ) : null}

      {/* 12. Popular picks for you — the catalogue's popular pool, ordered by taste (and by the AI when it is on). Public charts with real provenance live on the Charts page. */}
      {trendingNow.isLoading ? (
        <ShelfSkeleton />
      ) : trendingNow.songs.length > 0 ? (
        <SongShelf
          title="Popular picks for you"
          explanation={trendingNow.by === 'ai' ? 'Popular in the catalogue, put in your order by VinaX AI' : 'Popular in the catalogue, in the order your taste suggests'}
          songs={dedupe(trendingNow.songs)}
          seeAllTo="/charts"
        />
      ) : null}

      {/* Trending in your primary language */}
      {trending.isLoading ? (
        <ShelfSkeleton />
      ) : (
        <SongShelf
          title={`Trending · ${languageLabel(primaryLang)}`}
          songs={dedupe(trending.data ?? [])}
          seeAllTo={
            (HUB_LANGUAGES as readonly string[]).includes(primaryLang)
              ? `/${primaryLang}-songs`
              : `/search/${encodeURIComponent(trendingSeed(primaryLang))}`
          }
        />
      )}

      {/* 13. New Releases (existing) */}
      {newReleases.isLoading ? (
        <ShelfSkeleton />
      ) : newReleases.data && newReleases.data.length > 0 ? (
        <SongShelf title="New releases" songs={dedupe(newReleases.data)} />
      ) : null}

      {/* 14. Popular (existing) */}
      {popular.isLoading ? (
        <ShelfSkeleton />
      ) : popular.data && popular.data.length > 0 ? (
        <SongShelf title="Popular in your languages" songs={dedupe(popular.data)} seeAllTo="/charts" />
      ) : null}

      {/* 15. Fresh Finds */}
      {freshFinds.isLoading ? (
        <ShelfSkeleton />
      ) : freshFinds.data && freshFinds.data.length > 0 ? (
        <SongShelf title="Fresh finds" songs={dedupe(freshFinds.data)} />
      ) : null}

      {/* 16. Hidden Gems */}
      {hiddenGems.isLoading ? (
        <ShelfSkeleton />
      ) : hiddenGems.data && hiddenGems.data.length > 0 ? (
        <SongShelf title="Hidden gems" songs={dedupe(hiddenGems.data)} />
      ) : null}

      {/* 16b. Decade Rewind (4.16.0) — generated: 90s classics, primary language */}
      {decadeRewind.data && decadeRewind.data.length > 0 && (
        <SongShelf
          title={`90s ${languageLabel(primaryLang)} classics`}
          songs={dedupe(decadeRewind.data)}
        />
      )}

      {/* 16c. Second-language trending (4.16.0) — your other side */}
      {secondLang && trendingSecond.data && trendingSecond.data.length > 0 && (
        <SongShelf
          title={`Trending · ${languageLabel(secondLang)}`}
          songs={dedupe(trendingSecond.data)}
          seeAllTo={
            (HUB_LANGUAGES as readonly string[]).includes(secondLang)
              ? `/${secondLang}-songs`
              : `/search/${encodeURIComponent(trendingSeed(secondLang))}`
          }
        />
      )}
    </>
  );
}

function ChartsBlock() {
  const region = useRegion();
  const tiles = [
    { kicker: 'Top 50', title: 'Global', tone: 5 },
    { kicker: 'Top 50', title: region?.regionLabel ?? region?.country ?? 'Your country', tone: 3 },
    { kicker: 'Viral 50', title: 'Right now', tone: 2 },
  ];
  return (
    // 17. Top 50 Global / Top 50 Country / Viral 50 — category tiles into /charts
    <section aria-label="Charts" className="vxh-section">
      <SectionHeader title="Charts" />
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

function SeasonalBlock() {
  const dedupe = useShelfDedupe('seasonal');
  const seasonal = useSeasonalShelf();
  return (
      <>
      {/* 18. Seasonal shelf — only when a season/event matches "now" */}
      {seasonal.season && seasonal.data && seasonal.data.length > 0 && (
        <SongShelf title={seasonal.season.title} songs={dedupe(seasonal.data)} />
      )}
      </>
  );
}

function MoodsBlock() {
  const dedupe = useShelfDedupe('moods');
  const playQueueFeed = usePlayerStore((s) => s.playQueue);
  const primaryLang = useSettingsStore((s) => s.pinnedLanguages[0] ?? 'hindi');
  const moods = moodRotationOfTheDay(6);
  // Six mood queries at fixed positions so Rules of Hooks are respected. The
  // rotation is stable within a UTC day so hook order is stable.
  const moodA = useMoodShelf(moods[0].query, primaryLang, 8);
  const moodB = useMoodShelf(moods[1].query, primaryLang, 8);
  const moodC = useMoodShelf(moods[2].query, primaryLang, 8);
  const moodD = useMoodShelf(moods[3].query, primaryLang, 8);
  const moodE = useMoodShelf(moods[4].query, primaryLang, 8);
  const moodF = useMoodShelf(moods[5].query, primaryLang, 8);
  const moodQueries = [moodA, moodB, moodC, moodD, moodE, moodF];
  if (!moodQueries.some((q) => q.data && q.data.length > 0)) return null;
  return (
    // 19. Mood playlists — six colour tiles; a tile plays its eight songs, which
    // then sit in the queue to pick from.
    <section className="vxh-section" aria-label="Mood playlists">
      <SectionHeader title="Mood playlists" seeAllTo="/moods" />
      <div className="vxh-cat-grid is-six">
        {moods.map((mood, idx) => {
          const songs = dedupe(moodQueries[idx].data ?? []);
          if (!songs.length) return null;
          const art = bestImage(songs[0].images, 150);
          return (
            <button
              key={mood.id}
              type="button"
              onClick={() => playQueueFeed(songs, 0)}
              aria-label={`Play ${mood.title}, ${songs.length} songs`}
              className={`vxh-cat tone-${(idx % 8) + 1}`}
            >
              <span className="vxh-cat-title">{mood.title}</span>
              {art && (
                <img
                  className="vxh-cat-art"
                  src={art}
                  srcSet={artSrcSet(songs[0].images, 150)}
                  sizes="76px"
                  width={76}
                  height={76}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  onError={(e) => {
                    const t = e.target as HTMLImageElement;
                    t.srcset = '';
                    t.src = FALLBACK_ART;
                  }}
                />
              )}
              <span className="vxh-cat-play" aria-hidden><PlayIcon /></span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

/** 8.2.0 — the listener's genre (and language) affinity, read once when the block mounts. */
function readTaste(): { genres: Record<string, number>; languages: Record<string, number> } {
  const profile = loadProfile();
  const user = buildUserRecommendationProfile(profile, useLibraryStore.getState().favorites, useHistoryStore.getState().entries);
  return { genres: user.genres, languages: Object.fromEntries(Object.entries(profile.languages).map(([k, v]) => [k, v.score])) };
}

function GenresBlock() {
  const dedupe = useShelfDedupe('genres');
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
    {/* 8.2.0 — Your top genres: the one or two genres you lean towards, in your language. */}
    {picks.map((pick, i) => {
      const q = genreShelves[i];
      if (q.isLoading) return <ShelfSkeleton key={pick.id} />;
      return (
        <SongShelf
          key={pick.id}
          title={`Your top genres · ${pick.label}`}
          explanation={language ? `${languageLabel(language)} ${pick.label.toLowerCase()} songs, from what you like and play` : 'From what you like and play'}
          songs={dedupe(q.data ?? [])}
          seeAllTo={`/search/${encodeURIComponent(pick.query)}`}
        />
      );
    })}
    {/* 20. Genre collections — colour tiles on a rail, each a catalogue search; the genres you lean towards first */}
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

function ArtistsBlock() {
  const trendingArtists = useTrendingArtists();
  return (
      <>
      {/* 21. Trending Artists (round MediaCards) */}
      {trendingArtists.data && trendingArtists.data.length >= 3 && (
        <Shelf title="Trending artists">
          {trendingArtists.data.map((a) => (
            <MediaCard
              key={a.id || a.name}
              to={a.id ? artistPath(a) : `/search/${encodeURIComponent(a.name)}`}
              image={a.image ?? letterAvatar(a.name)}
              title={a.name}
              subtitle="Artist"
              round
              onPlay={a.id ? () => void playArtist(a.id, a.name) : undefined}
            />
          ))}
        </Shelf>
      )}
      </>
  );
}

function AlbumsBlock() {
  const trendingAlbums = useTrendingAlbums();
  return (
      <>
      {/* 22. Trending Albums */}
      {trendingAlbums.data && trendingAlbums.data.length > 0 && (
        <Shelf title="Trending albums">
          {trendingAlbums.data.map((album) => (
            <MediaCard
              key={album.id}
              to={albumPath(album)}
              image={bestImage(album.images)}
              images={album.images}
              title={album.title}
              subtitle={album.subtitle}
            />
          ))}
        </Shelf>
      )}
      </>
  );
}

function DayPicksBlock() {
  const dedupe = useShelfDedupe('daypicks');
  const timeShelf = useTimeOfDayShelf();
  return (
      <>
      {/* Time-of-day picks */}
      {timeShelf.isLoading ? (
        <ShelfSkeleton />
      ) : (
        <SongShelf title={timeShelf.title} explanation={`Based on your ${dayPartLabel()} sessions`} songs={dedupe(timeShelf.data ?? [])} />
      )}
      </>
  );
}

function LovedBlock() {
  const dedupe = useShelfDedupe('loved');
  const favorites = useLibraryStore((s) => s.favorites);
  return (
      <>
      {/* 23. Recently Loved */}
      <SongShelf title="Recently liked" songs={dedupe(favorites.slice(0, 12))} seeAllTo="/favorites" />
      </>
  );
}

function FeedBlock() {
  const playQueueFeed = usePlayerStore((s) => s.playQueue);
  const feed = useUnlimitedFeed();
  const feedSongs = flattenSongPages(feed.data?.pages);
  return (
      <>
      {/* Endless feed: keep scrolling to load more songs forever. */}
      <section className="mt-2" aria-label="More for you">
        <SectionHeader title="More for you" />
        {feed.isLoading && <CardGridSkeleton />}
        <div className="vxh-feed-grid">
          {feedSongs.map((song, i) => (
            <MediaCard
              key={song.id}
              to={songPath(song)}
              image={bestImage(song.images)} images={song.images}
              title={song.title}
              subtitle={song.subtitle}
              fluid
              onPlay={() => playQueueFeed(feedSongs, i)}
            />
          ))}
        </div>
        {!feed.isLoading && !feed.isError && (
          <InfiniteSentinel
            onVisible={() => feed.hasNextPage && !feed.isFetchingNextPage && feed.fetchNextPage()}
            disabled={!feed.hasNextPage}
            loading={feed.isFetchingNextPage}
          />
        )}
        {feed.isError && feedSongs.length === 0 && (
          <p className="text-sm text-ink-400 py-4">Feed unavailable right now — try again shortly.</p>
        )}
      </section>
      </>
  );
}

const HOME_BLOCKS: Record<HomeSection, () => ReactNode> = {
  quick: QuickBlock,
  personal: PersonalBlock,
  aihome: AiHomeBlock,
  discovery: DiscoveryBlock,
  charts: ChartsBlock,
  seasonal: SeasonalBlock,
  moods: MoodsBlock,
  genres: GenresBlock,
  artists: ArtistsBlock,
  albums: AlbumsBlock,
  daypicks: DayPicksBlock,
  loved: LovedBlock,
  feed: FeedBlock,
};

// Default order honors the home-shelf-order experiment (personal <-> discovery).
const HOME_BLOCK_KEYS: HomeSection[] = [
  'quick', 'personal', 'aihome', 'discovery', 'charts', 'seasonal', 'moods',
  'genres', 'artists', 'albums', 'daypicks', 'loved', 'feed',
];

/** 8.2.0 — the playing song's lyrics, one tap from Home. Its own component so a track change re-renders only the chip. */
function LyricsChip() {
  const song = useCurrentSong();
  const navigate = useNavigate();
  if (!song) return null;
  return <Chip onClick={() => navigate(`/lyrics/${song.id}`)}>Lyrics</Chip>;
}

// The old static greeting() lives on inside personalMessage's day-part
// titles — every listener now gets their own line on top of it.

export default function HomePage() {
  const [homeDesign, setHomeDesign] = useState<HomeDesign | null>(loadHomeDesign);
  // A fresh visit starts with an empty cross-shelf ledger.
  useState(() => resetShelfLedger());
  usePageTitle('Home');
  const pinned = useSettingsStore((s) => s.pinnedLanguages);
  const theme = useSettingsStore((s) => s.theme);
  const setTheme = useSettingsStore((s) => s.setTheme);
  const navigate = useNavigate();
  // Warms the region lookup the Charts and Trending-near-you blocks read.
  useRegion();
  const historyEntries = useHistoryStore((s) => s.entries);
  // 8.2.0 — how songs started from Home end feeds the dynamic order (discovery behaviour).
  useEffect(() => installHomeOutcomeTracking(), []);

  // This week's listening, from local history only — one shared rule
  // (features/stats/listening.ts), labelled as an estimate when it is one.
  const weekAgo = Date.now() - 7 * 86_400_000;
  const weekEntries = historyEntries.filter((e) => e.ts >= weekAgo);
  const weekTotal = listeningTotal(historyEntries, weekAgo);
  const continueListening = useContinueListening();
  // Above-the-fold data: the Aura Mix hero and its fallbacks. Every other
  // catalogue query lives inside the block that shows it.
  const daily = useDailyMix();
  const trendingNow = useTrendingNow();
  const mixes = useRecommendations();
  const playQueueFeed = usePlayerStore((s) => s.playQueue);
  // Roadmap O.2 — first live A/B: home shelf order. Resolves to 'control'
  // (today's exact layout) until the experiment exists AND this device's
  // deterministic bucket lands in an allocated variant.
  const shelfOrder = homeShelfOrder(useExperiment(EXP_HOME_SHELF_ORDER));
  const personalMix = mixes.data?.find((mix) => mix.kind === 'made-for-you')?.songs;
  const heroSongs = personalMix?.length ? personalMix : daily.data?.length ? daily.data : trendingNow.data?.length ? trendingNow.data : continueListening;

  // Quick-play home-screen widget: the widget launches the app with
  // ?widget=play (cold start) or flags sessionStorage via appUrlOpen (warm
  // start). Either way: auto-start the Aura Mix once hero songs land, once.
  const widgetPlayed = useRef(false);
  useEffect(() => {
    if (widgetPlayed.current || !heroSongs.length) return;
    let want = false;
    try {
      want =
        sessionStorage.getItem('vinax.widget-play') === '1' ||
        new URLSearchParams(window.location.search).get('widget') === 'play';
    } catch {
      /* private mode */
    }
    if (!want) return;
    widgetPlayed.current = true;
    try {
      sessionStorage.removeItem('vinax.widget-play');
      window.history.replaceState(null, '', window.location.pathname);
    } catch {
      /* best effort */
    }
    playQueueFeed(heroSongs, 0);
  }, [heroSongs, playQueueFeed]);

  const userName = getLocal<string>(KEYS.userName, '');
  // Personalized hero message — on-device only (name, history, streak,
  // profile, festival calendar). Memoized on the stable day-level inputs so
  // it never flips mid-session.
  const hello = useMemo(() => {
    const now = new Date();
    const profile = loadProfile();
    const lastTs = historyEntries[0]?.ts ?? null;
    return personalMessage({
      name: userName,
      hour: now.getHours(),
      dayOfWeek: now.getDay(),
      dateKey: now.toISOString().slice(0, 10),
      totalPlays: historyEntries.length,
      weekPlays: weekEntries.length,
      weekMinutes: weekTotal.minutes,
      streakDays: getStreak(),
      daysSinceLastListen: lastTs ? (Date.now() - lastTs) / 86_400_000 : Infinity,
      topLanguage: topLanguages(profile, 1)[0]?.id ?? null,
      topArtist: topArtists(profile, 1)[0]?.affinity.name ?? null,
      festivalId: activeFestivalMusic(now)?.id ?? null,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- day-stable inputs
  }, [userName, historyEntries.length]);
  const [notifOpen, setNotifOpen] = useState(false);

  // Pull-to-refresh: invalidate every query the shelves depend on. TanStack
  // Query re-fetches each mounted one and swaps the UI in place; blocks that
  // have not mounted yet simply fetch fresh data when they do. The P2R
  // indicator waits until all in-flight fetches resolve before releasing.
  const qc = useQueryClient();
  const [refreshingDiscovery, setRefreshingDiscovery] = useState(false);
  const handleRefresh = () => {
    recordServed(heroSongs.map(songKey));
    useDiscoveryStore.getState().refresh();
    invalidateRecommendationCache();
    // Package A5 — explicit refresh wipes the session-scoped dedup memory
    // so the same shelves get a genuinely fresh set of picks.
    resetShelfDeduper();
    resetShelfLedger();
    return Promise.all([
      qc.invalidateQueries({ queryKey: ['trending'] }),
      qc.invalidateQueries({ queryKey: ['trending-now'] }),
      qc.invalidateQueries({ queryKey: ['new-releases'] }),
      qc.invalidateQueries({ queryKey: ['new-releases-lang'] }),
      qc.invalidateQueries({ queryKey: ['popular'] }),
      qc.invalidateQueries({ queryKey: ['time-of-day'] }),
      // 'vinax-daily' / 'mixes' are the REAL keys (useDailyMix /
      // useRecommendations) — the old 'daily-mix' / 'recommendations' here
      // matched nothing, so those two shelves never refreshed on pull.
      qc.invalidateQueries({ queryKey: ['vinax-daily'] }),
      qc.invalidateQueries({ queryKey: ['weekly-mix'] }),
      qc.invalidateQueries({ queryKey: ['unlimited-feed'] }),
      qc.invalidateQueries({ queryKey: ['mixes'] }),
      // New shelves — added when HomePage was expanded (Group A/B/C/D/E/F).
      qc.invalidateQueries({ queryKey: ['recently-played-albums'] }),
      qc.invalidateQueries({ queryKey: ['because-you-listened-to'] }),
      qc.invalidateQueries({ queryKey: ['because-liked'] }),
      qc.invalidateQueries({ queryKey: ['fresh-finds'] }),
      qc.invalidateQueries({ queryKey: ['hidden-gems'] }),
      qc.invalidateQueries({ queryKey: ['trending-near-you'] }),
      qc.invalidateQueries({ queryKey: ['trending-albums'] }),
      qc.invalidateQueries({ queryKey: ['trending-artists-src'] }),
      qc.invalidateQueries({ queryKey: ['seasonal'] }),
      qc.invalidateQueries({ queryKey: ['mood-shelf'] }),
      qc.invalidateQueries({ queryKey: ['genre-shelf'] }),
      qc.invalidateQueries({ queryKey: ['ai-home-shelves'] }),
    ]);
  };

  // Fusion layer data (4.12.0): the language rail from pinned + hub
  // languages (pinned first). v5.15.0 — the console can set a default
  // language order for the rail (Admin → Language Order).
  const clientCfg = useClientConfig();
  const langOrder = clientCfg?.languageOrder ?? [];
  const rank = (l: string) => { const i = langOrder.indexOf(l); return i < 0 ? 999 : i; };
  const railLangs = [
    ...pinned,
    ...(HUB_LANGUAGES as readonly string[]).filter((l) => !pinned.includes(l)).sort((a, b) => rank(a) - rank(b)),
  ].slice(0, 12);

  const defaultOrder =
    shelfOrder === 'discovery-first'
      ? HOME_BLOCK_KEYS.map((k) => (k === 'personal' ? 'discovery' : k === 'discovery' ? 'personal' : k))
      : HOME_BLOCK_KEYS;
  // Listener order wins; owner-disabled shelves stay disabled (homeLayout.ts).
  const layout = composeHomeLayout(homeDesign, clientCfg?.homeLayout, defaultOrder);
  // 8.2.0 — when nobody chose an order (no Home Studio layout, no owner order,
  // no running shelf-order experiment), Home orders itself by time of day, what
  // the listener uses, how discovery picks go and genre affinity. Computed once
  // per session (homeOrder.ts): nothing moves while the listener scrolls.
  const blocks =
    layout.orderChosen || shelfOrder !== 'control'
      ? layout.visible
      : sessionHomeOrder(layout.visible, () =>
          orderHomeBlocks({ base: layout.visible, hour: new Date().getHours(), now: Date.now(), signals: loadHomeSignals(), genreStrength: genreAffinityStrength(readTaste().genres) }),
        );
  // Home Studio starts from the order the listener actually sees.
  const design = layout.orderChosen ? layout.design : { ...layout.design, order: [...blocks, ...layout.design.order.filter((k) => !blocks.includes(k))] };
  setShelfBlockOrder(blocks);
  // Progressive mount v2 (4.18.3, PSI TBT pass): v1 (4.17.0) mounted the
  // first two blocks immediately and ALL remaining ~10 blocks in one idle
  // callback — a single giant long task (hundreds of DOM nodes + effects)
  // that dominated mobile TBT. Blocks beyond the first two now mount
  // per-block via DeferredBlock as they scroll within ~800px of the
  // viewport, so an unscrolled load mounts almost nothing extra and a
  // scrolling user pays one small task per block instead of one huge one.
  // Since each block owns its queries, a deferred block also FETCHES only
  // when it mounts.

  const streakDays = getStreak();
  const applyDesign = (value: HomeDesign) => {
    const checked = validateHomeDesign(value); setHomeDesign(checked);
    try { localStorage.setItem(HOME_DESIGN_KEY, JSON.stringify(checked)); toast('Your Home layout is saved'); }
    catch { toast('Layout applied for this visit. Device storage is unavailable.'); }
  };
  const resetDesign = () => { setHomeDesign(null); try { localStorage.removeItem(HOME_DESIGN_KEY); } catch { /* session reset still works */ } };
  const refreshDiscovery = async () => {
    setRefreshingDiscovery(true);
    try { await handleRefresh(); toast('Discovery rotation updated. Available picks will refresh.'); }
    catch { toast('Could not refresh right now. Try again shortly.'); }
    finally { setRefreshingDiscovery(false); }
  };
  const surprise = () => {
    // Songs the page already holds — no extra catalogue call for a surprise.
    const pool = [...heroSongs, ...(trendingNow.data ?? []), ...continueListening];
    if (!pool.length) {
      toast('Still loading — try again in a second');
      return;
    }
    const i = Math.floor(Math.random() * pool.length);
    playQueueFeed(pool, i);
    toast(`Surprise: ${pool[i].title}`);
  };

  // Secondary things — shortcuts, the first-run checklist, journeys, app and
  // notification asks, the owner's promo — sit quietly after the first two
  // shelf blocks, so music is what a listener sees first.
  const secondary = (
    <div className="vxh-more">
      <div className="vxh-chips" role="group" aria-label="Quick actions">
        <button type="button" onClick={surprise} className="vxh-chip"><SparkleIcon /> Surprise me</button>
        <Chip onClick={() => navigate('/trending')}>Trending</Chip>
        <Chip onClick={() => navigate('/charts')}>Charts</Chip>
        {/* 8.2.0 — the playing song's lyrics, one tap from Home. */}
        <LyricsChip />
        <Chip onClick={() => navigate('/moods')}>Moods</Chip>
        <Chip onClick={() => navigate('/regions')}>Regions</Chip>
        <Chip onClick={() => navigate('/made-for-you')}>Made for you</Chip>
        <button type="button" className="vxh-chip" disabled={refreshingDiscovery} onClick={() => void refreshDiscovery()}>
          <SparkleIcon />{refreshingDiscovery ? 'Refreshing…' : 'Refresh discovery'}
        </button>
      </div>
      <p className="sr-only" role="status">{refreshingDiscovery ? 'Finding a fresh direction…' : ''}</p>
      <ListeningGuide />
      <nav className="vx-journeys vxh-journeys" aria-label="Explore your sound">
        <Link to="/VinaXAI"><SparkleIcon /><div><strong>Meet VinaX AI</strong><span>Ask, create, explore</span></div></Link>
        <Link to="/made-for-you"><PlayIcon /><div><strong>Made for your day</strong><span>Mixes shaped by your listening</span></div></Link>
        <Link to="/radio"><RadioGlyph /><div><strong>AI Radio</strong><span>Endless music from a song, a mood or a few words</span></div></Link>
      </nav>
      <GetAppBanner />
      <DownloadCta />
      <PushPromptCard />
      {/* Owner-published promo banner (admin → Banner & Promotion). */}
      <PromoBanner />
    </div>
  );
  // Customise Home sits at the end of the page — just above the endless
  // feed when there is one, since nothing below an endless feed is reachable.
  const studio = (
    <HomeStudio design={design} locked={layout.ownerHidden} onApply={applyDesign} onReset={resetDesign} />
  );
  const secondaryAt = Math.min(1, blocks.length - 1);
  const feedAt = blocks.indexOf('feed');
  // 8.2.0 — usage signal: which block a tap landed in, and the song it started (if any).
  const noteTap = (e: React.MouseEvent<HTMLDivElement>) => {
    const block = blockForTap(e.currentTarget, e.target);
    if (!block) return;
    noteBlockTap(block);
    const before = usePlayerStore.getState().queue[usePlayerStore.getState().index]?.id;
    window.setTimeout(() => {
      const st = usePlayerStore.getState();
      const started = st.queue[st.index]?.id;
      if (started && started !== before) attributeSong(started, block);
    }, 0);
  };

  return (
   <PullToRefresh onRefresh={handleRefresh}>
    <div className="max-w-screen-2xl mx-auto vx-stagger vx-home" onClickCapture={noteTap}>
      <TopBarActions>
        <IconButton label="Toggle theme" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>{theme === 'dark' ? <SunIcon className="w-5 h-5" /> : <MoonIcon className="w-5 h-5" />}</IconButton>
        <IconButton label="Notifications" onClick={() => setNotifOpen(true)}><BellIcon className="w-5 h-5" /></IconButton>
      </TopBarActions>
      <NotificationSheet open={notifOpen} onClose={() => setNotifOpen(false)} />

      {/* Greeting + language chips. The chips link where the old language rail did. */}
      <header className="vxh-greet">
        <div className="vxh-greet-row">
          <h1>{hello.title}</h1>
          {streakDays > 1 && <span className="vxh-streak">{streakDays}-day streak</span>}
        </div>
        {clientCfg?.greeting?.text && <p className="vxh-greet-note">{clientCfg.greeting.text}</p>}
        <nav className="vxh-chips" aria-label="Languages">
          <Link to="/languages" className="vxh-chip is-on">All</Link>
          {railLangs.map((l) => (
            <Link key={l} to={`/${l}-songs`} className="vxh-chip">
              {languageLabel(l)}
            </Link>
          ))}
        </nav>
      </header>

      <HomeOpening design={design} songs={heroSongs} recent={continueListening}
        onPlay={() => heroSongs.length && playQueueFeed(heroSongs, 0)}
        onResume={index => usePlayerStore.getState().playQueue(continueListening, index)} />

      {blocks.length === 0 && secondary}
      {blocks.map((k, i) => {
        const Block = HOME_BLOCKS[k];
        return (
          <Fragment key={k}>
            {i === feedAt && studio}
            {/* Invisible block markers for the usage signal (features/home/homeTaps.ts). */}
            <span hidden data-home-block={k} />
            {i < 2 ? <Block /> : <DeferredBlock render={() => <Block />} />}
            <span hidden data-home-block="" />
            {i === secondaryAt && secondary}
          </Fragment>
        );
      })}
      {feedAt < 0 && studio}

      <HomeAbout />
    </div>
   </PullToRefresh>
  );
}
