/**
 * 8.2.0 — text embeddings for search, the playlist builder and recommendations.
 *
 * One call turns up to 64 short texts into unit-length vectors. Engines are
 * tried in order and the first that answers wins:
 *
 *   1. the NVIDIA standard `/v1/embeddings` endpoint, on VINAX_NVIDIA_API_KEY
 *      (10.3 — the one account-scoped key): `nvidia/llama-3.2-nv-embedqa-1b-v2`
 *      (asked for 384 dimensions), then `nvidia/nv-embedqa-e5-v5` (1024);
 *   2. the flagship lane's provider (the maestro key): `gemini-embedding-001`,
 *      native batch endpoint first (it carries the query/passage task type),
 *      then its standard `/embeddings` endpoint;
 *   3. nothing answered → `{ ok: false, error: 'no_engine' }`.
 *
 * Vectors from different models live in different spaces and must never be
 * compared, so every answer names its model. A caller that already holds
 * vectors from one model passes it as `prefer`, and that engine goes first.
 *
 * Models known to be trained for truncation (Matryoshka) are cut to
 * EMBED_DIM here when the provider ignored the size request, then
 * renormalised; the others are only renormalised. Numbers are rounded to five
 * decimals to keep the answer small (unit vectors lose nothing that matters).
 *
 * Deliberately a small fetch of its own rather than the chat() helper: the
 * chat ladder, prompts and token accounting do not apply to embeddings.
 *
 * 10.3 — the engines are drawn from the providers' FREE embedding lists
 * (NVIDIA /v1/models and the Gemini model list, via _lib/catalog.ts
 * fetchMedia): every NVIDIA embedding model listed right now, in the
 * preference order below, then Gemini's. The two fixed NVIDIA pins and the
 * Gemini pin above are the same fallbacks as before, used when a list is
 * unavailable (no answer within EMBED_LIST_WAIT_MS, or the provider listed no
 * embedding model). The live NVIDIA list on 2026-10-06 carried neither fixed
 * pin, so the list is what keeps this route on models the key can call.
 */
import { providerKey, type AiEnv } from './ai';
import { fetchMedia } from './catalog';
import { isWrongDoor } from './maestro';

export type EmbedKind = 'query' | 'passage';

/** The size asked of engines that can shrink their vectors. */
export const EMBED_DIM = 384;
export const MAX_TEXTS = 64;
export const MAX_TEXT_CHARS = 512;
/** Per-engine leash. */
export const ENGINE_TIMEOUT_MS = 6_000;

export const NV_EMBED_PRIMARY = 'nvidia/llama-3.2-nv-embedqa-1b-v2';
export const NV_EMBED_SECONDARY = 'nvidia/nv-embedqa-e5-v5';
export const FLAGSHIP_EMBED_MODEL = 'gemini-embedding-001';

/** Models trained so a prefix of the vector is itself a good embedding. */
const TRUNCATABLE = new Set([NV_EMBED_PRIMARY, FLAGSHIP_EMBED_MODEL]);
/** 10.3 — the Gemini embedding family is trained the same way (outputDimensionality). */
const isTruncatable = (model: string): boolean => TRUNCATABLE.has(model) || /^gemini-embedding-/.test(model);

/** 10.3 — NVIDIA embedding models from the live list, most-wanted first
 *  (substrings, so a re-published version still sorts). Unlisted families go last. */
const NV_EMBED_PREFERENCE = ['llama-3.2-nv-embedqa-1b', 'nemotron-3-embed', 'nv-embedqa-e5', 'nv-embedqa-mistral', 'arctic-embed', 'embed-qa-4', 'llama-nemotron-embed', 'nemoretriever'];
/** How long a request waits for the provider lists before using the fixed engines (the lists keep loading for the next request). */
export const EMBED_LIST_WAIT_MS = 1_500;

/** 10.3 — the free embedding models each provider lists right now (empty = use the fixed engines). */
export interface EmbedLists {
  nvidia: string[];
  gemini: string[];
}

const NV_DEFAULT_URL = 'https://integrate.api.nvidia.com/v1/embeddings';
const FLAGSHIP_STANDARD_URL = 'https://generativelanguage.googleapis.com/v1beta/openai/embeddings';
const flagshipNativeUrl = (model: string): string =>
  `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:batchEmbedContents`;

export type EmbedResult =
  | { ok: true; model: string; dim: number; vectors: number[][] }
  | { ok: false; error: 'no_engine'; tried: string[] };

export interface EmbedOpts {
  /** Model the caller already holds vectors from — tried first. */
  prefer?: string | null;
  /** Per-engine leash (ms). */
  timeoutMs?: number;
  /** Wall-clock deadline for the whole ladder (epoch ms). */
  deadlineAt?: number;
}

/** Unit-length copy of `v`, cut to `dim` first when given; null for a zero or broken vector. */
export function normalise(v: readonly number[], dim?: number): number[] | null {
  const cut = dim && v.length > dim ? v.slice(0, dim) : v;
  let sum = 0;
  for (const x of cut) {
    if (typeof x !== 'number' || !Number.isFinite(x)) return null;
    sum += x * x;
  }
  if (!(sum > 0)) return null;
  const inv = 1 / Math.sqrt(sum);
  return cut.map((x) => Math.round(x * inv * 1e5) / 1e5);
}

/**
 * The default provider's embeddings URL. NVIDIA_BASE_URL overrides the
 * chat-completions URL, so its `/chat/completions` tail is swapped for
 * `/embeddings`; a bare `/v1` root gets `/embeddings` appended.
 */
export function defaultEmbeddingsUrl(env: AiEnv): string {
  const base = typeof env.NVIDIA_BASE_URL === 'string' ? env.NVIDIA_BASE_URL.trim() : '';
  if (!base) return NV_DEFAULT_URL;
  if (/\/chat\/completions\/?$/.test(base)) return base.replace(/\/chat\/completions\/?$/, '/embeddings');
  return `${base.replace(/\/+$/, '')}/embeddings`;
}

/** The NVIDIA key, as a list (empty when unset). 10.3 — there is exactly one
 * now; the list shape stays so the engine loop reads the same. */
export function defaultProviderKeys(env: AiEnv): string[] {
  const key = providerKey(env, 'nvidia');
  return key ? [key] : [];
}

/**
 * Per-isolate cooldown for an engine that just failed, so a dead engine does
 * not cost every request a round trip. A 404 (model not served) keeps it
 * aside for half an hour; anything else for a minute.
 */
const cooling = new Map<string, number>();
export function resetEmbedCooldowns(): void {
  cooling.clear();
}
function coolDown(model: string, status: number | null): void {
  cooling.set(model, Date.now() + (status === 404 ? 30 * 60_000 : 60_000));
}
function isCooling(model: string): boolean {
  const until = cooling.get(model);
  if (!until) return false;
  if (until > Date.now()) return true;
  cooling.delete(model);
  return false;
}

interface Attempt {
  vectors: number[][] | null;
  status: number | null;
  body: string;
}

async function post(url: string, headers: Record<string, string>, body: unknown, ms: number): Promise<Attempt> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), Math.max(1, ms));
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    const text = await res.text().catch(() => '');
    if (!res.ok) return { vectors: null, status: res.status, body: text.slice(0, 400) };
    return { vectors: readVectors(text), status: res.status, body: '' };
  } catch {
    return { vectors: null, status: null, body: '' };
  } finally {
    clearTimeout(timer);
  }
}

/** Raw vectors out of a standard (`data[].embedding`) or native batch (`embeddings[].values`) answer. */
export function readVectors(text: string): number[][] | null {
  let j: unknown;
  try {
    j = JSON.parse(text);
  } catch {
    return null;
  }
  if (!j || typeof j !== 'object') return null;
  const o = j as { data?: unknown; embeddings?: unknown };
  if (Array.isArray(o.data)) {
    const rows = o.data as Array<{ embedding?: unknown; index?: unknown }>;
    // Standard answers carry an index; honour it when every row has one.
    const indexed = rows.every((r) => r && typeof r.index === 'number');
    const ordered = indexed ? [...rows].sort((a, b) => (a.index as number) - (b.index as number)) : rows;
    const out = ordered.map((r) => (r && Array.isArray(r.embedding) ? (r.embedding as number[]) : null));
    return out.every((v): v is number[] => !!v) ? out : null;
  }
  if (Array.isArray(o.embeddings)) {
    const out = (o.embeddings as Array<{ values?: unknown }>).map((r) => (r && Array.isArray(r.values) ? (r.values as number[]) : null));
    return out.every((v): v is number[] => !!v) ? out : null;
  }
  return null;
}

/** Unit vectors of one consistent size, or null when the answer does not fit the request. */
function finishVectors(raw: number[][] | null, count: number, model: string): { dim: number; vectors: number[][] } | null {
  if (!raw || raw.length !== count) return null;
  const dim = isTruncatable(model) ? EMBED_DIM : undefined;
  const vectors: number[][] = [];
  for (const v of raw) {
    const n = normalise(v, dim);
    if (!n) return null;
    vectors.push(n);
  }
  const size = vectors[0]?.length ?? 0;
  if (!size || vectors.some((v) => v.length !== size)) return null;
  return { dim: size, vectors };
}

const mentionsDimensions = (body: string): boolean => /dimension/i.test(body);

type Engine = { model: string; run: (texts: string[], kind: EmbedKind, ms: () => number) => Promise<Attempt & { model: string }> };

function defaultProviderEngine(env: AiEnv, model: string, sized: boolean): Engine | null {
  const keys = defaultProviderKeys(env);
  if (!keys.length) return null;
  const url = defaultEmbeddingsUrl(env);
  return {
    model,
    run: async (texts, kind, ms) => {
      let last: Attempt = { vectors: null, status: null, body: '' };
      for (const key of keys) {
        const base = { input: texts, model, input_type: kind, encoding_format: 'float', truncate: 'END' };
        const auth = { authorization: `Bearer ${key}` };
        last = await post(url, auth, sized ? { ...base, dimensions: EMBED_DIM } : base, ms());
        // A model that will not shrink its vectors: ask again at full size (cut here).
        if (sized && last.status === 400 && mentionsDimensions(last.body)) last = await post(url, auth, base, ms());
        // Only a wrong or exhausted key is worth another key on the same account family.
        if (last.vectors || !(last.status === 401 || last.status === 403 || last.status === 429)) break;
      }
      return { ...last, model };
    },
  };
}

function flagshipEngine(env: AiEnv, model = FLAGSHIP_EMBED_MODEL): Engine | null {
  const key = providerKey(env, 'gemini');
  if (!key) return null;
  return {
    model,
    run: async (texts, kind, ms) => {
      // Native first: it is the one that knows query from passage and accepts both key shapes.
      const native = await post(
        flagshipNativeUrl(model),
        { 'x-goog-api-key': key },
        {
          requests: texts.map((text) => ({
            model: `models/${model}`,
            content: { parts: [{ text }] },
            taskType: kind === 'query' ? 'RETRIEVAL_QUERY' : 'RETRIEVAL_DOCUMENT',
            outputDimensionality: EMBED_DIM,
          })),
        },
        ms(),
      );
      if (native.vectors || (native.status !== null && !isWrongDoor(native.status, native.body))) return { ...native, model };
      const auth = { authorization: `Bearer ${key}` };
      let open = await post(FLAGSHIP_STANDARD_URL, auth, { input: texts, model, dimensions: EMBED_DIM }, ms());
      if (open.status === 400 && mentionsDimensions(open.body)) open = await post(FLAGSHIP_STANDARD_URL, auth, { input: texts, model }, ms());
      return { ...open, model };
    },
  };
}

/** 10.3 — listed NVIDIA embedding models in preference order. */
export function orderNvidiaEmbeds(ids: string[]): string[] {
  const rank = (id: string): number => {
    const i = NV_EMBED_PREFERENCE.findIndex((w) => id.toLowerCase().includes(w));
    return i < 0 ? NV_EMBED_PREFERENCE.length : i;
  };
  return [...ids].sort((a, b) => rank(a) - rank(b) || b.localeCompare(a));
}

/** The engines this deployment can reach, in ladder order (the preferred model first).
 *  10.3 — with `lists`, the engines are the listed free models; a provider
 *  whose list is empty keeps its fixed engines (today's fallbacks). */
export function embedEngines(env: AiEnv, prefer?: string | null, lists?: EmbedLists | null): Engine[] {
  const nv = lists?.nvidia.length
    ? orderNvidiaEmbeds(lists.nvidia).map((m) => defaultProviderEngine(env, m, true))
    : [defaultProviderEngine(env, NV_EMBED_PRIMARY, true), defaultProviderEngine(env, NV_EMBED_SECONDARY, false)];
  const gm = lists?.gemini.length
    ? [...lists.gemini].sort((a, b) => Number(b === FLAGSHIP_EMBED_MODEL) - Number(a === FLAGSHIP_EMBED_MODEL) || a.localeCompare(b)).map((m) => flagshipEngine(env, m))
    : [flagshipEngine(env)];
  const all = [...nv, ...gm].filter((e): e is Engine => !!e);
  const i = prefer ? all.findIndex((e) => e.model === prefer) : -1;
  return i > 0 ? [all[i], ...all.slice(0, i), ...all.slice(i + 1)] : all;
}

/** Embed `texts` on the first engine that answers. Never throws. */
export async function embedTexts(env: AiEnv, texts: string[], kind: EmbedKind, opts: EmbedOpts = {}): Promise<EmbedResult> {
  const leash = opts.timeoutMs ?? ENGINE_TIMEOUT_MS;
  const deadlineAt = opts.deadlineAt ?? Date.now() + 3 * leash;
  const tried: string[] = [];
  const engines = embedEngines(env, opts.prefer, await embedLists(env));
  for (const engine of engines) {
    // A cooling engine is skipped unless it is the only one left to try.
    if (isCooling(engine.model) && engines.some((e) => !isCooling(e.model))) continue;
    const remaining = deadlineAt - Date.now();
    if (remaining < 300) break;
    tried.push(engine.model);
    const ms = (): number => Math.min(leash, Math.max(1, deadlineAt - Date.now()));
    const got = await engine.run(texts, kind, ms);
    const done = finishVectors(got.vectors, texts.length, engine.model);
    if (done) {
      cooling.delete(engine.model);
      return { ok: true, model: engine.model, dim: done.dim, vectors: done.vectors };
    }
    coolDown(engine.model, got.status);
    // Status only — provider bodies can echo request details, and keys never appear here.
    console.log(`[embed] ${engine.model} failed status=${got.status ?? 'network/timeout'}`);
  }
  return { ok: false, error: 'no_engine', tried };
}

/** 10.3 — the free embedding models NVIDIA and Gemini list right now, waited
 *  for at most EMBED_LIST_WAIT_MS (a cold isolate must not spend the whole
 *  budget on a list read: it uses the fixed engines this once). Null = wait
 *  ran out; empty arrays = nothing listed (or no key). Never throws. */
export async function embedLists(env: AiEnv): Promise<EmbedLists | null> {
  const lists = Promise.all([fetchMedia(env, 'nvidia'), fetchMedia(env, 'gemini')])
    .then(([nv, gm]) => ({
      nvidia: nv.filter((m) => m.kind === 'embedding').map((m) => m.id),
      gemini: gm.filter((m) => m.kind === 'embedding').map((m) => m.id),
    }))
    .catch(() => null);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const wait = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), EMBED_LIST_WAIT_MS);
  });
  try {
    return await Promise.race([lists, wait]);
  } finally {
    clearTimeout(timer);
  }
}
