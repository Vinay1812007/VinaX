import type { Song } from '@/types';
import { searchSongs } from '@/services/api';
import { isNativePlatform } from '@/services/native';
import { buildTasteSnapshot } from '@/services/ai/taste';

// Same-origin on web; the native app calls the deployed function directly.
const ENDPOINT = isNativePlatform()
  ? 'https://www.sirimillavinay.online/api/playlist'
  : '/api/playlist';

export interface GeneratedPlaylist {
  name: string;
  description: string;
  songs: Song[];
}

export type PlaylistResult =
  | { ok: true; playlist: GeneratedPlaylist }
  | { ok: false; reason: 'not_configured' | 'empty' | 'error' };

export interface Suggestion {
  title: string;
  artist: string;
}

// Cross-generation anti-repeat (v3.3.1 — "always the same playlist" fix):
// remember the titles recent generations used so the server can steer the
// model away from them next time. Same pattern as the DJ's surfaced memory.
const AVOID_KEY = 'vinax.aiplaylist.avoid.v1';
// v3.7.1: bumped 60 → 100 so a heavy user of the AI Playlist feature doesn't
// exhaust the memory in a couple of weeks and see the same titles resurface.
const AVOID_CAP = 100;

/** Last ~60 titles this feature generated, newest first. */
export function loadAvoidTitles(): string[] {
  try {
    const raw = JSON.parse(window.localStorage.getItem(AVOID_KEY) || '[]') as unknown;
    return Array.isArray(raw)
      ? raw.filter((t): t is string => typeof t === 'string' && !!t.trim()).slice(0, AVOID_CAP)
      : [];
  } catch {
    return [];
  }
}

/** Merge freshly generated titles in (newest first), dedupe, cap at 60. */
export function recordAvoidTitles(titles: string[]): void {
  try {
    const merged = [...titles, ...loadAvoidTitles()];
    const seen = new Set<string>();
    const dedup: string[] = [];
    for (const t of merged) {
      const k = t.trim().toLowerCase();
      if (!k || seen.has(k)) continue;
      seen.add(k);
      dedup.push(t.trim());
    }
    window.localStorage.setItem(AVOID_KEY, JSON.stringify(dedup.slice(0, AVOID_CAP)));
  } catch {
    /* ignore */
  }
}

/** Loose title key so near-identical catalog titles guard each other. */
const titleKey = (t: string): string => t.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/** Resolve AI { title, artist } picks to playable catalog songs, deduped +
 *  muted-filtered. Optional avoid[]: soft anti-repeat — the upstream search
 *  ranks by popularity, so fuzzy titles collapse onto the same canonical hits
 *  run after run; preferring an unused hit (and only falling back to a used
 *  one) keeps consecutive generations visibly different (v3.3.1). */
export async function resolveSuggestions(
  suggestions: Suggestion[],
  limit: number,
  muted: string[],
  avoid: string[] = [],
): Promise<Song[]> {
  const out: Song[] = [];
  const seen = new Set<string>();
  const seenTitles = new Set<string>();
  const avoidKeys = new Set(avoid.map(titleKey));
  for (const s of suggestions) {
    if (out.length >= limit) break;
    try {
      const results = await searchSongs(`${s.title} ${s.artist}`, 5);
      // Exclude already-picked ids AND already-picked catalog titles: without
      // this, near-duplicate suggestions converge on the same top search hit
      // (or the same recording under a second id) and the playlist collapses.
      const ok = (r: Song): boolean =>
        !seen.has(r.id) &&
        !seenTitles.has(titleKey(r.title)) &&
        !(r.language != null && muted.includes(r.language));
      const pick = results.find((r) => ok(r) && !avoidKeys.has(titleKey(r.title))) ?? results.find(ok);
      if (pick) {
        seen.add(pick.id);
        seenTitles.add(titleKey(pick.title));
        out.push(pick);
      }
    } catch {
      /* skip this suggestion */
    }
  }
  return out;
}

/** Build a playlist from a natural-language description. */
export async function generatePlaylist(
  prompt: string,
  languages: string[],
  muted: string[] = [],
): Promise<PlaylistResult> {
  let res: Response;
  const avoidTitles = loadAvoidTitles();
  const ctrl = new AbortController();
  const timer = window.setTimeout(() => ctrl.abort(), 34_000);
  try {
    res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-vinax-client': isNativePlatform() ? 'app' : 'web',
      },
      body: JSON.stringify({ prompt, languages, taste: buildTasteSnapshot(), avoidTitles }),
      signal: ctrl.signal,
    });
  } catch {
    return { ok: false, reason: 'error' };
  } finally {
    window.clearTimeout(timer);
  }
  if (res.status === 503) return { ok: false, reason: 'not_configured' };
  if (!res.ok) return { ok: false, reason: 'error' };

  const data = (await res.json().catch(() => null)) as
    | { name?: string; description?: string; songs?: Suggestion[] }
    | null;
  const suggestions = Array.isArray(data?.songs) ? (data as { songs: Suggestion[] }).songs : [];
  if (!suggestions.length) return { ok: false, reason: 'empty' };

  const songs = await resolveSuggestions(suggestions, 25, muted, avoidTitles);
  if (!songs.length) return { ok: false, reason: 'empty' };

  // Remember what this generation used — the resolved catalog titles (what
  // the listener actually saw; different model titles can collapse onto the
  // same catalog hit) AND the model's own titles — so the next run for the
  // same vibe is steered toward genuinely different picks.
  recordAvoidTitles([...songs.map((s) => s.title), ...suggestions.map((s) => s.title)]);

  return {
    ok: true,
    playlist: {
      name: (data?.name || prompt).slice(0, 60),
      description: data?.description || '',
      songs,
    },
  };
}
