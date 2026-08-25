/** Store a browser push subscription (upsert by endpoint). */
import { dbUpsert, type DbEnv } from '../../_lib/db';
import { rateLimit } from '../../_lib/ratelimit';
import { cleanTzOffset } from '../../_lib/notifyGate';

interface SubscribeEnv extends DbEnv {
  TELEMETRY_PEPPER?: string;
}

function json(o: unknown, status = 200): Response {
  return new Response(JSON.stringify(o), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

/**
 * Known Web Push service hosts. Anything else would let an attacker register
 * an arbitrary URL as their "endpoint" and turn later admin/cron fan-outs
 * into an authenticated SSRF beacon originating from Cloudflare's edge (audit
 * finding H10). Wildcards are matched by suffix so per-region hosts (Mozilla
 * update-*.push.services.mozilla.com, Apple api.push-*.push.apple.com,
 * Microsoft wns2-*.notify.windows.com) still work without letting an attacker
 * append a matching-suffix subdomain of their own.
 */
const ALLOWED_PUSH_HOSTS: Array<string | RegExp> = [
  'fcm.googleapis.com',
  /^updates(-\w+)?\.push\.services\.mozilla\.com$/,
  /^wns2-[a-z0-9-]+\.notify\.windows\.com$/,
  'web.push.apple.com',
  /^api\.push\.apple\.com$/,
];

function isAllowedPushEndpoint(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:') return false;
  const host = url.host.toLowerCase();
  for (const rule of ALLOWED_PUSH_HOSTS) {
    if (typeof rule === 'string' ? host === rule : rule.test(host)) return true;
  }
  return false;
}

interface CfExtras { cf?: { country?: string; region?: string; city?: string } }

export const onRequestPost = async (context: { request: Request; env: SubscribeEnv }): Promise<Response> => {
  const { request, env } = context;
  // Audit finding H-SRV-3: this endpoint was previously unrated and would
  // happily accept an arbitrary loop of endpoint registrations from one IP.
  const limited = await rateLimit(request, 'push-subscribe', { capacity: 10, refillPerMinute: 10 }, env);
  if (limited) return limited;
  const body = (await request.json().catch(() => null)) as
    | { endpoint?: string; keys?: { p256dh?: string; auth?: string }; lang?: string; tzOffset?: number }
    | null;
  const endpoint = body?.endpoint;
  const p256dh = body?.keys?.p256dh;
  const auth = body?.keys?.auth;
  if (!endpoint || !p256dh || !auth) return json({ error: 'bad_request' }, 400);
  if (!isAllowedPushEndpoint(endpoint)) return json({ error: 'endpoint_rejected' }, 400);
  // Coarse geo — read from Cloudflare edge, stored at subscribe time so
  // location-targeted admin pushes ("Hyderabad trending") have a subscriber
  // filter to hit. IP itself never enters the DB (privacy promise intact).
  const cf = (request as Request & CfExtras).cf ?? {};
  const country = request.headers.get('CF-IPCountry') ?? cf.country ?? null;
  const ok = await dbUpsert(
    env,
    'vinax_push_subscriptions',
    {
      endpoint,
      p256dh,
      auth,
      lang: typeof body?.lang === 'string' ? body.lang.slice(0, 8) : null,
      country: country && country !== 'XX' && country !== 'T1' ? country : null,
      region: cf.region ?? null,
      city: cf.city ?? null,
      // Device UTC offset (minutes east) for the quiet-hours gate — coarse and
      // non-identifying (not the IP, not a precise location).
      tz_offset: cleanTzOffset(body?.tzOffset),
      active: true,
      updated_at: new Date().toISOString(),
    },
    'endpoint',
  );
  return json({ ok }, ok ? 200 : 500);
};
