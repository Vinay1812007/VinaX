import type { Song } from '@/types';
import type { RecommendationContext } from '@/services/recommendation/types';
import { isNativePlatform } from '@/services/native';
import { searchSongs } from '@/services/api';
import { canonicalKey, isJunkTitle, primaryArtist } from '@/services/recommendation/songIdentity';
import { matchTier } from '@/features/search/rerank';
import { buildSessionContext } from '@/services/ai/sessionContext';
import { topArtists, topLanguages } from '@/services/personalization/profile';
import { getSliders, sliderDialLines } from '@/services/personalization/dials';
import { getMoodPin } from '@/services/personalization/session';
import { inferMood } from '@/services/recommendation/mood';
import { useReasonStore } from '@/store/reasonStore';
import { useDjStore } from '@/store/djStore';

/**
 * v6.2.0 / v6.5.0 — the AI DJ client.
 *
 * The local recommender gathers and filters real candidates (language lock,
 * blocklists, canonical de-dup, junk rules — all in code). The DJ SEQUENCES
 * a rotating slice of that pool and sends back an order plus a reason and a
 * spoken segue per pick. Since 6.5 it may also PROPOSE a few songs from
 * outside the pool (a generative DJ, as in 3.9): each proposal is looked up
 * in the real catalogue and kept only when a result matches its title and
 * artist, speaks the queue's language and passes the caller's admission
 * gate — an invented or unmatched title never reaches the queue. When the
 * service is slow, down or unconfigured, the caller's deterministic order
 * ships — playback never waits on the model.
 */
const ENDPOINT = isNativePlatform() ? 'https://www.sirimillavinay.online/api/dj' : '/api/dj';
const SURFACED_KEY = 'vinax.dj.surfaced.v1';
const SURFACED_CAP = 300;
const AVOID_SEND = 120;
/** Bounded wait for the DJ. The first continuation is requested the moment a
 *  song starts, so the model has most of that song to answer; playback never
 *  hangs on it. */
const LEASH_MS = 20_000;
/** Most off-pool proposals resolved per round (each costs a catalogue search). */
const MAX_DISCOVER = 4;
/** Rotating creative focus, one per round (3.9 behaviour): keeps consecutive
 *  rounds from the same seed from converging on the same corner of the taste. */
const DISCOVERY_FOCI = [
  'a fresh release from the last year',
  'a timeless classic of the same scene',
  'a different lead singer with the same mood',
  'the same composer, a less obvious song',
  'a duet or a female lead if the seed is male-led (and vice versa)',
  'a slower song that keeps the emotional key',
  'a folk or regional flavour of the same feel',
  'an acoustic or unplugged take on the mood',
  'a film soundtrack cut from the same era',
  'a song the listener has not heard from an artist they love',
  'a brighter song at the same tempo',
  'a deep cut from a favourite album',
];

let aiAvailable: boolean | null = null; // false after a 503: the key is not configured on this deployment
let retryAfter = 0;

export interface DjPick {
  song: Song;
  reason: string;
  segue: string;
  /** 0..1 — the DJ's own belief in the hand-off (0.5 when it gave none). */
  confidence: number;
  /** v6.5.0 — true when the DJ proposed this song from outside the pool and the catalogue confirmed it. */
  discovered?: boolean;
}

export interface DjSet {
  intro: string;
  picks: DjPick[];
}

export const describeSong = (s: Song): string => `${s.title} — ${s.subtitle}${s.language ? ` (${s.language})` : ''}`;

interface Surfaced { id: string; d: string }

function loadSurfaced(): Surfaced[] {
  try {
    const raw = JSON.parse(window.localStorage.getItem(SURFACED_KEY) || '[]') as unknown;
    return Array.isArray(raw) ? (raw as Surfaced[]).filter((x) => x && typeof x.id === 'string' && typeof x.d === 'string') : [];
  } catch {
    return [];
  }
}

export function recordSurfaced(songs: Song[]): void {
  try {
    const merged: Surfaced[] = [...songs.map((s) => ({ id: s.id, d: describeSong(s) })), ...loadSurfaced()];
    const seen = new Set<string>();
    const dedup = merged.filter((x) => (seen.has(x.id) ? false : (seen.add(x.id), true)));
    window.localStorage.setItem(SURFACED_KEY, JSON.stringify(dedup.slice(0, SURFACED_CAP)));
  } catch {
    /* storage is optional */
  }
}

/** Compact, privacy-bounded context: titles and artists only — never ids, names or locations. */
export function pickDiscoveryFocus(): string {
  return DISCOVERY_FOCI[Math.floor(Math.random() * DISCOVERY_FOCI.length)];
}

/**
 * v6.5.0 — a rotating slice of the ranked pool: the top `keep` songs always
 * ride along, the rest of the slice is sampled without replacement from the
 * next ranks, so two rounds for the same seed hand the DJ different raw
 * material (3.9 sampled 35 of 80 the same way).
 */
export function samplePool(ranked: Song[], keep = 10, size = 30): Song[] {
  if (ranked.length <= size) return ranked.slice();
  const head = ranked.slice(0, keep);
  const rest = ranked.slice(keep);
  for (let i = rest.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [rest[i], rest[j]] = [rest[j], rest[i]];
  }
  return [...head, ...rest.slice(0, Math.max(0, size - head.length))];
}

export function buildDjContext(seed: Song | null, ctx: RecommendationContext): Record<string, unknown> {
  const session = buildSessionContext(ctx.history);
  const playCounts = new Map<string, { song: Song; n: number }>();
  for (const e of ctx.history) {
    const cur = playCounts.get(e.song.id);
    if (cur) cur.n += 1;
    else playCounts.set(e.song.id, { song: e.song, n: 1 });
  }
  const topSongs = [...playCounts.values()].sort((a, b) => b.n - a.n).slice(0, 10).map((x) => describeSong(x.song));
  const avoidArtists = Object.values(ctx.profile.artists)
    .filter((a) => a.skips >= 3 && a.skips > a.completes)
    .sort((a, b) => b.skips - a.skips)
    .slice(0, 8)
    .map((a) => a.name);
  return {
    seedSong: seed ? describeSong(seed) : null,
    currentLanguage: seed?.language && seed.language !== 'unknown' ? seed.language : ctx.pinnedLanguages[0] ?? null,
    seedVibe: seed ? inferMood(seed) : undefined,
    pinnedMood: getMoodPin() ?? undefined,
    surface: ctx.surface,
    preferredLanguages: ctx.pinnedLanguages.slice(0, 5),
    avoidLanguages: ctx.mutedLanguages.slice(0, 5),
    ...session,
    recentlyPlayed: ctx.history.slice(0, 12).map((e) => describeSong(e.song)),
    recentlyCompleted: ctx.history.filter((e) => e.completed).slice(0, 10).map((e) => describeSong(e.song)),
    skippedSongs: ctx.history.filter((e) => !e.completed).slice(0, 10).map((e) => describeSong(e.song)),
    avoidSongs: loadSurfaced().slice(0, AVOID_SEND).map((x) => x.d),
    likedSongs: ctx.favorites.slice(0, 15).map(describeSong),
    topSongs,
    avoidArtists,
    preferredArtists: [...new Set([...topArtists(ctx.profile, 10).map((a) => a.affinity.name), ...ctx.favorites.flatMap((s) => s.artists.map((a) => a.name))])].slice(0, 12),
    topLanguages: topLanguages(ctx.profile, 4).map((l) => l.id),
    personalizationIntensity: ctx.intensity,
    tasteDials: sliderDialLines(getSliders(ctx.profile)),
    discoveryFocus: pickDiscoveryFocus(),
  };
}

export function djAvailable(): boolean {
  return aiAvailable !== false && Date.now() >= retryAfter;
}

/** Test hook. */
export function resetDjAvailability(): void {
  aiAvailable = null;
  retryAfter = 0;
}

interface WirePick { songId?: unknown; title?: unknown; artist?: unknown; reason?: unknown; segue?: unknown; confidence?: unknown; fromPool?: unknown }

const fold = (t: string): string => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const clipText = (v: unknown, n: number): string => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, n) : '');
const confidenceOf = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0.5);

/**
 * v6.5.0 — is a catalogue result really the song the DJ proposed? Strong
 * path: identical canonical title + primary artist. Otherwise the result's
 * title must hold every word of the proposal (or start with it) AND its
 * credited artists must name the proposed artist. Never the first hit on trust.
 */
export function matchesProposal(result: Song, title: string, artist: string): boolean {
  if (isJunkTitle(result.title)) return false;
  if (canonicalKey(result.title, primaryArtist(result)) === canonicalKey(title, artist)) return true;
  const q = fold(title);
  const words = q.split(' ').filter((w) => w.length >= 2);
  if (matchTier(result.title, q, words) < 1) return false;
  const wanted = fold(artist).split(' ').filter((w) => w.length >= 3);
  if (!wanted.length) return false;
  const credited = fold([result.subtitle, ...result.artists.map((a) => a.name)].join(' '));
  return wanted.some((w) => credited.includes(w));
}

/**
 * Map the model's picks back onto the pool: by the pool song's id first,
 * then by canonical title + artist. An id that is not in the pool is never
 * trusted — the song must already be one the app gathered and admitted.
 */
export function resolveFromPool(picks: WirePick[], pool: Song[], limit: number): DjPick[] {
  const byId = new Map(pool.map((s) => [s.id, s]));
  const byKey = new Map<string, Song>();
  for (const s of pool) byKey.set(canonicalKey(s.title, primaryArtist(s)), s);
  const used = new Set<string>();
  const out: DjPick[] = [];
  for (const p of picks) {
    if (out.length >= limit) break;
    if (!p) continue;
    const song = (typeof p.songId === 'string' && byId.get(p.songId)) || (typeof p.title === 'string' && typeof p.artist === 'string' ? byKey.get(canonicalKey(p.title, p.artist)) : undefined);
    if (!song || used.has(song.id)) continue;
    used.add(song.id);
    out.push({ song, reason: clipText(p.reason, 120), segue: clipText(p.segue, 160), confidence: confidenceOf(p.confidence) });
  }
  return out;
}

export interface DiscoveryGate {
  /** The queue's language; a proposal that resolves to another language is dropped (null = any). */
  language?: string | null;
  /** The caller's admission rules (blocklists, mutes, explicit, already queued). */
  admit?: (song: Song) => boolean;
  signal?: AbortSignal;
}

/**
 * v6.5.0 — resolve the DJ's picks in its order: pool picks map straight back
 * (never trusting an id outside the pool); off-pool proposals are searched
 * in the catalogue and kept only when a result matches title AND artist,
 * speaks the queue's language and passes the gate. At most MAX_DISCOVER
 * proposals are looked up per round, in parallel.
 */
export async function resolvePicks(picks: WirePick[], pool: Song[], limit: number, gate: DiscoveryGate = {}, maxDiscover = MAX_DISCOVER): Promise<DjPick[]> {
  const byId = new Map(pool.map((s) => [s.id, s]));
  const byKey = new Map<string, Song>();
  for (const s of pool) byKey.set(canonicalKey(s.title, primaryArtist(s)), s);
  const slots: Array<DjPick | { title: string; artist: string; reason: string; segue: string; confidence: number }> = [];
  const used = new Set<string>();
  let proposals = 0;
  for (const p of picks) {
    if (!p) continue;
    const title = clipText(p.title, 200);
    const artist = clipText(p.artist, 200);
    const song = (typeof p.songId === 'string' && byId.get(p.songId)) || (title && artist ? byKey.get(canonicalKey(title, artist)) : undefined);
    if (song) {
      if (used.has(song.id)) continue;
      used.add(song.id);
      slots.push({ song, reason: clipText(p.reason, 120), segue: clipText(p.segue, 160), confidence: confidenceOf(p.confidence) });
    } else if (title && artist && proposals < maxDiscover) {
      proposals += 1;
      slots.push({ title, artist, reason: clipText(p.reason, 120), segue: clipText(p.segue, 160), confidence: confidenceOf(p.confidence) });
    }
  }
  const lookups = slots.map(async (slot) => {
    if ('song' in slot) return slot;
    try {
      const results = await searchSongs(`${slot.title} ${slot.artist}`, 6, { signal: gate.signal });
      const hit = results.find((r) => matchesProposal(r, slot.title, slot.artist) && (!gate.language || !r.language || r.language === 'unknown' || r.language === gate.language) && (!gate.admit || gate.admit(r)));
      return hit ? ({ song: hit, reason: slot.reason, segue: slot.segue, confidence: slot.confidence, discovered: true } satisfies DjPick) : null;
    } catch {
      return null;
    }
  });
  const out: DjPick[] = [];
  for (const r of await Promise.all(lookups)) {
    if (!r || out.length >= limit) continue;
    if (used.has(r.song.id) && r.discovered) continue;
    used.add(r.song.id);
    out.push(r);
  }
  return out;
}

/**
 * Ask the DJ to sequence `pool` (real, already-filtered songs). Returns null
 * when the DJ is unavailable, slow, or answered with fewer than three usable
 * picks — the caller keeps its own order in every such case.
 */
export interface DjHints {
  /** The arc the local sequencer is aiming for (steady / build / wind-down / wave / lift). */
  shape?: string;
  /** A plain-words goal from the Queue Builder ("30 minutes, upbeat, for a drive"). */
  goal?: string;
  /** v6.5.0 — an active "Tune this queue" instruction (services/recommendation/tune.ts). */
  tune?: string;
  /** v6.5.0 — let the DJ propose a few songs from outside the pool (catalogue-verified). */
  discover?: boolean;
  /** v6.5.0 — gate for discovered songs: language lock and the caller's admission rules. */
  gate?: DiscoveryGate;
}

export async function djSequence(seed: Song | null, ctx: RecommendationContext, pool: Song[], limit: number, signal?: AbortSignal, hints: DjHints = {}): Promise<DjSet | null> {
  if (!djAvailable() || pool.length < 3) return null;
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  const timer = window.setTimeout(abort, LEASH_MS);
  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-vinax-client': isNativePlatform() ? 'app' : 'web' },
      body: JSON.stringify({
        context: {
          ...buildDjContext(seed, ctx),
          ...(hints.shape ? { arcShape: hints.shape } : {}),
          ...(hints.goal ? { listenerGoal: hints.goal.slice(0, 160) } : {}),
          ...(hints.tune ? { tuneInstruction: hints.tune.slice(0, 240) } : {}),
        },
        pool: pool.slice(0, 40).map((s) => ({ id: s.id, title: s.title, artist: primaryArtist(s), language: s.language })),
        count: Math.max(1, Math.min(20, limit)),
        discover: hints.discover === true,
        maxDiscover: MAX_DISCOVER,
      }),
      signal: controller.signal,
    });
    if (res.status === 503) {
      aiAvailable = false;
      return null;
    }
    if (!res.ok) {
      retryAfter = Date.now() + 60_000;
      return null;
    }
    aiAvailable = true;
    const data = (await res.json()) as { intro?: unknown; songs?: unknown };
    const wire = Array.isArray(data.songs) ? (data.songs as WirePick[]) : [];
    const picks = hints.discover ? await resolvePicks(wire, pool, limit, { ...hints.gate, signal: controller.signal }) : resolveFromPool(wire, pool, limit);
    if (picks.length < 3) return null;
    const intro = typeof data.intro === 'string' ? data.intro.trim().slice(0, 200) : '';
    // What the listener will see and hear.
    useReasonStore.getState().setReasons(picks.filter((p) => p.reason).map((p) => [p.song.id, p.reason]));
    useDjStore.getState().setSet(intro, picks.map((p) => [p.song.id, p.segue]));
    recordSurfaced(picks.map((p) => p.song));
    return { intro, picks };
  } catch {
    if (!signal?.aborted) retryAfter = Date.now() + 60_000;
    return null;
  } finally {
    window.clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}
