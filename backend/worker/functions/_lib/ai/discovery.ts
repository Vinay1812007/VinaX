/**
 * VinaX AI — free chat models found on their own: each provider's model list
 * is read every few hours, filtered to chat models, and the ones the curated
 * registry (models.ts) does not already have join the picker in a group per
 * provider ("More from Groq", …). They are never in an Auto ladder.
 *
 * Endpoints and response shapes (checked 2026-11-03 against each provider's
 * API reference; no live key was used to build this):
 *   Groq        GET https://api.groq.com/openai/v1/models (Bearer)
 *               → { object: "list", data: [{ id, owned_by, active, context_window, max_completion_tokens? }] }
 *               Every model on a free key is free (rate-limited).
 *   OpenRouter  GET https://openrouter.ai/api/v1/models (Bearer; text output by default)
 *               → { data: [{ id, name, context_length, pricing: { prompt, completion } (strings, USD per token),
 *                   architecture: { input_modalities, output_modalities }, top_provider: { context_length,
 *                   max_completion_tokens }, supported_parameters }] }
 *               Free = the id ends in ":free", or prompt and completion are both "0".
 *   Gemini      GET https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000 (x-goog-api-key)
 *               → { models: [{ name: "models/…", displayName, inputTokenLimit, outputTokenLimit,
 *                   supportedGenerationMethods, thinking? }], nextPageToken? }
 *               Kept: models with generateContent; embeddings, TTS, image, Live / native audio,
 *               transcription, AQA, computer use and the like are left out by name.
 *   NVIDIA      GET https://integrate.api.nvidia.com/v1/models (Bearer)
 *               → { object: "list", data: [{ id, owned_by }] } (no window or kind: filtered by name)
 *   Workers AI  env.AI.models({ task: "Text Generation", per_page, page }) on the binding
 *               (@cloudflare/workers-types: AiModelsSearchObject { name, task: { name }, properties:
 *               [{ property_id, value }] }); `name` is the id `run` takes.
 *
 * Where it lives: each Worker instance's memory (6 hours), and the edge cache
 * (`caches.default`, same 6 hours) so other instances in the same place reuse
 * the filtered list without asking the provider again. No new binding.
 * A provider whose list fails keeps its last good list; with none, it adds
 * nothing and asks again in 15 minutes. Nothing here can break the picker:
 * every failure leaves the curated registry as it is.
 *
 * Safety: a client can only pick an id in the current curated + found set
 * (the chat route looks it up here), ids are checked against a strict
 * character set, and found models go through the same adapters, cooldowns,
 * owner switches and system prompt (full or compact by window) as the rest.
 */
import { LADDERS, MODELS, UTILITY_MODELS } from './models';
import { PROVIDER_NAMES, providerConfigured } from './adapters';
import { ALL_LIVE_MODELS, STT_GROQ_MODELS, TTS_ARABIC, TTS_ENGLISH, TTS_GEMINI_MODELS } from './voice';
import type { AiEnv, ModelFlags, ModelGroup, ModelSpec, ProviderId } from './types';

export const DISCOVERY_TTL_MS = 6 * 60 * 60_000;
export const DISCOVERY_RETRY_MS = 15 * 60_000;
/** One provider's list request. */
export const DISCOVERY_FETCH_MS = 5_000;
/** How long a request waits for a provider it has never heard from; later requests get the result. */
export const DISCOVERY_WAIT_MS = 3_000;
/** At most this many found models per provider. */
export const MAX_FOUND_PER_PROVIDER = 300;

export const DISCOVERY_PROVIDERS: readonly ProviderId[] = ['groq', 'gemini', 'openrouter', 'nvidia', 'cloudflare'];

/** The picker group each provider's found models go in. */
export const DISCOVERY_GROUPS: Readonly<Record<ProviderId, ModelGroup>> = {
  groq: 'more-groq', gemini: 'more-gemini', openrouter: 'more-openrouter', nvidia: 'more-nvidia', cloudflare: 'more-cloudflare',
};

/** One chat model from a provider's list, before it becomes a registry entry. */
export interface FoundModel {
  upstream: string;
  name: string;
  /** Who made it (shown in the description), when the list says. */
  vendor?: string;
  contextTokens?: number | null;
  maxOutput?: number | null;
  vision?: boolean;
  reasoning?: boolean;
  /** Gemini: the model accepts a thinking config. */
  thinking?: boolean;
  /** False: the system text goes in front of the first user turn (Gemma on the Gemini API). */
  systemRole?: boolean;
  pdf?: boolean;
}

export interface ProviderState {
  /** When the list was read (or, after a failure with nothing known, when to count the retry from). */
  at: number;
  ok: boolean;
  models: FoundModel[];
  error: string | null;
  /** When the list was last read successfully. */
  fetchedAt: number | null;
}

// ---------------------------------------------------------------- filtering

/** An id the Worker will ever send upstream: no spaces, quotes or control characters. */
const SAFE_ID = /^[A-Za-z0-9@][A-Za-z0-9@._:/+-]{0,159}$/;

/** Anywhere in the id: kinds of model that cannot hold a text conversation. */
const NOT_CHAT_ANYWHERE = /guard|embed|rerank|whisper|safety|retriev|moderat|transcri|orpheus|playai|text-to-speech|speech-to|native-audio|imagen|diffusion|computer-use|deep-research|nemoretriever|reward|flux|dreamshaper|-ocr|ocr-|vision-encoder/i;
/** As a whole word of the id (between - _ . / :). */
const NOT_CHAT_WORD = new Set([
  'tts', 'asr', 'stt', 'ocr', 'live', 'image', 'images', 'audio', 'speech', 'clip', 'siglip', 'parse', 'veo', 'lyria', 'music',
  'aqa', 'pii', 'bge', 'e5', 'detr', 'yolo', 'yolox', 'segformer', 'depth', 'deplot', 'kosmos', 'fuyu', 'paligemma', 'neva', 'vila',
  'parakeet', 'canary', 'riva-asr', 'sdxl', 'lora-only', 'nv-embedqa', 'embedqa', 'reranker', 'jailbreak', 'topic', 'nemoguard',
]);

export function isChatId(id: string): boolean {
  if (!SAFE_ID.test(id)) return false;
  if (NOT_CHAT_ANYWHERE.test(id)) return false;
  return !id.toLowerCase().split(/[-_./:]+/).some((w) => NOT_CHAT_WORD.has(w));
}

/** Every id the curated registry, the utility list and the voice-only models already name, as `<provider>:<upstream>`. */
function knownIds(): Set<string> {
  const ids = new Set<string>([...MODELS.map((m) => m.id), ...UTILITY_MODELS.map((u) => u.id)]);
  for (const id of Object.values(LADDERS).flat()) ids.add(id);
  for (const id of [...STT_GROQ_MODELS, TTS_ENGLISH, TTS_ARABIC]) ids.add(`groq:${id}`);
  // Dictation's Gemini models are left in: one of them (Gemini 3.8 Flash) is a full chat model too.
  for (const id of [...TTS_GEMINI_MODELS, ...ALL_LIVE_MODELS.map((l) => l.id)]) ids.add(`gemini:${id}`);
  return ids;
}

// ---------------------------------------------------------------- names

const own = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);

const UPPER: Record<string, string> = {
  gpt: 'GPT', oss: 'OSS', vl: 'VL', ai: 'AI', llm: 'LLM', moe: 'MoE', fp8: 'FP8', fp16: 'FP16', awq: 'AWQ', int4: 'INT4', int8: 'INT8',
  r1: 'R1', qwq: 'QwQ', glm: 'GLM', sql: 'SQL', xl: 'XL', xs: 'XS', xxl: 'XXL', ii: 'II', iii: 'III', hf: 'HF', it: '', instruct: '',
  deepseek: 'DeepSeek', openai: 'OpenAI', nvidia: 'NVIDIA', ibm: 'IBM', lfm: 'LFM', mistral: 'Mistral', phi: 'Phi', allam: 'ALLaM',
};

/** A readable name from an upstream id: `meta-llama/llama-3.3-70b-instruct:free` → `Llama 3.3 70B`. */
export function prettyName(upstream: string): string {
  const last = upstream.replace(/^@(?:cf|hf)\//, '').replace(/:free$/, '').split('/').pop() ?? upstream;
  const words = last.split(/[-_\s]+/).filter(Boolean).map((w) => {
    const l = w.toLowerCase();
    if (own(UPPER, l)) return UPPER[l];
    if (/^a?\d+(?:\.\d+)?[bmkt]$/.test(l)) return l.toUpperCase();
    if (/^[\d.]+$|^v\d/.test(l)) return l;
    return l.charAt(0).toUpperCase() + l.slice(1);
  }).filter(Boolean);
  return (words.join(' ') || upstream).slice(0, 80);
}

const VENDORS: Record<string, string> = {
  'meta-llama': 'Meta', meta: 'Meta', openai: 'OpenAI', nvidia: 'NVIDIA', qwen: 'Qwen', mistralai: 'Mistral AI', mistral: 'Mistral AI',
  'deepseek-ai': 'DeepSeek', deepseek: 'DeepSeek', google: 'Google', microsoft: 'Microsoft', ibm: 'IBM', 'ibm-granite': 'IBM',
  moonshotai: 'Moonshot AI', 'z-ai': 'Z.ai', zai: 'Z.ai', thudm: 'Zhipu', 'zai-org': 'Z.ai', anthropic: 'Anthropic', cohere: 'Cohere',
  'x-ai': 'xAI', minimax: 'MiniMax', minimaxai: 'MiniMax', baidu: 'Baidu', tencent: 'Tencent', alibaba: 'Alibaba', 'stepfun-ai': 'StepFun',
  liquid: 'Liquid AI', 'tngtech': 'TNG', 'arcee-ai': 'Arcee AI', 'nousresearch': 'Nous Research', 'moonshot': 'Moonshot AI',
};

export function vendorName(raw: string | undefined | null): string | undefined {
  const v = (raw ?? '').trim();
  if (!v || v.length > 40 || /^(?:system|organization-owner|user)$/i.test(v)) return undefined;
  const k = v.toLowerCase();
  if (own(VENDORS, k)) return VENDORS[k];
  return k.split(/[-_\s]+/).map((w) => (own(UPPER, w) ? UPPER[w] : w.charAt(0).toUpperCase() + w.slice(1))).filter(Boolean).join(' ') || undefined;
}

const num = (v: unknown): number | null => {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
};
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const strs = (v: unknown): string[] => arr(v).filter((x): x is string => typeof x === 'string');
const REASONING_ID = /think|reason|(?:^|[-/])r1(?:$|[-:])|qwq|gpt-oss|magistral|qwen3/i;

// ---------------------------------------------------------------- parsers (pure, tested with fixtures)

export function parseGroq(body: unknown): FoundModel[] {
  return arr(obj(body).data).map(obj).flatMap((m): FoundModel[] => {
    const id = typeof m.id === 'string' ? m.id : '';
    if (!id || m.active === false || !isChatId(id)) return [];
    return [{
      upstream: id, name: prettyName(id), vendor: vendorName(String(m.owned_by ?? id.split('/')[0] ?? '')),
      contextTokens: num(m.context_window), maxOutput: num(m.max_completion_tokens), reasoning: REASONING_ID.test(id),
    }];
  });
}

const zero = (v: unknown): boolean => typeof v === 'string' ? Number(v) === 0 && v.trim() !== '' : v === 0;

export function parseOpenRouter(body: unknown): FoundModel[] {
  const out: FoundModel[] = [];
  for (const m of arr(obj(body).data).map(obj)) {
    const id = typeof m.id === 'string' ? m.id : '';
    const pricing = obj(m.pricing);
    const free = id.endsWith(':free') || (zero(pricing.prompt) && zero(pricing.completion));
    // openrouter/* are routers (Auto, the free router), not models.
    if (!id || !free || id.startsWith('openrouter/') || !isChatId(id)) continue;
    const arch = obj(m.architecture);
    const outMods = strs(arch.output_modalities);
    if (outMods.length && (outMods.some((x) => x !== 'text') || !outMods.includes('text'))) continue;
    const top = obj(m.top_provider);
    const params = strs(m.supported_parameters);
    // "Meta: Llama 3.3 70B Instruct (free)" → vendor "Meta", name "Llama 3.3 70B Instruct".
    const rawName = typeof m.name === 'string' ? m.name.replace(/\s*\(free\)\s*$/i, '').trim() : '';
    const colon = rawName.indexOf(': ');
    const name = (colon > 0 ? rawName.slice(colon + 2) : rawName).trim();
    out.push({
      upstream: id,
      name: name && name.length <= 80 ? name : prettyName(id),
      vendor: colon > 0 ? rawName.slice(0, colon).trim().slice(0, 40) : vendorName(id.split('/')[0]),
      contextTokens: num(top.context_length) ?? num(m.context_length),
      maxOutput: num(top.max_completion_tokens),
      vision: strs(arch.input_modalities).includes('image'),
      reasoning: params.includes('reasoning') || params.includes('include_reasoning') || REASONING_ID.test(id),
    });
  }
  // A model listed both free-priced and as ":free": keep the ":free" one.
  const ids = new Set(out.map((m) => m.upstream));
  return out.filter((m) => m.upstream.endsWith(':free') || !ids.has(`${m.upstream}:free`));
}

export function parseGemini(pages: unknown[]): FoundModel[] {
  const out: FoundModel[] = [];
  for (const page of pages) {
    for (const m of arr(obj(page).models).map(obj)) {
      const id = typeof m.name === 'string' ? m.name.replace(/^models\//, '') : '';
      if (!id || !strs(m.supportedGenerationMethods).includes('generateContent') || !isChatId(id)) continue;
      // Gemma on the Gemini API takes no system instruction and no thinking config.
      const gemma = /^gemma/i.test(id);
      const display = typeof m.displayName === 'string' ? m.displayName.trim() : '';
      out.push({
        upstream: id,
        name: display && display.length <= 80 ? display : prettyName(id),
        vendor: gemma ? 'Google Gemma' : undefined,
        contextTokens: num(m.inputTokenLimit),
        maxOutput: num(m.outputTokenLimit),
        vision: !gemma,
        pdf: !gemma,
        thinking: !gemma && m.thinking === true,
        reasoning: !gemma && m.thinking === true,
        systemRole: !gemma,
      });
    }
  }
  return out;
}

export function parseNvidia(body: unknown): FoundModel[] {
  return arr(obj(body).data).map(obj).flatMap((m): FoundModel[] => {
    const id = typeof m.id === 'string' ? m.id : '';
    if (!id || !isChatId(id)) return [];
    return [{ upstream: id, name: prettyName(id), vendor: vendorName(String(m.owned_by ?? id.split('/')[0] ?? '')), reasoning: REASONING_ID.test(id) }];
  });
}

export function parseWorkersAi(list: unknown, now = Date.now()): FoundModel[] {
  return arr(list).map(obj).flatMap((m): FoundModel[] => {
    const id = typeof m.name === 'string' ? m.name : '';
    const task = obj(m.task);
    if (!id || !/^@(?:cf|hf)\//.test(id) || (typeof task.name === 'string' && task.name !== 'Text Generation') || !isChatId(id)) return [];
    const props = new Map(arr(m.properties).map(obj).map((p) => [String(p.property_id ?? ''), p.value]));
    const retire = Date.parse(String(props.get('planned_deprecation_date') ?? ''));
    if (Number.isFinite(retire) && retire <= now) return [];
    return [{
      upstream: id, name: prettyName(id), vendor: vendorName(id.split('/')[1]),
      contextTokens: num(props.get('context_window')) ?? num(props.get('max_total_tokens')), reasoning: REASONING_ID.test(id),
    }];
  });
}

// ---------------------------------------------------------------- registry entries

/** Most history each provider's found models keep (characters), like the curated ones. */
const CONTEXT_CAP: Readonly<Record<ProviderId, number>> = { groq: 30_000, gemini: 600_000, openrouter: 100_000, nvidia: 100_000, cloudflare: 60_000 };
/** When the list gives no window (NVIDIA): enough for the full prompt, small enough for most models. */
const CONTEXT_UNKNOWN = 32_000;
const OUTPUT_DEFAULT = 4_096;
const OUTPUT_MAX = 8_192;

const FLAGS: ModelFlags = { vision: false, pdf: false, grounding: false, reasoning: false, artifacts: true, systemRole: true, thinkFormat: 'none' };

const fmtTokens = (t: number): string => (t >= 1_000_000 ? `${Math.round(t / 1_048_576 * 10) / 10}M` : `${Math.round(t / 1_000)}K`);

/** A found model as a registry entry: sizes from its window, flags from what the list says. */
export function toSpec(provider: ProviderId, f: FoundModel): ModelSpec {
  const ctx = f.contextTokens && f.contextTokens > 0 ? f.contextTokens : null;
  let maxOutput = Math.min(OUTPUT_MAX, Math.max(512, f.maxOutput ?? OUTPUT_DEFAULT));
  if (ctx) maxOutput = Math.min(maxOutput, Math.max(512, Math.floor(ctx / 4)));
  // About three characters a token, leaving room for the answer.
  const maxContextChars = ctx ? Math.max(4_000, Math.min(CONTEXT_CAP[provider], (ctx - maxOutput) * 3)) : Math.min(CONTEXT_CAP[provider], CONTEXT_UNKNOWN);
  const thinkFormat: ModelFlags['thinkFormat'] = provider === 'gemini' ? (f.thinking ? 'parts' : 'none') : f.reasoning ? (provider === 'openrouter' ? 'field' : 'tags') : 'none';
  const description = [f.vendor, ctx ? `${fmtTokens(ctx)} context` : null].filter(Boolean).join(' · ') || 'Free model';
  return {
    id: `${provider}:${f.upstream}`,
    provider,
    upstream: f.upstream,
    name: f.name,
    group: DISCOVERY_GROUPS[provider],
    tier: 'full',
    description,
    maxContextChars,
    maxOutput,
    discovered: true,
    ...(provider === 'gemini' && f.thinking ? { params: { thinkingConfig: { includeThoughts: true } } } : {}),
    flags: { ...FLAGS, vision: f.vision === true, pdf: f.pdf === true, reasoning: f.reasoning === true, systemRole: f.systemRole !== false, thinkFormat },
  };
}

/**
 * The found models as registry entries, in provider order: anything the
 * curated registry, the utility list or voice already has is left out, and a
 * name another entry already uses gets its service in brackets.
 */
export function discoveredSpecs(states: Partial<Record<ProviderId, ProviderState>>): ModelSpec[] {
  const known = knownIds();
  const names = new Set(MODELS.map((m) => m.name.toLowerCase()));
  const out: ModelSpec[] = [];
  for (const p of DISCOVERY_PROVIDERS) {
    const st = states[p];
    if (!st) continue;
    for (const f of st.models.slice(0, MAX_FOUND_PER_PROVIDER)) {
      const spec = toSpec(p, f);
      if (known.has(spec.id)) continue;
      known.add(spec.id);
      let name = spec.name;
      if (names.has(name.toLowerCase())) name = `${name} (${PROVIDER_NAMES[p].replace(/^Google /, '')})`;
      if (names.has(name.toLowerCase())) name = `${spec.name} (${f.upstream})`.slice(0, 120);
      names.add(name.toLowerCase());
      out.push({ ...spec, name });
    }
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

type Fetcher = (env: AiEnv, signal: AbortSignal) => Promise<FoundModel[]>;

async function getJson(url: string, headers: Record<string, string>, signal: AbortSignal): Promise<unknown> {
  const res = await fetch(url, { headers: { accept: 'application/json', ...headers }, signal });
  if (!res.ok) throw new Error(`http_${res.status}`);
  return res.json();
}

const bearer = (key: string | undefined): Record<string, string> => ({ authorization: `Bearer ${key?.trim() ?? ''}` });

export const FETCHERS: Readonly<Record<ProviderId, Fetcher>> = {
  groq: async (env, signal) => parseGroq(await getJson('https://api.groq.com/openai/v1/models', bearer(env.GROQ_API_KEY), signal)),
  openrouter: async (env, signal) => {
    const res = await fetch('https://openrouter.ai/api/v1/models', {
      headers: { accept: 'application/json', ...bearer(env.OPENROUTER_API_KEY), 'HTTP-Referer': 'https://www.vinaxmusic.online', 'X-Title': 'VinaX AI' },
      signal,
    });
    if (!res.ok) throw new Error(`http_${res.status}`);
    return parseOpenRouter(openRouterFreeEntries(await res.text()));
  },
  nvidia: async (env, signal) => parseNvidia(await getJson('https://integrate.api.nvidia.com/v1/models', bearer(env.NVIDIA_API_KEY), signal)),
  gemini: async (env, signal) => {
    const pages: unknown[] = [];
    let token = '';
    for (let i = 0; i < 3; i++) {
      const page = await getJson(`https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000${token ? `&pageToken=${encodeURIComponent(token)}` : ''}`, { 'x-goog-api-key': env.GEMINI_API_KEY?.trim() ?? '' }, signal);
      pages.push(page);
      token = typeof obj(page).nextPageToken === 'string' ? String(obj(page).nextPageToken) : '';
      if (!token) break;
    }
    return parseGemini(pages);
  },
  cloudflare: async (env) => {
    const ai = env.AI;
    if (!ai || typeof ai.models !== 'function') throw new Error('no_search');
    const all: unknown[] = [];
    for (let page = 1; page <= 5; page++) {
      const list = await ai.models({ task: 'Text Generation', per_page: 100, page });
      if (!Array.isArray(list)) throw new Error('bad_list');
      all.push(...list);
      if (list.length < 100) break;
    }
    return parseWorkersAi(all);
  },
};

const memo = new Map<ProviderId, ProviderState>();
const inflight = new Map<ProviderId, Promise<ProviderState>>();

const cacheKey = (p: ProviderId): string => `https://vinax-ai-discovery.internal/v1/${p}`;
const edgeCache = (): Cache | null => (globalThis as { caches?: { default?: Cache } }).caches?.default ?? null;

async function fromEdge(p: ProviderId, now: number): Promise<ProviderState | null> {
  const cache = edgeCache();
  if (!cache) return null;
  try {
    const hit = await cache.match(cacheKey(p));
    if (!hit) return null;
    const v = obj(await hit.json());
    const at = Number(v.fetchedAt);
    if (!Number.isFinite(at) || now - at >= DISCOVERY_TTL_MS || !Array.isArray(v.models)) return null;
    // Checked again on the way in, as if the provider had sent it.
    const models = v.models.map(obj).filter((m): m is FoundModel & Record<string, unknown> => typeof m.upstream === 'string' && typeof m.name === 'string' && isChatId(m.upstream));
    if (!models.length) return null;
    return { at, ok: true, models: models.slice(0, MAX_FOUND_PER_PROVIDER), error: null, fetchedAt: at };
  } catch {
    return null;
  }
}

async function toEdge(p: ProviderId, st: ProviderState): Promise<void> {
  const cache = edgeCache();
  if (!cache) return;
  try {
    await cache.put(cacheKey(p), new Response(JSON.stringify({ fetchedAt: st.fetchedAt, models: st.models }), {
      headers: { 'content-type': 'application/json', 'cache-control': `public, max-age=${Math.floor(DISCOVERY_TTL_MS / 1000)}` },
    }));
  } catch { /* caching is best-effort */ }
}

/** Read one provider's list (edge cache first) and remember it; a failure keeps the last good list. Never throws. */
async function refresh(env: AiEnv, p: ProviderId, now: number, fetchers: Readonly<Record<ProviderId, Fetcher>>): Promise<ProviderState> {
  const prev = memo.get(p);
  const cached = await fromEdge(p, now);
  if (cached) {
    memo.set(p, cached);
    return cached;
  }
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), DISCOVERY_FETCH_MS);
  let st: ProviderState;
  try {
    const models = (await fetchers[p](env, ac.signal)).slice(0, MAX_FOUND_PER_PROVIDER);
    if (!models.length) throw new Error('empty');
    st = { at: now, ok: true, models, error: null, fetchedAt: now };
    await toEdge(p, st);
  } catch (e) {
    const error = ac.signal.aborted ? 'timeout' : e instanceof Error ? e.message.slice(0, 40) : 'failed';
    // Ask again in 15 minutes; meanwhile keep what was known.
    st = { at: now - DISCOVERY_TTL_MS + DISCOVERY_RETRY_MS, ok: false, models: prev?.models ?? [], error, fetchedAt: prev?.fetchedAt ?? null };
    console.log(JSON.stringify({ route: 'ai-discovery', provider: p, ok: false, error }));
  } finally {
    clearTimeout(timer);
  }
  memo.set(p, st);
  return st;
}

export interface DiscoverOptions {
  now?: number;
  /** Only these providers (the chat route looks up one). */
  only?: readonly ProviderId[];
  /** Keep a refresh going after the response (ctx.waitUntil). */
  waitUntil?: (p: Promise<unknown>) => void;
  /** How long to wait for a provider with nothing known yet. */
  waitMs?: number;
  fetchers?: Readonly<Record<ProviderId, Fetcher>>;
}

/** Which providers the owner lets discovery use: `discover: false` (all off) or `{ "<provider>": false }`. */
export function discoveryAllowed(setting: unknown, p: ProviderId): boolean {
  if (setting === false) return false;
  if (setting && typeof setting === 'object' && !Array.isArray(setting)) return (setting as Record<string, unknown>)[p] !== false;
  return true;
}

/**
 * Each configured, allowed provider's state: fresh from memory, else from the
 * edge cache or the provider. A stale list is answered at once while it
 * refreshes; a provider never heard from gets `waitMs` before it is skipped
 * for this request.
 */
export async function discoveryStates(env: AiEnv, discover: unknown, o: DiscoverOptions = {}): Promise<Partial<Record<ProviderId, ProviderState>>> {
  const now = o.now ?? Date.now();
  const fetchers = o.fetchers ?? FETCHERS;
  const providers = (o.only ?? DISCOVERY_PROVIDERS).filter((p) => providerConfigured(env, p) && discoveryAllowed(discover, p));
  const out: Partial<Record<ProviderId, ProviderState>> = {};
  const waits: Array<Promise<void>> = [];
  for (const p of providers) {
    const st = memo.get(p);
    if (st && now - st.at < DISCOVERY_TTL_MS) {
      out[p] = st;
      continue;
    }
    let job = inflight.get(p);
    if (!job) {
      job = refresh(env, p, now, fetchers).finally(() => inflight.delete(p));
      inflight.set(p, job);
      o.waitUntil?.(job);
    }
    if (st && st.models.length) {
      out[p] = st;
      continue;
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    waits.push(Promise.race([
      job.then((s) => { out[p] = s; }),
      new Promise<void>((resolve) => { timer = setTimeout(resolve, o.waitMs ?? DISCOVERY_WAIT_MS); }),
    ]).finally(() => clearTimeout(timer)));
  }
  await Promise.all(waits);
  return out;
}

/** The found models (registry entries, before the owner's switches). */
export async function discoveredModels(env: AiEnv, discover: unknown, o: DiscoverOptions = {}): Promise<ModelSpec[]> {
  try {
    return discoveredSpecs(await discoveryStates(env, discover, o));
  } catch {
    return [];
  }
}

/** A found model by registry id, from what this instance already knows (no request): reply labels. */
export function knownDiscovered(id: string): ModelSpec | null {
  const p = id.split(':')[0] as ProviderId;
  if (!DISCOVERY_PROVIDERS.includes(p)) return null;
  const st = memo.get(p);
  if (!st) return null;
  return discoveredSpecs({ [p]: st }).find((s) => s.id === id) ?? null;
}

/** For the owner's Health card: what each provider's list gave, and when. */
export function discoverySnapshot(): Array<{ provider: ProviderId; ok: boolean; count: number; fetchedAt: string | null; error: string | null }> {
  return DISCOVERY_PROVIDERS.flatMap((p) => {
    const st = memo.get(p);
    return st ? [{ provider: p, ok: st.ok, count: st.models.length, fetchedAt: st.fetchedAt ? new Date(st.fetchedAt).toISOString() : null, error: st.error }] : [];
  });
}

/** Tests only. */
export function _resetDiscovery(): void {
  memo.clear();
  inflight.clear();
}
