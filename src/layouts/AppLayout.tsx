import { useQueryClient } from '@tanstack/react-query';
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { Outlet, useLocation, useNavigationType } from 'react-router-dom';
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
import { applyThemeClasses, resolveTheme } from '@/utils/theme';
import { loadBlocklist } from '@/services/content/blocklist';
import { initLockScreenLyrics } from '@/services/media-session/lockscreenLyrics';
import { initDownloads } from '@/services/downloads';
import { initSpatialNav } from '@/services/tv/spatialNav';
import { initAlarm } from '@/services/alarm';
import { ShortcutsModal } from '@/components/ShortcutsModal';
import { UpdateDialog } from '@/components/UpdateDialog';
import { FestiveSplash } from '@/components/FestiveSplash';
import { WhatsNewSheet } from '@/components/WhatsNewSheet';
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

export function AppLayout() {
  const mainRef = useRef<HTMLElement>(null);
  const queryClient = useQueryClient();
  // Pull-to-refresh (touch): pull px while dragging, -1 while refreshing.
  const [ptr, setPtr] = useState(0);
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

  useEffect(() => {
    const el = mainRef.current;
    if (!el || !window.matchMedia('(pointer: coarse)').matches) return;
    let startY = 0;
    let pulling = false;
    const onStart = (e: TouchEvent) => {
      if (el.scrollTop <= 0) {
        startY = e.touches[0].clientY;
        pulling = true;
      }
    };
    const onMove = (e: TouchEvent) => {
      if (!pulling) return;
      const dy = e.touches[0].clientY - startY;
      if (el.scrollTop > 0 || dy <= 0) {
        setPtr(0);
        return;
      }
      setPtr(Math.min(110, dy * 0.5));
    };
    const onEnd = () => {
      if (!pulling) return;
      pulling = false;
      setPtr((cur) => {
        if (cur > 64) {
          void queryClient.refetchQueries({ type: 'active' }).finally(() => setPtr(0));
          return -1;
        }
        return 0;
      });
    };
    el.addEventListener('touchstart', onStart, { passive: true });
    el.addEventListener('touchmove', onMove, { passive: true });
    el.addEventListener('touchend', onEnd);
    return () => {
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchmove', onMove);
      el.removeEventListener('touchend', onEnd);
    };
  }, [queryClient]);

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
  const dynamicTheme = useSettingsStore((s) => s.dynamicTheme);
  const currentAccent = usePlayerStore((s) => s.currentAccent);
  const density = useSettingsStore((s) => s.density);
  const { pathname } = useLocation();
  const isFullScreenPlayer = pathname === '/now-playing';
  useKeyboardShortcuts();

  // Android hardware back: pop history, or minimize on the root screen.
  useEffect(() => {
    if (!isNativePlatform()) return;
    let remove: (() => void) | null = null;
    void import('@capacitor/app').then(({ App }) => {
      void App.addListener('backButton', ({ canGoBack }) => {
        if (canGoBack && window.history.length > 1) window.history.back();
        else void App.minimizeApp();
      }).then((handle) => {
        remove = () => void handle.remove();
      });
    });
    return () => remove?.();
  }, []);

  // One-time bootstrap.
  useEffect(() => {
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

  // Clean navigation: new pages open at the top; browser-back keeps position.
  useEffect(() => {
    if (navigationType !== 'POP') mainRef.current?.scrollTo({ top: 0 });
  }, [pathname, navigationType]);

  useEffect(() => {
    const apply = () => {
      const resolved = resolveTheme(theme, window.matchMedia('(prefers-color-scheme: dark)').matches);
      applyThemeClasses(resolved);
      document.documentElement.dataset.accent = accent;
      document.documentElement.dataset.density = density;

      // Apply dynamic accent if enabled and available
      if (dynamicTheme && currentAccent) {
        // Hex-to-rgb conversion with validation guard
        const hex = currentAccent.replace('#', '');
        if (!/^[0-9A-Fa-f]{6}$/.test(hex)) {
          // Malformed extracted colour: clear any stale dynamic override.
          document.documentElement.style.removeProperty('--ember-500');
          document.documentElement.style.removeProperty('--ember-400');
          document.documentElement.style.removeProperty('--ember-600');
          return;
        }
        const r = parseInt(hex.substring(0, 2), 16);
        const g = parseInt(hex.substring(2, 4), 16);
        const b = parseInt(hex.substring(4, 6), 16);
        const rgb = `${r} ${g} ${b}`;
        document.documentElement.style.setProperty('--ember-500', rgb);
        // Brighten slightly for 400
        const b400 = `${Math.min(255, r + 40)} ${Math.min(255, g + 40)} ${Math.min(255, b + 40)}`;
        document.documentElement.style.setProperty('--ember-400', b400);
        // Darken for 600
        const d600 = `${Math.max(0, r - 40)} ${Math.max(0, g - 40)} ${Math.max(0, b - 40)}`;
        document.documentElement.style.setProperty('--ember-600', d600);
      } else {
        document.documentElement.style.removeProperty('--ember-500');
        document.documentElement.style.removeProperty('--ember-400');
        document.documentElement.style.removeProperty('--ember-600');
      }
    };
    apply();
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [theme, accent, density, dynamicTheme, currentAccent]);

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
        {ptr !== 0 && (
          <div
            className="pointer-events-none fixed left-1/2 -translate-x-1/2 z-40 md:hidden transition-transform"
            style={{ top: `calc(var(--safe-top) + ${ptr === -1 ? 18 : Math.max(2, ptr - 24)}px)` }}
          >
            <span
              className={`flex items-center justify-center w-9 h-9 rounded-full glass-navbar shadow-lift ${ptr === -1 ? 'animate-spin' : ''}`}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" className="w-5 h-5 text-ember-300">
                <path d="M21 12a9 9 0 1 1-3-6.7" />
                <path d="M21 3v6h-6" />
              </svg>
            </span>
          </div>
        )}
        <main ref={mainRef} id="main-content" tabIndex={-1} className="flex-1 overflow-y-auto px-5 md:px-10 pt-6 pb-44 md:pb-28">
          <MobileBackBar />
          <DiagBanner />
          <OfflineBanner />
          <ErrorBoundary>
            <Suspense fallback={<PageSkeleton />}>
              <div key={pathname} className="animate-fade-up">
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
      <FestiveSplash />
      <WhatsNewSheet />
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
