import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { Outlet, useLocation, useNavigate, useNavigationType } from 'react-router-dom';
import { Sidebar } from '@/components/Sidebar';
import { ContextMenu } from '@/components/ContextMenu';
import { BottomNav } from '@/components/BottomNav';
import { MobileBackBar } from '@/components/MobileBackBar';
import { PlayerBar } from '@/components/PlayerBar';
import { Toasts } from '@/components/Toasts';
import { NowPlayingAnnouncer } from '@/components/NowPlayingAnnouncer';
import { NextUpCard } from '@/components/NextUpCard';
import { NowPlayingRail } from '@/components/NowPlayingRail';
import { AuroraBackground } from '@/components/AuroraBackground';
import { DiagBanner } from '@/components/DiagBanner';
import { OfflineBanner } from '@/components/OfflineBanner';
import { OnboardingSheet } from '@/components/OnboardingSheet';
import { AnnouncementBridge } from '@/components/AnnouncementBridge';
import { initTelemetry } from '@/services/analytics/telemetry';
import { applyGlassLevel, applyThemeClasses, resolveTheme } from '@/utils/theme';
import { closeTopOverlay } from '@/hooks/useDismissOnBack';
import { recallScroll, rememberScroll, restoreWhenTall } from '@/features/nav/scrollMemory';
import { loadBlocklist } from '@/services/content/blocklist';
import { initLockScreenLyrics } from '@/services/media-session/lockscreenLyrics';
import { initDownloads } from '@/services/downloads';
import { initSpatialNav } from '@/services/tv/spatialNav';
import { initAlarm } from '@/services/alarm';
import { ShortcutsModal } from '@/components/ShortcutsModal';
import { UpdateDialog } from '@/components/UpdateDialog';
// Boot overlays (festival splash, What's-New sheet) render at most once per
// day/release — lazy chunks, not first-load bytes (161KB budget, zero slack).
const FestiveSplash = lazy(() => import('@/components/FestiveSplash').then((m) => ({ default: m.FestiveSplash })));
const WhatsNewSheet = lazy(() => import('@/components/WhatsNewSheet').then((m) => ({ default: m.WhatsNewSheet })));
import { initAudioOutputWatcher } from '@/services/audio/outputWatcher';
import { audioEngine } from '@/services/audio/engine';
import { useCastStore } from '@/services/cast';
import { checkForUpdate } from '@/services/update';
import { useUpdateStore } from '@/store/updateStore';
import { PageSkeleton } from '@/components/Skeletons';
import { ErrorBoundary, PlayerErrorBoundary } from '@/components/ErrorBoundary';
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts';
import { usePlayerStore } from '@/store/playerStore';
import { useSettingsStore } from '@/store/settingsStore';
import { runMigrations } from '@/services/storage/local';
import { resolveRegion } from '@/services/location/inference';
import { readBrowserSignals } from '@/services/location/browserSignals';
import { defaultLanguagesForCountry } from '@/constants/regions';
import { isNativePlatform, requestNotificationPermissionOnce } from '@/services/native';
import { installDeterrence } from '@/utils/deterrence';

// Lazy: the palette costs nothing until the first ⌘/Ctrl+K.
const CommandPalette = lazy(() => import('@/components/CommandPalette'));

// Cold boot: the very first route render skips the page-enter fade so the
// hero (the LCP element) paints the moment React commits, ~250ms sooner on
// throttled mobile. Every navigation after that keeps the animation.
let hasBooted = false;

export function AppLayout() {
  const coldBoot = !hasBooted;

  const mainRef = useRef<HTMLElement>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);

  // ⌘/Ctrl+K opens the command palette (works while typing too, like the console).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // NOTE: the layout-level pull-to-refresh that lived here is GONE. It
  // predated <PullToRefresh> (HomePage) and the two ran simultaneously on
  // touch devices: one pull rendered BOTH spinners at different offsets
  // ("two loading animations"), and past ~128px raw drag it ALSO
  // refetched every active query on top of HomePage's own refresh. Worse,
  // it keyed off <main>'s scrollTop, which is permanently 0 on pages that
  // scroll an inner div (Now Playing lyrics, VinaX AI chat, Karaoke) — so
  // scrolling those fired spurious global refetches. PullToRefresh is the
  // single implementation now.

  // After a call (or any forced audio interruption), resume automatically the
  // moment the app is visible again — Android pauses us and won't restart on
  // its own, and nobody should have to press play after every phone call.
  useEffect(() => {
    const tryResume = () => {
      if (document.visibilityState !== 'visible') return;
      const st = usePlayerStore.getState();
      if (st.isPlaying || !st.queue.length) return;
      if (Date.now() - audioEngine.lastInterruptionAt < 30 * 60_000) {
        audioEngine.lastInterruptionAt = 0;
        st.togglePlay();
      }
    };
    document.addEventListener('visibilitychange', tryResume);
    return () => document.removeEventListener('visibilitychange', tryResume);
  }, []);
  const navigationType = useNavigationType();
  const theme = useSettingsStore((s) => s.theme);
  const accent = useSettingsStore((s) => s.accent);
  const glassLevel = useSettingsStore((s) => s.glassLevel);
  const glassBlur = useSettingsStore((s) => s.glassBlur);
  const dynamicTheme = useSettingsStore((s) => s.dynamicTheme);
  const currentAccent = usePlayerStore((s) => s.currentAccent);
  const density = useSettingsStore((s) => s.density);
  const location = useLocation();
  const navigate = useNavigate();
  const { pathname } = location;
  const isFullScreenPlayer = pathname === '/now-playing';
  useKeyboardShortcuts();

  // Android hardware back: close the topmost open overlay first (sheet, menu,
  // dialog — audit P0-2), then pop history, or minimize on the root screen.
  useEffect(() => {
    if (!isNativePlatform()) return;
    let remove: (() => void) | null = null;
    let removeUrl: (() => void) | null = null;
    void import('@capacitor/app').then(({ App }) => {
      void App.addListener('backButton', ({ canGoBack }) => {
        if (closeTopOverlay()) return;
        if (canGoBack && window.history.length > 1) window.history.back();
        else void App.minimizeApp();
      }).then((handle) => {
        remove = () => void handle.remove();
      });
      // Quick-play home-screen widget: its tap launches the activity with
      // ?widget=play. When the app is ALREADY running, that arrives here as
      // appUrlOpen — flag it and go Home; HomePage auto-plays the Aura Mix
      // once its hero songs are in. (Cold starts carry the param in the
      // initial URL and HomePage reads it directly.)
      void App.addListener('appUrlOpen', ({ url }) => {
        if (url && url.includes('widget=play')) {
          try { sessionStorage.setItem('vinax.widget-play', '1'); } catch { /* private mode */ }
          navigate('/');
        }
      }).then((handle) => {
        removeUrl = () => void handle.remove();
      });
    });
    return () => {
      remove?.();
      removeUrl?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // One-time bootstrap.
  useEffect(() => {
    hasBooted = true;
    const onIdle = (fn: () => void): void => {
      const ric = (window as Window & {
        requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
      }).requestIdleCallback;
      if (typeof ric === 'function') ric(fn, { timeout: 2000 });
      else window.setTimeout(fn, 200);
    };

    // Critical for the first interaction — run immediately.
    runMigrations();
    document.documentElement.classList.toggle('reduce-motion', useSettingsStore.getState().reduceMotion);
    usePlayerStore.getState().initEngine();
    // initEngine already synchronously imported the static `audioEngine` via
    // playerStore, so the dynamic import here is dead weight — use the same
    // static one and drop the extra microtask (audit finding M3).
    void import('@/store/outputStore').then((o) => {
      const sid = o.useOutputStore.getState().sinkId;
      if (sid) void audioEngine.setOutputDevice(sid);
    });

    // Everything else is non-blocking; defer to idle so first paint and
    // time-to-interactive stay fast on cold start.
    onIdle(() => {
      installDeterrence();
      initTelemetry();
      void loadBlocklist();
      initLockScreenLyrics();
      void initDownloads();
      initSpatialNav();
      initAlarm();
      initAudioOutputWatcher();
      useCastStore.getState().init();
      // Android 13+: media notification needs notification permission.
      void requestNotificationPermissionOnce();
      // Update gate (native only; no-op on web) + foreground re-check.
      void checkForUpdate().then((info) => useUpdateStore.getState().setInfo(info));
      void import('@capacitor/app').then(({ App }) => {
        void App.addListener('resume', () => {
          void checkForUpdate().then((info) => useUpdateStore.getState().setInfo(info));
        });
      });
    });

    const settings = useSettingsStore.getState();
    void resolveRegion({
      allowInference: settings.allowRegionInference,
      manualCountry: settings.manualCountry,
      manualRegionLabel: settings.manualRegionLabel,
    }).then((region) => {
      useSettingsStore.getState().setInferredRegion(region);
      // Cold start: seed language preferences from browser + country once
      // (the onboarding sheet may have already pinned languages).
      const current = useSettingsStore.getState();
      if (current.pinnedLanguages.length === 0) {
        const fromBrowser = readBrowserSignals().languages;
        const fromCountry = defaultLanguagesForCountry(region.country);
        const seeded = [...new Set([...fromBrowser, ...fromCountry])].slice(0, 3);
        if (seeded.length) current.setPinnedLanguages(seeded);
      }
    });
  }, []);

  // Two window-level hooks in one effect (first-load bytes are budgeted):
  // 1. Playback-notification tap (4.16.1, Android app): the native layer
  //    relays the launch intent's open-player extra as 'vinax:openplayer' —
  //    navigate to the full-screen player, unless it's already open.
  // 2. Wheel rescue (4.16.0, web): third-party scripts (ad quality scans,
  //    measurement helpers) can park invisible fixed elements directly under
  //    <body>, OUTSIDE #root. A wheel event landing on one of those bubbles
  //    to window but scrolls nothing — the page looks normal and is frozen
  //    (field report: home stuck at top). Everything we ship lives inside
  //    #root and manages its own scrolling, so a wheel whose target is NOT
  //    inside #root is by definition hitting an injected blocker — route it
  //    to <main>. Passive + additive: normal scrolling never takes this path.
  useEffect(() => {
    const open = () => {
      // window.location, NOT the router location: that closure would be stale.
      if (window.location.pathname !== '/now-playing') navigate('/now-playing');
    };
    window.addEventListener('vx:np', open);
    const onWheel = (e: WheelEvent) => {
      const m = mainRef.current;
      const root = document.getElementById('root');
      const t = e.target;
      if (!m || !root || !(t instanceof Node) || root.contains(t)) return;
      m.scrollBy({ top: e.deltaY });
    };
    if (!isNativePlatform()) window.addEventListener('wheel', onWheel, { passive: true });
    return () => {
      window.removeEventListener('vx:np', open);
      window.removeEventListener('wheel', onWheel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- navigate is stable
  }, []);

  // Navigation state (audit P0-3): new pages open at the top; back/forward
  // RESTORES the exact position. The scroller is our overflow <main> (the
  // browser can't see it), so positions are remembered per history entry and
  // replayed once the remounted page is tall enough to hold them.
  const locationKey = location.key;
  useEffect(() => {
    const el = mainRef.current;
    if (!el) return;
    const save = () => rememberScroll(locationKey, el.scrollTop);
    el.addEventListener('scroll', save, { passive: true });
    let cancel: (() => void) | undefined;
    if (navigationType === 'POP') {
      const target = recallScroll(locationKey);
      if (target > 0) cancel = restoreWhenTall(el, target);
    } else {
      el.scrollTo({ top: 0 });
    }
    return () => {
      el.removeEventListener('scroll', save);
      cancel?.();
    };
  }, [locationKey, navigationType]);

  useEffect(() => {
    const apply = () => {
      const resolved = resolveTheme(theme, window.matchMedia('(prefers-color-scheme: dark)').matches);
      applyThemeClasses(resolved);
      document.documentElement.dataset.accent = accent;
      document.documentElement.dataset.density = density;
      applyGlassLevel(glassLevel, glassBlur);

      // Dynamic accent (experimental, off by default): the artwork-tint math
      // lives in a lazy chunk so first-load users never pay for it.
      if (dynamicTheme && currentAccent) {
        void import('@/utils/dynamicAccent').then((m) => m.applyArtAccent(currentAccent));
      } else {
        const st = document.documentElement.style;
        st.removeProperty('--ember-500');
        st.removeProperty('--ember-400');
        st.removeProperty('--ember-600');
      }
    };
    apply();
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [theme, accent, density, glassLevel, glassBlur, dynamicTheme, currentAccent]);

  // Per-route canonical + index/noindex strategy (search & personal pages noindex).
  useEffect(() => {
    // Entity pages (song/album/artist/playlist) own their canonical via usePageMeta —
    // they point it at the slugged URL regardless of what the address bar says.
    if (!/^\/(song|album|artist|playlist)\//.test(pathname)) {
      // Canonical is pathname-only (never .search or .hash) — otherwise every
      // ?utm_source= visitor gets a separate canonical and search dilutes.
      const url = 'https://www.sirimillavinay.online' + pathname;
      let canon = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
      if (!canon) {
        canon = document.createElement('link');
        canon.rel = 'canonical';
        document.head.appendChild(canon);
      }
      canon.href = url;
    }
    const noindex = /^\/(search|library|favorites|history|queue|now-playing|stats|settings|taste-profile|offline|collection|cache-info)/.test(pathname);
    let robots = document.head.querySelector<HTMLMetaElement>('meta[name="robots"]');
    if (!robots) {
      robots = document.createElement('meta');
      robots.name = 'robots';
      document.head.appendChild(robots);
    }
    robots.content = noindex ? 'noindex,follow' : 'index,follow';
  }, [pathname]);

  return (
    <div className="h-dvh flex flex-col overflow-hidden">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:z-[100] focus:top-3 focus:left-3 focus:px-4 focus:py-2 focus:rounded-full focus:bg-ember-500 focus:text-black focus:font-bold"
      >
        Skip to content
      </a>
      <AuroraBackground />
      <div className="flex flex-1 min-h-0">
        <Sidebar />
        <main ref={mainRef} id="main-content" tabIndex={-1} className="flex-1 overflow-y-auto px-5 md:px-10 pt-6 pb-44 md:pb-28">
          <MobileBackBar />
          <DiagBanner />
          <OfflineBanner />
          <ErrorBoundary resetKey={pathname}>
            <Suspense fallback={<PageSkeleton />}>
              {/* Search keeps one mount across /search → /search/:q so
                  committing a query doesn't reset filters/scroll (P1-17);
                  every other route remounts for the page-enter animation. */}
              <div key={pathname.startsWith('/search') ? '/search' : pathname} className={coldBoot ? undefined : 'animate-fade-up'}>
                <Outlet />
              </div>
            </Suspense>
          </ErrorBoundary>
        </main>
        <PlayerErrorBoundary silent>
          <NowPlayingRail />
        </PlayerErrorBoundary>
      </div>
      <Toasts />
      <PlayerErrorBoundary silent>
        <NowPlayingAnnouncer />
        <NextUpCard />
      </PlayerErrorBoundary>
      <OnboardingSheet />
      <AnnouncementBridge />
      <ContextMenu />
      {paletteOpen && (
        <Suspense fallback={null}>
          <CommandPalette onClose={() => setPaletteOpen(false)} />
        </Suspense>
      )}
      {!isNativePlatform() && <ShortcutsModal />}
      {isNativePlatform() && <UpdateDialog />}
      <Suspense fallback={null}>
        <FestiveSplash />
        <WhatsNewSheet />
      </Suspense>
      {!isFullScreenPlayer && (
        <div className="fixed bottom-0 inset-x-0 z-40 pb-[env(safe-area-inset-bottom)]">
          <PlayerErrorBoundary>
            <PlayerBar />
          </PlayerErrorBoundary>
          <BottomNav />
        </div>
      )}
    </div>
  );
}
