/**
 * Live free-model catalogues — one per provider key (10.3).
 *
 * 10.3 — the owner kept exactly four AI keys, one per provider, and every key
 * opens that provider's whole free catalogue: NVIDIA, OpenRouter, Groq and
 * Gemini. Instead of hard-coding a list that rots the week after it ships,
 * VinaX asks each provider for its own model list at runtime, with its single
 * key, and keeps only what it can honestly offer:
 *
 *   - CHAT-CAPABLE ONLY. Transcription, speech, embedding, reranking, safety
 *     classifiers, parsers and image/video/audio generators ride different
 *     endpoints entirely; listing them in a chat picker would hand the
 *     listener an engine that 404s.
 *   - FREE ONLY. OpenRouter must price BOTH prompt and completion at zero — a
 *     paid slug is never selectable, so the key cannot quietly run up a bill.
 *     NVIDIA's hosted endpoints, Groq's account catalogue and the Gemini API's
 *     free tier are free at the tier the key belongs to; a Gemini model whose
 *     free-tier limit turns out to be ZERO for this key is left out for a day
 *     (see isZeroFreeQuota in ./ai.ts).
 *   - NO WEB BROWSING. VinaX AI has no live web access (10.2): systems that
 *     search the web on their own while they answer are never listed.
 *
 * Every entry carries the model's ORIGINAL published name and its maker, so
 * the app can show exactly which model it is talking to.
 *
 * Nothing here is invented: an empty list means the provider answered with
 * nothing usable (or the key is missing), and the caller says so plainly
 * rather than falling back to a stale hard-coded menu.
 */
import { AI_PROVIDERS, LANE_BASE, PROVIDER_ENV, PROVIDER_LANE, laneCoolingDown, notFreeCooling, type AiEnv, type AiProvider } from './ai';

export type CatalogProvider = AiProvider;

/** One selectable model from a provider catalogue (the /api/aimodels row). */
export interface CatalogModel {
  /** Exact slug to send as `model` — never prettified. */
  id: string;
  /** The model's original published name ("Llama 3.3 70B Instruct"). */
  name: string;
  /** Who made the model ("Meta", "Google"), when known. */
  maker: string | null;
  /** Provider-reported context window, when it reports one. */
  context: number | null;
  /** True when the model accepts images alongside text. */
  vision: boolean;
}

/** One speech model (the voice picker, /api/voices). */
export interface VoiceModel {
  id: string;
  label: string;
  provider: 'groq';
  context: null;
}

/** 10.3 — a provider id from a request or a stored client value. The current
 *  ids pass through; the pre-10.3 short ids (`grq`, `opr`, and the maestro
 *  lane's `ggl`) still resolve, so an installed build keeps working. */
export function normaliseProvider(raw: unknown): CatalogProvider | null {
  if (typeof raw !== 'string') return null;
  const v = raw.trim().toLowerCase();
  if ((AI_PROVIDERS as readonly string[]).includes(v)) return v as CatalogProvider;
  const legacy: Record<string, CatalogProvider> = { grq: 'groq', opr: 'openrouter', ggl: 'gemini', nvd: 'nvidia', nv: 'nvidia' };
  return legacy[v] ?? null;
}

/** Slug fragments that mark a model as a TEXT-TO-SPEECH engine. The chat
 *  filter throws these away; the voice picker is the one place they belong.
 *  Kept deliberately narrow — a false positive here would put a chat model in
 *  the voice menu, where it answers with an error instead of audio. */
const VOICE_MODEL = /\btts\b|text-to-speech|-speech\b|orpheus|playai-tts/i;

/** 10.2 — catalogue systems that browse the live web on their own while they
 *  answer, by EXACT model name (the slug with its vendor prefix and routing
 *  suffix removed — what catalogLabel() returns). VinaX AI has no live web
 *  access, so these are never offered, never selectable and never the
 *  automatic pick, whatever id the provider publishes them under. */
export const WEB_BROWSING_SLUGS: Record<CatalogProvider, readonly string[]> = {
  nvidia: [],
  openrouter: [],
  groq: ['compound', 'compound-mini'],
  gemini: [],
};

/** 10.3 — web-browsing systems by SHAPE, on every provider: OpenRouter's
 *  `:online` variants (the same model with a web plugin attached), the
 *  `sonar` search family, anything named for search, and Gemini's
 *  deep-research agents. */
const WEB_BROWSING = /:online$|(?:^|\/)sonar\b|search|deep-research/i;

/** Whether a served slug is one of the excluded web-browsing systems. */
export function isWebBrowsingModel(provider: CatalogProvider, id: string): boolean {
  const slug = id.trim();
  return WEB_BROWSING.test(slug) || WEB_BROWSING_SLUGS[provider].includes(catalogLabel(slug).toLowerCase());
}

/** Groq and OpenRouter: slug fragments that mark a model as NOT a
 *  chat-completions engine. Every term here was earned by a real catalogue
 *  row: the audio, embedding, rerank and classifier models both providers
 *  list alongside their chat models would 404 (or answer nonsense) if a chat
 *  picker offered them. `safety` covers the content-safety classifiers;
 *  `guard` covers the prompt-guard and safeguard families. */
const NON_CHAT =
  /whisper|tts|text-to-speech|speech|transcri|embed|rerank|moderat|guard|safety|prompt-?shield|image|diffusion|video|sdxl|flux/i;

/** 10.3 — NVIDIA: the families its /v1/models list mixes in with the chat
 *  models (every term earned from the live list on 2026-10-06):
 *    embed / retriever    embedqa, nemoretriever, arctic-embed, nemotron-3-embed
 *    rerank               reranking models
 *    guard / safety       llama-guard, nemoguard topic control, content safety
 *    reward               nemotron-4-340b-reward (scores answers, never writes one)
 *    parse                nemotron-parse (document OCR)
 *    clip                 nvclip (image–text embeddings)
 *    detector             ai-synthetic-video-detector
 *    riva-translate       a machine-translation engine: it translates the
 *                         prompt instead of answering it (probed in 5.4.1)
 *    deplot, kosmos, fuyu, neva, vila
 *                         image-in models served on NVIDIA's separate visual
 *                         endpoints, not on chat completions
 *  plus the speech and image-generation families named for every provider
 *  (whisper/asr/tts/speech, sdxl/stable-diffusion/flux). DiffusionGemma is a
 *  TEXT diffusion model and stays. */
const NVIDIA_NON_CHAT =
  /embed|retriever|rerank|guard|safety|reward|parse|clip|detector|riva-translate|deplot|kosmos|fuyu|\bneva\b|\bvila\b|whisper|\basr\b|tts|speech|sdxl|stable-diffusion|flux/i;

/** 10.3 — Gemini: the model list carries embedding, attributed-QA, image and
 *  video generation, speech, live/native-audio, robotics and computer-use
 *  models next to the text engines. */
const GEMINI_NON_CHAT = /embed|\baqa\b|imagen|\bveo\b|image|tts|native-audio|audio|\blive\b|robotics|computer-use|lyria/i;

/** Preferred default for each catalogue, most-wanted first, matched as a
 *  SUBSTRING of the slug. Substrings on purpose: these catalogues re-publish
 *  models under new ids without notice, and a hard-coded exact slug is what
 *  put a dead pin on both catalog lanes in the first place. Anything not
 *  listed still works — it just isn't the automatic pick. */
const PREFERRED: Record<CatalogProvider, string[]> = {
  nvidia: ['nemotron-3.5-lightning', 'gpt-oss-20b', 'nemotron-3-super'],
  openrouter: ['nemotron-3-super', 'nemotron-3-ultra', 'gemma-4-31b', 'nemotron-3.5-lightning', 'nemotron-3-nano-omni', 'gemma-4'],
  groq: ['gpt-oss-20b', 'gpt-oss-120b', 'qwen3.8', 'qwen3.6'],
  gemini: ['gemini-3.8-flash', 'flash'],
};

// ---------------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------------

/** "meta-llama/llama-3.3-70b-instruct:free" -> "llama-3.3-70b-instruct".
 *  The vendor prefix and the routing suffix are plumbing, not a model name. */
export function catalogLabel(id: string): string {
  const tail = id.includes('/') ? id.slice(id.lastIndexOf('/') + 1) : id;
  return tail.replace(/:(free|beta|extended|nitro|floor|online)$/i, '').trim() || id;
}

/** Words whose published spelling is not plain title case. */
const WORD: Record<string, string> = {
  gpt: 'GPT', oss: 'OSS', glm: 'GLM', it: 'IT', vl: 'VL', moe: 'MoE', qa: 'QA', ai: 'AI', xs: 'XS', ocr: 'OCR',
  dbrx: 'DBRX', deepseek: 'DeepSeek', yi: 'Yi', lfm: 'LFM', allam: 'ALLaM', qwq: 'QwQ', chatqa: 'ChatQA',
  codegemma: 'CodeGemma', recurrentgemma: 'RecurrentGemma', diffusiongemma: 'DiffusionGemma', codellama: 'CodeLlama',
  starcoder2: 'StarCoder2', sea: 'SEA', lion: 'LION',
};

/** 10.3 — a slug turned back into the model's published name, faithfully:
 *  `meta/llama-3.3-70b-instruct` → "Llama 3.3 70B Instruct",
 *  `nvidia/nemotron-3.5-lightning-30b-a3b` → "Nemotron 3.5 Lightning 30B A3B",
 *  `openai/gpt-oss-20b` → "GPT-OSS 20B". Sizes, active-parameter counts and
 *  context suffixes are upper-cased; versions are left as published. */
export function humaniseSlug(id: string): string {
  const tokens = catalogLabel(id).split(/[-_]+/).filter(Boolean);
  const out: string[] = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const t = tokens[i];
    const low = t.toLowerCase();
    if (low === 'gpt' && tokens[i + 1]?.toLowerCase() === 'oss') {
      out.push('GPT-OSS');
      i += 1;
    } else if (/^\d+(?:\.\d+)?[bmkt]$/i.test(t) || /^a\d+(?:\.\d+)?[bm]$/i.test(t) || /^\d+e$/i.test(t) || /^[kr]\d+(?:\.\d+)?$/i.test(t)) {
      out.push(t.toUpperCase()); // 70B, A3B, 128K, 16E, K3, R1
    } else if (/^\d+x\d+(?:\.\d+)?b$/i.test(t)) {
      out.push(`${t.slice(0, -1)}B`); // 8x22B
    } else if (/^v\d+(?:\.\d+)*$/i.test(t)) {
      out.push(tokens[i - 1]?.toLowerCase() === 'deepseek' ? t.toUpperCase() : t.toLowerCase()); // DeepSeek V4, v0.1
    } else if (WORD[low]) {
      out.push(WORD[low]);
    } else if (/^\d/.test(t)) {
      out.push(t);
    } else {
      out.push(t.charAt(0).toUpperCase() + t.slice(1));
    }
  }
  return out.join(' ') || id;
}

/** Makers by the vendor prefix providers publish slugs under. */
const MAKER: Record<string, string> = {
  '01-ai': '01.AI', adept: 'Adept', ai21labs: 'AI21 Labs', aisingapore: 'AI Singapore', bigcode: 'BigCode',
  databricks: 'Databricks', 'deepseek-ai': 'DeepSeek', deepseek: 'DeepSeek', google: 'Google', ibm: 'IBM',
  meta: 'Meta', 'meta-llama': 'Meta', microsoft: 'Microsoft', mistralai: 'Mistral', 'nv-mistralai': 'Mistral',
  moonshotai: 'Moonshot AI', nvidia: 'NVIDIA', openai: 'OpenAI', poolside: 'Poolside', qwen: 'Qwen',
  snowflake: 'Snowflake', writer: 'Writer', 'z-ai': 'Z.ai', zyphra: 'Zyphra',
};
/** Makers of un-prefixed slugs, by the model family the slug starts with. */
const MAKER_BY_FAMILY: Array<[RegExp, string]> = [
  [/^(llama|codellama)/i, 'Meta'],
  [/^(gemini|gemma|codegemma|recurrentgemma)/i, 'Google'],
  [/^(qwen|qwq)/i, 'Qwen'],
  [/^(mistral|mixtral|codestral)/i, 'Mistral'],
  [/^gpt-oss/i, 'OpenAI'],
  [/^deepseek/i, 'DeepSeek'],
  [/^kimi/i, 'Moonshot AI'],
  [/^nemotron/i, 'NVIDIA'],
];

/** Who made a model, from its slug (and a provider-reported owner as the last word). */
export function makerOf(id: string, ownedBy?: unknown): string | null {
  const slash = id.indexOf('/');
  if (slash > 0) {
    const known = MAKER[id.slice(0, slash).toLowerCase()];
    if (known) return known;
  }
  const label = catalogLabel(id);
  for (const [re, maker] of MAKER_BY_FAMILY) if (re.test(label)) return maker;
  // Groq reports a readable owner ("Meta", "Alibaba Cloud"); a lowercase
  // org handle ("openai", "system") is plumbing, not a name.
  if (typeof ownedBy === 'string' && /^[A-Z]/.test(ownedBy.trim()) && ownedBy.trim().length <= 40) return ownedBy.trim();
  return null;
}

// ---------------------------------------------------------------------------
// Parsers — pure, exported for tests
// ---------------------------------------------------------------------------

/** True when the provider prices this model at zero in BOTH directions.
 *  Prices arrive as decimal strings ("0", "0.0000002"); anything that is not
 *  numerically zero counts as paid, and anything unparseable counts as paid
 *  too — an unknown price is never assumed free. */
export function isFreePricing(pricing: unknown): boolean {
  if (!pricing || typeof pricing !== 'object') return false;
  const p = pricing as Record<string, unknown>;
  const zero = (v: unknown): boolean => {
    const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
    return Number.isFinite(n) && n === 0;
  };
  return zero(p.prompt) && zero(p.completion);
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.round(v) : null);
const rowsOf = (body: unknown, field: 'data' | 'models'): Record<string, unknown>[] => {
  const rows = (body as Record<string, unknown> | null)?.[field];
  return Array.isArray(rows) ? (rows.filter((r) => r && typeof r === 'object') as Record<string, unknown>[]) : [];
};
const byName = (a: CatalogModel, b: CatalogModel): number => a.name.localeCompare(b.name) || a.id.localeCompare(b.id);

/** NVIDIA `/v1/models`: `{ data: [{ id, owned_by }] }` — no prices (every
 *  hosted endpoint is free on the developer tier), no context sizes. */
export function parseNvidiaCatalog(body: unknown): CatalogModel[] {
  const out: CatalogModel[] = [];
  const seen = new Set<string>();
  for (const r of rowsOf(body, 'data')) {
    const id = typeof r.id === 'string' ? r.id.trim() : '';
    if (!id || seen.has(id) || r.active === false) continue;
    if (NVIDIA_NON_CHAT.test(id) || isWebBrowsingModel('nvidia', id)) continue;
    seen.add(id);
    out.push({ id, name: humaniseSlug(id), maker: makerOf(id), context: null, vision: /vision|\bvl\b|vlm|omni|cosmos-reason/i.test(id) });
  }
  return out.sort(byName);
}

/** "Meta: Llama 3.3 70B Instruct (free)" → { maker: "Meta", name: "Llama 3.3 70B Instruct" }. */
export function splitRouterName(raw: string): { name: string; maker: string | null } {
  const clean = raw.replace(/\s*\((?:free)\)\s*$/i, '').replace(/\s+/g, ' ').trim();
  const colon = clean.indexOf(': ');
  if (colon > 0 && colon < 40) return { maker: clean.slice(0, colon).trim(), name: clean.slice(colon + 2).trim() };
  return { maker: null, name: clean };
}

/** OpenRouter `/api/v1/models`: zero-priced, text-only-output chat models.
 *  Its own meta-routers (`openrouter/free`, `openrouter/auto`) are left out:
 *  they hand each request to a different model, so the reply could never say
 *  which one answered. Music generators (text + audio out) fail the
 *  text-only-output check, and expired rows are dropped. */
export function parseOpenRouterCatalog(body: unknown, now = Date.now()): CatalogModel[] {
  const out: CatalogModel[] = [];
  const seen = new Set<string>();
  for (const r of rowsOf(body, 'data')) {
    const id = typeof r.id === 'string' ? r.id.trim() : '';
    if (!id || seen.has(id) || r.active === false) continue;
    if (id.toLowerCase().startsWith('openrouter/')) continue;
    if (NON_CHAT.test(id) || VOICE_MODEL.test(id) || isWebBrowsingModel('openrouter', id)) continue;
    if (!isFreePricing(r.pricing)) continue;
    const arch = (r.architecture ?? {}) as { input_modalities?: unknown; output_modalities?: unknown };
    const outMods = Array.isArray(arch.output_modalities) ? (arch.output_modalities as unknown[]) : null;
    if (outMods && (!outMods.includes('text') || outMods.some((m) => m !== 'text'))) continue;
    if (typeof r.expiration_date === 'string' && Date.parse(r.expiration_date) < now) continue;
    const named = typeof r.name === 'string' && r.name.trim() ? splitRouterName(r.name) : { name: humaniseSlug(id), maker: null };
    const inMods = Array.isArray(arch.input_modalities) ? (arch.input_modalities as unknown[]) : [];
    seen.add(id);
    out.push({ id, name: named.name || humaniseSlug(id), maker: named.maker ?? makerOf(id), context: num(r.context_length), vision: inMods.includes('image') });
  }
  return out.sort(byName);
}

/** Groq `/openai/v1/models`: `{ data: [{ id, owned_by, active, context_window }] }`. */
export function parseGroqCatalog(body: unknown): CatalogModel[] {
  const out: CatalogModel[] = [];
  const seen = new Set<string>();
  for (const r of rowsOf(body, 'data')) {
    const id = typeof r.id === 'string' ? r.id.trim() : '';
    if (!id || seen.has(id) || r.active === false) continue;
    // 10.3 — the speech models the voice picker lists (Orpheus carries no
    // "tts" in its slug) are never chat engines.
    if (NON_CHAT.test(id) || VOICE_MODEL.test(id) || isWebBrowsingModel('groq', id)) continue;
    seen.add(id);
    out.push({
      id,
      name: humaniseSlug(id),
      maker: makerOf(id, r.owned_by),
      context: num(r.context_window ?? r.context_length),
      // The Llama 4 pair are the account's image-in models.
      vision: /vision|llama-4-(?:scout|maverick)|\bvl\b/i.test(id),
    });
  }
  return out.sort(byName);
}

/** Gemini `/v1beta/models`: `{ models: [{ name: "models/…", displayName,
 *  inputTokenLimit, supportedGenerationMethods }] }`. A text engine answers
 *  `generateContent`; the OpenAI-compatible list (`{ data: [{ id }] }`, no
 *  methods, no display names) is accepted as a fallback shape. */
export function parseGeminiCatalog(body: unknown): CatalogModel[] {
  const native = rowsOf(body, 'models');
  const rows = native.length ? native : rowsOf(body, 'data');
  const out: CatalogModel[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    const raw = typeof r.name === 'string' ? r.name : typeof r.id === 'string' ? r.id : '';
    const id = raw.trim().replace(/^models\//, '');
    if (!id || seen.has(id)) continue;
    const methods = r.supportedGenerationMethods;
    if (Array.isArray(methods) && !methods.includes('generateContent')) continue;
    if (GEMINI_NON_CHAT.test(id) || isWebBrowsingModel('gemini', id)) continue;
    seen.add(id);
    const display = typeof r.displayName === 'string' && r.displayName.trim() ? r.displayName.replace(/\s+/g, ' ').trim() : humaniseSlug(id);
    out.push({ id, name: display, maker: 'Google', context: num(r.inputTokenLimit), vision: /^gemini-/i.test(id) });
  }
  return out.sort(byName);
}

/** Any provider's model-list body into the chat models VinaX may offer. */
export function parseCatalog(provider: CatalogProvider, body: unknown): CatalogModel[] {
  if (provider === 'nvidia') return parseNvidiaCatalog(body);
  if (provider === 'openrouter') return parseOpenRouterCatalog(body);
  if (provider === 'groq') return parseGroqCatalog(body);
  return parseGeminiCatalog(body);
}

// ---------------------------------------------------------------------------
// Live lists
// ---------------------------------------------------------------------------

const GEMINI_LIST = 'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000';
const GEMINI_OPENAI_LIST = 'https://generativelanguage.googleapis.com/v1beta/openai/models';

/** The NVIDIA `/v1` root, honouring NVIDIA_BASE_URL (a chat-completions URL or a bare root). */
export function nvidiaModelsUrl(env: AiEnv): string {
  const base = typeof env.NVIDIA_BASE_URL === 'string' ? env.NVIDIA_BASE_URL.trim() : '';
  if (!base) return 'https://integrate.api.nvidia.com/v1/models';
  return `${base.replace(/\/chat\/completions\/?$/, '').replace(/\/+$/, '')}/models`;
}

/** The requests that list one provider's models with its key, best first. */
function listRequests(env: AiEnv, provider: CatalogProvider, key: string): Array<{ url: string; headers: Record<string, string> }> {
  const bearer = { authorization: `Bearer ${key}`, accept: 'application/json' };
  if (provider === 'nvidia') return [{ url: nvidiaModelsUrl(env), headers: bearer }];
  if (provider === 'openrouter') return [{ url: `${LANE_BASE.router}/models`, headers: bearer }];
  if (provider === 'groq') return [{ url: `${LANE_BASE.scholar}/models`, headers: bearer }];
  // Gemini: the native list carries display names and methods; the
  // OpenAI-compatible list is the fallback for a key shape it refuses.
  return [
    { url: GEMINI_LIST, headers: { 'x-goog-api-key': key, accept: 'application/json' } },
    { url: GEMINI_OPENAI_LIST, headers: bearer },
  ];
}

const TTL_MS = 15 * 60_000;
const cache = new Map<CatalogProvider, { at: number; models: CatalogModel[] }>();
const voiceCache = new Map<CatalogProvider, { at: number; models: VoiceModel[] }>();

const keyOf = (env: AiEnv, provider: CatalogProvider): string => {
  const raw = env[PROVIDER_ENV[provider]];
  return typeof raw === 'string' ? raw.trim() : '';
};

/** A model this isolate learned has no free allowance on the key is left out
 *  while that verdict lasts (10.3). */
const stillFree = (provider: CatalogProvider, models: CatalogModel[]): CatalogModel[] => models.filter((m) => !notFreeCooling(provider, m.id));

/** One provider's free chat catalogue, cached per isolate for 15 minutes.
 *  Returns [] when the key is missing or the provider is unreachable — the
 *  caller reports an empty menu honestly instead of guessing. Accepts the
 *  pre-10.3 provider ids too. */
export async function fetchCatalog(env: AiEnv, providerRaw: CatalogProvider | string): Promise<CatalogModel[]> {
  const provider = normaliseProvider(providerRaw);
  if (!provider) return [];
  const key = keyOf(env, provider);
  if (!key) return [];
  const hit = cache.get(provider);
  if (hit && Date.now() - hit.at < TTL_MS) return stillFree(provider, hit.models);
  for (const req of listRequests(env, provider, key)) {
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 8000);
    try {
      const res = await fetch(req.url, { headers: req.headers, signal: abort.signal });
      if (!res.ok) continue;
      const models = parseCatalog(provider, await res.json().catch(() => null));
      if (!models.length) continue;
      cache.set(provider, { at: Date.now(), models });
      return stillFree(provider, models);
    } catch {
      /* the next list, or the last good one */
    } finally {
      clearTimeout(timer);
    }
  }
  // Never replace a good list with an empty answer: a blip must not blank
  // the picker for the next quarter of an hour.
  return hit ? stillFree(provider, hit.models) : [];
}

/** All four catalogues at once — what the model picker and the admin Lab read. */
export async function fullCatalog(env: AiEnv): Promise<Record<CatalogProvider, CatalogModel[]>> {
  const lists = await Promise.all(AI_PROVIDERS.map((p) => fetchCatalog(env, p)));
  return Object.fromEntries(AI_PROVIDERS.map((p, i) => [p, lists[i]])) as Record<CatalogProvider, CatalogModel[]>;
}

/** A slug that could be a model id at all (anything else is never looked up). */
const SLUG = /^[\w./:-]{1,128}$/;

/** 10.3 — the catalogue entry for a caller-supplied model, or null. It must be
 *  a model the provider actually lists right now: a slug that is not in the
 *  live free catalogue is refused rather than forwarded, so no request can
 *  route a paid or unknown model onto the key. */
export async function findCatalogModel(env: AiEnv, providerRaw: CatalogProvider | string, wanted: unknown): Promise<CatalogModel | null> {
  if (typeof wanted !== 'string') return null;
  const slug = wanted.trim();
  if (!slug || !SLUG.test(slug)) return null;
  const models = await fetchCatalog(env, providerRaw);
  return models.find((m) => m.id === slug) ?? null;
}

/** The slug form of findCatalogModel. */
export async function resolveCatalogModel(env: AiEnv, provider: CatalogProvider | string, wanted: string | null | undefined): Promise<string | null> {
  return (await findCatalogModel(env, provider, wanted))?.id ?? null;
}

/** 10.3 — a model's published name and maker, for the reply's meta frame and
 *  the assistant's identity line. Synchronous: the cached catalogue entry
 *  when this isolate has one, else the slug read back faithfully. */
export function describeModel(provider: CatalogProvider, id: string): { name: string; maker: string | null } {
  const listed = cache.get(provider)?.models.find((m) => m.id === id);
  if (listed) return { name: listed.name, maker: listed.maker };
  return { name: humaniseSlug(id), maker: provider === 'gemini' ? 'Google' : makerOf(id) };
}

/** The model a catalogue lane should use when nobody picked one.
 *
 *  A catalogue key does not serve a fixed model, so pinning one in the lane
 *  table is a standing bug: the moment the provider retires that slug the
 *  whole lane answers 404, which is exactly what happened to both catalog
 *  lanes. This resolves the default from the LIVE free list instead —
 *  preference order first, then whatever the catalogue actually offers.
 *
 *  Returns null when the key is missing or the provider gave us nothing
 *  usable. Callers must treat that as "this lane is not available right now"
 *  rather than falling back to a guessed slug. */
export async function catalogDefaultModel(env: AiEnv, providerRaw: CatalogProvider | string): Promise<string | null> {
  const provider = normaliseProvider(providerRaw);
  if (!provider) return null;
  const all = await fetchCatalog(env, provider);
  if (!all.length) return null;
  // 8.2.0 — a listed model that just answered 404/5xx/429 is cooling down
  // (see _lib/ai.ts): the default moves to the next listed one instead of
  // sending every listener to the same dead slug. When every row is cooling
  // the full list is used, so the lane is never emptied by it.
  const lane = PROVIDER_LANE[provider];
  const live = all.filter((m) => !laneCoolingDown(lane, m.id));
  const models = live.length ? live : all;
  for (const want of PREFERRED[provider]) {
    const hit = models.find((m) => m.id.toLowerCase().includes(want));
    if (hit) return hit.id;
  }
  return models[0].id;
}

// ---------------------------------------------------------------------------
// Voices (Groq only)
// ---------------------------------------------------------------------------

/** The speech models a key actually serves right now.
 *
 *  Voice was pinned to one hard-coded model and one hard-coded persona, so
 *  there was no way to know whether it still existed, and no way for a
 *  listener to choose. This asks the provider the same question the chat
 *  picker asks — what do you serve? — and keeps only the speech engines.
 *  Only the Groq key serves speech today; any other provider answers [].
 *
 *  An empty list is honest: it means this key serves no speech model right
 *  now, and the caller falls back to the device's own voice rather than
 *  posting text at a model that cannot speak. */
export async function fetchVoiceCatalog(env: AiEnv, providerRaw: CatalogProvider | string = 'groq'): Promise<VoiceModel[]> {
  const provider = normaliseProvider(providerRaw);
  if (provider !== 'groq') return [];
  const hit = voiceCache.get(provider);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.models;
  const key = keyOf(env, provider);
  if (!key) return [];
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 8000);
  try {
    const res = await fetch(`${LANE_BASE.scholar}/models`, { headers: { authorization: `Bearer ${key}`, accept: 'application/json' }, signal: abort.signal });
    if (!res.ok) return hit?.models ?? [];
    const out: VoiceModel[] = [];
    const seen = new Set<string>();
    for (const r of rowsOf(await res.json().catch(() => null), 'data')) {
      const id = typeof r.id === 'string' ? r.id.trim() : '';
      if (!id || seen.has(id) || r.active === false) continue;
      if (!VOICE_MODEL.test(id)) continue;
      seen.add(id);
      out.push({ id, label: catalogLabel(id), provider: 'groq', context: null });
    }
    out.sort((a, b) => a.label.localeCompare(b.label));
    if (!out.length && hit) return hit.models;
    voiceCache.set(provider, { at: Date.now(), models: out });
    return out;
  } catch {
    return hit?.models ?? [];
  } finally {
    clearTimeout(timer);
  }
}

/** True when this key currently serves the given speech model. The voice
 *  route uses it to refuse a slug the provider does not list, so a request
 *  can never aim an arbitrary model id at the key. */
export async function isServedVoiceModel(env: AiEnv, provider: CatalogProvider | string, model: string): Promise<boolean> {
  if (!model || model.length > 128 || !/^[\w./:-]+$/.test(model)) return false;
  const models = await fetchVoiceCatalog(env, provider);
  return models.some((m) => m.id === model);
}

/** Clear the isolate caches — tests only. */
export function resetCatalogCache(): void {
  cache.clear();
  voiceCache.clear();
}
