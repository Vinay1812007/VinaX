import { useState } from 'react';
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
import { createShelfDeduper } from '@/features/home/dedupeShelves';
import { Chip } from '@/components/Chip';
import { GetAppBanner } from '@/components/GetAppBanner';
import { PushPromptCard } from '@/components/PushPromptCard';
import { NotificationSheet } from '@/components/NotificationSheet';
import { DownloadCta } from '@/components/DownloadCta';
import { IconButton } from '@/components/IconButton';
import { MoonIcon, SearchIcon, SettingsIcon, SunIcon, SparkleIcon, PlayIcon } from '@/components/Icons';
import { useHistoryStore } from '@/store/historyStore';
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
import { useAiHome } from '@/features/home/useAiHome';
import {
  useMostListened,
  useOnRepeat,
  useRepeatRewind,
  useRecentlyPlayedAlbums,
  useBecauseYouListenedTo,
} from '@/features/home/usePersonalShelves';
import { useFreshFinds, useHiddenGems, useTrendingNearYou } from '@/features/home/useDiscoveryShelves';
import { useTrendingAlbums, useTrendingArtists } from '@/features/home/useTrendingShelves';
import { moodRotationOfTheDay, useMoodShelf } from '@/features/home/useMoodShelves';
import { GENRE_SHELVES } from '@/features/home/useGenreShelves';
import { useSeasonalShelf } from '@/features/home/useSeasonalShelf';
import { albumPath } from '@/utils/slug';
import { useT } from '@/i18n';
import { playArtist } from '@/features/player/playEntity';
import { letterAvatar } from '@/utils/avatar';
import { useRecommendations } from '@/features/recommendations/useRecommendations';
import { useSettingsStore } from '@/store/settingsStore';
import { useLibraryStore } from '@/store/libraryStore';
import { usePlayerStore } from '@/store/playerStore';
import { useRegion } from '@/features/location/useRegion';
import { FALLBACK_ART, bestImage } from '@/utils/images';
import { HUB_LANGUAGES, languageLabel } from '@/constants/languages';
import { dayPartLabel } from '@/utils/time';
import { getStreak } from '@/utils/streak';
import { trendingSeed } from '@/constants/seeds';
import type { Song } from '@/types';

function SongShelf({ title, explanation, songs, seeAllTo }: { title: string; explanation?: string; songs: Song[]; seeAllTo?: string }) {
  const playQueue = usePlayerStore((s) => s.playQueue);
  if (!songs.length) return null;
  return (
    <Shelf title={title} explanation={explanation} seeAllTo={seeAllTo}>
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

function greeting(): string {
  const part = dayPartLabel();
  if (part === 'morning') return 'Good morning';
  if (part === 'afternoon') return 'Good afternoon';
  if (part === 'evening') return 'Good evening';
  return 'Late night waves';
}

export default function HomePage() {
  usePageTitle('Home');
  const pinned = useSettingsStore((s) => s.pinnedLanguages);
  const theme = useSettingsStore((s) => s.theme);
  const setTheme = useSettingsStore((s) => s.setTheme);
  const navigate = useNavigate();
  const region = useRegion();
  const historyEntries = useHistoryStore((s) => s.entries);

  // This week's listening, from local history only.
  const weekAgo = Date.now() - 7 * 86_400_000;
  const weekEntries = historyEntries.filter((e) => e.ts >= weekAgo);
  const weekMinutes = Math.round(weekEntries.reduce((acc, e) => acc + (e.song.duration ?? 180), 0) / 60);
  const continueListening = useContinueListening();
  const yourArtists = useYourArtists();
  const daily = useDailyMix();
  const weekly = useWeeklyMix();
  const trendingNow = useTrendingNow();
  const newReleases = useNewReleases();
  const popular = usePopular();
  const aiHome = useAiHome();
  const t = useT();
  const favorites = useLibraryStore((s) => s.favorites);
  const timeShelf = useTimeOfDayShelf();
  const mixes = useRecommendations();
  const primaryLang = pinned[0] ?? 'hindi';
  const trending = useTrendingForLanguage(primaryLang);
  const playQueueFeed = usePlayerStore((s) => s.playQueue);
  const feed = useUnlimitedFeed();
  const feedSongs = flattenSongPages(feed.data?.pages);
  // ---- New personalized, discovery, mood, genre, seasonal shelves ----
  const mostListened = useMostListened();
  const onRepeat = useOnRepeat();
  const repeatRewind = useRepeatRewind();
  const recentAlbums = useRecentlyPlayedAlbums();
  // Seed "Because you listened to …" from the top-played song by the user's
  // #1 artist — mostListened is already sorted by play count.
  const becauseSeed = mostListened[0];
  const because = useBecauseYouListenedTo(becauseSeed);
  const freshFinds = useFreshFinds();
  const hiddenGems = useHiddenGems();
  const nearYou = useTrendingNearYou();
  const trendingArtists = useTrendingArtists();
  const trendingAlbums = useTrendingAlbums();
  const seasonal = useSeasonalShelf();
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
  // Cross-shelf de-dupe: each shelf shows only songs not already shown above it.
  const dedupe = createShelfDeduper();
  const heroSongs = daily.data?.length ? daily.data : trendingNow.data?.length ? trendingNow.data : feedSongs;

  const userName = getLocal<string>(KEYS.userName, '');
  const [notifOpen, setNotifOpen] = useState(false);

  // Pull-to-refresh: invalidate every query the shelves depend on. TanStack
  // Query re-fetches each one and swaps the UI in place — the P2R indicator
  // waits until all in-flight fetches resolve before releasing.
  const qc = useQueryClient();
  const handleRefresh = () => {
    return Promise.all([
      qc.invalidateQueries({ queryKey: ['trending'] }),
      qc.invalidateQueries({ queryKey: ['trending-now'] }),
      qc.invalidateQueries({ queryKey: ['new-releases'] }),
      qc.invalidateQueries({ queryKey: ['new-releases-lang'] }),
      qc.invalidateQueries({ queryKey: ['popular'] }),
      qc.invalidateQueries({ queryKey: ['time-of-day'] }),
      qc.invalidateQueries({ queryKey: ['daily-mix'] }),
      qc.invalidateQueries({ queryKey: ['weekly-mix'] }),
      qc.invalidateQueries({ queryKey: ['ai-home'] }),
      qc.invalidateQueries({ queryKey: ['unlimited-feed'] }),
      qc.invalidateQueries({ queryKey: ['recommendations'] }),
      // New shelves — added when HomePage was expanded (Group A/B/C/D/E/F).
      qc.invalidateQueries({ queryKey: ['recently-played-albums'] }),
      qc.invalidateQueries({ queryKey: ['because-you-listened-to'] }),
      qc.invalidateQueries({ queryKey: ['fresh-finds'] }),
      qc.invalidateQueries({ queryKey: ['hidden-gems'] }),
      qc.invalidateQueries({ queryKey: ['trending-near-you'] }),
      qc.invalidateQueries({ queryKey: ['trending-albums'] }),
      qc.invalidateQueries({ queryKey: ['trending-artists-src'] }),
      qc.invalidateQueries({ queryKey: ['seasonal'] }),
      qc.invalidateQueries({ queryKey: ['mood-shelf'] }),
      qc.invalidateQueries({ queryKey: ['genre-shelf'] }),
    ]);
  };

  return (
   <PullToRefresh onRefresh={handleRefresh}>
    <div className="max-w-screen-2xl mx-auto vx-stagger">
      {/* Home header: brand (mobile) + quick theme & settings (all sizes) */}
      <div className="sticky top-0 z-30 -mx-5 px-5 mb-4 pt-[max(0.375rem,var(--safe-top))] pb-2.5 flex items-center justify-between bg-[rgb(var(--ink-950)/0.7)] backdrop-blur-xl border-b border-white/5 md:static md:z-auto md:mx-0 md:px-0 md:bg-transparent md:backdrop-blur-none md:border-0 md:pt-1 md:pb-0">
        <div className="md:hidden flex items-center gap-2.5">
          <img src="/icons/icon.svg" alt="" className="w-9 h-9 rounded-xl" />
          <span className="text-2xl font-bold tracking-tight">
            <span className="bg-gradient-to-r from-ember-400 to-tide-400 bg-clip-text text-transparent">VinaX</span><span className="text-ember-500">.</span>
          </span>
        </div>
        <div className="hidden md:flex items-center gap-6 min-w-0">
          <div className="min-w-0">
            <p className="text-xl font-bold tracking-tight truncate">
              Welcome back
              {userName ? `, ${userName}` : ''}
            </p>
            <p className="text-[11px] text-ink-400">Tuned to you · private by design</p>
          </div>
          <Link
            to="/search"
            className="glass-search rounded-full px-4 py-2.5 w-72 flex items-center gap-2 text-sm text-ink-400 hover:text-ink-200 transition-colors"
          >
            <SearchIcon className="w-4 h-4" /> Songs, artists, albums…
          </Link>
        </div>
        <div className="flex items-center gap-1">
          <IconButton label="Toggle theme" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
            <span className="relative block w-5 h-5 overflow-visible" aria-hidden>
              <SunIcon className="theme-ico theme-ico-sun absolute inset-0 w-5 h-5" />
              <MoonIcon className="theme-ico theme-ico-moon absolute inset-0 w-5 h-5" />
            </span>
          </IconButton>
          <IconButton label="Notifications" onClick={() => setNotifOpen(true)}>
            <span className="text-[17px] leading-none" aria-hidden>🔔</span>
          </IconButton>
          <IconButton label="Settings" onClick={() => navigate('/settings')}>
            <SettingsIcon className="w-5 h-5" />
          </IconButton>
        </div>
      </div>
      <PushPromptCard />
      <NotificationSheet open={notifOpen} onClose={() => setNotifOpen(false)} />
      <GetAppBanner />

      {continueListening.length >= 2 && (
        <section aria-label="Jump back in" className="mb-5">
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-2">
            {continueListening.slice(0, 6).map((song, i) => (
              <button
                key={song.id}
                onClick={() => usePlayerStore.getState().playQueue(continueListening, i)}
                className="flex items-center gap-2.5 rounded-xl glass-card overflow-hidden pr-3 text-left hover:bg-ink-800/40 transition-colors"
              >
                <img
                  src={bestImage(song.images, 150)}
                  onError={(e) => ((e.target as HTMLImageElement).src = FALLBACK_ART)}
                  alt=""
                  loading="lazy"
                  className="w-12 h-12 object-cover shrink-0"
                />
                <span className="text-xs font-semibold truncate">{song.title}</span>
              </button>
            ))}
          </div>
        </section>
      )}
      <DownloadCta />

      {/* Hero — full-bleed colour wash that fades into the page */}
      <div className={`-mx-5 md:-mx-10 -mt-6 lg:mt-0 mb-6 px-5 md:px-10 pt-6 pb-4 bg-gradient-to-b ${
        ({
          morning: 'from-transparent to-transparent',
          afternoon: 'from-transparent to-transparent',
          evening: 'from-transparent to-transparent',
          'late-night': 'from-transparent to-transparent',
        } as Record<string, string>)[dayPartLabel()] ?? 'from-transparent to-transparent'
      }`}>
        <h1 className="text-3xl md:text-[34px] font-extrabold tracking-tight">{t(greeting())}</h1>
        <p className="text-ink-300 mt-1 text-sm">
          {region?.country ? `Tuned for ${region.country}` : 'Tuned to you'} · no account, all local
          {weekEntries.length > 0 && (
            <span className="text-ink-400"> · this week: {weekEntries.length} plays ≈ {weekMinutes} min</span>
          )}
          {getStreak() > 1 && <span className="text-ember-400 font-semibold"> · 🔥 {getStreak()}-day streak</span>}
        </p>
        <div className="flex gap-2 mt-4 flex-wrap">
          <button
            onClick={() => {
              const pool = [...(trending.data ?? []), ...feedSongs, ...continueListening];
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
      </div>

      {/* Aura Mix hero — the AI DJ entry point */}
      <section className="relative overflow-hidden rounded-3xl mb-6 border border-white/5 bg-ink-850">
        <div
          className="vx-hero-wash absolute inset-0 pointer-events-none opacity-70"
          style={{
            background:
              'radial-gradient(120% 130% at 0% 0%, rgb(var(--aura-violet) / 0.32), transparent 55%), radial-gradient(110% 120% at 100% 10%, rgb(var(--aura-cyan) / 0.26), transparent 55%), radial-gradient(120% 130% at 55% 130%, rgb(var(--aura-lime) / 0.22), transparent 60%)',
          }}
          aria-hidden
        />
        <div className="relative p-6 md:p-8">
          <p className="aura-eyebrow text-xs font-bold uppercase tracking-widest text-ember-300 flex items-center gap-1.5">
            <SparkleIcon className="w-3.5 h-3.5" /> AI DJ · ready
          </p>
          <h2 className="text-3xl md:text-4xl font-extrabold mt-2">Your Aura Mix</h2>
          <p className="text-sm text-ink-200/90 mt-2 max-w-md leading-relaxed">
            A fresh mix tuned to your taste, mood and languages. Press play and the AI DJ builds the rest.
          </p>
          <div className="mt-5 flex items-center gap-2.5">
            <button
              onClick={() => heroSongs.length && playQueueFeed(heroSongs, 0)}
              disabled={!heroSongs.length}
              aria-label="Play your Aura Mix"
              className="inline-flex items-center gap-2 px-7 py-3 rounded-full btn-primary shadow-glow transition hover:bg-ember-400 active:scale-95 disabled:opacity-50"
            >
              <PlayIcon className="w-4 h-4 ml-0.5" /> Play
            </button>
            <button
              onClick={() => navigate('/made-for-you')}
              className="px-5 py-3 rounded-full btn-secondary text-sm"
            >
              Made for you
            </button>
          </div>
        </div>
      </section>

      {/* 1. Continue Listening — pick up where you left off */}
      <SongShelf title="Continue Listening" explanation="Pick up where you left off" songs={dedupe(continueListening)} seeAllTo="/history" />

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

      {/* AI-designed shelves from taste + time-of-day */}
      {aiHome.isLoading ? (
        <ShelfSkeleton />
      ) : (
        aiHome.data?.map((shelf) => <SongShelf key={shelf.title} title={shelf.title} songs={dedupe(shelf.songs)} />)
      )}

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

      {/* 18. Seasonal shelf — only when a season/event matches "now" */}
      {seasonal.season && seasonal.data && seasonal.data.length > 0 && (
        <SongShelf title={seasonal.season.title} explanation="For the moment" songs={dedupe(seasonal.data)} />
      )}

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
                            src={bestImage(song.images, 150)}
                            onError={(e) => ((e.target as HTMLImageElement).src = FALLBACK_ART)}
                            alt=""
                            loading="lazy"
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

      {/* Time-of-day picks */}
      {timeShelf.isLoading ? (
        <ShelfSkeleton />
      ) : (
        <SongShelf title={timeShelf.title} explanation={`Based on your ${dayPartLabel()} sessions`} songs={dedupe(timeShelf.data ?? [])} />
      )}

      {/* 23. Recently Loved */}
      <SongShelf title="Recently Loved" explanation="Your latest favorites" songs={dedupe(favorites.slice(0, 12))} seeAllTo="/favorites" />

      {/* Endless feed: keep scrolling to load more songs forever. */}
      <section className="mt-2">
        <h2 className="text-xl md:text-2xl font-extrabold tracking-tight">More For You</h2>
        <p className="text-xs text-ink-400 mt-0.5 mb-3">
          Picks in your languages, ranked by your taste — scrolls forever
        </p>
        {feed.isLoading && <CardGridSkeleton />}
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-2">
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
    </div>
   </PullToRefresh>
  );
}
