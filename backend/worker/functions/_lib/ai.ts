/**
 * Shared AI chat helper — OpenAI-compatible chat endpoints, one per lane.
 * The default base is NVIDIA NIM; a lane can pin its own provider base in
 * LANE_BASE (scholar rides Groq's OpenAI-compatible API since v2.7.3).
 *
 * Keys live ONLY here, as Cloudflare secrets. Configure under
 * Cloudflare -> Pages -> Settings -> Environment variables (Production).
 * The full model inventory (capabilities, health notes, env mapping) lives in
 * ./models.ts (AI_MODEL_REGISTRY, v5.4.0) — lanes below pin only VERIFIED
 * models; the registry also carries the not-yet-wired ones honestly.
 *
 * Lanes and their keys (gen-5 assignment, owner-directed 2026-08-29 — every
 * pin below probed live on its own key via the temp /api/modelcheck):
 *
 * VINAX_DEEPSEEK_V4_FLASH        chat    Muse (VinaX FLASH) — assistant, AI
 *                                        playlists, mood recs (gpt-oss-20b:
 *                                        the deepseek-v4-flash-0731 slug the
 *                                        key is named for HANGS upstream —
 *                                        probed twice 2026-08-29, 18s+ no
 *                                        response — so it stays unpinned)
 * VINAX_CHATGPT_20_B             fast    Swift (VinaX 20B) — fast chat,
 *                                        quick tasks, instant answers
 * VINAX_NEMOTRON_SUPER           deep    Sage (VinaX SUPER) — deep thinking,
 *                                        the Think button. Upgraded to
 *                                        nemotron-3-super-120b-a12b (probed
 *                                        0.55s); the old 49b pin stays as the
 *                                        same-key secondary.
 * VINAX_GROQ_API_KEY             scholar Scholar (VinaX INSTANT) — music
 *                                        knowledge, lyrics tools, LIVE voice
 * VINAX_NEMOTRON_3_5_LIGHTNING_30B_A3B
 *                                dj      Win (VinaX LIGHTNING) — AI DJ, Aura
 *                                        Mix, Smart Radio, smart queue. The
 *                                        owner's realtime-DJ mandate: probed
 *                                        7.3s cold / 0.8s warm, JSON-clean.
 *                                        (dj rode VINAX_CHATGPT_120_B's
 *                                        gpt-oss-20b before v5.4.0.)
 * VINAX_NEMOTRON_ULTRA           home    Nova (VinaX ULTRA) — premium
 *                                        reasoning backstop; slow — always
 *                                        LAST in latency-sensitive ladders
 * VINAX_NVIDIA_NEMOTRON_3_NANO_30B_A3B
 *                                search  Expert (VinaX NANO 3) — search-page
 *                                        music expert, discovery
 * VINAX_DEEPSEEK_V4_PRO          pro     Deep reasoning reserve — advanced
 *                                        recommendations, taste analysis
 *                                        (probed 0.59s warm; cold pod can
 *                                        need a retry)
 * VINAX_MINIMAX_M3               mini    General fallback reserve (probed
 *                                        0.41s warm; healed since v2.7.2)
 * VINAX_RIVA_TRANSLATE_4B_INSTRUCT_V2
 *                                translate Lyrics/UI translation (0.9s). Its
 *                                        v1_1 fallback slug 404s upstream —
 *                                        unpinned until it exists.
 * VINAX_NEMOTRON_3_5_CONTENT_SAFETY
 *                                safety  Moderation of AI-generated text
 * VINAX_LLAMA_3_1_NEMOTRON_SAFETY_GUARD_8B_V3
 *                                guard   Safety second opinion / fallback
 * VINAX_NEMOTRON_3_EMBED_1B      (embed helper) 2048-dim vectors via
 *                                        /v1/embeddings — see embed() below
 * VINAX_KIMI_K3                  agent   Premium agent reserve — kimi-k3
 *                                        probed UNSTABLE 2026-08-29 (one
 *                                        16.6s answer, one 18s hang), so it
 *                                        is wired but NOT in any default
 *                                        ladder and pins no feature. Re-probe
 *                                        before promoting.
 *
 * NVIDIA_BASE_URL optional DEFAULT endpoint override — applies only
 * to lanes without their own LANE_BASE pin
 */
import { sbInsert, supabaseConfigured, type SupabaseEnv } from './supabase';

export interface AiEnv {
  // The owner's 18 live keys (2026-08-31 cleanup — every retired secret was
  // deleted from Cloudflare, so their fields are gone here too).
  VINAX_DEEPSEEK_V4_FLASH?: string;
  VINAX_CHATGPT_20_B?: string;
  VINAX_NEMOTRON_SUPER?: string;
  VINAX_GROQ_API_KEY?: string;
  VINAX_CHATGPT_120_B?: string;
  VINAX_NEMOTRON_ULTRA?: string;
  VINAX_NVIDIA_NEMOTRON_3_NANO_30B_A3B?: string;
  VINAX_KIMI_K3?: string;
  VINAX_DEEPSEEK_V4_PRO?: string;
  VINAX_NEMOTRON_3_5_LIGHTNING_30B_A3B?: string;
  VINAX_MUSE_GLIMMER_30B?: string;
  VINAX_ISING_CALIBRATION_1_5_31B?: string;
  VINAX_ISING_CALIBRATION_1_35B_A3B?: string;
  VINAX_LAGUNA_XS_2_1?: string;
  VINAX_MINIMAX_M3?: string;
  VINAX_DIFFUSIONGEMMA_26B_A4B_IT?: string;
  VINAX_GEMMA_4_31B_IT?: string;
  VINAX_NEMOTRON_3_NANO_30B_A3B?: string;
  NVIDIA_BASE_URL?: string;
}

const ENDPOINT = 'https://integrate.api.nvidia.com/v1/chat/completions';

/** The feature lanes. Every AI call runs on exactly one lane.
 * v5.4.0 adds: pro (deep-reasoning reserve), mini (general reserve),
 * translate, safety, guard (moderation pair) and agent (kimi reserve —
 * unstable, kept out of default ladders). */
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
  // Inventory lanes — one per remaining owner model so the admin AI Lab can
  // probe every key. v5.6.1: trimmed to the 18 keys the owner kept (the riva
  // translators, embed, safety pair, voicechat, video, speaker and petr keys
  // were deleted from Cloudflare 2026-08-31, so their lanes are gone).
  | 'dsflash'
  | 'muse'
  | 'rank'
  | 'rank2'
  | 'laguna'
  | 'diffusion'
  | 'omni'
  | 'gemma4'
  | 'oss120';

/** Default (NVIDIA) chat-completions endpoint, honoring the env override. */
export function defaultEndpoint(env: AiEnv): string {
  return env.NVIDIA_BASE_URL || ENDPOINT;
}

/** Per-lane provider base URL (OpenAI-compatible /v1 root). Lanes not listed
 * ride the default NVIDIA base. scholar: keyed by VINAX_GROQ_API_KEY (gen-4
 * name for the Groq console key the owner introduced 2026-07-17), so the
 * lane calls Groq's OpenAI-compatible API — same Llama family, probed TTFB
 * ~120 ms vs the ~20 s the old provider needed for first tokens. */
export const LANE_BASE: Partial<Record<Lane, string>> = {
  scholar: 'https://api.groq.com/openai/v1',
};

/** Full chat-completions URL for a lane — its own provider base when pinned,
 * else the shared default. EVERY call site (chat helper, streaming chat,
 * admin bench, health pings, probes) must route through this so the
 * mixed-provider failover ladder signs each hop against its own base. */
export function laneEndpoint(env: AiEnv, lane: Lane): string {
  const base = LANE_BASE[lane];
  return base ? `${base}/chat/completions` : defaultEndpoint(env);
}

/** Groq is OpenAI-compatible but rejects NVIDIA-only knobs — probed live
 * 2026-07-17: reasoning_effort → 400 "not supported with this model" (while
 * max_tokens, response_format json_object and SSE streaming all work as-is).
 * Gate NVIDIA-specific params on this check. */
export function isGroqEndpoint(url: string): boolean {
  return url.includes('api.groq.com');
}

/** nemotron-3-nano reasons by DEFAULT and leaks BARE chain-of-thought into
 * the content stream (no <think> wrapper, so the SSE think-gate can't strip
 * it) — in v2.7.2 it burned the search lane's whole token budget without
 * delivering a single song. Probed live 2026-07-17 (v2.7.4): the
 * chat_template_kwargs {"thinking": false} switch turns reasoning fully OFF.
 * Model-gated so the knob never travels to any other pin or provider.
 *
 * v5.4.0: nemotron-3.5-lightning (the new dj primary) is the same a3b
 * template family and probed VERBOSE on a one-word prompt (174-183 chars for
 * "reply ok") — the nano thinking-off switch rides its calls too, and the
 * post-deploy /api/dj live check is the acceptance test.
 *
 * The qwen3 branch is defensive legacy (no lane pins qwen today). */
export function reasoningOffParams(model: string): Record<string, unknown> {
  if (model.includes('nemotron-3-nano')) return { chat_template_kwargs: { thinking: false } };
  if (model.includes('nemotron-3.5-lightning')) return { chat_template_kwargs: { thinking: false } };
  if (model.includes('qwen3')) return { chat_template_kwargs: { thinking: false, enable_thinking: false } };
  return {};
}

/** Pinned model per lane — every slug below probed live ON ITS OWN KEY via
 * the temp /api/modelcheck before pinning (v5.4.0, 2026-08-29). Health notes
 * and the full re-pin history live in git and ./models.ts.
 *
 * v5.4.0 re-pin summary (owner's multi-model mandate):
 * - dj: openai/gpt-oss-20b (on VINAX_CHATGPT_120_B) -> nemotron-3.5-lightning
 *   on its OWN new key. Probed 7.3s cold / 0.80s warm, chatty-but-JSON-clean;
 *   thinking off via reasoningOffParams. gpt-oss-20b stays as the same-key
 *   secondary (probed 0.58s on the lightning key — NVIDIA keys are
 *   account-scoped).
 * - deep: llama-3.3-nemotron-super-49b -> nemotron-3-super-120b-a12b (probed
 *   0.55s on VINAX_NEMOTRON_SUPER — the owner's table names this model for
 *   the key). The 49b keeps the same-key secondary seat.
 * - NEW pro: deepseek-v4-pro-0813 (0.59s warm; first cold probe timed out,
 *   so it is a LADDER RESERVE, not a feature primary).
 * - NEW mini: minimax-m3 (0.41s warm; same cold-flake caveat, same reserve
 *   role — v2.7.2's "owner sign-off" requirement is satisfied by the owner's
 *   2026-08-29 model table naming it General AI).
 * - NEW translate/safety/guard: riva-v2 (0.93s), content-safety (0.52s),
 *   safety-guard-8b (0.53s) — special-purpose, excluded from general ladders.
 * - NEW agent: kimi-k3 — UNSTABLE (16.6s then a hang); wired for the admin
 *   bench only, no feature and no ladder until it stabilizes.
 * - NOT pinned anywhere (probed dead 2026-08-29): deepseek-v4-flash-0731 and
 *   gemma-4-31b-it HANG; ising-calibration slugs are 410 Gone; muse-glimmer,
 *   nemotron-voicechat, laguna-xs and riva-v1_1 404 on the NIM catalog. */
export const LANE_MODEL: Record<Lane, string> = {
  dj: 'nvidia/nemotron-3.5-lightning-30b-a3b',
  chat: 'openai/gpt-oss-20b',
  deep: 'nvidia/nemotron-3-super-120b-a12b',
  fast: 'openai/gpt-oss-20b',
  scholar: 'llama-3.3-70b-versatile',
  home: 'nvidia/nemotron-3-ultra-550b-a55b',
  search: 'nvidia/nemotron-3-nano-30b-a3b',
  pro: 'deepseek-ai/deepseek-v4-pro-0813',
  mini: 'minimaxai/minimax-m3',
  agent: 'moonshotai/kimi-k3',
  // Inventory bench lanes (v5.4.1) — see the Lane union note. Status at the
  // 2026-08-29 probe: deepseek-flash + gemma-4 HANG; muse/laguna/voicechat and
  // riva-v1_1 404; the ising ranks are 410 Gone; gpt-oss-120b hangs on NVIDIA;
  // diffusiongemma SERVES; omni/video/speaker/petr are unprobed catalog
  // guesses. The bench shows the live truth either way.
  dsflash: 'deepseek-ai/deepseek-v4-flash-0731',
  muse: 'nvidia/muse-glimmer-30b',
  rank: 'nvidia/ising-calibration-1.5-31b',
  rank2: 'nvidia/ising-calibration-1-35b-a3b',
  laguna: 'nvidia/laguna-xs-2.1',
  diffusion: 'google/diffusiongemma-26b-a4b-it',
  omni: 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning',
  gemma4: 'google/gemma-4-31b-it',
  oss120: 'openai/gpt-oss-120b',
};

/** Per-lane SECONDARY model pin — a healthy same-key variant tried on the
 * lane's OWN key right after the pinned primary and BEFORE any cross-lane
 * ladder hop. The primary always goes first, so the moment it heals upstream
 * it reclaims the lane; the secondary keeps the lane's character while the
 * primary is degraded or hanging.
 * - dj (v5.4.0): gpt-oss-20b on the lightning key — probed 0.58s; if the new
 *   lightning primary has a bad minute the DJ stays on its own funded key
 *   with the engine that ran it before v5.4.0.
 * - deep (v5.4.0): the previous 49b primary — proven Think engine.
 * - chat/home/search/scholar: unchanged from v3.7.0. */
export const LANE_SECONDARY: Partial<Record<Lane, string>> = {
  dj: 'openai/gpt-oss-20b',
  deep: 'nvidia/llama-3.3-nemotron-super-49b-v1.5',
  chat: 'nvidia/nemotron-3-ultra-550b-a55b',
  home: 'openai/gpt-oss-20b',
  search: 'google/diffusiongemma-26b-a4b-it',
  scholar: 'llama-3.1-8b-instant',
};

/** Env var that holds each lane's key — exported for the admin AI Lab bench. */
export const LANE_ENV: Record<Lane, keyof AiEnv> = {
  dj: 'VINAX_NEMOTRON_3_5_LIGHTNING_30B_A3B',
  chat: 'VINAX_DEEPSEEK_V4_FLASH',
  deep: 'VINAX_NEMOTRON_SUPER',
  fast: 'VINAX_CHATGPT_20_B',
  scholar: 'VINAX_GROQ_API_KEY',
  home: 'VINAX_NEMOTRON_ULTRA',
  search: 'VINAX_NVIDIA_NEMOTRON_3_NANO_30B_A3B',
  pro: 'VINAX_DEEPSEEK_V4_PRO',
  mini: 'VINAX_MINIMAX_M3',
  agent: 'VINAX_KIMI_K3',
  dsflash: 'VINAX_DEEPSEEK_V4_FLASH',
  muse: 'VINAX_MUSE_GLIMMER_30B',
  rank: 'VINAX_ISING_CALIBRATION_1_5_31B',
  rank2: 'VINAX_ISING_CALIBRATION_1_35B_A3B',
  laguna: 'VINAX_LAGUNA_XS_2_1',
  diffusion: 'VINAX_DIFFUSIONGEMMA_26B_A4B_IT',
  omni: 'VINAX_NEMOTRON_3_NANO_30B_A3B',
  gemma4: 'VINAX_GEMMA_4_31B_IT',
  oss120: 'VINAX_CHATGPT_120_B',
};

/** Cross-lane failover ladder: when a lane's own key/model pair is missing or
 * dead, the next live pair takes the call — one dead key never takes a
 * feature down, it just degrades to a healthy sibling lane.
 * v5.4.0 order: fastest proven JSON generators first, the slow 550B ULTRA
 * last, and the special-purpose lanes (translate/safety/guard) plus the
 * unstable agent reserve are NEVER in the general ladder — a translation
 * model must not answer a DJ JSON call. */
const LADDER: Lane[] = ['fast', 'chat', 'dj', 'mini', 'pro', 'deep', 'scholar', 'search', 'home'];

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

export interface ChatResult {
  content: string | null;
  model: string | null;
  /** Which lane's key served the call — routing proof for observability. */
  keyRole?: string;
  error?: ChatError;
  status?: number;
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
      // it on the NVIDIA base — but Groq 400s on reasoning_effort (probed
      // live), so the knob never travels to a Groq endpoint.
      if (model.includes('gpt-oss') && !isGroqEndpoint(endpoint)) payload.reasoning_effort = opts.reasoningEffort ?? 'low';
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
          | { choices?: Array<{ message?: { content?: unknown; reasoning_content?: unknown } }> }
          | null;
        const msg = data?.choices?.[0]?.message;
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
        if (content) return { content, model, keyRole: role };
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
}

/**
 * Fire-and-forget log of an AI request for the admin AI-monitoring dashboard.
 * No-op when Supabase isn't configured; never throws.
 */
export function logAiEvent(env: SupabaseEnv, row: AiLogRow): Promise<void> {
  if (!supabaseConfigured(env)) return Promise.resolve();
  return sbInsert(env, 'vinax_ai_events', {
    feature: row.feature,
    model: row.model,
    ok: row.ok,
    status: row.status ?? null,
    error: row.error ?? null,
    client: row.client,
    latency_ms: row.latency_ms,
  })
    .then(() => undefined)
    .catch(() => undefined);
}
