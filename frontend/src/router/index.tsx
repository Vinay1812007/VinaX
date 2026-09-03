import { lazy, Suspense } from 'react';
import { SiteGate } from '@/components/SiteGate';
import { createBrowserRouter, Navigate } from 'react-router-dom';
import { AppLayout } from '@/layouts/AppLayout';
import { RouteError } from '@/components/ErrorBoundary';
import { HUB_LANGUAGES } from '@/constants/languages';
import { MOOD_HUBS } from '@/constants/hubs';
import { isNativePlatform } from '@/services/native';
import { useDownloadsStore } from '@/store/downloadsStore';

/**
 * v5.5.2 — native offline boot: opening the Android app with no internet used
 * to land on Home, which can do nothing without a network. When the listener
 * has saved songs, land them straight on the Downloads screen instead — the
 * one place the app is fully useful offline. Runs before the router is
 * created so the first render already IS the Downloads page (no flash, no
 * history entry back to a dead Home).
 */
function offlineBootRedirect(): void {
  try {
    if (!isNativePlatform()) return;
    if (navigator.onLine) return;
    if (window.location.pathname !== '/') return;
    const hasDownloads = Object.keys(useDownloadsStore.getState().items).length > 0;
    if (!hasDownloads) return;
    window.history.replaceState(null, '', '/offline');
  } catch {
    /* never let a boot nicety break boot */
  }
}
offlineBootRedirect();

// Route-based code splitting: every page is its own chunk.
const HomePage = lazy(() => import('@/pages/HomePage'));
const DiscoverPage = lazy(() => import('@/pages/DiscoverPage'));
const ChartsPage = lazy(() => import('@/pages/ChartsPage'));
const ChartLandingPage = lazy(() => import('@/pages/ChartLandingPage'));
const DownloadPage = lazy(() => import('@/pages/DownloadPage'));
const DriveModePage = lazy(() => import('@/pages/DriveModePage'));
const MadeForYouPage = lazy(() => import('@/pages/MadeForYouPage'));
const AIPlaylistPage = lazy(() => import('@/pages/AIPlaylistPage'));
const WeeklyMixPage = lazy(() => import('@/pages/WeeklyMixPage'));
const MixesPage = lazy(() => import('@/pages/MixesPage'));
const SearchPage = lazy(() => import('@/pages/SearchPage'));
const SongPage = lazy(() => import('@/pages/SongPage'));
const AlbumPage = lazy(() => import('@/pages/AlbumPage'));
const PlaylistPage = lazy(() => import('@/pages/PlaylistPage'));
const ArtistPage = lazy(() => import('@/pages/ArtistPage'));
const LyricsPage = lazy(() => import('@/pages/LyricsPage'));
const LibraryPage = lazy(() => import('@/pages/LibraryPage'));
const FavoritesPage = lazy(() => import('@/pages/FavoritesPage'));
const HistoryPage = lazy(() => import('@/pages/HistoryPage'));
const QueuePage = lazy(() => import('@/pages/QueuePage'));
const NowPlayingPage = lazy(() => import('@/pages/NowPlayingPage'));
const LanguagesPage = lazy(() => import('@/pages/LanguagesPage'));
const LanguageHubPage = lazy(() => import('@/pages/LanguageHubPage'));
const MoodHubPage = lazy(() => import('@/pages/MoodHubPage'));
const ExplorePage = lazy(() => import('@/pages/ExplorePage'));
const MoviesPage = lazy(() => import('@/pages/MoviesPage'));
const MoodsPage = lazy(() => import('@/pages/MoodsPage'));
const RegionsPage = lazy(() => import('@/pages/RegionsPage'));
const TasteProfilePage = lazy(() => import('@/pages/TasteProfilePage'));
const SettingsPage = lazy(() => import('@/pages/SettingsPage'));
const HandoffPage = lazy(() => import('@/pages/HandoffPage'));
const CacheInfoPage = lazy(() => import('@/pages/CacheInfoPage'));
const AboutPage = lazy(() => import('@/pages/AboutPage'));
const HelpPage = lazy(() => import('@/pages/HelpPage'));
const StatsPage = lazy(() => import('@/pages/StatsPage'));
const RecapPage = lazy(() => import('@/pages/RecapPage'));
const OfflinePage = lazy(() => import('@/pages/OfflinePage'));
const ListenTogetherPage = lazy(() => import('@/pages/ListenTogetherPage'));
const CollectionPage = lazy(() => import('@/pages/CollectionPage'));
const KaraokePage = lazy(() => import('@/pages/KaraokePage'));
const QuizPage = lazy(() => import('@/pages/QuizPage'));
const PrivacyPage = lazy(() => import('@/pages/PrivacyPage'));
const TermsPage = lazy(() => import('@/pages/TermsPage'));
const ContactPage = lazy(() => import('@/pages/ContactPage'));
const DmcaPage = lazy(() => import('@/pages/DmcaPage'));
const NotFoundPage = lazy(() => import('@/pages/NotFoundPage'));
const VinaXAIPage = lazy(() => import('@/pages/VinaXAIPage'));
// v5.7.6 — Ads placeholder page (sponsored placements configured later).
const AdsPage = lazy(() => import('@/pages/AdsPage'));
// v5.7.9 — music videos: browse + cinematic player.
const VideosPage = lazy(() => import('@/pages/VideosPage'));
const VideoPage = lazy(() => import('@/pages/VideoPage'));

export const router = createBrowserRouter([
  {
    path: '/VinaXAI',
    element: (
      <SiteGate>
      <Suspense fallback={<div className="h-[100dvh] grid place-items-center bg-ink-950 text-ink-300">Loading VinaX AI…</div>}>
        <VinaXAIPage />
      </Suspense>
      </SiteGate>
    ),
    errorElement: <RouteError />,
  },
  {
    path: '/',
    element: (
      <SiteGate>
        <AppLayout />
      </SiteGate>
    ),
    errorElement: <RouteError />,
    children: [
      { index: true, element: <HomePage /> },
      { path: 'home', element: <Navigate to="/" replace /> },
      { path: 'discover', element: <DiscoverPage /> },
      { path: 'charts', element: <ChartsPage /> },
      { path: 'top-songs', element: <ChartLandingPage variant="top" /> },
      { path: 'trending', element: <ChartLandingPage variant="trending" /> },
      { path: 'most-searched', element: <ChartLandingPage variant="most-searched" /> },
      { path: 'made-for-you', element: <MadeForYouPage /> },
      { path: 'ai-playlist', element: <AIPlaylistPage /> },
      { path: 'weekly', element: <WeeklyMixPage /> },
      { path: 'mixes', element: <MixesPage /> },
      { path: 'search', element: <SearchPage /> },
      { path: 'search/:query', element: <SearchPage /> },
      { path: 'song/:id', element: <SongPage /> },
      { path: 'album/:id', element: <AlbumPage /> },
      { path: 'playlist/:id', element: <PlaylistPage /> },
      { path: 'artist/:id', element: <ArtistPage /> },
      { path: 'lyrics/:id', element: <LyricsPage /> },
      { path: 'library', element: <LibraryPage /> },
      { path: 'favorites', element: <FavoritesPage /> },
      { path: 'history', element: <HistoryPage /> },
      { path: 'queue', element: <QueuePage /> },
      { path: 'now-playing', element: <NowPlayingPage /> },
      { path: 'languages', element: <LanguagesPage /> },
      ...HUB_LANGUAGES.map((l) => ({ path: `${l}-songs`, element: <LanguageHubPage language={l} /> })),
      // Mood x language landing pages (SEO category layer) — 72 routes.
      ...HUB_LANGUAGES.flatMap((l) =>
        MOOD_HUBS.map((m) => ({ path: `${l}-${m.slug}-songs`, element: <MoodHubPage language={l} mood={m} /> })),
      ),
      { path: 'explore', element: <ExplorePage /> },
      { path: 'movies', element: <MoviesPage /> },
      { path: 'moods', element: <MoodsPage /> },
      { path: 'regions', element: <RegionsPage /> },
      { path: 'taste-profile', element: <TasteProfilePage /> },
      { path: 'ads', element: <AdsPage /> },
      { path: 'videos', element: <VideosPage /> },
      { path: 'video/:id', element: <VideoPage /> },
      { path: 'settings', element: <SettingsPage /> },
      { path: 'handoff', element: <HandoffPage /> },
      { path: 'cache-info', element: <CacheInfoPage /> },
      { path: 'about', element: <AboutPage /> },
      { path: 'privacy', element: <PrivacyPage /> },
      { path: 'terms', element: <TermsPage /> },
      { path: 'contact', element: <ContactPage /> },
      { path: 'dmca', element: <DmcaPage /> },
      { path: 'help', element: <HelpPage /> },
      { path: 'stats', element: <StatsPage /> },
      { path: 'recap', element: <RecapPage /> },
      { path: 'offline', element: <OfflinePage /> },
      { path: 'together', element: <ListenTogetherPage /> },
      { path: 'collection/:id', element: <CollectionPage /> },
      { path: 'karaoke', element: <KaraokePage /> },
      { path: 'quiz', element: <QuizPage /> },
      { path: 'download', element: <DownloadPage /> },
      { path: 'drive', element: <DriveModePage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]);
