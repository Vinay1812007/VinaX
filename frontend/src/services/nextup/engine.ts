import type { Song } from '@/types';
import type { RecommendationContext, RejectReason as DebugRejectReason } from '@/services/recommendation/types';
import type { FallbackReason, NextRecommendationOptions, NextSongsPlan } from '@/services/recommendation/engine';
import { getArtistTopSongs, getSongSuggestions, searchSongs } from '@/services/api/saavn';
import { fetchPersonalRecommendations, personalEnabled } from '@/services/personal/api';
import { toSong } from '@/services/personal/types';
import { useSettingsStore } from '@/store/settingsStore';
import { songKey } from '@/services/recommendation/songKey';
import { inferMood, type Mood } from '@/services/recommendation/mood';
import { exposureLedger, recordExposure } from '@/services/recommendation/exposure';
import { tuneScoreAdjust, tuneSearchQuery } from '@/services/recommendation/tune';
import { isSoftMuted } from '@/services/recommendation/admission';
import { getSessionIntent } from '@/services/personalization/sessionIntent';
import { topArtists, topLanguages } from '@/services/personalization/profile';
import { isSongBlocked, useLibraryStore } from '@/store/libraryStore';
import { useReasonStore } from '@/store/reasonStore';
import { useDownloadsStore } from '@/store/downloadsStore';
import { kidModeOn } from '@/services/kidMode';
import { peekAnchor, readAnchor, type Anchor } from './anchor';

// The player and the library reach the anchor through this module (one lazy chunk).
export { addAnchorSeed, avoidArtist, removeAnchorSeed, startAnchor } from './anchor';
import { playedMap, recordPlayed, recordServed, servedMap } from './memory';
import {
  LIKED_COOLDOWN_MS,
  PLAYED_COOLDOWN_MS,
  SERVED_COOLDOWN_MS,
  languageOf,
  leadOf,
  medianYear,
  pickSequence,
  rejectReason,
  scoreCandidate,
  type Candidate,
  type FilterContext,
  type RejectReason,
  type ScoreContext,
  type Source,
} from './rules';
import { planLookups, runLookups, type CatalogueApi, type Fetched } from './sources';

/**
 * VinaX V2 — Up Next, rewritten.
 *
 * What the listener told us was wrong with the old continuation, and what
 * this engine does about each:
 *
 *  - It repeated songs and artists. → A song heard in the last 72 hours (18
 *    for a liked one), or queued automatically in the last 24 and never
 *    reached, is not picked. The same artist never comes back within four
 *    songs, nor more than twice in ten, judged across the history and the
 *    whole upcoming queue — not one batch of five at a time.
 *  - It drifted off the language and the mood. → Every stretch is planned
 *    from the session's ANCHOR (./anchor.ts: the songs the listener chose),
 *    never from the last automatic pick, and stays in the anchor's
 *    languages and mood. Devotional and film music never cross.
 *  - It ignored likes. → Likes are sources of their own (similar songs of
 *    liked songs, top songs of liked artists, the liked songs themselves),
 *    a liked artist scores well above a stranger, and a like during the
 *    session joins the anchor at once.
 *  - It was slow and stalled. → A warm pool of ranked candidates is kept
 *    for the session and refilled in the background; a plan picks from it
 *    synchronously and only waits for the catalogue when the pool is empty,
 *    and then for at most four seconds. When nothing is left, the rules
 *    loosen step by step (spacing, then the listener's other languages,
 *    then shorter cooldowns) rather than leaving the player paused.

 */

export const NEXTUP_VERSION = '2.0.0';
/** Longest a plan waits for the catalogue when the warm pool cannot serve it. */
export const NEXTUP_DEADLINE_MS = 4_000;
/** Below this many usable candidates, the pool refills in the background. */
export const POOL_LOW_WATER = 15;
/** A warm pool older than this is rebuilt (catalogue answers and taste move). */
export const POOL_TTL_MS = 30 * 60_000;
/** Most candidates the pool holds. */
export const POOL_CAP = 400;
/** Most candidates one catalogue lookup adds (a refill makes about seven). */
export const PER_LOOKUP_MAX = 40;
/**
 * A sitting's pull at or below this keeps the artist out of the session's
 * automatic picks: two skips, or a "Not interested". One skip of an AUTOMATIC
 * song does it on its own (anchor.avoidArtist, from the skip handler); one
 * skip of the listener's own song does not.
 */
export const AVOID_PULL = -0.6;

interface Pool {
  /** The session this pool belongs to (the anchor's start). */
  session: number;
  /** The anchor version it last looked up; a newer anchor (a like, an add) asks the catalogue again. */
  version: number;
  at: number;
  items: Map<string, Candidate>;
  /** Tune / mood searches already asked of the catalogue for this pool. */
  asked: Set<string>;
}

let pool: Pool | null = null;
let rotation = 0;
let refilling: Promise<void> | null = null;

const defaultApi: CatalogueApi = {
  similar: (id, limit, signal) => getSongSuggestions(id, limit, { signal }),
  artistTop: (id) => getArtistTopSongs(id, 0),
  personalOn: () => personalEnabled(),
  // The server answers display records without audio; each resolves when it starts (the player
  // refetches a song that has none). Nothing is resolved here on purpose: a list in which some
  // songs carry audio and others do not marks the others unplayable (addToPool).
  personal: async (seedId, limit, signal) => (await fetchPersonalRecommendations({ seed: seedId, limit, signal, mode: useSettingsStore.getState().discoveryMode })).map(toSong),
  search: (q, limit, signal) => searchSongs(q, limit, { signal }),
};
let api: CatalogueApi = defaultApi;

/** Test hooks. */
export function setCatalogueApi(next: CatalogueApi | null): void {
  api = next ?? defaultApi;
}
export function resetNextUp(): void {
  pool = null;
  rotation = 0;
  refilling = null;
}
export function poolSize(): number {
  return pool?.items.size ?? 0;
}

function poolFor(anchor: Anchor, now: number): { pool: Pool; moved: boolean } {
  if (!pool || pool.session !== anchor.startedAt || now - pool.at > POOL_TTL_MS) {
    pool = { session: anchor.startedAt, version: anchor.version, at: now, items: new Map(), asked: new Set() };
    refilling = null;
    return { pool, moved: false };
  }
  // Same session, newer anchor: keep what the pool holds, and look up the new seed.
  const moved = pool.version !== anchor.version;
  pool.version = anchor.version;
  return { pool, moved };
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, Math.max(0, ms)));

/** Record that a song started playing (the 72-hour no-repeat ledger); it also leaves the pool. */
export function notePlayed(song: Song): void {
  if (!song?.id) return;
  recordPlayed(songKey(song));
  pool?.items.delete(song.id);
}

const playable = (s: Song): boolean => Array.isArray(s.audio) && s.audio.some((a) => !!a?.url);

function addToPool(p: Pool, songs: readonly Song[], source: Source, via: string | undefined, now: number): void {
  // A song with no stream where the rest of its answer had one cannot play
  // (the catalogue's own sign); a list with no streams at all is details to fetch on play.
  const anyAudio = songs.some((s) => s && playable(s));
  for (const song of songs) {
    if (!song?.id) continue;
    const have = p.items.get(song.id);
    if (have) {
      have.sources.add(source);
      continue;
    }
    // Full: the oldest candidate makes room (a Map iterates in insertion order),
    // so a newer lookup — a like, a refill in a new direction — always gets in.
    while (p.items.size >= POOL_CAP) {
      const oldest = p.items.keys().next().value;
      if (oldest === undefined) break;
      p.items.delete(oldest);
    }
    p.items.set(song.id, { song, sources: new Set([source]), via, at: now, ...(anyAudio && !playable(song) ? { unplayable: true } : {}) });
  }
}

/**
 * Drop what can never be picked this session (skipped, blocked, unplayable,
 * a skipped artist). Songs on a cooldown stay: the last step of the fallback
 * may shorten it, and the oldest-first eviction makes room anyway.
 */
function prune(p: Pool, filter: FilterContext): void {
  for (const [id, c] of p.items) {
    const why = rejectReason(c.song, filter);
    if (why === 'skipped' || why === 'blocked' || why === 'no-audio' || why === 'artist-skipped') p.items.delete(id);
  }
}

/** The plan's view of the listener: everything the rules read, gathered once. */
interface Env {
  anchor: Anchor;
  seed: Song;
  ctx: RecommendationContext;
  languages: string[];
  mood: Mood | null;
  likedIds: Set<string>;
  likedLeads: Map<string, number>;
  pull: Record<string, number>;
  avoidLeads: Set<string>;
  skippedIds: Set<string>;
  played: Map<string, number>;
  served: Map<string, number>;
  tuneQuery: string | null;
  score: ScoreContext;
  now: number;
}

function buildEnv(seed: Song, ctx: RecommendationContext, anchor: Anchor, options: NextRecommendationOptions, now: number): Env {
  const favorites = ctx.favorites ?? [];
  const likedIds = new Set(favorites.map((s) => s.id));
  const likedLeads = new Map<string, number>();
  for (const s of favorites) {
    const l = leadOf(s);
    if (l) likedLeads.set(l, (likedLeads.get(l) ?? 0) + 1);
  }
  const intent = ctx.sessionIntent ?? getSessionIntent(now);
  const pull = intent.artistPull ?? {};
  const avoidLeads = new Set([...Object.entries(pull).filter(([, v]) => v <= AVOID_PULL).map(([k]) => k), ...(anchor.avoided ?? [])]);
  const listener = [...new Set([...ctx.pinnedLanguages, ...topLanguages(ctx.profile, 3).map((l) => l.id)])].map((l) => l.toLowerCase()).filter((l) => l && l !== 'unknown' && !ctx.mutedLanguages.includes(l));
  const tune = options.tune ?? null;
  let languages = anchor.languages.length ? [...anchor.languages] : languageOf(seed) ? [languageOf(seed) as string] : listener;
  if (ctx.queueLanguages === 'one' && languages.length > 1) languages = languages.slice(0, 1);
  if (tune === 'different-language') {
    const other = listener.find((l) => !languages.includes(l));
    if (other) languages = [other];
  }
  const mood = ctx.moodPin ?? anchor.mood;
  const ledger = exposureLedger(now);
  const tasteLeads = new Set(topArtists(ctx.profile, 20).map((a) => (a.affinity.name ?? '').trim().toLowerCase()).filter(Boolean));
  const tuneQuery = tune ? tuneSearchQuery(tune, languages[0] ?? null) : null;
  const moodCache = new Map<string, Mood>();
  const score: ScoreContext = {
    languages,
    mood,
    year: medianYear(anchor.seeds.map((s) => s.song)),
    likedLeads,
    likedIds,
    pull,
    tasteLeads,
    moodOf: (s) => {
      let m = moodCache.get(s.id);
      if (!m) { m = inferMood(s); moodCache.set(s.id, m); }
      return m;
    },
    // A liked song pays a quarter of the exposure cost: the listener wants it back.
    exposure: (s) => ledger.penalty(songKey(s)) * (likedIds.has(s.id) ? 0.25 : 1),
    ...(tune ? { tune: (s: Song) => tuneScoreAdjust(s, tune, languages[0] ?? null) } : {}),
    salt: ctx.salt ?? 0,
  };
  return {
    anchor,
    seed,
    ctx,
    languages,
    mood,
    likedIds,
    likedLeads,
    pull,
    avoidLeads,
    skippedIds: new Set(intent.skippedSongIds ?? []),
    played: playedMap(ctx.history ?? [], songKey, now),
    served: servedMap(now),
    tuneQuery,
    score,
    now,
  };
}

interface Relax {
  languages?: string[];
  cooldownFactor?: number;
}

function filterFor(env: Env, queued: { ids: ReadonlySet<string>; keys: ReadonlySet<string> }, relax: Relax = {}): FilterContext {
  const library = useLibraryStore.getState();
  const f = relax.cooldownFactor ?? 1;
  return {
    languages: new Set(relax.languages ?? env.languages),
    mutedLanguages: new Set(env.ctx.mutedLanguages.map((l) => l.toLowerCase())),
    queuedIds: queued.ids,
    queuedKeys: queued.keys,
    keyOf: songKey,
    playedAt: env.played,
    servedAt: env.served,
    likedIds: env.likedIds,
    skippedIds: env.skippedIds,
    avoidLeads: env.avoidLeads,
    blocked: (s) => isSongBlocked(s, library),
    softMuted: (s) => isSoftMuted(s, env.now),
    hideExplicit: kidModeOn(),
    now: env.now,
    playedCooldownMs: PLAYED_COOLDOWN_MS * f,
    likedCooldownMs: LIKED_COOLDOWN_MS * f,
    servedCooldownMs: SERVED_COOLDOWN_MS * f,
  };
}

/** The pool's usable candidates under a filter, best first. */
function rank(p: Pool, env: Env, filter: FilterContext): Candidate[] {
  const scored: Array<{ c: Candidate; s: number }> = [];
  const downloads = useDownloadsStore.getState().items;
  for (const c of p.items.values()) {
    if (c.unplayable && !downloads[c.song.id]) continue;
    if (rejectReason(c.song, filter) !== null) continue;
    scored.push({ c, s: scoreCandidate(c, env.score) });
  }
  scored.sort((a, b) => b.s - a.s);
  return scored.map((x) => x.c);
}

/** The liked songs and the listener's repeat plays, straight into the pool (no network). */
function seedPoolLocally(p: Pool, env: Env): void {
  const favorites = (env.ctx.favorites ?? []).slice(0, 80);
  addToPool(p, favorites, 'liked', undefined, env.now);
  const counts = new Map<string, { song: Song; n: number }>();
  for (const e of env.ctx.history ?? []) {
    if (!e?.song?.id || e.skipped) continue;
    const row = counts.get(e.song.id) ?? { song: e.song, n: 0 };
    row.n += 1;
    counts.set(e.song.id, row);
  }
  addToPool(p, [...counts.values()].filter((r) => r.n >= 2).sort((a, b) => b.n - a.n).slice(0, 30).map((r) => r.song), 'favourite-play', undefined, env.now);
}

/**
 * Ask the catalogue for more, in the session's direction. Answers past the
 * deadline still warm the pool. A refill already running is joined — unless
 * the anchor moved since it was planned (`fresh`: a like, an add), in which
 * case a new one follows it, so the new seed is always looked up.
 */
function refill(p: Pool, env: Env, deadlineMs: number, signal?: AbortSignal, fresh = false): Promise<void> {
  if (refilling) {
    if (!fresh) return refilling;
    const after = refilling.then(() => refill(p, env, deadlineMs, signal));
    return after;
  }
  const pulled: Array<{ id: string; name: string }> = [];
  for (const [lead, v] of Object.entries(env.pull).sort((a, b) => b[1] - a[1])) {
    if (v < 0.3) break;
    const s = [...(env.ctx.favorites ?? []), ...env.anchor.seeds.map((x) => x.song)].find((x) => leadOf(x) === lead && x.artists?.[0]?.id);
    if (s) pulled.push({ id: s.artists[0].id, name: s.artists[0].name });
  }
  const lookups = planLookups({ anchor: env.anchor, favorites: env.ctx.favorites ?? [], pulledArtists: pulled, rotation: rotation++, tuneQuery: env.tuneQuery, api, signal });
  if (env.tuneQuery) p.asked.add(env.tuneQuery);
  // One lookup adds at most this many: a single huge answer can never push out what the other lookups (a new like) just brought.
  const merge = (f: Fetched): void => {
    if (pool === p) addToPool(p, f.songs.slice(0, PER_LOOKUP_MAX), f.source, f.via, Date.now());
  };
  const job = runLookups(lookups, deadlineMs, signal, merge).then((results) => {
    for (const f of results) merge(f);
  }).finally(() => {
    if (refilling === job) refilling = null;
  });
  refilling = job;
  return job;
}

/** The developer breakdown's names for this engine's rules. */
const DEBUG_REASON: Record<RejectReason, DebugRejectReason> = {
  'no-audio': 'no-audio',
  queued: 'already-queued',
  'played-recently': 'recently-played',
  'served-recently': 'recently-played',
  skipped: 'skipped-this-session',
  'artist-skipped': 'skipped-this-session',
  blocked: 'blocked',
  explicit: 'explicit',
  'muted-language': 'muted-language',
  'other-language': 'off-language',
  'soft-muted': 'soft-muted',
};

/** The developer breakdown (`?debug=recs`): only built when it is switched on. */
function publishDebug(p: Pool, env: Env, filter: FilterContext, songs: Song[], relaxed: string[], latencyMs: number, fallback: FallbackReason | null): void {
  void import('@/store/recsDebugStore').then((m) => {
    if (!m.recsDebugEnabled()) return;
    const rejected: Array<{ song: Song; reason: DebugRejectReason; stage: 'filter' }> = [];
    const scored: Array<{ c: Candidate; s: number }> = [];
    const sources: Record<string, number> = {};
    for (const c of p.items.values()) {
      for (const src of c.sources) sources[src] = (sources[src] ?? 0) + 1;
      const why = rejectReason(c.song, filter);
      if (why) rejected.push({ song: c.song, reason: DEBUG_REASON[why], stage: 'filter' });
      else scored.push({ c, s: scoreCandidate(c, env.score) });
    }
    scored.sort((a, b) => b.s - a.s);
    const rankOf = new Map(scored.map((x, i) => [x.c.song.id, i + 1]));
    const scoreOf = new Map(scored.map((x) => [x.c.song.id, x.s]));
    const chosen = new Set(songs.map((s) => s.id));
    const sourceOf = (id: string): string => [...(p.items.get(id)?.sources ?? [])].join('+') || 'unknown';
    m.useRecsDebugStore.getState().publish(
      songs.map((song, i) => ({ position: i + 1, rank: rankOf.get(song.id), song, finalScore: scoreOf.get(song.id) ?? 0, source: sourceOf(song.id), components: [], picker: 'local' as const })),
      {
        trace: {
          mode: 'balanced',
          shape: env.mood ?? 'steady',
          lock: env.languages[0] ?? null,
          languagePolicy: env.languages.length > 1 ? 'prefer' : 'lock',
          discoveryShare: 0,
          intent: null,
          stages: { candidates: p.items.size, admitted: scored.length, ranked: scored.length, sequenced: songs.length, validated: songs.length },
          relaxed,
          repairs: 0,
          latencyMs,
          fallback,
          sources,
        },
        rejected,
        passedOver: scored.filter((x) => !chosen.has(x.c.song.id)).slice(0, 15).map((x) => ({ song: x.c.song, rank: rankOf.get(x.c.song.id) ?? 0, finalScore: x.s, source: sourceOf(x.c.song.id), components: [] })),
      },
    );
  }).catch(() => undefined);
}

function whyLine(c: Candidate | undefined): string | null {
  if (!c) return null;
  const has = (s: Source): boolean => c.sources.has(s);
  if (has('tune')) return 'Fits how you tuned this queue';
  if (has('liked-similar') && c.via) return `Like “${c.via}”, from your liked songs`;
  if (has('liked-artist') && c.via) return `${c.via} — an artist you like`;
  if (has('anchor') && c.via) return `Because you chose “${c.via}”`;
  if (has('liked')) return 'From your liked songs';
  if (has('favourite-play')) return 'One you keep coming back to';
  return null;
}

/**
 * Plan the next stretch of the queue. Same contract as the 7.2 plan: the
 * songs now, side effects only on `commit`, a `topUp` from the same pool,
 * all decided on the device.
 */
export async function planNextSongs(seed: Song, ctx: RecommendationContext, options: NextRecommendationOptions & { before?: Song[] } = {}): Promise<NextSongsPlan> {
  const t0 = Date.now();
  const alg = `nextup-${NEXTUP_VERSION}`;
  const limit = Math.max(0, Math.min(40, Math.floor(options.limit ?? 5)));
  const signal = options.signal;
  const anchor = readAnchor(seed, t0, ctx.history?.[0]?.ts ?? 0);
  const env = buildEnv(seed, ctx, anchor, options, t0);
  const language = env.languages[0] ?? null;
  const empty = (fallback: FallbackReason | null): NextSongsPlan => ({ songs: [], picker: 'local', fallback, latencyMs: Date.now() - t0, alg, relaxed: [], discoveryIds: new Set(), language, commit: () => undefined, topUp: () => [] });
  if (!limit || signal?.aborted) return empty(null);

  const { pool: p, moved } = poolFor(anchor, t0);
  if (!p.items.size) seedPoolLocally(p, env);
  const queued = { ids: new Set(options.excludeIds ?? []), keys: new Set(options.excludeKeys ?? []) };
  prune(p, filterFor(env, queued));
  // The listener just steered — a like or an add (the anchor moved), or a new
  // tune or pinned mood nobody has searched for yet: give that lookup time to
  // land so this stretch already follows it.
  const newTune = !!env.tuneQuery && !p.asked.has(env.tuneQuery);
  if (moved || newTune) {
    const steer = refill(p, env, NEXTUP_DEADLINE_MS * 2, undefined, true);
    await Promise.race([steer, sleep(newTune ? NEXTUP_DEADLINE_MS : Math.min(1_500, options.deadlineMs ?? 1_500))]);
    if (signal?.aborted) return empty(null);
  }
  // The songs the stretch follows, oldest first: recent history, then the queue up to the append point.
  const tail = options.before?.length ? options.before.slice(-12) : [options.previous ?? seed];
  const inTail = new Set(tail.map((s) => s.id));
  const historyBefore = (ctx.history ?? []).slice(0, 10).map((e) => e.song).filter((s) => s && !inTail.has(s.id)).reverse();
  const before = [...historyBefore, ...tail];

  let fallback: FallbackReason | null = null;
  const relaxed: string[] = [];
  const attempt = (relax: Relax = {}): { songs: Song[]; relaxed: string[]; usable: number } => {
    const ranked = rank(p, env, filterFor(env, queued, relax));
    const picked = pickSequence(ranked.map((c) => c.song), before, limit, songKey);
    return { ...picked, usable: ranked.length };
  };

  let result = attempt();
  if (result.songs.length < limit) {
    // The pool cannot serve this stretch: wait for the catalogue, inside the deadline.
    const deadline = Math.min(NEXTUP_DEADLINE_MS, Math.max(1_000, options.deadlineMs ?? NEXTUP_DEADLINE_MS));
    const waitStart = Date.now();
    // A refill already running (started for an earlier stretch) is joined, never waited on past this deadline.
    await Promise.race([refill(p, env, deadline, signal), sleep(deadline)]);
    if (Date.now() - waitStart >= deadline - 50) fallback = 'deadline';
    if (signal?.aborted) return empty(null);
    result = attempt();
  }
  if (result.songs.length < Math.min(limit, 3)) {
    // The liked songs and repeat plays are always there to fall back on (eviction may have dropped them).
    seedPoolLocally(p, env);
    result = attempt();
  }
  if (result.songs.length < Math.min(limit, 3)) {
    // Loosen, one step at a time: the listener's other languages, then shorter cooldowns.
    const listener = [...new Set([...env.languages, ...ctx.pinnedLanguages.map((l) => l.toLowerCase()), ...topLanguages(ctx.profile, 3).map((l) => l.id.toLowerCase())])];
    if (listener.length > env.languages.length) {
      const wider = attempt({ languages: listener });
      if (wider.songs.length > result.songs.length) { result = wider; relaxed.push('language'); }
    }
    if (result.songs.length < Math.min(limit, 3)) {
      const shorter = attempt({ languages: relaxed.includes('language') ? listener : env.languages, cooldownFactor: 1 / 3 });
      if (shorter.songs.length > result.songs.length) { result = shorter; relaxed.push('cooldown'); }
    }
  }
  relaxed.unshift(...result.relaxed);
  // Keep the pool warm for the next stretch without making this one wait.
  if (result.usable - result.songs.length < POOL_LOW_WATER) void refill(p, env, NEXTUP_DEADLINE_MS * 2);

  const songs = result.songs;
  publishDebug(p, env, filterFor(env, queued), songs, relaxed, Date.now() - t0, fallback);
  const committed = new Set<string>();
  const commit = (accepted: Song[]): void => {
    const fresh = accepted.filter((s) => !committed.has(s.id));
    if (!fresh.length) return;
    for (const s of fresh) committed.add(s.id);
    try {
      recordServed(fresh.map(songKey));
      recordExposure(fresh, 'queued');
      const lines: Array<[string, string]> = [];
      for (const s of fresh) {
        const why = whyLine(p.items.get(s.id));
        if (why) lines.push([s.id, why]);
      }
      if (lines.length) useReasonStore.getState().setReasons(lines);
    } catch {
      /* the memory is optional */
    }
  };
  const topUp = (seedNow: Song, n: number, exclude: { ids: Set<string>; keys: Set<string> }): Song[] => {
    if (n <= 0) return [];
    // A reserve from another session (a new list, a new radio) is never used.
    if (pool !== p || peekAnchor()?.startedAt !== anchor.startedAt) return [];
    const ids = new Set([...queued.ids, ...exclude.ids]);
    const keys = new Set([...queued.keys, ...exclude.keys]);
    // What the listener did since this plan (skips, likes) holds for the top-up too.
    const now = Date.now();
    const intentNow = getSessionIntent(now);
    const live: Env = {
      ...env,
      now,
      skippedIds: new Set([...env.skippedIds, ...(intentNow.skippedSongIds ?? [])]),
      avoidLeads: new Set([...env.avoidLeads, ...Object.entries(intentNow.artistPull ?? {}).filter(([, v]) => v <= AVOID_PULL).map(([k]) => k), ...(peekAnchor()?.avoided ?? [])]),
      played: playedMap(ctx.history ?? [], songKey, now),
    };
    const ranked = rank(p, live, filterFor(live, { ids, keys }));
    const picked = pickSequence(ranked.map((c) => c.song), [...before, ...songs, seedNow], Math.min(n, 12), songKey).songs;
    if (ranked.length - picked.length < POOL_LOW_WATER) void refill(p, env, NEXTUP_DEADLINE_MS * 2);
    return picked;
  };
  const discoveryIds = new Set(songs.filter((s) => !env.likedLeads.has(leadOf(s)) && !env.score.tasteLeads.has(leadOf(s))).map((s) => s.id));
  const plan: NextSongsPlan = { songs, picker: 'local', fallback, latencyMs: Date.now() - t0, alg, relaxed, discoveryIds, language, commit, topUp };

  return plan;
}

/**
 * Warm the pool ahead of need: called while a list still has a few songs to
 * go, so the first automatic song after it is ready the moment it ends.
 */
export function warmNextUp(seed: Song, ctx: RecommendationContext): void {
  const now = Date.now();
  const anchor = readAnchor(seed, now, ctx.history?.[0]?.ts ?? 0);
  const env = buildEnv(seed, ctx, anchor, {}, now);
  const { pool: p, moved } = poolFor(anchor, now);
  if (!p.items.size) seedPoolLocally(p, env);
  if (moved || p.items.size < POOL_LOW_WATER * 3) void refill(p, env, NEXTUP_DEADLINE_MS * 2);
}
