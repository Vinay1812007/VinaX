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
 *
 * 10.3 — the same lists also yield every free MEDIA model (image generation,
 * speech, transcription, music, embeddings) and the free non-web TOOLS (code
 * execution) — see "Media and tools" below. The rules are the chat rules:
 * free on the key's tier only, discovered live where the provider lists it,
 * cached 15 minutes, empty when the key is missing, nothing invented, and
 * nothing that fetches the web.
 */
import { workersAiBinding, workersAiCatalog } from './workersai';
import { AI_PROVIDERS, LANE_BASE, PROVIDER_LANE, laneCoolingDown, notFreeCooling, providerCoolingDown, providerKey, type AiEnv, type AiProvider } from './ai';

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
  cloudflare: [],
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
  // 11.2 — never an automatic pick in the assistant (Workers AI is explicit
  // picks only); this orders only the owner console's default.
  cloudflare: ['llama-3.3-70b', 'llama-3.1-8b'],
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
  if (provider === 'cloudflare') return []; // 11.2 — curated, never parsed from a list body
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
  // 10.3 — `output_modalities=all`: the default list carries text-output
  // models only; the media models (image, speech, transcription, embeddings,
  // audio) are listed only when asked for every modality.
  if (provider === 'openrouter') return [{ url: `${LANE_BASE.router}/models?output_modalities=all`, headers: bearer }];
  if (provider === 'groq') return [{ url: `${LANE_BASE.scholar}/models`, headers: bearer }];
  // Gemini: the native list carries display names and methods; the
  // OpenAI-compatible list is the fallback for a key shape it refuses.
  return [
    { url: GEMINI_LIST, headers: { 'x-goog-api-key': key, accept: 'application/json' } },
    { url: GEMINI_OPENAI_LIST, headers: bearer },
  ];
}

const TTL_MS = 15 * 60_000;
/** 10.3 — one list read per provider yields both the chat models and the media models. */
const cache = new Map<CatalogProvider, { at: number; models: CatalogModel[]; media: MediaModel[] }>();
const voiceCache = new Map<CatalogProvider, { at: number; models: VoiceModel[] }>();

/** 10.3 — through providerKey(), the only reader of an AI key. */
const keyOf = (env: AiEnv, provider: CatalogProvider): string => providerKey(env, provider) ?? '';

/** A model this isolate learned has no free allowance on the key is left out
 *  while that verdict lasts (10.3). */
const stillFree = <T extends { id: string }>(provider: CatalogProvider, models: T[]): T[] => models.filter((m) => !notFreeCooling(provider, m.id));

/** One provider's chat and media lists, from one cached list read (10.3).
 *  Never replaces a good list with an empty answer. */
async function providerLists(env: AiEnv, provider: CatalogProvider): Promise<{ models: CatalogModel[]; media: MediaModel[] } | null> {
  const key = keyOf(env, provider);
  if (!key) return null;
  const hit = cache.get(provider);
  if (hit && Date.now() - hit.at < TTL_MS) return hit;
  if (provider === 'cloudflare') {
    // 11.2 — the curated Workers AI list (./workersai.ts), checked against the
    // binding's own listing when it has one. Chat only: no media.
    const models = (await workersAiCatalog(workersAiBinding(env))).map((m) => ({ id: m.id, name: m.name, maker: m.maker, context: null, vision: false }));
    if (!models.length) return hit ?? null;
    const entry = { at: Date.now(), models, media: [] as MediaModel[] };
    cache.set(provider, entry);
    return entry;
  }
  for (const req of listRequests(env, provider, key)) {
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 8000);
    try {
      const res = await fetch(req.url, { headers: req.headers, signal: abort.signal });
      if (!res.ok) continue;
      const body = await res.json().catch(() => null);
      const models = parseCatalog(provider, body);
      const media = parseMedia(provider, body);
      if (!models.length && !media.length) continue;
      const entry = { at: Date.now(), models, media };
      cache.set(provider, entry);
      return entry;
    } catch {
      /* the next list, or the last good one */
    } finally {
      clearTimeout(timer);
    }
  }
  // Never replace a good list with an empty answer: a blip must not blank
  // the picker for the next quarter of an hour.
  return hit ?? null;
}

/** One provider's free chat catalogue, cached per isolate for 15 minutes.
 *  Returns [] when the key is missing or the provider is unreachable — the
 *  caller reports an empty menu honestly instead of guessing. Accepts the
 *  pre-10.3 provider ids too. */
export async function fetchCatalog(env: AiEnv, providerRaw: CatalogProvider | string): Promise<CatalogModel[]> {
  const provider = normaliseProvider(providerRaw);
  if (!provider) return [];
  const lists = await providerLists(env, provider);
  return lists ? stillFree(provider, lists.models) : [];
}

/** All four catalogues at once — what the model picker and the admin Lab read. */
export async function fullCatalog(env: AiEnv): Promise<Record<CatalogProvider, CatalogModel[]>> {
  const lists = await Promise.all(AI_PROVIDERS.map((p) => fetchCatalog(env, p)));
  return Object.fromEntries(AI_PROVIDERS.map((p, i) => [p, lists[i]])) as Record<CatalogProvider, CatalogModel[]>;
}

/** A slug that could be a model id at all (anything else is never looked up).
 *  11.2 — an `@` is allowed as the FIRST character only (Workers AI slugs:
 *  "@cf/meta/…", "@hf/…"); and the slug must still be on a live list. */
const SLUG = /^@?[\w./:-]{1,128}$/;

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
// Media and tools (10.3)
// ---------------------------------------------------------------------------

/** 10.3 — the media kinds VinaX can call over plain HTTPS with a provider's key. */
export type MediaKind = 'image' | 'speech' | 'transcription' | 'music' | 'embedding';
export const MEDIA_KINDS: readonly MediaKind[] = ['image', 'speech', 'transcription', 'music', 'embedding'];

/** One free media model (the `/api/aimodels` `media` row). */
export interface MediaModel {
  /** Exact slug to send — never prettified. */
  id: string;
  /** The model's original published name. */
  name: string;
  maker: string | null;
  kind: MediaKind;
  /** Speech only: the voice names the model accepts (empty = the provider's default voice). */
  voices?: string[];
}

/** One free non-web tool and the chat models on the provider that can run it. */
export interface ToolEntry {
  id: 'code_execution' | 'web_search';
  name: 'Code execution' | 'Web search';
  /** Chat model ids on this provider that run it in the provider's own sandbox. */
  models: string[];
}

/** 10.3 — NVIDIA's hosted image models live on `https://ai.api.nvidia.com/v1/genai/<org>/<model>`,
 *  NOT on /v1/models, so they cannot be discovered live. This is the small
 *  fixed list whose request shape was read from NVIDIA's own API reference
 *  (docs.api.nvidia.com/nim/reference/<org>-<model>-infer, 2026-10-06) and
 *  whose endpoint answered (401 without a key = it exists). Every hosted
 *  endpoint is free on the developer tier, like the chat models. Left out on
 *  purpose: sdxl-turbo (its reference page is gone — retired), stable
 *  diffusion 3.5 large (endpoint 404), kontext (needs an input image). */
export const NVIDIA_IMAGE_MODELS: ReadonlyArray<{ id: string; name: string; maker: string; shape: 'flux' | 'flux2' | 'sd3' | 'sdxl' }> = [
  { id: 'black-forest-labs/flux.1-schnell', name: 'FLUX.1 schnell', maker: 'Black Forest Labs', shape: 'flux' },
  { id: 'black-forest-labs/flux.2-klein-4b', name: 'FLUX.2 klein 4B', maker: 'Black Forest Labs', shape: 'flux2' },
  { id: 'black-forest-labs/flux.1-dev', name: 'FLUX.1 dev', maker: 'Black Forest Labs', shape: 'flux' },
  { id: 'stabilityai/stable-diffusion-3-medium', name: 'Stable Diffusion 3 Medium', maker: 'Stability AI', shape: 'sd3' },
  { id: 'stabilityai/stable-diffusion-xl', name: 'Stable Diffusion XL', maker: 'Stability AI', shape: 'sdxl' },
];

/** 10.3 — NVIDIA text-embedding families on /v1/models. `nvclip` is left out:
 *  its vectors are for image–text matching, not for text search. */
const NVIDIA_EMBED = /embed|arctic-embed/i;

/** 10.3 — Groq's speech models with a PUBLISHED voice list (Groq's Orpheus
 *  page, 2026-10-06; the API takes the names in lower case, and the input is
 *  capped at 200 characters upstream). A speech model whose voices are not
 *  published is not offered: posting at it without a valid voice answers 400. */
const GROQ_VOICES: Array<[RegExp, string[]]> = [
  [/orpheus.*english/i, ['autumn', 'diana', 'hannah', 'austin', 'daniel', 'troy']],
  [/orpheus.*arabic/i, ['abdullah', 'fahad', 'sultan', 'lulwa', 'noura', 'aisha']],
];

/** 10.3 — Gemini's 30 prebuilt TTS voices (speech-generation guide, 2026-10-06). */
export const GEMINI_VOICES: readonly string[] = [
  'Zephyr', 'Puck', 'Charon', 'Kore', 'Fenrir', 'Leda', 'Orus', 'Aoede', 'Callirrhoe', 'Autonoe',
  'Enceladus', 'Iapetus', 'Umbriel', 'Algieba', 'Despina', 'Erinome', 'Algenib', 'Rasalgethi', 'Laomedeia', 'Achernar',
  'Alnilam', 'Schedar', 'Gacrux', 'Pulcherrima', 'Achird', 'Zubenelgenubi', 'Vindemiatrix', 'Sadachbia', 'Sadaltager', 'Sulafat',
];

/** 10.3 — Gemini media the pricing page marks "Not available" on the free
 *  tier (2026-10-06): the pro TTS model. Every Gemini image model, Imagen, Veo
 *  and Lyria are "Not available" too and are never parsed as media at all;
 *  the live/native-audio models speak over a WebSocket, not plain HTTPS. */
const GEMINI_NOT_FREE_MEDIA = /-pro-.*tts|-pro-tts/i;

/** 10.3 — OpenRouter: a media model is free only when the provider says so
 *  without leaving a price unknown. Every listed price must be zero, AND
 *  either the slug is OpenRouter's own free variant (`:free`) or the price
 *  of what the model outputs is listed explicitly as zero (`image_output`
 *  for images, `audio_output` for audio). Earned from the live list:
 *  video models and the music models price at zero for prompt and completion
 *  but bill per clip/song in a field the list leaves out ("30 second clips are
 *  priced at $0.04 per clip"), so zero prompt+completion alone proves nothing. */
export function isFreeMediaPricing(row: { id?: unknown; pricing?: unknown; description?: unknown }, kind: MediaKind): boolean {
  const p = row.pricing;
  if (!p || typeof p !== 'object') return false;
  const entries = Object.entries(p as Record<string, unknown>).filter(([k]) => k !== 'discount');
  if (!entries.length) return false;
  for (const [, v] of entries) {
    const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
    if (!Number.isFinite(n) || n !== 0) return false;
  }
  if (typeof row.description === 'string' && /priced at \$|\$\d/.test(row.description)) return false;
  const id = typeof row.id === 'string' ? row.id : '';
  if (/:free$/i.test(id)) return true;
  const outField = kind === 'image' ? 'image_output' : kind === 'music' || kind === 'speech' ? 'audio_output' : null;
  return !!outField && (p as Record<string, unknown>)[outField] !== undefined;
}

const voiceNames = (v: unknown): string[] =>
  Array.isArray(v) ? (v.filter((x) => typeof x === 'string' && x.trim() && x.length <= 80) as string[]).slice(0, 120) : [];

/** NVIDIA `/v1/models` → the free embedding models (the image models are the fixed list above). */
export function parseNvidiaMedia(body: unknown): MediaModel[] {
  const out: MediaModel[] = [];
  const seen = new Set<string>();
  for (const r of rowsOf(body, 'data')) {
    const id = typeof r.id === 'string' ? r.id.trim() : '';
    if (!id || seen.has(id) || r.active === false) continue;
    if (!NVIDIA_EMBED.test(id) || /nvclip/i.test(id)) continue;
    seen.add(id);
    out.push({ id, name: humaniseSlug(id), maker: makerOf(id), kind: 'embedding' });
  }
  return out.sort(byMediaName);
}

/** OpenRouter `/api/v1/models?output_modalities=all` → its free media models.
 *  Kinds from `architecture.output_modalities`: `image` alone → image (served
 *  by the dedicated `/images` endpoint), `speech` → speech, `transcription` →
 *  transcription, `embeddings` → embedding, text + audio from a music model →
 *  music. Image-to-image-only models (they need a picture to start from) are
 *  left out, as are expired rows and anything web-browsing. */
export function parseOpenRouterMedia(body: unknown, now = Date.now()): MediaModel[] {
  const out: MediaModel[] = [];
  const seen = new Set<string>();
  for (const r of rowsOf(body, 'data')) {
    const id = typeof r.id === 'string' ? r.id.trim() : '';
    if (!id || seen.has(id) || r.active === false) continue;
    if (id.toLowerCase().startsWith('openrouter/') || isWebBrowsingModel('openrouter', id)) continue;
    if (typeof r.expiration_date === 'string' && Date.parse(r.expiration_date) < now) continue;
    const arch = (r.architecture ?? {}) as { output_modalities?: unknown };
    const outMods = Array.isArray(arch.output_modalities) ? (arch.output_modalities as unknown[]).map(String) : [];
    const named = typeof r.name === 'string' && r.name.trim() ? splitRouterName(r.name) : { name: humaniseSlug(id), maker: null };
    let kind: MediaKind | null = null;
    if (outMods.length === 1 && outMods[0] === 'image') kind = 'image';
    else if (outMods.length === 1 && outMods[0] === 'speech') kind = 'speech';
    else if (outMods.length === 1 && outMods[0] === 'transcription') kind = 'transcription';
    else if (outMods.length === 1 && outMods[0] === 'embeddings') kind = 'embedding';
    else if (outMods.includes('audio') && /lyria|music/i.test(`${id} ${named.name}`)) kind = 'music';
    if (!kind) continue;
    if (kind === 'image' && typeof r.description === 'string' && /image-to-image model/i.test(r.description) && !/text-to-image/i.test(r.description)) continue;
    if (!isFreeMediaPricing(r, kind)) continue;
    seen.add(id);
    const row: MediaModel = { id, name: named.name || humaniseSlug(id), maker: named.maker ?? makerOf(id), kind };
    if (kind === 'speech') row.voices = voiceNames(r.supported_voices);
    out.push(row);
  }
  return out.sort(byMediaName);
}

/** Groq `/openai/v1/models` → speech models with published voices and the whisper transcription models. */
export function parseGroqMedia(body: unknown): MediaModel[] {
  const out: MediaModel[] = [];
  const seen = new Set<string>();
  for (const r of rowsOf(body, 'data')) {
    const id = typeof r.id === 'string' ? r.id.trim() : '';
    if (!id || seen.has(id) || r.active === false) continue;
    if (/whisper/i.test(id)) {
      seen.add(id);
      out.push({ id, name: humaniseSlug(id), maker: makerOf(id, r.owned_by) ?? 'OpenAI', kind: 'transcription' });
      continue;
    }
    if (!VOICE_MODEL.test(id)) continue;
    const voices = GROQ_VOICES.find(([re]) => re.test(id))?.[1];
    if (!voices) continue;
    seen.add(id);
    out.push({ id, name: humaniseSlug(id), maker: makerOf(id, r.owned_by), kind: 'speech', voices: [...voices] });
  }
  return out.sort(byMediaName);
}

/** The newest stable model of a Gemini flash variant ("gemini-3.8-flash", "gemini-3.5-flash-lite"). */
function newestFlash(ids: string[], lite: boolean): string | null {
  const re = lite ? /^gemini-(\d+(?:\.\d+)?)-flash-lite$/ : /^gemini-(\d+(?:\.\d+)?)-flash$/;
  let best: { id: string; v: number } | null = null;
  for (const id of ids) {
    const m = re.exec(id);
    if (m && (!best || Number(m[1]) > best.v)) best = { id, v: Number(m[1]) };
  }
  return best?.id ?? null;
}

/** Gemini `/v1beta/models` → TTS models (generateContent with an AUDIO
 *  response), embedding models (embedContent), and transcription on the
 *  newest stable flash and flash-lite text models (they take inline audio and
 *  return its text through generateContent). No image or music model: none is
 *  free on the free tier (see GEMINI_NOT_FREE_MEDIA). */
export function parseGeminiMedia(body: unknown): MediaModel[] {
  const native = rowsOf(body, 'models');
  const rows = native.length ? native : rowsOf(body, 'data');
  const out: MediaModel[] = [];
  const seen = new Set<string>();
  const chatIds: string[] = [];
  const display = new Map<string, string>();
  for (const r of rows) {
    const raw = typeof r.name === 'string' ? r.name : typeof r.id === 'string' ? r.id : '';
    const id = raw.trim().replace(/^models\//, '');
    if (!id || seen.has(id) || isWebBrowsingModel('gemini', id)) continue;
    const methods = Array.isArray(r.supportedGenerationMethods) ? (r.supportedGenerationMethods as unknown[]).map(String) : null;
    const name = typeof r.displayName === 'string' && r.displayName.trim() ? r.displayName.replace(/\s+/g, ' ').trim() : humaniseSlug(id);
    display.set(id, name);
    if (/-tts\b/i.test(id) && (!methods || methods.includes('generateContent'))) {
      if (GEMINI_NOT_FREE_MEDIA.test(id)) continue;
      seen.add(id);
      out.push({ id, name, maker: 'Google', kind: 'speech', voices: [...GEMINI_VOICES] });
    } else if (methods ? methods.includes('embedContent') : /embedding/i.test(id)) {
      seen.add(id);
      out.push({ id, name, maker: 'Google', kind: 'embedding' });
    } else if (!methods || methods.includes('generateContent')) {
      chatIds.push(id);
    }
  }
  for (const id of [newestFlash(chatIds, false), newestFlash(chatIds, true)]) {
    if (id && !seen.has(id)) out.push({ id, name: display.get(id) ?? humaniseSlug(id), maker: 'Google', kind: 'transcription' });
  }
  return out.sort(byMediaName);
}

const byMediaName = (a: MediaModel, b: MediaModel): number => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id);

/** Any provider's model-list body into its free media models. */
export function parseMedia(provider: CatalogProvider, body: unknown): MediaModel[] {
  if (provider === 'cloudflare') return []; // 11.2 — chat only
  if (provider === 'nvidia') return parseNvidiaMedia(body);
  if (provider === 'openrouter') return parseOpenRouterMedia(body);
  if (provider === 'groq') return parseGroqMedia(body);
  return parseGeminiMedia(body);
}

/** 10.3 — the free non-web tools a provider's chat models can run, from its
 *  live chat list. Code execution only, and only in the provider's own sandbox:
 *    Gemini  `tools: [{ codeExecution: {} }]` on the Gemini models (not Gemma)
 *    Groq    `tools: [{ type: 'code_interpreter' }]` on the gpt-oss models
 *  NVIDIA and OpenRouter offer no free built-in tool that is not a web tool.
 *  Web tools (search, URL context, browser search, web plugins) are never
 *  listed and never sent (10.2). */
export function codeExecutionModels(provider: CatalogProvider, models: Array<{ id: string }>): string[] {
  if (provider === 'gemini') return models.filter((m) => /^gemini-/i.test(m.id)).map((m) => m.id);
  if (provider === 'groq') return models.filter((m) => /^openai\/gpt-oss-\d+b$/i.test(m.id)).map((m) => m.id);
  return [];
}

/** 11.0 — search grounding: the provider's OWN web search, free on the
 *  Gemini 2.5 Flash family (incl. -lite) up to 500 grounded prompts a day. It
 *  is not free on Gemini 3.x, so those are never search-capable here. This is
 *  the only web tool VinaX sends; no third-party search, no URL fetching. */
export function searchCapable(model: string): boolean {
  return /^gemini-2\.5-flash/i.test(model.trim());
}
export function webSearchModels(provider: CatalogProvider, models: Array<{ id: string }>): string[] {
  return provider === 'gemini' ? models.filter((m) => searchCapable(m.id)).map((m) => m.id) : [];
}

export function toolsFor(provider: CatalogProvider, models: Array<{ id: string }>): ToolEntry[] {
  const ids = codeExecutionModels(provider, models);
  const web = webSearchModels(provider, models);
  return [
    ...(ids.length ? [{ id: 'code_execution' as const, name: 'Code execution' as const, models: ids }] : []),
    ...(web.length ? [{ id: 'web_search' as const, name: 'Web search' as const, models: web }] : []),
  ];
}

/** 10.3 — one provider's free media models, cached with its chat list. NVIDIA's
 *  fixed image list rides along whenever the NVIDIA key is set (it is not on
 *  /v1/models). Models resting with "not free on this key" are left out. */
export async function fetchMedia(env: AiEnv, providerRaw: CatalogProvider | string): Promise<MediaModel[]> {
  const provider = normaliseProvider(providerRaw);
  if (!provider || !keyOf(env, provider)) return [];
  const lists = await providerLists(env, provider);
  const listed = lists?.media ?? [];
  const fixed: MediaModel[] = provider === 'nvidia' ? NVIDIA_IMAGE_MODELS.map((m) => ({ id: m.id, name: m.name, maker: m.maker, kind: 'image' as const })) : [];
  return [...fixed, ...listed].filter((m) => !notFreeCooling(provider, m.id));
}

/** All four providers' media at once. */
export async function fullMedia(env: AiEnv): Promise<Record<CatalogProvider, MediaModel[]>> {
  const lists = await Promise.all(AI_PROVIDERS.map((p) => fetchMedia(env, p)));
  return Object.fromEntries(AI_PROVIDERS.map((p, i) => [p, lists[i]])) as Record<CatalogProvider, MediaModel[]>;
}

/** 10.3 — the media entry for a caller-supplied provider + model of one kind,
 *  or null. Like chat picks, a slug that is not on the live free list is
 *  refused rather than forwarded. */
export async function findMediaModel(env: AiEnv, providerRaw: CatalogProvider | string, kind: MediaKind, wanted: unknown): Promise<MediaModel | null> {
  if (typeof wanted !== 'string') return null;
  const slug = wanted.trim();
  if (!slug || !SLUG.test(slug)) return null;
  return (await fetchMedia(env, providerRaw)).find((m) => m.kind === kind && m.id === slug) ?? null;
}

/** 10.3 — every free model of one kind, in provider order, models resting on a
 *  cooldown last (an automatic pick goes to the first that is not resting). */
export async function mediaChoices(env: AiEnv, kind: MediaKind, order: readonly CatalogProvider[] = AI_PROVIDERS): Promise<Array<{ provider: CatalogProvider; model: MediaModel }>> {
  const all: Array<{ provider: CatalogProvider; model: MediaModel }> = [];
  for (const provider of order) for (const model of await fetchMedia(env, provider)) if (model.kind === kind) all.push({ provider, model });
  return [...all.filter((c) => !providerCoolingDown(c.provider, c.model.id)), ...all.filter((c) => providerCoolingDown(c.provider, c.model.id))];
}

/** 10.3 — the tools one provider offers right now, from its live chat list. */
export async function fetchTools(env: AiEnv, providerRaw: CatalogProvider | string): Promise<ToolEntry[]> {
  const provider = normaliseProvider(providerRaw);
  if (!provider) return [];
  return toolsFor(provider, await fetchCatalog(env, provider));
}

/** 10.3 — what the whole app can offer: true when at least one provider has that kind. */
export interface AiFeatureFlags {
  image: boolean;
  speech: boolean;
  transcription: boolean;
  music: boolean;
  code: boolean;
  /** 11.0 — some chat model can search the web (Gemini 2.5 Flash grounding). */
  web: boolean;
}
export function featureFlags(media: MediaModel[][], tools: ToolEntry[][]): AiFeatureFlags {
  const has = (k: MediaKind): boolean => media.some((list) => list.some((m) => m.kind === k));
  return { image: has('image'), speech: has('speech'), transcription: has('transcription'), music: has('music'), code: tools.some((t) => t.some((x) => x.id === 'code_execution' && x.models.length > 0)),
    web: tools.some((t) => t.some((x) => x.id === 'web_search' && x.models.length > 0)) };
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
