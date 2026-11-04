import type { Song } from '@/types';
import { postMusicAi } from './musicAi';

/**
 * Lyrics tools (POST /api/ai/lyrics): the music AI romanizes lines into
 * English letters, translates them into English, or explains the song's
 * meaning and mood. Only the song's own words, title, artist and language
 * are sent, nothing about the listener. Romanized and translated lines come
 * back one for one, in order (the Worker refuses an answer with a different
 * count), so they map straight onto the synced timings.
 */

export type LyricsLineMode = 'romanize' | 'translate';

/** Long songs and slow models: the listener tapped and is waiting for this. */
export const LYRICS_DEADLINE_MS = 25_000;
export const MAX_LINES = 160;

const leadArtist = (s: Song): string => s.artists?.[0]?.name ?? s.subtitle?.split(',')[0]?.trim() ?? '';

const songContext = (song: Song) => ({
  title: song.title,
  artist: leadArtist(song),
  language: song.language && song.language !== 'unknown' ? song.language : null,
});

/** Lines in the same order and count, or null (signed out, the AI away, a mismatched answer). */
export async function aiLyricLines(mode: LyricsLineMode, lines: readonly string[], song: Song, o: { signal?: AbortSignal; fetcher?: typeof fetch } = {}): Promise<string[] | null> {
  if (!lines.length || lines.length > MAX_LINES) return null;
  const answer = await postMusicAi<{ lines?: unknown }>('lyrics', { mode, lines, ...songContext(song) }, { deadlineMs: LYRICS_DEADLINE_MS, signal: o.signal, fetcher: o.fetcher });
  const out = answer?.lines;
  if (!Array.isArray(out) || out.length !== lines.length || !out.every((l) => typeof l === 'string')) return null;
  return out as string[];
}

export interface LyricsMeaning {
  meaning: string;
  mood: string | null;
}

export async function aiLyricsMeaning(lines: readonly string[], song: Song, o: { signal?: AbortSignal; fetcher?: typeof fetch } = {}): Promise<LyricsMeaning | null> {
  const text = lines.filter((l) => l.trim()).slice(0, MAX_LINES);
  if (!text.length) return null;
  const answer = await postMusicAi<{ meaning?: unknown; mood?: unknown }>('lyrics', { mode: 'explain', lines: text, ...songContext(song) }, { deadlineMs: LYRICS_DEADLINE_MS, signal: o.signal, fetcher: o.fetcher });
  if (!answer || typeof answer.meaning !== 'string' || !answer.meaning.trim()) return null;
  return { meaning: answer.meaning.trim(), mood: typeof answer.mood === 'string' && answer.mood.trim() ? answer.mood.trim() : null };
}

/**
 * True when most letters are not Latin: the lyrics are still in their own
 * script, so "Romanized" needs the AI (the catalogue had no English-letters copy).
 */
export function mostlyNonLatin(lines: readonly string[]): boolean {
  let latin = 0;
  let other = 0;
  for (const l of lines) {
    for (const ch of l) {
      if (/\p{L}/u.test(ch)) {
        if (/\p{Script=Latin}/u.test(ch)) latin += 1;
        else other += 1;
      }
    }
  }
  return other > 0 && other > latin;
}
