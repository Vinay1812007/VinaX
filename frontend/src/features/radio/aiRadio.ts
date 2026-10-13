import type { Song } from '@/types';
import { parseMusicIntent, type IntentMood } from '@/services/ai/musicIntent';
import { tuneSearchQuery, type TuneIntent } from '@/services/recommendation/tune';
import { matchesStyle, styleQueries, tuneStyle, type MusicStyle } from '@/services/recommendation/style';
import { songKey } from '@/services/recommendation/songIdentity';

/**
 * 8.2.0 — AI Radio: endless music from a song, an artist, a mood or a few
 * words. This module finds the SEEDS (the first few songs); the player's
 * radio mode and the DJ take it from there (playerStore.startRadio with
 * `seeds` and a `tune`).
 *
 * Catalogue queries stay short — "<language> <word> songs" (the shapes
 * tuneSearchQuery probed against the catalogue) plus the listener's own
 * words — because long invented phrases return nothing.
 */

export interface RadioMood {
  id: TuneIntent;
  label: string;
}

/** Mood chips on the AI Radio page, each a tune the DJ keeps following. */
export const RADIO_MOODS: readonly RadioMood[] = [
  { id: 'melody', label: 'Melody' },
  { id: 'romantic', label: 'Romantic' },
  { id: 'energetic', label: 'Dance' },
  { id: 'chill', label: 'Chill' },
  { id: 'heartbreak', label: 'Sad' },
  { id: 'devotional', label: 'Devotional' },
  // 8.3.0 — styles: the radio keeps playing DJ remixes / folk songs, not just songs that feel alike.
  { id: 'dj', label: 'DJ remix' },
  { id: 'folk', label: 'Folk' },
  { id: 'mass', label: 'Beats' },
  { id: 'classics', label: 'Classics' },
  { id: 'fresh', label: 'New' },
];

export interface ParsedRadioPrompt {
  /** The words the listener typed, tidied (max 80 characters). */
  text: string;
  /** A language named in the words (industry nicknames count), else null. */
  language: string | null;
  /** A decade named in the words, as "1990" for "90s". */
  decade: number | null;
  /** The mood the words ask for, as a tune the DJ can follow. */
  intent: TuneIntent | null;
  /** 13.1 — "songs like <name>" / "similar to <name>": the artist or song named, else null. */
  artist: string | null;
}

/** 13.1 — a shared mood is read by musicIntent; these are the radio's own tunes. */
const MOOD_TUNE: Record<IntentMood, TuneIntent> = { romantic: 'romantic', energetic: 'energetic', chill: 'chill', melancholy: 'heartbreak', devotional: 'devotional' };

/**
 * Read a free-text request into language, decade, mood and a named artist.
 *
 * 13.1 — the reading is parseMusicIntent (services/ai/musicIntent.ts), the
 * same parser natural-language search and the AI playlist builder use, so
 * "relaxing Telugu songs for late-night studying", "songs similar to
 * <artist>", "nostalgic hindi songs" and "surprise me" all land. This file
 * keeps only the tunes the shared parser has no word for (melody, mass,
 * surprise) and the mapping from its moods to the DJ's tunes.
 */
export function parseRadioPrompt(raw: string): ParsedRadioPrompt {
  const text = raw.replace(/\s+/g, ' ').trim().slice(0, 80);
  const lower = text.toLowerCase();
  const read = parseMusicIntent(text);
  const language = read.languages[0] ?? null;
  const decade = read.decade;
  const artist = read.seed?.text ?? null;
  // The style comes first (DJ remix / folk / devotional named in the words),
  // then the radio-only tunes the shared parser folds into broader moods,
  // then the shared moods, the era, and an energy with no mood of its own.
  const radioOnly: TuneIntent | null = /\b(melody|melodies|melodious|soulful)\b/.test(lower)
    ? 'melody'
    : /\b(mass|beats|kuthu|dappu)\b/.test(lower)
      ? 'mass'
      : /\bsurprise\b/.test(lower)
        ? 'surprise'
        : null;
  const intent: TuneIntent | null =
    read.style
    ?? radioOnly
    ?? (read.moods[0] ? MOOD_TUNE[read.moods[0]] : null)
    ?? (read.era === 'classic' ? 'classics' : read.era === 'fresh' ? 'fresh' : null)
    ?? (read.energy === 'high' ? 'energetic' : read.energy === 'low' ? 'chill' : null)
    ?? (decade !== null && decade < 2010 ? 'classics' : null);
  return { text, language, decade, intent, artist };
}

/** The catalogue queries for a request, most specific first, never repeated. */
export function promptQueries(p: ParsedRadioPrompt, fallbackLanguage: string | null): string[] {
  const lang = p.language ?? fallbackLanguage;
  const out: string[] = [];
  // 13.1 — a named artist is the most specific ask: their songs lead.
  if (p.artist) out.push(`${p.artist} songs`);
  // "Surprise me" names no catalogue shape: the DJ's surprise tune takes over
  // after seeding, so only the listener's own words (and any artist) search.
  if (p.intent && p.intent !== 'surprise') {
    const q = tuneSearchQuery(p.intent, lang);
    if (q) out.push(q);
    // 8.3.0 — a style has a second phrasing the catalogue answers ("<language> remix songs").
    const style = tuneStyle(p.intent);
    if (style) for (const s of styleQueries(style, lang, 0)) out.push(s.query);
  }
  if (p.decade !== null && lang) out.push(`${String(p.decade).slice(2)}s ${lang} songs`);
  if (p.text) out.push(p.text);
  return [...new Set(out.map((q) => q.toLowerCase()))];
}

const yearOf = (s: Song): number | null => {
  const y = Number.parseInt(String(s.year ?? ''), 10);
  return Number.isFinite(y) && y > 1900 ? y : null;
};

export interface PickOptions {
  /** Keep only songs in this language (songs with no known language stay). */
  language?: string | null;
  /** Prefer songs from this decade (e.g. 1990). */
  decade?: number | null;
  /** Songs the listener has hidden or blocked. */
  blocked?: (s: Song) => boolean;
  /** Start this many places into the merged list, so the same mood does not always open the same way. */
  rotate?: number;
  max?: number;
  /** 8.3.0 — songs in this style (DJ remix, folk, devotional) open the radio; the rest only fill in. */
  style?: MusicStyle | null;
  /** 13.1 — songs credited to this artist open the radio ("songs like <artist>"); the rest only fill in. */
  artist?: string | null;
}

/**
 * Merge result lists into radio seeds: round-robin across the lists (so each
 * query contributes), distinct songs and titles, language kept, the asked-for
 * decade first. Pure.
 */
export function pickRadioSeeds(lists: Song[][], opts: PickOptions = {}): Song[] {
  const { language = null, decade = null, blocked, rotate = 0, max = 5, style = null, artist = null } = opts;
  const merged: Song[] = [];
  const ids = new Set<string>();
  const titles = new Set<string>();
  // 8.3.0 — one cut per song: "Nadakallo Nadaka (DJ Remix Song)" and its "Version 5" are one seed.
  const works = new Set<string>();
  const longest = Math.max(0, ...lists.map((l) => l.length));
  for (let i = 0; i < longest; i += 1) {
    for (const list of lists) {
      const s = list[i];
      if (!s || ids.has(s.id)) continue;
      const title = s.title.trim().toLowerCase();
      if (titles.has(title) || works.has(songKey(s))) continue;
      if (language && s.language && s.language !== 'unknown' && s.language !== language) continue;
      if (blocked?.(s)) continue;
      ids.add(s.id);
      titles.add(title);
      works.add(songKey(s));
      merged.push(s);
    }
  }
  const inDecade = (s: Song) => {
    const y = yearOf(s);
    return decade !== null && y !== null && y >= decade && y < decade + 10;
  };
  // 13.1 — a named artist outranks everything: their songs open the radio.
  const want = (artist ?? '').trim().toLowerCase();
  const credited = (s: Song): boolean => !!want && (s.artists.some((a) => a.name.trim().toLowerCase() === want) || s.subtitle.toLowerCase().includes(want));
  const byName = want ? [...merged.filter(credited), ...merged.filter((s) => !credited(s))] : merged;
  const styled = style ? [...byName.filter((s) => matchesStyle(s, style)), ...byName.filter((s) => !matchesStyle(s, style))] : byName;
  const ordered = decade !== null ? [...styled.filter(inDecade), ...styled.filter((s) => !inDecade(s))] : styled;
  if (!ordered.length) return [];
  const shift = Math.max(0, Math.floor(rotate)) % ordered.length;
  // Rotation only within the best part of the list, so a decade request still opens in its decade.
  // 8.3.0 — a style request rotates among its style songs only, so it always opens in the style.
  // 13.1 — an artist request rotates among that artist's songs only.
  const best = want && byName.some(credited)
    ? Math.max(1, ordered.filter(credited).length)
    : decade !== null ? Math.max(1, ordered.filter(inDecade).length) : style ? Math.max(1, ordered.filter((s) => matchesStyle(s, style)).length) : ordered.length;
  const head = ordered.slice(0, best);
  const rotated = [...head.slice(shift % head.length), ...head.slice(0, shift % head.length), ...ordered.slice(best)];
  return rotated.slice(0, max);
}

/** Songs whose credits name this artist (the catalogue search also returns songs that only mention them). */
export function byArtist(songs: Song[], name: string): Song[] {
  const want = name.trim().toLowerCase();
  if (!want) return [];
  return songs.filter((s) => s.artists.some((a) => a.name.trim().toLowerCase() === want) || s.subtitle.toLowerCase().includes(want));
}

export type SearchFn = (query: string, limit: number, opts?: { signal?: AbortSignal }) => Promise<Song[]>;

export interface PromptSeeds {
  seeds: Song[];
  parsed: ParsedRadioPrompt;
  via: 'catalogue' | 'ai' | 'none';
}

/**
 * Seeds for a free-text request: the catalogue first (fast), and — only when
 * that finds too little — the AI playlist service, which reads the request
 * more loosely. `ai` is optional so the page can leave it out when the
 * listener switched AI off.
 */
export async function seedsForPrompt(
  raw: string,
  fallbackLanguage: string | null,
  deps: { search: SearchFn; ai?: (prompt: string, languages: string[], signal?: AbortSignal) => Promise<Song[]>; blocked?: (s: Song) => boolean; signal?: AbortSignal; rotate?: number },
): Promise<PromptSeeds> {
  const parsed = parseRadioPrompt(raw);
  if (!parsed.text) return { seeds: [], parsed, via: 'none' };
  const queries = promptQueries(parsed, fallbackLanguage);
  const settled = await Promise.allSettled(queries.map((q) => deps.search(q, 20, { signal: deps.signal })));
  const lists = settled.map((r) => (r.status === 'fulfilled' ? r.value : []));
  const pick = { language: parsed.language, decade: parsed.decade, blocked: deps.blocked, rotate: deps.rotate, style: tuneStyle(parsed.intent) ?? null, artist: parsed.artist };
  const seeds = pickRadioSeeds(lists, pick);
  if (seeds.length >= 2 || !deps.ai || deps.signal?.aborted) return { seeds, parsed, via: seeds.length ? 'catalogue' : 'none' };
  const lang = parsed.language ?? fallbackLanguage;
  const aiSongs = await deps.ai(parsed.text, lang ? [lang] : [], deps.signal).catch(() => [] as Song[]);
  const fromAi = pickRadioSeeds([aiSongs], { ...pick, rotate: 0 });
  if (fromAi.length) return { seeds: fromAi, parsed, via: 'ai' };
  return { seeds, parsed, via: seeds.length ? 'catalogue' : 'none' };
}
