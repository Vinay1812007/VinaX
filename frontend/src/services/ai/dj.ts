import type { Song } from '@/types';
import type { RecommendationContext } from '@/services/recommendation/types';
import { getSong, getSongSuggestions, searchSongs } from '@/services/api';
import {
  canonicalKey,
  hardFilter,
  primaryArtist,
  recordServed,
  rerankSlice,
  scoreAndSequence,
  servedKeySet,
  songKey,
  type FlowBuckets,
} from '@/services/recommendation/flow';
import { isNativePlatform } from '@/services/native';
import { getMoodPin } from '@/services/personalization/session';
import { hourMoodNow, type FlowAffinity } from '@/services/recommendation/flow';
import { inferMood, type Mood } from '@/services/recommendation/mood';
import { topArtists, topLanguages } from '@/services/personalization/profile';
import { getSliders, sliderDialLines } from '@/services/personalization/dials';
import { loadRecentHomeIds } from '@/features/home/homeVariety';
import { tunePromptHint } from '@/services/recommendation/tune';
import { buildSessionContext } from '@/services/ai/sessionContext';

// On web the function is same-origin; the native app bundles the web assets
// locally, so it must call the deployed function's absolute URL.
const DJ_ENDPOINT = isNativePlatform()
  ? 'https://www.sirimillavinay.online/api/dj'
  : '/api/dj';

/**
 * The AI DJ, rebuilt on VinaX Flow (v5.5.0, owner-approved 2026-08-31).
 *
 * The deterministic Flow core (services/recommendation/flow.ts) harvests four
 * real-catalog buckets, enforces the language lock + canonical dedup + junk
 * rules IN CODE, scores with per-round jitter and sequences a queue under the
 * artist-diversity constraints. The AI is a RE-RANKER only: it receives the
 * top of the already-clean pool and may re-order it — a suggestion outside
 * the pool is dropped, never searched (live-search resolution was the junk
 * vector: a hallucinated title landed whatever the catalog returned first).
 * When the AI is slow, down or unconfigured, the deterministic queue ships —
 * the DJ no longer collapses to a repeating local fallback.
 */
let aiAvailable: boolean | null = null; // null = unknown, false = skip the model call

interface Suggestion {
  title: string;
  artist: string;
  reason?: string;
}

const describe = (s: Song): string => `${s.title} — ${s.subtitle}${s.language ? ` (${s.language})` : ''}`;

// Cross-session anti-repeat: remember the songs we've recently surfaced into
// the queue so the AI is told to pick DIFFERENT tracks next time (otherwise a
// popular seed always yields the same canonical hits). Bumped 200 → 300 in
// v3.7.1 so a heavy listener doesn't exhaust the memory in a few days and see
// old picks resurface.
const SURFACED_KEY = 'vinax.dj.surfaced.v1';
const SURFACED_CAP = 300;
// How many surfaced entries to actually hand to the model. Too few lets old
// picks slip back in; too many crowds the prompt. 120 = ~2 weeks for a heavy
// listener at ~8 songs a day.
const AVOID_SEND = 120;
interface Surfaced {
  id: string;
  d: string;
}
function loadSurfaced(): Surfaced[] {
  try {
    return JSON.parse(window.localStorage.getItem(SURFACED_KEY) || '[]') as Surfaced[];
  } catch {
    return [];
  }
}
function recordSurfaced(songs: Song[]): void {
  try {
    const merged: Surfaced[] = [...songs.map((s) => ({ id: s.id, d: describe(s) })), ...loadSurfaced()];
    const seen = new Set<string>();
    const dedup: Surfaced[] = [];
    for (const x of merged) {
      if (!seen.has(x.id)) {
        seen.add(x.id);
        dedup.push(x);
      }
    }
    window.localStorage.setItem(SURFACED_KEY, JSON.stringify(dedup.slice(0, SURFACED_CAP)));
  } catch {
    /* ignore */
  }
}

/**
 * Rotating discoveryFocus (v3.7.1). Replaces the old Math.random over six
 * options; twelve directions picked with a fresh crypto nonce every call so
 * the "vibe of this round" itself changes even for the same seed song.
 */
const DISCOVERY_FOCI: readonly string[] = [
  'a balanced mix',
  'deeper cuts and lesser-known gems',
  'recent releases from the last 18 months',
  'timeless classics — 90s and earlier',
  'an upbeat, high-energy set',
  'a mellow, easy-listening set',
  'crossover picks — songs one language borrows from another',
  'songs showcasing a specific instrument (violin, flute, tabla, or the seed\'s dominant sound)',
  'film-song heavy — cinema soundtracks',
  'independent / non-film releases',
  'ensemble and duet tracks over solo vocal cuts',
  'reworked and reimagined versions — remasters, remixes, MTV Unplugged, live sets',
];
function pickDiscoveryFocus(): string {
  const b = new Uint8Array(1);
  crypto.getRandomValues(b);
  return DISCOVERY_FOCI[b[0] % DISCOVERY_FOCI.length];
}

/** Compact, privacy-bounded context sent to the AI DJ function. */
function buildContext(seed: Song | null, ctx: RecommendationContext): Record<string, unknown> {
  // Deep session context: weekday-aware vibe, live listener-energy read from
  // the skip/complete streak, and the festival the app is celebrating.
  const session = buildSessionContext(ctx.history);
  const discoveryFocus = pickDiscoveryFocus();
  // Most-played specific tracks — the strongest "you love this" signal.
  const playCounts = new Map<string, { song: Song; n: number }>();
  for (const e of ctx.history) {
    const cur = playCounts.get(e.song.id);
    if (cur) cur.n += 1;
    else playCounts.set(e.song.id, { song: e.song, n: 1 });
  }
  const topSongs = [...playCounts.values()].sort((a, b) => b.n - a.n).slice(0, 12).map((x) => describe(x.song));
  // Artists the listener keeps skipping — avoid them.
  const avoidArtists = Object.values(ctx.profile.artists)
    .filter((a) => a.skips >= 3 && a.skips > a.completes)
    .sort((a, b) => b.skips - a.skips)
    .slice(0, 10)
    .map((a) => a.name);
  return {
    seedSong: seed ? describe(seed) : null,
    currentLanguage: seed?.language ?? null,
    tuneInstruction: ctx.tuneIntent ? tunePromptHint(ctx.tuneIntent) : undefined,
    pinnedMood: getMoodPin() ?? undefined,
    seedVibe: seed ? inferMood(seed) : undefined,
    preferredLanguages: ctx.pinnedLanguages,
    avoidLanguages: ctx.mutedLanguages,
    ...session,
    discoveryFocus,
    recentlyPlayed: ctx.history.slice(0, 15).map((e) => describe(e.song)),
    recentlyCompleted: ctx.history.filter((e) => e.completed).slice(0, 12).map((e) => describe(e.song)),
    skippedSongs: ctx.history.filter((e) => !e.completed).slice(0, 12).map((e) => describe(e.song)),
    // v3.7.1: send up to AVOID_SEND (120) rather than the old 60 — a heavy
    // listener could exhaust 60 in days and re-see old picks.
    avoidSongs: loadSurfaced().slice(0, AVOID_SEND).map((x) => x.d),
    likedSongs: ctx.favorites.slice(0, 20).map(describe),
    topSongs,
    avoidArtists,
    preferredArtists: [
      ...new Set([
        ...topArtists(ctx.profile, 12).map((a) => a.affinity.name),
        ...ctx.favorites.flatMap((s) => s.artists.map((a) => a.name)),
      ]),
    ].slice(0, 15),
    topLanguages: topLanguages(ctx.profile, 4).map((l) => l.id),
    personalizationIntensity: ctx.intensity,
    // Package C3 — hand-tuned dials as plain guidance lines (empty when neutral).
    tasteDials: sliderDialLines(getSliders(ctx.profile)),
  };
}

async function callDj(context: Record<string, unknown>): Promise<Suggestion[]> {
  // Hard client leash: if the edge has a slow day, the deterministic Flow
  // queue ships instead of holding the queue hostage. 20s (v5.5.0): the AI is
  // a re-ranker now, not the source of the queue — a re-rank that can't land
  // inside 20s isn't worth waiting for.
  const ctrl = new AbortController();
  const timer = window.setTimeout(() => ctrl.abort(), 20_000);
  let res: Response;
  try {
    res = await fetch(DJ_ENDPOINT, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-vinax-client': isNativePlatform() ? 'app' : 'web',
      },
      body: JSON.stringify({ context }),
      signal: ctrl.signal,
    });
  } finally {
    window.clearTimeout(timer);
  }
  if (res.status === 503) {
    aiAvailable = false; // key not configured on the edge — stay deterministic from now on
    return [];
  }
  if (!res.ok) throw new Error(`ai ${res.status}`);
  aiAvailable = true;
  const data = (await res.json()) as { songs?: Suggestion[] };
  return Array.isArray(data.songs) ? data.songs : [];
}

/**
 * Resolve AI { title, artist } picks against the Flow pool ONLY. A suggestion
 * that isn't in the pool is dropped — never live-searched (v5.5.0): the pool
 * is real, language-locked and deduped; anything outside it is a hallucination
 * or a rule-breaker by definition.
 */
function resolveFromPool(
  suggestions: Suggestion[],
  poolByKey: Map<string, Song>,
  limit: number,
): Array<{ song: Song; reason?: string }> {
  const out: Array<{ song: Song; reason?: string }> = [];
  const used = new Set<string>();
  for (const s of suggestions) {
    if (out.length >= limit) break;
    const k = canonicalKey(s.title, s.artist);
    const hit = poolByKey.get(k);
    if (hit && !used.has(k)) {
      used.add(k);
      out.push({ song: hit, reason: s.reason });
    }
  }
  return out;
}

/**
 * VinaX Flow continuation from a seed song. Always returns a real queue when
 * the catalog is reachable: the AI re-ranks when it's healthy, the
 * deterministic sequence ships when it isn't. Returns [] only when the
 * harvest itself failed (offline), so callers still fall back to local.
 */
export async function aiSimilarSongs(
  seedId: string,
  ctx: RecommendationContext,
  limit = 8,
): Promise<Song[]> {
  let seed: Song | null = null;
  try {
    seed = await getSong(seedId);
  } catch {
    /* seed lookup is optional */
  }

  // ---- Language lock (owner rule: the queue speaks the seed's language) ----
  const lockLang =
    seed?.language && seed.language !== 'unknown'
      ? seed.language
      : ctx.pinnedLanguages.length
        ? ctx.pinnedLanguages[0]
        : null;

  // ---- Exclusions: ids we know + canonical identities across every surface ----
  const surfaced = loadSurfaced();
  const excludeIds = new Set<string>([
    seedId,
    ...ctx.history.slice(0, 50).map((e) => e.song.id),
    ...surfaced.map((x) => x.id),
    // A6 — exclude whatever Home surfaced recently so the queue complements
    // the front page instead of echoing it.
    ...loadRecentHomeIds(),
  ]);
  const excludeKeys = servedKeySet();
  if (seed) excludeKeys.add(songKey(seed));
  for (const e of ctx.history.slice(0, 50)) excludeKeys.add(songKey(e.song));

  // ---- Stage 1: harvest four real-catalog buckets in parallel ----
  const seedArtist = seed ? primaryArtist(seed) : '';
  const tasteArtist = topArtists(ctx.profile, 3).map((a) => a.affinity.name)[0] ?? '';
  const completed = ctx.history.filter((e) => e.completed && e.song.id !== seedId);
  let altSeed: Song | null = null;
  if (completed.length) {
    const b = new Uint8Array(1);
    crypto.getRandomValues(b);
    altSeed = completed[b[0] % Math.min(completed.length, 10)].song;
  }
  const langWord = lockLang ?? '';
  // Flow v3 — the vibe layer: an explicit mood pin steers everything for its
  // 45 minutes; with no pin, the SEED'S inferred vibe flavors the harvest, so
  // a sad song pulls sad-side candidates and a mass number pulls beats.
  const moodPin = getMoodPin();
  const seedMood: Mood = inferMood(seed);
  const VIBE_WORD: Record<Mood, string> = {
    romantic: 'romantic',
    energetic: 'mass dance',
    chill: 'melody chill',
    melancholy: 'sad emotional',
    devotional: 'devotional',
    neutral: '',
  };
  const moodWord = moodPin ? VIBE_WORD[moodPin] : seedMood !== 'neutral' ? VIBE_WORD[seedMood] : '';
  const filmName = seed?.album?.name ?? '';
  const [seedPool, filmPool, secondPool, artistA, artistB, freshPool] = await Promise.all([
    getSongSuggestions(seedId, 80).catch(() => [] as Song[]),
    // Flow v2 — the seed's own film: film-mates are the strongest same-vibe
    // signal Indian film catalogs offer (same composer, same era, same mood).
    filmName ? searchSongs(`${filmName} ${langWord} songs`.trim(), 10).catch(() => [] as Song[]) : Promise.resolve([] as Song[]),
    altSeed ? getSongSuggestions(altSeed.id, 40).catch(() => [] as Song[]) : Promise.resolve([] as Song[]),
    seedArtist ? searchSongs(`${seedArtist} ${langWord} ${moodWord} hit songs`.replace(/\s+/g, ' ').trim(), 12).catch(() => [] as Song[]) : Promise.resolve([] as Song[]),
    tasteArtist && tasteArtist !== seedArtist
      ? searchSongs(`${tasteArtist} ${langWord} ${moodWord} best songs`.replace(/\s+/g, ' ').trim(), 8).catch(() => [] as Song[])
      : Promise.resolve([] as Song[]),
    lockLang ? searchSongs(`${moodWord ? moodWord + ' ' : 'trending '}${lockLang} songs`.trim(), 12).catch(() => [] as Song[]) : Promise.resolve([] as Song[]),
  ]);

  // ---- Stage 2: hard rules, one dedup set across all buckets ----
  const dedup = new Set<string>();
  const filterOpts = { language: lockLang, exclude: excludeKeys, dedup };
  const buckets: FlowBuckets = {
    seed: hardFilter([...seedPool, ...filmPool].filter((s) => !excludeIds.has(s.id)), filterOpts),
    second: hardFilter(secondPool.filter((s) => !excludeIds.has(s.id)), filterOpts),
    artist: hardFilter([...artistA, ...artistB].filter((s) => !excludeIds.has(s.id)), filterOpts),
    fresh: hardFilter(freshPool.filter((s) => !excludeIds.has(s.id)), filterOpts),
  };
  const poolSize = buckets.seed.length + buckets.second.length + buckets.artist.length + buckets.fresh.length;
  if (!poolSize) return []; // offline / catalog down — the local fallback takes it

  // ---- Stage 3+4: the deterministic queue (always computed, always valid) ----
  // Flow v2 affinity: film-mate boost, shared-artist (composer) boost,
  // favourite-artist boost, era proximity, served-artist fatigue.
  const fatigue = new Map<string, number>();
  for (const k of excludeKeys) {
    const artistHalf = k.split('|')[1];
    if (artistHalf) fatigue.set(artistHalf, (fatigue.get(artistHalf) ?? 0) + 1);
  }
  const affinity: FlowAffinity = {
    seedAlbum: seed?.album?.name ?? null,
    seedArtists: seed?.artists.map((a) => a.name) ?? [],
    seedYear: seed?.year != null && Number.isFinite(Number(seed.year)) ? Number(seed.year) : null,
    favArtists: topArtists(ctx.profile, 8).map((a) => a.affinity.name),
    artistFatigue: fatigue,
    // Flow v3 — the vibe layer (see flow.ts scoring).
    seedMood,
    pinnedMood: moodPin ?? null,
    hourMood: hourMoodNow(),
  };
  const deterministic = scoreAndSequence(buckets, limit, affinity);

  // ---- Stage 4b: AI re-rank of the clean top slice (never the source of truth) ----
  let final: Array<{ song: Song; reason?: string }> = deterministic.map((song) => ({ song }));
  if (aiAvailable !== false) {
    try {
      const slice = rerankSlice(buckets, 25, affinity);
      const poolByKey = new Map<string, Song>();
      for (const s of slice) poolByKey.set(songKey(s), s);
      const ctxObj = buildContext(seed, ctx);
      ctxObj.catalogPool = slice.map((s) => ({
        title: s.title,
        artist: primaryArtist(s),
        language: s.language,
      }));
      const suggestions = await callDj(ctxObj);
      const resolved = resolveFromPool(suggestions, poolByKey, limit);
      if (resolved.length >= Math.min(5, limit)) {
        // Fill any remainder from the deterministic order, canonical-deduped.
        const used = new Set(resolved.map((r) => songKey(r.song)));
        for (const song of deterministic) {
          if (resolved.length >= limit) break;
          const k = songKey(song);
          if (!used.has(k)) {
            used.add(k);
            resolved.push({ song });
          }
        }
        final = resolved;
      }
    } catch {
      /* the deterministic queue ships — that is the design */
    }
  }

  // ---- Stage 5: shared memory so no surface repeats another ----
  const songs = final.slice(0, limit).map((r) => r.song);
  recordSurfaced(songs);
  recordServed(songs.map((s) => songKey(s)));
  const withReason = final.filter((r) => r.reason);
  if (withReason.length) {
    const { useReasonStore } = await import('@/store/reasonStore');
    useReasonStore.getState().setReasons(withReason.map((r) => [r.song.id, r.reason as string]));
  }
  return songs;
}
