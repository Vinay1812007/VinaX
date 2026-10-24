/**
 * System health: live-checks the AI keys (tiny 4-token ping, each against its
 * OWN provider endpoint), so an outage shows its exact cause instead of
 * guesswork. Admin-gated because each check spends a few model tokens.
 *
 * 10.3 — one key per provider, so `ai` is four rows (NVIDIA, OpenRouter,
 * Groq, Gemini), each pinging the model its lane would use right now and
 * naming the lanes that sign with it. `lanes` lists every lane with its
 * provider and whether that provider's key is set.
 *
 * 10.3 — each key row also names the secret that supplies the key right now
 * (`envInUse`: the primary name, the previous name during the switch, or
 * null) and carries that provider's free `media` models ({ id, name, kind })
 * and `tools` (code execution and the chat models that run it).
 */
import { isAdminAsync, unauthorized, type AdminEnv } from '../../_lib/admin';
import { rateLimitAsync } from '../../_lib/ratelimit';
import { AI_PROVIDERS, LANE_MODEL, LANE_PROVIDER, providerEnvName, PROVIDER_LABEL, PROVIDER_LANE, isMaestroEndpoint, laneEndpoint, laneModel, providerKey, providerKeySource, type AiEnv, type AiProvider, type Lane } from '../../_lib/ai';
import { maestroFetch } from '../../_lib/maestro';
import { isWorkersAiEndpoint, workersAiFetch, type WorkersAiBinding } from '../../_lib/workersai';
import { catalogDefaultModel, fetchMedia, fetchTools, type MediaKind, type ToolEntry } from '../../_lib/catalog';

type Env = AdminEnv & AiEnv;

interface KeyHealth {
  key: string;
  /** 10.3 — the provider this key belongs to, its secret name and the lanes it signs. */
  provider?: AiProvider;
  env?: string;
  /** 10.3 — the secret name supplying the key right now (primary or previous), or null. */
  envInUse?: string | null;
  lanes?: Lane[];
  /** 10.3 — the provider's free media models and tools. */
  media?: Array<{ id: string; name: string; kind: MediaKind }>;
  tools?: ToolEntry[];
  configured: boolean;
  ok: boolean;
  status: number | null;
  model: string | null;
  note: string | null;
}

async function pingKey(name: string, key: string | null, model: string, base: string, ai?: WorkersAiBinding): Promise<KeyHealth> {
  if (!key) return { key: name, configured: false, ok: false, status: null, model: null, note: 'not configured' };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 9000);
  try {
    const ping = { model, max_tokens: 4, messages: [{ role: 'user', content: 'ping' }] };
    const res = isMaestroEndpoint(base)
      ? await maestroFetch(key, model, ping, controller.signal)
      : isWorkersAiEndpoint(base)
        ? await workersAiFetch(ai ?? null, ping, controller.signal)
        : await fetch(base, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
          body: JSON.stringify(ping),
          signal: controller.signal,
        });
    // Audit finding M-SRV-5: the previous line dropped up to 180 bytes of the
    // raw upstream body straight into the admin JSON — some providers echo the
    // bearer key or internal stack lines in their 4xx bodies. A sanitized
    // status token is enough for triage.
    const note: string | null = res.ok ? null : `${res.status}:${model}`;
    return { key: name, configured: true, ok: res.ok, status: res.status, model, note };
  } catch {
    return { key: name, configured: true, ok: false, status: null, model, note: 'network error / timeout' };
  } finally {
    clearTimeout(timer);
  }
}

export const onRequestGet = async (context: { request: Request; env: Env }): Promise<Response> => {
  const { request, env } = context;
  if (!(await isAdminAsync(request, env))) return unauthorized();
  // 4 live model pings per call — cap the frequency so a stuck 10s auto-
  // refresh loop can't burn upstream quota (audit: unthrottled).
  const limited = await rateLimitAsync(request, 'admin-health', { capacity: 4, refillPerMinute: 2 }, env);
  if (limited) return limited;
  // Each key is pinged with the model its lane would ACTUALLY use right now.
  // The Groq and OpenRouter lanes serve a moving catalogue, so their model
  // comes from the live free list — a fixed pin here reported a 404 that
  // said nothing about whether the key works.
  const lanesOf = (p: AiProvider): Lane[] => (Object.keys(LANE_PROVIDER) as Lane[]).filter((l) => LANE_PROVIDER[l] === p);
  const pingModel = async (p: AiProvider): Promise<string> => {
    const lane = PROVIDER_LANE[p];
    if (lane === 'scholar' || lane === 'router') return (await catalogDefaultModel(env, p)) ?? LANE_MODEL[lane];
    return laneModel(env, lane);
  };
  const keyRows = await Promise.all(
    AI_PROVIDERS.map(async (p): Promise<KeyHealth> => {
      const lanes = lanesOf(p);
      const row = await pingKey(`${PROVIDER_LABEL[p]} · ${lanes.join(', ')}`, providerKey(env, p), await pingModel(p), laneEndpoint(env, PROVIDER_LANE[p]), env.AI);
      const [media, tools] = await Promise.all([fetchMedia(env, p), fetchTools(env, p)]);
      return { ...row, provider: p, env: providerEnvName(p), envInUse: providerKeySource(env, p)?.name ?? null, lanes, media: media.map((m) => ({ id: m.id, name: m.name, kind: m.kind })), tools };
    }),
  );
  // Every lane with its provider and whether that provider's key is set.
  const lanes = (Object.keys(LANE_PROVIDER) as Lane[]).map((lane) => ({
    lane,
    provider: LANE_PROVIDER[lane],
    keySet: providerKey(env, LANE_PROVIDER[lane]) !== null,
  }));
  return new Response(
    JSON.stringify({ time: new Date().toISOString(), ai: keyRows, lanes }),
    { headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } },
  );
};
