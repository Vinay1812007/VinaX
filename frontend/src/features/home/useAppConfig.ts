import { useQuery } from '@tanstack/react-query';
import { isNativePlatform } from '@/services/native';

/**
 * Client read side of the admin-published app config (/api/appconfig).
 * Banners: what Home shows in the promo slot. Home config: the server
 * DEFAULT order/visibility for Home blocks — a listener's own Settings →
 * Home layout always wins on their device.
 */
const BASE = isNativePlatform() ? 'https://www.sirimillavinay.online' : '';

export interface PromoBannerData {
  id?: string;
  title: string;
  subtitle?: string;
  linkType?: 'song' | 'album' | 'playlist' | 'artist';
  linkId?: string;
  img?: string;
}

export interface ServerHomeConfig {
  blocks?: Array<{ id: string; enabled?: boolean }>;
}

export function useBanners() {
  return useQuery({
    queryKey: ['app-banners'],
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
    retry: 1,
    queryFn: async (): Promise<PromoBannerData[]> => {
      const r = await fetch(`${BASE}/api/appconfig?key=banners`);
      if (!r.ok) return [];
      const j = (await r.json()) as { banners?: PromoBannerData[] };
      return Array.isArray(j.banners) ? j.banners.filter((b) => b && b.title) : [];
    },
  });
}

export function useServerHomeConfig() {
  return useQuery({
    queryKey: ['home-config'],
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
    retry: 1,
    queryFn: async (): Promise<ServerHomeConfig | null> => {
      const r = await fetch(`${BASE}/api/appconfig?key=home-config`);
      if (!r.ok) return null;
      const j = (await r.json()) as { config?: ServerHomeConfig | null };
      return j.config ?? null;
    },
  });
}

export interface FestivalOverrideConfig {
  mode?: 'auto' | 'off' | 'force';
  id?: string;
}

/**
 * Festival theme override published from the admin Festival Themes panel.
 * null / 'auto' keeps the built-in calendar; 'force' skins the app with the
 * chosen festival immediately; 'off' suppresses skins even inside a window.
 */
export function useFestivalOverride() {
  return useQuery({
    queryKey: ['festival-override'],
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
    retry: 1,
    queryFn: async (): Promise<FestivalOverrideConfig | null> => {
      const r = await fetch(`${BASE}/api/appconfig?key=festival`);
      if (!r.ok) return null;
      const j = (await r.json()) as { festival?: FestivalOverrideConfig | null };
      return j.festival && typeof j.festival === 'object' ? j.festival : null;
    },
  });
}

/**
 * v5.13.0 — feature flags published from the admin console (Settings →
 * Feature Flags). Every flag is ON unless the admin switched it off, so a
 * missing key, a failed fetch or an offline device all behave like the
 * default app. Read with `flagOn(flags, 'codeRun')`.
 */
export type FeatureFlags = Record<string, boolean>;

export function flagOn(flags: FeatureFlags | undefined, key: string): boolean {
  return flags?.[key] !== false;
}

export function useFeatureFlags(): FeatureFlags {
  const q = useQuery({
    queryKey: ['feature-flags'],
    staleTime: 60_000,
    gcTime: 30 * 60_000,
    retry: 1,
    queryFn: async (): Promise<FeatureFlags> => {
      const r = await fetch(`${BASE}/api/appconfig?key=flags`);
      if (!r.ok) return {};
      const j = (await r.json()) as { flags?: FeatureFlags };
      return j.flags && typeof j.flags === 'object' ? j.flags : {};
    },
  });
  return q.data ?? {};
}

/** v5.15.0 — everything the admin console publishes for the app, in one read. */
export interface ClientConfig {
  greeting: { text: string } | null;
  broadcast: { id: string; text: string; link?: string } | null;
  synonyms: Record<string, string>;
  disabledSources: string[];
  languageOrder: string[];
  aiStarters: string[];
  aiQuick: Array<{ icon: string; label: string; prompt: string; mode?: string }>;
  faq: Array<{ q: string; a: string }>;
  minBuild: number | null;
}

export function useClientConfig(): ClientConfig | null {
  const q = useQuery({
    queryKey: ['client-config'],
    staleTime: 60_000,
    gcTime: 30 * 60_000,
    retry: 1,
    queryFn: async (): Promise<ClientConfig | null> => {
      const r = await fetch(`${BASE}/api/appconfig?key=client`);
      if (!r.ok) return null;
      const j = (await r.json()) as Partial<ClientConfig>;
      return {
        greeting: j.greeting ?? null,
        broadcast: j.broadcast ?? null,
        synonyms: j.synonyms && typeof j.synonyms === 'object' ? j.synonyms : {},
        disabledSources: Array.isArray(j.disabledSources) ? j.disabledSources : [],
        languageOrder: Array.isArray(j.languageOrder) ? j.languageOrder : [],
        aiStarters: Array.isArray(j.aiStarters) ? j.aiStarters : [],
        aiQuick: Array.isArray(j.aiQuick) ? j.aiQuick : [],
        faq: Array.isArray(j.faq) ? j.faq : [],
        minBuild: typeof j.minBuild === 'number' ? j.minBuild : null,
      };
    },
  });
  return q.data ?? null;
}
