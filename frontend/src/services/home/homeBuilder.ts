import type { Song } from '@/types';
import type { HomeSection } from '@/services/recommendation/homeDesign';
import type { RecommendationContext } from '@/services/recommendation/types';
import { buildSittingIntent, buildTasteSummary, type TasteSummary, type SittingIntent } from '@/services/ai/tasteSummary';
import { inferMood } from '@/services/recommendation/mood';
import { postMusicAi } from '@/services/ai/musicAi';

/**
 * 1.4 — the AI Home Builder, on the device.
 *
 * For each Home generation (features/home/homeRefresh.ts) the AI may choose
 * which shelves appear, their order, their titles, a one-line "why" for each,
 * and what feeds the new "Made for right now" shelf. It chooses STRUCTURE and
 * WORDS only: every song on every shelf still comes from the on-device engine
 * or the catalogue, through the safety lens, the surface rule and the shelf
 * ledger. It never names a song; a seed it points at is one of the keys the
 * device offered.
 *
 * The decision is made once per generation and frozen (`decideHomeLayout`),
 * so Home never moves while the listener is on it. The AI gets
 * HOME_AI_DEADLINE_MS; on a timeout, an outage or an answer that fails the
 * guard below, Home uses `orderHomeBlocks` exactly as before. A layout the
 * listener saved, or one the owner published, always wins: the AI is not asked.
 */

/**
 * The shelf types the AI may choose: every existing Home block, plus at most
 * two new ones, plus `engine` — the personal engine's server-composed section
 * (features/home/personal), offered only while it is on, so the AI places it
 * among the rest. Left out, it stays first.
 */
export type AiBlockType = HomeSection | 'rightnow' | 'generated' | 'engine';
export const NEW_BLOCK_TYPES = ['rightnow', 'generated'] as const;

export interface HomeLayoutBlock {
  type: AiBlockType;
  title: string;
  reason: string;
  /** Seed keys ("s0"…) the device offered; mapped back to songs on the device. */
  seedIds?: string[];
  query?: string;
  mood?: string;
  language?: string;
}

export interface HomeLayout {
  generation: number;
  blocks: HomeLayoutBlock[];
}

/** How long Home waits for the AI, network included. */
export const HOME_AI_DEADLINE_MS = 2_500;
export const MIN_AI_BLOCKS = 4;
export const MAX_AI_BLOCKS = 14;
export const MAX_SEEDS = 8;

const isStr = (v: unknown, max: number): v is string => typeof v === 'string' && v.trim().length > 0 && v.length <= max;

/**
 * The type guard: the SHAPE of an answer, with no dependency to do it. A
 * field of the wrong type, an over-long text or a block with no type fails
 * the whole layout (the fallback then runs); what passes is checked against
 * the request by `acceptHomeLayout`.
 */
export function isHomeLayout(x: unknown): x is HomeLayout {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return false;
  const v = x as Record<string, unknown>;
  if (typeof v.generation !== 'number' || !Number.isInteger(v.generation) || !Array.isArray(v.blocks)) return false;
  if (v.blocks.length < 1 || v.blocks.length > MAX_AI_BLOCKS * 2) return false;
  return v.blocks.every((b) => {
    if (!b || typeof b !== 'object' || Array.isArray(b)) return false;
    const blk = b as Record<string, unknown>;
    if (!isStr(blk.type, 24) || !isStr(blk.title, 48) || !isStr(blk.reason, 100)) return false;
    if (blk.query !== undefined && !isStr(blk.query, 60)) return false;
    if (blk.mood !== undefined && !isStr(blk.mood, 20)) return false;
    if (blk.language !== undefined && !isStr(blk.language, 24)) return false;
    if (blk.seedIds !== undefined && !(Array.isArray(blk.seedIds) && blk.seedIds.length <= 3 && blk.seedIds.every((s) => isStr(s, 4)))) return false;
    return true;
  });
}

export interface AcceptRules {
  generation: number;
  /** The types this Home may show now (visible blocks plus the new ones on offer). */
  allowed: readonly AiBlockType[];
  seedKeys: ReadonlySet<string>;
  avoid: readonly AiBlockType[];
}

const PLAIN = /^[\p{L}\p{N}\s'’,.!?&-]+$/u;

/**
 * What of a guarded layout this Home will use: allowed types only, each once,
 * never an avoided one, plain words for titles and reasons, a "right now"
 * shelf that has something to be fed from, seeds the device offered, the
 * shortcuts first and the feed last. Null when it is for another generation
 * or fewer than MIN_AI_BLOCKS shelves survive.
 */
export function acceptHomeLayout(layout: HomeLayout, rules: AcceptRules): HomeLayout | null {
  if (layout.generation !== rules.generation) return null;
  const out: HomeLayoutBlock[] = [];
  for (const b of layout.blocks) {
    const type = b.type as AiBlockType;
    if (!rules.allowed.includes(type) || rules.avoid.includes(type) || out.some((x) => x.type === type)) continue;
    const title = b.title.trim();
    const reason = b.reason.trim();
    if (!PLAIN.test(title) || !PLAIN.test(reason) || /https?:|www\./i.test(reason)) continue;
    const block: HomeLayoutBlock = { type, title, reason };
    if (type === 'rightnow') {
      const seedIds = (b.seedIds ?? []).filter((k) => rules.seedKeys.has(k));
      const query = b.query && PLAIN.test(b.query) ? b.query.trim() : undefined;
      if (!query && !seedIds.length && !b.mood) continue;
      if (query) block.query = query;
      if (b.mood) block.mood = b.mood.toLowerCase();
      if (b.language) block.language = b.language.toLowerCase();
      if (seedIds.length) block.seedIds = seedIds;
    }
    out.push(block);
    if (out.length >= MAX_AI_BLOCKS) break;
  }
  const first = out.findIndex((b) => b.type === 'quick');
  if (first > 0) out.unshift(...out.splice(first, 1));
  const last = out.findIndex((b) => b.type === 'feed');
  if (last >= 0 && last !== out.length - 1) out.push(...out.splice(last, 1));
  return out.length >= MIN_AI_BLOCKS ? { generation: rules.generation, blocks: out } : null;
}

/** A seed the AI may point the "right now" shelf at: features only, under an opaque key. */
export interface HomeSeed {
  key: string;
  song: Song;
}

/** Up to MAX_SEEDS of the listener's own songs (recent likes, then songs they finished), keyed "s0"…. */
export function pickHomeSeeds(ctx: RecommendationContext): HomeSeed[] {
  const seen = new Set<string>();
  const out: Song[] = [];
  const take = (s: Song | undefined): void => {
    if (!s?.id || seen.has(s.id) || out.length >= MAX_SEEDS) return;
    seen.add(s.id);
    out.push(s);
  };
  for (const s of ctx.favorites.slice(0, 4)) take(s);
  for (const e of ctx.history) if (e.completed) take(e.song);
  return out.map((song, i) => ({ key: `s${i}`, song }));
}

export interface HomeRequestBody {
  generation: number;
  taste: TasteSummary;
  intent: SittingIntent;
  allowed: AiBlockType[];
  avoid: AiBlockType[];
  seeds: Array<{ key: string; language: string | null; mood: string | null; genre: string | null; leadArtist: string | null }>;
}

export function buildHomeRequest(ctx: RecommendationContext, o: { generation: number; allowed: readonly AiBlockType[]; avoid: readonly AiBlockType[]; seeds: readonly HomeSeed[] }): HomeRequestBody {
  return {
    generation: o.generation,
    taste: buildTasteSummary(ctx),
    intent: buildSittingIntent(ctx),
    allowed: o.allowed.filter((t) => !o.avoid.includes(t)),
    avoid: [...o.avoid],
    seeds: o.seeds.map(({ key, song }) => {
      const mood = inferMood(song);
      return { key, language: song.language && song.language !== 'unknown' ? song.language : null, mood: mood !== 'neutral' ? mood : null, genre: song.genre?.trim().toLowerCase() || null, leadArtist: song.artists?.[0]?.name ?? null };
    }),
  };
}

/** Ask the AI for this generation's layout: the answer, guarded and accepted, or null. */
export async function requestAiHomeLayout(body: HomeRequestBody, o: { seedKeys: ReadonlySet<string>; fetcher?: typeof fetch; deadlineMs?: number; signal?: AbortSignal }): Promise<HomeLayout | null> {
  const answer = await postMusicAi<{ layout?: unknown }>('home-layout', body, { deadlineMs: o.deadlineMs ?? HOME_AI_DEADLINE_MS, fetcher: o.fetcher, signal: o.signal });
  if (!answer || !isHomeLayout(answer.layout)) return null;
  return acceptHomeLayout(answer.layout, { generation: body.generation, allowed: body.allowed, seedKeys: o.seedKeys, avoid: body.avoid });
}

/* ---- once per generation ---- */

export interface HomeDecision {
  source: 'ai' | 'fallback';
  /** The blocks to render, in order. For the fallback: the on-device order, with no titles or reasons. */
  blocks: HomeLayoutBlock[] | Array<{ type: HomeSection }>;
  /** The seeds behind the "right now" shelf, by key. */
  seeds: ReadonlyMap<string, Song>;
}

interface Memo {
  key: string;
  decision: HomeDecision | null;
  pending: Promise<HomeDecision> | null;
}
let memo: Memo | null = null;

/**
 * The layout for one generation of one base layout, decided once: the AI's
 * answer if it arrives in time and passes the guard, else `fallback()`. Later
 * calls for the same generation and base get the same decision — a late AI
 * answer never replaces a layout that is already on screen.
 */
export function decideHomeLayout(key: string, ask: (() => Promise<{ layout: HomeLayout | null; seeds: ReadonlyMap<string, Song> }>) | null, fallback: () => HomeSection[]): Promise<HomeDecision> {
  if (memo?.key === key) return memo.decision ? Promise.resolve(memo.decision) : memo.pending!;
  const fallbackDecision = (): HomeDecision => ({ source: 'fallback', blocks: fallback().map((type) => ({ type })), seeds: new Map() });
  const entry: Memo = { key, decision: null, pending: null };
  memo = entry;
  if (!ask) {
    entry.decision = fallbackDecision();
    return Promise.resolve(entry.decision);
  }
  entry.pending = ask()
    .then(({ layout, seeds }) => (layout ? { source: 'ai' as const, blocks: layout.blocks, seeds } : fallbackDecision()))
    .catch(fallbackDecision)
    .then((decision) => {
      // Only the generation it was asked for may keep it.
      if (memo === entry) entry.decision = decision;
      return decision;
    });
  return entry.pending;
}

/** The decision already made for `key`, if any (a synchronous read for re-renders). */
export function peekHomeDecision(key: string): HomeDecision | null {
  return memo?.key === key ? memo.decision : null;
}

/** "Rebuild Home now", and tests. */
export function resetHomeDecision(): void {
  memo = null;
}
