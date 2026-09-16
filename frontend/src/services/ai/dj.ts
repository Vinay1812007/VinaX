import type { Song } from '@/types';
import type { RecommendationContext } from '@/services/recommendation/types';
import { isNativePlatform } from '@/services/native';
import { canonicalKey, primaryArtist } from '@/services/recommendation/songIdentity';
import { buildSessionContext } from '@/services/ai/sessionContext';
import { topArtists, topLanguages } from '@/services/personalization/profile';
import { getSliders, sliderDialLines } from '@/services/personalization/dials';
import { getMoodPin } from '@/services/personalization/session';
import { inferMood } from '@/services/recommendation/mood';
import { useReasonStore } from '@/store/reasonStore';
import { useDjStore } from '@/store/djStore';

/**
 * v6.2.0 — the AI DJ client.
 *
 * The local recommender gathers and filters real candidates (language lock,
 * blocklists, canonical de-dup, junk rules — all in code). The DJ only ever
 * SEQUENCES that pool: it gets the top slice, sends back an order plus a
 * reason and a spoken segue per pick, and anything outside the pool is
 * discarded. When the service is slow, down or unconfigured, the caller's
 * deterministic order ships — playback never waits on the model.
 */
const ENDPOINT = isNativePlatform() ? 'https://www.sirimillavinay.online/api/dj' : '/api/dj';
const SURFACED_KEY = 'vinax.dj.surfaced.v1';
const SURFACED_CAP = 300;
const AVOID_SEND = 120;
/** Bounded wait for the DJ: playback never hangs on the model (spec: 8–12 s). */
const LEASH_MS = 12_000;

let aiAvailable: boolean | null = null; // false after a 503: the key is not configured on this deployment
let retryAfter = 0;

export interface DjPick {
  song: Song;
  reason: string;
  segue: string;
  /** 0..1 — the DJ's own belief in the hand-off (0.5 when it gave none). */
  confidence: number;
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

interface WirePick { songId?: unknown; title?: unknown; artist?: unknown; reason?: unknown; segue?: unknown; confidence?: unknown }

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
    const confidence = typeof p.confidence === 'number' && Number.isFinite(p.confidence) ? Math.max(0, Math.min(1, p.confidence)) : 0.5;
    out.push({ song, reason: typeof p.reason === 'string' ? p.reason.slice(0, 120) : '', segue: typeof p.segue === 'string' ? p.segue.slice(0, 160) : '', confidence });
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
        context: { ...buildDjContext(seed, ctx), ...(hints.shape ? { arcShape: hints.shape } : {}), ...(hints.goal ? { listenerGoal: hints.goal.slice(0, 160) } : {}) },
        pool: pool.slice(0, 40).map((s) => ({ id: s.id, title: s.title, artist: primaryArtist(s), language: s.language })),
        count: Math.max(1, Math.min(20, limit)),
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
    const picks = resolveFromPool(Array.isArray(data.songs) ? (data.songs as WirePick[]) : [], pool, limit);
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
