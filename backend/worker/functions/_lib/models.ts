/**
 * AI_MODEL_REGISTRY — the central, model-agnostic catalog of every AI model
 * VinaX can reach (v5.6.1 — trimmed to the owner's 18 live keys, each with
 * its owner-chosen display_name; the 2026-08-31 Cloudflare cleanup deleted
 * the riva/embed/safety/voicechat/video/speaker/petr secrets). One place to add, retire, or re-role a model
 * without rewriting features: features talk to LANES (functions/_lib/ai.ts);
 * lanes pin models; this registry describes the models themselves.
 *
 * HONESTY RULES (owner-mandated):
 * - Every model here is served through hosted inference endpoints (NVIDIA NIM
 *   / Groq). None of them can be trained or fine-tuned from this codebase, so
 *   training_supported / fine_tuning_supported are FALSE on every entry.
 *   Never flip these without an actual working training pipeline.
 * - `verified` means the slug was probed live ON ITS OWN KEY and served.
 *   Repo history (v2.7.x–v3.7.0) is a graveyard of dead slugs that took
 *   lanes down — an unverified model must never be pinned as a lane primary.
 * - max_context is null everywhere on purpose: unknown, not invented.
 * - `chat_capable: false` models (embeddings, voice, video, detection) can
 *   NOT ride the chat() adapter; they need their own adapter before any
 *   feature may call them. Listing them here is inventory, not capability.
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
  | 'image';

export type LatencyClass = 'realtime' | 'fast' | 'medium' | 'slow' | 'unknown';
export type QualityClass = 'light' | 'medium' | 'high' | 'premium' | 'unknown';
export type CostClass = 'low' | 'medium' | 'high' | 'unknown';

export interface ModelSpec {
  /** Provider-facing slug (NVIDIA NIM unless `provider` says otherwise). */
  id: string;
  /** Cloudflare secret whose key signs this model's requests. */
  envKey: string;
  /** Owner-chosen display name (2026-08-31) — what listeners and the admin see. */
  display_name: string;
  provider: 'nvidia' | 'groq';
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
  /** Registry ids to try when this model fails (same capability family). */
  fallback_models: string[];
  /** Unknown — never invent context limits. */
  max_context: null;
  /** Live-probed serving on its own key. Only verified models may be pinned. */
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
    fallback_models: ['deepseek-v4-pro-0813', 'nemotron-3-super-120b-a12b', 'gpt-oss-120b'],
    verified: true, ...T,
    notes: 'Probed 2026-08-29: served once (16.6s cold) then HUNG 18s+. Wired as the agent lane reserve only — no feature primary, no ladder, until it stabilizes.',
  },
  'deepseek-v4-pro-0813': {
    id: 'deepseek-ai/deepseek-v4-pro-0813', envKey: 'VINAX_DEEPSEEK_V4_PRO', display_name: 'VinaX DP V4 PRO', provider: 'nvidia',
    role: 'Deep reasoning — advanced recommendations, taste analysis, DJ decision-making',
    capabilities: ['reasoning', 'generation'], latency_class: 'slow', quality_class: 'premium',
    cost_class: 'high', output_format: 'json', chat_capable: true,
    fallback_models: ['nemotron-3-super-120b-a12b', 'gpt-oss-120b'],
    verified: true, ...T,
    notes: 'Probed 2026-08-29: cold probe timed out, warm 0.59s. Ladder reserve (pro lane), not a feature primary.',
  },
  'deepseek-v4-flash-0731': {
    id: 'deepseek-ai/deepseek-v4-flash-0731', envKey: 'VINAX_DEEPSEEK_V4_FLASH', display_name: 'VinaX DP V4 FLASH', provider: 'nvidia',
    role: 'Fast AI — quick recommendations, lightweight chat, instant UI actions',
    capabilities: ['generation', 'classification'], latency_class: 'fast', quality_class: 'medium',
    cost_class: 'medium', output_format: 'json', chat_capable: true,
    fallback_models: ['gpt-oss-20b', 'nemotron-3-nano-30b-a3b'],
    verified: false, ...T,
    notes: 'Probed 2026-08-29 TWICE: hangs 18s+ with no response. DO NOT PIN until it heals; the chat lane key keeps serving gpt-oss-20b instead.',
  },
  'nemotron-3.5-lightning-30b-a3b': {
    id: 'nvidia/nemotron-3.5-lightning-30b-a3b', envKey: 'VINAX_NEMOTRON_3_5_LIGHTNING_30B_A3B', display_name: 'VinaX NVD NMTRN 3.5 LTNG 30B', provider: 'nvidia',
    role: 'High-speed reasoning — real-time AI DJ, next-song ranking, queue decisions',
    capabilities: ['reasoning', 'generation', 'ranking'], latency_class: 'realtime', quality_class: 'high',
    cost_class: 'medium', output_format: 'json', chat_capable: true,
    fallback_models: ['deepseek-v4-flash-0731', 'gpt-oss-20b'],
    verified: true, ...T,
    notes: 'Probed 2026-08-29: 7.3s cold / 0.80s warm, JSON-clean. DJ lane primary since v5.4.0, thinking off via reasoningOffParams.',
  },
  'muse-glimmer-30b': {
    id: 'nvidia/muse-glimmer-30b', envKey: 'VINAX_MUSE_GLIMMER_30B', display_name: 'VinaX MUSE GMR 30B', provider: 'nvidia',
    role: 'Music intelligence — mood interpretation, playlist themes, vibe matching, descriptions',
    capabilities: ['creative', 'generation'], latency_class: 'medium', quality_class: 'high',
    cost_class: 'medium', output_format: 'text', chat_capable: true,
    fallback_models: ['gemma-4-31b-it', 'gpt-oss-20b'],
    verified: false, ...T,
    notes: 'Probed 2026-08-29: 404 on nvidia/ and microsoft/ prefixes — slug not on the NIM catalog. Inventory only until a serving slug is known.',
  },
  'ising-calibration-1.5-31b': {
    id: 'nvidia/ising-calibration-1.5-31b', envKey: 'VINAX_ISING_CALIBRATION_1_5_31B', display_name: 'VinaX ING CALBTN 15 31B', provider: 'nvidia',
    role: 'Ranking / calibration — recommendation score calibration, personalization weighting',
    capabilities: ['ranking', 'classification'], latency_class: 'fast', quality_class: 'high',
    cost_class: 'medium', output_format: 'json', chat_capable: true,
    fallback_models: ['ising-calibration-1-35b-a3b'],
    verified: false, ...T,
    notes: 'Sibling 1-35b-a3b probed 410 Gone upstream 2026-08-29 — family looks retired. Deterministic client-side ranking stays authoritative.',
  },
  'ising-calibration-1-35b-a3b': {
    id: 'nvidia/ising-calibration-1-35b-a3b', envKey: 'VINAX_ISING_CALIBRATION_1_35B_A3B', display_name: 'VinaX ING CALBTN 1 35B A3B', provider: 'nvidia',
    role: 'Lightweight ranking — fast recommendation scoring, candidate filtering',
    capabilities: ['ranking', 'classification'], latency_class: 'realtime', quality_class: 'medium',
    cost_class: 'low', output_format: 'json', chat_capable: true,
    fallback_models: [],
    verified: false, ...T,
    notes: 'Probed 2026-08-29: 410 Gone — model retired upstream. Do not wire.',
  },
  'laguna-xs-2.1': {
    id: 'nvidia/laguna-xs-2.1', envKey: 'VINAX_LAGUNA_XS_2_1', display_name: 'VinaX LGNA XS 2.1', provider: 'nvidia',
    role: 'Lightweight AI — intent detection, simple classification, cheap background tasks',
    capabilities: ['classification', 'generation'], latency_class: 'realtime', quality_class: 'light',
    cost_class: 'low', output_format: 'json', chat_capable: true,
    fallback_models: ['nemotron-3-nano-30b-a3b'],
    verified: false, ...T,
    notes: 'Probed 2026-08-29: 404 — slug not on the NIM catalog.',
  },
  'minimax-m3': {
    id: 'minimaxai/minimax-m3', envKey: 'VINAX_MINIMAX_M3', display_name: 'VinaX MIMX M3', provider: 'nvidia',
    role: 'General AI — assistant, playlist creation, conversational features',
    capabilities: ['reasoning', 'generation'], latency_class: 'medium', quality_class: 'high',
    cost_class: 'medium', output_format: 'json', chat_capable: true,
    fallback_models: ['gpt-oss-120b', 'gpt-oss-20b'],
    verified: true, ...T,
    notes: 'Probed 2026-08-29: cold probe timed out, warm 0.41s — healed since the v2.7.2 degradation. mini lane ladder reserve; owner table (2026-08-29) is the sign-off.',
  },
  'diffusiongemma-26b-a4b-it': {
    id: 'google/diffusiongemma-26b-a4b-it', envKey: 'VINAX_DIFFUSIONGEMMA_26B_A4B_IT', display_name: 'VinaX DIF GEM 26B A4B IT', provider: 'nvidia',
    role: 'Generative AI — visual themes, creative content (text side only today)',
    capabilities: ['creative', 'generation', 'image'], latency_class: 'fast', quality_class: 'medium',
    cost_class: 'medium', output_format: 'text', chat_capable: true,
    fallback_models: ['muse-glimmer-30b'],
    verified: true, ...T,
    notes: 'Served via chat-completions (search-lane secondary since v2.7.4). Real image generation is NOT wired — never fake it through the text endpoint.',
  },
  'nemotron-3-ultra-550b-a55b': {
    id: 'nvidia/nemotron-3-ultra-550b-a55b', envKey: 'VINAX_NEMOTRON_ULTRA', display_name: 'VinaX NVD NMTRN ULT', provider: 'nvidia',
    role: 'Premium reasoning — highest-quality playlist reasoning, difficult multi-step tasks',
    capabilities: ['reasoning', 'generation'], latency_class: 'slow', quality_class: 'premium',
    cost_class: 'high', output_format: 'json', chat_capable: true,
    fallback_models: ['nemotron-3-super-120b-a12b', 'gpt-oss-120b'],
    verified: true, ...T,
    notes: 'Measured slow/flaky at big JSON under deadline (v3.5.1) — keep it LAST in latency-sensitive ladders, never first.',
  },
  'nemotron-3-nano-omni-30b-a3b-reasoning': {
    id: 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning', envKey: 'VINAX_NVIDIA_NEMOTRON_3_NANO_30B_A3B', display_name: 'VinaX NVD NMTRN', provider: 'nvidia',
    role: 'Multimodal reasoning — voice/visual command context, richer interaction',
    capabilities: ['multimodal', 'reasoning'], latency_class: 'fast', quality_class: 'medium',
    cost_class: 'medium', output_format: 'json', chat_capable: true,
    fallback_models: ['nemotron-3-nano-30b-a3b'],
    verified: false, ...T,
    notes: 'Keyed to VINAX_NEMOTRON_3_NANO_30B_A3B (the owner list has no OMNI-named secret; this is the spare nano key). Bench lane: omni.',
  },
  'gemma-4-31b-it': {
    id: 'google/gemma-4-31b-it', envKey: 'VINAX_GEMMA_4_31B_IT', display_name: 'VinaX GEM 4 31B', provider: 'nvidia',
    role: 'General assistant — chat, summaries, playlist descriptions',
    capabilities: ['generation', 'classification'], latency_class: 'fast', quality_class: 'medium',
    cost_class: 'low', output_format: 'json', chat_capable: true,
    fallback_models: ['gpt-oss-20b'],
    verified: false, ...T,
    notes: 'Probed 2026-08-29: hangs 18s+ (matches the v2.7.2 hang history). DO NOT PIN.',
  },
  'nemotron-3-super-120b-a12b': {
    id: 'nvidia/nemotron-3-super-120b-a12b', envKey: 'VINAX_NEMOTRON_SUPER', display_name: 'VinaX NVD NMTRN SUP', provider: 'nvidia',
    role: 'Advanced AI — AI DJ depth, advanced personalization, taste reasoning',
    capabilities: ['reasoning', 'generation'], latency_class: 'medium', quality_class: 'high',
    cost_class: 'medium', output_format: 'json', chat_capable: true,
    fallback_models: ['gpt-oss-120b', 'gpt-oss-20b'],
    verified: true, ...T,
    notes: 'Probed 2026-08-29: 200 in 0.55s on its own key. Deep (Think) lane primary since v5.4.0; the old 49b pin is the same-key secondary.',
  },
  'nemotron-3-nano-30b-a3b': {
    id: 'nvidia/nemotron-3-nano-30b-a3b', envKey: 'VINAX_NEMOTRON_3_NANO_30B_A3B', display_name: 'VinaX NVD NMTRN NN30B A3B', provider: 'nvidia',
    role: 'Fast background AI — intent detection, classification, quick recommendations',
    capabilities: ['classification', 'generation', 'ranking'], latency_class: 'realtime', quality_class: 'medium',
    cost_class: 'low', output_format: 'json', chat_capable: true,
    fallback_models: ['laguna-xs-2.1', 'gpt-oss-20b'],
    verified: true, ...T,
    notes: 'Search-lane primary. MUST carry reasoningOffParams (chat_template_kwargs thinking:false) or it leaks bare CoT — see ai.ts.',
  },
  'gpt-oss-20b': {
    id: 'openai/gpt-oss-20b', envKey: 'VINAX_CHATGPT_20_B', display_name: 'VinaX CGT 20B', provider: 'nvidia',
    role: 'General fallback — fast assistant, playlist generation, inexpensive requests',
    capabilities: ['generation', 'reasoning', 'classification'], latency_class: 'fast', quality_class: 'medium',
    cost_class: 'low', output_format: 'json', chat_capable: true,
    fallback_models: [],
    verified: true, ...T,
    notes: 'The proven workhorse — currently pins dj/chat/fast lanes. Cap thinking with reasoning_effort:low.',
  },
  'gpt-oss-120b': {
    id: 'openai/gpt-oss-120b', envKey: 'VINAX_CHATGPT_120_B', display_name: 'VinaX CGT 120B', provider: 'nvidia',
    role: 'Strong general fallback — complex chat, reasoning, advanced recommendations',
    capabilities: ['generation', 'reasoning'], latency_class: 'slow', quality_class: 'high',
    cost_class: 'medium', output_format: 'json', chat_capable: true,
    fallback_models: ['gpt-oss-20b'],
    verified: false, ...T,
    notes: 'RETIRED from lanes v3.7.0: NVIDIA-hosted slug HUNG on all five accounts (Cloudflare 524). Healthy on Groq. Re-probe before any re-pin.',
  },

  'groq-llama-3.3-70b': {
    id: 'llama-3.3-70b-versatile', envKey: 'VINAX_GROQ_API_KEY', display_name: 'VinaX GRQ ALL', provider: 'groq',
    role: 'Groq console key — the external fast lane (scholar/voice): instant facts and spoken replies, ~120ms TTFB',
    capabilities: ['generation', 'reasoning'], latency_class: 'realtime', quality_class: 'high',
    cost_class: 'low', output_format: 'json', chat_capable: true,
    fallback_models: ['gpt-oss-20b'],
    verified: true, ...T,
    notes: 'The one non-NVIDIA key. Serves llama-3.3-70b-versatile with llama-3.1-8b-instant as the same-key secondary.',
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

/** Env secret names the registry references — the .env.example checklist. */
export function registryEnvKeys(): string[] {
  return [...new Set(Object.values(AI_MODEL_REGISTRY).map((m) => m.envKey))].sort();
}
