/**
 * VinaX AI — the curated model registry and the Auto ladders, as data.
 *
 * Nothing outside this file may name a model id. The owner can switch a
 * model off or reorder the picker without a deploy through the `vinax-ai`
 * setting (`models: { "<registry id>": { enabled, order } }`), applied by
 * `applyOverrides`. Flags marked in docs/ai.md as "probe" come from
 * `npm run ai:probe` (backend/scripts/ai-probe.mjs).
 *
 * This module only uses type imports, so the probe script can import it with
 * plain Node (type stripping) and no build step.
 */
import type { ModelFlags, ModelGroup, ModelSpec, ProviderId } from './types';

const FLAGS: ModelFlags = { vision: false, pdf: false, grounding: false, reasoning: false, artifacts: false, systemRole: true, thinkFormat: 'none' };

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

const geminiThink = { thinkingConfig: { includeThoughts: true } };
const geminiThinkHigh = { thinkingConfig: { includeThoughts: true, thinkingLevel: 'high' } };
const gemini = (upstream: string, name: string, group: ModelGroup | null, tier: 'fast' | 'full' = 'full', description = '', extra: Partial<Omit<ModelSpec, 'flags'>> & { grounding?: boolean; flags?: Partial<ModelFlags> } = {}): ModelSpec => {
  const { grounding, flags, ...rest } = extra;
  return m('gemini', upstream, name, group, {
    tier,
    description,
    maxContextChars: GEMINI_CTX,
    maxOutput: tier === 'fast' ? 8_192 : 16_384,
    params: geminiThink,
    highParams: geminiThinkHigh,
    ...rest,
    flags: { vision: true, pdf: true, reasoning: true, artifacts: tier === 'full', thinkFormat: 'parts', grounding: grounding === true, ...flags },
  });
};

// Gemini 2.5 takes a thinking budget, not a level.
const gemini25High = { thinkingConfig: { includeThoughts: true, thinkingBudget: 16_384 } };
const gemini25Off = { thinkingConfig: { thinkingBudget: 0 } };

/** Models that took 30–45 s to start in the owner's probe: picked or probed, they get this long. */
const SLOW_START_MS = 60_000;

export const MODELS: readonly ModelSpec[] = [
  // ---- Fast
  m('groq', 'qwen/qwen3.8-27b', 'Qwen 3.8 27B', 'fast', {
    tier: 'fast', description: 'Quickest replies for everyday questions', maxContextChars: GROQ_CTX, maxOutput: 4_096,
    params: { reasoning_format: 'parsed' }, offParams: { reasoning_effort: 'none' }, flags: { reasoning: true, thinkFormat: 'field' },
  }),
  m('groq', 'openai/gpt-oss-20b', 'GPT-OSS 20B', 'fast', {
    tier: 'fast', description: 'Fast, light reasoning', maxContextChars: GROQ_CTX, maxOutput: 4_096,
    params: { include_reasoning: true, reasoning_effort: 'low' }, highParams: { reasoning_effort: 'high' },
    flags: { reasoning: true, thinkFormat: 'field' },
  }),
  gemini('gemini-3.5-flash-lite', 'Gemini 3.5 Flash Lite', 'fast', 'fast', 'Quick Gemini that sees images'),
  gemini('gemini-3.1-flash-lite', 'Gemini 3.1 Flash Lite', 'fast', 'fast', 'Light and quick, sees images'),
  gemini('gemini-3.1-flash-lite-preview', 'Gemini 3.1 Flash Lite Preview', 'fast', 'fast', 'Preview build of 3.1 Flash Lite'),
  gemini('gemini-flash-lite-latest', 'Gemini Flash Lite (latest)', 'fast', 'fast', 'Google’s newest Flash Lite'),
  m('openrouter', 'liquid/lfm-2.5-2.6b:free', 'LFM 2.5 2.6B', 'fast', {
    tier: 'fast', description: 'Tiny and quick, from Liquid AI', maxContextChars: 30_000, maxOutput: 4_096,
  }),
  // ---- Balanced
  m('groq', 'openai/gpt-oss-120b', 'GPT-OSS 120B', 'balanced', {
    description: 'Strong all-rounder, the default for Auto', maxContextChars: GROQ_CTX,
    params: { include_reasoning: true, reasoning_effort: 'medium' }, highParams: { reasoning_effort: 'high' },
    flags: { reasoning: true, artifacts: true, thinkFormat: 'field' },
  }),
  gemini('gemini-3.5-flash', 'Gemini 3.5 Flash', 'balanced', 'full', 'Sees images and reads long documents'),
  gemini('gemini-3-flash-preview', 'Gemini 3 Flash Preview', 'balanced', 'full', 'Earlier Gemini 3 Flash, images and documents'),
  m('nvidia', 'nvidia/nemotron-3.5-lightning-30b-a3b', 'Nemotron 3.5 Lightning', 'balanced', {
    description: 'Quick, capable reasoning', maxContextChars: NVIDIA_CTX,
    flags: { reasoning: true, artifacts: true, thinkFormat: 'tags' },
  }),
  m('openrouter', 'nvidia/nemotron-3.5-lightning:free', 'Nemotron 3.5 Lightning (OpenRouter)', 'balanced', {
    description: 'The same model through OpenRouter', maxContextChars: OPENROUTER_CTX,
    flags: { reasoning: true, artifacts: true, thinkFormat: 'field' },
  }),
  m('nvidia', 'openai/gpt-oss-20b', 'GPT-OSS 20B (NVIDIA)', 'balanced', {
    description: 'GPT-OSS 20B with a longer memory', maxContextChars: NVIDIA_CTX, flags: { reasoning: true, thinkFormat: 'field' },
  }),
  // ---- Smart
  gemini('gemini-3.6-flash', 'Gemini 3.6 Flash', 'smart', 'full', 'Careful answers, images and long documents'),
  m('nvidia', 'nvidia/nemotron-3-ultra-550b-a55b', 'Nemotron 3 Ultra 550B', 'smart', {
    description: 'Deep reasoning for hard problems (slower)', maxContextChars: NVIDIA_CTX,
    flags: { reasoning: true, artifacts: true, thinkFormat: 'tags' },
  }),
  m('openrouter', 'nvidia/nemotron-3-ultra-550b-a55b:free', 'Nemotron 3 Ultra 550B (OpenRouter)', 'smart', {
    description: 'The same model through OpenRouter', maxContextChars: OPENROUTER_CTX,
    flags: { reasoning: true, artifacts: true, thinkFormat: 'field' },
  }),
  m('nvidia', 'stepfun-ai/step-5-preview', 'Step 5 Preview', 'smart', {
    description: 'Thorough reasoning (slowest)', maxContextChars: NVIDIA_CTX,
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
  m('nvidia', 'meta/llama-3.2-90b-vision-instruct', 'Llama 3.2 90B Vision', 'vision', {
    description: 'Meta’s vision model (slow to start)', maxContextChars: NVIDIA_CTX, maxOutput: 4_096,
    firstEventMs: SLOW_START_MS, flags: { vision: true },
  }),
  // ---- Code
  m('openrouter', 'cohere/north-mini-code:free', 'North Mini Code', 'code', {
    description: 'Tuned for writing and fixing code', maxContextChars: OPENROUTER_CTX, flags: { artifacts: true },
  }),
  m('openrouter', 'poolside/laguna-s-2.1:free', 'Laguna S 2.1', 'code', {
    description: 'Code-focused, good with whole files', maxContextChars: OPENROUTER_CTX, flags: { artifacts: true },
  }),
  m('openrouter', 'poolside/laguna-xs-2.1:free', 'Laguna XS 2.1', 'code', {
    description: 'Smaller, quicker Laguna for code', maxContextChars: OPENROUTER_CTX, flags: { artifacts: true },
  }),
  m('nvidia', 'poolside/laguna-xs-2.1', 'Laguna XS 2.1 (NVIDIA)', 'code', {
    description: 'The same model on NVIDIA', maxContextChars: NVIDIA_CTX, flags: { artifacts: true },
  }),
  // ---- More models: niche, specialist or slow to start (never in a ladder)
  m('openrouter', 'dots-studio/dots-3-note-preview:free', 'Dots 3 Note Preview', 'more', {
    description: 'Preview chat model from dots', maxContextChars: OPENROUTER_CTX,
  }),
  m('groq', 'allam-2-7b', 'ALLaM 2 7B', 'more', {
    // ALLaM's whole window is 4,096 tokens: a short history and a short answer.
    tier: 'fast', description: 'Arabic and English', maxContextChars: 8_000, maxOutput: 1_024,
  }),
  m('nvidia', 'nvidia/riva-translate-4b-instruct-v2', 'Riva Translate 4B', 'more', {
    tier: 'fast', description: 'Translates text between languages', maxContextChars: 20_000, maxOutput: 4_096,
  }),
  m('nvidia', 'nvidia/ising-calibration-1.5-31b', 'Ising Calibration 1.5 31B', 'more', {
    description: 'Specialist NVIDIA model', maxContextChars: NVIDIA_CTX,
  }),
  gemini('gemini-robotics-er-2-preview', 'Gemini Robotics ER 2 Preview', 'more', 'full', 'Spatial reasoning over images', { flags: { pdf: false, artifacts: false } }),
  m('nvidia', 'meta/muse-glimmer-30b', 'Muse Glimmer 30B', 'more', {
    description: 'Meta model (slow to start)', maxContextChars: NVIDIA_CTX, maxOutput: 4_096, firstEventMs: SLOW_START_MS,
  }),
  m('nvidia', 'nvidia/nemotron-3.5-bolt-e4b', 'Nemotron 3.5 Bolt', 'more', {
    description: 'Small Nemotron (slow to start)', maxContextChars: NVIDIA_CTX, maxOutput: 4_096, firstEventMs: SLOW_START_MS,
    flags: { reasoning: true, thinkFormat: 'tags' },
  }),
  // ---- Cloudflare (chosen from the public Workers AI list; confirm with the probe)
  m('cloudflare', '@cf/meta/llama-3.3-70b-instruct-fp8-fast', 'Llama 3.3 70B', 'cloudflare', {
    description: 'Runs on the edge network', maxContextChars: 60_000, maxOutput: 4_096, unconfirmed: true,
  }),
  m('cloudflare', '@cf/meta/llama-3.1-8b-instruct-fast', 'Llama 3.1 8B', 'cloudflare', {
    tier: 'fast', description: 'Small and quick, on the edge network', maxContextChars: 24_000, maxOutput: 2_048, unconfirmed: true,
  }),

  // ---- Web search only (the `grounded` ladder; never in the picker): Google's
  // pricing page (checked 2026-10-31) gives free Search grounding on the free
  // tier to these two alone, 500 grounded requests a day shared between them.
  // Every Gemini 3.x model says "Not available" there.
  gemini('gemini-2.5-flash', 'Gemini 2.5 Flash', null, 'full', 'Answers with Google Search', { grounding: true, highParams: gemini25High }),
  gemini('gemini-2.5-flash-lite', 'Gemini 2.5 Flash-Lite', null, 'fast', 'Answers with Google Search', { grounding: true, highParams: gemini25High, offParams: gemini25Off }),
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

export type LadderName = 'vision' | 'long' | 'deep' | 'code' | 'fast' | 'default' | 'title' | 'grounded';

/** Auto's ladders, best first (docs/ai.md "Auto"). */
export const LADDERS: Readonly<Record<LadderName, readonly string[]>> = {
  vision: ['gemini:gemini-3.6-flash', 'gemini:gemini-3.5-flash', 'nvidia:nvidia/nemotron-3.5-super-vl-120b-a12b', 'openrouter:nvidia/nemotron-3.5-super-vl:free'],
  long: ['gemini:gemini-3.6-flash', 'gemini:gemini-3.5-flash', 'gemini:gemini-3-flash-preview', 'groq:openai/gpt-oss-120b'],
  deep: ['gemini:gemini-3.6-flash', 'nvidia:nvidia/nemotron-3-ultra-550b-a55b', 'openrouter:nvidia/nemotron-3-ultra-550b-a55b:free', 'groq:openai/gpt-oss-120b'],
  code: ['groq:openai/gpt-oss-120b', 'gemini:gemini-3.6-flash', 'openrouter:cohere/north-mini-code:free', 'openrouter:poolside/laguna-s-2.1:free'],
  fast: ['groq:qwen/qwen3.8-27b', 'groq:openai/gpt-oss-20b', 'gemini:gemini-3.5-flash-lite'],
  default: [
    'groq:openai/gpt-oss-120b', 'gemini:gemini-3.5-flash', 'nvidia:nvidia/nemotron-3.5-lightning-30b-a3b',
    'openrouter:nvidia/nemotron-3.5-lightning:free', 'nvidia:openai/gpt-oss-20b', 'cloudflare:@cf/meta/llama-3.3-70b-instruct-fp8-fast',
  ],
  title: ['groq:qwen/qwen3.8-27b', 'gemini:gemini-3.5-flash-lite'],
  /** Put first in Auto's ladder when a reply searches the web: free Google Search grounding. */
  grounded: ['gemini:gemini-2.5-flash', 'gemini:gemini-2.5-flash-lite'],
};

export const PICKER_GROUPS: readonly ModelGroup[] = ['fast', 'balanced', 'smart', 'vision', 'code', 'more', 'cloudflare'];

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
