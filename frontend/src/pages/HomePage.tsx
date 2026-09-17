import { HomeOpening } from '@/features/home/HomeOpening';
import { useDiscoveryStore } from '@/store/discoveryStore';
import { invalidateRecommendationCache } from '@/services/recommendation/engine';
import { recordServed, songKey } from '@/services/recommendation/songIdentity';
import { ListeningGuide } from '@/features/home/ListeningGuide';
import { HomeStudio } from '@/features/home/HomeStudio';
import { HOME_DESIGN_KEY, loadHomeDesign, validateHomeDesign, type HomeDesign, type HomeSection } from '@/services/recommendation/homeDesign';
import { composeHomeLayout } from '@/features/home/homeLayout';
import { resetShelfLedger, setShelfBlockOrder, useShelfDedupe } from '@/features/home/shelfLedger';
import { formatMinutes, listeningTotal } from '@/features/stats/listening';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useClientConfig } from '@/features/home/useAppConfig';
import { PromoBanner } from '@/components/PromoBanner';
import { useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { PullToRefresh } from '@/components/PullToRefresh';
import { artistPath, songPath } from '@/utils/slug';
import { usePageTitle } from '@/hooks/usePageTitle';
import { Shelf } from '@/components/Shelf';
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
import {  SearchIcon,  SunIcon, SparkleIcon, PlayIcon } from '@/components/Icons';
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
import { useAiHome } from '@/features/home/useAiHome';
import { useFeatureEnabled } from '@/features/home/useAppConfig';
import { moodRotationOfTheDay, useMoodShelf } from '@/features/home/useMoodShelves';
import { GENRE_SHELVES } from '@/features/home/useGenreShelves';
import { useSeasonalShelf } from '@/features/home/useSeasonalShelf';
import { useExperiment } from '@/features/experiments/useExperiment';
import { EXP_HOME_SHELF_ORDER, homeShelfOrder } from '@/features/experiments/homeShelfOrder';
import { albumPath } from '@/utils/slug';
import { playArtist } from '@/features/player/playEntity';
import { letterAvatar } from '@/utils/avatar';
import { useRecommendations } from '@/features/recommendations/useRecommendations';
import { useSettingsStore } from '@/store/settingsStore';
import { useLibraryStore } from '@/store/libraryStore';
import { usePlayerStore } from '@/store/playerStore';
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
    continueListening.length && {
      label: 'Continue Listening',
      image: bestImage(continueListening[0].images, 120),
      go: () => playQueueFeed(continueListening, 0),
    },
    favorites.length && {
      label: 'Liked Songs',
      image: bestImage(favorites[0].images, 120),
      go: () => navigate('/favorites'),
    },
    onRepeat.length && {
      label: 'On Repeat',
      image: bestImage(onRepeat[0].images, 120),
      go: () => playQueueFeed(onRepeat, 0),
    },
    (daily.data?.length ?? 0) > 0 && {
      label: 'VinaX Daily',
      image: bestImage(daily.data![0].images, 120),
      go: () => playQueueFeed(daily.data!, 0),
    },
    (weekly.data?.length ?? 0) > 0 && {
      label: 'For You This Week',
      image: bestImage(weekly.data![0].images, 120),
      go: () => navigate('/weekly'),
    },
    mostListened.length && {
      label: 'Most Listened',
      image: bestImage(mostListened[0].images, 120),
      go: () => navigate('/history'),
    },
  ].filter((t): t is { label: string; image: string; go: () => void } => !!t).slice(0, 6);
  return (
      <>
      {quickTiles.length >= 2 && (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2 mb-7">
          {quickTiles.map((t) => (
            <button
              key={t.label}
              onClick={t.go}
              className="group flex items-center gap-3 rounded-xl glass-card overflow-hidden pr-3 text-left hover:bg-ink-800/40 transition"
            >
              <img
                src={t.image}
                onError={(e) => ((e.target as HTMLImageElement).src = FALLBACK_ART)}
                alt=""
                loading="lazy"
                className="w-12 h-12 md:w-14 md:h-14 object-cover shrink-0"
              />
              <span className="text-[13px] font-bold truncate flex-1">{t.label}</span>
              <span className="w-8 h-8 rounded-full btn-primary hidden md:grid place-items-center text-[11px] opacity-0 group-hover:opacity-100 transition shrink-0">
                ▶
              </span>
            </button>
          ))}
        </div>
      )}
      </>
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
  return (
    <>
      {/* v5.17.0 — streak + song of the day: compact cards, each hides itself when empty.
          v5.19.0 — plus a "Coming up" festival card when one is 1–3 days away. */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mb-6 empty:hidden">
        <StreakCard entries={historyEntries} />
        <SongOfTheDayCard favorites={favorites} entries={historyEntries} />
        <FestivalLookaheadCard />
      </div>

      {/* 1. Continue Listening — pick up where you left off */}
      <SongShelf title="Continue Listening" explanation="Pick up where you left off" songs={dedupe(continueListening)} seeAllTo="/history" />

      {/* v5.12.0 — On this day: what you played on this date in earlier months/years */}
      {memories && (
        <SongShelf title="On this day" explanation={`You were playing these ${memories.label.toLowerCase()}`} songs={memories.songs} seeAllTo="/history" />
      )}

      {/* 3. Recently Played Albums — hydrated from local history */}
      {recentAlbums.isLoading ? (
        <ShelfSkeleton />
      ) : recentAlbums.data && recentAlbums.data.length > 0 ? (
        <SongShelf title="Recently Played" explanation="Albums you've been listening to" songs={dedupe(recentAlbums.data)} seeAllTo="/history" />
      ) : null}

      {/* 4. For You This Week — existing weekly mix */}
      {weekly.isLoading ? (
        <ShelfSkeleton />
      ) : weekly.data && weekly.data.length > 0 ? (
        <SongShelf title="For You This Week" explanation="A fresh weekly mix · updates every Monday" songs={dedupe(weekly.data)} seeAllTo="/weekly" />
      ) : null}

      {/* 5. Most Listened Songs */}
      <SongShelf title="Most Listened Songs" explanation="Your all-time favourites" songs={dedupe(mostListened)} seeAllTo="/history" />

      {/* 6. On Repeat */}
      <SongShelf title="On Repeat" explanation="Played 3+ times in the last 14 days" songs={dedupe(onRepeat)} />

      {/* 7. Repeat Rewind */}
      <SongShelf title="Repeat Rewind" explanation="Old favourites you haven't touched lately" songs={dedupe(repeatRewind)} />

      {/* 8. Because You Listened To … */}
      {because.isLoading ? (
        <ShelfSkeleton />
      ) : because.data && because.data.length > 0 && becauseSeed ? (
        <SongShelf
          title={`Because you listened to ${becauseSeed.subtitle}`}
          explanation="More from an artist you love"
          songs={dedupe(because.data)}
        />
      ) : null}

      {/* v5.17.0 — 8b. Because you liked “X” — suggestions seeded by one favourite, rotating daily */}
      {likedSeed && becauseLiked.isLoading ? (
        <ShelfSkeleton />
      ) : likedSeed && becauseLiked.data && becauseLiked.data.length > 0 ? (
        <SongShelf
          title={`Because you liked “${likedSeed.title}”`}
          explanation="Songs that sit well next to a favourite of yours"
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
        <SongShelf title="VinaX Daily" explanation="A fresh mix for today, built from your taste" songs={dedupe(daily.data ?? [])} />
      )}

      {/* 10. Your Favorite Artists (existing Your Artists) */}
      {yourArtists.length >= 3 && (
        <Shelf title="Your Favorite Artists" explanation="The voices you keep coming back to">
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
      <p className="text-[11px] font-extrabold tracking-[0.22em] text-ember-400 uppercase mb-3">Designed for you · AI shelves</p>
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
  const trendingNow = useTrendingNow();
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
          title={region?.country ? `Trending Near You · ${region.regionLabel ?? region.country}` : 'Trending Near You'}
          explanation="Regional popular tracks"
          songs={dedupe(nearYou.data)}
        />
      ) : null}

      {/* 12. Trending Now (existing) */}
      {trendingNow.isLoading ? (
        <ShelfSkeleton />
      ) : trendingNow.data && trendingNow.data.length > 0 ? (
        <SongShelf title="Trending Now" explanation="What everyone's playing right now" songs={dedupe(trendingNow.data)} seeAllTo="/charts" />
      ) : null}

      {/* Trending in your primary language */}
      {trending.isLoading ? (
        <ShelfSkeleton />
      ) : (
        <SongShelf
          title={`Trending · ${languageLabel(primaryLang)}`}
          explanation={region?.country === 'IN' ? 'Popular in your region' : 'Trending in your languages'}
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
        <SongShelf title="New Releases" explanation="Fresh drops in your languages" songs={dedupe(newReleases.data)} />
      ) : null}

      {/* 14. Popular (existing) */}
      {popular.isLoading ? (
        <ShelfSkeleton />
      ) : popular.data && popular.data.length > 0 ? (
        <SongShelf title="Popular" explanation="Most-played in your languages" songs={dedupe(popular.data)} seeAllTo="/charts" />
      ) : null}

      {/* 15. Fresh Finds */}
      {freshFinds.isLoading ? (
        <ShelfSkeleton />
      ) : freshFinds.data && freshFinds.data.length > 0 ? (
        <SongShelf title="Fresh Finds" explanation="New artists making waves" songs={dedupe(freshFinds.data)} />
      ) : null}

      {/* 16. Hidden Gems */}
      {hiddenGems.isLoading ? (
        <ShelfSkeleton />
      ) : hiddenGems.data && hiddenGems.data.length > 0 ? (
        <SongShelf title="Hidden Gems" explanation="Deep cuts worth discovering" songs={dedupe(hiddenGems.data)} />
      ) : null}

      {/* 16b. Decade Rewind (4.16.0) — generated: 90s classics, primary language */}
      {decadeRewind.data && decadeRewind.data.length > 0 && (
        <SongShelf
          title="Decade Rewind · 90s"
          explanation={`Golden-era ${languageLabel(primaryLang)} classics`}
          songs={dedupe(decadeRewind.data)}
        />
      )}

      {/* 16c. Second-language trending (4.16.0) — your other side */}
      {secondLang && trendingSecond.data && trendingSecond.data.length > 0 && (
        <SongShelf
          title={`Trending · ${languageLabel(secondLang)}`}
          explanation="From your second language"
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
  return (
      <>
      {/* 17. Top 50 Global / Top 50 Country / Viral 50 — nav cards to /charts */}
      <section aria-label="Charts" className="mb-8">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Link
            to="/charts"
            className="glass-card rounded-xl p-4 flex flex-col justify-between hover:bg-ink-800/40 transition-colors min-h-24"
          >
            <p className="text-xs font-bold uppercase tracking-widest text-ember-300">Top 50</p>
            <p className="text-lg font-extrabold mt-1">Global</p>
            <p className="text-xs text-ink-400">The biggest songs worldwide</p>
          </Link>
          <Link
            to="/charts"
            className="glass-card rounded-xl p-4 flex flex-col justify-between hover:bg-ink-800/40 transition-colors min-h-24"
          >
            <p className="text-xs font-bold uppercase tracking-widest text-ember-300">Top 50</p>
            <p className="text-lg font-extrabold mt-1">
              {region?.regionLabel ?? region?.country ?? 'Your Country'}
            </p>
            <p className="text-xs text-ink-400">Charts in your region</p>
          </Link>
          <Link
            to="/charts"
            className="glass-card rounded-xl p-4 flex flex-col justify-between hover:bg-ink-800/40 transition-colors min-h-24"
          >
            <p className="text-xs font-bold uppercase tracking-widest text-tide-300">Viral 50</p>
            <p className="text-lg font-extrabold mt-1">Right Now</p>
            <p className="text-xs text-ink-400">Songs going viral this week</p>
          </Link>
        </div>
      </section>
      </>
  );
}

function SeasonalBlock() {
  const dedupe = useShelfDedupe('seasonal');
  const seasonal = useSeasonalShelf();
  return (
      <>
      {/* 18. Seasonal shelf — only when a season/event matches "now" */}
      {seasonal.season && seasonal.data && seasonal.data.length > 0 && (
        <SongShelf title={seasonal.season.title} explanation="For the moment" songs={dedupe(seasonal.data)} />
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
  return (
      <>
      {/* 19. Mood Playlists — a grid of 6 mood shelves, 8 songs each */}
      {moodQueries.some((q) => q.data && q.data.length > 0) && (
        <section className="mb-8">
          <div className="flex items-end justify-between mb-3">
            <h2 className="text-xl md:text-2xl font-extrabold tracking-tight">Mood Playlists</h2>
            <Link to="/moods" className="text-xs font-semibold text-ember-400 hover:text-ember-300">See all ›</Link>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {moods.map((mood, idx) => {
              const q = moodQueries[idx];
              const songs = dedupe(q.data ?? []);
              if (!songs.length) return null;
              return (
                <div key={mood.id} className="glass-card rounded-xl p-3">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-sm font-bold">{mood.title}</p>
                    <button
                      onClick={() => playQueueFeed(songs, 0)}
                      className="text-[11px] font-semibold text-ember-400 hover:text-ember-300"
                    >
                      Play
                    </button>
                  </div>
                  <ul className="space-y-1.5">
                    {songs.slice(0, 8).map((song, i) => (
                      <li key={song.id}>
                        <button
                          onClick={() => playQueueFeed(songs, i)}
                          className="flex items-center gap-2 w-full text-left rounded-md hover:bg-ink-800/40 p-1"
                        >
                          <img
                            /* 4.18.1: 36px cell — srcset lets 1x screens take
                               the 50px file, 2x+ keeps 150 (PSI desktop
                               image-delivery finding). */
                            src={bestImage(song.images, 150)}
                            srcSet={artSrcSet(song.images, 150)}
                            sizes="36px"
                            width={36}
                            height={36}
                            onError={(e) => {
                              const t = e.target as HTMLImageElement;
                              t.srcset = '';
                              t.src = FALLBACK_ART;
                            }}
                            alt=""
                            loading="lazy"
                            decoding="async"
                            className="w-9 h-9 rounded object-cover shrink-0"
                          />
                          <span className="min-w-0 flex-1">
                            <span className="text-xs font-semibold truncate block">{song.title}</span>
                            <span className="text-[10px] text-ink-400 truncate block">{song.subtitle}</span>
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        </section>
      )}
      </>
  );
}

function GenresBlock() {
  return (
      <>
      {/* 20. Genre Collections — compact horizontal row of chip-cards */}
      <section className="mb-8">
        <h2 className="text-xl md:text-2xl font-extrabold tracking-tight mb-3">Genre Collections</h2>
        <div className="flex gap-2 overflow-x-auto no-scrollbar -mx-2 px-2 snap-x">
          {GENRE_SHELVES.map((g) => (
            <Link
              key={g.id}
              to={`/search/${encodeURIComponent(g.query)}`}
              className="snap-start shrink-0 rounded-full px-4 py-2 glass-card hover:bg-ink-800/40 text-sm font-semibold whitespace-nowrap"
            >
              {g.label}
            </Link>
          ))}
        </div>
      </section>
      </>
  );
}

function ArtistsBlock() {
  const trendingArtists = useTrendingArtists();
  return (
      <>
      {/* 21. Trending Artists (round MediaCards) */}
      {trendingArtists.data && trendingArtists.data.length >= 3 && (
        <Shelf title="Trending Artists" explanation="Names topping the charts">
          {trendingArtists.data.map((a) => (
            <MediaCard
              key={a.id || a.name}
              to={a.id ? artistPath(a) : `/search/${encodeURIComponent(a.name)}`}
              image={a.image ?? letterAvatar(a.name)}
              title={a.name}
              subtitle="Trending"
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
        <Shelf title="Trending Albums" explanation="The albums everyone's spinning">
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
      <SongShelf title="Recently Loved" explanation="Your latest favorites" songs={dedupe(favorites.slice(0, 12))} seeAllTo="/favorites" />
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
      <section className="mt-2">
        <h2 className="text-xl md:text-2xl font-extrabold tracking-tight">More For You</h2>
        <p className="text-xs text-ink-400 mt-0.5 mb-3">
          Picks in your languages, ranked by your taste — scrolls forever
        </p>
        {feed.isLoading && <CardGridSkeleton />}
        <div className="grid grid-cols-[repeat(auto-fill,minmax(148px,1fr))] gap-2">
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
  const region = useRegion();
  const historyEntries = useHistoryStore((s) => s.entries);

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
  const design = layout.design;
  setShelfBlockOrder(layout.visible);
  // Progressive mount v2 (4.18.3, PSI TBT pass): v1 (4.17.0) mounted the
  // first two blocks immediately and ALL remaining ~10 blocks in one idle
  // callback — a single giant long task (hundreds of DOM nodes + effects)
  // that dominated mobile TBT. Blocks beyond the first two now mount
  // per-block via DeferredBlock as they scroll within ~800px of the
  // viewport, so an unscrolled load mounts almost nothing extra and a
  // scrolling user pays one small task per block instead of one huge one.
  // Since each block owns its queries, a deferred block also FETCHES only
  // when it mounts.

  return (
   <PullToRefresh onRefresh={handleRefresh}>
    <div className="max-w-screen-2xl mx-auto vx-stagger vx-home">
      <div className="flex items-center justify-end gap-1 mb-2">
        <IconButton label="Toggle theme" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}><SunIcon className="w-5 h-5" /></IconButton>
        <IconButton label="Notifications" onClick={() => setNotifOpen(true)}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-5 h-5" aria-hidden><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M9 21h6" /></svg></IconButton>
      </div>
      <NotificationSheet open={notifOpen} onClose={() => setNotifOpen(false)} />

      {/* Hero — full-bleed colour wash that fades into the page */}
      <div className={`mb-6 pb-2 bg-gradient-to-b ${
        ({
          morning: 'from-transparent to-transparent',
          afternoon: 'from-transparent to-transparent',
          evening: 'from-transparent to-transparent',
          'late-night': 'from-transparent to-transparent',
        } as Record<string, string>)[dayPartLabel()] ?? 'from-transparent to-transparent'
      }`}>
        <p className="text-[11px] font-extrabold tracking-[0.22em] text-ember-400 uppercase mb-1.5">
          {new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })} · made for you
        </p>
        <h1 className="text-page-title font-extrabold tracking-tight">{hello.title}</h1>
        <p className="text-ink-200 mt-1.5 text-sm font-medium">{clientCfg?.greeting?.text ?? hello.subtitle}</p>
        <p className="text-ink-300 mt-1 text-sm">
          {region?.country ? `Tuned for ${region.country}` : 'Tuned to you'} · recommendations that grow with you
          {weekEntries.length > 0 && (
            <span className="text-ink-400"> · this week: {weekEntries.length} plays · {formatMinutes(weekTotal)}</span>
          )}
          {getStreak() > 1 && <span className="text-ember-400 font-semibold"> · 🔥 {getStreak()}-day streak</span>}
        </p>

      </div>

      <HomeOpening design={design} songs={heroSongs} recent={continueListening}
        onPlay={() => heroSongs.length && playQueueFeed(heroSongs, 0)}
        onResume={index => usePlayerStore.getState().playQueue(continueListening, index)} />

      <HomeStudio design={design} locked={layout.ownerHidden} onApply={value => {
        const checked = validateHomeDesign(value); setHomeDesign(checked);
        try { localStorage.setItem(HOME_DESIGN_KEY, JSON.stringify(checked)); toast('Your Home layout is saved'); }
        catch { toast('Layout applied for this visit. Device storage is unavailable.'); }
      }} onReset={() => { setHomeDesign(null); try { localStorage.removeItem(HOME_DESIGN_KEY); } catch { /* session reset still works */ } }} />



        <div className="flex gap-2 mb-6 flex-wrap">
          <button
            onClick={() => {
              // Songs the page already holds — no extra catalogue call for a surprise.
              const pool = [...heroSongs, ...(trendingNow.data ?? []), ...continueListening];
              if (!pool.length) {
                toast('Still loading — try again in a second');
                return;
              }
              const i = Math.floor(Math.random() * pool.length);
              playQueueFeed(pool, i);
              toast(`Surprise: ${pool[i].title}`);
            }}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-full btn-premium text-sm font-bold"
          >
            <SparkleIcon className="w-4 h-4" /> Surprise me
          </button>
          <Chip onClick={() => navigate('/charts')}>Charts</Chip>
          <Chip onClick={() => navigate('/moods')}>Moods</Chip>
          <Chip onClick={() => navigate('/regions')}>Regions</Chip>
          <Chip onClick={() => navigate('/made-for-you')}>Made For You</Chip>
        </div>
      <div className="flex items-center justify-between gap-3 flex-wrap mb-5">
        <p className="text-sm text-ink-400" role="status">{refreshingDiscovery ? 'Finding a fresh direction…' : 'Ready for a different discovery?'}</p>
        <button className="vx-fresh-button" disabled={refreshingDiscovery} onClick={async () => {
          setRefreshingDiscovery(true);
          try { await handleRefresh(); toast('Discovery rotation updated. Available picks will refresh.'); }
          catch { toast('Could not refresh right now. Try again shortly.'); }
          finally { setRefreshingDiscovery(false); }
        }}><SparkleIcon className="w-4 h-4" />{refreshingDiscovery ? 'Refreshing…' : 'Refresh discovery'}</button>
      </div>
      <nav className="vx-journeys" aria-label="Explore your sound">
        <Link to="/VinaXAI"><SparkleIcon /><div><strong>Meet VinaX AI</strong><span>Ask, create, explore</span></div></Link>
        <Link to="/made-for-you"><PlayIcon /><div><strong>Made for your day</strong><span>Mixes shaped by your listening</span></div></Link>
        <Link to="/moods"><SearchIcon /><div><strong>Find a feeling</strong><span>A soundtrack for every headspace</span></div></Link>
      </nav>

      <ListeningGuide />

      {/* Fusion layer (4.12.0) — language rail + tile-grid
          quick grid over the existing shelves. Pure recomposition of data the
          page already loads; tiles hide until their source has content. */}
      <div className="flex gap-2 overflow-x-auto no-scrollbar -mx-2 px-2 mb-4 snap-x" aria-label="Languages">
        <Link to="/languages" className="snap-start shrink-0 px-4 py-2 rounded-full text-xs font-extrabold btn-primary">For You</Link>
        {railLangs.map((l) => (
          <Link
            key={l}
            to={`/${l}-songs`}
            className="snap-start shrink-0 px-4 py-2 rounded-full text-xs font-bold glass-card hover:bg-ink-800/40 whitespace-nowrap"
          >
            {languageLabel(l)}
          </Link>
        ))}
      </div>

      <GetAppBanner />
      <DownloadCta />
      <PushPromptCard />

      {/* Owner-published promo banner (admin → Banner & Promotion). */}
      <PromoBanner className="mb-8" />

      {layout.visible.map((k, i) => {
        const Block = HOME_BLOCKS[k];
        return i < 2 ? <Block key={k} /> : <DeferredBlock key={k} render={() => <Block />} />;
      })}

    </div>
   </PullToRefresh>
  );
}
