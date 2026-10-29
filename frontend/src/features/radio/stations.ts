import { useQuery } from '@tanstack/react-query';
import type { Song } from '@/types';
import {
  getRadioStations,
  nextStationSongs,
  startArtistRadio,
  startFeaturedStation,
  type FeedOpts,
  type RadioSession,
  type RadioStation,
} from '@/services/api';
import { RADIO_SEED_MAX, usePlayerStore, type RadioFeed } from '@/store/playerStore';
import { isSongBlocked, useLibraryStore } from '@/store/libraryStore';
import { isValidSong } from '@/store/playerGuards';
import { useSettingsStore } from '@/store/settingsStore';

/**
 * 1.3 — catalogue stations (featured ones like "Retro Spin", and an artist's
 * radio). A station starts like AI Radio — playerStore.startRadio with its
 * first songs as seeds — and hands the player a `feed`: the rest of the
 * opening batch, then the station's next songs. The player asks the feed
 * whenever its queue is about to run out (the same top-up as the DJ's), and
 * the DJ carries on if the station stops answering.
 */

/** Songs asked for when a station opens, and per call after that. */
const START_LIMIT = 15;
const NEXT_LIMIT = 10;

type NextFn = (stationId: string, limit: number, opts?: FeedOpts) => Promise<Song[]>;

/** The station's continuation: what the opening batch left over, then the station's next songs. */
export function stationFeed(stationId: string | null, rest: Song[], next: NextFn = nextStationSongs): RadioFeed {
  const buffer = [...rest];
  return async (limit, signal) => {
    if (!buffer.length && stationId) buffer.push(...(await next(stationId, Math.max(limit, NEXT_LIMIT), { signal })));
    return buffer.splice(0, Math.max(1, limit));
  };
}

/**
 * Open a station and play it. Rejects when the catalogue cannot open one or
 * nothing on it can play, so the caller can fall back to what it did before.
 */
export async function playStation(open: () => Promise<RadioSession>, next: NextFn = nextStationSongs): Promise<Song[]> {
  const session = await open();
  const library = useLibraryStore.getState();
  const songs = session.songs.filter((s) => isValidSong(s) && !isSongBlocked(s, library));
  if (!songs.length) throw new Error('station_empty');
  const head = songs.slice(0, RADIO_SEED_MAX);
  usePlayerStore.getState().startRadio(head[0], { seeds: head.slice(1), feed: stationFeed(session.stationId, songs.slice(RADIO_SEED_MAX), next) });
  return head;
}

export function playFeaturedStation(station: Pick<RadioStation, 'name' | 'language'>, opts?: FeedOpts): Promise<Song[]> {
  return playStation(() => startFeaturedStation(station.name, station.language, START_LIMIT, opts));
}

export function playArtistStation(artistId: string, opts?: FeedOpts): Promise<Song[]> {
  return playStation(() => startArtistRadio(artistId, START_LIMIT, opts));
}

/** Featured stations in the listener's pinned languages; an error (hidden by the page) when the catalogue has none. */
export function useRadioStations() {
  const pinned = useSettingsStore((s) => s.pinnedLanguages);
  const langs = pinned.join(',');
  return useQuery({
    queryKey: ['radio-stations', langs],
    queryFn: ({ signal }) => getRadioStations(pinned, { signal }),
    staleTime: 60 * 60_000,
    retry: false,
  });
}
