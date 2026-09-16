import type { Song } from '@/types';
import { requestCurator } from '@/services/ai/recommendations';
import { buildTasteSnapshot } from '@/services/ai/taste';

/**
 * v6.4.0 — the AI Home Builder service (the model side of "Designed for you").
 *
 * The model never produces songs. It produces SHELF DEFINITIONS — a title,
 * a description, a catalogue query, a reason and a type — from the taste
 * snapshot (languages, artists, recent plays and completions, session state,
 * time of day, taste dials). The hook in features/home/useAiHome.ts then
 * resolves every query against the real catalogue. This module also keeps
 * the anti-repeat memory: the last 30 shelf titles/queries and the last 200
 * song ids shown, so the next build steers away from both.
 */
export type ShelfType = 'continue' | 'made-for-you' | 'because' | 'trending' | 'fresh' | 'discovery' | 'artist' | 'language' | 'classics' | 'throwback' | 'mood' | 'time' | 'activity' | 'hidden-gems' | 'soundtrack' | 'other';

export interface AiShelfDefinition {
  title: string;
  description: string;
  query: string;
  reason: string;
  type: ShelfType;
}

/** Alias kept for callers that predate the description/type fields. */
export type AiSection = AiShelfDefinition;

const SHELF_TYPES: ShelfType[] = ['continue', 'made-for-you', 'because', 'trending', 'fresh', 'discovery', 'artist', 'language', 'classics', 'throwback', 'mood', 'time', 'activity', 'hidden-gems', 'soundtrack', 'other'];
const SHOWN_KEY = 'vinax.home.ai-shelves.shown.v1';
const SHOWN_SONGS_KEY = 'vinax.home.ai-shelves.songs.v1';
const SHOWN_CAP = 30;
const SHOWN_SONGS_CAP = 200;
/** Fresh per app load: consecutive opens in one session reuse the cached build; a new load varies. */
export const HOME_VISIT_NONCE = Math.floor(Math.random() * 1_000_000);

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const clean = (v: unknown, max: number): string => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');
const BANNED = /<|>|https?:\/\/|chatgpt|spotify|openai|gemini|claude/i;

/** Validate the model's sections: 2–8, unique by title and query, brand- and markup-free. */
export function parseSections(raw: unknown): AiShelfDefinition[] {
  const list = isObj(raw) && Array.isArray(raw.sections) ? raw.sections : Array.isArray(raw) ? raw : [];
  const out: AiShelfDefinition[] = [];
  const titles = new Set<string>();
  const queries = new Set<string>();
  for (const item of list) {
    if (!isObj(item)) continue;
    const title = clean(item.title, 50);
    const query = clean(item.query, 90);
    const reason = clean(item.reason ?? item.why, 90);
    const description = clean(item.description, 120);
    if (!title || !query || BANNED.test(`${title} ${query} ${reason} ${description}`)) continue;
    const t = title.toLowerCase();
    const q = query.toLowerCase();
    if (titles.has(t) || queries.has(q)) continue;
    titles.add(t);
    queries.add(q);
    const type = SHELF_TYPES.includes(item.type as ShelfType) ? (item.type as ShelfType) : 'other';
    out.push({ title, query, reason, description, type });
    if (out.length >= 8) break;
  }
  return out.length >= 2 ? out : [];
}

interface Shown { title: string; query: string; at: number }

export function loadShownShelves(): Shown[] {
  try {
    const raw = JSON.parse(window.localStorage.getItem(SHOWN_KEY) || '[]') as unknown;
    return Array.isArray(raw) ? (raw as Shown[]).filter((s) => s && typeof s.title === 'string' && typeof s.query === 'string').slice(0, SHOWN_CAP) : [];
  } catch {
    return [];
  }
}

export function recordShownShelves(sections: Array<Pick<AiShelfDefinition, 'title' | 'query'>>): void {
  if (!sections.length) return;
  try {
    const now = Date.now();
    const merged = [...sections.map((s) => ({ title: s.title, query: s.query, at: now })), ...loadShownShelves()];
    const seen = new Set<string>();
    const dedup = merged.filter((s) => (seen.has(s.title.toLowerCase()) ? false : (seen.add(s.title.toLowerCase()), true)));
    window.localStorage.setItem(SHOWN_KEY, JSON.stringify(dedup.slice(0, SHOWN_CAP)));
  } catch {
    /* storage is optional */
  }
}

/** Song ids shown on AI shelves recently (bounded, newest first). */
export function loadShownSongIds(): string[] {
  try {
    const raw = JSON.parse(window.localStorage.getItem(SHOWN_SONGS_KEY) || '[]') as unknown;
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string').slice(0, SHOWN_SONGS_CAP) : [];
  } catch {
    return [];
  }
}

export function recordShownSongs(songs: Song[]): void {
  if (!songs.length) return;
  try {
    const ids = [...songs.map((s) => s.id), ...loadShownSongIds()];
    window.localStorage.setItem(SHOWN_SONGS_KEY, JSON.stringify([...new Set(ids)].slice(0, SHOWN_SONGS_CAP)));
  } catch {
    /* storage is optional */
  }
}

/** Ask the model for shelf definitions. Empty on any failure — Home keeps its ordinary shelves. */
export async function designHomeShelves(signal?: AbortSignal): Promise<AiShelfDefinition[]> {
  const raw = await requestCurator(
    'shelves',
    {
      taste: buildTasteSnapshot(),
      visitNonce: HOME_VISIT_NONCE,
      shelfTypes: SHELF_TYPES,
      avoidShelves: loadShownShelves().map((s) => ({ title: s.title, query: s.query })),
    },
    signal,
  );
  return parseSections(raw);
}
