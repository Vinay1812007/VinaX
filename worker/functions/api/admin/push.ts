/** Admin: send a push notification to every subscribed device. */
import { isAdmin, unauthorized, type AdminEnv } from '../../_lib/admin';
import { logAdminAudit } from '../../_lib/adminAudit';
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

interface GeoRow {
  country: string | null;
  region: string | null;
  city: string | null;
}

/** Bucket a list of (country, region, city) rows into three ranked
 *  breakdowns for the admin UI's target picker. Null / empty entries roll
 *  up under 'Unknown' so the counts still add up. */
function bucketGeo(rows: GeoRow[]): {
  countries: Array<{ key: string; count: number }>;
  regions: Array<{ key: string; count: number; country: string | null }>;
  cities: Array<{ key: string; count: number; region: string | null; country: string | null }>;
} {
  const cMap = new Map<string, number>();
  const rMap = new Map<string, { count: number; country: string | null }>();
  const ciMap = new Map<string, { count: number; region: string | null; country: string | null }>();
  for (const row of rows) {
    const c = row.country ?? 'Unknown';
    cMap.set(c, (cMap.get(c) ?? 0) + 1);
    const rk = `${c}|${row.region ?? 'Unknown'}`;
    const rv = rMap.get(rk) ?? { count: 0, country: row.country };
    rv.count += 1;
    rMap.set(rk, rv);
    const cik = `${c}|${row.region ?? '-'}|${row.city ?? 'Unknown'}`;
    const civ = ciMap.get(cik) ?? { count: 0, region: row.region, country: row.country };
    civ.count += 1;
    ciMap.set(cik, civ);
  }
  return {
    countries: [...cMap.entries()].map(([k, v]) => ({ key: k, count: v })).sort((a, b) => b.count - a.count).slice(0, 40),
    regions: [...rMap.entries()].map(([k, v]) => ({ key: k.split('|').slice(1).join('|'), count: v.count, country: v.country })).sort((a, b) => b.count - a.count).slice(0, 80),
    cities: [...ciMap.entries()].map(([k, v]) => ({ key: k.split('|').slice(2).join('|'), count: v.count, region: v.region, country: v.country })).sort((a, b) => b.count - a.count).slice(0, 120),
  };
}

/** Status for the admin tab: is push configured + how many devices opted in
 *  + a geo breakdown so the composer can populate its "Send to city X"
 *  dropdown with real, live subscriber counts. */
export const onRequestGet = async (context: { request: Request; env: Env }): Promise<Response> => {
  const { request, env } = context;
  if (!isAdmin(request, env)) return unauthorized();
  const [webSubs, fcmToks] = await Promise.all([
    sbSelect<GeoRow>(
      env,
      'vinax_push_subscriptions',
      'select=country,region,city&active=eq.true&limit=5000',
    ).catch(() => [] as GeoRow[]),
    sbSelect<GeoRow>(
      env,
      'vinax_fcm_tokens',
      'select=country,region,city&active=eq.true&limit=5000',
    ).catch(() => [] as GeoRow[]),
  ]);
  const geo = bucketGeo([...webSubs, ...fcmToks]);
  return json({
    configured: pushConfigured(env),
    subscribers: webSubs.length,
    fcm: fcmToks.length,
    geo,
  });
};

export const onRequestPost = async (context: { request: Request; env: Env }): Promise<Response> => {
  const { request, env } = context;
  if (!isAdmin(request, env)) return unauthorized();
  if (!pushConfigured(env) && !fcmConfigured(env)) return json({ error: 'push_not_configured' }, 400);
  const body = (await request.json().catch(() => null)) as
    | { title?: string; body?: string; link?: string; dedupe_key?: string; filter?: { country?: string; region?: string; city?: string; lang?: string; langPrefix?: string } }
    | null;
  const title = (body?.title ?? '').toString().slice(0, 120) || 'VinaX';
  const text = (body?.body ?? '').toString().trim().slice(0, 300);
  // A blank notification to every subscriber is never intentional (D-20).
  if (!text) return json({ error: 'body_required' }, 400);
  const url = (body?.link ?? '/').toString().slice(0, 300) || '/';
  // Links must stay inside the product — an admin typo (or a compromised
  // token) must not be able to push arbitrary external URLs to every device.
  if (!(url.startsWith('/') || url.startsWith('https://www.sirimillavinay.online'))) {
    return json({ error: 'bad_link' }, 400);
  }
  const dedupeKey = typeof body?.dedupe_key === 'string' ? body.dedupe_key.slice(0, 80) : '';
  // Optional filter: {country, region, city, lang, langPrefix} — any provided
  // key becomes an equality (or LIKE for langPrefix) filter on the subs
  // table. Empty/absent = send to all. `lang` matches exact ("hi") while
  // `langPrefix` matches ILIKE prefix ("hi" → hi, hi-IN, hi-Latn, etc.).
  const filter = (body?.filter && typeof body.filter === 'object' ? body.filter : {}) as { country?: string; region?: string; city?: string; lang?: string; langPrefix?: string };
  const filterCountry = typeof filter.country === 'string' && filter.country ? filter.country.slice(0, 40) : '';
  const filterRegion = typeof filter.region === 'string' && filter.region ? filter.region.slice(0, 80) : '';
  const filterCity = typeof filter.city === 'string' && filter.city ? filter.city.slice(0, 80) : '';
  const filterLang = typeof filter.lang === 'string' && filter.lang ? filter.lang.slice(0, 16) : '';
  const filterLangPrefix = typeof filter.langPrefix === 'string' && filter.langPrefix ? filter.langPrefix.slice(0, 16) : '';
  // E10 — activity segment on updated_at (refreshed each time a device
  // re-subscribes on app open, so it tracks "last check-in", honestly labeled
  // as such in the composer): active7 / quiet (7-14d) / dormant14.
  const activity = typeof (body as { activity?: unknown } | null)?.activity === 'string' ? (body as { activity: string }).activity : '';
  // E10 — dryRun: count the matched audience, send nothing.
  const dryRun = (body as { dryRun?: unknown } | null)?.dryRun === true;
  const geoQuery: string[] = [];
  if (filterCountry) geoQuery.push(`country=eq.${encodeURIComponent(filterCountry)}`);
  if (filterRegion) geoQuery.push(`region=eq.${encodeURIComponent(filterRegion)}`);
  if (filterCity) geoQuery.push(`city=eq.${encodeURIComponent(filterCity)}`);
  if (filterLang) geoQuery.push(`lang=eq.${encodeURIComponent(filterLang)}`);
  else if (filterLangPrefix) geoQuery.push(`lang=ilike.${encodeURIComponent(filterLangPrefix + '%')}`);
  const d7 = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const d14 = new Date(Date.now() - 14 * 86_400_000).toISOString();
  if (activity === 'active7') geoQuery.push(`updated_at=gte.${encodeURIComponent(d7)}`);
  else if (activity === 'quiet') geoQuery.push(`updated_at=lt.${encodeURIComponent(d7)}`, `updated_at=gte.${encodeURIComponent(d14)}`);
  else if (activity === 'dormant14') geoQuery.push(`updated_at=lt.${encodeURIComponent(d14)}`);
  const geoSuffix = geoQuery.length ? '&' + geoQuery.join('&') : '';
  const geoTagForLog =
    [filterCountry, filterRegion, filterCity, filterLang || filterLangPrefix, activity || ''].filter(Boolean).join(' / ') || 'everyone';

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

  const subs = await sbSelect<SubRow>(
    env,
    'vinax_push_subscriptions',
    `select=endpoint,p256dh,auth&active=eq.true&limit=5000${geoSuffix}`,
  );

  // E10 — preview: report exactly who WOULD receive this, send nothing.
  // MUST run before ANY persistence: the announcement insert used to sit
  // above this return, so "preview" published a live announcement to every
  // Android client and burned the dedupe key (audit D-3).
  if (dryRun) {
    const toks = fcmConfigured(env)
      ? await sbSelect<{ token: string }>(env, 'vinax_fcm_tokens', `select=token&active=eq.true&limit=5000${geoSuffix}`).catch(() => [])
      : [];
    return json({ dryRun: true, web: subs.length, fcm: toks.length, audience: geoTagForLog });
  }

  // The Android app has no Web Push — it picks the latest announcement up on
  // next open. A geo-filtered send is deliberately NOT persisted to the
  // Android in-app pickup channel (that would show Warangal-targeted news to
  // a Delhi listener). Only unfiltered "send to everyone" pushes get the
  // vinax_events row.
  if (!geoQuery.length) {
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
  }
  // Every REAL send leaves an audit row — geo-filtered sends previously left
  // zero record anywhere (audit D-7).
  await logAdminAudit(env, 'push-send', `"${title.slice(0, 60)}" to ${geoTagForLog}`);
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
      `select=token&active=eq.true&limit=5000${geoSuffix}`,
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
  return json({ ok: true, total: subs.length, sent, gone, fcm, target: geoTagForLog }, 200);
};
