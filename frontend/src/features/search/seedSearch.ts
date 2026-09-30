import type { Song } from '@/types';
import { getSongSuggestions, searchSongs } from '@/services/api';
import { canonicalKey } from '@/services/recommendation/songIdentity';

/**
 * 8.5.0 — "songs like <name>": find the named song or artist in the
 * catalogue and take the catalogue's own similar songs for it.
 *
 * A song seed is a catalogue song whose title IS the name ("<title> by
 * <artist>" also checks the artist). An artist seed is an artist the
 * catalogue credits under exactly that name. Anything else resolves to
 * nothing and the words are searched as usual — a name is never guessed at.
 * Same rules as the server's /api/ai/search.
 */

export interface SeedResult {
  /** The seed song, when the name is a song. */
  song: Song | null;
  /** The artist's name as credited, when the name is an artist. */
  artist: string | null;
  /** Catalogue songs like the seed (never the seed or another release of it). */
  songs: Song[];
}

const lower = (s: string): string => s.trim().toLowerCase();
const titleKey = (t: string): string => canonicalKey(t, '');

export function pickSeed(text: string, hits: Song[]): { song: Song | null; artist: string | null } {
  const by = /^(.+?)\s+by\s+(.+)$/i.exec(text);
  const title = titleKey(by ? by[1] : text);
  const wanted = by ? lower(by[2]) : null;
  const song = hits.find((h) => titleKey(h.title) === title && (!wanted || h.artists.some((a) => lower(a.name) === wanted))) ?? null;
  if (song) return { song, artist: null };
  for (const h of hits) {
    const a = h.artists.find((x) => lower(x.name) === lower(text));
    if (a) return { song: null, artist: a.name };
  }
  return { song: null, artist: null };
}

export async function seedSongs(text: string, signal?: AbortSignal): Promise<SeedResult> {
  const hits = await searchSongs(text, 10, { signal }).catch(() => [] as Song[]);
  const { song, artist } = pickSeed(text, hits);
  if (song) {
    const similar = await getSongSuggestions(song.id, 20, { signal }).catch(() => [] as Song[]);
    const key = titleKey(song.title);
    return { song, artist: null, songs: similar.filter((s) => s.id !== song.id && titleKey(s.title) !== key) };
  }
  if (artist) {
    const byArtist = hits.filter((h) => h.artists.some((a) => lower(a.name) === lower(artist)));
    const similar = byArtist[0] ? await getSongSuggestions(byArtist[0].id, 20, { signal }).catch(() => [] as Song[]) : [];
    return { song: null, artist, songs: [...similar, ...byArtist] };
  }
  return { song: null, artist: null, songs: [] };
}
