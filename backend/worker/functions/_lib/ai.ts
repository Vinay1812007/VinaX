/**
 * Shared AI chat helper — OpenAI-compatible chat endpoints, one per lane.
 *
 * 10.3 — ONE KEY PER PROVIDER. The owner deleted every per-model secret; four
 * keys remain, and each one opens its provider's whole free catalogue (listed
 * live by ./catalog.ts, selectable model by model in VinaX AI):
 *
 *   NVIDIA_API_KEY      NVIDIA      account-scoped: one key signs every hosted
 *                                   model, so every NVIDIA lane below shares it
 *   OPENROUTER_API_KEY  OpenRouter  the router lane (zero-priced models only)
 *   GROQ_API_KEY        Groq        the scholar lane, live voice, TTS, transcription
 *   GEMINI_API_KEY      Gemini      the maestro lane (transport: ./maestro.ts)
 *
 * 10.3 — those four are the PRIMARY names. Each falls back to the name it had
 * before (VINAX_NVIDIA_API_KEY, VINAX_OPENROUTER_API_KEY, VINAX_GROQ_API_KEY,
 * VINAX_GGL_GEMINI_API_KEY) while the primary is unset, so the live Worker
 * keeps answering during the switch. providerKey() is the ONLY way any code
 * reads an AI key.
 *
 * Features still talk to LANES, and lanes still pin models; only the key a
 * lane signs with changed. Lanes by provider:
 *
 *   NVIDIA      dj, chat, deep, fast, home, search, pro, mini, vision, vision90
 *   Groq        scholar
 *   OpenRouter  router
 *   Gemini      maestro
 *
 * 10.3 also removed the agent lane and the six bench lanes (dsflash, muse,
 * rank, laguna, diffusion, gemma4): each existed only to give one per-model
 * key a probe-able row, and the AI Lab now probes any catalogue model by
 * provider instead.
 *
 * Keys live ONLY here, as Cloudflare Worker secrets. The pinned-model
 * inventory (capabilities, health notes) lives in ./models.ts.
 *
 * NVIDIA_BASE_URL optional override for the NVIDIA endpoint — applies only to
 * lanes without their own LANE_BASE pin.
 */
import { isModelGone, maestroFetch } from './maestro';
import { WORKERS_AI_BASE, isWorkersAiEndpoint, workersAiBinding, workersAiFetch, type WorkersAiBinding } from './workersai';
import { dbErrorCode, sbInsert, sbRpcResult, sbSelectResult, supabaseConfigured, type SupabaseEnv } from './supabase';

export interface AiEnv {
  /** 10.3 — the four AI keys, one per provider (see the header). Read them
   * only through providerKey(). */
  NVIDIA_API_KEY?: string;
  OPENROUTER_API_KEY?: string;
  GROQ_API_KEY?: string;
  GEMINI_API_KEY?: string;
  /** 10.3 — the previous names, read only while the primary is unset. */
  VINAX_NVIDIA_API_KEY?: string;
  VINAX_OPENROUTER_API_KEY?: string;
  VINAX_GROQ_API_KEY?: string;
  /** 8.0.0 — the maestro lane's key (the flagship engine behind the DJ, the
   * Queue Builder, ranking and the Home builder). */
  VINAX_GGL_GEMINI_API_KEY?: string;
  /** Optional plain var: replaces the maestro lane's pinned model without a
   * deploy of new code when the provider publishes a newer one. */
  VINAX_MAESTRO_MODEL?: string;
  NVIDIA_BASE_URL?: string;
  /** 11.2 — the Workers AI binding (`[ai] binding = "AI"` in wrangler.toml).
   * No key: the fifth provider is configured exactly when this exists. */
  AI?: WorkersAiBinding;
}

/** 10.3 — the four providers that sign with a key. */
export type KeyProvider = 'nvidia' | 'openrouter' | 'groq' | 'gemini';
export const KEY_PROVIDERS: readonly KeyProvider[] = ['nvidia', 'openrouter', 'groq', 'gemini'];
/** 11.2 — plus Cloudflare Workers AI, served through the Worker's AI binding
 * (no key; ./workersai.ts). Every menu and report lists them in this order. */
export type AiProvider = KeyProvider | 'cloudflare';
export const AI_PROVIDERS: readonly AiProvider[] = [...KEY_PROVIDERS, 'cloudflare'];
export const PROVIDER_LABEL: Record<AiProvider, string> = { nvidia: 'NVIDIA', openrouter: 'OpenRouter', groq: 'Groq', gemini: 'Gemini', cloudflare: 'Cloudflare' };
export function isKeyProvider(p: AiProvider): p is KeyProvider {
  return p !== 'cloudflare';
}
/** 11.2 — the binding's name, where a report names a provider's secret. */
export const WORKERS_AI_BINDING = 'AI';
/** 11.2 — what providerKey() returns for Cloudflare when the binding exists: a
 * marker, not a credential. It never leaves the Worker — a Workers AI attempt
 * goes through the binding transport, never through fetch. */
export const WORKERS_AI_KEY = 'binding:AI';

/** The secret that holds each provider's single key (10.3 — the primary names). */
export type AiKeySecret = 'NVIDIA_API_KEY' | 'OPENROUTER_API_KEY' | 'GROQ_API_KEY' | 'GEMINI_API_KEY';
/** 10.3 — the name each key had before; read only while the primary is unset. */
export type AiKeyFallback = 'VINAX_NVIDIA_API_KEY' | 'VINAX_OPENROUTER_API_KEY' | 'VINAX_GROQ_API_KEY' | 'VINAX_GGL_GEMINI_API_KEY';
export const PROVIDER_ENV: Record<KeyProvider, AiKeySecret> = {
  nvidia: 'NVIDIA_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
  groq: 'GROQ_API_KEY',
  gemini: 'GEMINI_API_KEY',
};
export const PROVIDER_ENV_FALLBACK: Record<KeyProvider, AiKeyFallback> = {
  nvidia: 'VINAX_NVIDIA_API_KEY',
  openrouter: 'VINAX_OPENROUTER_API_KEY',
  groq: 'VINAX_GROQ_API_KEY',
  gemini: 'VINAX_GGL_GEMINI_API_KEY',
};
/** Every AI key secret VinaX reads by its primary name — exactly four (laneRegistry.test.ts locks it). */
export const AI_KEY_SECRETS: readonly AiKeySecret[] = KEY_PROVIDERS.map((p) => PROVIDER_ENV[p]);
/** 10.3 — the four fallback names, in the same order. */
export const AI_KEY_FALLBACKS: readonly AiKeyFallback[] = KEY_PROVIDERS.map((p) => PROVIDER_ENV_FALLBACK[p]);

const secretValue = (env: object, name: string): string => {
  const raw = (env as Record<string, unknown>)[name];
  return typeof raw === 'string' ? raw.trim() : '';
};

/** 10.3 — THE way to read an AI key: the provider's primary secret, else its
 * previous name, trimmed (a pasted secret often carries a newline); null when
 * neither is set. Every call site — lanes, catalogue, maestro, embeddings,
 * speech, voices, images, transcription, music and the owner console — goes
 * through this, so the switch to the new names is one place. */
export function providerKey(env: object, provider: AiProvider): string | null {
  if (provider === 'cloudflare') return workersAiBinding(env) ? WORKERS_AI_KEY : null;
  return secretValue(env, PROVIDER_ENV[provider]) || secretValue(env, PROVIDER_ENV_FALLBACK[provider]) || null;
}

/** 10.3 — which secret name supplies a provider's key right now (names only,
 * never the value), for the env checklist and health: the primary, the
 * fallback, or none. */
export function providerKeySource(env: object, provider: AiProvider): { name: AiKeySecret | AiKeyFallback | typeof WORKERS_AI_BINDING; fallback: boolean } | null {
  if (provider === 'cloudflare') return workersAiBinding(env) ? { name: WORKERS_AI_BINDING, fallback: false } : null;
  if (secretValue(env, PROVIDER_ENV[provider])) return { name: PROVIDER_ENV[provider], fallback: false };
  if (secretValue(env, PROVIDER_ENV_FALLBACK[provider])) return { name: PROVIDER_ENV_FALLBACK[provider], fallback: true };
  return null;
}

/** 10.3 — the key a lane signs with (its provider's), or null. */
export function laneKey(env: object, lane: Lane): string | null {
  return providerKey(env, LANE_PROVIDER[lane]);
}

const ENDPOINT = 'https://integrate.api.nvidia.com/v1/chat/completions';

/** The feature lanes. Every AI call runs on exactly one lane. */
export type Lane =
  | 'dj'
  | 'chat'
  | 'deep'
  | 'fast'
  | 'scholar'
  | 'home'
  | 'search'
  | 'pro'
  | 'mini'
  // The free-model marketplace (v5.21.0): one lane, many selectable models.
  | 'router'
  // 8.0.0 — the flagship lane: strongest music knowledge, leads the DJ,
  // the Queue Builder, ranking, playlists and the Home builder.
  | 'maestro'
  // Vision lanes — image understanding.
  | 'vision'
  | 'vision90'
  // 11.2 — Cloudflare Workers AI through the binding: explicit picks only,
  // never in the failover ladder (one small daily pool for the account).
  | 'workers';

/** 10.3 — which provider (and so which key) serves each lane. */
export const LANE_PROVIDER: Record<Lane, AiProvider> = {
  dj: 'nvidia',
  chat: 'nvidia',
  deep: 'nvidia',
  fast: 'nvidia',
  scholar: 'groq',
  home: 'nvidia',
  search: 'nvidia',
  pro: 'nvidia',
  mini: 'nvidia',
  router: 'openrouter',
  maestro: 'gemini',
  vision: 'nvidia',
  vision90: 'nvidia',
  workers: 'cloudflare',
};

/** 10.3 — the lane a listener-picked catalogue model rides: its endpoint, its
 * transport and its `@lane` label in the AI event log. */
export const PROVIDER_LANE: Record<AiProvider, Lane> = { nvidia: 'chat', openrouter: 'router', groq: 'scholar', gemini: 'maestro', cloudflare: 'workers' };

/** The secret (or, for Workers AI, the binding) a provider needs, by name. */
export function providerEnvName(provider: AiProvider): AiKeySecret | typeof WORKERS_AI_BINDING {
  return isKeyProvider(provider) ? PROVIDER_ENV[provider] : WORKERS_AI_BINDING;
}

/** Default (NVIDIA) chat-completions endpoint, honoring the env override. */
export function defaultEndpoint(env: AiEnv): string {
  return env.NVIDIA_BASE_URL || ENDPOINT;
}

/** Per-lane provider base URL (OpenAI-compatible /v1 root). Lanes not listed
 * ride the default (NVIDIA) base. scholar rides the low-latency Groq host
 * (~120 ms to first token); router rides the OpenRouter marketplace host. */
export const LANE_BASE: Partial<Record<Lane, string>> = {
  scholar: 'https://api.groq.com/openai/v1',
  router: 'https://openrouter.ai/api/v1',
  maestro: 'https://generativelanguage.googleapis.com/v1beta/openai',
  // 11.2 — not a URL: Workers AI attempts go through the binding transport.
  workers: WORKERS_AI_BASE,
};

/** Full chat-completions URL for a lane — its own provider base when pinned,
 * else the shared default. EVERY call site (chat helper, streaming chat,
 * admin bench, health pings, probes) must route through this so the
 * mixed-provider failover ladder signs each hop against its own base. */
export function laneEndpoint(env: AiEnv, lane: Lane): string {
  const base = LANE_BASE[lane];
  return base ? `${base}/chat/completions` : defaultEndpoint(env);
}

/** The scholar host is OpenAI-compatible but rejects NVIDIA-only knobs —
 * probed live: reasoning_effort -> 400 "not supported with this model" (while
 * max_tokens, response_format json_object and SSE streaming all work as-is).
 * Gate NVIDIA-specific params on this check. */
export function isGroqEndpoint(url: string): boolean {
  return url.includes('api.groq.com');
}

/** The marketplace host proxies many different upstreams, so vendor-specific
 * knobs are unsafe there too — the same gate, one host further. */
export function isRouterEndpoint(url: string): boolean {
  return url.includes('openrouter.ai');
}

/** 8.0.0 — the maestro host. OpenAI-compatible; it accepts
 * `reasoning_effort` (it maps onto the engine's thinking budget) and JSON
 * mode, and rejects the NVIDIA-only chat_template_kwargs. */
export function isMaestroEndpoint(url: string): boolean {
  return url.includes('generativelanguage.googleapis.com');
}

/** True when the endpoint is NOT the NVIDIA base — i.e. vendor-specific
 * payload knobs must be withheld. */
export function isExternalEndpoint(url: string): boolean {
  return isGroqEndpoint(url) || isRouterEndpoint(url) || isMaestroEndpoint(url) || isWorkersAiEndpoint(url);
}

/** nemotron a3b-family models reason by DEFAULT and leak BARE chain-of-thought
 * into the content stream (no <think> wrapper, so the SSE think-gate can't
 * strip it) — it once burned the search lane's whole token budget without
 * delivering a single song. Probed live: the chat_template_kwargs
 * {"thinking": false} switch turns reasoning fully OFF. Model-gated so the
 * knob never travels to any other pin or provider.
 *
 * Covers the nano family (search lane, including the -omni- variant that
 * inherited the seat in v5.21.0) and the lightning engine (same a3b template
 * family, probed VERBOSE on a one-word prompt).
 *
 * The qwen3 branch is defensive legacy (no lane pins qwen today). */
export function reasoningOffParams(model: string): Record<string, unknown> {
  if (model.includes('nemotron-3-nano')) return { chat_template_kwargs: { thinking: false } };
  if (model.includes('nemotron-3.5-lightning')) return { chat_template_kwargs: { thinking: false } };
  if (model.includes('qwen3')) return { chat_template_kwargs: { thinking: false, enable_thinking: false } };
  return {};
}

/** Pinned model per lane.
 *
 * 10.3 — the same NVIDIA models as before the key change: only the key moved
 * (every NVIDIA lane now signs with VINAX_NVIDIA_API_KEY). A listener can pick
 * any other free model from the live catalogues; these pins are what Auto and
 * every feature lane use.
 *
 * Seat history worth keeping:
 * - fast: gpt-oss-20b, with the lightning engine as same-key secondary.
 * - search: the nano-omni reasoning model; reasoning switched off through
 *   reasoningOffParams.
 * - pro / mini: kimi-k3 and mistral-large since 10.3 — the earlier pins
 *   (deepseek-v4-pro-0813, mistral-nemotron) are not on the provider's public
 *   model list.
 * - router: the marketplace default. Any zero-cost model in the live catalog
 *   can override it per call (see _lib/catalog.ts). */
export const LANE_MODEL: Record<Lane, string> = {
  dj: 'nvidia/nemotron-3.5-lightning-30b-a3b',
  chat: 'nvidia/nemotron-3.5-lightning-30b-a3b',
  deep: 'nvidia/nemotron-3-super-120b-a12b',
  fast: 'openai/gpt-oss-20b',
  // v5.23.0 — the previous pins (llama-3.3-70b-versatile / -3.1-8b-instant)
  // were RETIRED by the provider and answered 404 on every call. Catalog
  // lanes should not carry a fixed pin at all: the resolved default now comes
  // from the live free list (catalogDefaultModel in _lib/catalog.ts). These
  // two entries are only the last-resort value for the synchronous chat()
  // ladder, and both are on the provider's current working list.
  scholar: 'openai/gpt-oss-20b',
  home: 'nvidia/nemotron-3-ultra-550b-a55b',
  search: 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning',
  pro: 'moonshotai/kimi-k3',
  mini: 'mistralai/mistral-large',
  // Resolved live per request — see the scholar note. The marketplace
  // re-publishes slugs constantly, so this value is deliberately never
  // trusted on its own: every call site resolves the catalog first.
  // 11.0 — re-pinned: the earlier slug was not on the provider's public list
  // (checked 2026-10-06); this one is listed there at zero cost.
  router: 'nvidia/nemotron-3-super-120b-a12b:free',
  // 8.0.0 — VINAX_MAESTRO_MODEL overrides the pin.
  // 8.0.2 — the provider retired 2.5 flash for new accounts and names this
  // successor; if it is retired too, _lib/maestro.ts follows the provider's
  // own suggestion or its live model list.
  maestro: 'gemini-3.8-flash',
  vision: 'meta/llama-3.2-11b-vision-instruct',
  vision90: 'meta/llama-3.2-90b-vision-instruct',
  // 11.2 — the health ping / engine test default only (the cheapest curated
  // model); listeners pick from the curated list in ./workersai.ts.
  workers: '@cf/meta/llama-3.1-8b-instruct-fast',
};

/** Per-lane SECONDARY model pin — a healthy same-key variant tried on the
 * lane's OWN key right after the pinned primary and BEFORE any cross-lane
 * ladder hop. The primary always goes first, so the moment it heals upstream
 * it reclaims the lane; the secondary keeps the lane's character while the
 * primary is degraded or hanging. NVIDIA keys are account-scoped, so any
 * served model works on the one NVIDIA key. */
export const LANE_SECONDARY: Partial<Record<Lane, string>> = {
  dj: 'openai/gpt-oss-20b',
  fast: 'nvidia/nemotron-3.5-lightning-30b-a3b',
  deep: 'nvidia/nemotron-3-ultra-550b-a55b',
  chat: 'mistralai/mistral-large',
  home: 'nvidia/nemotron-3-super-120b-a12b',
  search: 'nvidia/nemotron-3.5-lightning-30b-a3b',
  mini: 'openai/gpt-oss-20b',
  scholar: 'openai/gpt-oss-120b',
  vision: 'meta/llama-3.2-90b-vision-instruct',
  vision90: 'meta/llama-3.2-11b-vision-instruct',
  // 8.0.2 — no fixed secondary for maestro: a guessed sibling slug can be
  // retired too, and _lib/maestro.ts already resolves a live replacement.
};

/** The lanes that sign with a key (every lane but the 11.2 binding lane). */
export type KeyLane = Exclude<Lane, 'workers'>;
/** Env var that holds each keyed lane's key — derived from LANE_PROVIDER, so a
 * lane can never point at a secret outside the four (10.3). The Workers AI
 * lane has no secret and is not listed (11.2). */
export const LANE_ENV: Record<KeyLane, AiKeySecret> = Object.fromEntries(
  (Object.keys(LANE_PROVIDER) as Lane[]).flatMap((l) => {
    const p = LANE_PROVIDER[l];
    return isKeyProvider(p) ? [[l, PROVIDER_ENV[p]]] : [];
  }),
) as Record<KeyLane, AiKeySecret>;

/** Cross-lane failover ladder: when a lane's own model is missing or dead,
 * the next live pair takes the call — one dead model never takes a feature
 * down, it just degrades to a healthy sibling lane.
 *
 * v5.23.0 order, set from the 2026-09-09 probe rather than from intent: the
 * lanes that actually answered go first (chat 625ms, search 688ms, deep
 * 801ms, fast 1.2s, dj 3.9s), the two reserves that came back unreachable
 * sink below them, and the 550B home lane stays last because it answered in
 * 25s. A dead reserve high in the ladder costs every rescued call a wasted
 * hop.
 *
 * The vision lanes are NEVER in the general ladder — an image model must not
 * answer a DJ JSON call. `router` is out too: chat() is synchronous about
 * model choice and a catalog lane has no trustworthy fixed slug, so it is
 * only used where the catalog can be resolved first (the assistant, the
 * bench, health). */
const LADDER: Lane[] = ['chat', 'search', 'deep', 'fast', 'dj', 'scholar', 'mini', 'pro', 'maestro', 'home'];
// 8.2.0 — the flagship lane is a LATE fallback in the general ladder: a pinned
// seat (the assistant, the lyrics tools, every chat engine) can now reach it
// when all the everyday lanes are down, without spending its small quota
// while they are healthy. With no key set it is skipped like any other lane.

/** The general failover ladder, for callers that walk it themselves (the
 * streaming chat route). A copy: nobody may reorder the shared one. */
export function defaultLadder(): Lane[] {
  return [...LADDER];
}

export interface LaneAttempt {
  key: string;
  model: string;
  role: Lane;
  /** Full chat-completions URL for THIS attempt's lane — providers are mixed
   * now, so every ladder hop must carry its own base alongside key+model. */
  endpoint: string;
  /** 10.3 — a listener's exact catalogue pick: this model or nothing. The
   * maestro transport must not swap a "gone" pick for another model, or the
   * reply would name an engine that never answered. */
  exact?: boolean;
}

/**
 * A value that is a credential, not a model name. Live on 2026-09-26 the
 * owner stored the API key itself in VINAX_MAESTRO_MODEL, so every call
 * asked the provider for a model called "AQ.…" (400) and the key was printed
 * in the request log. Provider key shapes: AQ., AIza, sk-, gsk_, nvapi-,
 * and anything with a long run of mixed-case letters and digits.
 */
export function looksLikeSecret(value: string): boolean {
  const v = value.trim();
  if (/^(AQ\.|AIza|sk-|gsk_|nvapi-|hf_|xai-|pk_|rk_)/.test(v)) return true;
  return v.length >= 32 && /[A-Z]/.test(v) && /[a-z]/.test(v) && /\d/.test(v) && !/[\s/:]/.test(v) && !/^gemini/i.test(v);
}

/** A model slug as providers publish them: lowercase, "gemini-3.8-flash", "meta/llama-3.2-11b:free". */
const MODEL_SLUG = /^[a-z0-9][a-z0-9._-]{1,60}(?:\/[a-z0-9][a-z0-9._-]{1,60})?(?::[a-z0-9-]{1,20})?$/;

/** The lane's pinned model, honouring the maestro override var. A value that
 * is not a model slug (a pasted key, a sentence) is ignored and logged once. */
let warnedOverride = false;
export function laneModel(env: AiEnv, lane: Lane): string {
  if (lane === 'maestro') {
    const override = typeof env.VINAX_MAESTRO_MODEL === 'string' ? env.VINAX_MAESTRO_MODEL.trim() : '';
    if (override && MODEL_SLUG.test(override) && !looksLikeSecret(override)) return override;
    if (override && !warnedOverride) {
      warnedOverride = true;
      console.log(`[ai] VINAX_MAESTRO_MODEL ignored: ${looksLikeSecret(override) ? 'it looks like a key, not a model name' : 'not a model slug'} (using ${LANE_MODEL.maestro})`);
    }
  }
  return LANE_MODEL[lane];
}

/** What a log line may say about a model: a key-shaped value is masked. */
export function loggableModel(model: string): string {
  return looksLikeSecret(model) ? '[masked]' : model;
}

/** 10.3 — the single attempt for a listener's exact catalogue pick on its
 * provider's key, or null when that key is not set. */
export function providerAttempt(env: AiEnv, provider: AiProvider, model: string): LaneAttempt | null {
  const key = providerKey(env, provider);
  if (!key) return null;
  const role = PROVIDER_LANE[provider];
  return { key, model, role, endpoint: laneEndpoint(env, role), exact: true };
}

/** Two attempts that would send the same request to the same place. */
export function sameCall(a: LaneAttempt, b: LaneAttempt): boolean {
  return a.endpoint === b.endpoint && a.key === b.key && a.model === b.model;
}

/** Ordered key+model+endpoint attempts for a lane: its own pair first, then
 * its same-key secondary pin (when one exists), then the cross-lane ladder.
 * Each attempt carries its lane's endpoint so mixed-provider failover signs
 * every hop against the right base.
 *
 * 10.3 — every NVIDIA lane shares one key now, so two lanes pinning the same
 * model would be the very same request twice (dj and chat both pin the
 * lightning engine); such a repeat is left out of the walk. */
export function laneAttempts(env: AiEnv, lane: Lane, modelOverride?: string, ladder?: Lane[], skipSecondary = false): LaneAttempt[] {
  const out: LaneAttempt[] = [];
  const push = (a: LaneAttempt): void => {
    if (!out.some((b) => sameCall(a, b))) out.push(a);
  };
  const add = (l: Lane, model?: string): void => {
    const key = laneKey(env, l);
    if (key && !out.some((a) => a.role === l)) {
      push({ key, model: model ?? laneModel(env, l), role: l, endpoint: laneEndpoint(env, l) });
    }
  };
  add(lane, modelOverride);
  // Same-lane secondary: keeps the lane's character when the pinned primary
  // is degraded — consulted before any cross-lane ladder hop.
  const secondary = skipSecondary ? undefined : LANE_SECONDARY[lane];
  const ownKey = laneKey(env, lane);
  if (secondary && ownKey) push({ key: ownKey, model: secondary, role: lane, endpoint: laneEndpoint(env, lane) });
  for (const l of ladder ?? LADDER) add(l);
  return out;
}

/**
 * Cooldowns — per isolate, on purpose.
 *
 * 8.0.0 — a key that answered 429 is skipped for a while instead of costing
 * every call in that window a wasted round trip (the maestro key may sit on a
 * small free quota).
 *
 * 8.2.0 — more failure classes cool down, and the streaming chat route obeys
 * the same table as chat() (it used to walk its own ladder and hit a
 * quota-dead lane first on every turn):
 *   429                    rate limit    model, as long as the provider says (cooldownFor)
 *   429 with a free-tier limit of 0 (10.3)
 *                          not free      model, 24 h — and it leaves the catalogue
 *   404 / 410, or a 400 that says the model is gone
 *                          model gone    model, 1 h
 *   401 / 402              key rejected  the whole KEY (every model on it), 10 min
 *   403                    not entitled  model, 10 min (some providers answer 403
 *                          for one model the key may not use; its secondary may work)
 *   5xx                    upstream      model, 30 s
 * Timeouts and plain 400s do not cool down: a slow answer or a bad request
 * says nothing lasting about the engine.
 *
 * 10.3 — KEY-AWARE. One key per provider means a cooldown belongs to the
 * provider, not to the lane that happened to see it: a 401 on the deep lane
 * is a rejected NVIDIA key, so every NVIDIA lane rests with it, and a 429 on
 * gpt-oss-20b rests that model wherever it is pinned (fast, the dj and mini
 * secondaries). The functions keep their lane-shaped signatures; the lane is
 * mapped to its provider through LANE_PROVIDER.
 *
 * The state lives in module memory, so each Worker isolate learns on its own
 * and forgets on restart. That is deliberate: no storage round trip on the
 * hot path, and a wrong verdict heals by itself within minutes. The price is
 * that a fresh isolate pays one failed hop before it learns.
 */
const COOLDOWN_MS = 60_000;
export const DAILY_COOLDOWN_MS = 60 * 60_000;
const MAX_COOLDOWN_MS = 6 * 60 * 60_000;
export const MODEL_GONE_COOLDOWN_MS = 60 * 60_000;
export const KEY_REJECTED_COOLDOWN_MS = 10 * 60_000;
export const UPSTREAM_COOLDOWN_MS = 30_000;
export const NOT_FREE_COOLDOWN_MS = 24 * 60 * 60_000;

/**
 * 8.0.4 — how long a 429 should keep a model aside. The maestro provider
 * says so itself: a `retryDelay` ("37s") for a per-minute limit, a per-day
 * quota id, or "exceeded your current quota … billing" when the key's
 * allowance is used up. Live on 2026-09-26 the owner's key answered the
 * billing form on every call; retrying each minute only spent a round trip
 * per call. Other providers get the plain 60 s.
 */
export function cooldownFor(body: string): number {
  const delay = body.match(/"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/i);
  if (/PerDay|per day|daily/i.test(body)) return DAILY_COOLDOWN_MS;
  if (delay) return Math.min(MAX_COOLDOWN_MS, Math.max(COOLDOWN_MS, Math.ceil(Number(delay[1]) * 1000)));
  if (/exceeded your current quota|check your plan and billing/i.test(body)) return DAILY_COOLDOWN_MS;
  return COOLDOWN_MS;
}

/**
 * 10.3 — a 429 whose free-tier allowance for this model is ZERO: the model is
 * listed for the key but not free on it (the Gemini API answers
 * "Quota exceeded for metric: …free_tier_requests, limit: 0" and a
 * QuotaFailure with quotaValue "0"). Waiting does not help, so the model rests
 * for a day and the catalogue leaves it out meanwhile.
 */
export function isZeroFreeQuota(body: string): boolean {
  return /\blimit:\s*0\b/i.test(body) || /"quotaValue"\s*:\s*"0"/.test(body);
}

export type CooldownReason = 'rate_limited' | 'not_free' | 'model_gone' | 'key_rejected' | 'upstream_error';
export interface Cooldown {
  ms: number;
  /** `model` = this provider+model only; `lane` = every model on the provider's key. */
  scope: 'model' | 'lane';
  reason: CooldownReason;
}

/** 8.2.0 — the cooldown an error answer earns, or null when it earns none. Pure. */
export function cooldownForFailure(status: number, body: string): Cooldown | null {
  if (status === 429 && isZeroFreeQuota(body)) return { ms: NOT_FREE_COOLDOWN_MS, scope: 'model', reason: 'not_free' };
  if (status === 429) return { ms: cooldownFor(body), scope: 'model', reason: 'rate_limited' };
  if (status === 404 || status === 410 || (status === 400 && isModelGone(400, body))) return { ms: MODEL_GONE_COOLDOWN_MS, scope: 'model', reason: 'model_gone' };
  if (status === 401 || status === 402) return { ms: KEY_REJECTED_COOLDOWN_MS, scope: 'lane', reason: 'key_rejected' };
  if (status === 403) return { ms: KEY_REJECTED_COOLDOWN_MS, scope: 'model', reason: 'key_rejected' };
  if (status >= 500 && status <= 599) return { ms: UPSTREAM_COOLDOWN_MS, scope: 'model', reason: 'upstream_error' };
  return null;
}

const cooldowns = new Map<string, number>();
/** 11.2 — why each cooldown above was set (the last verdict), so a listener's
 * own pick can be told WHY it is resting instead of being swapped. */
const restReasons = new Map<string, CooldownReason>();
/** 10.3 — models a key lists but may not use for free, until when. */
const notFree = new Map<string, number>();
const coolKey = (provider: AiProvider, model: string): string => `${provider}|${model}`;
const keyCoolKey = (provider: AiProvider): string => `${provider}|*`;
const coolingUntil = (map: Map<string, number>, key: string, now: number): boolean => {
  const until = map.get(key);
  if (until === undefined) return false;
  if (until <= now) {
    map.delete(key);
    return false;
  }
  return true;
};
/** True while this provider+model (or the provider's whole key) is set aside. */
export function providerCoolingDown(provider: AiProvider, model: string, now = Date.now()): boolean {
  return coolingUntil(cooldowns, keyCoolKey(provider), now) || coolingUntil(cooldowns, coolKey(provider, model), now);
}
/** 11.2 — while a provider+model (or the provider's whole key) is set aside:
 * until when, and why (null when the reason was not recorded). Null when it
 * is not resting. */
export function providerRest(provider: AiProvider, model: string, now = Date.now()): { until: number; reason: CooldownReason | null } | null {
  for (const key of [keyCoolKey(provider), coolKey(provider, model)]) {
    if (coolingUntil(cooldowns, key, now)) return { until: cooldowns.get(key) as number, reason: restReasons.get(key) ?? null };
  }
  return null;
}
/** True while this lane's model (or its provider's whole key) is set aside. */
export function laneCoolingDown(role: Lane, model: string, now = Date.now()): boolean {
  return providerCoolingDown(LANE_PROVIDER[role], model, now);
}
/** 10.3 — true while a model is known to have no free allowance on its key. */
export function notFreeCooling(provider: AiProvider, model: string, now = Date.now()): boolean {
  return coolingUntil(notFree, coolKey(provider, model), now);
}
/** Set a model (scope `model`) or the lane's whole provider key (scope
 * `lane`) aside for `ms`. Never shortens a longer cooldown already in force. */
export function markCooldown(role: Lane, model: string, ms: number, scope: 'model' | 'lane' = 'model', now = Date.now()): void {
  markProviderCooldown(LANE_PROVIDER[role], model, ms, scope, now);
}
/** 10.3 — the provider-shaped form of markCooldown (media routes have no lane). */
export function markProviderCooldown(provider: AiProvider, model: string, ms: number, scope: 'model' | 'lane' = 'model', now = Date.now()): void {
  const key = scope === 'lane' ? keyCoolKey(provider) : coolKey(provider, model);
  const until = now + ms;
  if ((cooldowns.get(key) ?? 0) < until) cooldowns.set(key, until);
}
/** Record a failed attempt: applies the cooldown its status earns (if any)
 * and returns it, so a caller can log why a lane went quiet. */
export function noteLaneFailure(role: Lane, model: string, status: number, body = ''): Cooldown | null {
  return noteFailure(LANE_PROVIDER[role], model, status, body, `lane=${role} `);
}
/** 10.3 — the same verdict for a media call (image, speech, transcription,
 * music) that has a provider and a model but no lane: a 429 with a free-tier
 * limit of 0 rests the model for a day and hides it from the media lists too. */
export function noteProviderFailure(provider: AiProvider, model: string, status: number, body = ''): Cooldown | null {
  return noteFailure(provider, model, status, body, '');
}
function noteFailure(provider: AiProvider, model: string, status: number, body: string, prefix: string): Cooldown | null {
  const c = cooldownForFailure(status, body);
  if (!c) return null;
  markProviderCooldown(provider, model, c.ms, c.scope);
  restReasons.set(c.scope === 'lane' ? keyCoolKey(provider) : coolKey(provider, model), c.reason);
  if (c.reason === 'not_free') notFree.set(coolKey(provider, model), Date.now() + c.ms);
  // 11.2 — Workers AI models come from a curated list, not a live one: a model
  // the binding says does not exist rests for a day and leaves the list.
  if (c.reason === 'model_gone' && provider === 'cloudflare') {
    markProviderCooldown(provider, model, NOT_FREE_COOLDOWN_MS);
    notFree.set(coolKey(provider, model), Date.now() + NOT_FREE_COOLDOWN_MS);
  }
  console.log(`[ai] cooldown ${prefix}provider=${provider}${c.scope === 'model' ? ` model=${loggableModel(model)}` : ' (whole key)'} reason=${c.reason} s=${Math.round(c.ms / 1000)}`);
  return c;
}
/** Test hook. */
export function clearLaneCooldowns(): void {
  cooldowns.clear();
  restReasons.clear();
  notFree.clear();
}

/** `disabled` / `over_budget` (7.2.0): refused by the owner's AI controls before any provider was called. */
/** `invalid_output` (8.2.0): every engine that answered was refused by the caller's `accept` check. */
export type ChatError = 'not_configured' | 'unreachable' | 'failed' | 'invalid_output' | AiBlock;

/** Provider-reported token usage for one call (OpenAI-compatible `usage`). */
export interface TokenUsage {
  prompt_tokens: number;
  completion_tokens: number;
}

export interface ChatResult {
  content: string | null;
  model: string | null;
  /** Which lane's key served the call — routing proof for observability. */
  keyRole?: string;
  error?: ChatError;
  status?: number;
  /** Token usage of the attempt that answered, when the provider sent it
   * (v5.16.0 — feeds the admin AI Cost panel through logAiEvent). */
  usage?: TokenUsage;
}

const toInt = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.round(v) : null;

/**
 * Pull `{prompt_tokens, completion_tokens}` out of a provider JSON body or a
 * streamed SSE chunk. Accepts the OpenAI-compatible top-level `usage` object
 * and the scholar lane's provider-specific `x_groq.usage` envelope (that
 * provider reports usage on its final streamed chunk without being asked).
 * Returns null unless BOTH counts are present as non-negative numbers, so a
 * partial or malformed usage block never logs a half-truth.
 */
export function usageFromJson(j: unknown): TokenUsage | null {
  if (!j || typeof j !== 'object') return null;
  const o = j as { usage?: unknown; x_groq?: { usage?: unknown } };
  const u = (o.usage ?? o.x_groq?.usage) as { prompt_tokens?: unknown; completion_tokens?: unknown } | null | undefined;
  if (!u || typeof u !== 'object') return null;
  const prompt = toInt(u.prompt_tokens);
  const completion = toInt(u.completion_tokens);
  if (prompt === null || completion === null) return null;
  return { prompt_tokens: prompt, completion_tokens: completion };
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/** Call a lane's chat API (each attempt on its own provider base), failing
 * over across the lane ladder; returns assistant text. */
export async function chat(
  env: AiEnv,
  messages: ChatMessage[],
  opts: {
    temperature?: number;
    maxTokens?: number;
    /** Feature lane — picks the key and the pinned model. Default: chat. */
    lane?: Lane;
    /** Model override for the lane's own key (failover pairs keep their models). */
    model?: string;
    json?: boolean;
    reasoningEffort?: 'low' | 'medium' | 'high';
    timeoutMs?: number;
    /** Optional shorter leash for the FIRST (lane-pinned) attempt only: a cold
     * or unresponsive pinned model gets a fair shot without starving the
     * failover ladder of budget. Laddered attempts use timeoutMs. */
    firstTimeoutMs?: number;
    /** v6.5.2 — skip the lane's same-key secondary pin: when the lane's host
     *  is the slow part (measured live: both NVIDIA pins timing out back to
     *  back), the ladder's first cross-host lane should get the budget. */
    skipSecondary?: boolean;
    /** Per-call failover order override — time-critical big-JSON jobs put the
     * fastest reliable generator first. Default: the global key ladder. */
    ladder?: Lane[];
    /** Aggregate wall-clock deadline (epoch ms). The lane failover ladder
     * never starts an attempt past it, so callers get an answer or a fast,
     * honest failure instead of stacked retries that outlive client patience
     * (DQA-02). */
    deadlineAt?: number;
    /** 7.2.0 — the product feature this call serves, for the owner's per-feature
     * switch. Without it only the emergency stop and the spend caps apply. */
    feature?: AiFeature;
    /** 8.2.0 — the caller's check on a 200 answer (JSON that parses, at least
     * one valid pick…). An answer it refuses counts as a failed attempt and
     * the next lane/model is asked, inside the same deadline; a throw counts
     * as a refusal. When every answer is refused the error is
     * `invalid_output`. Refusals never cool a lane down. */
    accept?: (content: string) => boolean;
  } = {},
): Promise<ChatResult> {
  const lane = opts.lane ?? 'chat';
  // The lane's own key+model first, then the cross-lane failover ladder — a
  // dead or missing key degrades gracefully instead of failing the feature.
  const attempts = laneAttempts(env, lane, opts.model, opts.ladder, opts.skipSecondary === true);
  if (!attempts.length) return { content: null, model: null, error: 'not_configured' };
  // 7.2.0 — the owner's switches and spend caps, before any provider call.
  const blocked = await aiGate(env, opts.feature);
  if (blocked) return { content: null, model: null, error: blocked };
  const wantJson = opts.json === true;
  let lastStatus = 0;
  let attemptNo = 0;
  // 8.2.0 — true while the most recent failure was the caller refusing an answer.
  let lastRefused = false;
  const failure = (status: number): ChatResult => ({ content: null, model: null, error: lastRefused ? 'invalid_output' : 'failed', status });
  for (const { key, model, role, endpoint } of attempts) {
    if (laneCoolingDown(role, model)) {
      console.log(`[ai] lane=${role} model=${loggableModel(model)} status=cooldown`);
      lastStatus = lastStatus || 429;
      continue;
    }
    attemptNo += 1;
    // Prefer strict JSON output when asked. If a model rejects response_format
    // with a 400, retry the SAME model once in plain mode so guided JSON is a
    // pure win on models that support it and a no-op on those that don't.
    for (let jsonAttempt = wantJson ? 0 : 1; jsonAttempt < 2; jsonAttempt += 1) {
      // Aggregate budget check: never START an attempt we can't finish.
      const remainingMs = opts.deadlineAt ? opts.deadlineAt - Date.now() : Infinity;
      if (remainingMs <= 1500) return failure(lastStatus || 408);
      const useJson = wantJson && jsonAttempt === 0;
      const payload: Record<string, unknown> = {
        model,
        temperature: opts.temperature ?? 0.7,
        max_tokens: opts.maxTokens ?? 6000,
        messages,
      };
      // gpt-oss are reasoning models: cap the thinking so they respond fast and
      // don't burn the token budget before emitting the answer. Others ignore
      // it on the NVIDIA base — but the external hosts 400 on reasoning_effort
      // (probed live), so the knob never travels off the NVIDIA base.
      // v6.5.2 — measured live on the Groq host: without this knob gpt-oss-20b
      // spent its whole completion budget reasoning (finish=length, 6–8k
      // characters of reasoning, empty content) on every DJ set, and JSON
      // mode failed with json_validate_failed. Groq documents reasoning_effort
      // for the gpt-oss models; only the marketplace router still withholds it.
      if (model.includes('gpt-oss') && !isRouterEndpoint(endpoint)) payload.reasoning_effort = opts.reasoningEffort ?? 'low';
      // 8.0.0 — the maestro engine thinks before it answers; the effort knob
      // caps that budget, and the output ceiling gets headroom for it so a
      // short JSON answer is never cut off by its own reasoning.
      if (isMaestroEndpoint(endpoint)) {
        payload.reasoning_effort = opts.reasoningEffort ?? 'low';
        payload.max_tokens = (opts.maxTokens ?? 6000) + 1024;
      }
      // nemotron a3b-family models leak BARE chain-of-thought unless reasoning
      // is switched off at the chat-template level (probed live — see
      // reasoningOffParams). Model-gated: a no-op for every other pin.
      // NVIDIA base only: the same model family is listed under matching names
      // on the other hosts, which reject or ignore chat_template_kwargs.
      if (!isExternalEndpoint(endpoint)) Object.assign(payload, reasoningOffParams(model));
      // Force valid JSON (no preamble / markdown fences): fewer parse failures
      // and fewer wasted output tokens.
      if (useJson) payload.response_format = { type: 'json_object' };

      const controller = new AbortController();
      const startedAt = Date.now();
      const leash = attemptNo === 1 ? (opts.firstTimeoutMs ?? opts.timeoutMs ?? 20_000) : (opts.timeoutMs ?? 20_000);
      const timer = setTimeout(() => controller.abort(), Math.min(leash, remainingMs));
      let res: Response;
      try {
        // 8.0.1 — the maestro lane speaks through its own transport (the
        // provider's key shapes need different endpoints; see _lib/maestro.ts).
        res = isMaestroEndpoint(endpoint)
          ? await maestroFetch(key, model, payload, controller.signal)
          : isWorkersAiEndpoint(endpoint)
            ? await workersAiFetch(workersAiBinding(env), payload, controller.signal)
            : await fetch(endpoint, {
              method: 'POST',
              headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
              body: JSON.stringify(payload),
              signal: controller.signal,
            });
      } catch {
        // Network error or timeout: fail over to the next lane pair.
        clearTimeout(timer);
        console.log(`[ai] lane=${role} model=${loggableModel(model)} status=timeout ms=${Date.now() - startedAt} leash=${Math.min(leash, remainingMs)}`);
        lastStatus = 0;
        lastRefused = false;
        break;
      }
      // The leash stays armed through the BODY read below: an engine that sends
      // headers and then stalls would otherwise hold the route open to the
      // platform limit, because nothing else enforces deadlineAt mid-read. An
      // abort there surfaces as a blank answer and the ladder walks on.
      // v6.5.2 — one compact line per attempt so `wrangler tail` shows which
      // engine answered, how fast, or why it did not (no secrets, no prompt).
      console.log(`[ai] lane=${role} model=${loggableModel(model)} status=${res.status} ms=${Date.now() - startedAt}`);
      if (res.ok) {
        const data = (await res.json().catch(() => null)) as
          | { choices?: Array<{ message?: { content?: unknown; reasoning_content?: unknown; reasoning?: unknown }; finish_reason?: unknown }>; usage?: unknown }
          | null;
        clearTimeout(timer);
        const msg = data?.choices?.[0]?.message;
        const usage = usageFromJson(data) ?? undefined;
        // Reasoning models (deep lane) may wrap chain-of-thought in
        // <think>…</think> inside content — strip it so internal reasoning
        // never reaches a caller or pollutes JSON extraction. Some engines
        // put the whole answer in reasoning_content with an empty content —
        // that stays as a last-resort fallback.
        const clean = (s: unknown): string | null => {
          if (typeof s !== 'string') return null;
          const t = s.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
          return t || null;
        };
        const content = clean(msg?.content) ?? clean(msg?.reasoning_content);
        if (content && opts.accept && !acceptable(opts.accept, content)) {
          // 8.2.0 — a 200 the caller cannot use (unparseable JSON, no valid
          // pick) is a failed attempt: the next engine gets the question.
          console.log(`[ai] refused lane=${role} model=${loggableModel(model)} len=${content.length}`);
          lastStatus = 200;
          lastRefused = true;
          break;
        }
        if (content) return { content, model, keyRole: role, ...(usage ? { usage } : {}) };
        // 200 but blank — fail over to the next lane pair. Say why: a
        // reasoning model that spent the whole token budget thinking shows
        // up here as finish=length with a long `reasoning` field.
        const c0 = data?.choices?.[0];
        console.log(`[ai] blank lane=${role} model=${loggableModel(model)} finish=${String(c0?.finish_reason ?? '?')} keys=${msg ? Object.keys(msg).join(',') : 'none'} reasoning_len=${typeof msg?.reasoning === 'string' ? msg.reasoning.length : 0} completion=${usage?.completion_tokens ?? '?'}`);
        lastStatus = 200;
        lastRefused = false;
        break;
      }
      lastStatus = res.status;
      lastRefused = false;
      // The provider's own words, clipped (error envelopes carry no secrets).
      const fullBody = await res.text().catch(() => '');
      const errBody = fullBody.replace(/\s+/g, ' ').slice(0, 200);
      clearTimeout(timer);
      console.log(`[ai] error lane=${role} model=${loggableModel(model)} status=${res.status} json=${useJson} body=${errBody}`);
      // 8.2.0 — 429, a gone model, a rejected key and a 5xx each set the
      // lane (or lane+model) aside for a while; see cooldownForFailure.
      const cooled = noteLaneFailure(role, model, res.status, fullBody);
      // JSON mode unsupported on this model -> retry it once in plain mode
      // (not when the answer said the model itself is gone).
      if (res.status === 400 && useJson && !cooled) continue;
      // Anything else (dead/exhausted key 401/402/403/429, unknown model
      // 400/404, upstream 5xx) -> next key+model pair in the ladder.
      break;
    }
  }
  return failure(lastStatus);
}

/** The caller's accept check, where a throw is a refusal. */
function acceptable(accept: (content: string) => boolean, content: string): boolean {
  try {
    return accept(content) === true;
  } catch {
    return false;
  }
}

/**
 * Cooperative gathering: run the SAME prompt on several LANES in parallel and
 * return every non-empty response. Used to widen the idea/candidate pool
 * before a single strong lane curates the final answer. Failures are skipped;
 * latency is one slow lane, not the sum.
 */
export async function gather(
  env: AiEnv,
  messages: ChatMessage[],
  lanes: Lane[],
  opts: GatherOpts = {},
): Promise<string[]> {
  return (await gatherDetailed(env, messages, lanes, opts)).map((r) => r.content);
}

export interface GatherOpts {
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
  deadlineAt?: number;
  /** 7.2.0 — the product feature this round serves (owner per-feature switch). */
  feature?: AiFeature;
  /** Co-work mode (v5.24.0). When true each participating lane is restricted
   *  to its OWN key — no cross-lane failover hop.
   *
   *  Why it matters: chat() normally walks the shared ladder, so three lanes
   *  whose own engines are cold all degrade onto the same healthy sibling and
   *  return three near-identical pools. That is not a panel of engines, it is
   *  one engine billed three times. With soloLadder the roster is honest: a
   *  lane either contributes its own perspective or abstains, and the caller
   *  sees exactly who answered. */
  soloLadder?: boolean;
}

/** One participant's contribution to a gather round. */
export interface GatherResult {
  /** The lane asked. */
  lane: Lane;
  /** The model that actually answered (may differ when failover is allowed). */
  model: string | null;
  content: string;
  ms: number;
}

/**
 * Cooperative gathering: run the SAME prompt on several LANES in parallel and
 * return every non-empty response WITH the engine that produced it. Used to
 * widen the idea/candidate pool before a single strong lane curates the final
 * answer. Failures are skipped; latency is one slow lane, not the sum — so
 * adding a participant costs tokens, never wall-clock.
 *
 * Attribution is the point of the detailed variant: a co-work round that
 * cannot say which engines took part cannot be shown, tuned, or trusted.
 */
export async function gatherDetailed(
  env: AiEnv,
  messages: ChatMessage[],
  lanes: Lane[],
  opts: GatherOpts = {},
): Promise<GatherResult[]> {
  // 7.2.0 — a switched-off feature or a reached cap spends nothing on pitches.
  if (await aiGate(env, opts.feature)) return [];
  const settled = await Promise.allSettled(
    lanes.map(async (lane) => {
      const started = Date.now();
      const r = await chat(env, messages, {
        temperature: opts.temperature,
        maxTokens: opts.maxTokens,
        timeoutMs: opts.timeoutMs,
        deadlineAt: opts.deadlineAt,
        lane,
        json: true,
        reasoningEffort: 'low',
        feature: opts.feature,
        // An empty ladder keeps the participant on its own key+secondary.
        ...(opts.soloLadder ? { ladder: [] as Lane[] } : {}),
      });
      return { lane, model: r.model, content: r.content ?? '', ms: Date.now() - started };
    }),
  );
  const out: GatherResult[] = [];
  for (const s of settled) if (s.status === 'fulfilled' && s.value.content) out.push(s.value);
  return out;
}

// ============================================================================
// 7.2.0 — owner AI controls: emergency switch, per-feature switches and daily
// spend caps, enforced here so every entry point (chat, gather, and the
// streaming routes through aiGate) obeys them.
//
// The owner publishes vinax_config key `ai-controls` (strictly validated by
// /api/admin/appconfig with validateAiControls). Each isolate caches it: a
// good read is refreshed after CONTROLS_TTL_MS; a failed refresh is logged
// and FAILS OPEN (today's behaviour: every feature on, no caps), except that
// an emergencyOff: true read within the last CONTROLS_MAX_AGE_MS keeps
// applying until that age — a flaky database cannot lift an emergency stop
// early, and cannot hold AI off for more than a minute after it was lifted.
//
// Observed use = today's (UTC) token sums from vinax_ai_events, read with a
// bounded aggregate (the vinax_ai_usage_since RPC; a 10,000-row sample until
// that migration is applied) and cached per isolate for USAGE_TTL_MS. Cost is
// estimated with the same operator price table the AI Cost panel uses
// (`ai-prices`); tokens on an unpriced model, or calls whose provider sent no
// usage, make the estimate a LOWER BOUND ("not known"), never a zero. A cap
// blocks only when the known part alone reaches it; a failed usage read fails
// open. Caps are soft by up to one cache period plus in-flight calls.
// ============================================================================

// 10.3 — `transcribe` (speech to text) and `music` (music generation) join
// the list; like every switch they are on unless set to exactly false.
export const AI_FEATURES = ['dj', 'curate-metadata', 'curate-ranking', 'curate-home', 'curate-shelves', 'playlist', 'vinaxai', 'assistant', 'tts', 'lyrics', 'image', 'embed', 'search', 'transcribe', 'music'] as const;
export type AiFeature = (typeof AI_FEATURES)[number];

export interface AiControls {
  /** Every AI feature off, backend-enforced. */
  emergencyOff: boolean;
  /** Per-feature switches: false = off. A missing feature is on. */
  features: Partial<Record<AiFeature, boolean>>;
  /** Daily (UTC) prompt + completion token cap across all AI calls; null = none. */
  dailyTokenCap: number | null;
  /** Daily (UTC) estimated cost cap in USD; null = none. */
  dailyCostCapUsd: number | null;
  /** When the owner published this record (ISO), set by the server. */
  updatedAt: string | null;
  /** Free-text name the console sends with a publish (clipped); informational only. */
  updatedBy: string | null;
}

export const AI_CONTROLS_DEFAULT: AiControls = Object.freeze({ emergencyOff: false, features: {}, dailyTokenCap: null, dailyCostCapUsd: null, updatedAt: null, updatedBy: null }) as AiControls;

const CONTROL_KEYS = new Set(['emergencyOff', 'features', 'dailyTokenCap', 'dailyCostCapUsd', 'updatedAt', 'updatedBy']);
const UPDATED_BY_MAX = 80;
// eslint-disable-next-line no-control-regex
const clipName = (s: string): string | null => s.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, UPDATED_BY_MAX) || null;
const MAX_TOKEN_CAP = 1e12;
const MAX_COST_CAP_USD = 1e6;

/**
 * Strict validation of an owner publish. Unknown keys, unknown features,
 * non-boolean switches and out-of-range caps are refused (never coerced).
 * `updatedAt` is accepted but replaced by the server clock.
 */
export function validateAiControls(raw: unknown, now = new Date()): { ok: true; value: AiControls } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: 'not_an_object' };
  const o = raw as Record<string, unknown>;
  for (const k of Object.keys(o)) if (!CONTROL_KEYS.has(k)) return { ok: false, error: `unknown_key:${k.slice(0, 40)}` };
  if (typeof o.emergencyOff !== 'boolean') return { ok: false, error: 'emergencyOff_must_be_boolean' };
  const features: Partial<Record<AiFeature, boolean>> = {};
  if (o.features !== undefined) {
    if (!o.features || typeof o.features !== 'object' || Array.isArray(o.features)) return { ok: false, error: 'features_must_be_an_object' };
    for (const [k, v] of Object.entries(o.features as Record<string, unknown>)) {
      if (!(AI_FEATURES as readonly string[]).includes(k)) return { ok: false, error: `unknown_feature:${k.slice(0, 40)}` };
      if (typeof v !== 'boolean') return { ok: false, error: `feature_must_be_boolean:${k}` };
      features[k as AiFeature] = v;
    }
  }
  const cap = (v: unknown, max: number, integer: boolean): number | null | 'bad' => {
    if (v === undefined || v === null) return null;
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > max) return 'bad';
    if (integer && !Number.isInteger(v)) return 'bad';
    return v;
  };
  const tokenCap = cap(o.dailyTokenCap, MAX_TOKEN_CAP, true);
  if (tokenCap === 'bad') return { ok: false, error: 'dailyTokenCap_must_be_a_whole_number_or_null' };
  const costCap = cap(o.dailyCostCapUsd, MAX_COST_CAP_USD, false);
  if (costCap === 'bad') return { ok: false, error: 'dailyCostCapUsd_must_be_a_number_or_null' };
  if (o.updatedBy !== undefined && o.updatedBy !== null && typeof o.updatedBy !== 'string') return { ok: false, error: 'updatedBy_must_be_a_string' };
  const updatedBy = typeof o.updatedBy === 'string' ? clipName(o.updatedBy) : null;
  return { ok: true, value: { emergencyOff: o.emergencyOff, features, dailyTokenCap: tokenCap, dailyCostCapUsd: costCap, updatedAt: now.toISOString(), updatedBy } };
}

/**
 * Lenient read of the STORED record (it may predate validation or have been
 * edited by hand): a malformed field falls back to its default, but an
 * explicit emergencyOff: true is always honoured.
 */
export function parseAiControls(raw: unknown): AiControls {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ...AI_CONTROLS_DEFAULT, features: {} };
  const o = raw as Record<string, unknown>;
  const features: Partial<Record<AiFeature, boolean>> = {};
  if (o.features && typeof o.features === 'object' && !Array.isArray(o.features)) {
    for (const f of AI_FEATURES) {
      const v = (o.features as Record<string, unknown>)[f];
      if (typeof v === 'boolean') features[f] = v;
    }
  }
  const num = (v: unknown, max: number): number | null => (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= max ? v : null);
  return {
    emergencyOff: o.emergencyOff === true,
    features,
    dailyTokenCap: num(o.dailyTokenCap, MAX_TOKEN_CAP),
    dailyCostCapUsd: num(o.dailyCostCapUsd, MAX_COST_CAP_USD),
    updatedAt: typeof o.updatedAt === 'string' ? o.updatedAt.slice(0, 40) : null,
    updatedBy: typeof o.updatedBy === 'string' ? clipName(o.updatedBy) : null,
  };
}

export interface Price { in: number; out: number }
export type PriceTable = Record<string, Price>;

const priceNum = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null);

/** Sanitise the `ai-prices` config value: only `{prefix: {in, out}}` entries with non-negative numbers survive. */
export function parsePrices(raw: unknown): PriceTable {
  const out: PriceTable = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const key = k.trim().slice(0, 120);
    if (!key || !v || typeof v !== 'object') continue;
    const p = v as { in?: unknown; out?: unknown };
    const pin = priceNum(p.in);
    const pout = priceNum(p.out);
    if (pin === null || pout === null) continue;
    out[key] = { in: pin, out: pout };
    if (Object.keys(out).length >= 200) break;
  }
  return out;
}

/** vinax_ai_events stores `slug @lane` — the slug alone is what gets priced. */
export function modelSlug(model: string | null): string {
  const m = (model ?? '').trim();
  if (!m) return '(none)';
  const at = m.indexOf(' @');
  return at > 0 ? m.slice(0, at) : m;
}

/** Longest-prefix price lookup (exact slug beats any prefix). */
export function matchPrice(model: string, prices: PriceTable): Price | null {
  let best: string | null = null;
  for (const key of Object.keys(prices)) {
    if (model.startsWith(key) && (best === null || key.length > best.length)) best = key;
  }
  return best === null ? null : prices[best];
}

/** USD for one call: tokens / 1e6 × price per million, rounded to micro-dollars. 0 when unpriced — callers that must tell "free" from "unknown" check the price first. */
export function costUsd(prompt: number, completion: number, price: Price | null): number {
  if (!price) return 0;
  const usd = (prompt / 1e6) * price.in + (completion / 1e6) * price.out;
  return Math.round(usd * 1e6) / 1e6;
}

const CONTROLS_TTL_MS = 30_000;
const CONTROLS_MAX_AGE_MS = 60_000;
const CONTROLS_RETRY_MS = 10_000;
const USAGE_TTL_MS = 60_000;
const USAGE_RETRY_MS = 10_000;
const CONTROL_READ_TIMEOUT_MS = 1_500;
const USAGE_SAMPLE_LIMIT = 10_000;

interface ControlsState {
  controls: AiControls;
  prices: PriceTable;
  /** published = a stored record; default = none stored; unavailable = the read failed (fail-open in force). */
  source: 'published' | 'default' | 'unavailable';
  readError: string | null;
  refreshAt: number;
  /** A cached emergency stop keeps applying through a failed refresh until this time. */
  emergencyUntil: number;
}

export interface ModelUsage { model: string; calls: number; prompt: number; completion: number; callsWithoutUsage: number }
interface UsageState {
  day: string;
  models: ModelUsage[];
  source: 'exact' | 'sampled';
  truncated: boolean;
  refreshAt: number;
}

let controlsState: ControlsState | null = null;
let controlsInflight: Promise<ControlsState> | null = null;
let usageState: UsageState | null = null;
let usageFailedUntil = 0;
let usageError: string | null = null;
let usageInflight: Promise<UsageState | null> | null = null;

/** Test hook: forget every cached control and usage read in this isolate. */
export function resetAiControlsCache(): void {
  controlsState = null;
  controlsInflight = null;
  usageState = null;
  usageFailedUntil = 0;
  usageError = null;
  usageInflight = null;
}

async function readControls(env: SupabaseEnv, now: number): Promise<ControlsState> {
  const keys = encodeURIComponent('"ai-controls","ai-prices"');
  const r = await sbSelectResult<{ key: string; value: unknown; updated_at?: string }>(env, 'vinax_config', `key=in.(${keys})&select=key,value,updated_at`, { timeoutMs: CONTROL_READ_TIMEOUT_MS });
  if (r.ok) {
    const row = r.rows.find((x) => x.key === 'ai-controls');
    const controls = row ? parseAiControls(row.value) : { ...AI_CONTROLS_DEFAULT, features: {} };
    if (row && !controls.updatedAt && typeof row.updated_at === 'string') controls.updatedAt = row.updated_at;
    return {
      controls,
      prices: parsePrices(r.rows.find((x) => x.key === 'ai-prices')?.value),
      source: row ? 'published' : 'default',
      readError: null,
      refreshAt: now + CONTROLS_TTL_MS,
      emergencyUntil: controls.emergencyOff ? now + CONTROLS_MAX_AGE_MS : 0,
    };
  }
  const code = dbErrorCode(r.error);
  const keep = controlsState && controlsState.emergencyUntil > now ? controlsState : null;
  console.warn(`[ai-controls] read failed (${code}${r.httpStatus ? ` ${r.httpStatus}` : ''}) — failing open${keep ? '; the cached emergency stop stays on until it expires' : ''}`);
  return {
    controls: keep ? { ...AI_CONTROLS_DEFAULT, features: {}, emergencyOff: true, updatedAt: keep.controls.updatedAt } : { ...AI_CONTROLS_DEFAULT, features: {} },
    prices: controlsState?.prices ?? {},
    source: 'unavailable',
    readError: code,
    refreshAt: now + CONTROLS_RETRY_MS,
    emergencyUntil: keep ? keep.emergencyUntil : 0,
  };
}

async function loadControls(env: SupabaseEnv): Promise<ControlsState> {
  const now = Date.now();
  if (!supabaseConfigured(env)) {
    return { controls: { ...AI_CONTROLS_DEFAULT, features: {} }, prices: {}, source: 'default', readError: null, refreshAt: now, emergencyUntil: 0 };
  }
  if (controlsState && now < controlsState.refreshAt) return controlsState;
  if (!controlsInflight) {
    controlsInflight = readControls(env, now)
      .then((s) => (controlsState = s))
      .finally(() => {
        controlsInflight = null;
      });
  }
  return controlsInflight;
}

const utcDay = (t: number): string => new Date(t).toISOString().slice(0, 10);

async function readUsage(env: SupabaseEnv, now: number): Promise<UsageState | null> {
  const day = utcDay(now);
  const since = `${day}T00:00:00.000Z`;
  const exact = await sbRpcResult<Array<{ model: string | null; calls: number; prompt_tokens: number; completion_tokens: number; calls_without_usage: number }>>(
    env,
    'vinax_ai_usage_since',
    { p_since: since },
    { timeoutMs: CONTROL_READ_TIMEOUT_MS },
  );
  const n = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : Number(v) >= 0 ? Number(v) : 0);
  if (exact.ok && Array.isArray(exact.value)) {
    const byModel = new Map<string, ModelUsage>();
    for (const row of exact.value) {
      const slug = modelSlug(row.model);
      const m = byModel.get(slug) ?? { model: slug, calls: 0, prompt: 0, completion: 0, callsWithoutUsage: 0 };
      m.calls += n(row.calls);
      m.prompt += n(row.prompt_tokens);
      m.completion += n(row.completion_tokens);
      m.callsWithoutUsage += n(row.calls_without_usage);
      byModel.set(slug, m);
    }
    return { day, models: [...byModel.values()], source: 'exact', truncated: false, refreshAt: now + USAGE_TTL_MS };
  }
  // The rollup is missing (migration not applied) or failed: a bounded
  // sample of today's rows — a lower bound when it hits the row limit.
  const sample = await sbSelectResult<{ model: string | null; prompt_tokens: number | null; completion_tokens: number | null; error: string | null }>(
    env,
    'vinax_ai_events',
    `created_at=gte.${encodeURIComponent(since)}&select=model,prompt_tokens,completion_tokens,error&order=created_at.desc&limit=${USAGE_SAMPLE_LIMIT}`,
    { timeoutMs: CONTROL_READ_TIMEOUT_MS },
  );
  if (!sample.ok) {
    usageError = dbErrorCode(sample.error);
    console.warn(`[ai-controls] usage read failed (${usageError}) — spend caps are not enforced until it recovers`);
    return null;
  }
  const byModel = new Map<string, ModelUsage>();
  for (const row of sample.rows) {
    // A refused call (logged for the operations panel) spent nothing.
    if (isRefusalCode(row.error)) continue;
    const slug = modelSlug(row.model);
    const m = byModel.get(slug) ?? { model: slug, calls: 0, prompt: 0, completion: 0, callsWithoutUsage: 0 };
    m.calls += 1;
    const known = typeof row.prompt_tokens === 'number' && typeof row.completion_tokens === 'number';
    if (known) {
      m.prompt += row.prompt_tokens as number;
      m.completion += row.completion_tokens as number;
    } else m.callsWithoutUsage += 1;
    byModel.set(slug, m);
  }
  return { day, models: [...byModel.values()], source: 'sampled', truncated: sample.rows.length >= USAGE_SAMPLE_LIMIT, refreshAt: now + USAGE_TTL_MS };
}

async function loadUsage(env: SupabaseEnv): Promise<UsageState | null> {
  const now = Date.now();
  if (!supabaseConfigured(env)) return null;
  if (usageState && now < usageState.refreshAt && usageState.day === utcDay(now)) return usageState;
  if (now < usageFailedUntil) return null;
  if (!usageInflight) {
    usageInflight = readUsage(env, now)
      .then((s) => {
        if (s) {
          usageState = s;
          usageError = null;
        } else usageFailedUntil = now + USAGE_RETRY_MS;
        return s;
      })
      .finally(() => {
        usageInflight = null;
      });
  }
  return usageInflight;
}

export interface UsageSummary {
  day: string;
  source: 'exact' | 'sampled';
  /** The sample hit its row limit: every figure is a lower bound. */
  truncated: boolean;
  calls: number;
  /** Calls whose provider reported no token counts — their tokens are unknown. */
  callsWithoutUsage: number;
  tokens: { prompt: number; completion: number; total: number };
  /** False when any call lacks token counts or the sample was truncated. */
  tokensComplete: boolean;
  /** Estimated USD for the priced part only. */
  costUsd: number;
  /** False when any tokens ran on an unpriced model (the estimate is a lower bound). */
  costKnown: boolean;
  unpricedModels: string[];
}

function summarise(usage: UsageState, prices: PriceTable): UsageSummary {
  let prompt = 0;
  let completion = 0;
  let calls = 0;
  let without = 0;
  let cost = 0;
  const unpriced: string[] = [];
  for (const m of usage.models) {
    prompt += m.prompt;
    completion += m.completion;
    calls += m.calls;
    without += m.callsWithoutUsage;
    const price = matchPrice(m.model, prices);
    if (price) cost += costUsd(m.prompt, m.completion, price);
    else if (m.prompt + m.completion > 0 || m.callsWithoutUsage > 0) unpriced.push(m.model);
  }
  const tokensComplete = without === 0 && !usage.truncated;
  return {
    day: usage.day,
    source: usage.source,
    truncated: usage.truncated,
    calls,
    callsWithoutUsage: without,
    tokens: { prompt, completion, total: prompt + completion },
    tokensComplete,
    costUsd: Math.round(cost * 1e6) / 1e6,
    costKnown: tokensComplete && unpriced.length === 0,
    unpricedModels: unpriced.sort(),
  };
}

/** Why an AI call was refused before reaching any provider. */
export type AiBlock = 'disabled' | 'over_budget';

export function isAiBlocked(error: unknown): error is AiBlock {
  return error === 'disabled' || error === 'over_budget';
}

/** The JSON error a route answers (with 503) so the client falls back to its on-device path. */
export function aiBlockCode(block: AiBlock): 'ai_disabled' | 'ai_over_budget' {
  return block === 'disabled' ? 'ai_disabled' : 'ai_over_budget';
}

/** The vinax_ai_events `error` values of refused calls (never provider failures). */
export const AI_REFUSAL_CODES: readonly string[] = ['ai_disabled', 'ai_over_budget'];
export function isRefusalCode(error: string | null | undefined): boolean {
  return !!error && AI_REFUSAL_CODES.includes(error);
}

/**
 * Record a refused call as one vinax_ai_events row (ok: false, model null,
 * status 503, error ai_disabled | ai_over_budget) — the owner console's AI
 * operations panel counts refusals from that column. Spend and reliability
 * readers (the daily caps, Data quality, lane health) skip these rows: a
 * refusal spent nothing and is not a provider failure. Registered with
 * `waitUntil` when given so it survives the response.
 */
export function logAiRefusal(env: object, feature: AiFeature, block: AiBlock, client: 'web' | 'app', waitUntil?: (p: Promise<unknown>) => void): Promise<void> {
  const write = logAiEvent(env as SupabaseEnv, { feature, model: null, ok: false, status: 503, error: aiBlockCode(block), client, latency_ms: 0 });
  if (waitUntil) waitUntil(write);
  return write;
}

function capsReached(c: AiControls, summary: UsageSummary | null): { tokens: boolean; cost: boolean } {
  if (!summary) return { tokens: false, cost: false };
  return {
    tokens: c.dailyTokenCap !== null && summary.tokens.total >= c.dailyTokenCap,
    cost: c.dailyCostCapUsd !== null && summary.costUsd >= c.dailyCostCapUsd,
  };
}

/**
 * The backend switch every AI entry point consults. Null = go ahead.
 * Reads are cached per isolate (see above); any read failure fails open.
 */
export async function aiGate(env: object, feature?: AiFeature): Promise<AiBlock | null> {
  const sbEnv = env as SupabaseEnv;
  const state = await loadControls(sbEnv);
  const c = state.controls;
  if (c.emergencyOff) return 'disabled';
  if (feature && c.features[feature] === false) return 'disabled';
  if (c.dailyTokenCap === null && c.dailyCostCapUsd === null) return null;
  const usage = await loadUsage(sbEnv);
  const reached = capsReached(c, usage ? summarise(usage, state.prices) : null);
  return reached.tokens || reached.cost ? 'over_budget' : null;
}

export interface AiControlsStatus {
  /** The database is configured, so controls can be published and use observed. */
  configured: boolean;
  /** Where the effective controls came from; `unavailable` = the read failed and fail-open is in force. */
  source: 'published' | 'default' | 'unavailable';
  /** db_* code of a failed controls read, else null. */
  readError: string | null;
  /** The controls enforcement is using right now. */
  controls: AiControls;
  /** Effective per-feature state (false when switched off or under the emergency stop). */
  features: Record<AiFeature, boolean>;
  /** Today's (UTC) observed use; null when it could not be read (caps are then not enforced). */
  usage: UsageSummary | null;
  usageError: string | null;
  caps: {
    tokens: { cap: number | null; used: number | null; remaining: number | null; reached: boolean; complete: boolean };
    costUsd: { cap: number | null; used: number | null; remaining: number | null; reached: boolean; known: boolean };
  };
  blocked: { emergency: boolean; overBudget: boolean; disabledFeatures: AiFeature[] };
  cache: { controlsRefreshSec: number; emergencyMaxAgeSec: number; usageRefreshSec: number };
  checkedAt: string;
}

/**
 * Everything the console's AI operations panel shows, from the same cached
 * reads enforcement uses (no other side effects): the effective controls,
 * today's observed use, each cap with what is used and left, and whether the
 * cost estimate is known or a lower bound. Always reads usage, caps or not.
 */
export async function aiControlsStatus(env: object): Promise<AiControlsStatus> {
  const sbEnv = env as SupabaseEnv;
  const state = await loadControls(sbEnv);
  const usage = await loadUsage(sbEnv);
  const summary = usage ? summarise(usage, state.prices) : null;
  const c = state.controls;
  const reached = capsReached(c, summary);
  const features = Object.fromEntries(AI_FEATURES.map((f) => [f, !c.emergencyOff && c.features[f] !== false])) as Record<AiFeature, boolean>;
  const used = summary ? summary.tokens.total : null;
  const spent = summary ? summary.costUsd : null;
  return {
    configured: supabaseConfigured(sbEnv),
    source: state.source,
    readError: state.readError,
    controls: c,
    features,
    usage: summary,
    usageError: summary ? null : supabaseConfigured(sbEnv) ? usageError : null,
    caps: {
      tokens: { cap: c.dailyTokenCap, used, remaining: c.dailyTokenCap !== null && used !== null ? Math.max(0, c.dailyTokenCap - used) : null, reached: reached.tokens, complete: summary?.tokensComplete ?? false },
      costUsd: { cap: c.dailyCostCapUsd, used: spent, remaining: c.dailyCostCapUsd !== null && spent !== null ? Math.max(0, Math.round((c.dailyCostCapUsd - spent) * 1e6) / 1e6) : null, reached: reached.cost, known: summary?.costKnown ?? false },
    },
    blocked: { emergency: c.emergencyOff, overBudget: reached.tokens || reached.cost, disabledFeatures: AI_FEATURES.filter((f) => !features[f]) },
    cache: { controlsRefreshSec: CONTROLS_TTL_MS / 1000, emergencyMaxAgeSec: CONTROLS_MAX_AGE_MS / 1000, usageRefreshSec: USAGE_TTL_MS / 1000 },
    checkedAt: new Date().toISOString(),
  };
}

export interface ModerationResult {
  /** True when a safety model judged the text unsafe. */
  flagged: boolean;
  /** True when NO safety model could be reached — the caller decides whether
   * to fail open (show the text) or closed (hold it); moderate() never
   * pretends an unchecked text was checked. */
  unchecked: boolean;
  model: string | null;
}

/**
 * v5.6.1 — the owner deleted the safety/guard keys from Cloudflare
 * (2026-08-31 key cleanup), so no moderation model is reachable any more.
 * The function keeps its contract and is honest about it: every text comes
 * back { unchecked: true } and the CALLER decides fail-open vs fail-closed —
 * exactly as the original design required when no safety model answered.
 */
export async function moderate(_env: AiEnv, _text: string): Promise<ModerationResult> {
  return { flagged: false, unchecked: true, model: null };
}

/**
 * Parse a JSON object/array out of a model response that may include a
 * reasoning preamble or ```json fences (reasoning models can wrap their
 * output), so callers get clean structured data regardless of model.
 */
export function extractJson<T = unknown>(content: string | null): T | null {
  if (!content) return null;
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const text = (fenced ? fenced[1] : content).trim();
  try {
    return JSON.parse(text) as T;
  } catch {
    /* not pure JSON — fall through to brace extraction */
  }
  const start = text.search(/[[{]/);
  if (start === -1) return null;
  const open = text[start];
  const close = open === '{' ? '}' : ']';
  const end = text.lastIndexOf(close);
  if (end > start) {
    try {
      return JSON.parse(text.slice(start, end + 1)) as T;
    } catch {
      return null;
    }
  }
  return null;
}

export interface AiLogRow {
  /** 7.2.0 — refusals are logged under the controls' feature names (e.g. curate-metadata, tts). */
  feature: 'dj' | 'playlist' | 'lyrics' | 'home' | 'assistant' | AiFeature;
  model: string | null;
  ok: boolean;
  status?: number | null;
  error?: string | null;
  client: 'web' | 'app';
  latency_ms: number;
  /** Provider-reported token counts (v5.16.0, AI Cost panel). Optional: the
   * columns arrive with the 2026-09 rollups migration, and the insert only
   * carries them when the provider actually sent usage. */
  prompt_tokens?: number | null;
  completion_tokens?: number | null;
}

/** The exact row shape written to vinax_ai_events — exported for tests. */
export function aiEventRow(row: AiLogRow): Record<string, unknown> {
  const out: Record<string, unknown> = {
    feature: row.feature,
    model: row.model,
    ok: row.ok,
    status: row.status ?? null,
    error: row.error ?? null,
    client: row.client,
    latency_ms: row.latency_ms,
  };
  // Token columns only when there are counts to write: an insert that names
  // a column the table doesn't have yet fails outright, so a deploy that
  // predates the migration keeps logging every call exactly as before.
  const p = toInt(row.prompt_tokens);
  const c = toInt(row.completion_tokens);
  if (p !== null && c !== null) {
    out.prompt_tokens = p;
    out.completion_tokens = c;
  }
  return out;
}

/**
 * Fire-and-forget log of an AI request for the admin AI-monitoring dashboard.
 * No-op when Supabase isn't configured; never throws.
 */
export function logAiEvent(env: SupabaseEnv, row: AiLogRow): Promise<void> {
  if (!supabaseConfigured(env)) return Promise.resolve();
  const full = aiEventRow(row);
  return sbInsert(env, 'vinax_ai_events', full)
    .then((ok) => {
      // The token columns may not exist yet (migration not applied): retry
      // once without them so the event itself is never lost.
      if (ok || !('prompt_tokens' in full)) return undefined;
      const bare = Object.fromEntries(Object.entries(full).filter(([k]) => k !== 'prompt_tokens' && k !== 'completion_tokens'));
      return sbInsert(env, 'vinax_ai_events', bare).then(() => undefined);
    })
    .catch(() => undefined);
}
