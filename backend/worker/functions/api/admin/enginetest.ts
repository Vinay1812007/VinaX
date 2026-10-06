/** Probe one chat model on one provider key — status + latency. Admin-gated.
 *  Used to validate a model before wiring it, and to re-verify every lane
 *  after a key change.
 *  ?key= names which provider key signs the call (10.3 — one per provider):
 *  NVIDIA (default), OPENROUTER, GROQ or GEMINI; the provider ids in lower
 *  case and the pre-10.3 names of the three shared keys (GROQ_API_KEY,
 *  OPENROUTER_API_KEY, MAESTRO) are accepted too.
 *  ?model= the slug to probe — any model the provider's live catalogue lists,
 *  or a lane pin on that provider (default: the provider's lane model).
 *  Response: { key, provider, model, status, ms, head, mode?, media, tools }.
 *  10.3 — `media` ({ id, name, kind }) and `tools` list the provider's free
 *  media models and tools; this probe itself is chat-only — a media model is
 *  benched in the AI Lab ({ provider, model, kind }). */
import { isAdminAsync, unauthorized, type AdminEnv } from '../../_lib/admin';
import { rateLimitAsync } from '../../_lib/ratelimit';
import { LANE_PROVIDER, LANE_SECONDARY, PROVIDER_ENV, PROVIDER_LANE, isMaestroEndpoint, laneEndpoint, laneModel, providerKey, type AiEnv, type AiProvider, type Lane } from '../../_lib/ai';
import { catalogDefaultModel, fetchMedia, fetchTools, findCatalogModel, normaliseProvider } from '../../_lib/catalog';
import { maestroFetch, maestroLearnedMode } from '../../_lib/maestro';

type Env = AdminEnv & AiEnv;

// One row per provider key, keyed by a short name so a probe URL stays typable.
const BY_KEY: Record<string, AiProvider> = {
  NVIDIA: 'nvidia',
  OPENROUTER: 'openrouter',
  GROQ: 'groq',
  GEMINI: 'gemini',
  // Pre-10.3 names of the keys that survived the change.
  GROQ_API_KEY: 'groq',
  OPENROUTER_API_KEY: 'openrouter',
  MAESTRO: 'gemini',
  // 10.3 — the primary secret names themselves.
  NVIDIA_API_KEY: 'nvidia',
  GEMINI_API_KEY: 'gemini',
};

function json(o: unknown, status = 200): Response {
  return new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
}

/** The models a lane pins on this provider (primaries and secondaries). */
function pinsOn(env: AiEnv, provider: AiProvider): string[] {
  return (Object.keys(LANE_PROVIDER) as Lane[])
    .filter((l) => LANE_PROVIDER[l] === provider)
    .flatMap((l) => [laneModel(env, l), LANE_SECONDARY[l]])
    .filter((m): m is string => typeof m === 'string');
}

export const onRequestGet = async (context: { request: Request; env: Env }): Promise<Response> => {
  const { request, env } = context;
  if (!(await isAdminAsync(request, env))) return unauthorized();
  // Upstream ping — throttle even for authed callers (audit: unthrottled).
  const limited = await rateLimitAsync(request, 'admin-enginetest', { capacity: 10, refillPerMinute: 10 }, env);
  if (limited) return limited;
  const url = new URL(request.url);
  const name = (url.searchParams.get('key') ?? 'NVIDIA').trim();
  const provider = BY_KEY[name.toUpperCase()] ?? normaliseProvider(name);
  if (!provider) return json({ error: 'unknown key', keys: Object.keys(BY_KEY) }, 400);
  const suffix = name.toUpperCase();
  const key = providerKey(env, provider);
  if (!key) return json({ key: suffix, provider, error: 'env not set', env: PROVIDER_ENV[provider] }, 503);
  const lane = PROVIDER_LANE[provider];
  const wanted = url.searchParams.get('model');
  let model: string;
  if (wanted) {
    // 10.3 — only a model the provider lists right now, or a lane pin on it.
    const listed = await findCatalogModel(env, provider, wanted);
    const pinned = pinsOn(env, provider).includes(wanted.trim());
    if (!listed && !pinned) return json({ key: suffix, provider, error: 'unknown_model' }, 400);
    model = listed?.id ?? wanted.trim();
  } else {
    model = lane === 'scholar' || lane === 'router' ? ((await catalogDefaultModel(env, provider)) ?? laneModel(env, lane)) : laneModel(env, lane);
  }
  const base = laneEndpoint(env, lane);
  const t0 = Date.now();
  const c = new AbortController();
  // Capture the timer id and clear it in finally so it doesn't tick after
  // the fetch resolves (audit finding L7).
  const timerId = setTimeout(() => c.abort(), 15_000);
  try {
    const probe = { model, messages: [{ role: 'user', content: 'Reply with exactly: OK' }], max_tokens: 8, temperature: 0 };
    const up = isMaestroEndpoint(base)
      ? await maestroFetch(key, model, probe, c.signal, false)
      : await fetch(base, {
          method: 'POST',
          headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
          body: JSON.stringify(probe),
          signal: c.signal,
        });
    const ms = Date.now() - t0;
    const txt = await up.text().catch(() => '');
    const [media, tools] = await Promise.all([fetchMedia(env, provider), fetchTools(env, provider)]);
    const lists = { media: media.map((m) => ({ id: m.id, name: m.name, kind: m.kind })), tools };
    // The maestro transport also says which of the provider's endpoints accepted this key.
    return json({ key: suffix, provider, model, status: up.status, ms, head: txt.slice(0, 220), ...(isMaestroEndpoint(base) ? { mode: maestroLearnedMode() } : {}), ...lists });
  } catch (e) {
    return json({ key: suffix, provider, model, status: 0, ms: Date.now() - t0, exception: e instanceof Error ? e.message : String(e) });
  } finally {
    clearTimeout(timerId);
  }
};
