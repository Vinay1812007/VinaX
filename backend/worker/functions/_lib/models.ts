/**
 * AI_MODEL_REGISTRY — the inventory of every model a LANE pins (the models
 * Auto and the features use). Features talk to LANES (functions/_lib/ai.ts);
 * lanes pin models; this registry describes the pinned models themselves.
 *
 * 10.3 — one key per provider. Every row now names the single key of its
 * provider (VINAX_NVIDIA_API_KEY, VINAX_OPENROUTER_API_KEY,
 * VINAX_GROQ_API_KEY, VINAX_GGL_GEMINI_API_KEY), and `display_name` is the
 * model's ORIGINAL published name — the app shows real model names now. The
 * rows that existed only for the per-model bench keys (kimi-k3, deepseek v4
 * flash, muse-glimmer, ising-calibration, laguna-xs, diffusiongemma,
 * gemma-4) left with those keys; every one of them is still selectable from
 * the live NVIDIA catalogue (_lib/catalog.ts) when the provider lists it.
 *
 * HONESTY RULES (owner-mandated):
 * - Every model here is served through a hosted inference endpoint. None of
 *   them can be trained or fine-tuned from this codebase, so
 *   training_supported / fine_tuning_supported are FALSE on every entry.
 *   Never flip these without an actual working training pipeline.
 * - `verified` means the slug was probed live and served. The 10.3 key change
 *   moved every NVIDIA lane onto one new key, so each row is re-verified in
 *   the admin AI Lab after the owner sets it.
 * - max_context is null everywhere on purpose: unknown, not invented.
 * - `chat_capable: false` models can NOT ride the chat() adapter; they need
 *   their own adapter before any feature may call them. Listing them here is
 *   inventory, not capability.
 * - The Groq and OpenRouter lanes do not pin a single model: their live free
 *   catalogues are discovered at runtime by _lib/catalog.ts. Their rows below
 *   describe the DEFAULT model each key serves when no explicit pick is made.
 */

import { PROVIDER_ENV, type AiProvider } from './ai';

export type Capability =
  | 'reasoning'
  | 'generation'
  | 'classification'
  | 'ranking'
  | 'embedding'
  | 'translation'
  | 'safety'
  | 'voice'
  | 'multimodal'
  | 'video'
  | 'creative'
  | 'image'
  | 'vision';

export type LatencyClass = 'realtime' | 'fast' | 'medium' | 'slow' | 'unknown';
export type QualityClass = 'light' | 'medium' | 'high' | 'premium' | 'unknown';
export type CostClass = 'low' | 'medium' | 'high' | 'unknown';

/** Upstream that serves a model — one key each (10.3). */
export type Provider = AiProvider;

export interface ModelSpec {
  /** Provider-facing slug. */
  id: string;
  /** Cloudflare secret whose key signs this model's requests. */
  envKey: string;
  /** 10.3 — the model's original published name. */
  display_name: string;
  provider: Provider;
  /** Owner's role summary — what this model is FOR in VinaX. */
  role: string;
  capabilities: Capability[];
  /** Inference-only hosted models — see header. Always false today. */
  training_supported: false;
  fine_tuning_supported: false;
  latency_class: LatencyClass;
  quality_class: QualityClass;
  cost_class: CostClass;
  /** What the model emits through its supported adapter. */
  output_format: 'json' | 'text' | 'vector' | 'unknown';
  /** True = usable through the existing OpenAI-compatible chat() adapter. */
  chat_capable: boolean;
  /** True = the key serves a whole catalog, not one pinned model; the live
   *  list comes from _lib/catalog.ts and the `id` below is only the default. */
  catalog_key?: boolean;
  /** Registry ids to try when this model fails (same capability family).
   *  Descriptive only (8.2.0 decision): routing does not read it. Almost
   *  every id here is another lane's pinned model on another key, and the
   *  cross-lane ladder in _lib/ai.ts already reaches those — with the right
   *  key, host and cooldown state for each hop. Wiring this list in as extra
   *  same-key attempts would sign a model with a key that was never issued
   *  for it. Same-key rescues live in LANE_SECONDARY instead. */
  fallback_models: string[];
  /** Unknown — never invent context limits. */
  max_context: null;
  /** Live-probed serving on its CURRENT key. Only verified models may be
   *  promoted out of their owner-assigned seat. */
  verified: boolean;
  notes?: string;
}

const T = { training_supported: false as const, fine_tuning_supported: false as const, max_context: null };

/** Every model VinaX knows about, keyed by registry id. */
export const AI_MODEL_REGISTRY: Record<string, ModelSpec> = {
  'gemini-3.8-flash': {
    id: 'gemini-3.8-flash', envKey: PROVIDER_ENV.gemini, display_name: 'Gemini 3.8 Flash', provider: 'gemini',
    role: 'Flagship music intelligence — AI DJ ordering, Queue Builder, ranking, playlists, Home builder',
    capabilities: ['reasoning', 'generation', 'ranking', 'classification', 'creative'], latency_class: 'fast', quality_class: 'premium',
    cost_class: 'low', output_format: 'json', chat_capable: true,
    fallback_models: ['gpt-oss-20b'],
    verified: false, ...T,
    notes: 'Added 8.0.0 on the owner\'s new key. Leads the DJ, ranking, playlist and Home-builder ladders; a 429 cools the key for a minute and the ladder answers. VINAX_MAESTRO_MODEL replaces the pin without new code. 8.0.2: re-pinned from gemini-2.5-flash (retired for new accounts, live 404 on 2026-09-26); a retired pin is replaced at runtime by the provider\'s suggested model or its newest listed flash model. Probe it in the AI Lab after the secret is set.',
  },
  'kimi-k3': {
    id: 'moonshotai/kimi-k3', envKey: PROVIDER_ENV.nvidia, display_name: 'Kimi K3', provider: 'nvidia',
    role: 'Deep reasoning reserve — advanced recommendations, taste analysis, playlist planning',
    capabilities: ['reasoning', 'generation'], latency_class: 'slow', quality_class: 'premium',
    cost_class: 'high', output_format: 'json', chat_capable: true,
    fallback_models: ['nemotron-3-super-120b-a12b', 'mistral-large'],
    verified: false, ...T,
    notes: '10.3: the pro reserve seat, replacing deepseek-v4-pro-0813, which is not on the provider\'s public /v1/models list (2026-10-06). Listed there; not yet probed on VINAX_NVIDIA_API_KEY.',
  },
  'nemotron-3.5-lightning-30b-a3b': {
    id: 'nvidia/nemotron-3.5-lightning-30b-a3b', envKey: PROVIDER_ENV.nvidia, display_name: 'Nemotron 3.5 Lightning 30B A3B', provider: 'nvidia',
    role: 'High-speed reasoning — balanced chat and playlist planning',
    capabilities: ['reasoning', 'generation', 'ranking'], latency_class: 'realtime', quality_class: 'high',
    cost_class: 'medium', output_format: 'json', chat_capable: true,
    fallback_models: ['gpt-oss-20b', 'mistral-large'],
    verified: true, ...T,
    notes: 'Probed 2026-09-09 on the new key: 3.9s cold / 0.63s warm, JSON-clean. dj + chat primary. Thinking off via reasoningOffParams.',
  },
  'nemotron-3-ultra-550b-a55b': {
    id: 'nvidia/nemotron-3-ultra-550b-a55b', envKey: PROVIDER_ENV.nvidia, display_name: 'Nemotron 3 Ultra 550B A55B', provider: 'nvidia',
    role: 'Premium reasoning — highest-quality playlist reasoning, difficult multi-step tasks',
    capabilities: ['reasoning', 'generation'], latency_class: 'slow', quality_class: 'premium',
    cost_class: 'high', output_format: 'json', chat_capable: true,
    fallback_models: ['nemotron-3-super-120b-a12b', 'mistral-large'],
    verified: true, ...T,
    notes: 'Probed 2026-09-09: SERVES but took 25.1s for a 4-token ping. Premium backstop only — it must stay LAST in every latency-sensitive ladder.',
  },
  'nemotron-3-nano-omni-30b-a3b-reasoning': {
    id: 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning', envKey: PROVIDER_ENV.nvidia, display_name: 'Nemotron 3 Nano Omni 30B A3B Reasoning', provider: 'nvidia',
    role: 'Compact multimodal reasoning — search-page music expert, discovery, mixed-context questions',
    capabilities: ['multimodal', 'reasoning', 'classification'], latency_class: 'fast', quality_class: 'medium',
    cost_class: 'medium', output_format: 'json', chat_capable: true,
    fallback_models: ['nemotron-3.5-lightning-30b-a3b', 'gpt-oss-20b'],
    verified: true, ...T,
    notes: 'Probed 2026-09-09: 0.69s. Search-lane primary, inheriting the seat from the retired nemotron-3-nano-30b-a3b. Same a3b template family, so it MUST carry reasoningOffParams or it leaks bare chain-of-thought.',
  },
  'nemotron-3-super-120b-a12b': {
    id: 'nvidia/nemotron-3-super-120b-a12b', envKey: PROVIDER_ENV.nvidia, display_name: 'Nemotron 3 Super 120B A12B', provider: 'nvidia',
    role: 'Advanced AI — deep thinking, the Think button, advanced personalization, taste reasoning',
    capabilities: ['reasoning', 'generation'], latency_class: 'medium', quality_class: 'high',
    cost_class: 'medium', output_format: 'json', chat_capable: true,
    fallback_models: ['nemotron-3-ultra-550b-a55b', 'mistral-large'],
    verified: true, ...T,
    notes: 'Probed 2026-09-09: 0.80s. Deep (Think) lane primary.',
  },
  'gpt-oss-20b': {
    id: 'openai/gpt-oss-20b', envKey: PROVIDER_ENV.nvidia, display_name: 'GPT-OSS 20B', provider: 'nvidia',
    role: 'Fast general seat — quick chat, instant answers, inexpensive requests',
    capabilities: ['generation', 'reasoning', 'classification'], latency_class: 'fast', quality_class: 'medium',
    cost_class: 'low', output_format: 'json', chat_capable: true,
    fallback_models: ['nemotron-3.5-lightning-30b-a3b', 'mistral-large'],
    verified: true, ...T,
    notes: 'Probed 2026-09-09 on its new key: 1.2s. Healthy here, unlike on the retired key — fast-lane primary, with the lightning engine as same-key secondary.',
  },
  'mistral-large': {
    id: 'mistralai/mistral-large', envKey: PROVIDER_ENV.nvidia, display_name: 'Mistral Large', provider: 'nvidia',
    role: 'General all-rounder — the everyday reserve seat: balanced chat, playlist text, fallback generation',
    capabilities: ['generation', 'reasoning', 'classification'], latency_class: 'medium', quality_class: 'high',
    cost_class: 'medium', output_format: 'json', chat_capable: true,
    fallback_models: ['gpt-oss-20b', 'nemotron-3.5-lightning-30b-a3b'],
    verified: false, ...T,
    notes: '10.3: the mini reserve seat and the chat lane\'s same-key secondary, replacing mistral-nemotron, which is not on the provider\'s public /v1/models list (2026-10-06). Listed there; not yet probed on VINAX_NVIDIA_API_KEY.',
  },
  'llama-3.2-11b-vision-instruct': {
    id: 'meta/llama-3.2-11b-vision-instruct', envKey: PROVIDER_ENV.nvidia, display_name: 'Llama 3.2 11B Vision Instruct', provider: 'nvidia',
    role: 'Image understanding — the vision seat behind photo questions in VinaX AI',
    capabilities: ['vision', 'multimodal', 'generation'], latency_class: 'fast', quality_class: 'medium',
    cost_class: 'medium', output_format: 'text', chat_capable: true,
    fallback_models: ['llama-3.2-90b-vision-instruct'],
    verified: true, ...T,
    notes: 'Probed 2026-09-09 on its own new key: 0.69s. The vision seat finally signs its own calls instead of borrowing a text lane key.',
  },
  'llama-3.2-90b-vision-instruct': {
    id: 'meta/llama-3.2-90b-vision-instruct', envKey: PROVIDER_ENV.nvidia, display_name: 'Llama 3.2 90B Vision Instruct', provider: 'nvidia',
    role: 'Deep image understanding — detailed photo, artwork and screenshot analysis',
    capabilities: ['vision', 'multimodal', 'reasoning', 'generation'], latency_class: 'medium', quality_class: 'high',
    cost_class: 'high', output_format: 'text', chat_capable: true,
    fallback_models: ['llama-3.2-11b-vision-instruct'],
    verified: false, ...T,
    notes: 'Probed 2026-09-09: UNREACHABLE (no HTTP response). The 11B key is the vision default and covers it; re-probe before relying on this one.',
  },

  'groq-catalog': {
    id: 'llama-3.3-70b-versatile', envKey: PROVIDER_ENV.groq, display_name: 'Groq free catalogue', provider: 'groq',
    role: 'Aggregator key — the external fast lane (music knowledge, instant facts, LIVE voice) plus every free chat model the account exposes',
    capabilities: ['generation', 'reasoning'], latency_class: 'realtime', quality_class: 'high',
    cost_class: 'low', output_format: 'json', chat_capable: true, catalog_key: true,
    fallback_models: ['mistral-large', 'gpt-oss-20b'],
    verified: true, ...T,
    notes: 'Probed 2026-09-09: the KEY works, but the pinned llama-3.3-70b-versatile (and its llama-3.1-8b-instant secondary) had been RETIRED upstream, so every call 404d. Fixed in v5.23.0 by resolving the model from the live free list instead of pinning one — a catalog key must never carry a fixed slug. The id above is only the synchronous-ladder fallback.',
  },
  'openrouter-catalog': {
    id: 'meta-llama/llama-3.3-70b-instruct:free', envKey: PROVIDER_ENV.openrouter, display_name: 'OpenRouter free catalogue', provider: 'openrouter',
    role: 'Aggregator key — a whole marketplace of zero-cost chat models behind one key, selectable per message',
    capabilities: ['generation', 'reasoning', 'creative'], latency_class: 'medium', quality_class: 'high',
    cost_class: 'low', output_format: 'json', chat_capable: true, catalog_key: true,
    fallback_models: ['mistral-large', 'gpt-oss-20b'],
    verified: true, ...T,
    notes: 'Probed 2026-09-09: the KEY works; the guessed default slug 404d, same root cause as the other catalog lane and fixed the same way (live resolution, never a fixed pin). Only models the provider prices at zero for BOTH prompt and completion are listed, so this key cannot run up a bill. Its free list carries several engines that are unreachable on the default base.',
  },
};

/** Registry ids whose spec says the chat() adapter can serve them. */
export function chatCapableModels(): string[] {
  return Object.keys(AI_MODEL_REGISTRY).filter((k) => AI_MODEL_REGISTRY[k].chat_capable);
}

/** Models declaring a capability, best quality first (premium > high > medium > light). */
export function modelsForCapability(cap: Capability): ModelSpec[] {
  const rank: Record<QualityClass, number> = { premium: 4, high: 3, medium: 2, light: 1, unknown: 0 };
  return Object.values(AI_MODEL_REGISTRY)
    .filter((m) => m.capabilities.includes(cap))
    .sort((a, b) => rank[b.quality_class] - rank[a.quality_class]);
}

/** The catalogue lanes (Groq, OpenRouter) — their default is resolved live, not pinned. */
export function catalogKeys(): ModelSpec[] {
  return Object.values(AI_MODEL_REGISTRY).filter((m) => m.catalog_key === true);
}

/** Env secret names the registry references — the .env.example checklist. */
export function registryEnvKeys(): string[] {
  return [...new Set(Object.values(AI_MODEL_REGISTRY).map((m) => m.envKey))].sort();
}
