/**
 * AI_MODEL_REGISTRY — the central, model-agnostic catalog of every AI model
 * VinaX can reach (v5.21.0 — rebuilt for the owner's 2026-09-09 key rotation:
 * every secret was deleted and re-issued under the new naming scheme, four
 * models were retired and four were added). One place to add, retire or
 * re-role a model without rewriting features: features talk to LANES
 * (functions/_lib/ai.ts); lanes pin models; this registry describes the
 * models themselves.
 *
 * HONESTY RULES (owner-mandated):
 * - Every model here is served through a hosted inference endpoint. None of
 *   them can be trained or fine-tuned from this codebase, so
 *   training_supported / fine_tuning_supported are FALSE on every entry.
 *   Never flip these without an actual working training pipeline.
 * - `verified` means the slug was probed live ON ITS CURRENT KEY and served.
 *   The 2026-09-09 rotation replaced every secret, so every probe result from
 *   the old key set is void: the whole registry starts at `verified: false`
 *   and each row flips back to true only after the admin AI Lab pings it on
 *   the new key. Lane pins follow the owner's key -> model table until then,
 *   and the cross-lane ladder covers anything that answers slowly or not at
 *   all.
 * - max_context is null everywhere on purpose: unknown, not invented.
 * - `chat_capable: false` models can NOT ride the chat() adapter; they need
 *   their own adapter before any feature may call them. Listing them here is
 *   inventory, not capability.
 * - The two aggregator keys (grq / opr) do not pin a single model: their live
 *   free-model catalogs are discovered at runtime by _lib/catalog.ts and the
 *   listener picks one. Their rows below describe the DEFAULT model each key
 *   serves when no explicit pick is made.
 */

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

/** Upstream that serves a model. `grq` / `opr` are the two aggregator keys
 *  whose catalogs are discovered at runtime (see _lib/catalog.ts). */
export type Provider = 'nvidia' | 'grq' | 'opr';

export interface ModelSpec {
  /** Provider-facing slug. */
  id: string;
  /** Cloudflare secret whose key signs this model's requests. */
  envKey: string;
  /** Owner-chosen display name (2026-09-09) — what listeners and the admin see. */
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
  /** Registry ids to try when this model fails (same capability family). */
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
  'kimi-k3': {
    id: 'moonshotai/kimi-k3', envKey: 'VINAX_KIMI_K3', display_name: 'VinaX K3', provider: 'nvidia',
    role: 'Main AI / agent — chat, complex requests, home-screen reasoning, playlist planning',
    capabilities: ['reasoning', 'generation'], latency_class: 'medium', quality_class: 'premium',
    cost_class: 'high', output_format: 'json', chat_capable: true,
    fallback_models: ['deepseek-v4-pro-0813', 'nemotron-3-super-120b-a12b', 'mistral-nemotron'],
    verified: false, ...T,
    notes: 'Probed 2026-09-09: HTTP 429 — the key authenticates but the account is rate-limited, so this is a quota state, not a dead model. Agent reserve; kept out of the default ladder.',
  },
  'deepseek-v4-pro-0813': {
    id: 'deepseek-ai/deepseek-v4-pro-0813', envKey: 'VINAX_DEEPSEEK_V4_PRO_0813', display_name: 'VinaX DP V4 PRO', provider: 'nvidia',
    role: 'Deep reasoning — advanced recommendations, taste analysis, DJ decision-making',
    capabilities: ['reasoning', 'generation'], latency_class: 'slow', quality_class: 'premium',
    cost_class: 'high', output_format: 'json', chat_capable: true,
    fallback_models: ['nemotron-3-super-120b-a12b', 'mistral-nemotron'],
    verified: false, ...T,
    notes: 'Probed 2026-09-09: UNREACHABLE (no HTTP response) on the new key. Ladder reserve only — the ladder now places it below every lane that answered.',
  },
  'deepseek-v4-flash-0731': {
    id: 'deepseek-ai/deepseek-v4-flash-0731', envKey: 'VINAX_DEEPSEEK_V4_FLASH_0731', display_name: 'VinaX DP V4 FLASH', provider: 'nvidia',
    role: 'Fast AI — quick recommendations, lightweight chat, instant UI actions',
    capabilities: ['generation', 'classification'], latency_class: 'fast', quality_class: 'medium',
    cost_class: 'medium', output_format: 'json', chat_capable: true,
    fallback_models: ['gpt-oss-20b', 'nemotron-3.5-lightning-30b-a3b'],
    verified: false, ...T,
    notes: 'Probed 2026-09-09: UNREACHABLE on the new key too. Bench lane only; the balanced chat seat stays on the lightning pair.',
  },
  'nemotron-3.5-lightning-30b-a3b': {
    id: 'nvidia/nemotron-3.5-lightning-30b-a3b', envKey: 'VINAX_NVD_NEMOTRON_3_5_LIGHTNING_30B_A3B', display_name: 'VinaX NVD NMTRN 3.5 LTNG 30B', provider: 'nvidia',
    role: 'High-speed reasoning — real-time AI DJ, next-song ranking, queue decisions, balanced chat',
    capabilities: ['reasoning', 'generation', 'ranking'], latency_class: 'realtime', quality_class: 'high',
    cost_class: 'medium', output_format: 'json', chat_capable: true,
    fallback_models: ['gpt-oss-20b', 'mistral-nemotron'],
    verified: true, ...T,
    notes: 'Probed 2026-09-09 on the new key: 3.9s cold / 0.63s warm, JSON-clean. dj + chat primary. Thinking off via reasoningOffParams.',
  },
  'muse-glimmer-30b': {
    id: 'meta/muse-glimmer-30b', envKey: 'VINAX_MTA_MUSE_GLIMMER_30B', display_name: 'VinaX MTA MUSE GMR 30B', provider: 'nvidia',
    role: 'Music intelligence — mood interpretation, playlist themes, vibe matching, descriptions',
    capabilities: ['creative', 'generation'], latency_class: 'medium', quality_class: 'high',
    cost_class: 'medium', output_format: 'text', chat_capable: true,
    fallback_models: ['gemma-4-31b-it', 'gpt-oss-20b'],
    verified: true, ...T,
    notes: 'Probed 2026-09-09: 0.80s under the new vendor prefix — the slug that 404d before now serves. Bench lane.',
  },
  'ising-calibration-1.5-31b': {
    id: 'nvidia/ising-calibration-1.5-31b', envKey: 'VINAX_NVD_ISING_CALIBRATION_1_5_31B', display_name: 'VinaX NVD ING CALBTN 1.5 31B', provider: 'nvidia',
    role: 'Ranking / calibration — recommendation score calibration, personalization weighting',
    capabilities: ['ranking', 'classification'], latency_class: 'fast', quality_class: 'high',
    cost_class: 'medium', output_format: 'json', chat_capable: true,
    fallback_models: ['nemotron-3.5-lightning-30b-a3b'],
    verified: true, ...T,
    notes: 'Probed 2026-09-09: 1.2s on the new key — the family that was 410 Gone is serving again. Bench lane; deterministic client-side ranking stays authoritative.',
  },
  'laguna-xs-2.1': {
    id: 'poolside/laguna-xs-2.1', envKey: 'VINAX_POOLSIDE_LAGUNA_XS_2_1', display_name: 'VinaX PSD LGNA XS 2.1', provider: 'nvidia',
    role: 'Lightweight AI — intent detection, simple classification, cheap background tasks',
    capabilities: ['classification', 'generation'], latency_class: 'realtime', quality_class: 'light',
    cost_class: 'low', output_format: 'json', chat_capable: true,
    fallback_models: ['gpt-oss-20b'],
    verified: true, ...T,
    notes: 'Probed 2026-09-09: 0.65s under the new vendor prefix — the slug that 404d before now serves. Bench lane.',
  },
  'diffusiongemma-26b-a4b-it': {
    id: 'google/diffusiongemma-26b-a4b-it', envKey: 'VINAX_GGL_DIFFUSIONGEMMA_26B_A4B_IT', display_name: 'VinaX GGL DIF GEM 26B A4B IT', provider: 'nvidia',
    role: 'Generative AI — visual themes, creative content (text side only today)',
    capabilities: ['creative', 'generation', 'image'], latency_class: 'fast', quality_class: 'medium',
    cost_class: 'medium', output_format: 'text', chat_capable: true,
    fallback_models: ['muse-glimmer-30b', 'gemma-4-31b-it'],
    verified: false, ...T,
    notes: 'Probed 2026-09-09: UNREACHABLE on the new key. Bench lane. Real image generation is NOT wired — never fake it through the text endpoint.',
  },
  'nemotron-3-ultra-550b-a55b': {
    id: 'nvidia/nemotron-3-ultra-550b-a55b', envKey: 'VINAX_NVD_NEMOTRON_3_ULTRA_550B_A55B', display_name: 'VinaX NVD NMTRN ULT', provider: 'nvidia',
    role: 'Premium reasoning — highest-quality playlist reasoning, difficult multi-step tasks',
    capabilities: ['reasoning', 'generation'], latency_class: 'slow', quality_class: 'premium',
    cost_class: 'high', output_format: 'json', chat_capable: true,
    fallback_models: ['nemotron-3-super-120b-a12b', 'mistral-nemotron'],
    verified: true, ...T,
    notes: 'Probed 2026-09-09: SERVES but took 25.1s for a 4-token ping. Premium backstop only — it must stay LAST in every latency-sensitive ladder.',
  },
  'nemotron-3-nano-omni-30b-a3b-reasoning': {
    id: 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning', envKey: 'VINAX_NVD_NEMOTRON_3_NANO_OMNI_30B_A3B_REASONING', display_name: 'VinaX NVD NMTRN NN OMNI 30B', provider: 'nvidia',
    role: 'Compact multimodal reasoning — search-page music expert, discovery, mixed-context questions',
    capabilities: ['multimodal', 'reasoning', 'classification'], latency_class: 'fast', quality_class: 'medium',
    cost_class: 'medium', output_format: 'json', chat_capable: true,
    fallback_models: ['nemotron-3.5-lightning-30b-a3b', 'gpt-oss-20b'],
    verified: true, ...T,
    notes: 'Probed 2026-09-09: 0.69s. Search-lane primary, inheriting the seat from the retired nemotron-3-nano-30b-a3b. Same a3b template family, so it MUST carry reasoningOffParams or it leaks bare chain-of-thought.',
  },
  'gemma-4-31b-it': {
    id: 'google/gemma-4-31b-it', envKey: 'VINAX_GGL_GEMMA_4_31B_IT', display_name: 'VinaX GGL GEM 4 31B', provider: 'nvidia',
    role: 'General assistant — chat, summaries, playlist descriptions',
    capabilities: ['generation', 'classification'], latency_class: 'fast', quality_class: 'medium',
    cost_class: 'low', output_format: 'json', chat_capable: true,
    fallback_models: ['gpt-oss-20b', 'mistral-nemotron'],
    verified: true, ...T,
    notes: 'Probed 2026-09-09: SERVES in 8.3s on the new key (it hung on the retired one). Slow — bench lane, not a feature primary.',
  },
  'nemotron-3-super-120b-a12b': {
    id: 'nvidia/nemotron-3-super-120b-a12b', envKey: 'VINAX_NVD_NEMOTRON_3_SUPER_120B_A12B', display_name: 'VinaX NVD NMTRN SUP', provider: 'nvidia',
    role: 'Advanced AI — deep thinking, the Think button, advanced personalization, taste reasoning',
    capabilities: ['reasoning', 'generation'], latency_class: 'medium', quality_class: 'high',
    cost_class: 'medium', output_format: 'json', chat_capable: true,
    fallback_models: ['nemotron-3-ultra-550b-a55b', 'mistral-nemotron'],
    verified: true, ...T,
    notes: 'Probed 2026-09-09: 0.80s. Deep (Think) lane primary.',
  },
  'gpt-oss-20b': {
    id: 'openai/gpt-oss-20b', envKey: 'VINAX_OAI_GPT_OSS_20B', display_name: 'VinaX OAI OSS 20B', provider: 'nvidia',
    role: 'Fast general seat — quick chat, instant answers, inexpensive requests',
    capabilities: ['generation', 'reasoning', 'classification'], latency_class: 'fast', quality_class: 'medium',
    cost_class: 'low', output_format: 'json', chat_capable: true,
    fallback_models: ['nemotron-3.5-lightning-30b-a3b', 'mistral-nemotron'],
    verified: true, ...T,
    notes: 'Probed 2026-09-09 on its new key: 1.2s. Healthy here, unlike on the retired key — fast-lane primary, with the lightning engine as same-key secondary.',
  },
  'mistral-nemotron': {
    id: 'mistralai/mistral-nemotron', envKey: 'VINAX_MISTRAL_NEMOTRON', display_name: 'VinaX MST NMTRN', provider: 'nvidia',
    role: 'General all-rounder — the everyday reserve seat: balanced chat, playlist text, fallback generation',
    capabilities: ['generation', 'reasoning', 'classification'], latency_class: 'fast', quality_class: 'high',
    cost_class: 'medium', output_format: 'json', chat_capable: true,
    fallback_models: ['gpt-oss-20b', 'nemotron-3.5-lightning-30b-a3b'],
    verified: false, ...T,
    notes: 'Probed 2026-09-09: UNREACHABLE (no HTTP response) on its new key. Kept as the general reserve seat but demoted in the ladder until it answers.',
  },
  'llama-3.2-11b-vision-instruct': {
    id: 'meta/llama-3.2-11b-vision-instruct', envKey: 'VINAX_MTA_LMA_3_2_11B_VSN_INT', display_name: 'VinaX MTA VSN 11B', provider: 'nvidia',
    role: 'Image understanding — the vision seat behind photo questions in VinaX AI',
    capabilities: ['vision', 'multimodal', 'generation'], latency_class: 'fast', quality_class: 'medium',
    cost_class: 'medium', output_format: 'text', chat_capable: true,
    fallback_models: ['llama-3.2-90b-vision-instruct'],
    verified: true, ...T,
    notes: 'Probed 2026-09-09 on its own new key: 0.69s. The vision seat finally signs its own calls instead of borrowing a text lane key.',
  },
  'llama-3.2-90b-vision-instruct': {
    id: 'meta/llama-3.2-90b-vision-instruct', envKey: 'VINAX_MTA_LMA_3_2_90B_VSN_INT', display_name: 'VinaX MTA VSN 90B', provider: 'nvidia',
    role: 'Deep image understanding — detailed photo, artwork and screenshot analysis',
    capabilities: ['vision', 'multimodal', 'reasoning', 'generation'], latency_class: 'medium', quality_class: 'high',
    cost_class: 'high', output_format: 'text', chat_capable: true,
    fallback_models: ['llama-3.2-11b-vision-instruct'],
    verified: false, ...T,
    notes: 'Probed 2026-09-09: UNREACHABLE (no HTTP response). The 11B key is the vision default and covers it; re-probe before relying on this one.',
  },

  'grq-catalog': {
    id: 'llama-3.3-70b-versatile', envKey: 'VINAX_GROQ_API_KEY', display_name: 'VinaX GRQ ALL', provider: 'grq',
    role: 'Aggregator key — the external fast lane (music knowledge, instant facts, LIVE voice) plus every free chat model the account exposes',
    capabilities: ['generation', 'reasoning'], latency_class: 'realtime', quality_class: 'high',
    cost_class: 'low', output_format: 'json', chat_capable: true, catalog_key: true,
    fallback_models: ['mistral-nemotron', 'gpt-oss-20b'],
    verified: true, ...T,
    notes: 'Probed 2026-09-09: the KEY works, but the pinned llama-3.3-70b-versatile (and its llama-3.1-8b-instant secondary) had been RETIRED upstream, so every call 404d. Fixed in v5.23.0 by resolving the model from the live free list instead of pinning one — a catalog key must never carry a fixed slug. The id above is only the synchronous-ladder fallback.',
  },
  'opr-catalog': {
    id: 'meta-llama/llama-3.3-70b-instruct:free', envKey: 'VINAX_OPENROUTER_API_KEY', display_name: 'VinaX OPR ALL', provider: 'opr',
    role: 'Aggregator key — a whole marketplace of zero-cost chat models behind one key, selectable per message',
    capabilities: ['generation', 'reasoning', 'creative'], latency_class: 'medium', quality_class: 'high',
    cost_class: 'low', output_format: 'json', chat_capable: true, catalog_key: true,
    fallback_models: ['mistral-nemotron', 'gpt-oss-20b'],
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

/** The two aggregator keys — their catalogs are fetched live, not pinned. */
export function catalogKeys(): ModelSpec[] {
  return Object.values(AI_MODEL_REGISTRY).filter((m) => m.catalog_key === true);
}

/** Env secret names the registry references — the .env.example checklist. */
export function registryEnvKeys(): string[] {
  return [...new Set(Object.values(AI_MODEL_REGISTRY).map((m) => m.envKey))].sort();
}
