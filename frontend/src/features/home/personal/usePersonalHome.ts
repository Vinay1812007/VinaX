/**
 * The personal Home as a query: on while signed in with the engine on,
 * keyed by the Home generation so "Refresh Home" asks the server for a new
 * page (`fresh`), and by the discovery mode so Familiar / Balanced /
 * Discover reach the model. A 204 (the model knows too little yet) and any
 * failure both read as "no personal page": the on-device Home shows alone.
 */
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAccount } from '@/components/useAccount';
import { useSettingsStore } from '@/store/settingsStore';
import { fetchPersonalHome, personalEnabled } from '@/services/personal/api';
import { activeFestivalMusic } from '@/services/recommendation/festival';
import { toSong } from '@/services/personal/types';
import type { PersonalHomePage, PersonalShelf } from '@/services/personal/types';
import type { Song } from '@/types';

export interface PersonalShelfView extends PersonalShelf { items: Song[] }

export interface PersonalHomeView {
  page: PersonalHomePage;
  shelves: PersonalShelfView[];
}

export function usePersonalHome(generation: number): { view: PersonalHomeView | null; loading: boolean; enabled: boolean } {
  const account = useAccount();
  const on = useSettingsStore((s) => s.personalEngine);
  const kid = useSettingsStore((s) => s.kidMode);
  const mode = useSettingsStore((s) => s.discoveryMode);
  const enabled = !!account && on && !kid && personalEnabled();
  // The first generation of a visit serves the saved page; a later one (a refresh) asks for a new page.
  const [firstGeneration] = useState(generation);
  const fresh = generation !== firstGeneration;
  const query = useQuery({
    queryKey: ['personal-home', account?.user.email ?? '', mode, generation],
    enabled,
    staleTime: 30 * 60_000,
    gcTime: 60 * 60_000,
    retry: 0,
    queryFn: async ({ signal }) => {
      try {
        const page = await fetchPersonalHome({ fresh, mode, festival: activeFestivalMusic(new Date())?.id ?? null, signal });
        if (!page) return null;
        return { page, shelves: page.shelves.map((s) => ({ ...s, items: s.songs.map(toSong) })) } satisfies PersonalHomeView;
      } catch {
        return null;
      }
    },
  });
  // A sign-out or the switch going off drops the page at once.
  const [, bump] = useState(0);
  useEffect(() => { bump((n) => n + 1); }, [enabled]);
  return { view: enabled ? query.data ?? null : null, loading: enabled && query.isPending, enabled };
}
