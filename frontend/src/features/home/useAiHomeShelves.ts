import { useQuery } from '@tanstack/react-query';
import type { Song } from '@/types';
import { searchSongs } from '@/services/api';
import { rankSongs } from '@/features/search/useSearch';
import { requestCurator } from '@/services/ai/recommendations';
import { buildTasteSnapshot } from '@/services/ai/taste';
import { freshSongs } from '@/services/recommendation/freshness';
import { servedKeySet } from '@/services/recommendation/songIdentity';
import { profileStamp } from '@/services/personalization/storage';
import { useSettingsStore } from '@/store/settingsStore';
import { useHistoryStore } from '@/store/historyStore';
import { useDiscoveryStore } from '@/store/discoveryStore';
import { isSongBlocked, useLibraryStore } from '@/store/libraryStore';

/**
 * v6.2.0 — "Designed for you": the AI designs a handful of titled shelves
 * from the listener's taste, time of day and session, and each one is
 * resolved against the real catalogue. Refreshes by half-day, taste change,
 * language change and "Refresh discovery"; steers away from the last 30
 * shelf titles it showed so consecutive opens differ. Empty (the block
 * renders nothing) when the AI is off, unconfigured or slow — the ordinary
 * shelves are unaffected either way.
 */
export interface AiShelf {
  title: string;
  why: string;
  query: string;
  songs: Song[];
}

export interface AiSection {
  title: string;
  query: string;
  why: string;
}

const SHOWN_KEY = 'vinax.home.ai-shelves.shown.v1';
const SHOWN_CAP = 30;
const MIN_SONGS = 4;

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const clean = (v: unknown, max: number): string => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');
const BANNED = /<|>|https?:\/\/|chatgpt|spotify|openai|gemini|claude/i;

/** Validate the model's sections: 2–6, unique by title and query, brand- and markup-free. */
export function parseSections(raw: unknown): AiSection[] {
  const list = isObj(raw) && Array.isArray(raw.sections) ? raw.sections : Array.isArray(raw) ? raw : [];
  const out: AiSection[] = [];
  const seen = new Set<string>();
  for (const item of list) {
    if (!isObj(item)) continue;
    const title = clean(item.title, 50);
    const query = clean(item.query, 90);
    const why = clean(item.why, 90);
    if (!title || !query || BANNED.test(title) || BANNED.test(query) || BANNED.test(why)) continue;
    const key = `${title.toLowerCase()}|${query.toLowerCase()}`;
    if (seen.has(key) || [...seen].some((k) => k.startsWith(title.toLowerCase() + '|') || k.endsWith('|' + query.toLowerCase()))) continue;
    seen.add(key);
    out.push({ title, query, why });
    if (out.length >= 6) break;
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

export function recordShownShelves(sections: AiSection[]): void {
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

function halfDayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}-${d.getHours() < 12 ? 'am' : 'pm'}`;
}

export async function designAndResolve(signal?: AbortSignal): Promise<AiShelf[]> {
  const raw = await requestCurator('shelves', { taste: buildTasteSnapshot(), avoidShelves: loadShownShelves().map((s) => ({ title: s.title, query: s.query })) }, signal);
  const sections = parseSections(raw);
  if (!sections.length) return [];
  const settings = useSettingsStore.getState();
  const lib = useLibraryStore.getState();
  const served = servedKeySet();
  const results = await Promise.allSettled(sections.map((s) => searchSongs(s.query, 16, { signal })));
  const seenIds = new Set<string>();
  const shelves: AiShelf[] = [];
  sections.forEach((section, i) => {
    const r = results[i];
    if (r.status !== 'fulfilled') return;
    const songs = freshSongs(rankSongs(r.value), { excludeIds: seenIds, excludeKeys: served, muted: settings.mutedLanguages, blocked: (s) => isSongBlocked(s, lib) }).slice(0, 12);
    if (songs.length < MIN_SONGS) return;
    songs.forEach((s) => seenIds.add(s.id));
    shelves.push({ ...section, songs });
  });
  if (shelves.length) recordShownShelves(shelves.map((s) => ({ title: s.title, query: s.query, why: s.why })));
  return shelves;
}

export function useAiHomeShelves(enabled: boolean) {
  const pinned = useSettingsStore((s) => s.pinnedLanguages);
  const muted = useSettingsStore((s) => s.mutedLanguages);
  const on = useSettingsStore((s) => s.aiHomeShelves);
  const round = useDiscoveryStore((s) => s.round);
  const hasTaste = useHistoryStore((s) => s.entries.length > 0);
  return useQuery<AiShelf[]>({
    queryKey: ['ai-home-shelves', halfDayKey(), profileStamp(), pinned, muted, round],
    enabled: enabled && on && (hasTaste || pinned.length > 0),
    staleTime: 6 * 60 * 60_000,
    gcTime: 12 * 60 * 60_000,
    retry: false,
    queryFn: ({ signal }) => designAndResolve(signal),
  });
}
