/**
 * GET  /api/admin/push → { configured, web, fcm, geo, langs, rules }
 * POST /api/admin/push { title, body, link, filter, activity, dryRun, dedupeKey }
 *
 * The owner's push sender. A dry run counts the audience and sends nothing.
 * A real send writes the `notifications` row first (the dedupe key makes a
 * double-click a 409), fans out on both channels (_lib/pushSend.ts), writes
 * the receipt, and — when it went to everyone — publishes the announcement
 * the Android app reads on open.
 */
import { adminJson, badRequest, dbFailure } from '../../_lib/admin';
import { adminGet, adminPost } from '../../_lib/adminRoute';
import { db, q, firstFailure } from '../../_lib/db';
import { clip } from '../../_lib/edge';
import { fcmConfigured, type FcmEnv } from '../../_lib/fcm';
import { audienceDevices, audienceOf, fanOut, publishAnnouncement, recordReceipt, type PushEnv } from '../../_lib/pushSend';
import { setting } from '../../_lib/settings';
import { pushConfigured, type VapidEnv } from '../../_lib/webpush';

const SITE_ORIGIN = 'https://www.vinaxmusic.online';

/** A link that stays on the product: a site path or an absolute URL on our origin. */
export function isInternalLink(link: string): boolean {
  if (!link.startsWith('/') || link.startsWith('//') || link.startsWith('/\\')) {
    if (!link.startsWith('https://')) return false;
  }
  try {
    return new URL(link, SITE_ORIGIN).origin === SITE_ORIGIN;
  } catch {
    return false;
  }
}

interface GeoRow { country: string | null; region: string | null; city: string | null; lang: string | null }

function bucket(rows: GeoRow[]) {
  const countries = new Map<string, number>();
  const regions = new Map<string, { key: string; country: string | null; count: number }>();
  const cities = new Map<string, { key: string; region: string | null; country: string | null; count: number }>();
  const langs = new Map<string, number>();
  for (const r of rows) {
    const c = r.country ?? 'Unknown';
    countries.set(c, (countries.get(c) ?? 0) + 1);
    const rk = `${c}|${r.region ?? 'Unknown'}`;
    const rv = regions.get(rk) ?? { key: r.region ?? 'Unknown', country: r.country, count: 0 };
    rv.count += 1;
    regions.set(rk, rv);
    const ck = `${rk}|${r.city ?? 'Unknown'}`;
    const cv = cities.get(ck) ?? { key: r.city ?? 'Unknown', region: r.region, country: r.country, count: 0 };
    cv.count += 1;
    cities.set(ck, cv);
    const l = (r.lang ?? '').toLowerCase().split('-')[0] || 'unknown';
    langs.set(l, (langs.get(l) ?? 0) + 1);
  }
  const desc = <T extends { count: number }>(a: T, b: T) => b.count - a.count;
  return {
    geo: {
      countries: [...countries.entries()].map(([key, count]) => ({ key, count })).sort(desc).slice(0, 40),
      regions: [...regions.values()].sort(desc).slice(0, 80),
      cities: [...cities.values()].sort(desc).slice(0, 120),
    },
    langs: [...langs.entries()].map(([lang, count]) => ({ lang, count })).sort(desc).slice(0, 30),
  };
}

export const onRequestGet = adminGet(async ({ env }) => {
  const e = env as unknown as PushEnv;
  const [web, fcm, geo, rules] = await Promise.all([
    db.count(env, 'push_devices', q().eq('channel', 'web').eq('active', 'true')),
    db.count(env, 'push_devices', q().eq('channel', 'fcm').eq('active', 'true')),
    db.select<GeoRow>(env, 'push_devices', q().eq('active', 'true').select('country,region,city,lang').limit(5000)),
    setting(env, 'push'),
  ]);
  const failed = firstFailure(web, fcm, geo);
  if (failed) return dbFailure(failed);
  if (!web.ok || !fcm.ok || !geo.ok) return adminJson({ configured: true, error: 'db_unavailable' }, 502);
  return adminJson({
    configured: true,
    web: { configured: pushConfigured(e as VapidEnv), active: web.value },
    fcm: { configured: fcmConfigured(e as FcmEnv), active: fcm.value },
    ...bucket(geo.rows),
    rules: rules ?? null,
  });
});

export const onRequestPost = adminPost(async ({ env, body, audit, waitUntil }) => {
  const e = env as unknown as PushEnv;
  const title = clip(body.title, 120) ?? 'VinaX';
  const text = clip(body.body, 300);
  if (!text) return badRequest('body_required');
  const link = clip(body.link, 300) ?? '/';
  if (!isInternalLink(link)) return badRequest('bad_link');
  const audience = audienceOf(body.filter, body.activity);
  const dryRun = body.dryRun === true;
  const dedupeKey = clip(body.dedupeKey, 80);

  const devices = await audienceDevices(env, audience);
  if (!devices.ok) return dbFailure(devices);
  const web = devices.rows.filter((d) => d.channel === 'web').length;
  const fcm = devices.rows.length - web;
  if (dryRun) return adminJson({ dryRun: true, web, fcm, audience: audience.label });
  if (!pushConfigured(e as VapidEnv) && !fcmConfigured(e as FcmEnv)) return adminJson({ error: 'push_not_configured' }, 400);

  const msg = { title, body: text, link };
  const ts = Date.now();
  const made = await db.insert<{ id: number }>(env, 'notifications', {
    kind: 'announcement', title, body: text, link, audience: { ...audience.filter, ...(audience.activity ? { activity: audience.activity } : {}), label: audience.label, ts },
    web_total: web, fcm_total: fcm, dedupe_key: dedupeKey, sent_by: 'owner',
  }, { returning: true });
  if (!made.ok && made.error === 'conflict') return adminJson({ error: 'duplicate', message: 'This notification was already sent' }, 409);
  if (!made.ok) return dbFailure(made);
  const id = made.rows[0]?.id ?? null;

  const report = await fanOut(e, devices.rows, msg);
  if (id !== null) await recordReceipt(env, id, report);
  if (audience.everyone) await publishAnnouncement(env, msg, ts);
  await audit({ action: 'push-send', summary: `"${title.slice(0, 60)}" to ${audience.label}`, target: audience.label, after: { ...msg, audience: audience.label, web: report.web.sent, fcm: report.fcm.sent } });
  void waitUntil;
  return adminJson({
    ok: true,
    id,
    web: { total: report.web.total, sent: report.web.sent, gone: report.web.gone, failed: report.web.failed },
    fcm: { total: report.fcm.total, sent: report.fcm.sent, failed: report.fcm.failed, ...(report.fcm.error ? { error: report.fcm.error } : {}) },
    audience: audience.label,
  });
}, { cap: 16_000 });
