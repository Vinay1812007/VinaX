/**
 * VinaX AI — which free models OpenRouter lists now. Its `:free` models come
 * and go, so the picker leaves out a curated OpenRouter model the current
 * list no longer has (config.ts pickerRegistryFor). Nothing here adds a
 * model: the only way a model joins VinaX AI is its id in models.ts
 * APPROVED_MODELS.
 *
 *   OpenRouter  GET https://openrouter.ai/api/v1/models (Bearer; text output by default)
 *               → { data: [{ id, pricing: { prompt, completion } (strings, USD per token),
 *                   architecture: { output_modalities } }] }
 *               Free = the id ends in ":free", or prompt and completion are both "0".
 *
 * Where it lives: each Worker instance's memory (6 hours), and the edge cache
 * (`caches.default`, same 6 hours) so other instances in the same place reuse
 * it without asking OpenRouter again. A list that fails keeps the last good
 * one; with none it says nothing (null) and asks again in 15 minutes. It
 * never waits: a first request starts the read in the background.
 */
import { providerConfigured } from './adapters';
import type { AiEnv } from './types';

export const LIST_TTL_MS = 6 * 60 * 60_000;
export const LIST_RETRY_MS = 15 * 60_000;
/** The list request. */
export const LIST_FETCH_MS = 5_000;
/** At most this many ids are kept. */
export const MAX_LISTED = 300;

/** An id as OpenRouter writes it: no spaces, quotes or control characters. */
const SAFE_ID = /^[A-Za-z0-9@][A-Za-z0-9@._:/+-]{0,159}$/;

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const strs = (v: unknown): string[] => arr(v).filter((x): x is string => typeof x === 'string');
const zero = (v: unknown): boolean => (typeof v === 'string' ? Number(v) === 0 && v.trim() !== '' : v === 0);

/** The free, text-out model ids in OpenRouter's list (routers such as openrouter/auto left out). */
export function parseOpenRouterFree(body: unknown): string[] {
  const out: string[] = [];
  for (const m of arr(obj(body).data).map(obj)) {
    const id = typeof m.id === 'string' ? m.id : '';
    const pricing = obj(m.pricing);
    const free = id.endsWith(':free') || (zero(pricing.prompt) && zero(pricing.completion));
    if (!id || !free || id.startsWith('openrouter/') || !SAFE_ID.test(id)) continue;
    const outMods = strs(obj(m.architecture).output_modalities);
    if (outMods.length && (outMods.some((x) => x !== 'text') || !outMods.includes('text'))) continue;
    if (!out.includes(id)) out.push(id);
  }
  return out;
}

/**
 * OpenRouter's list is ~800 KB (451 models, checked 2026-11-03) and parsing
 * all of it takes ~6 ms of CPU, more than half of the free Worker plan's
 * 10 ms. Each model in it starts with `{"id":"`, so this finds them with a
 * string search and parses only the ones that may be free (an id ending in
 * `:free`, or a zero price) — a dozen or so. If the list ever stops looking
 * like that, the whole list is parsed as before.
 */
export function openRouterFreeEntries(text: string): unknown {
  const MARK = '{"id":"';
  const starts: number[] = [];
  for (let i = text.indexOf(MARK); i >= 0; i = text.indexOf(MARK, i + MARK.length)) starts.push(i);
  if (!starts.length) {
    try { return JSON.parse(text); } catch { return null; }
  }
  const data: unknown[] = [];
  for (let k = 0; k < starts.length; k++) {
    const a = starts[k];
    const seg = text.slice(a, k + 1 < starts.length ? starts[k + 1] : text.length);
    const id = seg.slice(MARK.length, seg.indexOf('"', MARK.length));
    const zeroPriced = /"prompt":"0(?:\.0+)?"/.test(seg) && /"completion":"0(?:\.0+)?"/.test(seg);
    if (!id.endsWith(':free') && !zeroPriced) continue;
    // The entry ends at its closing brace: `},` before the next one, `}]}` for the last.
    let end = seg.lastIndexOf('}');
    for (let tries = 0; end > 0 && tries < 4; tries++) {
      try { data.push(JSON.parse(seg.slice(0, end + 1))); break; } catch { end = seg.lastIndexOf('}', end - 1); }
    }
  }
  return { data };
}

// ---------------------------------------------------------------- fetching

export type ListFetcher = (env: AiEnv, signal: AbortSignal) => Promise<string[]>;

export const fetchOpenRouterFree: ListFetcher = async (env, signal) => {
  const res = await fetch('https://openrouter.ai/api/v1/models', {
    headers: { accept: 'application/json', authorization: `Bearer ${env.OPENROUTER_API_KEY?.trim() ?? ''}`, 'HTTP-Referer': 'https://www.vinaxmusic.online', 'X-Title': 'VinaX AI' },
    signal,
  });
  if (!res.ok) throw new Error(`http_${res.status}`);
  return parseOpenRouterFree(openRouterFreeEntries(await res.text()));
};

interface ListState {
  /** When the list was read (or, after a failure with nothing known, when to count the retry from). */
  at: number;
  ids: string[];
}

let memo: ListState | null = null;
let inflight: Promise<ListState> | null = null;

const CACHE_KEY = 'https://vinax-ai-openrouter-list.internal/v1/free';
const edgeCache = (): Cache | null => (globalThis as { caches?: { default?: Cache } }).caches?.default ?? null;

async function fromEdge(now: number): Promise<ListState | null> {
  const cache = edgeCache();
  if (!cache) return null;
  try {
    const hit = await cache.match(CACHE_KEY);
    if (!hit) return null;
    const v = obj(await hit.json());
    const at = Number(v.fetchedAt);
    if (!Number.isFinite(at) || now - at >= LIST_TTL_MS) return null;
    // Checked again on the way in, as if OpenRouter had sent it.
    const ids = strs(v.ids).filter((id) => SAFE_ID.test(id)).slice(0, MAX_LISTED);
    return ids.length ? { at, ids } : null;
  } catch {
    return null;
  }
}

async function toEdge(st: ListState): Promise<void> {
  const cache = edgeCache();
  if (!cache) return;
  try {
    await cache.put(CACHE_KEY, new Response(JSON.stringify({ fetchedAt: st.at, ids: st.ids }), {
      headers: { 'content-type': 'application/json', 'cache-control': `public, max-age=${Math.floor(LIST_TTL_MS / 1000)}` },
    }));
  } catch { /* caching is best-effort */ }
}

/** Read the list (edge cache first) and remember it; a failure keeps the last good list. Never throws. */
async function refresh(env: AiEnv, now: number, fetcher: ListFetcher): Promise<ListState> {
  const cached = await fromEdge(now);
  if (cached) return (memo = cached);
  const prev = memo;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), LIST_FETCH_MS);
  let st: ListState;
  try {
    const ids = (await fetcher(env, ac.signal)).slice(0, MAX_LISTED);
    if (!ids.length) throw new Error('empty');
    st = { at: now, ids };
    await toEdge(st);
  } catch (e) {
    const error = ac.signal.aborted ? 'timeout' : e instanceof Error ? e.message.slice(0, 40) : 'failed';
    // Ask again in 15 minutes; meanwhile keep what was known.
    st = { at: now - LIST_TTL_MS + LIST_RETRY_MS, ids: prev?.ids ?? [] };
    console.log(JSON.stringify({ route: 'ai-openrouter-list', ok: false, error }));
  } finally {
    clearTimeout(timer);
  }
  return (memo = st);
}

export interface ListOptions {
  now?: number;
  /** Keep a refresh going after the response (ctx.waitUntil). */
  waitUntil?: (p: Promise<unknown>) => void;
  fetcher?: ListFetcher;
}

/**
 * The free model ids OpenRouter lists now, or null while its list is not
 * known (or there is no key). It never waits for OpenRouter: a stale or
 * missing list starts a read in the background and later requests use it.
 */
export async function openRouterListed(env: AiEnv, o: ListOptions = {}): Promise<Set<string> | null> {
  try {
    if (!providerConfigured(env, 'openrouter')) return null;
    const now = o.now ?? Date.now();
    let st = memo;
    if (!st || now - st.at >= LIST_TTL_MS) {
      if (!inflight) {
        inflight = refresh(env, now, o.fetcher ?? fetchOpenRouterFree).finally(() => { inflight = null; });
        o.waitUntil?.(inflight);
      }
      // Whatever answers within this tick (an edge cache hit) is used now; anything slower is used next time.
      const job = inflight;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const fresh = await Promise.race([job, new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), 0); })]).finally(() => clearTimeout(timer));
      st = fresh ?? st;
    }
    return st && st.ids.length ? new Set(st.ids) : null;
  } catch {
    return null;
  }
}

/** Tests only. */
export function _resetOpenRouterList(): void {
  memo = null;
  inflight = null;
}
