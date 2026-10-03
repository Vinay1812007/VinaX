import { useQuery } from '@tanstack/react-query';
import { getSong } from '@/services/api';
import { useSettingsStore } from '@/store/settingsStore';
import { songKey } from '@/services/recommendation/songIdentity';
import { exposureLedger } from '@/services/recommendation/exposure';
import { useEvidenceStore } from '@/store/evidenceStore';
import type { Song } from '@/types';
import { useHomeGeneration } from './homeRefresh';

/**
 * 9.1.0 — Home's one EVIDENCE-BACKED shelf: songs a current web source or a
 * verified chart actually named, resolved to real catalogue recordings.
 *
 * It exists because Home's other "current-sounding" shelves are not current in
 * any verifiable sense. "Popular picks for you", "Trending · Telugu" and "New
 * releases" are catalogue searches for popular-sounding words, ordered by taste —
 * which is useful, and is exactly how they are labelled since 9.1. This shelf is
 * the other thing: outside evidence, with the source and the time it was observed
 * attached to each song.
 *
 * Honesty rules:
 *   - nothing is shown unless it resolved to a playable catalogue song;
 *   - the shelf's note says how old the evidence is, and says so plainly when it
 *     is stale;
 *   - when the service is unconfigured, resting or empty, the shelf renders
 *     NOTHING rather than a sad empty state — the catalogue shelves below are
 *     already accurately labelled, and that is the fallback.
 */
export const CURRENT_NOW_LIMIT = 12;

export interface CurrentNow {
  songs: Song[];
  /** A short note for the shelf, or '' when the evidence is fresh. */
  note: string;
  /** True when the server said its evidence is past the freshness horizon. */
  stale: boolean;
  isLoading: boolean;
}

export function useCurrentNow(enabled = true): CurrentNow {
  const generation = useHomeGeneration();
  const region = useSettingsStore((s) => s.manualCountry ?? s.inferredRegion?.country ?? null);
  const language = useSettingsStore((s) => s.pinnedLanguages[0] ?? null);

  const query = useQuery({
    queryKey: ['current-now', generation, region, language],
    enabled,
    // The server's own cache window is a day; this is the in-app leash.
    staleTime: 30 * 60_000,
    gcTime: 60 * 60_000,
    queryFn: async (): Promise<{ songs: Song[]; note: string; stale: boolean }> => {
      const [{ fetchDiscoveries, discoveryLabel, discoveryStateNote }] = await Promise.all([import('@/services/discovery/client')]);
      const snapshot = await fetchDiscoveries({
        ...(region ? { region } : {}),
        ...(language ? { language } : {}),
        intent: 'trending-songs',
        // Home must never wait on a web search: a cold cache simply means the
        // shelf is absent this visit and present on the next one.
        wait: false,
      });
      if (!snapshot?.items.length) return { songs: [], note: snapshot ? discoveryStateNote(snapshot) : '', stale: false };
      const ledger = exposureLedger();
      const songs: Song[] = [];
      const evidence: Array<[string, { kind: 'web'; label: string; url: string | null; observedAt: string | null; period: string | null }]> = [];
      for (const item of snapshot.items) {
        if (songs.length >= CURRENT_NOW_LIMIT) break;
        // A song the listener has met very recently belongs on a personal shelf,
        // not on the one that exists to show them what is new.
        const song = await getSong(item.catalogId).then((s) => s ?? null).catch(() => null);
        if (!song || ledger.cooling(songKey(song))) continue;
        songs.push(song);
        const first = item.evidence[0];
        evidence.push([
          song.id,
          { kind: 'web', label: discoveryLabel(item), url: first?.url ?? null, observedAt: first?.observedAt ?? null, period: first?.period ?? null },
        ]);
      }
      // So the track menu can offer "Open the source" for these songs too.
      if (evidence.length) useEvidenceStore.getState().setEvidence('web', evidence);
      return { songs, note: snapshot.stale ? 'This evidence is a few hours old.' : '', stale: snapshot.stale };
    },
  });

  return {
    songs: query.data?.songs ?? [],
    note: query.data?.note ?? '',
    stale: query.data?.stale ?? false,
    isLoading: query.isLoading,
  };
}
