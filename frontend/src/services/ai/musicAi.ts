import type { Song } from '@/types';
import type { RecommendationContext } from '@/services/recommendation/types';
import type { TuneIntent } from '@/services/recommendation/tune';
import { currentAccount } from '@/services/auth/google';
import { isNativePlatform } from '@/services/native';
import { buildSittingIntent, buildTasteSummary, candidateFeatures } from './tasteSummary';

/**
 * The device's side of the music AI routes (/api/ai/rerank, and later
 * /api/ai/home-layout): one POST with a hard deadline, and a short pause after
 * an answer that says "not now" (not configured, switched off, signed out,
 * rate limited), so a missing service never costs a plan its time. Every
 * caller keeps its own on-device result whenever this returns null.
 */
const ORIGIN = isNativePlatform() ? 'https://www.vinaxmusic.online' : '';

/** How long the device waits for a rerank, network included. */
export const RERANK_DEADLINE_MS = 1_500;
/** Candidates a rerank sends: the top of the on-device order. */
export const RERANK_TOP = 40;

const pausedUntil = new Map<string, number>();
const PAUSE_MS: Record<number, number> = { 401: 10 * 60_000, 403: 10 * 60_000, 429: 2 * 60_000, 503: 10 * 60_000 };

/** Tests: forget every pause. */
export function resetMusicAi(): void {
  pausedUntil.clear();
}

export interface MusicAiOptions {
  deadlineMs: number;
  signal?: AbortSignal;
  fetcher?: typeof fetch;
  now?: () => number;
}

/** POST a JSON body to /api/ai/<route>. Null on any failure, a pause, or a late answer. */
export async function postMusicAi<T>(route: string, body: unknown, o: MusicAiOptions): Promise<T | null> {
  const now = o.now ?? Date.now;
  if ((pausedUntil.get(route) ?? 0) > now() || o.signal?.aborted) return null;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return null;
  const account = currentAccount();
  if (!account) return null;
  const ac = new AbortController();
  const onOuter = (): void => ac.abort();
  o.signal?.addEventListener('abort', onOuter, { once: true });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<null>((resolve) => {
    timer = setTimeout(() => {
      ac.abort();
      resolve(null);
    }, Math.max(0, o.deadlineMs));
  });
  const request = (async (): Promise<T | null> => {
    const res = await (o.fetcher ?? fetch)(`${ORIGIN}/api/ai/${route}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json', authorization: `Bearer ${account.session}` },
      body: JSON.stringify(body),
      signal: ac.signal,
    });
    if (!res.ok) {
      const pause = PAUSE_MS[res.status];
      if (pause) pausedUntil.set(route, now() + pause);
      return null;
    }
    return (await res.json()) as T;
  })().catch(() => null);
  try {
    return await Promise.race([request, deadline]);
  } finally {
    clearTimeout(timer);
    o.signal?.removeEventListener('abort', onOuter);
  }
}

export interface RerankResult<T> {
  items: T[];
  /** Song id → the AI's short reason, for "Why this song?". Empty when the AI did not order anything. */
  reasons: Map<string, string>;
  used: boolean;
}

/**
 * Put the top of an on-device order in the AI's order for this listener now.
 * The top RERANK_TOP candidates are sent as features under opaque keys
 * ("c0"…); the AI's keys come first, in its order, then the rest of the top
 * in the device's order, then everything below the top. A key that was not
 * sent is ignored, so the AI can only ever reorder what the device chose.
 * On a timeout, an error or a "not now", the order comes back unchanged.
 */
export async function rerankWithAi<T>(items: readonly T[], songOf: (item: T) => Song, ctx: RecommendationContext, o: Partial<MusicAiOptions> & { tune?: TuneIntent | null; language?: string | null } = {}): Promise<RerankResult<T>> {
  const unchanged: RerankResult<T> = { items: [...items], reasons: new Map(), used: false };
  if (items.length < 2) return unchanged;
  const top = items.slice(0, RERANK_TOP);
  const keyed = new Map(top.map((item, i) => [`c${i}`, item]));
  const body = {
    candidates: [...keyed].map(([key, item]) => candidateFeatures(songOf(item), key)),
    taste: buildTasteSummary(ctx),
    intent: buildSittingIntent(ctx, { tune: o.tune, language: o.language }),
  };
  const answer = await postMusicAi<{ order?: Array<{ key?: unknown; reason?: unknown }> }>('rerank', body, { deadlineMs: o.deadlineMs ?? RERANK_DEADLINE_MS, signal: o.signal, fetcher: o.fetcher, now: o.now });
  if (!answer || !Array.isArray(answer.order)) return unchanged;
  const picked: T[] = [];
  const reasons = new Map<string, string>();
  const used = new Set<string>();
  for (const entry of answer.order) {
    const key = typeof entry?.key === 'string' ? entry.key : null;
    const item = key ? keyed.get(key) : undefined;
    // Only keys this request sent, each once: anything else is dropped.
    if (!key || !item || used.has(key)) continue;
    used.add(key);
    picked.push(item);
    const reason = typeof entry.reason === 'string' ? entry.reason.trim().slice(0, 90) : '';
    if (reason) reasons.set(songOf(item).id, reason);
  }
  if (!picked.length) return unchanged;
  const rest = top.filter((_, i) => !used.has(`c${i}`));
  return { items: [...picked, ...rest, ...items.slice(RERANK_TOP)], reasons, used: true };
}

/** "Why this song?" for a song the AI placed. */
export const aiReasonLine = (reason: string): string => `AI pick · ${reason}`;
