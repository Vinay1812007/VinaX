/** Admin: send a push notification to every subscribed device. */
import { isAdmin, unauthorized, type AdminEnv } from '../../_lib/admin';
import { sbInsert, sbSelect, sbUpdate, type SupabaseEnv } from '../../_lib/supabase';
import { pushConfigured, sendPush, type PushSubscriptionRecord, type VapidEnv } from '../../_lib/webpush';
import { fcmConfigured, sendFcm, type FcmEnv } from '../../_lib/fcm';

type Env = AdminEnv & SupabaseEnv & VapidEnv & FcmEnv;

/** Concurrency-bounded parallel map. Duplicated verbatim from cron/song-push
 *  to avoid an inter-directory helper import that Pages Functions rejects. */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<Array<PromiseSettledResult<R>>> {
  const results: Array<PromiseSettledResult<R>> = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      try {
        results[i] = { status: 'fulfilled', value: await fn(items[i], i) };
      } catch (err) {
        results[i] = { status: 'rejected', reason: err };
      }
    }
  });
  await Promise.all(workers);
  return results;
}

interface SubRow {
  endpoint: string;
  p256dh: string;
  auth: string;
}

function json(o: unknown, status = 200): Response {
  return new Response(JSON.stringify(o), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

/** Status for the admin tab: is push configured + how many devices opted in. */
export const onRequestGet = async (context: { request: Request; env: Env }): Promise<Response> => {
  const { request, env } = context;
  if (!isAdmin(request, env)) return unauthorized();
  const subs = await sbSelect<{ endpoint: string }>(
    env,
    'vinax_push_subscriptions',
    'select=endpoint&active=eq.true&limit=5000',
  ).catch(() => []);
  return json({ configured: pushConfigured(env), subscribers: subs.length });
};

export const onRequestPost = async (context: { request: Request; env: Env }): Promise<Response> => {
  const { request, env } = context;
  if (!isAdmin(request, env)) return unauthorized();
  if (!pushConfigured(env) && !fcmConfigured(env)) return json({ error: 'push_not_configured' }, 400);
  const body = (await request.json().catch(() => null)) as
    | { title?: string; body?: string; link?: string; dedupe_key?: string }
    | null;
  const title = (body?.title ?? '').toString().slice(0, 120) || 'VinaX';
  const text = (body?.body ?? '').toString().slice(0, 300);
  const url = (body?.link ?? '/').toString().slice(0, 300) || '/';
  const dedupeKey = typeof body?.dedupe_key === 'string' ? body.dedupe_key.slice(0, 80) : '';

  // Audit finding M-SRV-8: an admin who double-clicks Send used to blast every
  // subscriber twice. If the caller passes dedupe_key, we check for a matching
  // announcement in the last 10 minutes and refuse the duplicate. The key
  // rides inside the JSON message body — no schema migration needed.
  if (dedupeKey) {
    const since = new Date(Date.now() - 10 * 60_000).toISOString();
    const recent = await sbSelect<{ message: string | null }>(
      env,
      'vinax_events',
      `type=eq.announcement&created_at=gte.${encodeURIComponent(since)}&select=message&limit=50&order=created_at.desc`,
    ).catch(() => []);
    const needle = `"dedupe_key":${JSON.stringify(dedupeKey)}`;
    if (recent.some((r) => (r.message ?? '').includes(needle))) {
      return json({ error: 'duplicate', message: 'This announcement was already sent recently' }, 409);
    }
  }

  // The Android app has no Web Push — it picks the latest announcement up on next open.
  await sbInsert(env, 'vinax_events', {
    device_id: 'admin',
    type: 'announcement',
    message: JSON.stringify({
      title,
      body: text,
      link: url,
      ts: Date.now(),
      ...(dedupeKey ? { dedupe_key: dedupeKey } : {}),
    }).slice(0, 900),
  }).catch(() => false);
  const subs = await sbSelect<SubRow>(
    env,
    'vinax_push_subscriptions',
    'select=endpoint,p256dh,auth&active=eq.true&limit=5000',
  );
  // Fan out in parallel with a bounded concurrency. The previous sequential
  // await-loop over 5000 subscribers (~150 ms each) blew past the Pages
  // Functions 30 s wall clock and returned a partial count with no retry
  // semantics (audit finding H14). Bounded at 32 concurrent to stay well
  // inside per-isolate limits while cutting wall-clock ~30x.
  const results = await mapWithConcurrency(subs, 32, async (s) => {
    const r = await sendPush(env, s as PushSubscriptionRecord, {
      title, body: text, url, icon: '/icons/icon-192.png',
    });
    if (r.gone) {
      await sbUpdate(env, 'vinax_push_subscriptions', `endpoint=eq.${encodeURIComponent(s.endpoint)}`, {
        active: false,
      }).catch(() => false);
    }
    return r;
  });
  let sent = 0;
  let gone = 0;
  for (const r of results) {
    if (r.status !== 'fulfilled') continue;
    if (r.value.ok) sent += 1;
    if (r.value.gone) gone += 1;
  }
  // Also fan out to native Android via FCM — background push, even when closed.
  let fcm = 0;
  if (fcmConfigured(env)) {
    const toks = await sbSelect<{ token: string }>(
      env,
      'vinax_fcm_tokens',
      'select=token&active=eq.true&limit=5000',
    ).catch(() => []);
    if (toks.length) {
      const r = await sendFcm(env, toks.map((t) => t.token), { title, body: text, link: url });
      fcm = r.sent;
      // Parallel dead-token cleanup — the old sequential loop compounded the
      // same wall-clock problem the web-push loop had (audit finding H14).
      await mapWithConcurrency(r.dead, 16, (dead) =>
        sbUpdate(env, 'vinax_fcm_tokens', `token=eq.${encodeURIComponent(dead)}`, { active: false }).catch(() => false),
      );
    }
  }
  return json({ ok: true, total: subs.length, sent, gone, fcm }, 200);
};
