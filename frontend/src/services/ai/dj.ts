import type { Song } from '@/types';
import type { RecommendationContext } from '@/services/recommendation/types';
import type { TuneIntent } from '@/services/recommendation/tune';
import { energyOfSong } from '@/services/personalization/session';
import { inferMood } from '@/services/recommendation/mood';
import { postMusicAi } from './musicAi';
import { buildSittingIntent, buildTasteSummary } from './tasteSummary';
import { recentPlays, resolvePicks, songRef, type SongPick } from './suggest';

/**
 * The AI DJ: songs the music AI suggests to follow the one playing now,
 * shaped by the listener's taste summary, recent plays and the "Tune this
 * queue" chip (POST /api/ai/dj). The suggestions arrive as titles and
 * artists; each is resolved to a real catalogue track (./suggest.ts) and
 * joins Up Next's warm pool as one source among the others, so the queue's
 * own rules (spacing, muted languages, cooldowns, Never repeat, the
 * admission gate) still decide what plays. Slow, failing or switched off,
 * it simply adds nothing and the on-device sources fill the queue.
 */

/** Network and model together; the pool keeps a late answer for the next stretch. */
export const DJ_DEADLINE_MS = 7_000;
/** One ask per playing song and tune in this window. */
export const DJ_REUSE_MS = 10 * 60_000;

/** After an empty answer (a pause, a failure), the next ask waits this long. */
export const DJ_RETRY_MS = 60_000;

const asked = new Map<string, { at: number; ttl: number; songs: Promise<Song[]> }>();
const reasons = new Map<string, string>();

/** "Why this song?" for a song the AI DJ suggested. */
export function djReason(songId: string): string | null {
  const r = reasons.get(songId);
  return r ? `AI DJ · ${r}` : null;
}

/** Tests. */
export function resetAiDj(): void {
  asked.clear();
  reasons.clear();
}

export interface AiDjOptions {
  tune?: TuneIntent | null;
  language?: string | null;
  signal?: AbortSignal;
  fetcher?: typeof fetch;
  search?: (q: string, limit: number, signal?: AbortSignal) => Promise<Song[]>;
  now?: () => number;
}

export function buildDjRequest(seed: Song, ctx: RecommendationContext, o: Pick<AiDjOptions, 'tune' | 'language'> = {}) {
  const mood = inferMood(seed);
  return {
    seed: { ...songRef(seed), language: seed.language && seed.language !== 'unknown' ? seed.language : null, mood: mood !== 'neutral' ? mood : null, energy: Math.round(energyOfSong(seed) * 100) / 100 },
    recent: recentPlays(ctx.history, 10).filter((r) => r.title !== seed.title),
    taste: buildTasteSummary(ctx),
    intent: buildSittingIntent(ctx, { tune: o.tune, language: o.language }),
  };
}

async function ask(seed: Song, ctx: RecommendationContext, o: AiDjOptions): Promise<Song[]> {
  const answer = await postMusicAi<{ songs?: unknown }>('dj', buildDjRequest(seed, ctx, o), { deadlineMs: DJ_DEADLINE_MS, signal: o.signal, fetcher: o.fetcher, now: o.now });
  if (!answer || !Array.isArray(answer.songs)) return [];
  const picks: SongPick[] = answer.songs
    .filter((x): x is Record<string, unknown> => !!x && typeof x === 'object')
    .map((x) => ({ title: typeof x.title === 'string' ? x.title : '', artist: typeof x.artist === 'string' ? x.artist : '', reason: typeof x.reason === 'string' ? x.reason.trim().slice(0, 90) : null }))
    .filter((p) => p.title && p.artist)
    .slice(0, 15);
  const found = await resolvePicks(picks, { search: o.search });
  const muted = new Set(ctx.mutedLanguages ?? []);
  const songs: Song[] = [];
  for (const { song, pick } of found) {
    if (song.id === seed.id || (song.language && muted.has(song.language))) continue;
    if (pick.reason) reasons.set(song.id, pick.reason);
    songs.push(song);
  }
  return songs;
}

/**
 * The AI DJ's songs for this seed and tune: asked once per DJ_REUSE_MS, the
 * same promise for every caller meanwhile. Empty when the listener switched
 * the AI DJ off or anything fails.
 */
export function aiDjSongs(seed: Song, ctx: RecommendationContext, o: AiDjOptions = {}): Promise<Song[]> {
  if (!ctx.aiDj || !seed?.id || seed.generated) return Promise.resolve([]);
  const now = (o.now ?? Date.now)();
  const key = `${seed.id}|${o.tune ?? ''}`;
  const have = asked.get(key);
  if (have && now - have.at < have.ttl) return have.songs;
  const songs = ask(seed, ctx, o).catch(() => [] as Song[]);
  const entry = { at: now, ttl: DJ_REUSE_MS, songs };
  asked.set(key, entry);
  // An empty answer (a pause, a failure) may be asked again a minute later.
  void songs.then((s) => {
    if (!s.length) entry.ttl = DJ_RETRY_MS;
  });
  return songs;
}
