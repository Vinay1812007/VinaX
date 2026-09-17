import { canonicalKey, songKey, servedKeySet, recordServed } from '@/services/recommendation/songIdentity';
import { freshSongs } from '@/services/recommendation/freshness';
import { isSongBlocked, useLibraryStore } from '@/store/libraryStore';
import type { Song } from '@/types';
import { searchSongs } from '@/services/api';
import { isNativePlatform } from '@/services/native';
import { buildTasteSnapshot } from '@/services/ai/taste';
import { matchesProposal } from '@/services/ai/dj';

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

/** Last 100 titles this feature generated, newest first. */
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

/** Merge freshly generated titles in (newest first), dedupe, cap at 100. */
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
const titleKey = (t: string): string => canonicalKey(t, '');

/** Resolve catalog picks in bounded parallel batches, preserving the curator's
 * order. Repeat exclusions are hard rules, including alternate releases. */
export async function resolveSuggestions(
  suggestions: Suggestion[],
  limit: number,
  muted: string[],
  avoid: string[] = [],
  languages: string[] = [],
  signal?: AbortSignal,
): Promise<Song[]> {
  const out: Song[] = [];
  const seen = new Set<string>();
  const seenTitles = new Set<string>();
  const avoidKeys = new Set(avoid.map(titleKey));
  const served = servedKeySet();
  const library = useLibraryStore.getState();
  // The model's strings are untrusted input: typed, trimmed and clipped before they reach a search.
  const valid = suggestions
    .filter((s) => s && typeof s.title === 'string' && typeof s.artist === 'string')
    .map((s) => ({ title: s.title.replace(/\s+/g, ' ').trim().slice(0, 120), artist: s.artist.replace(/\s+/g, ' ').trim().slice(0, 120) }))
    .filter((s) => s.title)
    .slice(0, 40);
  for (let i = 0; i < valid.length && out.length < limit; i += 4) {
    if (signal?.aborted) break;
    const asked = valid.slice(i, i + 4);
    const batch = await Promise.allSettled(asked.map((s) => searchSongs(`${s.title} ${s.artist}`.trim(), 5, { signal })));
    for (const [n, result] of batch.entries()) {
      if (out.length >= limit) break;
      if (result.status !== 'fulfilled') continue;
      const results = freshSongs(result.value, {
        excludeKeys: served, muted, blocked: (song) => isSongBlocked(song, library),
      }).filter((song) => !languages.length || (song.language != null && languages.includes(song.language)));
      const open = results.filter((song) => !seen.has(song.id) && !seenTitles.has(titleKey(song.title)) && !avoidKeys.has(titleKey(song.title)));
      // v7.0.0 — the catalogue song that really IS the suggestion (title and
      // credited artist both match) wins over whatever the search listed first;
      // only when none matches does the closest fresh hit stand in.
      const pick = open.find((song) => matchesProposal(song, asked[n].title, asked[n].artist)) ?? open[0];
      if (pick) {
        seen.add(pick.id);
        seenTitles.add(titleKey(pick.title));
        out.push(pick);
      }
    }
  }
  return out;
}

/** Build a playlist from a natural-language description. */
export async function generatePlaylist(
  prompt: string,
  languages: string[],
  muted: string[] = [],
  signal?: AbortSignal,
): Promise<PlaylistResult> {
  let res: Response;
  const avoidTitles = loadAvoidTitles();
  const ctrl = new AbortController();
  const abort = () => ctrl.abort();
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) ctrl.abort();
  const timer = window.setTimeout(abort, 34_000);
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
    signal?.removeEventListener('abort', abort);
  }
  if (res.status === 503) return { ok: false, reason: 'not_configured' };
  if (!res.ok) return { ok: false, reason: 'error' };

  const data = (await res.json().catch(() => null)) as
    | { name?: unknown; description?: unknown; songs?: Suggestion[] }
    | null;
  const suggestions = Array.isArray(data?.songs) ? (data as { songs: Suggestion[] }).songs : [];
  if (!suggestions.length) return { ok: false, reason: 'empty' };

  const songs = await resolveSuggestions(suggestions, 25, muted, avoidTitles, languages, signal);
  if (signal?.aborted) return { ok: false, reason: 'error' };
  if (!songs.length) return { ok: false, reason: 'empty' };

  // Remember what this generation used — the resolved catalog titles (what
  // the listener actually saw; different model titles can collapse onto the
  // same catalog hit) AND the model's own titles — so the next run for the
  // same vibe is steered toward genuinely different picks.
  recordServed(songs.map(songKey));
  recordAvoidTitles([...songs.map((s) => s.title), ...suggestions.flatMap((s) => (s && typeof s.title === 'string' ? [s.title.slice(0, 120)] : []))]);

  return {
    ok: true,
    playlist: {
      name: ((typeof data?.name === 'string' && data.name.trim()) || prompt).slice(0, 60),
      description: typeof data?.description === 'string' ? data.description.trim().slice(0, 240) : '',
      songs,
    },
  };
}
