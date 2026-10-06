import { canonicalKey, songKey } from '@/services/recommendation/songIdentity';
import { exposureLedger, recordExposure, type ExposureLedger } from '@/services/recommendation/exposure';
import { freshSongs } from '@/services/recommendation/freshness';
import { isSongBlocked, useLibraryStore } from '@/store/libraryStore';
import type { Song } from '@/types';
import { searchSongs, searchSongsPage } from '@/services/api';
import { isNativePlatform } from '@/services/native';
import { buildTasteSnapshot } from '@/services/ai/taste';
import { matchesProposal } from '@/services/ai/dj';
import { catalogQueries, intentTitle, parseMusicIntent, requestedSongCount, type MusicIntent } from '@/services/ai/musicIntent';
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
  /** 9.1.0 — set when the list is shorter than asked for, saying why in plain words. */
  shortfall?: string;
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
/**
 * 9.1.0 — how much recent exposure a CURATOR'S pick may carry and still ship.
 * The pool is held to the stricter `cooling` rule; a named suggestion is not,
 * because dropping it means padding the list with something the curator did
 * not choose. Roughly: shown somewhere lately is fine, played or skipped is not.
 */
const COOLING_TOLERANCE = 0.2;

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
 * 9.1.0 — catalogue searches per generation, and how many pages deep the
 * rotation reaches.
 *
 * `catalogQueries` often yields only two phrasings for a request ("telugu dance
 * songs", "telugu mass songs"), so WIDTH alone cannot widen the pool without
 * inventing words the listener did not ask for. Depth can: the same phrasings,
 * read further in, are still exactly what was requested. So a generation makes
 * POOL_SEARCHES requests spread over the available phrasings and POOL_PAGES
 * pages, and the round shifts the whole window.
 */
export const POOL_SEARCHES = 6;
export const POOL_PAGES = 5;
/** Results per search. */
const POOL_LIMIT = 25;

/**
 * The (phrasing, page) pairs one generation reads. Each lap over the phrasings
 * moves one page deeper, and `round` shifts the window by a whole round's worth
 * of laps, so consecutive rounds for the same prompt overlap as little as the
 * page budget allows. Deduplicated, so a single-phrasing request simply reads
 * consecutive pages of it.
 */
export function poolPlan(queries: readonly string[], round: number): Array<{ query: string; page: number }> {
  if (!queries.length) return [];
  const lapsPerRound = Math.max(1, Math.ceil(POOL_SEARCHES / queries.length));
  const seen = new Set<string>();
  const out: Array<{ query: string; page: number }> = [];
  for (let i = 0; i < POOL_SEARCHES; i += 1) {
    const query = queries[(round + i) % queries.length];
    const page = 1 + ((round * lapsPerRound + Math.floor(i / queries.length)) % POOL_PAGES);
    const key = `${query}#${page}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ query, page });
  }
  return out;
}

/**
 * Candidates straight from the catalogue for the request's language and
 * activity ("telugu dance songs", "telugu mass songs"): the phrasings the
 * catalogue is known to answer. Muted, blocked, cooling and avoid-listed songs
 * never enter; a named language is enforced.
 *
 * 9.1.0 — THE POOL ROTATES. 8.2's pool was three fixed phrasings, page 1,
 * 25 results each, with no notion of a round: the same prompt produced a
 * byte-identical pool every time, and `semanticRank` over it is deterministic,
 * so "Regenerate" could only ever return the same list minus whatever the
 * avoid list had removed. That is the root cause of "the AI Playlist keeps
 * giving me the same songs", and no amount of prompt temperature could fix it,
 * because the fallback path never asked a model at all.
 *
 * Now each `round` asks SIX phrasings instead of three, starts at a different
 * one, and reads a different page of each, so consecutive rounds for one prompt
 * draw on largely different catalogue results. Cost: six searches instead of
 * three, run in parallel, each still bounded by the caller's signal.
 */
export async function gatherCataloguePool(
  intent: MusicIntent,
  languages: string[],
  muted: string[],
  avoid: string[] = [],
  signal?: AbortSignal,
  options: { round?: number; ledger?: ExposureLedger; fewerRepeats?: boolean } = {},
): Promise<Song[]> {
  const round = Math.max(0, Math.floor(options.round ?? 0));
  const all = catalogQueries(intent, languages, POOL_SEARCHES);
  const settled = await Promise.allSettled(
    poolPlan(all, round).map((p) => searchSongsPage(p.query, p.page, POOL_LIMIT, { signal })),
  );
  const library = useLibraryStore.getState();
  const ledger = options.ledger ?? exposureLedger();
  const avoidKeys = new Set(avoid.map(titleKey));
  const seen = new Set<string>();
  const seenTitles = new Set<string>();
  const out: Song[] = [];
  // Interleave the searches so one phrasing does not fill the pool.
  const lists = settled.map((r) => (r.status === 'fulfilled' ? r.value : []));
  for (let i = 0; i < POOL_LIMIT; i += 1) {
    for (const list of lists) {
      const s = list[i];
      if (!s || seen.has(s.id)) continue;
      seen.add(s.id);
      out.push(s);
    }
  }
  return freshSongs(out, { muted, blocked: (song) => isSongBlocked(song, library) }).filter((s) => {
    if (languages.length && !(s.language && languages.includes(s.language))) return false;
    const k = titleKey(s.title);
    if (avoidKeys.has(k) || seenTitles.has(k)) return false;
    // 9.1.0 — the shared exposure ledger, not a shown-only list: a song this
    // listener was shown, queued, played or skipped lately is still cooling.
    // Under "fewer repeats" ANY exposure at all is enough to leave it out.
    if (options.fewerRepeats ? ledger.penalty(songKey(s)) > 0 : ledger.cooling(songKey(s))) return false;
    seenTitles.add(k);
    return true;
  });
}

/* ---------- per-prompt rounds ---------- */

const ROUNDS_KEY = 'vinax.aiplaylist.rounds.v1';
const ROUNDS_CAP = 40;

/** The prompt, reduced to what makes two requests "the same idea". */
export const promptRoundKey = (prompt: string): string => prompt.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim().slice(0, 80);

function loadRounds(): Record<string, number> {
  try {
    const raw = JSON.parse(window.localStorage.getItem(ROUNDS_KEY) || '{}') as unknown;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
    return out;
  } catch {
    return {};
  }
}

/**
 * Which round this prompt is on. `bump` moves it on, and the counter is
 * PERSISTED, so "Regenerate" reaches new catalogue pages after a reload too —
 * a session-only counter would hand back round 0's pool on every cold start.
 */
export function playlistRound(prompt: string, bump = false): number {
  const key = promptRoundKey(prompt);
  if (!key) return 0;
  const rounds = loadRounds();
  const next = (rounds[key] ?? 0) + (bump ? 1 : 0);
  if (bump) {
    rounds[key] = next;
    try {
      // Keep the most recently bumped prompts only.
      const kept = Object.entries(rounds).slice(-ROUNDS_CAP);
      window.localStorage.setItem(ROUNDS_KEY, JSON.stringify(Object.fromEntries(kept)));
    } catch {
      /* the counter is a convenience; the round is still used for this call */
    }
  }
  return next;
}

/** Tests: forget every round counter. */
export function resetPlaylistRounds(): void {
  try {
    window.localStorage.removeItem(ROUNDS_KEY);
  } catch {
    /* nothing stored */
  }
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
  /** 9.1.0 — "fewer repeats": hold the curator's own picks to the strict rule too. */
  options: { fewerRepeats?: boolean } = {},
): Promise<Song[]> {
  const out: Song[] = [];
  const seen = new Set<string>();
  const seenTitles = new Set<string>();
  const avoidKeys = new Set(avoid.map(titleKey));
  const ledger = exposureLedger();
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
        muted, blocked: (song) => isSongBlocked(song, library),
      })
        .filter((song) => !languages.length || (song.language != null && languages.includes(song.language)))
        // 9.1.0 — a curator pick the listener met very recently is held back,
        // but a cooling song is still better than dropping the suggestion and
        // padding from the pool, so only the strongest cooling applies here:
        // the curator chose this song FOR this request. Under "fewer repeats"
        // that allowance is withdrawn — the listener explicitly asked for new.
        .filter((song) => (options.fewerRepeats ? ledger.penalty(songKey(song)) === 0 : !ledger.cooling(songKey(song)) || ledger.penalty(songKey(song)) < COOLING_TOLERANCE));
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

/**
 * 9.1.0 — what a generation is allowed to reuse and what it must replace.
 */
export interface GenerateOptions {
  signal?: AbortSignal;
  /**
   * This is a REGENERATION of the same idea: move the prompt's round on, so the
   * catalogue pool is read from different phrasings and pages. Without it two
   * "Regenerate" taps would ask the catalogue the same question twice.
   */
  regenerate?: boolean;
  /**
   * Songs the listener locked. They are kept, in place, and the rest of the
   * list is rebuilt around them — never replaced, never counted as a repeat.
   */
  locked?: readonly Song[];
  /**
   * Songs this generation must not return (a "replace this track" request, or
   * the tracks a refinement is dropping). Canonical keys, so an alternate
   * release of a rejected song does not come back instead.
   */
  exclude?: readonly Song[];
  /** How many songs to return. Defaults to the length the request asks for, else TARGET. */
  limit?: number;
  /**
   * 9.1.0 — a refinement of the playlist already on screen ("more upbeat",
   * "fewer film songs"). It is appended to the request the curator sees and
   * re-parsed, so a refinement that names a mood or a tempo really changes the
   * pool — not only the prompt. Locked tracks survive it.
   */
  refine?: string;
  /**
   * "Refresh with fewer repeats". A normal generation leaves out songs that are
   * still COOLING; this one leaves out everything the listener has met at all
   * inside the ledger's horizons, and holds the curator's own picks to the same
   * rule instead of letting a named suggestion through. It can return a shorter
   * list — which is the honest outcome when the catalogue has little else to
   * offer, and better than quietly serving the same songs again.
   */
  fewerRepeats?: boolean;
}

/** Build a playlist from a natural-language description. */
export async function generatePlaylist(
  prompt: string,
  languages: string[],
  muted: string[] = [],
  signalOrOptions?: AbortSignal | GenerateOptions,
): Promise<PlaylistResult> {
  let res: Response;
  // Back-compatible: three call sites pass a bare AbortSignal.
  const options: GenerateOptions = signalOrOptions && 'aborted' in (signalOrOptions as AbortSignal) ? { signal: signalOrOptions as AbortSignal } : ((signalOrOptions as GenerateOptions) ?? {});
  const signal = options.signal;
  const locked = (options.locked ?? []).filter((x) => !!x?.id);
  const lockedKeys = new Set(locked.map(songKey));
  const excludeKeys = new Set((options.exclude ?? []).filter((x) => !!x?.id).map(songKey));
  // 9.1.0 — a refinement is part of the request from here on: the intent, the
  // catalogue pool and the curator all see it.
  const refine = (options.refine ?? '').replace(/\s+/g, ' ').trim().slice(0, 200);
  const ask = refine ? `${prompt} — ${refine}` : prompt;
  // 8.2.0 — a language the request names outranks the saved ones: "a Telugu
  // workout playlist" from a listener pinned to Hindi used to resolve every
  // Telugu pick and then filter all of them out.
  const intent = parseMusicIntent(ask);
  const langs = intent.languages.length ? intent.languages : languages;
  // 9.1.0 — a length the request asked for is honoured: "15 songs" gives 15, and
  // "about an hour" gives roughly an hour's worth (requestedSongCount — a
  // duration is approximate by construction, and the app says so).
  const asked = requestedSongCount(intent);
  const target = Math.max(1, Math.min(50, Math.floor(options.limit ?? asked ?? TARGET)));
  /**
   * 9.1.0 — when the list comes out short, SAY why rather than padding it with
   * songs that do not fit the request. A duration is always approximate: song
   * lengths are not known until a song is resolved, so "about an hour" is a
   * count, and the copy says "about".
   */
  const shortfall = (got: number): string => {
    if (got >= target) return '';
    const wanted = asked && intent.length?.minutes ? `about ${intent.length.minutes} minutes` : `${target} songs`;
    return `Only ${got} song${got === 1 ? '' : 's'} matched closely enough for ${wanted} — the rest would have been a stretch, so they were left out.`;
  };
  // How many songs this generation has to find (the locked ones are already found).
  const need = Math.max(0, target - locked.length);
  const round = playlistRound(prompt, options.regenerate === true);
  const ledger = exposureLedger();
  /** Keep the locked songs in place and drop anything the caller rejected. */
  const assemble = (found: readonly Song[]): Song[] => {
    const fresh = found.filter((x) => !lockedKeys.has(songKey(x)) && !excludeKeys.has(songKey(x)));
    if (!locked.length) return fresh.slice(0, target);
    const out = [...locked];
    for (const x of fresh) {
      if (out.length >= target) break;
      out.push(x);
    }
    return out;
  };
  const avoidTitles = loadAvoidTitles();
  // The catalogue pool is gathered (and embedded) while the curator thinks.
  const poolPromise = gatherCataloguePool(intent, langs, muted, avoidTitles, signal, { round, ledger, fewerRepeats: options.fewerRepeats === true }).catch(() => [] as Song[]);
  void poolPromise.then((pool) => {
    if (!pool.length || signal?.aborted) return;
    void embedQueryDetailed(prompt).catch(() => null);
    void embedSongs(pool);
  });
  const fromCatalogue = async (reason: PlaylistFailure): Promise<PlaylistResult> => {
    if (signal?.aborted) return { ok: false, reason: 'error' };
    const pool = await poolPromise;
    if (pool.length + locked.length < MIN_CATALOGUE) return { ok: false, reason };
    const ranked = (await semanticRank(prompt, pool, { intent, leashMs: 2500, signal })).map((x) => x.song);
    const songs = assemble(ranked);
    if (signal?.aborted || songs.length < Math.min(MIN_CATALOGUE, target)) return { ok: false, reason };
    // Only the songs this generation CHOSE count as exposure; a locked song the
    // listener pinned is not a fresh impression.
    recordExposure(songs.filter((x) => !lockedKeys.has(songKey(x))), 'shown');
    recordAvoidTitles(songs.map((s) => s.title));
    return {
      ok: true,
      playlist: {
        name: intentTitle(intent) || prompt.slice(0, 60),
        description: ['Picked from the catalogue to match your idea while the AI curator takes a break.', shortfall(songs.length)].filter(Boolean).join(' '),
        songs,
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
      body: JSON.stringify({
        // The refinement travels as part of the request, so the curator reworks
        // the idea rather than answering the original one again.
        prompt: ask,
        languages: langs,
        taste: buildTasteSnapshot(),
        // The curator is told what not to suggest: earlier generations, the
        // songs the listener locked (it must not spend picks re-proposing them)
        // and anything they rejected.
        avoidTitles: [...new Set([...avoidTitles, ...locked.map((x) => x.title), ...(options.exclude ?? []).map((x) => x.title)])].slice(0, 140),
        round,
        // 9.1.0 — how many songs the listener asked for, when they said.
        ...(asked ? { wantSongs: target } : {}),
      }),
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
  const resolved = await resolveSuggestions(suggestions, need, muted, avoidTitles, langs, signal, reasons, { fewerRepeats: options.fewerRepeats === true });
  if (signal?.aborted) return { ok: false, reason: 'error' };
  const picked = resolved.filter((x) => !lockedKeys.has(songKey(x)) && !excludeKeys.has(songKey(x)));
  if (!picked.length && !locked.length) return fromCatalogue('empty');
  // The curator's picks keep their sequence; the catalogue pool, ranked
  // against the request (by embeddings when the engine answers), fills the rest.
  const fill = picked.length < need ? await fillFromPool(prompt, intent, [...locked, ...picked], await poolPromise, need - picked.length, signal) : [];
  const songs = assemble([...picked, ...fill]);

  // Remember what this generation used — the resolved catalog titles (what
  // the listener actually saw; different model titles can collapse onto the
  // same catalog hit) AND the model's own titles — so the next run for the
  // same vibe is steered toward genuinely different picks.
  recordExposure(songs.filter((x) => !lockedKeys.has(songKey(x))), 'shown');
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
      ...(shortfall(songs.length) ? { shortfall: shortfall(songs.length) } : {}),
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
