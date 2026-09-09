/**
 * Shared AI chat helper — OpenAI-compatible chat endpoints, one per lane.
 * The default base is the NVIDIA NIM catalog; a lane can pin its own provider
 * base in LANE_BASE (the scholar lane and the new router lane each ride their
 * own OpenAI-compatible host).
 *
 * Keys live ONLY here, as Cloudflare secrets. Configure under
 * Cloudflare -> Pages -> Settings -> Environment variables (Production).
 * The full model inventory (capabilities, health notes, env mapping) lives in
 * ./models.ts (AI_MODEL_REGISTRY) — this file wires those models into lanes.
 *
 * v5.21.0 — the owner rotated EVERY secret on 2026-09-09. Old names are gone
 * (nothing reads them any more), four models were retired and four arrived:
 *   RETIRED  minimax-m3, gpt-oss-120b, nemotron-3-nano-30b-a3b,
 *            ising-calibration-1-35b-a3b, llama-3.3-nemotron-super-49b
 *   ARRIVED  mistralai/mistral-nemotron (general reserve),
 *            meta/llama-3.2-11b-vision-instruct + -90b- (vision, own keys),
 *            the OpenRouter aggregator key
 *   MOVED    muse-glimmer and laguna-xs re-published under new vendor
 *            prefixes; the search seat inherited by the nano-omni model
 * Because every key is new, no probe result carries over: lane pins follow
 * the owner's key -> model table, the cross-lane ladder covers anything that
 * answers slowly, and the admin AI Lab re-verifies each row after deploy.
 *
 * Lanes and their keys (18 secrets, 19 lanes — dj and chat share the
 * lightning key, which is the one engine proven at realtime JSON):
 *
 * VINAX_NVD_NEMOTRON_3_5_LIGHTNING_30B_A3B
 *                                dj      AI DJ, Aura Mix, Smart Radio, smart
 *                                        queue — and chat, the balanced seat
 * VINAX_OAI_GPT_OSS_20B          fast    fast chat, quick tasks, instant
 *                                        answers
 * VINAX_NVD_NEMOTRON_3_SUPER_120B_A12B
 *                                deep    deep thinking, the Think button
 * VINAX_GROQ_API_KEY             scholar music knowledge, lyrics tools, LIVE
 *                                        voice — and its whole free catalog
 * VINAX_NVD_NEMOTRON_3_ULTRA_550B_A55B
 *                                home    premium reasoning backstop; slow —
 *                                        always LAST in latency-sensitive
 *                                        ladders
 * VINAX_NVD_NEMOTRON_3_NANO_OMNI_30B_A3B_REASONING
 *                                search  search-page music expert, discovery
 * VINAX_DEEPSEEK_V4_PRO_0813     pro     deep-reasoning ladder reserve
 * VINAX_MISTRAL_NEMOTRON         mini    general ladder reserve
 * VINAX_KIMI_K3                  agent   premium agent reserve (kept out of
 *                                        the default ladder)
 * VINAX_OPENROUTER_API_KEY       router  the free-model marketplace: every
 *                                        zero-cost chat model, selectable
 * VINAX_MTA_LMA_3_2_11B_VSN_INT  vision  image understanding (default)
 * VINAX_MTA_LMA_3_2_90B_VSN_INT  vision90 deep image understanding
 * VINAX_DEEPSEEK_V4_FLASH_0731   dsflash bench lane
 * VINAX_MTA_MUSE_GLIMMER_30B     muse    bench lane
 * VINAX_NVD_ISING_CALIBRATION_1_5_31B
 *                                rank    bench lane
 * VINAX_POOLSIDE_LAGUNA_XS_2_1   laguna  bench lane
 * VINAX_GGL_DIFFUSIONGEMMA_26B_A4B_IT
 *                                diffusion bench lane (text side only)
 * VINAX_GGL_GEMMA_4_31B_IT       gemma4  bench lane
 *
 * NVIDIA_BASE_URL optional DEFAULT endpoint override — applies only
 * to lanes without their own LANE_BASE pin
 */
import { sbInsert, supabaseConfigured, type SupabaseEnv } from './supabase';

export interface AiEnv {
  // The owner's 18 live keys (2026-09-09 rotation). Every secret from the
  // previous naming scheme was deleted upstream, so no legacy field remains.
  VINAX_KIMI_K3?: string;
  VINAX_DEEPSEEK_V4_PRO_0813?: string;
  VINAX_DEEPSEEK_V4_FLASH_0731?: string;
  VINAX_NVD_NEMOTRON_3_5_LIGHTNING_30B_A3B?: string;
  VINAX_MTA_MUSE_GLIMMER_30B?: string;
  VINAX_NVD_ISING_CALIBRATION_1_5_31B?: string;
  VINAX_POOLSIDE_LAGUNA_XS_2_1?: string;
  VINAX_GGL_DIFFUSIONGEMMA_26B_A4B_IT?: string;
  VINAX_NVD_NEMOTRON_3_ULTRA_550B_A55B?: string;
  VINAX_NVD_NEMOTRON_3_NANO_OMNI_30B_A3B_REASONING?: string;
  VINAX_GGL_GEMMA_4_31B_IT?: string;
  VINAX_NVD_NEMOTRON_3_SUPER_120B_A12B?: string;
  VINAX_OAI_GPT_OSS_20B?: string;
  VINAX_MISTRAL_NEMOTRON?: string;
  VINAX_MTA_LMA_3_2_11B_VSN_INT?: string;
  VINAX_MTA_LMA_3_2_90B_VSN_INT?: string;
  VINAX_GROQ_API_KEY?: string;
  VINAX_OPENROUTER_API_KEY?: string;
  NVIDIA_BASE_URL?: string;
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
  | 'agent'
  // The free-model marketplace (v5.21.0): one lane, many selectable models.
  | 'router'
  // Vision lanes — image understanding, on their own keys since v5.21.0.
  | 'vision'
  | 'vision90'
  // Inventory lanes — one per remaining owner key so the admin AI Lab can
  // probe every secret. They drive no feature.
  | 'dsflash'
  | 'muse'
  | 'rank'
  | 'laguna'
  | 'diffusion'
  | 'gemma4';

/** Default (NVIDIA) chat-completions endpoint, honoring the env override. */
export function defaultEndpoint(env: AiEnv): string {
  return env.NVIDIA_BASE_URL || ENDPOINT;
}

/** Per-lane provider base URL (OpenAI-compatible /v1 root). Lanes not listed
 * ride the default base. scholar rides the low-latency external host (~120 ms
 * to first token); router rides the free-model marketplace host. */
export const LANE_BASE: Partial<Record<Lane, string>> = {
  scholar: 'https://api.groq.com/openai/v1',
  router: 'https://openrouter.ai/api/v1',
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

/** True when the endpoint is NOT the NVIDIA base — i.e. vendor-specific
 * payload knobs must be withheld. */
export function isExternalEndpoint(url: string): boolean {
  return isGroqEndpoint(url) || isRouterEndpoint(url);
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

/** Pinned model per lane — the owner's 2026-09-09 key -> model table.
 *
 * Seat changes in v5.21.0, and why:
 * - fast: nemotron-3-nano-30b-a3b was retired with its key, so the seat moves
 *   to gpt-oss-20b on the key named for it. The lightning engine is the
 *   same-key secondary, because gpt-oss-20b hung on the RETIRED key and the
 *   new one is unprobed.
 * - search: the nano model is gone; its omni-reasoning sibling inherits the
 *   seat on its own key. Same template family, so reasoning still switches
 *   off through reasoningOffParams.
 * - mini: the MiniMax key was retired; mistral-nemotron takes the general
 *   reserve seat.
 * - vision / vision90: image understanding finally has its own keys instead
 *   of borrowing a text lane's.
 * - router: the marketplace default. Any zero-cost model in the live catalog
 *   can override it per call (see _lib/catalog.ts).
 * - chat stays on the lightning pair — the deepseek Flash engine hung on the
 *   retired key, so it keeps a bench lane until it is probed serving. */
export const LANE_MODEL: Record<Lane, string> = {
  dj: 'nvidia/nemotron-3.5-lightning-30b-a3b',
  chat: 'nvidia/nemotron-3.5-lightning-30b-a3b',
  deep: 'nvidia/nemotron-3-super-120b-a12b',
  fast: 'openai/gpt-oss-20b',
  scholar: 'llama-3.3-70b-versatile',
  home: 'nvidia/nemotron-3-ultra-550b-a55b',
  search: 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning',
  pro: 'deepseek-ai/deepseek-v4-pro-0813',
  mini: 'mistralai/mistral-nemotron',
  agent: 'moonshotai/kimi-k3',
  router: 'meta-llama/llama-3.3-70b-instruct:free',
  vision: 'meta/llama-3.2-11b-vision-instruct',
  vision90: 'meta/llama-3.2-90b-vision-instruct',
  // Inventory bench lanes — one per remaining key, no feature depends on them.
  dsflash: 'deepseek-ai/deepseek-v4-flash-0731',
  muse: 'meta/muse-glimmer-30b',
  rank: 'nvidia/ising-calibration-1.5-31b',
  laguna: 'poolside/laguna-xs-2.1',
  diffusion: 'google/diffusiongemma-26b-a4b-it',
  gemma4: 'google/gemma-4-31b-it',
};

/** Per-lane SECONDARY model pin — a healthy same-key variant tried on the
 * lane's OWN key right after the pinned primary and BEFORE any cross-lane
 * ladder hop. The primary always goes first, so the moment it heals upstream
 * it reclaims the lane; the secondary keeps the lane's character while the
 * primary is degraded or hanging. NVIDIA keys are account-scoped, so any
 * served model works on any of those keys. */
export const LANE_SECONDARY: Partial<Record<Lane, string>> = {
  dj: 'openai/gpt-oss-20b',
  fast: 'nvidia/nemotron-3.5-lightning-30b-a3b',
  deep: 'nvidia/nemotron-3-ultra-550b-a55b',
  chat: 'mistralai/mistral-nemotron',
  home: 'nvidia/nemotron-3-super-120b-a12b',
  search: 'nvidia/nemotron-3.5-lightning-30b-a3b',
  mini: 'openai/gpt-oss-20b',
  scholar: 'llama-3.1-8b-instant',
  vision: 'meta/llama-3.2-90b-vision-instruct',
  vision90: 'meta/llama-3.2-11b-vision-instruct',
};

/** Env var that holds each lane's key — exported for the admin AI Lab bench. */
export const LANE_ENV: Record<Lane, keyof AiEnv> = {
  dj: 'VINAX_NVD_NEMOTRON_3_5_LIGHTNING_30B_A3B',
  chat: 'VINAX_NVD_NEMOTRON_3_5_LIGHTNING_30B_A3B',
  deep: 'VINAX_NVD_NEMOTRON_3_SUPER_120B_A12B',
  fast: 'VINAX_OAI_GPT_OSS_20B',
  scholar: 'VINAX_GROQ_API_KEY',
  home: 'VINAX_NVD_NEMOTRON_3_ULTRA_550B_A55B',
  search: 'VINAX_NVD_NEMOTRON_3_NANO_OMNI_30B_A3B_REASONING',
  pro: 'VINAX_DEEPSEEK_V4_PRO_0813',
  mini: 'VINAX_MISTRAL_NEMOTRON',
  agent: 'VINAX_KIMI_K3',
  router: 'VINAX_OPENROUTER_API_KEY',
  vision: 'VINAX_MTA_LMA_3_2_11B_VSN_INT',
  vision90: 'VINAX_MTA_LMA_3_2_90B_VSN_INT',
  dsflash: 'VINAX_DEEPSEEK_V4_FLASH_0731',
  muse: 'VINAX_MTA_MUSE_GLIMMER_30B',
  rank: 'VINAX_NVD_ISING_CALIBRATION_1_5_31B',
  laguna: 'VINAX_POOLSIDE_LAGUNA_XS_2_1',
  diffusion: 'VINAX_GGL_DIFFUSIONGEMMA_26B_A4B_IT',
  gemma4: 'VINAX_GGL_GEMMA_4_31B_IT',
};

/** Cross-lane failover ladder: when a lane's own key/model pair is missing or
 * dead, the next live pair takes the call — one dead key never takes a
 * feature down, it just degrades to a healthy sibling lane.
 * Order: fastest proven JSON generators first, the slow 550B ULTRA last. The
 * vision lanes, the unstable agent reserve and the bench-only inventory lanes
 * are NEVER in the general ladder — an image model must not answer a DJ JSON
 * call. The marketplace lane sits second-to-last: it is free and broad, but
 * its upstreams vary, so proven keys go first. */
const LADDER: Lane[] = ['fast', 'chat', 'dj', 'mini', 'pro', 'deep', 'scholar', 'search', 'router', 'home'];

export interface LaneAttempt {
  key: string;
  model: string;
  role: Lane;
  /** Full chat-completions URL for THIS attempt's lane — providers are mixed
   * now, so every ladder hop must carry its own base alongside key+model. */
  endpoint: string;
}

/** Ordered key+model+endpoint attempts for a lane: its own pair first, then
 * its same-key secondary pin (when one exists), then the cross-lane ladder.
 * Each attempt carries its lane's endpoint so mixed-provider failover signs
 * every hop against the right base. */
export function laneAttempts(env: AiEnv, lane: Lane, modelOverride?: string, ladder?: Lane[]): LaneAttempt[] {
  const out: LaneAttempt[] = [];
  const add = (l: Lane, model?: string): void => {
    const key = env[LANE_ENV[l]];
    if (key && !out.some((a) => a.role === l)) {
      out.push({ key, model: model ?? LANE_MODEL[l], role: l, endpoint: laneEndpoint(env, l) });
    }
  };
  add(lane, modelOverride);
  // Same-lane secondary: keeps the lane's character when the pinned primary
  // is degraded — consulted before any cross-lane ladder hop.
  const secondary = LANE_SECONDARY[lane];
  const ownKey = env[LANE_ENV[lane]];
  if (secondary && ownKey && !out.some((a) => a.model === secondary)) {
    out.push({ key: ownKey, model: secondary, role: lane, endpoint: laneEndpoint(env, lane) });
  }
  for (const l of ladder ?? LADDER) add(l);
  return out;
}

export type ChatError = 'not_configured' | 'unreachable' | 'failed';

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
    /** Per-call failover order override — time-critical big-JSON jobs put the
     * fastest reliable generator first. Default: the global key ladder. */
    ladder?: Lane[];
    /** Aggregate wall-clock deadline (epoch ms). The lane failover ladder
     * never starts an attempt past it, so callers get an answer or a fast,
     * honest failure instead of stacked retries that outlive client patience
     * (DQA-02). */
    deadlineAt?: number;
  } = {},
): Promise<ChatResult> {
  const lane = opts.lane ?? 'chat';
  // The lane's own key+model first, then the cross-lane failover ladder — a
  // dead or missing key degrades gracefully instead of failing the feature.
  const attempts = laneAttempts(env, lane, opts.model, opts.ladder);
  if (!attempts.length) return { content: null, model: null, error: 'not_configured' };
  const wantJson = opts.json === true;
  let lastStatus = 0;
  let attemptNo = 0;
  for (const { key, model, role, endpoint } of attempts) {
    attemptNo += 1;
    // Prefer strict JSON output when asked. If a model rejects response_format
    // with a 400, retry the SAME model once in plain mode so guided JSON is a
    // pure win on models that support it and a no-op on those that don't.
    for (let jsonAttempt = wantJson ? 0 : 1; jsonAttempt < 2; jsonAttempt += 1) {
      // Aggregate budget check: never START an attempt we can't finish.
      const remainingMs = opts.deadlineAt ? opts.deadlineAt - Date.now() : Infinity;
      if (remainingMs <= 1500) return { content: null, model: null, error: 'failed', status: lastStatus || 408 };
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
      if (model.includes('gpt-oss') && !isExternalEndpoint(endpoint)) payload.reasoning_effort = opts.reasoningEffort ?? 'low';
      // nemotron a3b-family models leak BARE chain-of-thought unless reasoning
      // is switched off at the chat-template level (probed live — see
      // reasoningOffParams). Model-gated: a no-op for every other pin.
      Object.assign(payload, reasoningOffParams(model));
      // Force valid JSON (no preamble / markdown fences): fewer parse failures
      // and fewer wasted output tokens.
      if (useJson) payload.response_format = { type: 'json_object' };

      const controller = new AbortController();
      const leash = attemptNo === 1 ? (opts.firstTimeoutMs ?? opts.timeoutMs ?? 20_000) : (opts.timeoutMs ?? 20_000);
      const timer = setTimeout(() => controller.abort(), Math.min(leash, remainingMs));
      let res: Response;
      try {
        res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
          body: JSON.stringify(payload),
          signal: controller.signal,
        });
      } catch {
        // Network error or timeout: fail over to the next lane pair.
        clearTimeout(timer);
        lastStatus = 0;
        break;
      }
      clearTimeout(timer);
      if (res.ok) {
        const data = (await res.json().catch(() => null)) as
          | { choices?: Array<{ message?: { content?: unknown; reasoning_content?: unknown } }>; usage?: unknown }
          | null;
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
        if (content) return { content, model, keyRole: role, ...(usage ? { usage } : {}) };
        // 200 but blank — fail over to the next lane pair.
        lastStatus = 200;
        break;
      }
      lastStatus = res.status;
      // JSON mode unsupported on this model -> retry it once in plain mode.
      if (res.status === 400 && useJson) continue;
      // Anything else (dead/exhausted key 401/402/403/429, unknown model
      // 400/404, upstream 5xx) -> next key+model pair in the ladder.
      break;
    }
  }
  return { content: null, model: null, error: 'failed', status: lastStatus };
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
  opts: { temperature?: number; maxTokens?: number; timeoutMs?: number; deadlineAt?: number } = {},
): Promise<string[]> {
  const settled = await Promise.allSettled(
    lanes.map((lane) =>
      chat(env, messages, {
        temperature: opts.temperature,
        maxTokens: opts.maxTokens,
        timeoutMs: opts.timeoutMs,
        deadlineAt: opts.deadlineAt,
        lane,
        json: true,
        reasoningEffort: 'low',
      }),
    ),
  );
  const out: string[] = [];
  for (const s of settled) if (s.status === 'fulfilled' && s.value.content) out.push(s.value.content);
  return out;
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
  feature: 'dj' | 'playlist' | 'lyrics' | 'home' | 'assistant';
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
