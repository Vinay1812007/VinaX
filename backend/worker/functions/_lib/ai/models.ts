/**
 * VinaX AI — the curated model registry and the Auto ladders, as data.
 *
 * Nothing outside this file may name a model id. The owner can switch a
 * model off or reorder the picker without a deploy through the `vinax-ai`
 * setting (`models: { "<registry id>": { enabled, order } }`), applied by
 * `applyOverrides`. Flags marked in README.md (VinaX AI) as "probe" come from
 * `npm run ai:probe` (backend/scripts/ai-probe.mjs).
 *
 * This module only uses type imports, so the probe script can import it with
 * plain Node (type stripping) and no build step.
 */
import type { ModelFlags, ModelGroup, ModelSpec, ProviderId } from './types';

// Artifacts are on for every model with room for them (prompt.ts `artifactsOffered`); a specialist turns them off.
const FLAGS: ModelFlags = { vision: false, pdf: false, grounding: false, reasoning: false, artifacts: true, systemRole: true, thinkFormat: 'none' };

function m(
  provider: ProviderId,
  upstream: string,
  name: string,
  group: ModelGroup | null,
  rest: Partial<Omit<ModelSpec, 'id' | 'provider' | 'upstream' | 'name' | 'group' | 'flags'>> & { flags?: Partial<ModelFlags> } = {},
): ModelSpec {
  const { flags, ...other } = rest;
  return {
    id: `${provider}:${upstream}`,
    provider,
    upstream,
    name,
    group,
    tier: 'full',
    description: '',
    maxContextChars: 60_000,
    maxOutput: 8_192,
    ...other,
    flags: { ...FLAGS, ...flags },
  };
}

// Groq's free tier counts tokens per minute, so its threads are kept short;
// a long thread goes to the long ladder (Gemini) instead.
const GROQ_CTX = 30_000;
const GEMINI_CTX = 600_000;
const NVIDIA_CTX = 100_000;
const OPENROUTER_CTX = 100_000;
const CF_CTX = 60_000;
/**
 * Answer room for the big NVIDIA and OpenRouter models (they take 64K or more):
 * a whole page or app fits, and a longer one is carried on by the page's
 * automatic Continue. Groq stays at 8,192 (its free tier counts tokens per
 * minute); much more per reply risks the free plan's CPU limit when the
 * Worker reads the finished reply to save it.
 */
const LONG_OUT = 16_384;

const geminiThink = { thinkingConfig: { includeThoughts: true } };
// Gemini 3 thinks at its highest level unless told otherwise (14 s for two
// sentences on 3.6 Flash, 2026-11-12): low by default, high for Extended
// thinking. A model that refuses a level is asked again without it (adapter).
const gemini3Think = { thinkingConfig: { includeThoughts: true, thinkingLevel: 'low' } };
const geminiThinkHigh = { thinkingConfig: { includeThoughts: true, thinkingLevel: 'high' } };
const gemini = (upstream: string, name: string, group: ModelGroup | null, tier: 'fast' | 'full' = 'full', description = '', extra: Partial<Omit<ModelSpec, 'flags'>> & { grounding?: boolean; flags?: Partial<ModelFlags> } = {}): ModelSpec => {
  const { grounding, flags, ...rest } = extra;
  return m('gemini', upstream, name, group, {
    tier,
    description,
    maxContextChars: GEMINI_CTX,
    maxOutput: tier === 'fast' ? 16_384 : 32_768,
    params: /^gemini-3/.test(upstream) ? gemini3Think : geminiThink,
    highParams: geminiThinkHigh,
    ...rest,
    flags: { vision: true, pdf: true, reasoning: true, artifacts: true, thinkFormat: 'parts', grounding: grounding === true, ...flags },
  });
};

/**
 * The owner's approved free models (2026-11-12), as registry ids: nothing
 * else may be offered in the picker, put in a ladder or called for a chat
 * (config.ts filters every registry through `isApproved`, the found models
 * of discovery.ts included). NVIDIA and Workers AI ids were matched against
 * each provider's live list that day; Groq and Gemini ids are the owner's.
 * Left out on purpose: models that failed the owner's live check the same
 * day (Groq Qwen 3.8 27B and GPT-OSS 20B, Gemini 3.5 Flash Lite, GPT-OSS 20B
 * and Llama 3.2 90B Vision on NVIDIA) and two not listed by their provider
 * (Kimi K3.1 Pro on NVIDIA, Xing 4.0 29B on OpenRouter). Never Kimi K2.6,
 * GLM 5.3 or DeepSeek V4 Pro on Workers AI (paid billing). Voice models
 * (voice.ts) and UTILITY_MODELS are not chat models and are not on this list.
 */
/**
 * Approved but paused: each failed the owner's live check of the approved
 * list on 2026-11-12 after it went live (timed out at 25 s, or answered with
 * an error: gone, not on the free tier, or busy all day), so none is offered
 * or put in a ladder. DeepSeek V4.1 Flash was Auto's first choice and timed
 * out in three checks that day: every Auto message waited 12 s for it. Move
 * an id back into APPROVED_MODELS once it answers again.
 */
export const PAUSED_MODELS: ReadonlySet<string> = new Set([
  'nvidia:deepseek-ai/deepseek-v4.1-flash',
  'nvidia:z-ai/glm-5.3-flash',
  'nvidia:minimaxai/minimax-m3.1-flash',
  'nvidia:google/gemma-4-31b-it',
  'cloudflare:@cf/zai-org/glm-5.3-flash',
  'cloudflare:@cf/deepseek-ai/deepseek-v4.1-flash-1017',
  'gemini:gemini-3.8-flash',
  'gemini:gemini-3.6-flash',
  'gemini:gemma-4-31b-it',
  'gemini:gemma-4-26b-a4b-it',
  'openrouter:google/gemma-4-31b-it:free',
  'openrouter:google/gemma-4-26b-a4b-it:free',
]);

export const APPROVED_MODELS: ReadonlySet<string> = new Set([
  // NVIDIA (free, about 40 requests a minute per model)
  'nvidia:nvidia/nemotron-3.5-lightning-30b-a3b',
  'nvidia:nvidia/nemotron-3.5-super-vl-120b-a12b',
  'nvidia:mistralai/mistral-large-4-1t-a52b',
  'nvidia:nvidia/nemotron-3.5-bolt-e4b',
  // Cloudflare Workers AI (10,000 neurons a day for the account): picked by hand only, never in a ladder
  'cloudflare:@cf/openai/gpt-oss-120b',
  'cloudflare:@cf/qwen/qwen3.8-27b',
  'cloudflare:@cf/google/gemma-4-26b-a4b-it',
  'cloudflare:@cf/nvidia/nemotron-3-120b-a12b',
  'cloudflare:@cf/meta/llama-4-scout-17b-16e-instruct',
  'cloudflare:@cf/qwen/qwen3-30b-a3b-fp8',
  'cloudflare:@cf/openai/gpt-oss-20b',
  'cloudflare:@cf/zai-org/glm-4.7-flash',
  // Groq (30 a minute, 1,000 a day, 200K tokens a day per model)
  'groq:openai/gpt-oss-120b',
  // Google Gemini (free tier)
  'gemini:gemini-3.1-flash-lite',
  // OpenRouter (:free models rotate; one OpenRouter stops listing leaves the picker, see config.ts)
  'openrouter:nvidia/nemotron-3.5-super-vl:free',
  'openrouter:nvidia/nemotron-3.5-lightning:free',
  'openrouter:nvidia/nemotron-3-ultra-550b-a55b:free',
  'openrouter:nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free',
  'openrouter:dots-studio/dots-3-note-preview:free',
  'openrouter:cohere/north-mini-code:free',
  'openrouter:liquid/lfm-2.5-2.6b:free',
]);

export const isApproved = (id: string): boolean => APPROVED_MODELS.has(id);

// Gemma on the Gemini API takes no system instruction and no thinking
// config, and its free tier counts few tokens a minute: a short history.
const gemmaOnGemini = (upstream: string, name: string, description: string): ModelSpec => m('gemini', upstream, name, 'more', {
  description, maxContextChars: GROQ_CTX, maxOutput: 8_192, flags: { systemRole: false },
});

/** Exactly the approved models (a test checks both ways), in picker order within each group. */
export const MODELS: readonly ModelSpec[] = [
  // ---- Fast
  m('nvidia', 'nvidia/nemotron-3.5-bolt-e4b', 'Nemotron 3.5 Bolt', 'fast', {
    tier: 'fast', description: 'Quickest replies for everyday questions', maxContextChars: NVIDIA_CTX, maxOutput: 4_096,
    flags: { reasoning: true, thinkFormat: 'tags' },
  }),
  // Titles and memory notes ask with reasoning off: the least thinking this model allows.
  gemini('gemini-3.1-flash-lite', 'Gemini 3.1 Flash Lite', 'fast', 'fast', 'Light and quick, sees images', { offParams: { thinkingConfig: { thinkingLevel: 'minimal' } } }),
  m('openrouter', 'liquid/lfm-2.5-2.6b:free', 'LFM 2.5 2.6B', 'fast', {
    tier: 'fast', description: 'Tiny and quick, from Liquid AI', maxContextChars: 30_000, maxOutput: 4_096,
    flags: { reasoning: true, thinkFormat: 'field' },
  }),
  // ---- Balanced
  m('nvidia', 'deepseek-ai/deepseek-v4.1-flash', 'DeepSeek V4.1 Flash', 'balanced', {
    description: 'Strong all-rounder, the default for Auto', maxContextChars: NVIDIA_CTX, maxOutput: LONG_OUT,
    flags: { reasoning: true, artifacts: true, thinkFormat: 'field' },
  }),
  m('groq', 'openai/gpt-oss-120b', 'GPT-OSS 120B', 'balanced', {
    description: 'Quick and capable, great with code', maxContextChars: GROQ_CTX,
    params: { include_reasoning: true, reasoning_effort: 'medium' }, highParams: { reasoning_effort: 'high' },
    flags: { reasoning: true, artifacts: true, thinkFormat: 'field' },
  }),
  m('nvidia', 'z-ai/glm-5.3-flash', 'GLM 5.3 Flash', 'balanced', {
    description: 'Quick model from Z.ai, good at looking things up', maxContextChars: NVIDIA_CTX, maxOutput: LONG_OUT,
    flags: { reasoning: true, artifacts: true, thinkFormat: 'field' },
  }),
  m('nvidia', 'nvidia/nemotron-3.5-lightning-30b-a3b', 'Nemotron 3.5 Lightning', 'balanced', {
    description: 'Thinks things through before answering', maxContextChars: NVIDIA_CTX, maxOutput: LONG_OUT,
    flags: { reasoning: true, artifacts: true, thinkFormat: 'tags' },
  }),
  m('openrouter', 'nvidia/nemotron-3.5-lightning:free', 'Nemotron 3.5 Lightning (OpenRouter)', 'balanced', {
    description: 'The same model through OpenRouter', maxContextChars: OPENROUTER_CTX, maxOutput: LONG_OUT,
    flags: { reasoning: true, artifacts: true, thinkFormat: 'field' },
  }),
  m('cloudflare', '@cf/openai/gpt-oss-120b', 'GPT-OSS 120B (Cloudflare)', 'balanced', {
    description: 'GPT-OSS 120B with a longer memory', maxContextChars: CF_CTX, maxOutput: 8_192,
    flags: { reasoning: true, artifacts: true, thinkFormat: 'field' },
  }),
  m('cloudflare', '@cf/nvidia/nemotron-3-120b-a12b', 'Nemotron 3 120B', 'balanced', {
    description: 'Capable reasoning on the edge network', maxContextChars: CF_CTX, maxOutput: 8_192,
    flags: { reasoning: true, artifacts: true, thinkFormat: 'field' },
  }),
  // ---- Smart (the two Gemini Flash models allow about 20 messages a day: picked by hand only)
  m('nvidia', 'mistralai/mistral-large-4-1t-a52b', 'Mistral Large 4', 'smart', {
    description: 'Mistral’s largest model, strong at writing', maxContextChars: NVIDIA_CTX, maxOutput: LONG_OUT,
    flags: { reasoning: true, artifacts: true, thinkFormat: 'field' },
  }),
  gemini('gemini-3.8-flash', 'Gemini 3.8 Flash', 'smart', 'full', 'Google’s newest Flash, a few messages a day'),
  gemini('gemini-3.6-flash', 'Gemini 3.6 Flash', 'smart', 'full', 'Careful answers, images and long documents'),
  m('openrouter', 'nvidia/nemotron-3-ultra-550b-a55b:free', 'Nemotron 3 Ultra 550B (OpenRouter)', 'smart', {
    description: 'Big and careful, through OpenRouter', maxContextChars: OPENROUTER_CTX, maxOutput: LONG_OUT,
    flags: { reasoning: true, artifacts: true, thinkFormat: 'field' },
  }),
  m('cloudflare', '@cf/zai-org/glm-4.7-flash', 'GLM 4.7 Flash', 'smart', {
    description: 'Reasons step by step (slower)', maxContextChars: CF_CTX, maxOutput: 8_192,
    flags: { reasoning: true, artifacts: true, thinkFormat: 'field' },
  }),
  // ---- Vision
  m('nvidia', 'nvidia/nemotron-3.5-super-vl-120b-a12b', 'Nemotron 3.5 Super VL', 'vision', {
    description: 'Reads images and screenshots', maxContextChars: NVIDIA_CTX, maxOutput: LONG_OUT,
    flags: { vision: true, reasoning: true, thinkFormat: 'tags' },
  }),
  m('openrouter', 'nvidia/nemotron-3.5-super-vl:free', 'Nemotron 3.5 Super VL (OpenRouter)', 'vision', {
    description: 'The same model through OpenRouter', maxContextChars: OPENROUTER_CTX, maxOutput: LONG_OUT,
    flags: { vision: true, reasoning: true, thinkFormat: 'field' },
  }),
  m('openrouter', 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free', 'Nemotron 3 Nano Omni (OpenRouter)', 'vision', {
    description: 'Small model that sees images and reasons', maxContextChars: OPENROUTER_CTX, maxOutput: LONG_OUT,
    flags: { vision: true, reasoning: true, thinkFormat: 'field' },
  }),
  // ---- Code
  m('openrouter', 'cohere/north-mini-code:free', 'North Mini Code', 'code', {
    description: 'Tuned for writing and fixing code', maxContextChars: OPENROUTER_CTX, maxOutput: LONG_OUT,
    flags: { reasoning: true, artifacts: true, thinkFormat: 'field' },
  }),
  m('cloudflare', '@cf/openai/gpt-oss-20b', 'GPT-OSS 20B (Cloudflare)', 'code', {
    description: 'Light reasoning for everyday code', maxContextChars: CF_CTX, maxOutput: 8_192,
    flags: { reasoning: true, artifacts: true, thinkFormat: 'field' },
  }),
  // ---- More models (never in a ladder, except MiniMax last in music and Gemma 4 31B last in title)
  m('nvidia', 'minimaxai/minimax-m3.1-flash', 'MiniMax M3.1 Flash', 'more', {
    description: 'Long, thorough answers (slow)', maxContextChars: NVIDIA_CTX,
  }),
  m('nvidia', 'google/gemma-4-31b-it', 'Gemma 4 31B', 'more', {
    description: 'Google’s open model, quick and tidy', maxContextChars: NVIDIA_CTX, maxOutput: 8_192,
  }),
  gemmaOnGemini('gemma-4-31b-it', 'Gemma 4 31B (Google AI)', 'Gemma 4 31B straight from Google'),
  gemmaOnGemini('gemma-4-26b-a4b-it', 'Gemma 4 26B (Google AI)', 'Smaller Gemma 4 straight from Google'),
  m('openrouter', 'google/gemma-4-31b-it:free', 'Gemma 4 31B (OpenRouter)', 'more', {
    description: 'Gemma 4 31B through OpenRouter', maxContextChars: OPENROUTER_CTX, maxOutput: 8_192,
  }),
  m('openrouter', 'google/gemma-4-26b-a4b-it:free', 'Gemma 4 26B (OpenRouter)', 'more', {
    description: 'Gemma 4 26B through OpenRouter', maxContextChars: OPENROUTER_CTX, maxOutput: 8_192,
  }),
  m('openrouter', 'dots-studio/dots-3-note-preview:free', 'Dots 3 Note Preview', 'more', {
    description: 'Preview chat model from dots', maxContextChars: OPENROUTER_CTX, flags: { reasoning: true, thinkFormat: 'field' },
  }),
  // ---- Cloudflare Workers AI (picked by hand only)
  m('cloudflare', '@cf/zai-org/glm-5.3-flash', 'GLM 5.3 Flash (Cloudflare)', 'cloudflare', {
    description: 'Quick GLM on the edge network', maxContextChars: CF_CTX, maxOutput: 8_192,
    flags: { reasoning: true, artifacts: true, thinkFormat: 'field' },
  }),
  m('cloudflare', '@cf/deepseek-ai/deepseek-v4.1-flash-1017', 'DeepSeek V4.1 Flash (Cloudflare)', 'cloudflare', {
    description: 'DeepSeek V4.1 Flash on the edge network', maxContextChars: CF_CTX, maxOutput: 8_192,
    flags: { reasoning: true, artifacts: true, thinkFormat: 'field' },
  }),
  m('cloudflare', '@cf/qwen/qwen3.8-27b', 'Qwen 3.8 27B', 'cloudflare', {
    description: 'Alibaba’s Qwen, thinks first', maxContextChars: CF_CTX, maxOutput: 8_192,
    flags: { reasoning: true, artifacts: true, thinkFormat: 'field' },
  }),
  m('cloudflare', '@cf/qwen/qwen3-30b-a3b-fp8', 'Qwen 3 30B', 'cloudflare', {
    description: 'Quick Qwen that reasons', maxContextChars: CF_CTX, maxOutput: 4_096,
    flags: { reasoning: true, thinkFormat: 'field' },
  }),
  m('cloudflare', '@cf/meta/llama-4-scout-17b-16e-instruct', 'Llama 4 Scout', 'cloudflare', {
    description: 'Meta’s Llama 4, quick and capable', maxContextChars: CF_CTX, maxOutput: 4_096,
  }),
  m('cloudflare', '@cf/google/gemma-4-26b-a4b-it', 'Gemma 4 26B', 'cloudflare', {
    description: 'Google’s open model, thinks first (slower)', maxContextChars: CF_CTX, maxOutput: 4_096,
    flags: { reasoning: true, thinkFormat: 'field' },
  }),

  // Web search only (the `grounded` ladder) held Gemini 2.5 Flash and 2.5 Flash-Lite, the
  // two with free Google Search grounding. Both failed every request on 2026-11-12 (2.5 Pro
  // is gone at Google) and none of the approved Gemini models has free grounding, so web
  // search goes through the search API for every model.
];

/**
 * Models from the providers' lists that cannot hold a conversation: safety
 * and prompt guards, embeddings, document parsers and Gemini's attributed
 * question answering. Never in the picker or a ladder; the console lists
 * them so the owner can see they are known. Voice models live in ./voice.ts.
 */
export type UtilityKind = 'guard' | 'embedding' | 'parse' | 'aqa';

export interface UtilityModel {
  id: string;
  provider: ProviderId;
  upstream: string;
  name: string;
  kind: UtilityKind;
}

const u = (provider: ProviderId, upstream: string, name: string, kind: UtilityKind): UtilityModel => ({ id: `${provider}:${upstream}`, provider, upstream, name, kind });

export const UTILITY_MODELS: readonly UtilityModel[] = [
  u('nvidia', 'meta/llama-guard-4-12b', 'Llama Guard 4 12B', 'guard'),
  u('nvidia', 'nvidia/llama-3.1-nemotron-safety-guard-8b-v3', 'Nemotron Safety Guard 8B v3', 'guard'),
  u('groq', 'meta-llama/llama-prompt-guard-2-22m', 'Llama Prompt Guard 2 22M', 'guard'),
  u('groq', 'meta-llama/llama-prompt-guard-2-86m', 'Llama Prompt Guard 2 86M', 'guard'),
  u('groq', 'openai/gpt-oss-safeguard-20b', 'GPT-OSS Safeguard 20B', 'guard'),
  u('gemini', 'gemini-embedding-001', 'Gemini Embedding 001', 'embedding'),
  u('gemini', 'gemini-embedding-2', 'Gemini Embedding 2', 'embedding'),
  u('gemini', 'gemini-embedding-2-preview', 'Gemini Embedding 2 Preview', 'embedding'),
  u('nvidia', 'nvidia/nemotron-3-embed-1b', 'Nemotron 3 Embed 1B', 'embedding'),
  u('nvidia', 'nvidia/nemotron-3.5-embed-1b', 'Nemotron 3.5 Embed 1B', 'embedding'),
  u('nvidia', 'nvidia/nemotron-3.5-embed-8b', 'Nemotron 3.5 Embed 8B', 'embedding'),
  u('nvidia', 'nvidia/llama-nemotron-embed-vl-1b-v2', 'Llama Nemotron Embed VL 1B v2', 'embedding'),
  u('nvidia', 'nvidia/nemotron-parse-2.0', 'Nemotron Parse 2.0', 'parse'),
  u('nvidia', 'nvidia/nemotron-parse', 'Nemotron Parse', 'parse'),
  u('gemini', 'aqa', 'Gemini AQA', 'aqa'),
];

export type LadderName = 'vision' | 'long' | 'deep' | 'code' | 'fast' | 'default' | 'title' | 'grounded' | 'music';

/**
 * Auto's ladders, best first (README.md (VinaX AI) "Auto"). Only approved
 * models; never Workers AI (its daily pool is shared by the whole account)
 * and never the two Gemini Flash models (about 20 messages a day each).
 */
export const LADDERS: Readonly<Record<LadderName, readonly string[]>> = {
  vision: ['nvidia:nvidia/nemotron-3.5-super-vl-120b-a12b', 'openrouter:nvidia/nemotron-3.5-super-vl:free', 'gemini:gemini-3.1-flash-lite'],
  long: ['gemini:gemini-3.1-flash-lite', 'nvidia:mistralai/mistral-large-4-1t-a52b', 'openrouter:nvidia/nemotron-3-ultra-550b-a55b:free'],
  deep: ['nvidia:mistralai/mistral-large-4-1t-a52b', 'openrouter:nvidia/nemotron-3-ultra-550b-a55b:free', 'nvidia:nvidia/nemotron-3.5-lightning-30b-a3b', 'groq:openai/gpt-oss-120b'],
  code: ['groq:openai/gpt-oss-120b', 'openrouter:cohere/north-mini-code:free', 'nvidia:mistralai/mistral-large-4-1t-a52b'],
  fast: ['nvidia:nvidia/nemotron-3.5-lightning-30b-a3b', 'nvidia:nvidia/nemotron-3.5-bolt-e4b', 'gemini:gemini-3.1-flash-lite'],
  /** The quickest that answered on 2026-11-12: GPT-OSS 120B (0.9 s), Nemotron 3.5 Lightning (1.6 s), Mistral Large 4, then the rest. */
  default: ['groq:openai/gpt-oss-120b', 'nvidia:nvidia/nemotron-3.5-lightning-30b-a3b', 'nvidia:mistralai/mistral-large-4-1t-a52b', 'openrouter:nvidia/nemotron-3-ultra-550b-a55b:free', 'nvidia:nvidia/nemotron-3.5-bolt-e4b', 'gemini:gemini-3.1-flash-lite'],
  title: ['gemini:gemini-3.1-flash-lite', 'nvidia:nvidia/nemotron-3.5-bolt-e4b'],
  /**
   * The music routes' short JSON tasks (POST /api/ai/rerank, /api/ai/home-layout):
   * the quickest models first, because each answer has a deadline of 1.5–2.5 s.
   */
  music: ['nvidia:nvidia/nemotron-3.5-bolt-e4b', 'gemini:gemini-3.1-flash-lite'],
  /** Put first in Auto's ladder when a reply searches the web: free Google Search grounding (none work now; see above). */
  grounded: [],
};

/** The curated groups, then one group per provider for the free models found in its list (discovery.ts). */
export const PICKER_GROUPS: readonly ModelGroup[] = [
  'fast', 'balanced', 'smart', 'vision', 'code', 'more', 'cloudflare',
  'more-groq', 'more-gemini', 'more-openrouter', 'more-nvidia', 'more-cloudflare',
];

export interface ModelOverride {
  enabled?: boolean;
  order?: number;
}

/**
 * The registry after the owner's overrides: switched-off models are dropped
 * (from the picker and from every ladder), and `order` reorders a model
 * within its picker group. Unknown ids and bad values are ignored.
 */
export function applyOverrides(models: readonly ModelSpec[], overrides: unknown): ModelSpec[] {
  const o = overrides && typeof overrides === 'object' && !Array.isArray(overrides) ? (overrides as Record<string, unknown>) : {};
  const get = (id: string): ModelOverride => {
    const v = o[id];
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as ModelOverride) : {};
  };
  const kept = models.filter((spec) => get(spec.id).enabled !== false);
  const orderOf = (spec: ModelSpec, i: number): number => {
    const n = get(spec.id).order;
    return typeof n === 'number' && Number.isFinite(n) ? n : i;
  };
  // Sort inside each group, then put each group's models back into the
  // places that group held, so groups keep their positions.
  const byGroup = new Map<string, ModelSpec[]>();
  for (const spec of kept) byGroup.set(String(spec.group), [...(byGroup.get(String(spec.group)) ?? []), spec]);
  for (const [g, list] of byGroup) {
    byGroup.set(g, list.map((spec, i) => ({ spec, key: orderOf(spec, i), i })).sort((a, b) => a.key - b.key || a.i - b.i).map((x) => x.spec));
  }
  const next = new Map<string, number>();
  return kept.map((spec) => {
    const g = String(spec.group);
    const i = next.get(g) ?? 0;
    next.set(g, i + 1);
    return byGroup.get(g)![i];
  });
}

export function modelById(models: readonly ModelSpec[], id: unknown): ModelSpec | null {
  return typeof id === 'string' ? models.find((spec) => spec.id === id) ?? null : null;
}

/** The ladder's models that are in `models` (enabled), in ladder order. */
export function ladderModels(models: readonly ModelSpec[], name: LadderName): ModelSpec[] {
  return LADDERS[name].map((id) => modelById(models, id)).filter((spec): spec is ModelSpec => !!spec);
}
