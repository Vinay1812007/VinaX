/**
 * Shared AI chat helper — OpenAI-compatible chat endpoints, one per lane.
 * The default base is NVIDIA NIM; a lane can pin its own provider base in
 * LANE_BASE (scholar rides Groq's OpenAI-compatible API since v2.7.3).
 *
 * Keys live ONLY here, as Cloudflare secrets. Configure under
 * Cloudflare -> Pages -> Settings -> Environment variables (Production).
 * Seven lanes, each with its own key and pinned model (generation-4 env
 * names, owner-rotated 2026-07-17 — old gen-3 names VINAX_MINIMAX,
 * VINAX_CHATGPT, VINAX_CHATGPT_FAST, VINAX_LLAMA and VINAX_GEM are DEAD):
 *
 *   VINAX_DEEPSEEK_V4_FLASH  chat    PRIMARY — Muse engine (VinaX FLASH) ·
 *                                    AI Playlists · assistant · mood recs
 *   VINAX_CHATGPT_20_B       fast    Swift (VinaX 20B) — fast chat ·
 *                                    quick tasks · instant answers
 *   VINAX_NEMOTRON_SUPER     deep    Sage (VinaX SUPER) — deep thinking ·
 *                                    reasoning · the Think button
 *   VINAX_GROQ_API_KEY       scholar Scholar (VinaX INSTANT) — music
 *                                    knowledge · lyrics tools · Q&A · LIVE
 *                                    VOICE replies (v3.4.1 — sub-second TTFB).
 *                                    Groq console key (gsk_…) — this lane
 *                                    calls api.groq.com, not NVIDIA.
 *   VINAX_CHATGPT_120_B      dj      Win (VinaX 120B) — AI DJ · Aura Mix ·
 *                                    Smart Radio · Auto Queue · smart queue
 *   VINAX_NEMOTRON_ULTRA     home    Nova (VinaX ULTRA) — Home Screen
 *                                    Builder · trending. (Live voice moved to
 *                                    the scholar lane in v3.4.1 for latency;
 *                                    home stays voice's failover.)
 *   VINAX_NVIDIA_NEMOTRON_3_NANO_30B_A3B
 *                            search  Expert (VinaX NANO 3) — Search-page
 *                                    music expert · personalized discovery.
 *                                    NVIDIA keys are account-scoped: this
 *                                    key also signs the lane's secondary
 *                                    (diffusiongemma) on the same base.
 *
 *   NVIDIA_BASE_URL       optional DEFAULT endpoint override — applies only
 *                         to lanes without their own LANE_BASE pin
 */
import { sbInsert, supabaseConfigured, type SupabaseEnv } from './supabase';

export interface AiEnv {
  VINAX_DEEPSEEK_V4_FLASH?: string;
  VINAX_CHATGPT_20_B?: string;
  VINAX_NEMOTRON_SUPER?: string;
  VINAX_GROQ_API_KEY?: string;
  VINAX_CHATGPT_120_B?: string;
  VINAX_NEMOTRON_ULTRA?: string;
  VINAX_NVIDIA_NEMOTRON_3_NANO_30B_A3B?: string;
  NVIDIA_BASE_URL?: string;
}

const ENDPOINT = 'https://integrate.api.nvidia.com/v1/chat/completions';

/** The seven feature lanes. Every AI call runs on exactly one lane. */
export type Lane = 'dj' | 'chat' | 'deep' | 'fast' | 'scholar' | 'home' | 'search';

/** Default (NVIDIA) chat-completions endpoint, honoring the env override. */
export function defaultEndpoint(env: AiEnv): string {
  return env.NVIDIA_BASE_URL || ENDPOINT;
}

/** Per-lane provider base URL (OpenAI-compatible /v1 root). Lanes not listed
 *  ride the default NVIDIA base. scholar: keyed by VINAX_GROQ_API_KEY (gen-4
 *  name for the Groq console key the owner introduced 2026-07-17), so the
 *  lane calls Groq's OpenAI-compatible API — same Llama family, probed TTFB
 *  ~120 ms vs the ~20 s the old provider needed for first tokens. */
export const LANE_BASE: Partial<Record<Lane, string>> = {
  scholar: 'https://api.groq.com/openai/v1',
};

/** Full chat-completions URL for a lane — its own provider base when pinned,
 *  else the shared default. EVERY call site (chat helper, streaming chat,
 *  admin bench, health pings, probes) must route through this so the
 *  mixed-provider failover ladder signs each hop against its own base. */
export function laneEndpoint(env: AiEnv, lane: Lane): string {
  const base = LANE_BASE[lane];
  return base ? `${base}/chat/completions` : defaultEndpoint(env);
}

/** Groq is OpenAI-compatible but rejects NVIDIA-only knobs — probed live
 *  2026-07-17: reasoning_effort → 400 "not supported with this model" (while
 *  max_tokens, response_format json_object and SSE streaming all work as-is).
 *  Gate NVIDIA-specific params on this check. */
export function isGroqEndpoint(url: string): boolean {
  return url.includes('api.groq.com');
}

/** nemotron-3-nano reasons by DEFAULT and leaks BARE chain-of-thought into
 *  the content stream (no <think> wrapper, so the SSE think-gate can't strip
 *  it) — in v2.7.2 it burned the search lane's whole token budget without
 *  delivering a single song. Probed live 2026-07-17 (v2.7.4), all four
 *  reasoning-off switches, expert-style prompt, max_tokens 300:
 *  - chat_template_kwargs {"thinking": false} → reasoning fully OFF: direct
 *    answer, finish "stop", 67/300 completion tokens, zero reasoning deltas
 *    in the stream. THE switch.
 *  - "/no_think" system prefix → ignored: bare CoT, all 300 tokens burned.
 *  - "detailed thinking off" system prefix → half-works: CoT moves to
 *    reasoning_content, but still spends ~100 tokens thinking first.
 *  - min/max_thinking_tokens → 400 "Unsupported parameter(s)".
 *  Model-gated so the knob never travels to any other pin or provider —
 *  spread the result into every chat-completions payload we build.
 *
 *  qwen3.5 (chat primary since v3.2.0) is a hybrid-reasoning family that
 *  thinks by DEFAULT: measured live 2026-07-18, think-heavy runs opened the
 *  content stream 9–13 s late or burned the whole budget inside an unclosed
 *  <think> block (which the SSE gate rightly discards → empty-stream
 *  failover), while no-think runs answered in ~1.1 s. Qwen templates use
 *  "enable_thinking"; both keys ride together so either template dialect
 *  lands. Same model-gate pattern — no other pin ever sees the knob.
 *
 *  inkling (chat primary since v3.3.3) reasons UNCONDITIONALLY, but cleanly:
 *  probed live 2026-07-20 with all five thinking-off switches (chat_template
 *  _kwargs {thinking:false}, {enable_thinking:false}, both; system "detailed
 *  thinking off"; system "/no_think") — EVERY one is a no-op, the model always
 *  streams its chain-of-thought. The saving grace: it puts that CoT in the
 *  separate reasoning_content FIELD, never bare in content and never in a
 *  <think> block — so the SSE drain (which forwards only delta.content and
 *  ignores reasoning_content) gates it out for free. Given a real budget it
 *  finishes reasoning (~360 tokens) then emits a clean answer in content
 *  (content TTFB ~3.5 s, finish "stop"). No param can shorten the think, and
 *  none is needed for CoT-safety — so inkling gets NO entry here on purpose
 *  (a knob that does nothing would only lie about doing something). */
// v3.7.0 (2026-07-27): of the gates below, only the nemotron-3-nano one is LIVE — it
// still pins the search lane. chat/dj/fast now run openai/gpt-oss-20b, whose thinking is
// capped via reasoning_effort:'low' at the call site (not here). The qwen3 branch is kept
// as defensive legacy (no lane pins qwen today); inkling/deepseek/qwen chat pins are all
// retired. See the LANE_MODEL 2026-07-27 note.
export function reasoningOffParams(model: string): Record<string, unknown> {
  if (model.includes('nemotron-3-nano')) return { chat_template_kwargs: { thinking: false } };
  if (model.includes('qwen3')) return { chat_template_kwargs: { thinking: false, enable_thinking: false } };
  // inkling: CoT lives in reasoning_content, dropped by the stream gate — no
  // functional thinking-off switch exists (all five probed no-op). See above.
  return {};
}

/** Pinned model per lane — slugs verified live against integrate.api.nvidia.com.
 *
 *  Re-pinned 2026-07-17 (v2.7.2), owner-approved:
 *  - chat ran minimaxai/minimax-m3 until it went DEGRADED upstream
 *    (persistent 400). Owner moved on — deepseek-v4-flash probed 200 in
 *    ~1s on the lane's own key (NVIDIA keys are account-scoped, any served
 *    model works on any key). Do NOT re-pin minimax-m3 without owner sign-off.
 *  - search ran google/gemma-4-31b-it until it started hanging upstream
 *    (no HTTP response at all). nemotron-3-nano-30b-a3b probed 200 in ~0.4s
 *    but leaks BARE chain-of-thought into the content stream (no <think>
 *    wrapper, so the SSE gate can't strip it) and burned the expert lane's
 *    whole token budget reasoning — owner's pre-approved swap applied:
 *    diffusiongemma primary, nemotron-nano secondary.
 *
 *  Re-pinned 2026-07-17 (v2.7.3), owner-directed:
 *  - scholar moved to Groq (owner introduced a dedicated Groq key, now
 *    named VINAX_GROQ_API_KEY).
 *    Groq hosts Llama-3.3-70B as llama-3.3-70b-versatile (NO vendor prefix) —
 *    probed live on the lane's own key: 200 in ~125 ms, stream TTFB ~120 ms,
 *    JSON mode OK. The old meta/llama-3.3-70b-instruct slug is NVIDIA-only
 *    and 404s on Groq; llama-3.1-70b-versatile is decommissioned there.
 *
 *  Re-pinned 2026-07-17 (v2.7.4), owner-directed:
 *  - search back on nemotron-3-nano-30b-a3b as PRIMARY, now with reasoning
 *    switched OFF via chat_template_kwargs (see reasoningOffParams — probed
 *    live: the v2.7.2 bare-CoT leak is gone; direct list, finish "stop",
 *    ~70/300 tokens, stream TTFB ~0.5 s). diffusiongemma swaps back to
 *    secondary on the same key.
 *
 *  Re-pinned 2026-07-18 (v3.2.0), owner mandate "update everything to
 *  production":
 *  - chat is OFF deepseek-v4-flash. Measured live twice: 2026-07-17 it
 *    returned 3/10 empty streams (median TTFB ~5 s) and its flakiness put a
 *    500 on /api/home; re-measured 2026-07-18 it was WORSE — 4/6 calls
 *    streamed 200-with-no-content (empty-stream failover to the dj lane) and
 *    the calls it did serve opened at 14–19 s TTFB. qwen3.5-122b-a10b takes
 *    the lane on the SAME key (env name VINAX_DEEPSEEK_V4_FLASH unchanged —
 *    NVIDIA keys are account-scoped, any served model signs). deepseek drops
 *    to the lane's SECONDARY so it reclaims nothing until it heals.
 *
 *  Re-pinned 2026-07-20 (v3.3.2), owner delegation "pick the best HEALTHY
 *  chat engine, reliability first":
 *  - chat is OFF qwen3.5-122b-a10b: it hit end-of-life upstream at
 *    2026-07-20T00:00:00Z and now returns a hard 410 Gone on every call
 *    (probe-verified). The demoted secondary deepseek-v4-flash was already
 *    empty-streaming, so both same-key pins are dead. Probed all NVIDIA-account
 *    candidates (kimi-k2.6, glm-5.2, qwen3-next-80b, mistral-small-4,
 *    nemotron-3-ultra, gpt-oss-120b) on the chat key one-at-a-time: NONE served
 *    — the key authenticates (qwen still 410s, not 403) but every LIVE model
 *    comes back 403 "Authorization failed", i.e. the chat key's NVIDIA account
 *    is out of credits/entitlement as of 2026-07-20. Until the owner refreshes
 *    that account the chat lane can only serve through the cross-lane ladder.
 *    With no non-shared healthy model available on the key, the owner's
 *    pre-authorized fallback takes the seat: openai/gpt-oss-120b (the proven
 *    de-facto rescuer — it also pins dj; reliability over diversity). gpt-oss
 *    keeps its reasoning_effort:'low' gate; no reasoningOffParams needed.
 *
 *  Re-pinned 2026-07-20 (v3.3.3), owner new-key: qwen3.5 is still 410-dead and
 *  the old chat key was credit-exhausted; the owner refreshed the CHAT key
 *  (VINAX_DEEPSEEK_V4_FLASH — env name unchanged) and directed the lane onto
 *  thinkingmachines/inkling. Probed live on the refreshed key (temp lanecheck):
 *  - thinkingmachines/inkling → 200, serves. thinking-machines/inkling and
 *    thinkingmachines/inkling-v1 both 404 (bad slugs) — the no-dash slug is it.
 *  - It reasons UNCONDITIONALLY (all five thinking-off switches no-op — see
 *    reasoningOffParams) but keeps every bit of that CoT in the separate
 *    reasoning_content field, so the SSE drain (forwards only delta.content)
 *    gates it out: zero CoT reaches the client, content is clean, finish "stop".
 *    At the 200-token probe budget it never left reasoning; at the muse budget
 *    (2400) it finished thinking (~360 tokens) then answered cleanly, content
 *    TTFB ~3.5 s. Slower to first token than gpt-oss (~0.6 s) but a world away
 *    from the benched qwen3.5 (9–13 s) / deepseek (14–19 s) — a thoughtful chat
 *    engine, not a broken one.
 *  - openai/gpt-oss-120b also runs clean+fast (~0.6 s) on the refreshed key, so
 *    it takes the same-key SECONDARY seat (below) to cover inkling's one edge:
 *    a heavy query whose reasoning eats the whole budget before content starts
 *    (empty content stream → the drain's failover). Do NOT re-pin gpt-oss to
 *    chat primary without owner sign-off; inkling is the owner's choice.
 *
 *  Re-pinned 2026-07-22 (v3.5.0), health-probe-driven: thinkingmachines/inkling
 *  now returns a hard 404 on the chat key (slug decommissioned upstream — the
 *  owner's v3.3.3 pin is no longer served; "do not re-pin without sign-off" is
 *  void now that the owner's choice is gone). The chat KEY itself is healthy —
 *  probed live one-model-at-a-time on VINAX_DEEPSEEK_V4_FLASH: gpt-oss-120b 200
 *  (~3.6s), gpt-oss-20b 200 (~0.4s), nemotron-super 200 (~3.3s), nemotron-ultra
 *  200 (~1.1s) — so this is a dead SLUG, not a dead key. gpt-oss-120b (the
 *  owner's pre-authorized v3.3.2 chat rescuer — capable general reasoner,
 *  reasoning_effort:'low' gated, JSON-clean) takes the primary seat; the faster
 *  same-key gpt-oss-20b (below) becomes the secondary. This also cleared the
 *  collateral /api/home 500 the 404 caused (home gathers ideas on the chat
 *  lane; inkling's 404→slow-failover was starving the curate budget).
 *
 *  ===== 2026-07-27 (v3.7.0) — health-optimized reassignment across ALL features.
 *  Owner-delegated. Fresh full probe (temp /api/lanecheck, since deleted) hit every
 *  env key with a short real prompt, 2-3 models each, in sequential + solo passes:
 *  - NO key is dead. VINAX_CHATGPT_20_B — flagged credit-exhausted earlier — probes
 *    FUNDED again (gpt-oss-20b 200 in ~1.2s, nemotron-super 200 in ~5.7s); the owner's
 *    account was topped up. All seven keys authenticate and serve.
 *  - The ONE dead element is a MODEL, not a key: NVIDIA-hosted openai/gpt-oss-120b now
 *    HANGS — a solo probe with a 25s leash timed out on all FIVE NVIDIA accounts
 *    (Cloudflare 524, >100s total) while every smaller model on those same keys answered
 *    in ~1-3s. It is RETIRED from the two lanes that pinned it (chat, dj). The same slug
 *    is healthy on Groq (~3.1s), but the Groq key is kept lean for the sub-second
 *    voice/scholar seats, so heavy JSON curation was NOT moved onto it.
 *  - chat (Muse): openai/gpt-oss-120b -> openai/gpt-oss-20b on its OWN key
 *    (VINAX_DEEPSEEK_V4_FLASH). Warm, capable, JSON-clean, reasoning_effort 'low'-gated,
 *    ~1.0s — the healthiest fast general engine on NVIDIA; clears chat's <2s target the
 *    cold-hanging 120B never met.
 *  - dj (Win): openai/gpt-oss-120b -> openai/gpt-oss-20b, still on its own
 *    VINAX_CHATGPT_120_B key. dj is the curate engine for /api/dj, /api/playlist AND
 *    /api/home (home gathers+curates on the dj lane), so it MUST stay FAST — v3.5.1
 *    moved Home off the slow 550B ULTRA onto this fast lane. gpt-oss-20b keeps that speed
 *    (~1.1s on the dj key) with clean JSON, so all three curates get faster, not slower.
 *  - fast/deep/scholar/home/search/voice: engines UNCHANGED, all re-verified healthy.
 *    No key moved; LANE_ENV and LANE_BASE untouched.
 *  Net: NVIDIA gpt-oss-120b (which the failover ladders were already routing away from)
 *  is fully retired; every lane runs a funded primary on a healthy, faster model. */
export const LANE_MODEL: Record<Lane, string> = {
  dj: 'openai/gpt-oss-20b',
  chat: 'openai/gpt-oss-20b',
  deep: 'nvidia/llama-3.3-nemotron-super-49b-v1.5',
  fast: 'openai/gpt-oss-20b',
  scholar: 'llama-3.3-70b-versatile',
  home: 'nvidia/nemotron-3-ultra-550b-a55b',
  search: 'nvidia/nemotron-3-nano-30b-a3b',
};

/** Per-lane SECONDARY model pin — a healthy same-family variant tried on the
 *  lane's OWN key right after the owner-pinned primary and BEFORE any
 *  cross-lane ladder hop. The primary always goes first, so the moment it
 *  heals upstream it reclaims the lane; the secondary just keeps the lane's
 *  character while the primary is degraded or hanging.
 *
 *  Verified live 2026-07-17 (v2.7.4 re-pin) against integrate.api.nvidia.com:
 *  - search: the v2.7.2 demotion is reversed — nemotron-3-nano-30b-a3b is
 *    PRIMARY again now that reasoningOffParams silences its bare CoT, and
 *    diffusiongemma-26b-a4b-it (200 in ~0.4–0.8s warm) returns to secondary
 *    on the same key.
 *  - chat (2026-07-22, v3.5.0): with inkling 404-dead the primary is now
 *    gpt-oss-120b, so the secondary moves to openai/gpt-oss-20b — the FASTEST
 *    healthy model on the chat key (probed 200 in ~0.4 s on
 *    VINAX_DEEPSEEK_V4_FLASH), a quick same-key rescue if the 120B primary is
 *    ever degraded, tried BEFORE any cross-lane ladder hop so the lane stays on
 *    its own funded account. (Was gpt-oss-120b under the v3.3.3 inkling primary;
 *    that model is now the primary itself, so the secondary had to change.)
 *  - scholar (2026-07-17, v2.7.3): llama-3.1-8b-instant on the same Groq key
 *    (probed 200 in ~450 ms) — keeps the lane fast and in-family before any
 *    cross-lane hop back to the NVIDIA-base siblings. */
//  - chat (2026-07-27, v3.7.0): its primary is now openai/gpt-oss-20b itself, so the
//    secondary moves to nvidia/nemotron-3-ultra-550b-a55b — a heavyweight same-key
//    (VINAX_DEEPSEEK_V4_FLASH, account-scoped) backstop for when the fast primary is
//    degraded, tried before any cross-lane hop so chat stays on its own funded account.
//  - home (2026-07-27, v3.7.0): NEW — openai/gpt-oss-20b on home's own VINAX_NEMOTRON_ULTRA
//    key (probed 200 in ~2.6s), a fast rescue for the big 550B ULTRA nova seat when it is
//    slow or capacity-throttled, before the cross-lane ladder.
export const LANE_SECONDARY: Partial<Record<Lane, string>> = {
  chat: 'nvidia/nemotron-3-ultra-550b-a55b',
  home: 'openai/gpt-oss-20b',
  search: 'google/diffusiongemma-26b-a4b-it',
  scholar: 'llama-3.1-8b-instant',
};

/** Env var that holds each lane's key — exported for the admin AI Lab bench. */
export const LANE_ENV: Record<Lane, keyof AiEnv> = {
  dj: 'VINAX_CHATGPT_120_B',
  chat: 'VINAX_DEEPSEEK_V4_FLASH',
  deep: 'VINAX_NEMOTRON_SUPER',
  fast: 'VINAX_CHATGPT_20_B',
  scholar: 'VINAX_GROQ_API_KEY',
  home: 'VINAX_NEMOTRON_ULTRA',
  search: 'VINAX_NVIDIA_NEMOTRON_3_NANO_30B_A3B',
};

/** Cross-lane failover ladder: when a lane's own key/model pair is missing or
 *  dead, the next live pair takes the call — one dead key never takes a
 *  feature down, it just degrades to a healthy sibling lane.
 *  Order: DEEPSEEK_V4_FLASH → CHATGPT_120_B → NEMOTRON_ULTRA →
 *  NEMOTRON_SUPER → GROQ → CHATGPT_20_B → NANO. */
const LADDER: Lane[] = ['chat', 'dj', 'home', 'deep', 'scholar', 'fast', 'search'];

export interface LaneAttempt {
  key: string;
  model: string;
  role: Lane;
  /** Full chat-completions URL for THIS attempt's lane — providers are mixed
   *  now, so every ladder hop must carry its own base alongside key+model. */
  endpoint: string;
}

/** Ordered key+model+endpoint attempts for a lane: its own pair first, then
 *  its same-key secondary pin (when one exists), then the cross-lane ladder.
 *  Each attempt carries its lane's endpoint so mixed-provider failover signs
 *  every hop against the right base. */
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
 *  over across the lane ladder; returns assistant text. */
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
     *  or unresponsive pinned model gets a fair shot without starving the
     *  failover ladder of budget. Laddered attempts use timeoutMs. */
    firstTimeoutMs?: number;
    /** Per-call failover order override — time-critical big-JSON jobs put the
     *  fastest reliable generator first. Default: the global key ladder. */
    ladder?: Lane[];
    /** Aggregate wall-clock deadline (epoch ms). The lane failover ladder
     *  never starts an attempt past it, so callers get an answer or a fast,
     *  honest failure instead of stacked retries that outlive client patience
     *  (DQA-02). */
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
      // nemotron-3-nano leaks BARE chain-of-thought unless its reasoning is
      // switched off at the chat-template level (probed live — see
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
