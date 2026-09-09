/**
 * GET /api/aimodels — the live free-model menu for the two aggregator keys.
 *
 * Sixteen of VinaX's keys sign one pinned engine each; these two open whole
 * catalogs. Rather than shipping a hard-coded list that goes stale, this
 * endpoint asks each provider for its own model list and returns the
 * chat-capable, zero-cost entries (see _lib/catalog.ts for the filters), so
 * the engine picker and the admin Lab always show what is actually callable
 * today.
 *
 * No key ever leaves the Worker: only slugs, labels and context sizes go out.
 * Empty groups are reported as empty — a missing secret or an unreachable
 * provider never turns into an invented menu.
 */
import { rateLimit, methodNotAllowed } from '../_lib/ratelimit';
import { fullCatalog } from '../_lib/catalog';
import { type AiEnv } from '../_lib/ai';

type Env = AiEnv;

export const onRequestGet = async (context: { request: Request; env: Env }): Promise<Response> => {
  const { request, env } = context;
  // Each miss costs two upstream calls; the 15-minute isolate cache absorbs
  // the rest. Throttle anyway so a looping client can't hammer the providers.
  const limited = rateLimit(request, 'aimodels', { capacity: 12, refillPerMinute: 12 });
  if (limited) return limited;

  const { grq, opr } = await fullCatalog(env);
  return new Response(
    JSON.stringify({
      fetchedAt: new Date().toISOString(),
      groups: [
        {
          id: 'grq',
          label: 'VinaX GRQ ALL',
          hint: 'Instant answers · music knowledge',
          configured: Boolean(env.VINAX_GROQ_API_KEY),
          models: grq,
        },
        {
          id: 'opr',
          label: 'VinaX OPR ALL',
          hint: 'Free model marketplace',
          configured: Boolean(env.VINAX_OPENROUTER_API_KEY),
          models: opr,
        },
      ],
    }),
    {
      headers: {
        'content-type': 'application/json',
        // Short shared cache: the menu changes rarely, and a stale-while-
        // revalidate window keeps the picker instant.
        'cache-control': 'public, max-age=300, stale-while-revalidate=900',
      },
    },
  );
};

/** GET-only: anything else must 405 instead of falling through to the SPA. */
export const onRequestPost = async (): Promise<Response> => methodNotAllowed('GET, OPTIONS');
