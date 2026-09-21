import type { Song } from '../../src/types';

/**
 * The only things the evaluation replaces: the network-facing modules.
 *
 *   @/services/api                  the catalogue client — every candidate
 *                                   source reads it, so a fixture's pool and
 *                                   its outages are scripted HERE, one level
 *                                   below `candidates.ts`. That keeps the
 *                                   real candidate stage in the run: soft
 *                                   mutes, Kid mode, blocked songs and junk
 *                                   titles are filtered by the app's own code.
 *   @/services/ai/recommendations   the classifier and the AI re-rank.
 *   @/services/ai/dj                the AI DJ client.
 *   @/services/queryClient          the cached owner flags.
 *
 * Everything else — filtering, scoring, diversity, sequencing, validation,
 * the stores — is the app's real code at the commit under evaluation.
 */

/** How a catalogue call behaves. */
export type Behaviour = 'ok' | 'throw' | 'never' | { delayMs: number };

export interface CatalogueScript {
  /** Suggestions for this id return `related`; any other id returns nothing. */
  seedId: string;
  related: Song[];
  /** Every catalogue search returns this list (the hard filter drops the repeats by id). */
  search: Song[];
  suggestions: Behaviour;
  searchBehaviour: Behaviour;
  /** Searches after this many calls never settle (the rest answer): one source hangs, the others do not. */
  searchNeverAfter: number | null;
  /** Deterministic delays, taken in call order, when a behaviour is 'slow'. */
  slow: boolean;
}

export const catalogue: CatalogueScript = {
  seedId: '',
  related: [],
  search: [],
  suggestions: 'ok',
  searchBehaviour: 'ok',
  searchNeverAfter: null,
  slow: false,
};

/** A fixed ladder of delays, taken in call order: a slow source is slow in a reproducible way. */
const SLOW_LADDER = [140, 420, 260, 900, 180, 610, 330, 760, 210, 480];
let calls = 0;
let searchCalls = 0;

export function resetCatalogue(script: Partial<CatalogueScript> = {}): void {
  Object.assign(catalogue, { seedId: '', related: [], search: [], suggestions: 'ok', searchBehaviour: 'ok', searchNeverAfter: null, slow: false }, script);
  calls = 0;
  searchCalls = 0;
}

/** Different queries return different windows of the search pool, as different searches would. */
function window(list: Song[], call: number): Song[] {
  if (list.length <= 20) return list;
  const start = (call * 20) % list.length;
  return [...list.slice(start), ...list.slice(0, start)];
}

function answer<T>(behaviour: Behaviour, value: T, slow: boolean): Promise<T> {
  const delay = slow ? SLOW_LADDER[calls++ % SLOW_LADDER.length] : typeof behaviour === 'object' ? behaviour.delayMs : 0;
  if (behaviour === 'throw') return Promise.reject(new Error('catalogue unavailable'));
  if (behaviour === 'never') return new Promise<T>(() => undefined);
  if (!delay) return Promise.resolve(value);
  return new Promise((resolve) => setTimeout(() => resolve(value), delay));
}

function searchAnswer(): Promise<Song[]> {
  const call = searchCalls++;
  const hangs = catalogue.searchNeverAfter !== null && call >= catalogue.searchNeverAfter;
  return answer(hangs ? 'never' : catalogue.searchBehaviour, window(catalogue.search, call), catalogue.slow);
}

export const apiMock = {
  getSongSuggestions: (id: string, _n?: number): Promise<Song[]> =>
    answer(catalogue.suggestions, id === catalogue.seedId ? catalogue.related : [], catalogue.slow),
  searchSongsPage: (_q: string, _page?: number, _n?: number): Promise<Song[]> => searchAnswer(),
  searchSongs: (_q: string, _n?: number): Promise<Song[]> => searchAnswer(),
  getAlbum: (): Promise<null> => Promise.resolve(null),
};

/* ---- the AI lanes ---- */

export type AiAnswer = 'unavailable' | 'timeout' | 'empty' | 'reorder' | 'rulebreak' | 'never';
export interface AiScript {
  /** 'off' = the listener's AI DJ switch is off, so the engine may only ask for a re-rank. */
  mode: 'off' | 'dj';
  answer?: AiAnswer;
  delayMs?: number;
  /** Songs a 'rulebreak' answer proposes from outside the pool (hidden, explicit, off-language…). */
  outsiders?: Song[];
}

export const ai: { script: AiScript; outcome: string; proposed: Set<string> } = {
  script: { mode: 'off' },
  outcome: 'skipped',
  proposed: new Set(),
};

export function resetAi(script: AiScript): void {
  ai.script = script;
  ai.outcome = 'skipped';
  ai.proposed = new Set();
}

interface DjPickLike {
  song: Song;
  reason: string;
  segue: string;
  confidence: number;
  discovered?: boolean;
}

const pick = (song: Song, discovered = false): DjPickLike => ({ song, reason: 'a scripted answer', segue: '', confidence: 0.8, discovered });

async function wait(ms: number, signal?: AbortSignal): Promise<boolean> {
  if (!ms) return true;
  return new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => resolve(true), ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      resolve(false);
    }, { once: true });
  });
}

export const djMock = {
  samplePool: (ranked: Song[], _keep?: number, size = 30): Song[] => ranked.slice(0, size),
  commitDjSet: (): void => undefined,
  lastDjOutcome: (): string => ai.outcome,
  djSequence: async (_seed: Song | null, _ctx: unknown, pool: Song[], limit: number, signal?: AbortSignal): Promise<unknown> => {
    const { answer: script = 'unavailable', delayMs = 0, outsiders = [] } = ai.script;
    if (script === 'never') {
      // The real client holds its request until its own leash or an abort.
      await new Promise<void>((resolve) => signal?.addEventListener('abort', () => resolve(), { once: true }));
      ai.outcome = 'timeout';
      return null;
    }
    if (!(await wait(delayMs, signal)) || signal?.aborted) {
      ai.outcome = 'timeout';
      return null;
    }
    if (script === 'unavailable' || script === 'timeout' || script === 'empty') {
      ai.outcome = script === 'unavailable' ? 'unavailable' : script === 'timeout' ? 'timeout' : 'empty';
      return null;
    }
    // An order of its own over the pool it was given: every other song, from the second.
    const reordered: DjPickLike[] = [];
    for (let i = 1; i < pool.length && reordered.length < limit; i += 2) reordered.push(pick(pool[i]));
    const picks = script === 'rulebreak' ? [...outsiders.map((s) => pick(s, true)), ...reordered.slice(0, Math.max(0, limit - outsiders.length))] : reordered;
    if (picks.length < 3) {
      ai.outcome = 'empty';
      return null;
    }
    ai.outcome = 'ok';
    ai.proposed = new Set(picks.map((p) => p.song.id));
    return { intro: '', picks };
  },
};

export const recommendationsMock = {
  // The classifier is a network call: unavailable here, so songs keep the
  // metadata the fixture gives them (sparse fixtures stay sparse).
  enrichSongs: async (songs: Song[]): Promise<Song[]> => songs,
  // What the real client returns when the curator cannot answer: the order it was given.
  aiRerankSongs: async (songs: Song[], _context: string, limit: number): Promise<Song[]> => songs.slice(0, Math.max(0, limit)),
  requestCurator: async (): Promise<null> => null,
  RECOMMENDATION_AI_ROUTING: { metadataTimeoutMs: 6500, rankingTimeoutMs: 10_500, homeTimeoutMs: 10_500, shelvesTimeoutMs: 16_000 },
  resetCuratorBackoff: (): void => undefined,
};

export const queryClientMock = { queryClient: { getQueryData: (): undefined => undefined, setQueryData: (): undefined => undefined } };
