import { isNativePlatform } from '@/services/native';

const ENDPOINT = isNativePlatform()
  ? 'https://www.sirimillavinay.online/api/lyrics-tools'
  : '/api/lyrics-tools';

const cache = new Map<string, string[]>();

/** Romanize or translate lyric lines. Returns the same number of lines (so
 *  synced timing stays aligned) or null on any failure. Cached per song+mode. */
export async function transformLyrics(
  songId: string,
  mode: 'romanize' | 'translate',
  lines: string[],
): Promise<string[] | null> {
  const key = `${songId}|${mode}|${lines.length}`;
  const hit = cache.get(key);
  if (hit) return hit;
  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-vinax-client': isNativePlatform() ? 'app' : 'web' },
      body: JSON.stringify({ lines, mode }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { lines?: string[] };
    if (!Array.isArray(data.lines) || data.lines.length !== lines.length) return null;
    cache.set(key, data.lines);
    return data.lines;
  } catch {
    return null;
  }
}

export interface LyricMeaning {
  summary: string;
  mood: string;
  themes: string[];
}

const meaningCache = new Map<string, LyricMeaning>();

/** AI explanation of a song's lyrics: a short meaning summary, emotional mood
 *  and key themes. Cached per song; null on any failure. */
export async function explainLyrics(songId: string, lines: string[]): Promise<LyricMeaning | null> {
  const key = `${songId}|explain`;
  const hit = meaningCache.get(key);
  if (hit) return hit;
  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-vinax-client': isNativePlatform() ? 'app' : 'web' },
      body: JSON.stringify({ lines: lines.slice(0, 80), mode: 'explain' }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { summary?: string; mood?: string; themes?: string[] };
    if (!data.summary) return null;
    const meaning: LyricMeaning = {
      summary: data.summary,
      mood: data.mood ?? '',
      themes: Array.isArray(data.themes) ? data.themes : [],
    };
    meaningCache.set(key, meaning);
    return meaning;
  } catch {
    return null;
  }
}
