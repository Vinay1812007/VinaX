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
const gemini = (upstream: string, name: string, group: ModelGroup | null, tier: 'fast' | 'full' = 'full', description = ''): ModelSpec =>
  m('gemini', upstream, name, group, {
    tier,
    description,
    maxContextChars: GEMINI_CTX,
    maxOutput: tier === 'fast' ? 8_192 : 16_384,
    params: geminiThink,
    highParams: geminiThinkHigh,
    flags: { vision: true, pdf: true, reasoning: true, artifacts: tier === 'full', thinkFormat: 'parts' },
  });

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
  // ---- Balanced
  m('groq', 'openai/gpt-oss-120b', 'GPT-OSS 120B', 'balanced', {
    description: 'Strong all-rounder, the default for Auto', maxContextChars: GROQ_CTX,
    params: { include_reasoning: true, reasoning_effort: 'medium' }, highParams: { reasoning_effort: 'high' },
    flags: { reasoning: true, artifacts: true, thinkFormat: 'field' },
  }),
  gemini('gemini-3.5-flash', 'Gemini 3.5 Flash', 'balanced', 'full', 'Sees images and reads long documents'),
  m('nvidia', 'nvidia/nemotron-3.5-lightning-30b-a3b', 'Nemotron 3.5 Lightning', 'balanced', {
    description: 'Quick, capable reasoning', maxContextChars: NVIDIA_CTX,
    flags: { reasoning: true, artifacts: true, thinkFormat: 'tags' },
  }),
  // ---- Smart
  gemini('gemini-3.6-flash', 'Gemini 3.6 Flash', 'smart', 'full', 'Careful answers, images and long documents'),
  m('nvidia', 'nvidia/nemotron-3-ultra-550b-a55b', 'Nemotron 3 Ultra 550B', 'smart', {
    description: 'Deep reasoning for hard problems (slower)', maxContextChars: NVIDIA_CTX,
    flags: { reasoning: true, artifacts: true, thinkFormat: 'tags' },
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
  // ---- Code
  m('openrouter', 'cohere/north-mini-code:free', 'North Mini Code', 'code', {
    description: 'Tuned for writing and fixing code', maxContextChars: OPENROUTER_CTX, flags: { artifacts: true },
  }),
  m('openrouter', 'poolside/laguna-s-2.1:free', 'Laguna S 2.1', 'code', {
    description: 'Code-focused, good with whole files', maxContextChars: OPENROUTER_CTX, flags: { artifacts: true },
  }),
  // ---- Cloudflare (chosen from the public Workers AI list; confirm with the probe)
  m('cloudflare', '@cf/meta/llama-3.3-70b-instruct-fp8-fast', 'Llama 3.3 70B', 'cloudflare', {
    description: 'Runs on the edge network', maxContextChars: 60_000, maxOutput: 4_096, unconfirmed: true,
  }),
  m('cloudflare', '@cf/meta/llama-3.1-8b-instruct-fast', 'Llama 3.1 8B', 'cloudflare', {
    tier: 'fast', description: 'Small and quick, on the edge network', maxContextChars: 24_000, maxOutput: 2_048, unconfirmed: true,
  }),

  // ---- Failover only (never in the picker)
  gemini('gemini-3-flash-preview', 'Gemini 3 Flash Preview', null),
  gemini('gemini-3.5-flash-lite', 'Gemini 3.5 Flash Lite', null, 'fast'),
  gemini('gemini-3.1-flash-lite', 'Gemini 3.1 Flash Lite', null, 'fast'),
  gemini('gemini-flash-lite-latest', 'Gemini Flash Lite', null, 'fast'),
  m('nvidia', 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning', 'Nemotron 3 Nano Omni', null, {
    maxContextChars: NVIDIA_CTX, flags: { vision: true, reasoning: true, thinkFormat: 'tags' },
  }),
  m('nvidia', 'openai/gpt-oss-20b', 'GPT-OSS 20B', null, {
    maxContextChars: NVIDIA_CTX, flags: { reasoning: true, thinkFormat: 'field' },
  }),
  m('openrouter', 'nvidia/nemotron-3.5-lightning:free', 'Nemotron 3.5 Lightning', null, {
    maxContextChars: OPENROUTER_CTX, flags: { reasoning: true, artifacts: true, thinkFormat: 'field' },
  }),
  m('openrouter', 'nvidia/nemotron-3-ultra-550b-a55b:free', 'Nemotron 3 Ultra 550B', null, {
    maxContextChars: OPENROUTER_CTX, flags: { reasoning: true, artifacts: true, thinkFormat: 'field' },
  }),
  m('openrouter', 'nvidia/nemotron-3.5-super-vl:free', 'Nemotron 3.5 Super VL', null, {
    maxContextChars: OPENROUTER_CTX, flags: { vision: true, reasoning: true, thinkFormat: 'field' },
  }),
  m('openrouter', 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free', 'Nemotron 3 Nano Omni', null, {
    maxContextChars: OPENROUTER_CTX, flags: { vision: true, reasoning: true, thinkFormat: 'field' },
  }),
  m('openrouter', 'poolside/laguna-xs-2.1:free', 'Laguna XS 2.1', null, {
    maxContextChars: OPENROUTER_CTX, flags: { artifacts: true },
  }),
];

export type LadderName = 'vision' | 'long' | 'deep' | 'code' | 'fast' | 'default' | 'title';

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
};

export const PICKER_GROUPS: readonly ModelGroup[] = ['fast', 'balanced', 'smart', 'vision', 'code', 'cloudflare'];

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
