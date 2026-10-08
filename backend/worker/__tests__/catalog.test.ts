/**
 * Free-model catalogues (10.3 — one per provider key: NVIDIA, OpenRouter,
 * Groq, Gemini). Every key opens a whole catalogue instead of one pinned
 * engine, so the filters that decide what a listener may select are the
 * safety boundary: a paid slug must never reach the marketplace key, a
 * non-chat model must never reach a chat picker, and a web-browsing system
 * must never be offered at all (10.2).
 *
 * The NVIDIA and OpenRouter fixtures are real rows from the providers' public
 * /models endpoints (2026-10-06), trimmed to the fields the parsers read.
 */
import { describe, expect, it, beforeEach, vi, afterEach } from 'vitest';
import {
  WEB_BROWSING_SLUGS,
  catalogDefaultModel,
  catalogLabel,
  describeModel,
  fetchCatalog,
  fetchVoiceCatalog,
  findCatalogModel,
  humaniseSlug,
  isFreePricing,
  isServedVoiceModel,
  isWebBrowsingModel,
  makerOf,
  normaliseProvider,
  nvidiaModelsUrl,
  parseCatalog,
  parseGeminiCatalog,
  parseGroqCatalog,
  parseNvidiaCatalog,
  parseOpenRouterCatalog,
  resetCatalogCache,
  resolveCatalogModel,
  splitRouterName,
} from '../functions/_lib/catalog';
import { clearLaneCooldowns, noteLaneFailure } from '../functions/_lib/ai';
import { onRequestGet as aiModelsGet } from '../functions/api/aimodels';

beforeEach(() => {
  resetCatalogCache();
  clearLaneCooldowns();
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Real NVIDIA /v1/models rows: the chat models, then the families the filter must drop. */
const NVIDIA_LIST = {
  object: 'list',
  data: [
    'meta/llama-3.2-11b-vision-instruct',
    'nvidia/nemotron-3.5-lightning-30b-a3b',
    'openai/gpt-oss-20b',
    'deepseek-ai/deepseek-v4.1-flash',
    'mistralai/mixtral-8x22b-v0.1',
    'moonshotai/kimi-k3',
    'google/diffusiongemma-26b-a4b-it',
    'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning',
    // Non-chat on this endpoint:
    'nvidia/llama-3.2-nv-embedqa-1b-v1',
    'nvidia/llama-3.2-nemoretriever-1b-vlm-embed-v1',
    'snowflake/arctic-embed-l',
    'meta/llama-guard-4-12b',
    'nvidia/llama-3.1-nemoguard-8b-topic-control',
    'nvidia/nemotron-3.5-content-safety',
    'nvidia/nemotron-4-340b-reward',
    'nvidia/nemotron-parse-2.0',
    'nvidia/nvclip',
    'nvidia/ai-synthetic-video-detector',
    'nvidia/riva-translate-4b-instruct-v2',
    'google/deplot',
    'microsoft/kosmos-2',
    'adept/fuyu-8b',
    'nvidia/neva-22b',
    'nvidia/vila',
  ].map((id) => ({ id, object: 'model', created: 735790403, owned_by: id.split('/')[0] })),
};

const FREE = { prompt: '0', completion: '0' };
const TEXT = { input_modalities: ['text'], output_modalities: ['text'] };
/** Real OpenRouter /api/v1/models rows (search-system slugs under a neutral vendor). */
const OPENROUTER_LIST = {
  data: [
    { id: 'meta-llama/llama-3.3-70b-instruct:free', name: 'Meta: Llama 3.3 70B Instruct (free)', context_length: 131072, pricing: FREE, architecture: TEXT },
    { id: 'inclusionai/ling-3.1-flash', name: 'inclusionAI: Ling 3.1 Flash', context_length: 262144, pricing: FREE, architecture: TEXT },
    { id: 'google/gemma-4-26b-a4b-it:free', name: 'Google: Gemma 4 26B A4B  (free)', context_length: 262144, pricing: FREE, architecture: { input_modalities: ['image', 'text', 'video'], output_modalities: ['text'] } },
    // Paid in one direction or both: never offered.
    { id: 'meta-llama/llama-3.3-70b-instruct', name: 'Meta: Llama 3.3 70B Instruct', pricing: { prompt: '0.00000022', completion: '0.0000005' }, architecture: TEXT },
    { id: 'vendor/half-free', name: 'Vendor: Half Free', pricing: { prompt: '0', completion: '0.000001' }, architecture: TEXT },
    // Free but not a chat engine, or not an honest single model.
    { id: 'google/lyria-3-pro-preview', name: 'Google: Lyria 3 Pro Preview', pricing: FREE, architecture: { input_modalities: ['text', 'image'], output_modalities: ['text', 'audio'] } },
    { id: 'nvidia/nemotron-3.5-content-safety:free', name: 'NVIDIA: Nemotron 3.5 Content Safety (free)', pricing: FREE, architecture: TEXT },
    { id: 'openrouter/free', name: 'Free Models Router', pricing: FREE, architecture: TEXT },
    { id: 'vendor/expired-chat:free', name: 'Vendor: Expired (free)', pricing: FREE, architecture: TEXT, expiration_date: '2026-01-01' },
    // Web browsing, priced at zero for the test: still never offered.
    { id: 'meta-llama/llama-3.3-70b-instruct:online', name: 'Meta: Llama 3.3 70B Instruct (online)', pricing: FREE, architecture: TEXT },
    { id: 'vendor/sonar-pro', name: 'Vendor: Sonar Pro', pricing: FREE, architecture: TEXT },
    { id: 'relace/relace-search', name: 'Relace: Relace Search', pricing: FREE, architecture: TEXT },
  ],
};

/** Groq /openai/v1/models rows (the owner's working list, 2026-09-09). */
const GROQ_LIST = {
  object: 'list',
  data: [
    { id: 'llama-3.1-8b-instant', owned_by: 'Meta', active: true, context_window: 131072 },
    { id: 'openai/gpt-oss-20b', owned_by: 'OpenAI', active: true, context_window: 131072 },
    { id: 'openai/gpt-oss-120b', owned_by: 'OpenAI', active: true, context_window: 131072 },
    { id: 'qwen/qwen3-32b', owned_by: 'Alibaba Cloud', active: true, context_window: 131072 },
    { id: 'meta-llama/llama-4-scout-17b-16e-instruct', owned_by: 'Meta', active: true, context_window: 131072 },
    { id: 'allam-2-7b', owned_by: 'SDAIA', active: true, context_window: 4096 },
    { id: 'groq/compound', owned_by: 'Groq', active: true, context_window: 131072 },
    { id: 'groq/compound-mini', owned_by: 'Groq', active: true, context_window: 131072 },
    { id: 'whisper-large-v3', owned_by: 'OpenAI', active: true },
    { id: 'playai-tts', owned_by: 'PlayAI', active: true },
    { id: 'canopylabs/orpheus-v1-english', owned_by: 'Canopy Labs', active: true },
    { id: 'meta-llama/llama-prompt-guard-2-86m', owned_by: 'Meta', active: true },
    { id: 'openai/gpt-oss-safeguard-20b', owned_by: 'OpenAI', active: true },
    { id: 'retired-model', owned_by: 'x', active: false },
  ],
};

/** Gemini /v1beta/models rows, native shape. */
const gm = (name: string, displayName: string, methods = ['generateContent', 'countTokens'], inputTokenLimit = 1048576) => ({
  name: `models/${name}`,
  displayName,
  inputTokenLimit,
  supportedGenerationMethods: methods,
});
const GEMINI_LIST = {
  models: [
    gm('gemini-3.8-flash', 'Gemini 3.8 Flash'),
    gm('gemini-2.5-pro', 'Gemini 2.5 Pro'),
    gm('gemma-3-27b-it', 'Gemma 3 27B', ['generateContent', 'countTokens'], 131072),
    gm('gemini-embedding-001', 'Gemini Embedding 001', ['embedContent', 'countTextTokens']),
    gm('aqa', 'Model that performs Attributed Question Answering.', ['generateAnswer']),
    gm('imagen-4.0-generate-001', 'Imagen 4', ['predict']),
    gm('veo-3.0-generate-001', 'Veo 3', ['predictLongRunning']),
    gm('gemini-2.5-flash-image', 'Nano Banana', ['generateContent']),
    gm('gemini-2.5-flash-preview-tts', 'Gemini 2.5 Flash Preview TTS', ['generateContent']),
    gm('gemini-2.5-flash-native-audio-latest', 'Gemini 2.5 Flash Native Audio', ['generateContent']),
    gm('gemini-live-2.5-flash-preview', 'Gemini Live 2.5 Flash Preview', ['bidiGenerateContent']),
    gm('gemini-robotics-er-1.5-preview', 'Gemini Robotics-ER 1.5 Preview', ['generateContent']),
    gm('gemini-2.5-computer-use-preview-10-2025', 'Gemini 2.5 Computer Use Preview', ['generateContent']),
    gm('deep-research-pro-preview-12-2025', 'Deep Research Pro Preview', ['generateContent']),
  ],
};

// ---------------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------------

describe('model names', () => {
  it('catalogLabel drops the vendor prefix and the routing suffix', () => {
    expect(catalogLabel('meta-llama/llama-3.3-70b-instruct:free')).toBe('llama-3.3-70b-instruct');
    expect(catalogLabel('llama-3.3-70b-versatile')).toBe('llama-3.3-70b-versatile');
  });

  it('humaniseSlug reads a slug back as the model\'s published name', () => {
    expect(humaniseSlug('meta/llama-3.3-70b-instruct')).toBe('Llama 3.3 70B Instruct');
    expect(humaniseSlug('nvidia/nemotron-3.5-lightning-30b-a3b')).toBe('Nemotron 3.5 Lightning 30B A3B');
    expect(humaniseSlug('openai/gpt-oss-20b')).toBe('GPT-OSS 20B');
    expect(humaniseSlug('deepseek-ai/deepseek-v4.1-flash')).toBe('DeepSeek V4.1 Flash');
    expect(humaniseSlug('mistralai/mixtral-8x22b-v0.1')).toBe('Mixtral 8x22B v0.1');
    expect(humaniseSlug('moonshotai/kimi-k3')).toBe('Kimi K3');
    expect(humaniseSlug('meta-llama/llama-4-scout-17b-16e-instruct')).toBe('Llama 4 Scout 17B 16E Instruct');
    expect(humaniseSlug('gemini-3.8-flash')).toBe('Gemini 3.8 Flash');
    expect(humaniseSlug('qwen/qwen3-32b')).toBe('Qwen3 32B');
  });

  it('makerOf names who made the model, from the prefix, the family or the provider\'s owner field', () => {
    expect(makerOf('meta/llama-3.3-70b-instruct')).toBe('Meta');
    expect(makerOf('deepseek-ai/deepseek-v4.1-flash')).toBe('DeepSeek');
    expect(makerOf('mistralai/mistral-nemotron')).toBe('Mistral');
    expect(makerOf('llama-3.1-8b-instant')).toBe('Meta');
    expect(makerOf('allam-2-7b', 'SDAIA')).toBe('SDAIA');
    expect(makerOf('unknown/thing', 'system')).toBeNull();
  });

  it('splitRouterName separates the maker and drops "(free)"', () => {
    expect(splitRouterName('Meta: Llama 3.3 70B Instruct (free)')).toEqual({ maker: 'Meta', name: 'Llama 3.3 70B Instruct' });
    expect(splitRouterName('Google: Gemma 4 26B A4B  (free)')).toEqual({ maker: 'Google', name: 'Gemma 4 26B A4B' });
    expect(splitRouterName('Free Models Router')).toEqual({ maker: null, name: 'Free Models Router' });
  });

  it('normaliseProvider accepts the four ids and the pre-10.3 short ones', () => {
    expect(['nvidia', 'openrouter', 'groq', 'gemini'].map(normaliseProvider)).toEqual(['nvidia', 'openrouter', 'groq', 'gemini']);
    expect(['grq', 'opr', 'ggl', 'NVIDIA', ' Groq '].map(normaliseProvider)).toEqual(['groq', 'openrouter', 'gemini', 'nvidia', 'groq']);
    expect(normaliseProvider('other')).toBeNull();
    expect(normaliseProvider(7)).toBeNull();
  });
});

describe('isFreePricing', () => {
  it('accepts zero in both directions, in either numeric shape', () => {
    expect(isFreePricing({ prompt: '0', completion: '0' })).toBe(true);
    expect(isFreePricing({ prompt: 0, completion: 0 })).toBe(true);
  });

  it('rejects anything priced, half-priced, missing or unparseable', () => {
    expect(isFreePricing({ prompt: '0', completion: '0.0000002' })).toBe(false);
    expect(isFreePricing({ prompt: '0' })).toBe(false);
    expect(isFreePricing({ prompt: 'free', completion: 'free' })).toBe(false);
    expect(isFreePricing(null)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The four filters
// ---------------------------------------------------------------------------

describe('NVIDIA catalogue filter', () => {
  const models = parseNvidiaCatalog(NVIDIA_LIST);
  it('keeps the chat models and drops embeddings, retrievers, guards, safety, reward, parse, CLIP, detectors, MT and the visual-endpoint models', () => {
    expect(models.map((m) => m.id).sort()).toEqual([
      'deepseek-ai/deepseek-v4.1-flash',
      'google/diffusiongemma-26b-a4b-it',
      'meta/llama-3.2-11b-vision-instruct',
      'mistralai/mixtral-8x22b-v0.1',
      'moonshotai/kimi-k3',
      'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning',
      'nvidia/nemotron-3.5-lightning-30b-a3b',
      'openai/gpt-oss-20b',
    ]);
  });
  it('names each model and its maker, marks the image-in ones, and reports no context it was not given', () => {
    expect(models.find((m) => m.id === 'meta/llama-3.2-11b-vision-instruct')).toEqual({
      id: 'meta/llama-3.2-11b-vision-instruct',
      name: 'Llama 3.2 11B Vision Instruct',
      maker: 'Meta',
      context: null,
      vision: true,
    });
    expect(models.find((m) => m.id === 'openai/gpt-oss-20b')).toMatchObject({ name: 'GPT-OSS 20B', maker: 'OpenAI', vision: false });
    expect(models.find((m) => m.id.includes('nano-omni'))?.vision).toBe(true);
  });
});

describe('OpenRouter catalogue filter', () => {
  const models = parseOpenRouterCatalog(OPENROUTER_LIST, Date.parse('2026-10-06'));
  it('keeps only zero-priced, text-out chat models — no router, music, safety, expired or web-browsing rows', () => {
    expect(models.map((m) => m.id).sort()).toEqual(['google/gemma-4-26b-a4b-it:free', 'inclusionai/ling-3.1-flash', 'meta-llama/llama-3.3-70b-instruct:free']);
  });
  it('uses the published name without "(free)" or the maker prefix, and reads context and image input', () => {
    expect(models.find((m) => m.id === 'meta-llama/llama-3.3-70b-instruct:free')).toEqual({
      id: 'meta-llama/llama-3.3-70b-instruct:free',
      name: 'Llama 3.3 70B Instruct',
      maker: 'Meta',
      context: 131072,
      vision: false,
    });
    expect(models.find((m) => m.id === 'google/gemma-4-26b-a4b-it:free')).toMatchObject({ name: 'Gemma 4 26B A4B', maker: 'Google', vision: true });
  });
  it('an unknown price is never assumed free', () => {
    expect(parseOpenRouterCatalog({ data: [{ id: 'vendor/unknown-price', name: 'Vendor: X' }] })).toEqual([]);
  });
});

describe('Groq catalogue filter', () => {
  const models = parseGroqCatalog(GROQ_LIST);
  it('drops compound systems, speech, transcription, guards and retired rows', () => {
    expect(models.map((m) => m.id).sort()).toEqual([
      'allam-2-7b',
      'llama-3.1-8b-instant',
      'meta-llama/llama-4-scout-17b-16e-instruct',
      'openai/gpt-oss-120b',
      'openai/gpt-oss-20b',
      'qwen/qwen3-32b',
    ]);
  });
  it('names, makers, context and the image-in Llama 4 model', () => {
    expect(models.find((m) => m.id === 'llama-3.1-8b-instant')).toEqual({ id: 'llama-3.1-8b-instant', name: 'Llama 3.1 8B Instant', maker: 'Meta', context: 131072, vision: false });
    expect(models.find((m) => m.id === 'allam-2-7b')).toMatchObject({ name: 'ALLaM 2 7B', maker: 'SDAIA' });
    expect(models.find((m) => m.id.includes('llama-4-scout'))?.vision).toBe(true);
  });
});

describe('Gemini catalogue filter', () => {
  const models = parseGeminiCatalog(GEMINI_LIST);
  it('keeps the generateContent text engines and drops embedding, AQA, image, video, speech, live, robotics, computer-use and deep-research models', () => {
    expect(models.map((m) => m.id).sort()).toEqual(['gemini-2.5-pro', 'gemini-3.8-flash', 'gemma-3-27b-it']);
  });
  it('uses displayName and the input limit; Gemini models read images', () => {
    expect(models.find((m) => m.id === 'gemini-3.8-flash')).toEqual({ id: 'gemini-3.8-flash', name: 'Gemini 3.8 Flash', maker: 'Google', context: 1048576, vision: true });
    expect(models.find((m) => m.id === 'gemma-3-27b-it')).toMatchObject({ name: 'Gemma 3 27B', vision: false });
  });
  it('accepts the OpenAI-compatible list as a fallback shape', () => {
    expect(parseGeminiCatalog({ data: [{ id: 'models/gemini-3.8-flash' }, { id: 'gemini-embedding-001' }] }).map((m) => [m.id, m.name])).toEqual([['gemini-3.8-flash', 'Gemini 3.8 Flash']]);
  });
});

describe('parseCatalog', () => {
  it('returns an empty list for a malformed body instead of guessing, on every provider', () => {
    for (const p of ['nvidia', 'openrouter', 'groq', 'gemini'] as const) {
      expect(parseCatalog(p, null)).toEqual([]);
      expect(parseCatalog(p, { data: 'nope', models: 'nope' })).toEqual([]);
    }
  });
});

/**
 * 10.2 — VinaX AI has no live web access, so catalogue systems that browse the
 * web on their own are never offered, prefixed or bare, on any key.
 */
describe('web-browsing systems are excluded', () => {
  it('drops the listed systems, prefixed or bare, and keeps look-alike names', () => {
    const models = parseGroqCatalog({
      data: [{ id: 'vendor/compound' }, { id: 'compound-mini' }, { id: 'vendor/plain-20b' }, { id: 'vendor/compound-pro' }],
    });
    expect(models.map((m) => m.id).sort()).toEqual(['vendor/compound-pro', 'vendor/plain-20b']);
    expect(isWebBrowsingModel('groq', 'COMPOUND')).toBe(true);
    expect(isWebBrowsingModel('openrouter', 'compound')).toBe(false);
    expect(WEB_BROWSING_SLUGS.groq.length).toBeGreaterThan(0);
  });
  it('drops :online variants, the sonar family, search systems and deep research on every provider', () => {
    for (const p of ['nvidia', 'openrouter', 'groq', 'gemini'] as const) {
      expect(isWebBrowsingModel(p, 'meta-llama/llama-3.3-70b-instruct:online')).toBe(true);
      expect(isWebBrowsingModel(p, 'vendor/sonar')).toBe(true);
      expect(isWebBrowsingModel(p, 'vendor/x-search-preview')).toBe(true);
      expect(isWebBrowsingModel(p, 'deep-research-pro-preview')).toBe(true);
      expect(isWebBrowsingModel(p, 'meta-llama/llama-3.3-70b-instruct')).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// Live lists
// ---------------------------------------------------------------------------

/** A provider stub: answers each provider's list URL with its fixture. */
function stubProviders(over: Partial<Record<'nvidia' | 'openrouter' | 'groq' | 'gemini', () => Response>> = {}): Array<{ url: string; headers: Record<string, string> }> {
  const seen: Array<{ url: string; headers: Record<string, string> }> = [];
  const json = (b: unknown): Response => new Response(JSON.stringify(b), { status: 200 });
  vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
    seen.push({ url: String(url), headers: (init?.headers ?? {}) as Record<string, string> });
    const u = String(url);
    if (u.includes('integrate.api.nvidia.com')) return Promise.resolve(over.nvidia?.() ?? json(NVIDIA_LIST));
    if (u.includes('openrouter.ai')) return Promise.resolve(over.openrouter?.() ?? json(OPENROUTER_LIST));
    if (u.includes('api.groq.com')) return Promise.resolve(over.groq?.() ?? json(GROQ_LIST));
    if (u.includes('generativelanguage')) return Promise.resolve(over.gemini?.() ?? json(GEMINI_LIST));
    return Promise.resolve(new Response('nope', { status: 404 }));
  }));
  return seen;
}
const ALL_KEYS = { VINAX_NVIDIA_API_KEY: 'nv', VINAX_OPENROUTER_API_KEY: 'or', VINAX_GROQ_API_KEY: 'gq', VINAX_GGL_GEMINI_API_KEY: 'gm' };

describe('fetchCatalog', () => {
  it('asks each provider\'s own list with its single key', async () => {
    const seen = stubProviders();
    for (const p of ['nvidia', 'openrouter', 'groq', 'gemini'] as const) expect((await fetchCatalog(ALL_KEYS, p)).length).toBeGreaterThan(0);
    expect(seen.find((s) => s.url === 'https://integrate.api.nvidia.com/v1/models')?.headers.authorization).toBe('Bearer nv');
    // 10.3 — every output modality, so the media models are listed too.
    expect(seen.find((s) => s.url === 'https://openrouter.ai/api/v1/models?output_modalities=all')?.headers.authorization).toBe('Bearer or');
    expect(seen.find((s) => s.url === 'https://api.groq.com/openai/v1/models')?.headers.authorization).toBe('Bearer gq');
    expect(seen.find((s) => s.url.startsWith('https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000'))?.headers['x-goog-api-key']).toBe('gm');
  });

  it('returns nothing when the key is not configured — and makes no call, even for the public NVIDIA list', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    for (const p of ['nvidia', 'openrouter', 'groq', 'gemini'] as const) expect(await fetchCatalog({}, p)).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('caches per isolate so a picker repaint does not re-hit the provider', async () => {
    const seen = stubProviders();
    expect(await fetchCatalog(ALL_KEYS, 'groq')).toHaveLength(6);
    expect(await fetchCatalog(ALL_KEYS, 'grq')).toHaveLength(6); // the old id, same cache
    expect(seen).toHaveLength(1);
  });

  it('reports an unreachable provider as an empty menu, never a stale invention', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('network'))));
    expect(await fetchCatalog(ALL_KEYS, 'nvidia')).toEqual([]);
  });

  it('Gemini falls back to the OpenAI-compatible list when the native one refuses the key', async () => {
    let n = 0;
    stubProviders({ gemini: () => (++n === 1 ? new Response('denied', { status: 403 }) : new Response(JSON.stringify({ data: [{ id: 'models/gemini-3.8-flash' }] }), { status: 200 })) });
    expect((await fetchCatalog(ALL_KEYS, 'gemini')).map((m) => m.id)).toEqual(['gemini-3.8-flash']);
  });

  it('honours NVIDIA_BASE_URL for the list too', () => {
    expect(nvidiaModelsUrl({ NVIDIA_BASE_URL: 'https://proxy.example/v1/chat/completions' })).toBe('https://proxy.example/v1/models');
    expect(nvidiaModelsUrl({})).toBe('https://integrate.api.nvidia.com/v1/models');
  });

  it('10.3 — a Gemini model that answers 429 with a free-tier limit of 0 leaves the list for a day', async () => {
    stubProviders();
    expect((await fetchCatalog(ALL_KEYS, 'gemini')).map((m) => m.id)).toContain('gemini-2.5-pro');
    const body = '{"error":{"code":429,"message":"You exceeded your current quota. * Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests, limit: 0, model: gemini-2.5-pro"}}';
    expect(noteLaneFailure('maestro', 'gemini-2.5-pro', 429, body)).toMatchObject({ reason: 'not_free', ms: 24 * 3600_000 });
    expect((await fetchCatalog(ALL_KEYS, 'gemini')).map((m) => m.id)).not.toContain('gemini-2.5-pro');
    expect(await findCatalogModel(ALL_KEYS, 'gemini', 'gemini-2.5-pro')).toBeNull();
    // An ordinary quota answer is a rest, not "not free": the model stays listed.
    noteLaneFailure('maestro', 'gemini-3.8-flash', 429, '{"error":{"message":"Resource exhausted"}}');
    expect((await fetchCatalog(ALL_KEYS, 'gemini')).map((m) => m.id)).toContain('gemini-3.8-flash');
  });
});

describe('catalogDefaultModel', () => {
  const stub = (ids: string[], provider: 'groq' | 'openrouter'): void => {
    const data = ids.map((id) => (provider === 'openrouter' ? { id, pricing: FREE } : { id }));
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(JSON.stringify({ data }), { status: 200 }))));
  };

  it('takes the preferred engine when the catalogue offers one', async () => {
    stub(['allam-2-7b', 'openai/gpt-oss-120b', 'openai/gpt-oss-20b'], 'groq');
    expect(await catalogDefaultModel({ VINAX_GROQ_API_KEY: 'k' }, 'groq')).toBe('openai/gpt-oss-20b');
  });

  it('falls back to whatever the catalogue does offer rather than a guess', async () => {
    stub(['some/unheard-of-engine'], 'groq');
    expect(await catalogDefaultModel({ VINAX_GROQ_API_KEY: 'k' }, 'groq')).toBe('some/unheard-of-engine');
  });

  it('matches a preference as a substring, so a re-published slug still resolves', async () => {
    stub(['vendor/x:free', 'nvidia/nemotron-3-super-120b-a12b:free'], 'openrouter');
    expect(await catalogDefaultModel({ VINAX_OPENROUTER_API_KEY: 'k' }, 'opr')).toBe('nvidia/nemotron-3-super-120b-a12b:free');
  });

  it('returns null — never a guessed slug — when the provider offers nothing', async () => {
    stub([], 'groq');
    expect(await catalogDefaultModel({ VINAX_GROQ_API_KEY: 'k' }, 'groq')).toBeNull();
    expect(await catalogDefaultModel({}, 'openrouter')).toBeNull();
  });
});

describe('findCatalogModel / resolveCatalogModel', () => {
  it('passes through a slug the provider currently lists as free, with its entry', async () => {
    stubProviders();
    expect(await resolveCatalogModel(ALL_KEYS, 'openrouter', 'inclusionai/ling-3.1-flash')).toBe('inclusionai/ling-3.1-flash');
    expect(await findCatalogModel(ALL_KEYS, 'nvidia', 'meta/llama-3.2-11b-vision-instruct')).toMatchObject({ vision: true, maker: 'Meta' });
  });

  it('refuses a paid, unknown, wrong-provider or malformed slug so it can never reach a key', async () => {
    stubProviders();
    expect(await resolveCatalogModel(ALL_KEYS, 'openrouter', 'meta-llama/llama-3.3-70b-instruct')).toBeNull();
    expect(await resolveCatalogModel(ALL_KEYS, 'openrouter', 'vendor/made-up')).toBeNull();
    expect(await resolveCatalogModel(ALL_KEYS, 'groq', 'meta/llama-3.2-11b-vision-instruct')).toBeNull();
    expect(await resolveCatalogModel(ALL_KEYS, 'openrouter', 'not a slug!')).toBeNull();
    expect(await resolveCatalogModel(ALL_KEYS, 'openrouter', '')).toBeNull();
    expect(await resolveCatalogModel(ALL_KEYS, 'openrouter', null)).toBeNull();
    expect(await findCatalogModel(ALL_KEYS, 'nowhere', 'openai/gpt-oss-20b')).toBeNull();
  });

  it('describeModel uses the cached entry, else the slug read back faithfully', async () => {
    expect(describeModel('openrouter', 'meta-llama/llama-3.3-70b-instruct:free')).toEqual({ name: 'Llama 3.3 70B Instruct', maker: 'Meta' });
    stubProviders();
    await fetchCatalog(ALL_KEYS, 'openrouter');
    expect(describeModel('openrouter', 'inclusionai/ling-3.1-flash')).toEqual({ name: 'Ling 3.1 Flash', maker: 'inclusionAI' });
    expect(describeModel('gemini', 'gemini-3.8-flash')).toEqual({ name: 'Gemini 3.8 Flash', maker: 'Google' });
  });
});

// ---------------------------------------------------------------------------
// GET /api/aimodels
// ---------------------------------------------------------------------------

async function getModels(env: Record<string, unknown>): Promise<{ status: number; headers: Headers; body: { fetchedAt: string; providers: Array<{ id: string; label: string; configured: boolean; models: Array<Record<string, unknown>> }> } }> {
  const res = await aiModelsGet({ request: new Request('https://x.test/api/aimodels', { headers: { 'cf-connecting-ip': `10.9.0.${Math.floor(Math.random() * 250)}` } }), env });
  return { status: res.status, headers: res.headers, body: (await res.json()) as never };
}

describe('GET /api/aimodels — the four-provider menu', () => {
  it('always lists the four providers, in order, with label, configured and model rows of exactly five fields', async () => {
    stubProviders();
    // 11.2 — with the AI binding present the fifth provider is configured too.
    const { status, headers, body } = await getModels({ ...ALL_KEYS, AI: { run: async () => ({ response: '' }) } });
    expect(status).toBe(200);
    expect(headers.get('cache-control')).toBe('public, max-age=300, stale-while-revalidate=900');
    expect(headers.get('access-control-allow-origin')).toBe('*');
    expect(typeof body.fetchedAt).toBe('string');
    expect(body).not.toHaveProperty('groups');
    expect(body.providers.map((p) => [p.id, p.label, p.configured])).toEqual([
      ['nvidia', 'NVIDIA', true],
      ['openrouter', 'OpenRouter', true],
      ['groq', 'Groq', true],
      ['gemini', 'Gemini', true],
      ['cloudflare', 'Cloudflare', true],
    ]);
    for (const p of body.providers) {
      expect(p.models.length).toBeGreaterThan(0);
      for (const m of p.models) expect(Object.keys(m).sort()).toEqual(['context', 'id', 'maker', 'name', 'vision']);
    }
    expect(body.providers[1].models.find((m) => m.id === 'meta-llama/llama-3.3-70b-instruct:free')).toEqual({
      id: 'meta-llama/llama-3.3-70b-instruct:free',
      name: 'Llama 3.3 70B Instruct',
      maker: 'Meta',
      context: 131072,
      vision: false,
    });
  });

  it('a missing key is an empty, unconfigured provider — still listed, never invented', async () => {
    stubProviders();
    const { body } = await getModels({ VINAX_GROQ_API_KEY: 'gq' });
    expect(body.providers.map((p) => [p.id, p.configured, p.models.length > 0])).toEqual([
      ['nvidia', false, false],
      ['openrouter', false, false],
      ['groq', true, true],
      ['gemini', false, false],
      ['cloudflare', false, false],
    ]);
  });

  it('never lists a web-browsing system and carries no agent flag', async () => {
    stubProviders();
    const { body } = await getModels(ALL_KEYS);
    const ids = body.providers.flatMap((p) => p.models.map((m) => String(m.id)));
    for (const gone of ['groq/compound', 'groq/compound-mini', 'meta-llama/llama-3.3-70b-instruct:online', 'vendor/sonar-pro', 'relace/relace-search', 'deep-research-pro-preview-12-2025']) expect(ids).not.toContain(gone);
    for (const m of body.providers.flatMap((p) => p.models)) expect(m).not.toHaveProperty('agent');
  });
});

// ---------------------------------------------------------------------------
// Voices (Groq)
// ---------------------------------------------------------------------------

// The voice picker is the one place TTS models belong — and the one place a
// chat model must never appear, because posting text at it returns an error
// instead of audio.
describe('voice catalog', () => {
  const stub = (ids: string[]): void => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response(JSON.stringify({ data: ids.map((id) => ({ id })) }), { status: 200 }))),
    );
  };

  it('keeps the speech models and drops everything that cannot speak', async () => {
    stub([
      'canopylabs/orpheus-v1-english',
      'canopylabs/orpheus-v1-arabic-saudi',
      'playai-tts',
      'openai/gpt-oss-20b',
      'qwen/qwen3.8-27b',
      'whisper-large-v3',
      'meta-llama/llama-prompt-guard-2-22m',
    ]);
    const models = await fetchVoiceCatalog({ VINAX_GROQ_API_KEY: 'k' }, 'groq');
    expect(models.map((m) => m.id)).toEqual([
      'canopylabs/orpheus-v1-arabic-saudi',
      'canopylabs/orpheus-v1-english',
      'playai-tts',
    ]);
    expect(models[0]).toMatchObject({ provider: 'groq', context: null });
  });

  it('is empty without a key, and makes no call', async () => {
    const f = vi.fn();
    vi.stubGlobal('fetch', f);
    expect(await fetchVoiceCatalog({}, 'groq')).toEqual([]);
    expect(f).not.toHaveBeenCalled();
  });

  it('reports an unreachable provider as no voices, never a guess', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('network'))));
    expect(await fetchVoiceCatalog({ VINAX_GROQ_API_KEY: 'k' }, 'groq')).toEqual([]);
  });

  it('only the Groq key serves speech', async () => {
    const f = vi.fn();
    vi.stubGlobal('fetch', f);
    expect(await fetchVoiceCatalog({ VINAX_NVIDIA_API_KEY: 'k' }, 'nvidia')).toEqual([]);
    expect(f).not.toHaveBeenCalled();
  });
});

describe('isServedVoiceModel', () => {
  const env = { VINAX_GROQ_API_KEY: 'k' };
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(new Response(JSON.stringify({ data: [{ id: 'canopylabs/orpheus-v1-english' }] }), { status: 200 })),
      ),
    );
  });

  it('accepts a slug the key currently serves', async () => {
    expect(await isServedVoiceModel(env, 'groq', 'canopylabs/orpheus-v1-english')).toBe(true);
  });

  it('refuses a retired, unknown or malformed slug so it never reaches the provider', async () => {
    expect(await isServedVoiceModel(env, 'groq', 'canopylabs/orpheus-v2')).toBe(false);
    expect(await isServedVoiceModel(env, 'groq', 'openai/gpt-oss-20b')).toBe(false);
    expect(await isServedVoiceModel(env, 'groq', 'not a slug!')).toBe(false);
    expect(await isServedVoiceModel(env, 'groq', '')).toBe(false);
  });
});
