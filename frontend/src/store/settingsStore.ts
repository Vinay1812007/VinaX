import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { RegionInfo } from '@/types';
import { KEYS } from '@/constants/storage-keys';
import type { AudioQualityPref } from '@/services/audio/engine';

export interface SettingsState {
  theme: 'dark' | 'light' | 'system' | 'amoled';
  accent: string;
  /** 0-100 — iOS-style adjustable glass translucency (utils/theme.ts). */
  glassLevel: number;
  /** 0-100 — background blur intensity, independent from glassLevel. */
  glassBlur: number;
  autoplay: boolean;
  autoqueueSimilar: boolean;
  keepScreenOn: boolean;
  lockScreenLyrics: boolean;
  crossfade: boolean;
  crossfadeSeconds: number;
  haptics: boolean;
  density: 'comfortable' | 'compact';
  resumePlayback: boolean;
  audioQuality: AudioQualityPref;
  lyricsSize: 'sm' | 'md' | 'lg' | 'xl';
  uiLanguage: 'en' | 'te' | 'hi' | 'ta';
  dynamicTheme: boolean;
  reduceMotion: boolean;
  /** 0..1 — how aggressively recommendations personalize. */
  recommendationIntensity: number;
  /** Package A4 — explore mode: a ~15% discovery slot on taste-generic shelves. */
  exploreMode: boolean;
  /** Package C2 — Kid mode: hides explicit-flagged songs and switches to a
   *  separate taste profile. Favorites/downloads/settings stay shared. */
  kidMode: boolean;
  allowRegionInference: boolean;
  manualCountry: string | null;
  manualRegionLabel: string | null;
  /** Coarse, privacy-safe resolved region. Never an IP. */
  inferredRegion: RegionInfo | null;
  pinnedLanguages: string[];
  mutedLanguages: string[];
  sidebarCollapsed: boolean;
  /** Home builder (4.16.0): hidden block keys (see constants/homeBlocks).
   *  Mutations live in features/settings/homeLayout.ts (lazy chunk) — this
   *  first-load store only carries the state Home reads. */
  hiddenHome: string[];
  /** Home builder: custom block order; [] = default order. */
  homeOrder: string[];

  setTheme(theme: 'dark' | 'light' | 'system' | 'amoled'): void;
  setAccent(accent: string): void;
  setGlassLevel(v: number): void;
  setGlassBlur(v: number): void;
  setAutoplay(v: boolean): void;
  setAutoqueueSimilar(v: boolean): void;
  setKeepScreenOn(v: boolean): void;
  setLockScreenLyrics(v: boolean): void;
  setCrossfade(v: boolean): void;
  setCrossfadeSeconds(v: number): void;
  setHaptics(v: boolean): void;
  setDensity(v: 'comfortable' | 'compact'): void;
  setResumePlayback(v: boolean): void;
  setAudioQuality(q: AudioQualityPref): void;
  setLyricsSize(v: 'sm' | 'md' | 'lg' | 'xl'): void;
  setUiLanguage(v: 'en' | 'te' | 'hi' | 'ta'): void;
  setDynamicTheme(v: boolean): void;
  setReduceMotion(v: boolean): void;
  setRecommendationIntensity(v: number): void;
  setExploreMode(v: boolean): void;
  setKidMode(v: boolean): void;
  setAllowRegionInference(v: boolean): void;
  setManualCountry(c: string | null): void;
  setManualRegionLabel(r: string | null): void;
  setInferredRegion(r: RegionInfo | null): void;
  togglePinnedLanguage(id: string): void;
  toggleMutedLanguage(id: string): void;
  setPinnedLanguages(ids: string[]): void;
  setMutedLanguages(ids: string[]): void;
  toggleSidebar(): void;
  resetSettings(): void;
}

const defaults = {
  theme: 'dark' as const,
  accent: 'crimson',
  glassLevel: 40,
  glassBlur: 40,
  autoplay: true,
  autoqueueSimilar: true,
  keepScreenOn: true,
  lockScreenLyrics: true,
  crossfade: true,
  crossfadeSeconds: 5,
  haptics: true,
  density: 'comfortable' as const,
  resumePlayback: true,
  audioQuality: 'high' as AudioQualityPref,
  lyricsSize: 'md' as 'sm' | 'md' | 'lg' | 'xl',
  uiLanguage: 'en' as 'en' | 'te' | 'hi' | 'ta',
  dynamicTheme: false,
  reduceMotion: false,
  recommendationIntensity: 0.7,
  exploreMode: false,
  kidMode: false,
  allowRegionInference: true,
  manualCountry: null,
  manualRegionLabel: null,
  inferredRegion: null,
  pinnedLanguages: [] as string[],
  mutedLanguages: [] as string[],
  sidebarCollapsed: false,
  hiddenHome: [] as string[],
  homeOrder: [] as string[],
};

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set, get) => ({
      ...defaults,
      setTheme: (theme) => set({ theme }),
      setAccent: (accent) => set({ accent }),
      setGlassLevel: (v) => set({ glassLevel: Math.min(100, Math.max(0, Math.round(v))) }),
      setGlassBlur: (v) => set({ glassBlur: Math.min(100, Math.max(0, Math.round(v))) }),
      setAutoplay: (autoplay) => set({ autoplay }),
      setAutoqueueSimilar: (autoqueueSimilar) => set({ autoqueueSimilar }),
      setKeepScreenOn: (keepScreenOn) => set({ keepScreenOn }),
      setLockScreenLyrics: (lockScreenLyrics) => set({ lockScreenLyrics }),
      setCrossfade: (crossfade) => set({ crossfade }),
      setCrossfadeSeconds: (crossfadeSeconds) => set({ crossfadeSeconds }),
      setHaptics: (haptics) => set({ haptics }),
      setDensity: (density) => set({ density }),
      setResumePlayback: (resumePlayback) => set({ resumePlayback }),
      setAudioQuality: (audioQuality) => set({ audioQuality }),
      setLyricsSize: (lyricsSize) => set({ lyricsSize }),
      setUiLanguage: (uiLanguage) => set({ uiLanguage }),
      setDynamicTheme: (dynamicTheme) => set({ dynamicTheme }),
      setReduceMotion: (reduceMotion) => set({ reduceMotion }),
      setRecommendationIntensity: (v) =>
        set({ recommendationIntensity: Math.min(1, Math.max(0, v)) }),
      setExploreMode: (exploreMode) => set({ exploreMode }),
      setKidMode: (kidMode) => set({ kidMode }),
      setAllowRegionInference: (allowRegionInference) => set({ allowRegionInference }),
      setManualCountry: (manualCountry) => set({ manualCountry }),
      setManualRegionLabel: (manualRegionLabel) => set({ manualRegionLabel }),
      setInferredRegion: (inferredRegion) => set({ inferredRegion }),
      togglePinnedLanguage: (id) => {
        const { pinnedLanguages, mutedLanguages } = get();
        const pinned = pinnedLanguages.includes(id)
          ? pinnedLanguages.filter((l) => l !== id)
          : [...pinnedLanguages, id];
        set({ pinnedLanguages: pinned, mutedLanguages: mutedLanguages.filter((l) => l !== id) });
      },
      toggleMutedLanguage: (id) => {
        const { pinnedLanguages, mutedLanguages } = get();
        const muted = mutedLanguages.includes(id)
          ? mutedLanguages.filter((l) => l !== id)
          : [...mutedLanguages, id];
        set({ mutedLanguages: muted, pinnedLanguages: pinnedLanguages.filter((l) => l !== id) });
      },
      setPinnedLanguages: (pinnedLanguages) => set({ pinnedLanguages }),
      setMutedLanguages: (mutedLanguages) => set({ mutedLanguages }),
      toggleSidebar: () => set({ sidebarCollapsed: !get().sidebarCollapsed }),
      resetSettings: () => set({ ...defaults }),
    }),
    {
      name: KEYS.settings,
      version: 2,
      // One-time migrations: turn off artwork-tinting (v1) and reset to the
      // single brand accent (v2) when the old picker was removed. The picker
      // RETURNED in 4.7.0 with per-accent light ramps — v2 stays as-is so
      // long-time devices keep the default until they choose again.
      migrate: (persisted: unknown, version: number) => {
        const state = (persisted ?? {}) as Partial<SettingsState>;
        if (version < 1) state.dynamicTheme = false;
        if (version < 2) state.accent = 'crimson';
        return state as SettingsState;
      },
      storage: createJSONStorage(() => window.localStorage),
    },
  ),
);

export function resolvedRegion(): RegionInfo | null {
  const s = useSettingsStore.getState();
  if (s.manualCountry) {
    return { country: s.manualCountry, regionLabel: s.manualRegionLabel, source: 'manual' };
  }
  return s.inferredRegion;
}
