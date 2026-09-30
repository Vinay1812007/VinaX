import { canonicalKey, songKey, servedKeySet, recordServed } from '@/services/recommendation/songIdentity';
import { freshSongs } from '@/services/recommendation/freshness';
import { isSongBlocked, useLibraryStore } from '@/store/libraryStore';
import type { Song } from '@/types';
import { searchSongs } from '@/services/api';
import { isNativePlatform } from '@/services/native';
import { buildTasteSnapshot } from '@/services/ai/taste';
import { matchesProposal } from '@/services/ai/dj';
import { catalogQueries, intentTitle, parseMusicIntent, type MusicIntent } from '@/services/ai/musicIntent';
import { embedQueryDetailed, embedSongs } from '@/services/ai/embeddings';
import { semanticRank } from '@/services/ai/semantic';

// Same-origin on web; the native app calls the deployed function directly.
const ENDPOINT = isNativePlatform()
  ? 'https://www.sirimillavinay.online/api/playlist'
  : '/api/playlist';

export interface GeneratedPlaylist {
  name: string;
  description: string;
  songs: Song[];
  /** 8.2.0 — 'catalogue' when the AI curator could not answer and the list was built on the device from catalogue searches. */
  source?: 'ai' | 'catalogue';
  /** 8.5.0 — song id → the curator's reason, for the AI's own picks (catalogue fill songs have none). */
  reasons?: Record<string, string>;
}

/**
 * Why no playlist came back:
 * - `disabled` — the owner switched AI off (503 ai_disabled);
 * - `not_configured` — the server has no AI engine configured;
 * - `busy` — a temporary refusal (spend cap, rate limit, engines down): try again shortly;
 * - `empty` — the engines answered but nothing playable matched;
 * - `error` — the request failed.
 */
export type PlaylistFailure = 'disabled' | 'not_configured' | 'busy' | 'empty' | 'error';

export type PlaylistResult =
  | { ok: true; playlist: GeneratedPlaylist }
  | { ok: false; reason: PlaylistFailure };

/**
 * 8.2.0 — what each failure tells the listener. Only a real switch-off says
 * AI is not enabled; a spend cap, a rate limit or a busy engine is temporary.
 */
export function playlistErrorCopy(reason: PlaylistFailure): string {
  switch (reason) {
    case 'disabled':
      return 'AI features are turned off right now.';
    case 'not_configured':
      return 'The playlist builder is not set up on this server yet.';
    case 'busy':
      return 'The playlist builder is busy right now — try again in a minute.';
    case 'empty':
      return 'No fresh matches this time — try another artist, era or mood.';
    default:
      return 'Something went wrong. Please try again.';
  }
}

/** A playlist's target length. */
const TARGET = 25;
/** The smallest on-device list worth offering when the AI curator is unavailable. */
const MIN_CATALOGUE = 8;

/** Map a failed /api/playlist answer to a reason (the body names the refusal). */
export async function failureReason(res: Response): Promise<PlaylistFailure> {
  if (res.status === 429) return 'busy';
  if (res.status !== 503) return 'error';
  const body = (await res.json().catch(() => null)) as { error?: unknown } | null;
  if (body?.error === 'ai_disabled') return 'disabled';
  if (body?.error === 'ai_not_configured') return 'not_configured';
  return 'busy';
}

/**
 * 8.2.0 — candidates straight from the catalogue for the request's language
 * and activity ("telugu dance songs", "telugu mass songs"): the phrasings the
 * catalogue is known to answer. Muted, blocked, recently served and
 * avoid-listed songs never enter; a named language is enforced.
 */
export async function gatherCataloguePool(
  intent: MusicIntent,
  languages: string[],
  muted: string[],
  avoid: string[] = [],
  signal?: AbortSignal,
): Promise<Song[]> {
  const queries = catalogQueries(intent, languages, 3);
  const settled = await Promise.allSettled(queries.map((q) => searchSongs(q, 25, { signal })));
  const library = useLibraryStore.getState();
  const served = servedKeySet();
  const avoidKeys = new Set(avoid.map(titleKey));
  const seen = new Set<string>();
  const seenTitles = new Set<string>();
  const out: Song[] = [];
  // Interleave the searches so one phrasing does not fill the pool.
  const lists = settled.map((r) => (r.status === 'fulfilled' ? r.value : []));
  for (let i = 0; i < 25; i += 1) {
    for (const list of lists) {
      const s = list[i];
      if (!s || seen.has(s.id)) continue;
      seen.add(s.id);
      out.push(s);
    }
  }
  return freshSongs(out, { excludeKeys: served, muted, blocked: (song) => isSongBlocked(song, library) }).filter((s) => {
    if (languages.length && !(s.language && languages.includes(s.language))) return false;
    const k = titleKey(s.title);
    if (avoidKeys.has(k) || seenTitles.has(k)) return false;
    seenTitles.add(k);
    return true;
  });
}

export interface Suggestion {
  title: string;
  artist: string;
  /** 8.5.0 — the curator's one line on why the song fits this request (optional; older servers send none). */
  reason?: string;
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
  /** 8.5.0 — filled with song id → the curator's reason for each resolved pick. */
  reasons?: Map<string, string>,
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
    .map((s) => ({
      title: s.title.replace(/\s+/g, ' ').trim().slice(0, 120),
      artist: s.artist.replace(/\s+/g, ' ').trim().slice(0, 120),
      reason: typeof s.reason === 'string' ? s.reason.replace(/\s+/g, ' ').trim().slice(0, 120) : '',
    }))
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
      // 8.5.0 — only the catalogue song that really IS the suggestion (title
      // and credited artist both match) is taken. When none matches, the
      // suggestion is dropped: the first search hit is a DIFFERENT song, and
      // passing it off as the curator's pick was a quiet substitution. The
      // catalogue pool, ranked against the request, fills any gap instead.
      const pick = open.find((song) => matchesProposal(song, asked[n].title, asked[n].artist));
      if (pick) {
        seen.add(pick.id);
        seenTitles.add(titleKey(pick.title));
        out.push(pick);
        if (reasons && asked[n].reason) reasons.set(pick.id, asked[n].reason);
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
  // 8.2.0 — a language the request names outranks the saved ones: "a Telugu
  // workout playlist" from a listener pinned to Hindi used to resolve every
  // Telugu pick and then filter all of them out.
  const intent = parseMusicIntent(prompt);
  const langs = intent.languages.length ? intent.languages : languages;
  // The catalogue pool is gathered (and embedded) while the curator thinks.
  const poolPromise = gatherCataloguePool(intent, langs, muted, avoidTitles, signal).catch(() => [] as Song[]);
  void poolPromise.then((pool) => {
    if (!pool.length || signal?.aborted) return;
    void embedQueryDetailed(prompt).catch(() => null);
    void embedSongs(pool);
  });
  const fromCatalogue = async (reason: PlaylistFailure): Promise<PlaylistResult> => {
    if (signal?.aborted) return { ok: false, reason: 'error' };
    const pool = await poolPromise;
    if (pool.length < MIN_CATALOGUE) return { ok: false, reason };
    const ranked = (await semanticRank(prompt, pool, { intent, leashMs: 2500, signal })).map((x) => x.song).slice(0, TARGET);
    if (signal?.aborted || ranked.length < MIN_CATALOGUE) return { ok: false, reason };
    recordServed(ranked.map(songKey));
    recordAvoidTitles(ranked.map((s) => s.title));
    return {
      ok: true,
      playlist: {
        name: intentTitle(intent) || prompt.slice(0, 60),
        description: 'Picked from the catalogue to match your idea while the AI curator takes a break.',
        songs: ranked,
        source: 'catalogue',
      },
    };
  };
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
      body: JSON.stringify({ prompt, languages: langs, taste: buildTasteSnapshot(), avoidTitles }),
      signal: ctrl.signal,
    });
  } catch {
    return fromCatalogue('error');
  } finally {
    window.clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
  if (!res.ok) return fromCatalogue(await failureReason(res));

  const data = (await res.json().catch(() => null)) as
    | { name?: unknown; description?: unknown; songs?: Suggestion[] }
    | null;
  const suggestions = Array.isArray(data?.songs) ? (data as { songs: Suggestion[] }).songs : [];
  if (!suggestions.length) return fromCatalogue('empty');

  const reasons = new Map<string, string>();
  const picked = await resolveSuggestions(suggestions, TARGET, muted, avoidTitles, langs, signal, reasons);
  if (signal?.aborted) return { ok: false, reason: 'error' };
  if (!picked.length) return fromCatalogue('empty');
  // The curator's picks keep their sequence; the catalogue pool, ranked
  // against the request (by embeddings when the engine answers), fills the rest.
  const fill = picked.length < TARGET ? await fillFromPool(prompt, intent, picked, await poolPromise, TARGET - picked.length, signal) : [];
  const songs = [...picked, ...fill];

  // Remember what this generation used — the resolved catalog titles (what
  // the listener actually saw; different model titles can collapse onto the
  // same catalog hit) AND the model's own titles — so the next run for the
  // same vibe is steered toward genuinely different picks.
  recordServed(songs.map(songKey));
  recordAvoidTitles([
    ...picked.map((s) => s.title),
    ...suggestions.flatMap((s) => (s && typeof s.title === 'string' ? [s.title.slice(0, 120)] : [])),
    ...fill.map((s) => s.title),
  ]);

  return {
    ok: true,
    playlist: {
      name: ((typeof data?.name === 'string' && data.name.trim()) || prompt).slice(0, 60),
      description: typeof data?.description === 'string' ? data.description.trim().slice(0, 240) : '',
      songs,
      source: 'ai',
      ...(reasons.size ? { reasons: Object.fromEntries(reasons) } : {}),
    },
  };
}

/** Pool songs that fit the request, not already in the list, best first. */
async function fillFromPool(prompt: string, intent: MusicIntent, have: Song[], pool: Song[], count: number, signal?: AbortSignal): Promise<Song[]> {
  if (count <= 0 || !pool.length) return [];
  const ids = new Set(have.map((s) => s.id));
  const titles = new Set(have.map((s) => titleKey(s.title)));
  const open = pool.filter((s) => !ids.has(s.id) && !titles.has(titleKey(s.title)));
  if (!open.length) return [];
  const ranked = await semanticRank(prompt, open, { intent, leashMs: 2500, signal });
  return ranked.slice(0, count).map((x) => x.song);
}
