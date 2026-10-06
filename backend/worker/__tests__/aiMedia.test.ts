/**
 * 10.3 — every free model TYPE on the four provider keys: the media filters
 * (image, speech, transcription, music, embeddings), the free non-web tools
 * (code execution), the additive /api/aimodels shape, the media routes
 * (/api/image, /api/tts, /api/voices, /api/transcribe, /api/music), code
 * execution in /api/vinaxai, the embedding engines drawn from the free lists,
 * and the rule that no web tool is ever sent.
 *
 * The OpenRouter and NVIDIA rows are real rows from the providers' public
 * lists (2026-10-06), trimmed to the fields the parsers read; the one marked
 * HYPOTHETICAL is the shape a free music variant would take (none was free
 * that day). Upstreams are mocked: no network.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  GEMINI_VOICES,
  NVIDIA_IMAGE_MODELS,
  codeExecutionModels,
  fetchMedia,
  isFreeMediaPricing,
  parseGeminiMedia,
  parseGroqMedia,
  parseNvidiaMedia,
  parseOpenRouterMedia,
  resetCatalogCache,
} from '../functions/_lib/catalog';
import { clearLaneCooldowns, noteProviderFailure, resetAiControlsCache } from '../functions/_lib/ai';
import { pcmToWav } from '../functions/_lib/media';
import { embedTexts, resetEmbedCooldowns } from '../functions/_lib/embed';
import { resetMaestroMode, resetMaestroModels } from '../functions/_lib/maestro';
import { onRequestGet as aiModelsGet } from '../functions/api/aimodels';
import { onRequestPost as imagePost } from '../functions/api/image';
import { onRequestPost as ttsPost } from '../functions/api/tts';
import { onRequestGet as voicesGet } from '../functions/api/voices';
import { onRequestPost as transcribePost } from '../functions/api/transcribe';
import { onRequestPost as musicPost } from '../functions/api/music';
import { attemptRunsCode, executedToolsText, onRequestPost as vinaxaiPost, requestTools } from '../functions/api/vinaxai';
import { onRequestPost as ailabPost } from '../functions/api/admin/ailab';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const NVIDIA_LIST = {
  data: [
    'openai/gpt-oss-20b',
    'meta/llama-3.2-11b-vision-instruct',
    'nvidia/llama-3.2-nv-embedqa-1b-v1',
    'nvidia/nemotron-3-embed-1b',
    'nvidia/llama-3.2-nemoretriever-1b-vlm-embed-v1',
    'snowflake/arctic-embed-l',
    'nvidia/nvclip',
    'nvidia/nemotron-parse-2.0',
  ].map((id) => ({ id, object: 'model', owned_by: id.split('/')[0] })),
};

const Z = { prompt: '0', completion: '0' };
const OPENROUTER_LIST = {
  data: [
    { id: 'inclusionai/ling-3.1-flash', name: 'inclusionAI: Ling 3.1 Flash', pricing: Z, architecture: { input_modalities: ['text'], output_modalities: ['text'] } },
    // Free text-to-image: every price zero, the image output price listed as zero.
    { id: 'inclusionai/ming-image-0.1-design', name: 'inclusionAI: Ming Image 0.1 Design', description: 'Ming Image 0.1 Design is a text-to-image model from inclusionAI aimed at graphic-design output…', pricing: { ...Z, image_token: '0', image_output: '0' }, architecture: { input_modalities: ['text'], output_modalities: ['image'] } },
    // Free, but image-to-image only (needs a picture to start from).
    { id: 'inclusionai/ming-image-0.1-design-layer', name: 'inclusionAI: Ming Image 0.1 Design Layer', description: 'Ming Image 0.1 Design Layer is an image-to-image model from inclusionAI that decomposes a flattened design image…', pricing: { ...Z, image_token: '0', image_output: '0' }, architecture: { input_modalities: ['text', 'image'], output_modalities: ['image'] } },
    // Zero per token, billed per image.
    { id: 'tencent/hy-image-v3.5-preview', name: 'Tencent: Hy Image 3.5 Preview', pricing: { ...Z, image_token: '0.0000016', image_output: '0.0000016' }, architecture: { input_modalities: ['text', 'image'], output_modalities: ['image'] } },
    // Zero per token, billed per clip in a field the list leaves out.
    { id: 'google/lyria-3-clip-preview', name: 'Google: Lyria 3 Clip Preview', description: '30 second duration clips are priced at $0.04 per clip. Lyria 3 is Google\'s family of music generation models…', pricing: Z, architecture: { input_modalities: ['text', 'image'], output_modalities: ['text', 'audio'] } },
    // HYPOTHETICAL — a free music variant, the shape OpenRouter gives its free models.
    { id: 'google/lyria-3-clip-preview:free', name: 'Google: Lyria 3 Clip Preview (free)', description: 'Lyria 3 is Google\'s family of music generation models.', pricing: Z, architecture: { input_modalities: ['text'], output_modalities: ['text', 'audio'] } },
    { id: 'openai/gpt-audio-mini', name: 'OpenAI: GPT Audio Mini', pricing: { prompt: '0.0000006', completion: '0.0000024' }, architecture: { input_modalities: ['text', 'audio'], output_modalities: ['text', 'audio'] } },
    { id: 'google/veo-3.1-lite', name: 'Google: Veo 3.1 Lite', pricing: Z, architecture: { input_modalities: ['text'], output_modalities: ['video'] } },
    { id: 'fish-audio/s2.1-pro-free:free', name: 'Fish Audio: S2.1 Pro Free (free)', pricing: Z, supported_voices: null, architecture: { input_modalities: ['text'], output_modalities: ['speech'] } },
    { id: 'microsoft/mai-voice-2-flash', name: 'Microsoft: MAI Voice 2 Flash', pricing: { prompt: '0.000015', completion: '0' }, supported_voices: ['en-US-Harper:MAI-Voice-2'], architecture: { input_modalities: ['text'], output_modalities: ['speech'] } },
    { id: 'openai/whisper-large-v3', name: 'OpenAI: Whisper Large V3', pricing: { prompt: '0.0000075', completion: '0' }, architecture: { input_modalities: ['audio'], output_modalities: ['transcription'] } },
    { id: 'liquid/lfm-2.5-embedding-350m:free', name: 'LiquidAI: LFM2.5-Embedding-350M (free)', pricing: Z, architecture: { input_modalities: ['text'], output_modalities: ['embeddings'] } },
    { id: 'voyageai/voyage-4-lite', name: 'Voyage: Voyage 4 Lite', pricing: { prompt: '0.00000002', completion: '0' }, architecture: { input_modalities: ['text'], output_modalities: ['embeddings'] } },
    { id: 'voyageai/rerank-3-lite', name: 'Voyage: Rerank 3 Lite', pricing: Z, architecture: { input_modalities: ['text'], output_modalities: ['rerank'] } },
  ],
};
const OPENROUTER_NO_FREE_MUSIC = { data: OPENROUTER_LIST.data.filter((r) => r.id !== 'google/lyria-3-clip-preview:free') };

const GROQ_LIST = {
  data: [
    { id: 'llama-3.1-8b-instant', owned_by: 'Meta', active: true, context_window: 131072 },
    { id: 'openai/gpt-oss-20b', owned_by: 'OpenAI', active: true, context_window: 131072 },
    { id: 'openai/gpt-oss-120b', owned_by: 'OpenAI', active: true, context_window: 131072 },
    { id: 'groq/compound', owned_by: 'Groq', active: true },
    { id: 'whisper-large-v3', owned_by: 'OpenAI', active: true },
    { id: 'whisper-large-v3-turbo', owned_by: 'OpenAI', active: true },
    { id: 'canopylabs/orpheus-v1-english', owned_by: 'Canopy Labs', active: true },
    { id: 'canopylabs/orpheus-arabic-saudi', owned_by: 'Canopy Labs', active: true },
    { id: 'playai-tts', owned_by: 'PlayAI', active: true },
    { id: 'meta-llama/llama-prompt-guard-2-86m', owned_by: 'Meta', active: true },
  ],
};

const gm = (name: string, displayName: string, methods = ['generateContent', 'countTokens']) => ({ name: `models/${name}`, displayName, inputTokenLimit: 1048576, supportedGenerationMethods: methods });
const GEMINI_LIST = {
  models: [
    gm('gemini-3.8-flash', 'Gemini 3.8 Flash'),
    gm('gemini-3.5-flash', 'Gemini 3.5 Flash'),
    gm('gemini-3.5-flash-lite', 'Gemini 3.5 Flash-Lite'),
    gm('gemini-3.1-flash-lite', 'Gemini 3.1 Flash-Lite'),
    gm('gemini-2.5-pro', 'Gemini 2.5 Pro'),
    gm('gemma-3-27b-it', 'Gemma 3 27B'),
    gm('gemini-embedding-001', 'Gemini Embedding 001', ['embedContent', 'countTextTokens']),
    gm('gemini-embedding-2', 'Gemini Embedding 2', ['embedContent', 'countTextTokens']),
    gm('gemini-3.8-flash-tts', 'Gemini 3.8 Flash TTS', ['generateContent']),
    gm('gemini-2.5-pro-preview-tts', 'Gemini 2.5 Pro Preview TTS', ['generateContent']),
    gm('gemini-3.1-flash-image', 'Gemini 3.1 Flash Image', ['generateContent']),
    gm('imagen-4.0-generate-001', 'Imagen 4', ['predict']),
    gm('lyria-3.5', 'Lyria 3.5', ['generateContent']),
    gm('gemini-3.8-live', 'Gemini 3.8 Live', ['bidiGenerateContent']),
    gm('gemini-2.5-flash-native-audio-preview-12-2025', 'Gemini 2.5 Flash Native Audio', ['bidiGenerateContent']),
  ],
};

const ALL_KEYS = { NVIDIA_API_KEY: 'nv', OPENROUTER_API_KEY: 'or', GROQ_API_KEY: 'gq', GEMINI_API_KEY: 'AIza-gm' };
const OLD_KEYS = { VINAX_NVIDIA_API_KEY: 'nv', VINAX_OPENROUTER_API_KEY: 'or', VINAX_GROQ_API_KEY: 'gq', VINAX_GGL_GEMINI_API_KEY: 'AIza-gm' };
const DB = { SUPABASE_URL: 'https://sb.test', SUPABASE_SERVICE_ROLE_KEY: 'srk' };

// ---------------------------------------------------------------------------
// One stub for every test: lists, the config store, and provider calls
// ---------------------------------------------------------------------------

interface Call {
  url: string;
  method: string;
  body: string;
  json: Record<string, unknown> | null;
  headers: Record<string, string>;
  form: FormData | null;
}
const calls: Call[] = [];
let lists: Record<'nvidia' | 'openrouter' | 'groq' | 'gemini', unknown>;
let controls: unknown;
let provider: (c: Call) => Response | Promise<Response>;
const json = (b: unknown, status = 200): Response => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });

beforeEach(() => {
  resetCatalogCache();
  clearLaneCooldowns();
  resetAiControlsCache();
  resetEmbedCooldowns();
  resetMaestroMode();
  resetMaestroModels();
  calls.length = 0;
  lists = { nvidia: NVIDIA_LIST, openrouter: OPENROUTER_LIST, groq: GROQ_LIST, gemini: GEMINI_LIST };
  controls = undefined;
  provider = () => json({ error: 'unexpected' }, 500);
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    const method = init?.method ?? 'GET';
    if (url.startsWith('https://sb.test/rest/v1/vinax_config')) return json(controls === undefined ? [] : [{ key: 'ai-controls', value: controls }]);
    if (url.startsWith('https://sb.test/')) return json([], 201);
    if (method === 'GET') {
      if (url.startsWith('https://integrate.api.nvidia.com/v1/models')) return json(lists.nvidia);
      if (url.startsWith('https://openrouter.ai/api/v1/models')) return json(lists.openrouter);
      if (url.startsWith('https://api.groq.com/openai/v1/models')) return json(lists.groq);
      if (url.startsWith('https://generativelanguage.googleapis.com/v1beta/models?')) return json(lists.gemini);
    }
    const body = typeof init?.body === 'string' ? init.body : '';
    let parsed: Record<string, unknown> | null;
    try {
      parsed = body ? (JSON.parse(body) as Record<string, unknown>) : null;
    } catch {
      parsed = null;
    }
    const call: Call = { url, method, body, json: parsed, headers: (init?.headers ?? {}) as Record<string, string>, form: init?.body instanceof FormData ? init.body : null };
    calls.push(call);
    return provider(call);
  });
});
afterEach(() => {
  // 10.2 — no request this file makes may ever carry a web tool.
  for (const c of calls) {
    for (const web of ['google_search', 'googleSearch', 'url_context', 'urlContext', 'browser_search', ':online', '"id":"web"', 'web_search_options']) expect(c.body, `${c.url} carried ${web}`).not.toContain(web);
  }
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

let ip = 0;
const post = (path: string, body: unknown): Request => {
  ip += 1;
  return new Request(`https://x.test${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'cf-connecting-ip': `10.77.${Math.floor(ip / 250)}.${ip % 250}` },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
};
const get = (path: string): Request => {
  ip += 1;
  return new Request(`https://x.test${path}`, { headers: { 'cf-connecting-ip': `10.78.${Math.floor(ip / 250)}.${ip % 250}` } });
};
const b64 = (n: number, ch = 'A'): string => ch.repeat(n);

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

describe('media filters — each kind earns its entry', () => {
  it('NVIDIA: the text-embedding models from /v1/models; chat, parsers and the image-text clip model are not media', () => {
    const media = parseNvidiaMedia(NVIDIA_LIST);
    expect(media.map((m) => m.id).sort()).toEqual([
      'nvidia/llama-3.2-nemoretriever-1b-vlm-embed-v1',
      'nvidia/llama-3.2-nv-embedqa-1b-v1',
      'nvidia/nemotron-3-embed-1b',
      'snowflake/arctic-embed-l',
    ]);
    expect(new Set(media.map((m) => m.kind))).toEqual(new Set(['embedding']));
    expect(media.find((m) => m.id === 'snowflake/arctic-embed-l')).toMatchObject({ maker: 'Snowflake' });
  });

  it('NVIDIA: the fixed hosted image list (not on /v1/models) rides along only with the key', async () => {
    const withKey = await fetchMedia({ NVIDIA_API_KEY: 'nv' }, 'nvidia');
    expect(withKey.filter((m) => m.kind === 'image').map((m) => m.id)).toEqual(NVIDIA_IMAGE_MODELS.map((m) => m.id));
    expect(withKey.find((m) => m.id === 'black-forest-labs/flux.1-schnell')).toMatchObject({ name: 'FLUX.1 schnell', maker: 'Black Forest Labs' });
    expect(await fetchMedia({}, 'nvidia')).toEqual([]);
    expect(NVIDIA_IMAGE_MODELS.map((m) => m.id)).not.toContain('stabilityai/sdxl-turbo');
  });

  it('OpenRouter: free means every price zero AND the slug is a :free variant or the output price is listed as zero', () => {
    const media = parseOpenRouterMedia(OPENROUTER_LIST);
    expect(media.map((m) => [m.kind, m.id])).toEqual([
      ['embedding', 'liquid/lfm-2.5-embedding-350m:free'],
      ['image', 'inclusionai/ming-image-0.1-design'],
      ['music', 'google/lyria-3-clip-preview:free'],
      ['speech', 'fish-audio/s2.1-pro-free:free'],
    ]);
    expect(media.find((m) => m.kind === 'image')).toMatchObject({ name: 'Ming Image 0.1 Design', maker: 'inclusionAI' });
    expect(media.find((m) => m.kind === 'speech')).toMatchObject({ voices: [] });
    // Never: per-image billing, per-clip billing stated in the description,
    // an image-to-image-only model, paid speech/transcription/embeddings,
    // video, rerankers, or a chat model.
    const ids = media.map((m) => m.id);
    for (const no of ['tencent/hy-image-v3.5-preview', 'google/lyria-3-clip-preview', 'inclusionai/ming-image-0.1-design-layer', 'microsoft/mai-voice-2-flash', 'openai/whisper-large-v3', 'voyageai/voyage-4-lite', 'google/veo-3.1-lite', 'voyageai/rerank-3-lite', 'openai/gpt-audio-mini', 'inclusionai/ling-3.1-flash']) expect(ids).not.toContain(no);
  });

  it('isFreeMediaPricing: an unknown price is never free', () => {
    expect(isFreeMediaPricing({ id: 'a/b:free', pricing: Z }, 'speech')).toBe(true);
    expect(isFreeMediaPricing({ id: 'a/b', pricing: { ...Z, image_output: '0' } }, 'image')).toBe(true);
    expect(isFreeMediaPricing({ id: 'a/b', pricing: Z }, 'image')).toBe(false);
    expect(isFreeMediaPricing({ id: 'a/b', pricing: Z }, 'music')).toBe(false);
    expect(isFreeMediaPricing({ id: 'a/b:free', pricing: { ...Z, request: '0.01' } }, 'image')).toBe(false);
    expect(isFreeMediaPricing({ id: 'a/b:free', pricing: { prompt: 'x', completion: '0' } }, 'speech')).toBe(false);
    expect(isFreeMediaPricing({ id: 'a/b:free', pricing: Z, description: 'Clips are priced at $0.04 each.' }, 'music')).toBe(false);
    expect(isFreeMediaPricing({ id: 'a/b:free' }, 'speech')).toBe(false);
  });

  it('Groq: whisper models transcribe; speech models only with a published voice list', () => {
    const media = parseGroqMedia(GROQ_LIST);
    expect(media.map((m) => [m.kind, m.id])).toEqual([
      ['speech', 'canopylabs/orpheus-arabic-saudi'],
      ['speech', 'canopylabs/orpheus-v1-english'],
      ['transcription', 'whisper-large-v3'],
      ['transcription', 'whisper-large-v3-turbo'],
    ]);
    expect(media.find((m) => m.id === 'canopylabs/orpheus-v1-english')?.voices).toEqual(['autumn', 'diana', 'hannah', 'austin', 'daniel', 'troy']);
    expect(media.find((m) => m.id === 'canopylabs/orpheus-arabic-saudi')?.voices).toEqual(['abdullah', 'fahad', 'sultan', 'lulwa', 'noura', 'aisha']);
  });

  it('Gemini: free TTS with its 30 voices, embeddings, transcription on the newest flash pair; no image, music, live or paid TTS', () => {
    const media = parseGeminiMedia(GEMINI_LIST);
    expect(media.map((m) => [m.kind, m.id])).toEqual([
      ['embedding', 'gemini-embedding-001'],
      ['embedding', 'gemini-embedding-2'],
      ['speech', 'gemini-3.8-flash-tts'],
      ['transcription', 'gemini-3.5-flash-lite'],
      ['transcription', 'gemini-3.8-flash'],
    ]);
    expect(media.find((m) => m.kind === 'speech')?.voices).toEqual([...GEMINI_VOICES]);
    expect(GEMINI_VOICES).toHaveLength(30);
  });

  it('code execution: Gemini models (not Gemma) and Groq\'s gpt-oss models; nothing on NVIDIA or OpenRouter', () => {
    expect(codeExecutionModels('gemini', [{ id: 'gemini-3.8-flash' }, { id: 'gemma-3-27b-it' }])).toEqual(['gemini-3.8-flash']);
    expect(codeExecutionModels('groq', [{ id: 'openai/gpt-oss-20b' }, { id: 'openai/gpt-oss-safeguard-20b' }, { id: 'llama-3.1-8b-instant' }, { id: 'groq/compound' }])).toEqual(['openai/gpt-oss-20b']);
    expect(codeExecutionModels('nvidia', [{ id: 'openai/gpt-oss-20b' }])).toEqual([]);
    expect(codeExecutionModels('openrouter', [{ id: 'openai/gpt-oss-20b:free' }])).toEqual([]);
  });

  it('a media model that answers 429 with a free-tier limit of 0 leaves the media list for a day', async () => {
    expect((await fetchMedia(ALL_KEYS, 'gemini')).map((m) => m.id)).toContain('gemini-3.8-flash-tts');
    noteProviderFailure('gemini', 'gemini-3.8-flash-tts', 429, '{"error":{"message":"Quota exceeded for metric: generate_content_free_tier_requests, limit: 0"}}');
    expect((await fetchMedia(ALL_KEYS, 'gemini')).map((m) => m.id)).not.toContain('gemini-3.8-flash-tts');
  });
});

// ---------------------------------------------------------------------------
// GET /api/aimodels — additive shape
// ---------------------------------------------------------------------------

describe('GET /api/aimodels — media, tools and features', () => {
  type Body = { providers: Array<{ id: string; label: string; configured: boolean; models: Array<Record<string, unknown>>; media: Array<Record<string, unknown>>; tools: Array<{ id: string; name: string; models: string[] }> }>; features: Record<string, boolean> };
  const load = async (env: Record<string, string>): Promise<Body> => (await (await aiModelsGet({ request: get('/api/aimodels'), env })).json()) as Body;

  it('keeps every chat field and adds media and tools per provider, plus top-level features', async () => {
    const body = await load(ALL_KEYS);
    expect(Object.keys(body).sort()).toEqual(['features', 'fetchedAt', 'providers']);
    expect(body.features).toEqual({ image: true, speech: true, transcription: true, music: true, code: true });
    for (const p of body.providers) {
      expect(Object.keys(p).sort()).toEqual(['configured', 'id', 'label', 'media', 'models', 'tools']);
      for (const m of p.models) expect(Object.keys(m).sort()).toEqual(['context', 'id', 'maker', 'name', 'vision']);
      for (const m of p.media) {
        expect(['image', 'speech', 'transcription', 'music', 'embedding']).toContain(m.kind);
        expect(Object.keys(m).sort()).toEqual(m.kind === 'speech' ? ['id', 'kind', 'maker', 'name', 'voices'] : ['id', 'kind', 'maker', 'name']);
      }
    }
    const groq = body.providers.find((p) => p.id === 'groq')!;
    expect(groq.tools).toEqual([{ id: 'code_execution', name: 'Code execution', models: ['openai/gpt-oss-120b', 'openai/gpt-oss-20b'] }]);
    expect(groq.media.find((m) => m.id === 'canopylabs/orpheus-v1-english')).toEqual({ id: 'canopylabs/orpheus-v1-english', name: 'Orpheus v1 English', maker: 'Canopy Labs', kind: 'speech', voices: ['autumn', 'diana', 'hannah', 'austin', 'daniel', 'troy'] });
    const gemini = body.providers.find((p) => p.id === 'gemini')!;
    expect(gemini.tools[0].models).toContain('gemini-3.8-flash');
    expect(gemini.tools[0].models).not.toContain('gemma-3-27b-it');
    expect(body.providers.find((p) => p.id === 'nvidia')!.tools).toEqual([]);
    expect(body.providers.find((p) => p.id === 'openrouter')!.tools).toEqual([]);
  });

  it('a missing key is an empty provider; features are false when nobody offers the kind', async () => {
    const none = await load({});
    expect(none.features).toEqual({ image: false, speech: false, transcription: false, music: false, code: false });
    for (const p of none.providers) expect([p.configured, p.models, p.media, p.tools]).toEqual([false, [], [], []]);
    lists.openrouter = OPENROUTER_NO_FREE_MUSIC;
    const groqOnly = await load({ GROQ_API_KEY: 'gq' });
    expect(groqOnly.features).toEqual({ image: false, speech: true, transcription: true, music: false, code: true });
  });

  it('reads the keys under their primary names and, during the switch, their previous names', async () => {
    expect((await load(ALL_KEYS)).providers.map((p) => p.configured)).toEqual([true, true, true, true]);
    resetCatalogCache();
    expect((await load(OLD_KEYS)).providers.map((p) => p.configured)).toEqual([true, true, true, true]);
    expect(calls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// POST /api/image
// ---------------------------------------------------------------------------

describe('POST /api/image', () => {
  type ImageBody = { image?: string; model?: string; modelId?: string; provider?: string; error?: string; reason?: string };
  const run = async (body: unknown, env: Record<string, string> = ALL_KEYS): Promise<{ status: number; body: ImageBody }> => {
    const res = await imagePost({ request: post('/api/image', body), env });
    return { status: res.status, body: (await res.json()) as ImageBody };
  };

  it('no pick: the first free image model available — NVIDIA FLUX.1 schnell — answers a data URL with its name', async () => {
    provider = () => json({ artifacts: [{ base64: b64(200), finishReason: 'SUCCESS', seed: 7 }] });
    const { status, body } = await run({ prompt: 'a sitar on a rooftop at dusk' });
    expect(status).toBe(200);
    expect(body).toEqual({ image: `data:image/jpeg;base64,${b64(200)}`, model: 'FLUX.1 schnell', modelId: 'black-forest-labs/flux.1-schnell', provider: 'nvidia' });
    expect(calls[0].url).toBe('https://ai.api.nvidia.com/v1/genai/black-forest-labs/flux.1-schnell');
    expect(calls[0].headers.authorization).toBe('Bearer nv');
    expect(calls[0].json).toMatchObject({ prompt: 'a sitar on a rooftop at dusk', mode: 'base', steps: 4, cfg_scale: 0, width: 1024, height: 1024 });
  });

  it('no pick: a failing model hands over to the next free one', async () => {
    provider = (c) => (c.url.endsWith('flux.1-schnell') ? json({ detail: 'down' }, 500) : json({ artifacts: [{ base64: b64(120), finishReason: 'SUCCESS', seed: 1 }] }));
    const { status, body } = await run({ prompt: 'a veena in the rain' });
    expect(status).toBe(200);
    expect(body.modelId).toBe('black-forest-labs/flux.2-klein-4b');
    expect(calls[1].json).toMatchObject({ mode: 'Image Generation', steps: 4 });
  });

  it('an exact OpenRouter pick runs on its dedicated images endpoint, alone', async () => {
    provider = () => json({ created: 1, data: [{ b64_json: b64(150, 'B'), media_type: 'image/png' }] });
    const { status, body } = await run({ prompt: 'album cover, monsoon', provider: 'openrouter', model: 'inclusionai/ming-image-0.1-design' });
    expect(status).toBe(200);
    expect(body).toEqual({ image: `data:image/png;base64,${b64(150, 'B')}`, model: 'Ming Image 0.1 Design', modelId: 'inclusionai/ming-image-0.1-design', provider: 'openrouter' });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://openrouter.ai/api/v1/images');
    expect(calls[0].json).toEqual({ model: 'inclusionai/ming-image-0.1-design', prompt: 'album cover, monsoon', n: 1 });
  });

  it('a pick that is not on the live free list is refused, never forwarded', async () => {
    for (const pick of [
      { provider: 'openrouter', model: 'tencent/hy-image-v3.5-preview' },
      { provider: 'nvidia', model: 'stabilityai/sdxl-turbo' },
      { model: 'made/up' },
      { provider: 'nowhere', model: 'black-forest-labs/flux.1-schnell' },
      { provider: 'groq' },
    ]) {
      const { status, body } = await run({ prompt: 'a cat', ...pick });
      expect(status, JSON.stringify(pick)).toBe(400);
      expect(body.error).toBe('unknown_model');
    }
    expect(calls).toHaveLength(0);
  });

  it('not configured: no key, or no free image model on the keys that are set', async () => {
    expect(await run({ prompt: 'a cat' }, {})).toEqual({ status: 503, body: { error: 'not_configured', reason: 'no_key' } });
    expect(await run({ prompt: 'a cat' }, { GROQ_API_KEY: 'gq' })).toEqual({ status: 503, body: { error: 'not_configured', reason: 'no_free_model' } });
    expect(calls).toHaveLength(0);
  });

  it('the owner\'s image switch refuses it before any provider is asked', async () => {
    controls = { emergencyOff: false, features: { image: false } };
    const { status, body } = await run({ prompt: 'a cat' }, { ...ALL_KEYS, ...DB });
    expect([status, body.error]).toEqual([503, 'ai_disabled']);
    expect(calls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// /api/voices and POST /api/tts
// ---------------------------------------------------------------------------

describe('GET /api/voices', () => {
  it('keeps the old fields and adds every free speech model per provider', async () => {
    const res = await voicesGet({ request: get('/api/voices'), env: ALL_KEYS });
    const body = (await res.json()) as { configured: boolean; models: Array<{ id: string }>; personas: unknown[]; providers: Array<{ id: string; label: string; models: Array<{ id: string; name: string; voices: string[] }> }> };
    expect(body.configured).toBe(true);
    expect(body.models.map((m) => m.id)).toContain('canopylabs/orpheus-v1-english');
    expect(body.personas.length).toBe(6);
    expect(body.providers.map((p) => [p.id, p.models.map((m) => m.id)])).toEqual([
      ['nvidia', []],
      ['openrouter', ['fish-audio/s2.1-pro-free:free']],
      ['groq', ['canopylabs/orpheus-arabic-saudi', 'canopylabs/orpheus-v1-english']],
      ['gemini', ['gemini-3.8-flash-tts']],
    ]);
    expect(body.providers[3].models[0]).toMatchObject({ name: 'Gemini 3.8 Flash TTS' });
    expect(body.providers[3].models[0].voices).toHaveLength(30);
  });
});

describe('POST /api/tts', () => {
  const run = (body: unknown, env: Record<string, string> = ALL_KEYS): Promise<Response> => ttsPost({ request: post('/api/tts', body), env });

  it('without a provider: exactly today\'s behaviour (Groq, the default English voice)', async () => {
    provider = () => new Response(new Uint8Array([82, 73, 70, 70]), { status: 200, headers: { 'content-type': 'audio/wav' } });
    const res = await run({ text: 'Namaste, here is your next song.' });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('audio/wav');
    expect(calls[0].url).toBe('https://api.groq.com/openai/v1/audio/speech');
    expect(calls[0].json).toMatchObject({ model: 'canopylabs/orpheus-v1-english', voice: 'autumn', response_format: 'wav' });
  });

  it('Gemini TTS: generateContent with an AUDIO response and the named voice; the PCM comes back as WAV', async () => {
    const pcm = new Uint8Array([1, 0, 2, 0, 3, 0, 4, 0]);
    provider = () => json({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'audio/L16;codec=pcm;rate=24000', data: btoa(String.fromCharCode(...pcm)) } }] } }] });
    const res = await run({ text: 'Up next: a monsoon raga.', provider: 'gemini', model: 'gemini-3.8-flash-tts', voice: 'kore' });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('audio/wav');
    const wav = new Uint8Array(await res.arrayBuffer());
    expect(String.fromCharCode(...wav.slice(0, 4))).toBe('RIFF');
    expect(String.fromCharCode(...wav.slice(8, 12))).toBe('WAVE');
    expect(new DataView(wav.buffer).getUint32(24, true)).toBe(24000);
    expect([...wav.slice(44)]).toEqual([...pcm]);
    expect(calls[0].url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash-tts:generateContent');
    expect(calls[0].headers['x-goog-api-key']).toBe('AIza-gm');
    expect(calls[0].json).toMatchObject({ generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } } } } });
  });

  it('Groq Arabic and OpenRouter\'s free voice: each on its own endpoint; a model without listed voices sends none', async () => {
    provider = (c) => new Response(new Uint8Array([9, 9]), { status: 200, headers: { 'content-type': c.url.includes('openrouter') ? 'audio/mpeg' : 'audio/wav' } });
    expect((await run({ text: 'مرحبا', provider: 'groq', model: 'canopylabs/orpheus-arabic-saudi', voice: 'Noura' })).status).toBe(200);
    expect(calls[0].json).toMatchObject({ model: 'canopylabs/orpheus-arabic-saudi', voice: 'noura' });
    const or = await run({ text: 'Hello there.', provider: 'openrouter' });
    expect(or.status).toBe(200);
    expect(or.headers.get('content-type')).toBe('audio/mpeg');
    expect(calls[1].url).toBe('https://openrouter.ai/api/v1/audio/speech');
    expect(calls[1].json).toEqual({ model: 'fish-audio/s2.1-pro-free:free', input: 'Hello there.', response_format: 'mp3' });
  });

  it('refuses a model or voice that is not on the list; not configured without the key; off with the switch', async () => {
    expect((await run({ text: 'hi', provider: 'groq', model: 'playai-tts' })).status).toBe(400);
    expect((await run({ text: 'hi', provider: 'gemini', model: 'gemini-2.5-pro-preview-tts' })).status).toBe(400);
    const badVoice = await run({ text: 'hi', provider: 'gemini', model: 'gemini-3.8-flash-tts', voice: 'autumn' });
    expect([badVoice.status, ((await badVoice.json()) as { error: string }).error]).toEqual([400, 'unknown_voice']);
    const unset = await run({ text: 'hi', provider: 'gemini', model: 'gemini-3.8-flash-tts' }, { GROQ_API_KEY: 'gq' });
    expect([unset.status, ((await unset.json()) as { error: string }).error]).toEqual([503, 'not_configured']);
    controls = { emergencyOff: false, features: { tts: false } };
    const off = await run({ text: 'hi', provider: 'gemini', model: 'gemini-3.8-flash-tts' }, { ...ALL_KEYS, ...DB });
    expect([off.status, ((await off.json()) as { error: string }).error]).toEqual([503, 'ai_disabled']);
    expect(calls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// POST /api/transcribe
// ---------------------------------------------------------------------------

describe('POST /api/transcribe', () => {
  const audio = `data:audio/webm;codecs=opus;base64,${btoa('OggS-and-some-audio-bytes-here')}`;
  type Body = { text?: string; model?: string; modelId?: string; provider?: string; error?: string; reason?: string };
  const run = async (body: unknown, env: Record<string, string> = ALL_KEYS): Promise<{ status: number; body: Body }> => {
    const res = await transcribePost({ request: post('/api/transcribe', body), env });
    return { status: res.status, body: (await res.json()) as Body };
  };

  it('no pick: Groq whisper, as multipart with the audio file; answers the text and the model', async () => {
    provider = () => json({ text: ' play something by Ilaiyaraaja ' });
    const { status, body } = await run({ audio, language: 'en' });
    expect(status).toBe(200);
    expect(body).toEqual({ text: 'play something by Ilaiyaraaja', model: 'Whisper Large v3', modelId: 'whisper-large-v3', provider: 'groq' });
    expect(calls[0].url).toBe('https://api.groq.com/openai/v1/audio/transcriptions');
    expect(calls[0].headers.authorization).toBe('Bearer gq');
    expect(calls[0].form?.get('model')).toBe('whisper-large-v3');
    expect(calls[0].form?.get('language')).toBe('en');
    const file = calls[0].form?.get('file') as File;
    expect(file.type).toBe('audio/webm');
    expect(file.name).toBe('audio.webm');
  });

  it('a Gemini pick gets the audio inline with the transcribe instruction', async () => {
    provider = () => json({ candidates: [{ content: { parts: [{ text: 'naa peru Vinay' }] } }] });
    const { status, body } = await run({ audio: btoa('RIFF....WAVEfmt-bytes'), mime: 'audio/wav', provider: 'gemini', model: 'gemini-3.8-flash' });
    expect(status).toBe(200);
    expect(body).toEqual({ text: 'naa peru Vinay', model: 'Gemini 3.8 Flash', modelId: 'gemini-3.8-flash', provider: 'gemini' });
    expect(calls[0].url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent');
    const parts = (calls[0].json as { contents: Array<{ parts: Array<Record<string, unknown>> }> }).contents[0].parts;
    expect(String(parts[0].text)).toMatch(/^Transcribe this audio verbatim/);
    expect(parts[1]).toEqual({ inlineData: { mimeType: 'audio/wav', data: btoa('RIFF....WAVEfmt-bytes') } });
  });

  it('unknown model, bad audio, too large, not configured, switched off', async () => {
    expect(await run({ audio, provider: 'openrouter', model: 'openai/whisper-large-v3' })).toEqual({ status: 400, body: { error: 'unknown_model' } });
    expect((await run({ audio: 'not audio at all!!', mime: 'audio/wav' })).status).toBe(400);
    expect((await run({ audio: btoa('x'.repeat(40)), mime: 'text/plain' })).status).toBe(400);
    const huge = await transcribePost({ request: post('/api/transcribe', `{"audio":"${'A'.repeat(8_100_000)}","mime":"audio/wav"}`), env: ALL_KEYS });
    expect(huge.status).toBe(413);
    expect(await run({ audio }, {})).toEqual({ status: 503, body: { error: 'not_configured', reason: 'no_key' } });
    expect(await run({ audio }, { NVIDIA_API_KEY: 'nv' })).toEqual({ status: 503, body: { error: 'not_configured', reason: 'no_free_model' } });
    controls = { emergencyOff: false, features: { transcribe: false } };
    expect(await run({ audio }, { ...ALL_KEYS, ...DB })).toEqual({ status: 503, body: { error: 'ai_disabled' } });
    expect(calls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// POST /api/music
// ---------------------------------------------------------------------------

describe('POST /api/music', () => {
  type Body = { audio?: string; mime?: string; model?: string; modelId?: string; provider?: string; error?: string; reason?: string };
  const run = async (body: unknown, env: Record<string, string> = ALL_KEYS): Promise<{ status: number; body: Body }> => {
    const res = await musicPost({ request: post('/api/music', body), env });
    return { status: res.status, body: (await res.json()) as Body };
  };

  it('a free music model: chat completions with text+audio output, streamed audio chunks joined into one track', async () => {
    const part1 = new Uint8Array([0x49, 0x44, 0x33, 1, 2, 3]);
    const part2 = new Uint8Array([4, 5, 6, 7]);
    const enc = (u: Uint8Array): string => btoa(String.fromCharCode(...u));
    provider = () =>
      new Response(
        [
          `data: ${JSON.stringify({ choices: [{ delta: { audio: { data: enc(part1), transcript: '' } } }] })}`,
          `data: ${JSON.stringify({ choices: [{ delta: { audio: { data: enc(part2) } } }] })}`,
          'data: [DONE]',
          '',
        ].join('\n\n'),
        { status: 200, headers: { 'content-type': 'text/event-stream' } },
      );
    const { status, body } = await run({ prompt: 'a calm carnatic violin piece' });
    expect(status).toBe(200);
    expect(body).toEqual({ audio: `data:audio/mpeg;base64,${enc(new Uint8Array([...part1, ...part2]))}`, mime: 'audio/mpeg', model: 'Lyria 3 Clip Preview', modelId: 'google/lyria-3-clip-preview:free', provider: 'openrouter' });
    expect(calls[0].url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(calls[0].json).toMatchObject({ model: 'google/lyria-3-clip-preview:free', modalities: ['text', 'audio'], audio: { format: 'mp3' }, stream: true });
  });

  it('the per-clip-billed model is unknown; no free music model is not_configured; switched off is ai_disabled', async () => {
    expect(await run({ prompt: 'a song', provider: 'openrouter', model: 'google/lyria-3-clip-preview' })).toEqual({ status: 400, body: { error: 'unknown_model' } });
    lists.openrouter = OPENROUTER_NO_FREE_MUSIC;
    resetCatalogCache();
    expect(await run({ prompt: 'a song' })).toEqual({ status: 503, body: { error: 'not_configured', reason: 'no_free_model' } });
    expect(await run({ prompt: 'a song' }, {})).toEqual({ status: 503, body: { error: 'not_configured', reason: 'no_key' } });
    controls = { emergencyOff: false, features: { music: false } };
    expect(await run({ prompt: 'a song' }, { ...ALL_KEYS, ...DB })).toEqual({ status: 503, body: { error: 'ai_disabled' } });
    expect((await run({ prompt: 'x' })).status).toBe(400);
    expect(calls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// POST /api/vinaxai — code execution
// ---------------------------------------------------------------------------

describe('POST /api/vinaxai — tools: [\'code_execution\']', () => {
  const sse = (frames: unknown[]): Response =>
    new Response(frames.map((f) => `data: ${JSON.stringify(f)}\n\n`).join('') + 'data: [DONE]\n\n', { status: 200, headers: { 'content-type': 'text/event-stream' } });
  const chat = async (payload: Record<string, unknown>, env: Record<string, string>): Promise<{ status: number; frames: Array<Record<string, unknown>>; text: string }> => {
    const res = await vinaxaiPost({ request: post('/api/vinaxai', payload), env });
    const raw = await res.text();
    const frames = raw.split('\n\n').filter((f) => f.startsWith('data:')).map((f) => JSON.parse(f.slice(5)) as Record<string, unknown>);
    return { status: res.status, frames, text: frames.map((f) => (typeof f.delta === 'string' ? f.delta : '')).join('') };
  };
  const ask = { messages: [{ role: 'user', content: 'What is 2 + 2? Run it.' }], mode: 'auto', tools: ['code_execution'] };

  it('only code_execution is honoured; every other tool name is dropped', () => {
    expect(requestTools(['code_execution', 'google_search', 'browser_search', 'web'])).toEqual(['code_execution']);
    expect(requestTools(['browser_search'])).toEqual([]);
    expect(requestTools('code_execution')).toEqual([]);
  });

  it('Gemini (Auto leads with the flagship): native endpoint with codeExecution; code and output arrive as fenced blocks; meta.tools', async () => {
    provider = () =>
      new Response(
        [
          { candidates: [{ content: { parts: [{ executableCode: { language: 'PYTHON', code: 'print(2 + 2)' } }] } }] },
          { candidates: [{ content: { parts: [{ codeExecutionResult: { outcome: 'OUTCOME_OK', output: '4\n' } }] } }] },
          { candidates: [{ content: { parts: [{ text: 'The answer is 4.' }] } }], usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 6 } },
        ].map((f) => `data: ${JSON.stringify(f)}\r\n\r\n`).join(''),
        { status: 200, headers: { 'content-type': 'text/event-stream' } },
      );
    const { status, frames, text } = await chat(ask, { GEMINI_API_KEY: 'AIza-gm' });
    expect(status).toBe(200);
    expect(calls).toHaveLength(1);
    // The OpenAI-compatible door is skipped: code execution is a native tool.
    expect(calls[0].url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:streamGenerateContent?alt=sse');
    expect(calls[0].json?.tools).toEqual([{ codeExecution: {} }]);
    expect(text).toContain('```python\nprint(2 + 2)\n```');
    expect(text).toContain('**Output**\n\n```\n4\n```');
    expect(text.indexOf('print(2 + 2)')).toBeLessThan(text.indexOf('The answer is 4.'));
    expect(frames[0].meta).toMatchObject({ provider: 'gemini', modelId: 'gemini-3.8-flash', tools: ['code_execution'] });
  });

  it('Groq: code_interpreter on gpt-oss (the Groq seat already leads with one); executed_tools render as fenced blocks; meta.tools', async () => {
    provider = () =>
      sse([
        { choices: [{ delta: { executed_tools: [{ index: 0, type: 'python', arguments: '{"code":"import math\\nprint(math.sqrt(144))"}' }] } }] },
        { choices: [{ delta: { executed_tools: [{ index: 0, type: 'python', arguments: '{"code":"import math\\nprint(math.sqrt(144))"}', output: '12.0' }] } }] },
        { choices: [{ delta: { content: 'It is 12.' } }] },
      ]);
    const { status, frames, text } = await chat(ask, { GROQ_API_KEY: 'gq' });
    expect(status).toBe(200);
    expect(calls[0].url).toBe('https://api.groq.com/openai/v1/chat/completions');
    expect(calls[0].json).toMatchObject({ model: 'openai/gpt-oss-20b', tools: [{ type: 'code_interpreter' }] });
    expect(text).toBe('```python\nimport math\nprint(math.sqrt(144))\n```\n\n**Output**\n\n```\n12.0\n```\n\nIt is 12.');
    expect(frames[0].meta).toMatchObject({ provider: 'groq', modelId: 'openai/gpt-oss-20b', tools: ['code_execution'] });
  });

  it('Auto with an NVIDIA seat in front: the best gpt-oss model Groq lists leads, with the tool', async () => {
    provider = () => sse([{ choices: [{ delta: { content: '4' } }] }]);
    const { status, frames } = await chat(ask, { NVIDIA_API_KEY: 'nv', GROQ_API_KEY: 'gq' });
    expect(status).toBe(200);
    expect(calls[0].url).toBe('https://api.groq.com/openai/v1/chat/completions');
    expect(calls[0].json).toMatchObject({ model: 'openai/gpt-oss-120b', tools: [{ type: 'code_interpreter' }] });
    expect(frames[0].meta).toMatchObject({ provider: 'groq', modelId: 'openai/gpt-oss-120b', tools: ['code_execution'] });
    // Without the tool, Auto is untouched: the NVIDIA seat answers first.
    calls.length = 0;
    await chat({ messages: ask.messages, mode: 'auto' }, { NVIDIA_API_KEY: 'nv', GROQ_API_KEY: 'gq' });
    expect(calls[0].url).toBe('https://integrate.api.nvidia.com/v1/chat/completions');
    expect(calls[0].json).not.toHaveProperty('tools');
  });

  it('a picked model that cannot run code answers without the tool, and meta says so', async () => {
    provider = () => sse([{ choices: [{ delta: { content: '4' } }] }]);
    const { status, frames } = await chat({ ...ask, mode: 'model', provider: 'groq', model: 'llama-3.1-8b-instant' }, { GROQ_API_KEY: 'gq' });
    expect(status).toBe(200);
    expect(calls[0].json?.model).toBe('llama-3.1-8b-instant');
    expect(calls[0].json).not.toHaveProperty('tools');
    expect(frames[0].meta).not.toHaveProperty('tools');
  });

  it('a model that refuses the tool (400) is asked again without it; without tools nothing is sent', async () => {
    provider = (c) => (c.json?.tools ? json({ error: { message: 'tool not supported' } }, 400) : sse([{ choices: [{ delta: { content: '4' } }] }]));
    const refused = await chat({ ...ask, mode: 'model', provider: 'groq', model: 'openai/gpt-oss-20b' }, { GROQ_API_KEY: 'gq' });
    expect(refused.status).toBe(200);
    expect(calls.map((c) => Boolean(c.json?.tools))).toEqual([true, false]);
    expect(refused.frames[0].meta).not.toHaveProperty('tools');
    calls.length = 0;
    await chat({ messages: ask.messages, mode: 'model', provider: 'groq', model: 'openai/gpt-oss-20b' }, { GROQ_API_KEY: 'gq' });
    expect(calls[0].json).not.toHaveProperty('tools');
  });

  it('executedToolsText ignores anything that is not the code interpreter and never prints a block twice', () => {
    const shown = new Map<number, { code: boolean; output: boolean }>();
    expect(executedToolsText([{ index: 0, type: 'browser_search', arguments: '{"query":"x"}', output: 'page' }], shown)).toBe('');
    const first = executedToolsText([{ index: 1, type: 'python', arguments: 'print(1)', code_results: [{ text: '1' }] }], shown);
    expect(first).toContain('```python\nprint(1)\n```');
    expect(first).toContain('```\n1\n```');
    expect(executedToolsText([{ index: 1, type: 'python', arguments: 'print(1)', code_results: [{ text: '1' }] }], shown)).toBe('');
    expect(attemptRunsCode({ key: 'k', model: 'openai/gpt-oss-20b', role: 'scholar', endpoint: 'https://api.groq.com/openai/v1/chat/completions' })).toBe(true);
    expect(attemptRunsCode({ key: 'k', model: 'openai/gpt-oss-20b', role: 'fast', endpoint: 'https://integrate.api.nvidia.com/v1/chat/completions' })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// /api/embed engines from the free lists, and the AI Lab media bench
// ---------------------------------------------------------------------------

describe('embeddings drawn from the free lists', () => {
  it('uses the listed NVIDIA embedding models in preference order, not a pin the list no longer carries', async () => {
    provider = (c) => {
      const n = Array.isArray(c.json?.input) ? (c.json.input as unknown[]).length : 1;
      return json({ data: Array.from({ length: n }, (_, i) => ({ index: i, embedding: [0.1 + i, 0.2, 0.3, 0.4] })) });
    };
    await fetchMedia({ NVIDIA_API_KEY: 'nv' }, 'nvidia'); // warm the list (a cold isolate waits at most 1.5 s)
    const r = await embedTexts({ NVIDIA_API_KEY: 'nv' }, ['monsoon ragas'], 'query');
    expect(r.ok && r.model).toBe('nvidia/llama-3.2-nv-embedqa-1b-v1');
    expect(calls[0].url).toBe('https://integrate.api.nvidia.com/v1/embeddings');
    expect(calls[0].json).toMatchObject({ model: 'nvidia/llama-3.2-nv-embedqa-1b-v1', input_type: 'query' });
  });

  it('falls through the listed models, then Gemini\'s listed embedding model', async () => {
    provider = (c) => (c.url.includes('nvidia') ? json({ error: 'gone' }, 404) : json({ embeddings: [{ values: [0.3, 0.4] }] }));
    const env = { NVIDIA_API_KEY: 'nv', GEMINI_API_KEY: 'AIza-gm' };
    await Promise.all([fetchMedia(env, 'nvidia'), fetchMedia(env, 'gemini')]);
    const r = await embedTexts(env, ['x'], 'passage', { deadlineAt: Date.now() + 60_000 });
    expect(r.ok && r.model).toBe('gemini-embedding-001');
    expect(calls.filter((c) => c.url.includes('nvidia')).map((c) => c.json?.model)).toEqual(['nvidia/llama-3.2-nv-embedqa-1b-v1', 'nvidia/nemotron-3-embed-1b', 'snowflake/arctic-embed-l', 'nvidia/llama-3.2-nemoretriever-1b-vlm-embed-v1']);
  });
});

describe('AI Lab — media bench', () => {
  const lab = async (body: unknown): Promise<Record<string, unknown>> => {
    ip += 1;
    const res = await ailabPost({
      request: new Request('https://admin.test/api/admin/ailab', { method: 'POST', headers: { 'x-admin-token': 'test-secret', 'content-type': 'application/json', 'cf-connecting-ip': `10.79.0.${ip % 250}` }, body: JSON.stringify(body) }),
      env: { ...ALL_KEYS, ADMIN_LOGIN_PASSWORD: 'test-secret' },
    });
    return (await res.json()) as Record<string, unknown>;
  };

  it('benches an image and a speech model; music and embeddings are list-only; unknown models are refused', async () => {
    provider = (c) => (c.url.includes('audio/speech') ? new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { 'content-type': 'audio/wav' } }) : json({ artifacts: [{ base64: b64(120), finishReason: 'SUCCESS', seed: 1 }] }));
    expect(await lab({ provider: 'nvidia', kind: 'image', model: 'black-forest-labs/flux.1-schnell' })).toMatchObject({ ok: true, kind: 'image', name: 'FLUX.1 schnell', status: 200 });
    expect(await lab({ provider: 'groq', kind: 'speech', model: 'canopylabs/orpheus-v1-english' })).toMatchObject({ ok: true, kind: 'speech', bytes: 3, voice: 'autumn' });
    expect(await lab({ provider: 'openrouter', kind: 'music', model: 'google/lyria-3-clip-preview:free' })).toMatchObject({ ok: false, listOnly: true });
    expect(await lab({ provider: 'gemini', kind: 'embedding', model: 'gemini-embedding-001' })).toMatchObject({ ok: false, listOnly: true });
    expect(await lab({ provider: 'gemini', kind: 'transcription', model: 'gemini-3.8-flash' })).toMatchObject({ error: 'audio_required' });
    expect(await lab({ provider: 'openrouter', kind: 'image', model: 'tencent/hy-image-v3.5-preview' })).toMatchObject({ error: 'unknown_model' });
    expect(await lab({ provider: 'groq', kind: 'video', model: 'x' })).toMatchObject({ error: 'unknown_kind' });
    expect(calls).toHaveLength(2);
  });
});

describe('pcmToWav', () => {
  it('writes a 44-byte RIFF header for 16-bit mono PCM', () => {
    const wav = pcmToWav(new Uint8Array(10), 16000);
    const v = new DataView(wav.buffer);
    expect(wav.length).toBe(54);
    expect(v.getUint32(4, true)).toBe(46);
    expect(v.getUint16(22, true)).toBe(1);
    expect(v.getUint32(24, true)).toBe(16000);
    expect(v.getUint32(28, true)).toBe(32000);
    expect(v.getUint32(40, true)).toBe(10);
  });
});
