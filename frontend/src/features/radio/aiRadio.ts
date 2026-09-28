import type { Song } from '@/types';
import { LANGUAGES } from '@/constants/languages';
import { tuneSearchQuery, type TuneIntent } from '@/services/recommendation/tune';
import { matchesStyle, styleFromText, styleQueries, tuneStyle, type MusicStyle } from '@/services/recommendation/style';
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
}

const LANGUAGE_WORDS: Record<string, string> = {
  ...Object.fromEntries(LANGUAGES.map((l) => [l.id, l.id])),
  bollywood: 'hindi',
  tollywood: 'telugu',
  kollywood: 'tamil',
  mollywood: 'malayalam',
  sandalwood: 'kannada',
};

/** Mood words → tune, checked in this order (the first family that matches wins). */
const INTENT_WORDS: Array<[RegExp, TuneIntent]> = [
  [/\b(devotional|bhakti|bhajans?|spiritual|god|temple)\b/, 'devotional'],
  [/\b(sad|heartbreak|breakup|emotional|pain)\b/, 'heartbreak'],
  [/\b(melody|melodies|melodious|soulful)\b/, 'melody'],
  [/\b(romantic|romance|love)\b/, 'romantic'],
  [/\b(dance|party|club|energetic|workout|gym|upbeat)\b/, 'energetic'],
  [/\b(mass|beats|kuthu|dappu)\b/, 'mass'],
  [/\b(chill|calm|relax|relaxing|lofi|lo-fi|sleep|soft)\b/, 'chill'],
  [/\b(latest|new|fresh)\b/, 'fresh'],
  [/\b(classic|classics|evergreen|old|retro|golden)\b/, 'classics'],
];

/** Read a free-text request ("Telugu 90s melodies") into language, decade and mood. */
export function parseRadioPrompt(raw: string): ParsedRadioPrompt {
  const text = raw.replace(/\s+/g, ' ').trim().slice(0, 80);
  const lower = text.toLowerCase();
  const language = lower.split(/[^a-z]+/).map((w) => LANGUAGE_WORDS[w]).find(Boolean) ?? null;
  let decade: number | null = null;
  const m = lower.match(/\b(19|20)?(\d)0'?s\b/);
  if (m) {
    const tens = Number(m[2]);
    const century = m[1] ? Number(m[1]) * 100 : tens >= 5 ? 1900 : 2000;
    decade = century + tens * 10;
  }
  // 8.3.0 — a style named in the words ("telugu dj songs", "folk songs", "janapadalu", "bhajans") comes first.
  const style = styleFromText(lower);
  const intent = style ?? INTENT_WORDS.find(([re]) => re.test(lower))?.[1] ?? (decade !== null && decade < 2010 ? 'classics' : null);
  return { text, language, decade, intent };
}

/** The catalogue queries for a request, most specific first, never repeated. */
export function promptQueries(p: ParsedRadioPrompt, fallbackLanguage: string | null): string[] {
  const lang = p.language ?? fallbackLanguage;
  const out: string[] = [];
  if (p.intent) {
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
}

/**
 * Merge result lists into radio seeds: round-robin across the lists (so each
 * query contributes), distinct songs and titles, language kept, the asked-for
 * decade first. Pure.
 */
export function pickRadioSeeds(lists: Song[][], opts: PickOptions = {}): Song[] {
  const { language = null, decade = null, blocked, rotate = 0, max = 5, style = null } = opts;
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
  const styled = style ? [...merged.filter((s) => matchesStyle(s, style)), ...merged.filter((s) => !matchesStyle(s, style))] : merged;
  const ordered = decade !== null ? [...styled.filter(inDecade), ...styled.filter((s) => !inDecade(s))] : styled;
  if (!ordered.length) return [];
  const shift = Math.max(0, Math.floor(rotate)) % ordered.length;
  // Rotation only within the best part of the list, so a decade request still opens in its decade.
  // 8.3.0 — a style request rotates among its style songs only, so it always opens in the style.
  const best = decade !== null ? Math.max(1, ordered.filter(inDecade).length) : style ? Math.max(1, ordered.filter((s) => matchesStyle(s, style)).length) : ordered.length;
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
  const pick = { language: parsed.language, decade: parsed.decade, blocked: deps.blocked, rotate: deps.rotate, style: tuneStyle(parsed.intent) ?? null };
  const seeds = pickRadioSeeds(lists, pick);
  if (seeds.length >= 2 || !deps.ai || deps.signal?.aborted) return { seeds, parsed, via: seeds.length ? 'catalogue' : 'none' };
  const lang = parsed.language ?? fallbackLanguage;
  const aiSongs = await deps.ai(parsed.text, lang ? [lang] : [], deps.signal).catch(() => [] as Song[]);
  const fromAi = pickRadioSeeds([aiSongs], { ...pick, rotate: 0 });
  if (fromAi.length) return { seeds: fromAi, parsed, via: 'ai' };
  return { seeds, parsed, via: seeds.length ? 'catalogue' : 'none' };
}
