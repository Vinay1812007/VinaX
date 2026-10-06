/**
 * GET /api/aimodels — the live free-model menu, one group per provider key.
 *
 * 10.3 — four keys, one per provider, and each opens a whole catalogue.
 * Rather than shipping a hard-coded list that goes stale, this endpoint asks
 * each provider for its own model list and returns the chat-capable, free
 * entries (see _lib/catalog.ts for the filters), so the model picker and the
 * admin Lab always show what is actually callable today:
 *
 *   { fetchedAt,
 *     providers: [ { id: 'nvidia' | 'openrouter' | 'groq' | 'gemini',
 *                    label: 'NVIDIA' | 'OpenRouter' | 'Groq' | 'Gemini',
 *                    configured: boolean,
 *                    models: [ { id, name, maker, context, vision } ] } ] }
 *
 * Always the four providers, in that order. `name` is the model's original
 * published name and `maker` who made it; `id` is the exact slug to send back
 * as `{ mode: 'model', provider, model }` to /api/vinaxai.
 *
 * No key ever leaves the Worker: only slugs, names and sizes go out.
 * Catalogue systems that browse the web on their own are never listed
 * (10.2 — see WEB_BROWSING_SLUGS in _lib/catalog.ts).
 * An empty provider is reported as empty — a missing secret or an
 * unreachable provider never turns into an invented menu.
 */
import { rateLimitAsync, methodNotAllowed } from '../_lib/ratelimit';
import { fullCatalog } from '../_lib/catalog';
import { AI_PROVIDERS, PROVIDER_ENV, PROVIDER_LABEL, type AiEnv } from '../_lib/ai';

type Env = AiEnv;

export const onRequestGet = async (context: { request: Request; env: Env }): Promise<Response> => {
  const { request, env } = context;
  // Each miss costs up to four upstream calls; the 15-minute isolate cache
  // absorbs the rest. Throttle anyway so a looping client can't hammer the
  // providers.
  const limited = await rateLimitAsync(request, 'aimodels', { capacity: 12, refillPerMinute: 12 }, env);
  if (limited) return limited;

  const lists = await fullCatalog(env);
  return new Response(
    JSON.stringify({
      fetchedAt: new Date().toISOString(),
      providers: AI_PROVIDERS.map((id) => ({
        id,
        label: PROVIDER_LABEL[id],
        configured: Boolean(env[PROVIDER_ENV[id]]),
        models: lists[id].map((m) => ({ id: m.id, name: m.name, maker: m.maker, context: m.context, vision: m.vision })),
      })),
    }),
    {
      headers: {
        'content-type': 'application/json',
        // Short shared cache: the menu changes rarely, and a stale-while-
        // revalidate window keeps the picker instant.
        'cache-control': 'public, max-age=300, stale-while-revalidate=900',
        // 7.2.0 — readable cross-origin (a bundled Android build runs on https://localhost).
        'access-control-allow-origin': '*',
      },
    },
  );
};

/** GET-only: anything else must 405 instead of falling through to the SPA. */
export const onRequestPost = async (): Promise<Response> => methodNotAllowed('GET, OPTIONS');
