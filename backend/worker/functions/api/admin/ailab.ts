/**
 * AI Lab — admin-only streaming test bench for every AI lane and every
 * catalogue model.
 *
 * POST { lane, messages: [{ role, content }...], maxTokens?, model? } benches
 * a lane (its pinned model, or `model` on the lane's key), and
 * POST { provider, model, messages, maxTokens? } (10.3) benches any model
 * from that provider's live catalogue on the provider's single key. The reply
 * streams back as SSE (meta → delta* → done), the same wire format as
 * /api/vinaxai — but with NO failover ladder: this is a diagnostic bench, so
 * a dead model must fail honestly instead of a healthy sibling quietly
 * covering its shift. meta = { model: <slug>, name, provider, lane }.
 *
 * Upstream failures come back as a 200 JSON envelope { error, status, head }
 * because Cloudflare masks origin 5xx bodies and the admin UI wants the real
 * story. maxTokens is capped at 1000 — this is a bench, not a workload.
 *
 * 10.3 — media benches: POST { provider, model, kind } runs one cheap call on
 * a model from the provider's live free MEDIA list and answers JSON (never a
 * stream): { ok, kind, provider, model, name, ms, status, bytes?, type?,
 * image?, text?, error? }.
 *   image          one picture from `prompt` (default: a small test prompt);
 *                  `image` is the data URL so the console can show it
 *   speech         one short sentence (`text`, default a test line) with
 *                  `voice` or the model's first voice; `bytes` and `type`
 *   transcription  `audio` (a data URL) → `text`; without audio:
 *                  { error: 'audio_required' }
 *   music, embedding  list-only here: { ok: false, listOnly: true } — a
 *                  track is too heavy for a bench, and /api/embed exercises
 *                  the embedding models.
 */
import { dbFailure, isAdminAsync, unauthorized, type AdminEnv } from '../../_lib/admin';
import { maestroFetch } from '../../_lib/maestro';
import { isWorkersAiEndpoint, workersAiBinding, workersAiFetch } from '../../_lib/workersai';
import {
  LANE_ENV,
  LANE_MODEL,
  laneKey,
  LANE_PROVIDER,
  LANE_SECONDARY,
  PROVIDER_ENV,
  providerEnvName,
  PROVIDER_LANE,
  laneModel,
  isMaestroEndpoint,
  isExternalEndpoint,
  isRefusalCode,
  laneEndpoint,
  reasoningOffParams,
  type AiEnv,
  type AiProvider,
  type KeyLane,
  type Lane,
} from '../../_lib/ai';
import { MEDIA_KINDS, catalogDefaultModel, describeModel, findCatalogModel, findMediaModel, normaliseProvider, type MediaKind } from '../../_lib/catalog';
import { generateImage, speak, transcribe } from '../../_lib/media';
import { readAudio } from '../transcribe';
import { aggregateLaneHealth, type AiEventRow } from '../../_lib/laneHealth';
import { sbSelectResult, supabaseConfigured, type SupabaseEnv } from '../../_lib/supabase';

type Env = AdminEnv & AiEnv & SupabaseEnv;

// The bench covers EVERY lane — the feature lanes, the two vision lanes, the
// free-model marketplace and the flagship. 10.3 — the bench-only inventory
// lanes left with their per-model keys: any model a provider lists is now
// benched by { provider, model } instead.
const LANES: readonly Lane[] = [
  'chat', 'fast', 'deep', 'scholar', 'home', 'dj', 'search',
  'pro', 'mini', 'router', 'maestro',
  'vision', 'vision90',
];

/** 10.3 — a model the bench may send on a provider's key: one the provider
 * lists right now, or one a lane pins there (a pin can be served while the
 * public list leaves it out, and the bench is how that is found out). */
async function benchModel(env: AiEnv, provider: AiProvider, wanted: unknown): Promise<string | null> {
  const listed = await findCatalogModel(env, provider, wanted);
  if (listed) return listed.id;
  if (typeof wanted !== 'string') return null;
  const pins = (Object.keys(LANE_PROVIDER) as Lane[])
    .filter((l) => LANE_PROVIDER[l] === provider)
    .flatMap((l) => [laneModel(env, l), LANE_SECONDARY[l]])
    .filter((m): m is string => typeof m === 'string');
  return pins.includes(wanted.trim()) ? wanted.trim() : null;
}
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
  if (!(await isAdminAsync(request, env))) return unauthorized();
  if (!supabaseConfigured(env)) return json({ configured: false, hours: 24, sampled: 0, capped: false, lanes: aggregateLaneHealth([]) });
  const since = new Date(Date.now() - 24 * 3600_000).toISOString();
  const read = await sbSelectResult<AiEventRow>(
    env,
    'vinax_ai_events',
    `created_at=gte.${encodeURIComponent(since)}&select=model,ok,status,error,latency_ms&order=created_at.desc&limit=10000`,
  );
  // 7.2.0 — lane health built from a failed read shows every lane idle.
  if (!read.ok) return dbFailure(read);
  // Refused calls (owner AI controls) reached no lane; they would read as an
  // "unknown" lane full of failures.
  const rows = read.rows.filter((r) => !isRefusalCode(r.error));
  return json({ configured: true, hours: 24, sampled: rows.length, capped: read.rows.length >= 10000, lanes: aggregateLaneHealth(rows) });
};

export const onRequestPost = async (context: { request: Request; env: Env }): Promise<Response> => {
  const { request, env } = context;
  if (!(await isAdminAsync(request, env))) return unauthorized();

  let body: { lane?: unknown; provider?: unknown; messages?: InMsg[]; maxTokens?: unknown; model?: unknown; kind?: unknown; prompt?: unknown; text?: unknown; voice?: unknown; audio?: unknown; mime?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json({ error: 'bad_request' }, 400);
  }

  // 10.3 — { provider, model } benches a catalogue model on that provider's
  // key (riding the provider's lane endpoint and transport); { lane } as before.
  const byProvider = body.provider !== undefined && body.provider !== null ? normaliseProvider(body.provider) : null;
  if (body.provider !== undefined && body.provider !== null && !byProvider) return json({ error: 'unknown_provider', providers: Object.keys(PROVIDER_ENV) }, 400);
  // 10.3 — a media model bench.
  if (byProvider && body.kind !== undefined) return benchMedia(env, byProvider, body);
  const laneRaw = byProvider ? PROVIDER_LANE[byProvider] : typeof body.lane === 'string' ? body.lane : '';
  if (!(LANES as readonly string[]).includes(laneRaw)) return json({ error: 'unknown_lane', lanes: LANES, providers: Object.keys(PROVIDER_ENV) }, 400);
  const lane = laneRaw as Lane;
  const provider = LANE_PROVIDER[lane];

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

  // v5.6.3 — optional model override: the Lab can probe ANY candidate slug on
  // a lane's own key, so a replacement model is VERIFIED SERVING before it is
  // ever pinned (the registry's core honesty rule).
  // 10.3 — by provider, the model must be one that provider lists (or a lane
  // pin on it): an unknown slug is refused before any key is used.
  if (byProvider && body.model !== undefined) {
    const ok = await benchModel(env, byProvider, body.model);
    if (!ok) return json({ error: 'unknown_model', provider: byProvider }, 400);
    body.model = ok;
  }
  const overrideModel =
    typeof body.model === 'string' && /^[\w./:-]{1,128}$/.test(body.model) ? body.model : null;
  // A catalog lane has no trustworthy fixed pin — resolve its current default
  // from the live free list so the bench probes what production would use,
  // not a slug the provider retired. An explicit override always wins.
  const catalogLane = lane === 'scholar' || lane === 'router';
  const model =
    overrideModel ?? (catalogLane ? ((await catalogDefaultModel(env, provider)) ?? LANE_MODEL[lane]) : laneModel(env, lane));
  const key = laneKey(env, lane);
  if (!key) return json({ error: 'not_configured', status: 0, head: `${lane in LANE_ENV ? LANE_ENV[lane as KeyLane] : 'The AI binding'} is not set`, lane, provider, model });


  // The bench probes the lane's OWN endpoint — providers are mixed now.
  const endpoint = laneEndpoint(env, lane);
  const payload: Record<string, unknown> = { model, messages, temperature: 0.7, max_tokens: maxTokens, stream: true };
  // gpt-oss models are reasoners: keep the thinking short so bench replies
  // arrive fast instead of burning the token budget before the answer.
  // (Default-base-only knob — the external hosts 400 on it, probed live.)
  if (model.includes('gpt-oss') && !isExternalEndpoint(endpoint)) payload.reasoning_effort = 'low';
  // Reasoning off for nemotron-3-nano (search primary) — the bench must see
  // the model exactly as production runs it. Model-gated no-op elsewhere.
  Object.assign(payload, reasoningOffParams(model));

  // 30s leash on the WHOLE upstream call: a hung engine must fail the test,
  // not hang the admin tab. 10.3 — a provider bench never swaps the model.
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 30_000);

  let up: Response;
  try {
    up = isMaestroEndpoint(endpoint)
      ? await maestroFetch(key, model, payload, abort.signal, !byProvider)
      : isWorkersAiEndpoint(endpoint)
        ? await workersAiFetch(workersAiBinding(env), payload, abort.signal)
        : await fetch(endpoint, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
          body: JSON.stringify(payload),
          signal: abort.signal,
        });
  } catch (e) {
    clearTimeout(timer);
    const head = e instanceof Error ? `${e.name}: ${e.message}`.slice(0, 220) : String(e).slice(0, 220);
    return json({ error: 'unreachable', status: 0, head, lane, provider, model });
  }

  if (!up.ok || !up.body) {
    clearTimeout(timer);
    const head = await up
      .text()
      .then((t) => t.slice(0, 220))
      .catch(() => '');
    // 200 envelope on purpose: Cloudflare masks origin 5xx bodies (DQA-02).
    return json({ error: 'upstream', status: up.status, head, lane, provider, model });
  }

  const upBody = up.body;
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (obj: unknown): void => controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
      send({ meta: { model, name: describeModel(provider, model).name, provider, lane } });
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

/** 10.3 — one cheap call on a free media model, validated against the live media list. */
async function benchMedia(
  env: Env,
  provider: AiProvider,
  body: { model?: unknown; kind?: unknown; prompt?: unknown; text?: unknown; voice?: unknown; audio?: unknown; mime?: unknown },
): Promise<Response> {
  const kind = typeof body.kind === 'string' && (MEDIA_KINDS as readonly string[]).includes(body.kind) ? (body.kind as MediaKind) : null;
  if (!kind) return json({ error: 'unknown_kind', kinds: MEDIA_KINDS }, 400);
  if (!laneKey(env, PROVIDER_LANE[provider])) return json({ error: 'not_configured', status: 0, head: `${providerEnvName(provider)} is not set`, provider, kind });
  const m = await findMediaModel(env, provider, kind, body.model);
  if (!m) return json({ error: 'unknown_model', provider, kind }, 400);
  const base = { kind, provider, model: m.id, name: m.name };
  if (kind === 'music' || kind === 'embedding') return json({ ...base, ok: false, listOnly: true });
  const t0 = Date.now();
  if (kind === 'image') {
    const prompt = typeof body.prompt === 'string' && body.prompt.trim().length >= 3 ? body.prompt.trim().slice(0, 600) : 'a small red circle on a plain white background';
    const r = await generateImage(env, provider, m.id, prompt);
    return json(r.ok ? { ...base, ok: true, ms: Date.now() - t0, status: 200, bytes: r.value.length, image: r.value } : { ...base, ok: false, ms: Date.now() - t0, status: r.status, error: r.reason });
  }
  if (kind === 'speech') {
    const text = typeof body.text === 'string' && body.text.trim() ? body.text.trim().slice(0, 200) : 'This is a VinaX AI Lab speech test.';
    const want = typeof body.voice === 'string' ? body.voice.trim().toLowerCase() : '';
    const voice = (m.voices ?? []).find((v) => v.toLowerCase() === want) ?? m.voices?.[0] ?? null;
    const r = await speak(env, provider, m.id, voice, text);
    if (!r.ok) return json({ ...base, ok: false, ms: Date.now() - t0, status: r.status, error: r.reason });
    const bytes = r.value.body instanceof Uint8Array ? r.value.body.length : (await new Response(r.value.body).arrayBuffer()).byteLength;
    return json({ ...base, ok: true, ms: Date.now() - t0, status: 200, bytes, type: r.value.type, voice });
  }
  const audio = readAudio(body.audio, body.mime);
  if (!audio) return json({ ...base, ok: false, error: 'audio_required' }, 400);
  const r = await transcribe(env, provider, m.id, audio.bytes, audio.mime, null);
  return json(r.ok ? { ...base, ok: true, ms: Date.now() - t0, status: 200, text: r.value } : { ...base, ok: false, ms: Date.now() - t0, status: r.status, error: r.reason });
}
