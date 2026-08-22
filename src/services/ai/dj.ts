import type { Song } from '@/types';
import type { RecommendationContext } from '@/services/recommendation/types';
import { getSong, getSongSuggestions, searchSongs } from '@/services/api';
import { isNativePlatform } from '@/services/native';
import { topArtists, topLanguages } from '@/services/personalization/profile';
import { getSliders, sliderDialLines } from '@/services/personalization/dials';
import { loadRecentHomeIds } from '@/features/home/homeVariety';
import { tunePromptHint } from '@/services/recommendation/tune';

// On web the function is same-origin; the native app bundles the web assets
// locally, so it must call the deployed function's absolute URL.
const DJ_ENDPOINT = isNativePlatform()
  ? 'https://www.sirimillavinay.online/api/dj'
  : '/api/dj';

/**
 * Automatic AI DJ. The queue/next-song is built by the AI service whenever the Cloudflare
 * function is configured with a key — no toggle, no button. We probe lazily;
 * if the function reports "not configured" (503) we remember that and stay
 * fully local, so we never waste calls. Any failure also degrades to local.
 */
let aiAvailable: boolean | null = null; // null = unknown, false = stay local

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

/**
 * Sample `n` items from `arr` uniformly at random, without replacement. Uses a
 * fresh crypto nonce so consecutive calls with the same `arr` produce a
 * different subset — critical for the AI DJ, whose catalogPool otherwise
 * arrives as the same top-40 similar-songs response every time and lets the
 * model reshuffle the same neighborhood round after round.
 */
function sampleWithoutReplacement<T>(arr: T[], n: number): T[] {
  if (n >= arr.length) return [...arr];
  const copy = [...arr];
  const bytes = new Uint8Array(n);
  crypto.getRandomValues(bytes);
  for (let i = 0; i < n; i += 1) {
    const j = i + (bytes[i] % (copy.length - i));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, n);
}

/** Compact, privacy-bounded context sent to the AI DJ function. */
function buildContext(seed: Song | null, ctx: RecommendationContext): Record<string, unknown> {
  const h = ctx.hour;
  const timeOfDay =
    h < 5 ? 'late night' : h < 12 ? 'morning' : h < 17 ? 'afternoon' : h < 22 ? 'evening' : 'night';
  const sessionVibe =
    h < 5 ? 'late-night / wind-down' : h < 12 ? 'morning / easy' : h < 17 ? 'afternoon / steady' : h < 22 ? 'evening / lively' : 'night / mellow';
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
    preferredLanguages: ctx.pinnedLanguages,
    avoidLanguages: ctx.mutedLanguages,
    timeOfDay,
    sessionVibe,
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
  // Hard client leash: if the edge has a slow day, fail over to instant local
  // picks instead of holding the queue hostage (DQA-02/14). 35s (2026-07-18,
  // v3.2.0): widened with the server's 28→31s budget — a measured 27.5s cold
  // call was grazing the old ceilings, and the leash must clear the server
  // deadline with room for network + resolve.
  const ctrl = new AbortController();
  const timer = window.setTimeout(() => ctrl.abort(), 35_000);
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
    aiAvailable = false; // key not configured on the edge — stay local from now on
    return [];
  }
  if (!res.ok) throw new Error(`ai ${res.status}`);
  aiAvailable = true;
  const data = (await res.json()) as { songs?: Suggestion[] };
  return Array.isArray(data.songs) ? data.songs : [];
}

function normKey(title: string, artist: string): string {
  return (title + '|' + artist).toLowerCase().replace(/[^a-z0-9|]+/g, '');
}

/** Resolve AI { title, artist, reason } picks to playable catalog songs, deduped. */
async function resolve(
  suggestions: Suggestion[],
  exclude: Set<string>,
  limit: number,
  muted: string[] = [],
  prefer: string | null = null,
  poolMap: Map<string, Song> | null = null,
): Promise<Array<{ song: Song; reason?: string }>> {
  const out: Array<{ song: Song; reason?: string }> = [];
  const seen = new Set(exclude);
  // Pool-served picks are instant (no network). Handle them synchronously
  // first so we short-circuit the whole search phase whenever the catalog
  // pool already has the AI's suggestions.
  const remaining: Suggestion[] = [];
  for (const s of suggestions) {
    if (out.length >= limit) break;
    if (poolMap) {
      const hit = poolMap.get(normKey(s.title, s.artist));
      if (
        hit &&
        !seen.has(hit.id) &&
        !(hit.language != null && muted.includes(hit.language)) &&
        (!prefer || hit.language === prefer)
      ) {
        seen.add(hit.id);
        out.push({ song: hit, reason: s.reason });
        continue;
      }
    }
    remaining.push(s);
  }
  if (out.length >= limit || !remaining.length) return out;
  // The rest fall back to a live search. The previous implementation awaited
  // them one at a time, so 6-8 suggestions * ~500 ms/search added ~4 s of
  // serial network stall AFTER the AI itself had already spent up to 35 s
  // (audit finding M4). Fan out in parallel with per-item try/catch instead;
  // apply the pick logic after all results resolve so we still honour the
  // ordering the AI produced.
  const resultsByIndex = await Promise.all(
    remaining.map((s) =>
      searchSongs(`${s.title} ${s.artist}`, 6).catch(() => [] as Song[]),
    ),
  );
  const ok = (r: Song) => !seen.has(r.id) && !(r.language != null && muted.includes(r.language));
  for (let i = 0; i < remaining.length; i++) {
    if (out.length >= limit) break;
    const s = remaining[i];
    const results = resultsByIndex[i];
    if (!results.length) continue;
    // Prefer a result in the target language so the queue stays on-language.
    // Hard on-language: when a target language is set, only accept results in
    // that language — an off-language suggestion is skipped, never substituted.
    const pick = prefer ? results.find((r) => ok(r) && r.language === prefer) : results.find(ok);
    if (pick) {
      seen.add(pick.id);
      out.push({ song: pick, reason: s.reason });
    }
  }
  return out;
}

/**
 * AI-built continuation from a seed song. Returns playable songs, or [] on any
 * failure (or when the AI DJ isn't configured) so callers fall back to local.
 */
export async function aiSimilarSongs(
  seedId: string,
  ctx: RecommendationContext,
  limit = 8,
): Promise<Song[]> {
  if (aiAvailable === false) return []; // known unconfigured → stay local
  let seed: Song | null = null;
  try {
    seed = await getSong(seedId);
  } catch {
    /* seed lookup is optional */
  }
  const surfaced = loadSurfaced();
  const exclude = new Set<string>([
    seedId,
    ...ctx.history.slice(0, 50).map((e) => e.song.id),
    ...surfaced.map((x) => x.id),
    // A6 — the DJ and AI Home used to share ~40% of picks because both mine the
    // same neighborhood. Exclude whatever Home surfaced in its recent builds so
    // the queue complements the front page instead of echoing it.
    ...loadRecentHomeIds(),
  ]);

  // Catalog-grounded pool: real, guaranteed-playable songs so the AI ranks
  // ACTUAL tracks rather than hallucinating titles (critical for regional music).
  //
  // v3.7.1 anti-repeat: fetch a WIDE pool (80) then randomly downsample to ~35
  // per request. The old approach fetched exactly 40 and handed all of them to
  // the model — for a given seedId the upstream API returns the same 40 every
  // time, so even with the varietySeed the model reshuffled the SAME
  // neighborhood every round. A fresh crypto-nonce subsample means the model
  // sees a genuinely different starting slate each call.
  let pool: Song[] = [];
  try {
    pool = await getSongSuggestions(seedId, 80);
  } catch {
    /* pool is optional */
  }
  const filteredPool = pool.filter((s) => !exclude.has(s.id));
  const rotatedPool = sampleWithoutReplacement(filteredPool, 35);
  const poolMap = new Map<string, Song>();
  const catalogPool: Array<{ title: string; artist: string; language: string | null }> = [];
  for (const s of rotatedPool) {
    const artist = s.artists[0]?.name ?? s.subtitle.split(',')[0] ?? '';
    poolMap.set(normKey(s.title, artist), s);
    catalogPool.push({ title: s.title, artist, language: s.language });
  }
  // Keep the WHOLE original pool in the map so a suggestion that happens to
  // land on a song we didn't include in the visible catalogPool still resolves
  // without a live search round-trip.
  for (const s of filteredPool) {
    if (!poolMap.has(normKey(s.title, s.artists[0]?.name ?? ''))) {
      const artist = s.artists[0]?.name ?? s.subtitle.split(',')[0] ?? '';
      poolMap.set(normKey(s.title, artist), s);
    }
  }

  try {
    const ctxObj = buildContext(seed, ctx);
    ctxObj.catalogPool = catalogPool;
    const suggestions = await callDj(ctxObj);
    if (!suggestions.length) return [];
    const seedLang = seed?.language && seed.language !== 'unknown' ? seed.language : null;
    const prefer = seedLang ?? (ctx.pinnedLanguages.length === 1 ? ctx.pinnedLanguages[0] : null);
    const resolved = await resolve(suggestions, exclude, limit, ctx.mutedLanguages, prefer, poolMap);
    recordSurfaced(resolved.map((r) => r.song));
    const withReason = resolved.filter((r) => r.reason);
    if (withReason.length) {
      const { useReasonStore } = await import('@/store/reasonStore');
      useReasonStore.getState().setReasons(withReason.map((r) => [r.song.id, r.reason as string]));
    }
    return resolved.map((r) => r.song);
  } catch {
    return [];
  }
}
