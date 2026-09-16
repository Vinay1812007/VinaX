import { gatherCandidates, generateNextCandidates } from './candidates';
import { rankCandidates } from './scoring';
import { buildMixes } from './mixes';
import { servedKeySet, songKey } from './songIdentity';
import { explainTopReasons } from './explanations';
import { useReasonStore } from '@/store/reasonStore';
import type { Mix, RecommendationContext, ScoredCandidate } from './types';
import type { Song } from '@/types';
import { enrichSongs, aiRerankSongs } from '@/services/ai/recommendations';
import { freshSongs } from './freshness';
import { rerankCandidates } from './reranking';
import { isSongBlocked, useLibraryStore } from '@/store/libraryStore';
import { stripExplicit } from '@/services/kidMode';
import { useSettingsStore } from '@/store/settingsStore';
import { queryClient } from '@/services/queryClient';
import type { ArcShape } from './sequencer';
import { tunePromptHint, tuneScoreAdjust, tuneShape, type TuneIntent } from './tune';

function aiContext(ctx: RecommendationContext): string {
  return JSON.stringify({ surface: ctx.surface, seed: ctx.seedSong?.title, mood: ctx.sessionMood, energy: ctx.sessionEnergy,
    languages: ctx.pinnedLanguages, muted: ctx.mutedLanguages,
    favorites: ctx.favorites.slice(0, 8).map(s => s.title), skips: ctx.profile.skippedSongIds?.slice(0, 20),
    recent: ctx.history.slice(0, 10).map(e => ({ id: e.song.id, title: e.song.title, completed: e.completed })),
    artists: Object.values(ctx.profile.artists).sort((a, b) => b.score - a.score).slice(0, 8).map(a => a.name) });
}

async function blendAi(ranked: ScoredCandidate[], ctx: RecommendationContext): Promise<ScoredCandidate[]> {
  const window = ranked.slice(0, 30);
  const order = await aiRerankSongs(window.map(item => item.candidate.song), aiContext(ctx), 30);
  const positions = new Map(order.map((song, index) => [song.id, index]));
  return rerankCandidates(ranked.map(item => ({ ...item, score: item.score + (positions.has(item.candidate.song.id) ? 0.12 * (1 - positions.get(item.candidate.song.id)! / Math.max(order.length, 1)) : 0) })), ctx);
}

/** Package C4 — publish plain-words "why this song" lines for every pick the
 *  listener can actually see, so the track menu can answer "Why this song?".
 *  Existing explanations are preserved. */
function publishReasons(scored: ScoredCandidate[]): void {
  try {
    useReasonStore
      .getState()
      .fillReasons(scored.map((s) => [s.candidate.song.id, explainTopReasons(s.reasons)]));
  } catch {
    /* a store hiccup must never break shelf building */
  }
}

interface MemoEntry {
  key: string;
  at: number;
  mixes: Mix[];
}

let memo: MemoEntry | null = null;
const MEMO_TTL_MS = 10 * 60_000;

function ctxKey(ctx: RecommendationContext): string {
  return [
    ctx.profile.totals.plays,
    ctx.profile.totals.favorites,
    ctx.profile.totals.skips,
    ctx.hour,
    ctx.pinnedLanguages.join(','),
    ctx.mutedLanguages.join(','),
    Math.round(ctx.intensity * 10),
    ctx.explore ? 1 : 0,
    ctx.salt,
    ctx.profile.createdAt,
    ctx.profile.recentSongIds.join(','),
    JSON.stringify(ctx.profile.sliders),
    JSON.stringify(ctx.profile.softMuted),
    JSON.stringify(useLibraryStore.getState().hiddenSongIds),
    JSON.stringify(useLibraryStore.getState().hiddenArtists),
    ctx.region?.country ?? '',
    // Decay runs off updatedAt — bucketed so long sessions refresh shelves.
    Math.floor(ctx.profile.updatedAt / (15 * 60_000)),
  ].join('|');
}

/**
 * Entry point: gather → rank → assemble shelves. Pure local computation plus
 * fault-tolerant upstream metadata fetches. Memoized for 10 minutes per
 * profile state so navigation stays instant and playback is never blocked.
 */
export async function buildRecommendations(ctx: RecommendationContext): Promise<Mix[]> {
  const key = ctxKey(ctx);
  if (memo && memo.key === key && Date.now() - memo.at < MEMO_TTL_MS) return memo.mixes;
  const candidates = await gatherCandidates(ctx);
  const enriched = await enrichSongs(candidates.map((candidate) => candidate.song));
  const enrichedById = new Map(enriched.map((song) => [song.id, song]));
  let ranked = rankCandidates(candidates.map((candidate) => ({ ...candidate, song: enrichedById.get(candidate.song.id) ?? candidate.song })), ctx);
  // On a warm profile, let a stronger routed seat understand the whole Home
  // context and reorder a bounded top window. Cold-start Home remains instant
  // and deterministic; failures simply preserve the local order.
  if (ctx.surface === 'home' && ctx.profile.totals.plays >= 5 && ranked.length >= 4) {
    ranked = await blendAi(ranked, ctx);
  }
  const served = servedKeySet();
  const freshRanked = [...ranked.filter((s) => !served.has(songKey(s.candidate.song))), ...ranked.filter((s) => served.has(songKey(s.candidate.song)))];
  const mixes = buildMixes(freshRanked, ctx);
  // C4 — every song placed on a shelf gets its honest "why" line.
  const placed = new Set(mixes.flatMap((m) => m.songs.map((s) => s.id)));
  publishReasons(ranked.filter((s) => placed.has(s.candidate.song.id)));
  memo = { key, at: Date.now(), mixes };
  return mixes;
}

export function invalidateRecommendationCache(): void {
  memo = null;
}

export interface NextRecommendationOptions {
  limit?: number;
  excludeIds?: string[];
  excludeKeys?: string[];
  /** v6.5.0 — an active "Tune this queue" intent: reshapes the score, the arc, the language lock and the DJ brief. */
  tune?: TuneIntent | null;
}

/** Shared continuation entry point for autoplay, radio and playlist queues. */
export async function recommendNextSongs(seed: Song, ctx: RecommendationContext, options: NextRecommendationOptions = {}): Promise<Song[]> {
  const limit = Math.max(0, Math.min(40, Math.floor(options.limit ?? 8)));
  if (!limit) return [];
  const excluded = new Set([seed.id, ...ctx.profile.recentSongIds, ...(options.excludeIds ?? [])]);
  const candidates = await generateNextCandidates(seed, { ...ctx, seedSong: seed, surface: ctx.surface ?? 'next' });
  // Continuation has a short foreground window for the low-cost classifier so
  // fresh mood/genre/energy metadata can affect this next-song decision.
  const enriched = await enrichSongs(candidates.map((candidate) => candidate.song), { waitMs: 1_800 });
  const enrichedById = new Map(enriched.map((song) => [song.id, song]));
  const admitted = freshSongs(stripExplicit(enriched), { excludeIds: excluded,
    excludeKeys: new Set([songKey(seed), ...(options.excludeKeys ?? []), ...ctx.history.slice(0, 20).map(e => songKey(e.song))]),
    muted: ctx.mutedLanguages, blocked: song => isSongBlocked(song, useLibraryStore.getState()) });
  const admittedIds = new Set(admitted.map(s => s.id));
  let ranked = rankCandidates(candidates.filter(c => admittedIds.has(c.song.id)).map((candidate) => ({ ...candidate, song: enrichedById.get(candidate.song.id) ?? candidate.song })), { ...ctx, seedSong: seed, surface: ctx.surface ?? 'next' });
  ranked = await blendAi(ranked, { ...ctx, seedSong: seed });
  const seedLang = seed.language && seed.language !== 'unknown' ? seed.language : null;
  const tune = options.tune ?? null;
  if (tune) {
    // v6.5.0 — the on-device half of a tune: a deterministic nudge per song
    // (era, language, energy, title cues) so the intent holds even when the
    // DJ is unavailable. Mood-only intents lean on the DJ brief below.
    ranked = ranked.map((item) => ({ ...item, score: item.score + tuneScoreAdjust(item.candidate.song, tune, seedLang) })).sort((a, b) => b.score - a.score);
  }
  // v6.3.0 — the arc sequencer orders the ranked pool from real signals
  // (energy, mood, artist spacing, era, language lock, transition memory)
  // instead of taking the top N as they come. The ranking stays the taste
  // prior; the arc shape follows the live listener-energy read.
  const orderedPool: Song[] = [];
  for (const item of ranked) {
    const song = item.candidate.song;
    if (song.id === seed.id || excluded.has(song.id) || orderedPool.some((s) => s.id === song.id)) continue;
    orderedPool.push(song);
  }
  // Lazy: this engine rides the first-load player store; the sequencer and
  // the session-context reader are only needed once a queue is extended.
  const [{ sequenceSongs, arcErrorOf }, { readListenerEnergy }] = await Promise.all([import('./sequencer'), import('@/services/ai/sessionContext')]);
  const shape = (tune && tuneShape(tune)) || shapeFor(readListenerEnergy(ctx.history, ctx.hour));
  const sureIds = new Set([...ctx.favorites.map((s) => s.id), ...ctx.history.slice(0, 60).map((e) => e.song.id)]);
  const discoveryIds = new Set(ranked.filter((item) => item.candidate.source === 'explore').map((item) => item.candidate.song.id));
  // Language rule: the queue speaks the seed's language. In explore mode it
  // may take an occasional detour into another language the listener plays.
  // "Switch language" moves the lock to another language the listener plays
  // (the pinned list first, then whatever the pool offers).
  const switchTo = tune === 'different-language'
    ? ctx.pinnedLanguages.find((l) => l !== seedLang) ?? orderedPool.map((s) => s.language).find((l) => l && l !== 'unknown' && l !== seedLang) ?? null
    : null;
  const lock = switchTo ?? seedLang;
  const otherLanguages = ctx.pinnedLanguages.filter((l) => l !== lock);
  const explore = ctx.explore || tune === 'surprise';
  const arc = sequenceSongs(orderedPool.slice(0, 40), { seed, shape, limit, language: lock, languagePolicy: explore && tune !== 'same-language' ? 'prefer' : 'lock', otherLanguages, discovery: explore ? 0.3 : 0.15, discoveryIds, sureIds, recent: ctx.history.slice(0, 3).map((e) => e.song) });
  const songs: Song[] = arc.songs.map((s) => s.song);
  // A language-locked pool can run short; top up in ranked order.
  for (const song of orderedPool) {
    if (songs.length >= limit) break;
    if (!songs.some((s) => s.id === song.id)) songs.push(song);
  }
  publishReasons(ranked.filter((item) => songs.some((song) => song.id === item.candidate.song.id)));
  // Arc reasons are more specific than scorer reasons; let them win.
  useReasonStore.getState().setReasons(arc.songs.filter((s) => s.why).map((s) => [s.song.id, s.why]));
  publishDebug(ranked, songs, 'local');
  // v6.2.0 — the AI DJ gets a bounded, optional final say over the ORDER of
  // the admitted pool (never over what is in it). Off by setting or owner
  // flag, or when the DJ is slow/down/unconfigured, the deterministic order
  // above ships unchanged.
  if (aiDjEnabled() && songs.length >= 3) {
    // The DJ client is a lazy chunk: this engine rides the first-load player
    // store, and the DJ only matters once a queue is actually being extended.
    const { djSequence, samplePool } = await import('@/services/ai/dj');
    // v6.5.0 — a rotating slice of the ranked pool (top ranks always, the
    // rest sampled) so consecutive rounds hand the DJ different material.
    const pool = samplePool(ranked.map((item) => item.candidate.song).filter((s) => s.id !== seed.id && !excluded.has(s.id)).slice(0, 40), 10, 30);
    const queuedKeys = new Set([songKey(seed), ...(options.excludeKeys ?? []), ...ctx.history.slice(0, 20).map((e) => songKey(e.song))]);
    const library = useLibraryStore.getState();
    // v6.5.0 — the generative half: the DJ may propose a few songs from
    // outside the pool; each is verified in the catalogue and must pass the
    // same gates as everything else before it can be queued.
    const gate = {
      language: explore && tune !== 'same-language' ? null : lock,
      admit: (song: Song) => !excluded.has(song.id) && !queuedKeys.has(songKey(song)) && !(song.language && ctx.mutedLanguages.includes(song.language)) && !isSongBlocked(song, library) && stripExplicit([song]).length === 1,
    };
    const set = await djSequence(seed, { ...ctx, seedSong: seed }, pool, limit, undefined, { shape, discover: true, gate, ...(tune ? { tune: tunePromptHint(tune) } : {}) });
    if (set && set.picks.length >= Math.min(3, limit)) {
      const used = new Set<string>();
      const sequenced: Song[] = [];
      for (const p of set.picks) if (!used.has(p.song.id)) { used.add(p.song.id); sequenced.push(p.song); }
      for (const s of songs) if (sequenced.length < limit && !used.has(s.id)) { used.add(s.id); sequenced.push(s); }
      // The DJ's order is accepted only when it keeps the arc at least as
      // tight as the local one (within a small tolerance); its reasons and
      // segues are kept either way. A tune relaxes the tolerance: the
      // listener asked for a change of direction.
      if (arcErrorOf(sequenced, seed, shape) <= arc.arcError + (tune ? 0.2 : 0.08)) {
        publishDebug(ranked, sequenced.slice(0, limit), 'ai', new Map(set.picks.map((p) => [p.song.id, p.confidence])), new Set(set.picks.filter((p) => p.discovered).map((p) => p.song.id)));
        return sequenced.slice(0, limit);
      }
    }
  }
  return songs;
}

/** v6.4.0 — development-only score breakdowns for the recs debug panel (no-op unless enabled). */
function publishDebug(ranked: ScoredCandidate[], chosen: Song[], source: 'local' | 'ai', confidence?: Map<string, number>, discovered?: Set<string>): void {
  void import('@/store/recsDebugStore').then((m) => {
    if (!m.recsDebugEnabled()) return;
    const byId = new Map(ranked.map((r) => [r.candidate.song.id, r]));
    m.useRecsDebugStore.getState().publish(
      chosen.map((song, i) => {
        const r = byId.get(song.id);
        return { position: i + 1, song, finalScore: r?.score ?? 0, source: r?.candidate.source ?? (discovered?.has(song.id) ? 'dj-discovery' : 'unknown'), components: r?.reasons ?? [], picker: source, confidence: confidence?.get(song.id) };
      }),
    );
  }).catch(() => undefined);
}

/** Arc shape from the listener-energy read (same signal the AI DJ gets). */
export function shapeFor(energy: string): ArcShape {
  if (energy.startsWith('restless') || energy.startsWith('wavering')) return 'lift';
  if (energy.includes('late hours')) return 'wind-down';
  return 'steady';
}

/** Listener switch AND owner flag (read from the cached config; a missing flag means on). */
function aiDjEnabled(): boolean {
  if (!useSettingsStore.getState().aiDj) return false;
  const flags = queryClient.getQueryData<Record<string, boolean>>(['feature-flags']);
  return flags?.aiDj !== false;
}

export async function startRadioRecommendations(seed: Song, ctx: RecommendationContext, limit = 30): Promise<Song[]> {
  return recommendNextSongs(seed, { ...ctx, surface: 'radio', intensity: Math.max(ctx.intensity, 0.65) }, { limit, excludeIds: [seed.id] });
}

export async function continuePlaylist(seed: Song, ctx: RecommendationContext, options: NextRecommendationOptions = {}): Promise<Song[]> {
  return recommendNextSongs(seed, { ...ctx, surface: 'playlist' }, options);
}
