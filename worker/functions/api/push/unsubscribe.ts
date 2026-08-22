/** Mark a browser push subscription inactive. */
import { sbUpdate, type SupabaseEnv } from '../../_lib/supabase';
import { rateLimit } from '../../_lib/ratelimit';

interface UnsubscribeEnv extends SupabaseEnv {
  TELEMETRY_PEPPER?: string;
}

export const onRequestPost = async (context: { request: Request; env: UnsubscribeEnv }): Promise<Response> => {
  const { request, env } = context;
  // Audit finding H-SRV-3: this endpoint was previously unrated and
  // unauthenticated — anyone who knew a listener's endpoint URL (which leaks
  // in the browser subscribe response) could silently disable their push.
  const limited = rateLimit(request, 'push-unsubscribe', { capacity: 10, refillPerMinute: 10 }, env);
  if (limited) return limited;

  const body = (await request.json().catch(() => null)) as { endpoint?: string } | null;
  if (!body?.endpoint) {
    return new Response(JSON.stringify({ error: 'bad_request' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }

  // TODO(security H-SRV-3): the ideal fix is a signed unsubscribe token
  // returned from /api/push/subscribe and required here. That's a coordinated
  // client change; until it lands, require a same-origin request so a random
  // third-party site can't drive by /api/push/unsubscribe with a stolen
  // endpoint. same-origin browsers always attach an Origin header on POST.
  const origin = request.headers.get('origin');
  const selfOrigin = new URL(request.url).origin;
  if (!origin || origin !== selfOrigin) {
    return new Response(JSON.stringify({ error: 'forbidden', message: 'same-origin required' }), {
      status: 403,
      headers: { 'content-type': 'application/json' },
    });
  }

  const ok = await sbUpdate(env, 'vinax_push_subscriptions', `endpoint=eq.${encodeURIComponent(body.endpoint)}`, {
    active: false,
  });
  return new Response(JSON.stringify({ ok }), {
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
};
