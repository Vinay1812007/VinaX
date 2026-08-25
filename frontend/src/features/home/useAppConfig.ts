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
