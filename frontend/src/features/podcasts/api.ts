import type { Song } from '@/types';
import { episodeToSong, getPodcastEpisodes, orchestratedRequest } from '@/services/api';
import { unwrap } from '@/services/api/normalize';
import { usePlayerStore } from '@/store/playerStore';
import { toast } from '@/store/toastStore';
import { decodeHtml } from '@/utils/format';

/**
 * 1.3 — an episode as the podcast page lists it: the playable Song plus the
 * date, number and summary the Song model has no room for. Same route as
 * getPodcastEpisodes, read once into both.
 */
export interface Episode {
  song: Song;
  description: string | null;
  /** "2017-10-11" as the catalogue sends it. */
  releaseDate: string | null;
  number: number | null;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function toEpisode(raw: any): Episode | null {
  const song = episodeToSong(raw);
  if (!song) return null;
  const n = Number(raw.episodeNumber);
  return {
    song,
    description: typeof raw.description === 'string' && raw.description.trim() ? decodeHtml(raw.description.trim()) : null,
    releaseDate: typeof raw.releaseDate === 'string' && /^\d{4}-\d{2}-\d{2}/.test(raw.releaseDate) ? raw.releaseDate.slice(0, 10) : null,
    number: Number.isFinite(n) && n > 0 ? n : null,
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/** One page of a season's episodes (1-based). An empty list is the last page. */
export function getEpisodePage(
  id: string,
  { season, page = 1, limit = 20 }: { season?: number | null; page?: number; limit?: number },
  opts?: { signal?: AbortSignal },
): Promise<Episode[]> {
  const s = season != null ? `&season=${season}` : '';
  return orchestratedRequest({
    paths: [`/podcasts/${encodeURIComponent(id)}/episodes?page=${page}&limit=${limit}${s}`],
    priority: 'interactive',
    signal: opts?.signal,
    validate: (json) => {
      const d = unwrap(json);
      if (!Array.isArray(d)) return null;
      return d.map(toEpisode).filter((e): e is Episode => e !== null);
    },
  });
}

/** Card play button: the show's latest season from its first episode. Never throws. */
export async function playPodcast(id: string, name: string): Promise<void> {
  try {
    const songs = await getPodcastEpisodes(id, { page: 1, limit: 20 });
    if (!songs.length) {
      toast('No playable episodes found');
      return;
    }
    usePlayerStore.getState().playQueue(songs, 0);
    toast(`Playing ${name}`);
  } catch {
    toast('Couldn’t load this podcast right now');
  }
}
