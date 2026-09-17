import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { RegionInfo } from '@/types';
import { KEYS } from '@/constants/storage-keys';
import type { AudioQualityPref } from '@/services/audio/engine';
import { guardedLocalStorage } from '@/services/storage/local';

export type DiscoveryMode = 'familiar' | 'balanced' | 'discover';

export function isDiscoveryMode(v: unknown): v is DiscoveryMode {
  return v === 'familiar' || v === 'balanced' || v === 'discover';
}

/** The effective mode, tolerant of a settings record restored from before 7.0 (no `discoveryMode`). */
export function resolveDiscoveryMode(s: { discoveryMode?: unknown; exploreMode?: unknown }): DiscoveryMode {
  return isDiscoveryMode(s.discoveryMode) ? s.discoveryMode : s.exploreMode === true ? 'discover' : 'balanced';
}

export interface SettingsState {
  theme: 'dark' | 'light' | 'system' | 'amoled' | 'auto';
  accent: string;
  /** v5.12.0 — daily listening goal in minutes (0 = off). */
  dailyGoalMinutes: number;
  /** v5.12.0 — radio-DJ voice: announces each song as it starts. */
  djVoice: boolean;
  /** 5.14.0 — festival skins (accent, canvas, glow, splash). Off = the plain theme all year. */
  festivalSkins: boolean;
  /** v5.17.0 — custom accent hex when `accent === 'custom'`. */
  accentCustom: string | null;
  /** v5.17.0 — display size: text and controls scale. */
  uiScale: 'sm' | 'md' | 'lg';
  /** v5.17.0 — data saver: lowest audio quality, no video canvas, lighter images. */
  dataSaver: boolean;
  /** v5.17.0 — which page opens first. */
  startPage: 'home' | 'search' | 'library' | 'last';
  /** v5.17.0 — high-contrast text and borders. */
  highContrast: boolean;
  /** 0-100 — iOS-style adjustable glass translucency (utils/theme.ts). */
  glassLevel: number;
  /** 0-100 — background blur intensity, independent from glassLevel. */
  glassBlur: number;
  autoplay: boolean;
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
  /**
   * v7.0.0 — Familiar / Balanced / Discover: how far recommendations roam.
   * Changes ranking (novelty vs. familiarity), the discovery share of a
   * queue, language drift and the exploration slots on Home. `exploreMode`
   * is kept in step (true ⇔ 'discover') so older backups and readers work.
   */
  discoveryMode: DiscoveryMode;
  /** v6.2.0 — AI DJ: the queue's next stretch is sequenced by the DJ engine
   *  (from real, already-filtered candidates); off = local recommender only. */
  aiDj: boolean;
  /** v6.2.0 — "Designed for you": AI-designed shelves on Home. */
  aiHomeShelves: boolean;
  /** v6.5.0 — the DJ drives every play: tapping a song starts it and the DJ
   *  builds the continuation, instead of following the tapped list. */
  djTakeover: boolean;
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
  /** v5.19.0 — sound effects master switch (Web Audio chain; graph code is a
   *  lazy chunk — services/audio/effects.ts). Off = plain element playback. */
  soundEffects: boolean;
  /** v5.19.0 — 5-band EQ gains in dB (60 / 250 / 1k / 4k / 12k), ±12. */
  eqGains: number[];
  /** v5.19.0 — EQ preset id ('flat', 'bass', …) or 'custom' after a manual tweak. */
  eqPreset: string;
  /** v5.19.0 — mono mix (accessibility). */
  mono: boolean;
  /** v5.19.0 — stereo balance, -1 (left) .. 1 (right). */
  balance: number;
  /** v5.19.0 — loudness normalisation (compressor). */
  normalize: boolean;

  setTheme(theme: 'dark' | 'light' | 'system' | 'amoled' | 'auto'): void;
  setDailyGoalMinutes(n: number): void;
  setDjVoice(v: boolean): void;
  setFestivalSkins(v: boolean): void;
  setAccentCustom(hex: string | null): void;
  setUiScale(v: 'sm' | 'md' | 'lg'): void;
  setDataSaver(v: boolean): void;
  setStartPage(v: 'home' | 'search' | 'library' | 'last'): void;
  setHighContrast(v: boolean): void;
  setAccent(accent: string): void;
  setGlassLevel(v: number): void;
  setGlassBlur(v: number): void;
  setAutoplay(v: boolean): void;
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
  setDiscoveryMode(v: DiscoveryMode): void;
  setAiDj(v: boolean): void;
  setAiHomeShelves(v: boolean): void;
  setDjTakeover(v: boolean): void;
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
  setSoundEffects(v: boolean): void;
  /** Clamps to five values in ±12 dB and marks the preset 'custom'. */
  setEqGains(gains: number[]): void;
  /** Select a preset; pass its gains too (the table lives in the lazy effects chunk). */
  setEqPreset(preset: string, gains?: number[]): void;
  setMono(v: boolean): void;
  setBalance(v: number): void;
  setNormalize(v: boolean): void;
  resetSettings(): void;
}

const EQ_BAND_COUNT = 5;
const EQ_LIMIT_DB = 12;
function clampEq(gains: readonly number[] | undefined): number[] {
  return Array.from({ length: EQ_BAND_COUNT }, (_, i) => {
    const g = gains?.[i];
    return Number.isFinite(g) ? Math.max(-EQ_LIMIT_DB, Math.min(EQ_LIMIT_DB, g as number)) : 0;
  });
}

const defaults = {
  theme: 'dark' as const,
  accent: 'crimson',
  dailyGoalMinutes: 0,
  djVoice: false,
  festivalSkins: true,
  accentCustom: null,
  uiScale: 'md' as const,
  dataSaver: false,
  startPage: 'home' as const,
  highContrast: false,
  glassLevel: 40,
  glassBlur: 40,
  autoplay: true,
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
  discoveryMode: 'balanced' as DiscoveryMode,
  aiDj: true,
  aiHomeShelves: true,
  djTakeover: true,
  kidMode: false,
  allowRegionInference: true,
  manualCountry: null,
  manualRegionLabel: null,
  inferredRegion: null,
  pinnedLanguages: [] as string[],
  mutedLanguages: [] as string[],
  sidebarCollapsed: false,
  soundEffects: false,
  eqGains: [0, 0, 0, 0, 0] as number[],
  eqPreset: 'flat',
  mono: false,
  balance: 0,
  normalize: false,
};

/** The persisted preference fields (no actions). */
export type SettingsData = typeof defaults;

const SETTINGS_ENUMS: Partial<Record<keyof SettingsData, readonly string[]>> = {
  theme: ['dark', 'light', 'system', 'amoled', 'auto'],
  uiScale: ['sm', 'md', 'lg'],
  startPage: ['home', 'search', 'library', 'last'],
  density: ['comfortable', 'compact'],
  audioQuality: ['low', 'medium', 'high'],
  lyricsSize: ['sm', 'md', 'lg', 'xl'],
  uiLanguage: ['en', 'te', 'hi', 'ta'],
  discoveryMode: ['familiar', 'balanced', 'discover'],
};
const SETTINGS_RANGES: Partial<Record<keyof SettingsData, readonly [number, number]>> = {
  dailyGoalMinutes: [0, 600],
  glassLevel: [0, 100],
  glassBlur: [0, 100],
  recommendationIntensity: [0, 1],
  balance: [-1, 1],
};
const NULLABLE_TEXT: ReadonlySet<string> = new Set(['accentCustom', 'manualCountry', 'manualRegionLabel']);

function pickRegion(v: unknown): RegionInfo | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const r = v as Record<string, unknown>;
  const text = (x: unknown) => (typeof x === 'string' ? x.slice(0, 80) : null);
  const source = r.source === 'edge' || r.source === 'browser' || r.source === 'manual' ? r.source : 'unknown';
  return { country: text(r.country), regionLabel: text(r.regionLabel), source };
}

/**
 * Whitelist a stored / restored settings record: only keys the app defines,
 * only when the value has the type the app expects (numbers finite and in
 * range, lists of strings, known enum members) — never a function and never
 * a key the defaults do not know. Anything else is left to the caller's
 * base (current state or defaults), so a hand-edited or damaged record can
 * no longer put `"crossfade": "yes"` or `"eqGains": {}` into the live store.
 */
export function pickSettings(incoming: unknown): Partial<SettingsData> {
  const out: Record<string, unknown> = {};
  if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) return out as Partial<SettingsData>;
  const rec = incoming as Record<string, unknown>;
  for (const key of Object.keys(defaults) as Array<keyof SettingsData>) {
    const want: unknown = defaults[key];
    const got = rec[key];
    if (got === undefined || typeof got === 'function') continue;
    if (NULLABLE_TEXT.has(key)) {
      if (got === null || typeof got === 'string') out[key] = typeof got === 'string' ? got.slice(0, 80) : null;
    } else if (key === 'inferredRegion') {
      if (got === null || typeof got === 'object') out[key] = pickRegion(got);
    } else if (Array.isArray(want)) {
      if (!Array.isArray(got)) continue;
      out[key] = key === 'eqGains' ? clampEq(got as number[]) : got.filter((x): x is string => typeof x === 'string').slice(0, 100);
    } else if (typeof want === 'number') {
      if (typeof got !== 'number' || !Number.isFinite(got)) continue;
      const range = SETTINGS_RANGES[key];
      out[key] = range ? Math.max(range[0], Math.min(range[1], got)) : got;
    } else if (typeof got === typeof want) {
      const allowed = SETTINGS_ENUMS[key];
      if (allowed && !allowed.includes(got as string)) continue;
      out[key] = typeof got === 'string' ? got.slice(0, 80) : got;
    }
  }
  // A record from before 7.0 has the explore switch but no discovery mode.
  if (out.discoveryMode === undefined && typeof rec.exploreMode === 'boolean') out.discoveryMode = resolveDiscoveryMode(rec);
  return out as Partial<SettingsData>;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set, get) => ({
      ...defaults,
      setTheme: (theme) => set({ theme }),
      setDailyGoalMinutes: (n) => set({ dailyGoalMinutes: Math.max(0, Math.min(600, Math.round(n))) }),
      setDjVoice: (djVoice) => set({ djVoice }),
      setFestivalSkins: (festivalSkins) => set({ festivalSkins }),
      setAccentCustom: (accentCustom) => set({ accentCustom, accent: accentCustom ? 'custom' : 'crimson' }),
      setUiScale: (uiScale) => set({ uiScale }),
      // Data saver also drops the stream to the lightest quality; turning it
      // off leaves the quality where the listener last set it.
      setDataSaver: (dataSaver) => set(dataSaver ? { dataSaver, audioQuality: 'low' } : { dataSaver }),
      setStartPage: (startPage) => set({ startPage }),
      setHighContrast: (highContrast) => set({ highContrast }),
      setAccent: (accent) => set({ accent }),
      setGlassLevel: (v) => set({ glassLevel: Math.min(100, Math.max(0, Math.round(v))) }),
      setGlassBlur: (v) => set({ glassBlur: Math.min(100, Math.max(0, Math.round(v))) }),
      setAutoplay: (autoplay) => set({ autoplay }),
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
      setExploreMode: (exploreMode) => set({ exploreMode, discoveryMode: exploreMode ? 'discover' : 'balanced' }),
      setDiscoveryMode: (mode) => {
        const discoveryMode = isDiscoveryMode(mode) ? mode : 'balanced';
        set({ discoveryMode, exploreMode: discoveryMode === 'discover' });
      },
      setAiDj: (aiDj) => set({ aiDj }),
      setAiHomeShelves: (aiHomeShelves) => set({ aiHomeShelves }),
      setDjTakeover: (djTakeover) => set({ djTakeover }),
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
      // v5.19.0 — sound effects. The engine/graph is driven by a subscription
      // in services/audio/effectsBridge.ts (lazy), never from here.
      setSoundEffects: (soundEffects) => set({ soundEffects }),
      setEqGains: (gains) => set({ eqGains: clampEq(gains), eqPreset: 'custom' }),
      setEqPreset: (eqPreset, gains) => set(gains ? { eqPreset, eqGains: clampEq(gains) } : { eqPreset }),
      setMono: (mono) => set({ mono }),
      setBalance: (v) => set({ balance: Number.isFinite(v) ? Math.max(-1, Math.min(1, v)) : 0 }),
      setNormalize: (normalize) => set({ normalize }),
      resetSettings: () => set({ ...defaults }),
    }),
    {
      name: KEYS.settings,
      version: 4,
      // One-time migrations: turn off artwork-tinting (v1) and reset to the
      // single brand accent (v2) when the old picker was removed. The picker
      // RETURNED in 4.7.0 with per-accent light ramps — v2 stays as-is so
      // long-time devices keep the default until they choose again.
      // v3 removes retired queue/layout preferences and generated Home caches.
      migrate: (persisted: unknown, version: number) => {
        const state = (persisted ?? {}) as Partial<SettingsState>;
        if (version < 1) state.dynamicTheme = false;
        if (version < 2) state.accent = 'crimson';
        // v4 (7.0.0) — the explore switch became the three-way discovery mode.
        if (version < 4 || !isDiscoveryMode(state.discoveryMode)) state.discoveryMode = state.exploreMode ? 'discover' : 'balanced';
        const legacy = state as Partial<SettingsState> & Record<string, unknown>;
        delete legacy.autoqueueSimilar;
        delete legacy.hiddenHome;
        delete legacy.homeOrder;
        try {
          window.localStorage.removeItem('vinax.home.shown.v1');
          window.localStorage.removeItem('vinax.aihome.recent.v1');
        } catch { /* storage may be unavailable */ }
        return state as SettingsState;
      },
      storage: createJSONStorage(() => guardedLocalStorage),
      // The stored record is never trusted: start from the live defaults and
      // take only known keys of the right type (see pickSettings).
      merge: (persisted, current) => ({ ...current, ...pickSettings(persisted) }),
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
