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
    maxOutput: tier === 'fast' ? 8_192 : 16_384,
    params: /^gemini-3/.test(upstream) ? gemini3Think : geminiThink,
    highParams: geminiThinkHigh,
    ...rest,
    flags: { vision: true, pdf: true, reasoning: true, artifacts: true, thinkFormat: 'parts', grounding: grounding === true, ...flags },
  });
};

/**
 * Only models that answered in the owner's full check on 2026-11-12 (every
 * picker model asked "17 × 23" and a two-sentence question through the live
 * chat). Dropped then: anything rate-limited all day (Groq Qwen 3.8 27B and
 * GPT-OSS 20B, Gemini 3.5 Flash Lite and Flash Lite latest), timing out
 * (GPT-OSS 20B on NVIDIA, Llama 3.2 90B Vision, Step 5 Preview, Gemini 3
 * Flash Preview, Gemini 3.5 Flash), gone from its provider (Laguna S/XS 2.1
 * on OpenRouter, Muse Glimmer 30B) or not a chat model (Riva Translate
 * answers every message by translating it). Re-run the check before adding
 * one back.
 */
export const MODELS: readonly ModelSpec[] = [
  // ---- Fast
  m('nvidia', 'nvidia/nemotron-3.5-bolt-e4b', 'Nemotron 3.5 Bolt', 'fast', {
    tier: 'fast', description: 'Quickest replies for everyday questions', maxContextChars: NVIDIA_CTX, maxOutput: 4_096,
    flags: { reasoning: true, thinkFormat: 'tags' },
  }),
  m('cloudflare', '@cf/meta/llama-3.1-8b-instruct-fast', 'Llama 3.1 8B', 'fast', {
    tier: 'fast', description: 'Small and quick, on the edge network', maxContextChars: 24_000, maxOutput: 2_048,
  }),
  // Titles and memory notes ask with reasoning off: the least thinking this model allows.
  gemini('gemini-3.1-flash-lite', 'Gemini 3.1 Flash Lite', 'fast', 'fast', 'Light and quick, sees images', { offParams: { thinkingConfig: { thinkingLevel: 'minimal' } } }),
  gemini('gemini-3.1-flash-lite-preview', 'Gemini 3.1 Flash Lite Preview', 'fast', 'fast', 'Preview build of 3.1 Flash Lite'),
  m('openrouter', 'liquid/lfm-2.5-2.6b:free', 'LFM 2.5 2.6B', 'fast', {
    tier: 'fast', description: 'Tiny and quick, from Liquid AI', maxContextChars: 30_000, maxOutput: 4_096,
    flags: { reasoning: true, thinkFormat: 'field' },
  }),
  m('openrouter', 'baidu/ernie-5.5-flash-preview:free', 'ERNIE 5.5 Flash Preview', 'fast', {
    tier: 'fast', description: 'Quick answers from Baidu', maxContextChars: OPENROUTER_CTX,
  }),
  // ---- Balanced
  m('groq', 'openai/gpt-oss-120b', 'GPT-OSS 120B', 'balanced', {
    description: 'Strong all-rounder, the default for Auto', maxContextChars: GROQ_CTX,
    params: { include_reasoning: true, reasoning_effort: 'medium' }, highParams: { reasoning_effort: 'high' },
    flags: { reasoning: true, artifacts: true, thinkFormat: 'field' },
  }),
  m('nvidia', 'nvidia/nemotron-3-ultra-550b-a55b', 'Nemotron 3 Ultra 550B', 'balanced', {
    description: 'Big, careful and quick to answer', maxContextChars: NVIDIA_CTX,
    flags: { reasoning: true, artifacts: true, thinkFormat: 'tags' },
  }),
  m('cloudflare', '@cf/openai/gpt-oss-120b', 'GPT-OSS 120B (Cloudflare)', 'balanced', {
    description: 'GPT-OSS 120B with a longer memory', maxContextChars: CF_CTX, maxOutput: 8_192,
    flags: { reasoning: true, artifacts: true, thinkFormat: 'field' },
  }),
  m('cloudflare', '@cf/nvidia/nemotron-3-120b-a12b', 'Nemotron 3 120B', 'balanced', {
    description: 'Capable reasoning on the edge network', maxContextChars: CF_CTX, maxOutput: 8_192,
    flags: { reasoning: true, artifacts: true, thinkFormat: 'field' },
  }),
  m('nvidia', 'nvidia/nemotron-3.5-lightning-30b-a3b', 'Nemotron 3.5 Lightning', 'balanced', {
    description: 'Thinks things through before answering', maxContextChars: NVIDIA_CTX,
    flags: { reasoning: true, artifacts: true, thinkFormat: 'tags' },
  }),
  m('openrouter', 'nvidia/nemotron-3.5-lightning:free', 'Nemotron 3.5 Lightning (OpenRouter)', 'balanced', {
    description: 'The same model through OpenRouter', maxContextChars: OPENROUTER_CTX,
    flags: { reasoning: true, artifacts: true, thinkFormat: 'field' },
  }),
  // ---- Smart
  gemini('gemini-3.6-flash', 'Gemini 3.6 Flash', 'smart', 'full', 'Careful answers, images and long documents'),
  m('nvidia', 'mistralai/mistral-large-4-1t-a52b', 'Mistral Large 4', 'smart', {
    description: 'Mistral’s largest model, strong at writing', maxContextChars: NVIDIA_CTX,
    flags: { reasoning: true, artifacts: true, thinkFormat: 'field' },
  }),
  m('openrouter', 'nvidia/nemotron-3-ultra-550b-a55b:free', 'Nemotron 3 Ultra 550B (OpenRouter)', 'smart', {
    description: 'Nemotron 3 Ultra through OpenRouter', maxContextChars: OPENROUTER_CTX,
    flags: { reasoning: true, artifacts: true, thinkFormat: 'field' },
  }),
  m('cloudflare', '@cf/zai-org/glm-4.7-flash', 'GLM 4.7 Flash', 'smart', {
    description: 'Reasons step by step (slower)', maxContextChars: CF_CTX, maxOutput: 8_192,
    flags: { reasoning: true, artifacts: true, thinkFormat: 'field' },
  }),
  m('cloudflare', '@cf/deepseek-ai/deepseek-r1-distill-qwen-32b', 'DeepSeek R1 Distill 32B', 'smart', {
    description: 'Shows its full reasoning (slower)', maxContextChars: CF_CTX, maxOutput: 8_192,
    flags: { reasoning: true, artifacts: true, thinkFormat: 'tags' },
  }),
  // ---- Vision
  m('nvidia', 'nvidia/nemotron-3.5-super-vl-120b-a12b', 'Nemotron 3.5 Super VL', 'vision', {
    description: 'Reads images and screenshots', maxContextChars: NVIDIA_CTX,
    flags: { vision: true, reasoning: true, thinkFormat: 'tags' },
  }),
  m('openrouter', 'nvidia/nemotron-3.5-super-vl:free', 'Nemotron 3.5 Super VL (OpenRouter)', 'vision', {
    description: 'The same model through OpenRouter', maxContextChars: OPENROUTER_CTX,
    flags: { vision: true, reasoning: true, thinkFormat: 'field' },
  }),
  m('nvidia', 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning', 'Nemotron 3 Nano Omni', 'vision', {
    description: 'Small model that sees images and reasons', maxContextChars: NVIDIA_CTX,
    flags: { vision: true, reasoning: true, thinkFormat: 'tags' },
  }),
  m('openrouter', 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free', 'Nemotron 3 Nano Omni (OpenRouter)', 'vision', {
    description: 'The same model through OpenRouter', maxContextChars: OPENROUTER_CTX,
    flags: { vision: true, reasoning: true, thinkFormat: 'field' },
  }),
  // ---- Code
  m('openrouter', 'cohere/north-mini-code:free', 'North Mini Code', 'code', {
    description: 'Tuned for writing and fixing code', maxContextChars: OPENROUTER_CTX,
    flags: { reasoning: true, artifacts: true, thinkFormat: 'field' },
  }),
  m('nvidia', 'poolside/laguna-xs-2.1', 'Laguna XS 2.1', 'code', {
    description: 'Quick, code-focused, good with whole files', maxContextChars: NVIDIA_CTX, flags: { artifacts: true },
  }),
  m('cloudflare', '@cf/openai/gpt-oss-20b', 'GPT-OSS 20B (Cloudflare)', 'code', {
    description: 'Light reasoning for everyday code', maxContextChars: CF_CTX, maxOutput: 8_192,
    flags: { reasoning: true, artifacts: true, thinkFormat: 'field' },
  }),
  // ---- More models: niche or specialist (never in a ladder)
  m('openrouter', 'dots-studio/dots-3-note-preview:free', 'Dots 3 Note Preview', 'more', {
    description: 'Preview chat model from dots', maxContextChars: OPENROUTER_CTX, flags: { reasoning: true, thinkFormat: 'field' },
  }),
  m('openrouter', 'recursive/flint-v1.0:free', 'Flint 1.0', 'more', {
    description: 'Chat model from Recursive', maxContextChars: OPENROUTER_CTX, flags: { reasoning: true, thinkFormat: 'field' },
  }),
  m('openrouter', 'liquid/lfm-3-1.7b:free', 'LFM 3 1.7B', 'more', {
    tier: 'fast', description: 'Tiny model from Liquid AI', maxContextChars: 30_000, maxOutput: 4_096, flags: { reasoning: true, thinkFormat: 'field' },
  }),
  m('groq', 'allam-2-7b', 'ALLaM 2 7B', 'more', {
    // ALLaM's whole window is 4,096 tokens: a short history and a short answer.
    tier: 'fast', description: 'Arabic and English', maxContextChars: 8_000, maxOutput: 1_024,
  }),
  m('nvidia', 'nvidia/ising-calibration-1.5-31b', 'Ising Calibration 1.5 31B', 'more', {
    description: 'Specialist NVIDIA model', maxContextChars: NVIDIA_CTX, flags: { artifacts: false },
  }),
  gemini('gemini-robotics-er-2-preview', 'Gemini Robotics ER 2 Preview', 'more', 'full', 'Spatial reasoning over images', { flags: { pdf: false, artifacts: false } }),
  m('nvidia', 'minimaxai/minimax-m3.1-flash', 'MiniMax M3.1 Flash', 'more', {
    description: 'Long, thorough answers (slow)', maxContextChars: NVIDIA_CTX,
  }),
  // ---- Cloudflare Workers AI
  m('cloudflare', '@cf/meta/llama-3.3-70b-instruct-fp8-fast', 'Llama 3.3 70B', 'cloudflare', {
    description: 'Runs on the edge network', maxContextChars: CF_CTX, maxOutput: 4_096,
  }),
  m('cloudflare', '@cf/meta/llama-4-scout-17b-16e-instruct', 'Llama 4 Scout', 'cloudflare', {
    description: 'Meta’s Llama 4, quick and capable', maxContextChars: CF_CTX, maxOutput: 4_096,
  }),
  m('cloudflare', '@cf/aisingapore/gemma-sea-lion-v4-27b-it', 'SEA-LION 4 27B', 'cloudflare', {
    description: 'Strong in Southeast Asian languages', maxContextChars: CF_CTX, maxOutput: 4_096,
  }),
  m('cloudflare', '@cf/google/gemma-4-26b-a4b-it', 'Gemma 4 26B', 'cloudflare', {
    description: 'Google’s open model, thinks first (slower)', maxContextChars: CF_CTX, maxOutput: 4_096,
    flags: { reasoning: true, thinkFormat: 'field' },
  }),
  m('cloudflare', '@cf/ibm-granite/granite-4.0-h-micro', 'Granite 4.0 Micro', 'cloudflare', {
    tier: 'fast', description: 'Small IBM model', maxContextChars: CF_CTX, maxOutput: 4_096,
  }),

  // Web search only (the `grounded` ladder) held Gemini 2.5 Flash and 2.5 Flash-Lite, the
  // two with free Google Search grounding. Both failed every request on 2026-11-12 (2.5 Pro
  // is gone at Google), so web search now goes through the search API for every model.
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

/** Auto's ladders, best first (README.md (VinaX AI) "Auto"). */
export const LADDERS: Readonly<Record<LadderName, readonly string[]>> = {
  vision: ['gemini:gemini-3.6-flash', 'nvidia:nvidia/nemotron-3.5-super-vl-120b-a12b', 'nvidia:nvidia/nemotron-3-nano-omni-30b-a3b-reasoning', 'gemini:gemini-3.1-flash-lite', 'openrouter:nvidia/nemotron-3.5-super-vl:free'],
  long: ['gemini:gemini-3.6-flash', 'gemini:gemini-3.1-flash-lite', 'nvidia:nvidia/nemotron-3-ultra-550b-a55b', 'cloudflare:@cf/openai/gpt-oss-120b'],
  deep: ['gemini:gemini-3.6-flash', 'nvidia:nvidia/nemotron-3-ultra-550b-a55b', 'nvidia:nvidia/nemotron-3.5-lightning-30b-a3b', 'nvidia:mistralai/mistral-large-4-1t-a52b', 'groq:openai/gpt-oss-120b'],
  code: ['groq:openai/gpt-oss-120b', 'nvidia:nvidia/nemotron-3-ultra-550b-a55b', 'cloudflare:@cf/openai/gpt-oss-120b', 'gemini:gemini-3.6-flash', 'openrouter:cohere/north-mini-code:free'],
  fast: ['nvidia:nvidia/nemotron-3.5-bolt-e4b', 'cloudflare:@cf/meta/llama-3.1-8b-instruct-fast', 'gemini:gemini-3.1-flash-lite'],
  /** Quick first answers that show their thinking: Groq, then NVIDIA, then the edge network. */
  default: [
    'groq:openai/gpt-oss-120b', 'nvidia:nvidia/nemotron-3-ultra-550b-a55b', 'cloudflare:@cf/openai/gpt-oss-120b',
    'nvidia:nvidia/nemotron-3-nano-omni-30b-a3b-reasoning', 'gemini:gemini-3.6-flash', 'cloudflare:@cf/meta/llama-3.3-70b-instruct-fp8-fast',
  ],
  title: ['gemini:gemini-3.1-flash-lite', 'cloudflare:@cf/meta/llama-3.1-8b-instruct-fast', 'nvidia:nvidia/nemotron-3.5-bolt-e4b'],
  /**
   * The music routes' short JSON tasks (POST /api/ai/rerank, /api/ai/home-layout):
   * the quickest models first, because each answer has a deadline of 1.5–2.5 s.
   */
  music: ['cloudflare:@cf/meta/llama-3.1-8b-instruct-fast', 'nvidia:nvidia/nemotron-3.5-bolt-e4b', 'gemini:gemini-3.1-flash-lite'],
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
