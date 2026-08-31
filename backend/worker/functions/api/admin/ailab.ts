/**
 * AI Lab — admin-only streaming test bench for every AI lane (13 in v5.4.0).
 *
 * POST { lane, messages: [{ role, content }...], maxTokens? } and the reply
 * streams back as SSE (meta → delta* → done), the same wire format as
 * /api/vinaxai — but the call goes to the lane's OWN key + pinned model with
 * NO failover ladder: this is a diagnostic bench, so a dead lane must fail
 * honestly instead of a healthy sibling quietly covering its shift.
 *
 * Upstream failures come back as a 200 JSON envelope { error, status, head }
 * because Cloudflare masks origin 5xx bodies and the admin UI wants the real
 * story. maxTokens is capped at 1000 — this is a bench, not a workload.
 */
import { isAdmin, unauthorized, type AdminEnv } from '../../_lib/admin';
import { LANE_ENV, LANE_MODEL, isGroqEndpoint, laneEndpoint, reasoningOffParams, type AiEnv, type Lane } from '../../_lib/ai';
import { aggregateLaneHealth, type AiEventRow } from '../../_lib/laneHealth';
import { sbSelect, type SupabaseEnv } from '../../_lib/supabase';

type Env = AdminEnv & AiEnv & SupabaseEnv;

// v5.6.1: the bench covers EVERY lane over the owner's 18 live keys — the
// feature lanes plus the inventory lanes that give each remaining model its
// own probe-able row. Inventory lanes drive no features; a dead or absent
// model fails its bench ping honestly, which is the point.
const LANES: readonly Lane[] = [
  'chat', 'fast', 'deep', 'scholar', 'home', 'dj', 'search',
  'pro', 'mini', 'agent',
  'dsflash', 'muse', 'rank', 'rank2', 'laguna', 'diffusion',
  'omni', 'gemma4', 'oss120',
];
const MAX_TOKENS_CAP = 1000;

interface InMsg {
  role?: unknown;
  content?: unknown;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

/** Package B11 — GET: the lane-health report. Per-lane p50/p95/p99 latency,
 *  success rate, failover-hop / empty-stream / self-search counters over the
 *  trailing 24h of vinax_ai_events, aggregated in-function (no RPC needed;
 *  row cap keeps the read bounded). */
export const onRequestGet = async (context: { request: Request; env: Env }): Promise<Response> => {
  const { request, env } = context;
  if (!isAdmin(request, env)) return unauthorized();
  const since = new Date(Date.now() - 24 * 3600_000).toISOString();
  const rows = await sbSelect<AiEventRow>(
    env,
    'vinax_ai_events',
    `created_at=gte.${encodeURIComponent(since)}&select=model,ok,status,error,latency_ms&order=created_at.desc&limit=10000`,
  );
  return json({ hours: 24, sampled: rows.length, capped: rows.length >= 10000, lanes: aggregateLaneHealth(rows) });
};

export const onRequestPost = async (context: { request: Request; env: Env }): Promise<Response> => {
  const { request, env } = context;
  if (!isAdmin(request, env)) return unauthorized();

  let body: { lane?: unknown; messages?: InMsg[]; maxTokens?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json({ error: 'bad_request' }, 400);
  }

  const laneRaw = typeof body.lane === 'string' ? body.lane : '';
  if (!(LANES as readonly string[]).includes(laneRaw)) return json({ error: 'unknown_lane', lanes: LANES }, 400);
  const lane = laneRaw as Lane;

  const messages = (Array.isArray(body.messages) ? body.messages : [])
    .filter(
      (m) =>
        (m?.role === 'system' || m?.role === 'user' || m?.role === 'assistant') &&
        typeof m?.content === 'string' &&
        m.content.trim().length > 0,
    )
    .slice(-24)
    .map((m) => ({ role: m.role as 'system' | 'user' | 'assistant', content: String(m.content).slice(0, 8000) }));
  if (!messages.length) return json({ error: 'bad_request' }, 400);

  const mtRaw = typeof body.maxTokens === 'number' && Number.isFinite(body.maxTokens) ? Math.floor(body.maxTokens) : 700;
  const maxTokens = Math.min(Math.max(1, mtRaw), MAX_TOKENS_CAP);

  const model = LANE_MODEL[lane];
  const key = env[LANE_ENV[lane]];
  if (!key) return json({ error: 'not_configured', status: 0, head: `${LANE_ENV[lane]} is not set`, lane, model });


  // The bench probes the lane's OWN endpoint — providers are mixed now.
  const endpoint = laneEndpoint(env, lane);
  const payload: Record<string, unknown> = { model, messages, temperature: 0.7, max_tokens: maxTokens, stream: true };
  // gpt-oss models are reasoners: keep the thinking short so bench replies
  // arrive fast instead of burning the token budget before the answer.
  // (NVIDIA-only knob — Groq 400s on it, probed live.)
  if (model.includes('gpt-oss') && !isGroqEndpoint(endpoint)) payload.reasoning_effort = 'low';
  // Reasoning off for nemotron-3-nano (search primary) — the bench must see
  // the model exactly as production runs it. Model-gated no-op elsewhere.
  Object.assign(payload, reasoningOffParams(model));

  // 30s leash on the WHOLE upstream call: a hung engine must fail the test,
  // not hang the admin tab.
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 30_000);

  let up: Response;
  try {
    up = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify(payload),
      signal: abort.signal,
    });
  } catch (e) {
    clearTimeout(timer);
    const head = e instanceof Error ? `${e.name}: ${e.message}`.slice(0, 220) : String(e).slice(0, 220);
    return json({ error: 'unreachable', status: 0, head, lane, model });
  }

  if (!up.ok || !up.body) {
    clearTimeout(timer);
    const head = await up
      .text()
      .then((t) => t.slice(0, 220))
      .catch(() => '');
    // 200 envelope on purpose: Cloudflare masks origin 5xx bodies (DQA-02).
    return json({ error: 'upstream', status: up.status, head, lane, model });
  }

  const upBody = up.body;
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (obj: unknown): void => controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
      send({ meta: { model, lane } });
      const reader = upBody.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      let full = '';
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          let nl: number;
          while ((nl = buf.indexOf('\n')) >= 0) {
            const line = buf.slice(0, nl).trim();
            buf = buf.slice(nl + 1);
            if (!line.startsWith('data:')) continue;
            const data = line.slice(5).trim();
            if (!data || data === '[DONE]') continue;
            try {
              const j = JSON.parse(data) as { choices?: Array<{ delta?: { content?: unknown } }> };
              let delta = j.choices?.[0]?.delta?.content;
              if (typeof delta === 'string' && delta) {
                // Models often open with stray whitespace — swallow it until
                // real content starts so replies begin cleanly.
                if (!full) {
                  delta = delta.replace(/^\s+/, '');
                  if (!delta) continue;
                }
                full += delta;
                send({ delta });
              }
            } catch {
              /* skip a malformed SSE chunk */
            }
          }
        }
      } catch {
        // The 30s leash fired or the upstream dropped mid-stream — say so.
        send({ error: 'stream_aborted' });
      }
      clearTimeout(timer);
      send({ done: true, chars: full.length });
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store',
      connection: 'keep-alive',
    },
  });
};
