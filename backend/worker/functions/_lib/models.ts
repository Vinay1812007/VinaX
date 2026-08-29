/**
 * AI_MODEL_REGISTRY — the central, model-agnostic catalog of every AI model
 * VinaX can reach (v5.4.0). One place to add, retire, or re-role a model
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
    id: 'moonshotai/kimi-k3', envKey: 'VINAX_KIMI_K3', provider: 'nvidia',
    role: 'Main AI / agent — chat, complex requests, home-screen reasoning, playlist planning',
    capabilities: ['reasoning', 'generation'], latency_class: 'medium', quality_class: 'premium',
    cost_class: 'high', output_format: 'json', chat_capable: true,
    fallback_models: ['deepseek-v4-pro-0813', 'nemotron-3-super-120b-a12b', 'gpt-oss-120b'],
    verified: true, ...T,
    notes: 'Probed 2026-08-29: served once (16.6s cold) then HUNG 18s+. Wired as the agent lane reserve only — no feature primary, no ladder, until it stabilizes.',
  },
  'deepseek-v4-pro-0813': {
    id: 'deepseek-ai/deepseek-v4-pro-0813', envKey: 'VINAX_DEEPSEEK_V4_PRO', provider: 'nvidia',
    role: 'Deep reasoning — advanced recommendations, taste analysis, DJ decision-making',
    capabilities: ['reasoning', 'generation'], latency_class: 'slow', quality_class: 'premium',
    cost_class: 'high', output_format: 'json', chat_capable: true,
    fallback_models: ['nemotron-3-super-120b-a12b', 'gpt-oss-120b'],
    verified: true, ...T,
    notes: 'Probed 2026-08-29: cold probe timed out, warm 0.59s. Ladder reserve (pro lane), not a feature primary.',
  },
  'deepseek-v4-flash-0731': {
    id: 'deepseek-ai/deepseek-v4-flash-0731', envKey: 'VINAX_DEEPSEEK_V4_FLASH', provider: 'nvidia',
    role: 'Fast AI — quick recommendations, lightweight chat, instant UI actions',
    capabilities: ['generation', 'classification'], latency_class: 'fast', quality_class: 'medium',
    cost_class: 'medium', output_format: 'json', chat_capable: true,
    fallback_models: ['gpt-oss-20b', 'nemotron-3-nano-30b-a3b'],
    verified: false, ...T,
    notes: 'Probed 2026-08-29 TWICE: hangs 18s+ with no response. DO NOT PIN until it heals; the chat lane key keeps serving gpt-oss-20b instead.',
  },
  'nemotron-3.5-lightning-30b-a3b': {
    id: 'nvidia/nemotron-3.5-lightning-30b-a3b', envKey: 'VINAX_NEMOTRON_3_5_LIGHTNING_30B_A3B', provider: 'nvidia',
    role: 'High-speed reasoning — real-time AI DJ, next-song ranking, queue decisions',
    capabilities: ['reasoning', 'generation', 'ranking'], latency_class: 'realtime', quality_class: 'high',
    cost_class: 'medium', output_format: 'json', chat_capable: true,
    fallback_models: ['deepseek-v4-flash-0731', 'gpt-oss-20b'],
    verified: true, ...T,
    notes: 'Probed 2026-08-29: 7.3s cold / 0.80s warm, JSON-clean. DJ lane primary since v5.4.0, thinking off via reasoningOffParams.',
  },
  'muse-glimmer-30b': {
    id: 'nvidia/muse-glimmer-30b', envKey: 'VINAX_MUSE_GLIMMER_30B', provider: 'nvidia',
    role: 'Music intelligence — mood interpretation, playlist themes, vibe matching, descriptions',
    capabilities: ['creative', 'generation'], latency_class: 'medium', quality_class: 'high',
    cost_class: 'medium', output_format: 'text', chat_capable: true,
    fallback_models: ['gemma-4-31b-it', 'gpt-oss-20b'],
    verified: false, ...T,
    notes: 'Probed 2026-08-29: 404 on nvidia/ and microsoft/ prefixes — slug not on the NIM catalog. Inventory only until a serving slug is known.',
  },
  'riva-translate-4b-instruct-v2': {
    id: 'nvidia/riva-translate-4b-instruct-v2', envKey: 'VINAX_RIVA_TRANSLATE_4B_INSTRUCT_V2', provider: 'nvidia',
    role: 'Translation — lyrics, multilingual chat, song/artist translations',
    capabilities: ['translation'], latency_class: 'fast', quality_class: 'high',
    cost_class: 'low', output_format: 'text', chat_capable: true,
    fallback_models: ['riva-translate-4b-instruct-v1_1'],
    verified: true, ...T,
    notes: 'Probed 2026-08-29: 200 in 0.93s. Translate lane primary since v5.4.0.',
  },
  'riva-translate-4b-instruct-v1_1': {
    id: 'nvidia/riva-translate-4b-instruct-v1_1', envKey: 'VINAX_RIVA_TRANSLATE_4B_INSTRUCT_V1_1', provider: 'nvidia',
    role: 'Translation fallback',
    capabilities: ['translation'], latency_class: 'fast', quality_class: 'medium',
    cost_class: 'low', output_format: 'text', chat_capable: true,
    fallback_models: [],
    verified: false, ...T,
    notes: 'Probed 2026-08-29: 404 — slug not on the NIM catalog. v2 runs without a same-family fallback.',
  },
  'ising-calibration-1.5-31b': {
    id: 'nvidia/ising-calibration-1.5-31b', envKey: 'VINAX_ISING_CALIBRATION_1_5_31B', provider: 'nvidia',
    role: 'Ranking / calibration — recommendation score calibration, personalization weighting',
    capabilities: ['ranking', 'classification'], latency_class: 'fast', quality_class: 'high',
    cost_class: 'medium', output_format: 'json', chat_capable: true,
    fallback_models: ['ising-calibration-1-35b-a3b'],
    verified: false, ...T,
    notes: 'Sibling 1-35b-a3b probed 410 Gone upstream 2026-08-29 — family looks retired. Deterministic client-side ranking stays authoritative.',
  },
  'ising-calibration-1-35b-a3b': {
    id: 'nvidia/ising-calibration-1-35b-a3b', envKey: 'VINAX_ISING_CALIBRATION_1_35B_A3B', provider: 'nvidia',
    role: 'Lightweight ranking — fast recommendation scoring, candidate filtering',
    capabilities: ['ranking', 'classification'], latency_class: 'realtime', quality_class: 'medium',
    cost_class: 'low', output_format: 'json', chat_capable: true,
    fallback_models: [],
    verified: false, ...T,
    notes: 'Probed 2026-08-29: 410 Gone — model retired upstream. Do not wire.',
  },
  'nemotron-3-embed-1b': {
    id: 'nvidia/nemotron-3-embed-1b', envKey: 'VINAX_NEMOTRON_3_EMBED_1B', provider: 'nvidia',
    role: 'Embeddings — song/taste vectors, semantic search, similar-song discovery',
    capabilities: ['embedding'], latency_class: 'realtime', quality_class: 'high',
    cost_class: 'low', output_format: 'vector', chat_capable: false,
    fallback_models: [],
    verified: true, ...T,
    notes: 'Probed 2026-08-29: 200 in 0.38s, 2048-dim vectors via /v1/embeddings. embed() helper wired in ai.ts; no feature consumes it yet (needs a vector store).',
  },
  'laguna-xs-2.1': {
    id: 'nvidia/laguna-xs-2.1', envKey: 'VINAX_LAGUNA_XS_2_1', provider: 'nvidia',
    role: 'Lightweight AI — intent detection, simple classification, cheap background tasks',
    capabilities: ['classification', 'generation'], latency_class: 'realtime', quality_class: 'light',
    cost_class: 'low', output_format: 'json', chat_capable: true,
    fallback_models: ['nemotron-3-nano-30b-a3b'],
    verified: false, ...T,
    notes: 'Probed 2026-08-29: 404 — slug not on the NIM catalog.',
  },
  'minimax-m3': {
    id: 'minimaxai/minimax-m3', envKey: 'VINAX_MINIMAX_M3', provider: 'nvidia',
    role: 'General AI — assistant, playlist creation, conversational features',
    capabilities: ['reasoning', 'generation'], latency_class: 'medium', quality_class: 'high',
    cost_class: 'medium', output_format: 'json', chat_capable: true,
    fallback_models: ['gpt-oss-120b', 'gpt-oss-20b'],
    verified: true, ...T,
    notes: 'Probed 2026-08-29: cold probe timed out, warm 0.41s — healed since the v2.7.2 degradation. mini lane ladder reserve; owner table (2026-08-29) is the sign-off.',
  },
  'diffusiongemma-26b-a4b-it': {
    id: 'google/diffusiongemma-26b-a4b-it', envKey: 'VINAX_DIFFUSIONGEMMA_26B_A4B_IT', provider: 'nvidia',
    role: 'Generative AI — visual themes, creative content (text side only today)',
    capabilities: ['creative', 'generation', 'image'], latency_class: 'fast', quality_class: 'medium',
    cost_class: 'medium', output_format: 'text', chat_capable: true,
    fallback_models: ['muse-glimmer-30b'],
    verified: true, ...T,
    notes: 'Served via chat-completions (search-lane secondary since v2.7.4). Real image generation is NOT wired — never fake it through the text endpoint.',
  },
  'nemotron-3-ultra-550b-a55b': {
    id: 'nvidia/nemotron-3-ultra-550b-a55b', envKey: 'VINAX_NEMOTRON_ULTRA', provider: 'nvidia',
    role: 'Premium reasoning — highest-quality playlist reasoning, difficult multi-step tasks',
    capabilities: ['reasoning', 'generation'], latency_class: 'slow', quality_class: 'premium',
    cost_class: 'high', output_format: 'json', chat_capable: true,
    fallback_models: ['nemotron-3-super-120b-a12b', 'gpt-oss-120b'],
    verified: true, ...T,
    notes: 'Measured slow/flaky at big JSON under deadline (v3.5.1) — keep it LAST in latency-sensitive ladders, never first.',
  },
  'nemotron-3.5-content-safety': {
    id: 'nvidia/nemotron-3.5-content-safety', envKey: 'VINAX_NEMOTRON_3_5_CONTENT_SAFETY', provider: 'nvidia',
    role: 'Safety — AI chat moderation, generated-content filtering',
    capabilities: ['safety', 'classification'], latency_class: 'fast', quality_class: 'high',
    cost_class: 'low', output_format: 'json', chat_capable: true,
    fallback_models: ['llama-3.1-nemotron-safety-guard-8b-v3'],
    verified: true, ...T,
    notes: 'Probed 2026-08-29: 200 in 0.52s. Safety lane primary; moderate() in ai.ts.',
  },
  'nemotron-3-nano-omni-30b-a3b-reasoning': {
    id: 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning', envKey: 'VINAX_NEMOTRON_3_NANO_OMNI_30B_A3B_REASONING', provider: 'nvidia',
    role: 'Multimodal reasoning — voice/visual command context, richer interaction',
    capabilities: ['multimodal', 'reasoning'], latency_class: 'fast', quality_class: 'medium',
    cost_class: 'medium', output_format: 'json', chat_capable: true,
    fallback_models: ['nemotron-3-nano-30b-a3b'],
    verified: false, ...T,
    notes: 'Env key not yet in the owner list with this exact name — confirm the secret name before wiring.',
  },
  'synthetic-video-detector': {
    id: 'nvidia/synthetic-video-detector', envKey: 'VINAX_SYNTHETIC_VIDEO_DETECTOR', provider: 'nvidia',
    role: 'Media safety — synthetic/manipulated video detection',
    capabilities: ['video', 'safety'], latency_class: 'unknown', quality_class: 'unknown',
    cost_class: 'unknown', output_format: 'unknown', chat_capable: false,
    fallback_models: [],
    verified: false, ...T,
    notes: 'Not a chat model; VinaX has no video-upload surface today. Inventory only.',
  },
  'active-speaker-detection': {
    id: 'nvidia/active-speaker-detection', envKey: 'VINAX_ACTIVE_SPEAKER_DETECTION', provider: 'nvidia',
    role: 'Voice — detect the active speaker in multi-speaker interaction',
    capabilities: ['voice'], latency_class: 'unknown', quality_class: 'unknown',
    cost_class: 'unknown', output_format: 'unknown', chat_capable: false,
    fallback_models: [],
    verified: false, ...T,
    notes: 'Not a chat model. Inventory only until a multi-speaker voice surface exists.',
  },
  'gemma-4-31b-it': {
    id: 'google/gemma-4-31b-it', envKey: 'VINAX_GEMMA_4_31B_IT', provider: 'nvidia',
    role: 'General assistant — chat, summaries, playlist descriptions',
    capabilities: ['generation', 'classification'], latency_class: 'fast', quality_class: 'medium',
    cost_class: 'low', output_format: 'json', chat_capable: true,
    fallback_models: ['gpt-oss-20b'],
    verified: false, ...T,
    notes: 'Probed 2026-08-29: hangs 18s+ (matches the v2.7.2 hang history). DO NOT PIN.',
  },
  'nemotron-voicechat': {
    id: 'nvidia/nemotron-voicechat', envKey: 'VINAX_NEMOTRON_VOICECHAT', provider: 'nvidia',
    role: 'Voice AI — voice assistant, voice DJ, conversational playback control',
    capabilities: ['voice', 'generation'], latency_class: 'fast', quality_class: 'high',
    cost_class: 'medium', output_format: 'text', chat_capable: true,
    fallback_models: [],
    verified: false, ...T,
    notes: 'Probed 2026-08-29: 404 on nvidia/nemotron-voicechat and nvidia/nemotron-3-voicechat — slug not on the NIM catalog. Live voice stays on the Groq scholar lane.',
  },
  'nemotron-3-super-120b-a12b': {
    id: 'nvidia/nemotron-3-super-120b-a12b', envKey: 'VINAX_NEMOTRON_SUPER', provider: 'nvidia',
    role: 'Advanced AI — AI DJ depth, advanced personalization, taste reasoning',
    capabilities: ['reasoning', 'generation'], latency_class: 'medium', quality_class: 'high',
    cost_class: 'medium', output_format: 'json', chat_capable: true,
    fallback_models: ['gpt-oss-120b', 'gpt-oss-20b'],
    verified: true, ...T,
    notes: 'Probed 2026-08-29: 200 in 0.55s on its own key. Deep (Think) lane primary since v5.4.0; the old 49b pin is the same-key secondary.',
  },
  'nemotron-3-nano-30b-a3b': {
    id: 'nvidia/nemotron-3-nano-30b-a3b', envKey: 'VINAX_NVIDIA_NEMOTRON_3_NANO_30B_A3B', provider: 'nvidia',
    role: 'Fast background AI — intent detection, classification, quick recommendations',
    capabilities: ['classification', 'generation', 'ranking'], latency_class: 'realtime', quality_class: 'medium',
    cost_class: 'low', output_format: 'json', chat_capable: true,
    fallback_models: ['laguna-xs-2.1', 'gpt-oss-20b'],
    verified: true, ...T,
    notes: 'Search-lane primary. MUST carry reasoningOffParams (chat_template_kwargs thinking:false) or it leaks bare CoT — see ai.ts.',
  },
  'streampetr': {
    id: 'nvidia/streampetr', envKey: 'VINAX_STREAMPETR', provider: 'nvidia',
    role: 'Video understanding — multimedia analysis',
    capabilities: ['video', 'multimodal'], latency_class: 'unknown', quality_class: 'unknown',
    cost_class: 'unknown', output_format: 'unknown', chat_capable: false,
    fallback_models: [],
    verified: false, ...T,
    notes: 'Not a chat model; no video surface in VinaX today. Inventory only.',
  },
  'llama-3.1-nemotron-safety-guard-8b-v3': {
    id: 'nvidia/llama-3.1-nemotron-safety-guard-8b-v3', envKey: 'VINAX_LLAMA_3_1_NEMOTRON_SAFETY_GUARD_8B_V3', provider: 'nvidia',
    role: 'Safety guard — prompt/output safety, abuse filtering',
    capabilities: ['safety', 'classification'], latency_class: 'fast', quality_class: 'medium',
    cost_class: 'low', output_format: 'json', chat_capable: true,
    fallback_models: ['nemotron-3.5-content-safety'],
    verified: true, ...T,
    notes: 'Probed 2026-08-29: 200 in 0.53s. Guard lane — safety second opinion.',
  },
  'gpt-oss-20b': {
    id: 'openai/gpt-oss-20b', envKey: 'VINAX_CHATGPT_20_B', provider: 'nvidia',
    role: 'General fallback — fast assistant, playlist generation, inexpensive requests',
    capabilities: ['generation', 'reasoning', 'classification'], latency_class: 'fast', quality_class: 'medium',
    cost_class: 'low', output_format: 'json', chat_capable: true,
    fallback_models: [],
    verified: true, ...T,
    notes: 'The proven workhorse — currently pins dj/chat/fast lanes. Cap thinking with reasoning_effort:low.',
  },
  'gpt-oss-120b': {
    id: 'openai/gpt-oss-120b', envKey: 'VINAX_CHATGPT_120_B', provider: 'nvidia',
    role: 'Strong general fallback — complex chat, reasoning, advanced recommendations',
    capabilities: ['generation', 'reasoning'], latency_class: 'slow', quality_class: 'high',
    cost_class: 'medium', output_format: 'json', chat_capable: true,
    fallback_models: ['gpt-oss-20b'],
    verified: false, ...T,
    notes: 'RETIRED from lanes v3.7.0: NVIDIA-hosted slug HUNG on all five accounts (Cloudflare 524). Healthy on Groq. Re-probe before any re-pin.',
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
