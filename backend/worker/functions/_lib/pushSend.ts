/**
 * Push fan-out shared by the owner's sender (api/admin/push.ts) and the jobs:
 * pick the audience from `push_devices`, send on both channels with bounded
 * concurrency, switch off dead devices, write the delivery receipt onto the
 * `notifications` row, and publish the `announcement` setting when the push
 * went to everyone (the Android app reads it on open).
 */
import { db, q, type DbEnv, type Rows } from './db';
import { fcmConfigured, sendFcm, type FcmEnv } from './fcm';
import { pushConfigured, sendPush, type VapidEnv } from './webpush';
import { writeSetting } from './settings';

export type PushEnv = DbEnv & VapidEnv & FcmEnv;

export interface PushFilter {
  country?: string;
  region?: string;
  city?: string;
  lang?: string;
  channel?: 'web' | 'fcm';
}
export type PushActivity = 'active7' | 'quiet' | 'dormant14' | null;

export interface PushMessage {
  title: string;
  body: string;
  link: string;
}

export interface Audience {
  filter: PushFilter;
  activity: PushActivity;
  /** Human label for the log ("Hyderabad / telugu", "everyone"). */
  label: string;
  /** True when no filter narrows the audience. */
  everyone: boolean;
}

export interface DeviceRow {
  id: number;
  channel: 'web' | 'fcm';
  target: string;
  p256dh: string | null;
  auth: string | null;
}

const DAY = 86_400_000;

/** Normalise a raw filter / activity pair from a request body. */
export function audienceOf(rawFilter: unknown, rawActivity: unknown): Audience {
  const f = rawFilter && typeof rawFilter === 'object' && !Array.isArray(rawFilter) ? (rawFilter as Record<string, unknown>) : {};
  const str = (v: unknown, n: number): string | undefined => (typeof v === 'string' && v.trim() ? v.trim().slice(0, n) : undefined);
  const filter: PushFilter = {};
  const country = str(f.country, 2)?.toUpperCase();
  if (country && /^[A-Z]{2}$/.test(country)) filter.country = country;
  const region = str(f.region, 80);
  if (region) filter.region = region;
  const city = str(f.city, 80);
  if (city) filter.city = city;
  const lang = str(f.lang, 16)?.toLowerCase();
  if (lang) filter.lang = lang;
  if (f.channel === 'web' || f.channel === 'fcm') filter.channel = f.channel;
  const activity: PushActivity = rawActivity === 'active7' || rawActivity === 'quiet' || rawActivity === 'dormant14' ? rawActivity : null;
  const parts = [filter.country, filter.region, filter.city, filter.lang, filter.channel, activity ?? ''].filter(Boolean) as string[];
  return { filter, activity, label: parts.join(' / ') || 'everyone', everyone: parts.length === 0 };
}

/** The PostgREST query for an audience (active devices only). */
export function audienceQuery(a: Audience, now = Date.now()) {
  const query = q().eq('active', 'true');
  if (a.filter.country) query.eq('country', a.filter.country);
  if (a.filter.region) query.eq('region', a.filter.region);
  if (a.filter.city) query.eq('city', a.filter.city);
  if (a.filter.lang) query.ilike('lang', `${a.filter.lang}*`);
  if (a.filter.channel) query.eq('channel', a.filter.channel);
  const d7 = new Date(now - 7 * DAY).toISOString();
  const d14 = new Date(now - 14 * DAY).toISOString();
  if (a.activity === 'active7') query.gte('updated_at', d7);
  else if (a.activity === 'quiet') query.lt('updated_at', d7).gte('updated_at', d14);
  else if (a.activity === 'dormant14') query.lt('updated_at', d14);
  return query;
}

/** Every device the audience reaches (up to 5000). */
export async function audienceDevices(env: DbEnv, a: Audience): Promise<Rows<DeviceRow>> {
  return db.select<DeviceRow>(env, 'push_devices', audienceQuery(a).select('id,channel,target,p256dh,auth').limit(5000));
}

async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<Array<PromiseSettledResult<R>>> {
  const results: Array<PromiseSettledResult<R>> = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = cursor++;
      if (i >= items.length) return;
      try {
        results[i] = { status: 'fulfilled', value: await fn(items[i]) };
      } catch (err) {
        results[i] = { status: 'rejected', reason: err };
      }
    }
  });
  await Promise.all(workers);
  return results;
}

export interface SendReport {
  web: { total: number; sent: number; gone: number; failed: Record<string, number> };
  fcm: { total: number; sent: number; failed: Record<string, number>; error: string | null };
}

/**
 * Send `msg` to `devices`. Dead devices are switched off. Never throws.
 * FCM goes first: every browser push is its own outgoing request and a large
 * web audience could otherwise spend the request budget before Android.
 */
export async function fanOut(env: PushEnv, devices: DeviceRow[], msg: PushMessage): Promise<SendReport> {
  const web = devices.filter((d) => d.channel === 'web' && d.p256dh && d.auth);
  const fcm = devices.filter((d) => d.channel === 'fcm');
  const report: SendReport = {
    web: { total: web.length, sent: 0, gone: 0, failed: {} },
    fcm: { total: fcm.length, sent: 0, failed: {}, error: fcmConfigured(env) ? null : 'not_configured' },
  };

  if (fcm.length && fcmConfigured(env)) {
    const r = await sendFcm(env, fcm.map((d) => d.target), { title: msg.title, body: msg.body, link: msg.link });
    report.fcm.sent = r.sent;
    report.fcm.failed = r.failed;
    report.fcm.error = r.error;
    if (r.dead.length) await db.update(env, 'push_devices', q().in('target', r.dead), { active: false });
  }

  if (web.length && pushConfigured(env)) {
    const results = await mapWithConcurrency(web, 32, (d) => sendPush(env, { endpoint: d.target, p256dh: d.p256dh!, auth: d.auth! }, { title: msg.title, body: msg.body, url: msg.link, icon: '/icons/icon-192.png' }));
    const gone: string[] = [];
    results.forEach((r, i) => {
      if (r.status !== 'fulfilled') {
        report.web.failed.error = (report.web.failed.error ?? 0) + 1;
        return;
      }
      if (r.value.ok) report.web.sent += 1;
      else if (r.value.gone) {
        report.web.gone += 1;
        gone.push(web[i].target);
      } else report.web.failed[String(r.value.status)] = (report.web.failed[String(r.value.status)] ?? 0) + 1;
    });
    if (gone.length) await db.update(env, 'push_devices', q().in('target', gone), { active: false });
  } else if (web.length) {
    report.web.failed.not_configured = web.length;
  }

  if (devices.length) {
    const now = new Date().toISOString();
    const targets = devices.map((d) => d.target);
    for (let i = 0; i < targets.length; i += 200) await db.update(env, 'push_devices', q().in('target', targets.slice(i, i + 200)), { last_pushed_at: now });
  }
  return report;
}

/** Write the receipt onto the notification row. */
export async function recordReceipt(env: DbEnv, notificationId: number, report: SendReport): Promise<void> {
  const failures: Record<string, unknown> = {};
  if (Object.keys(report.web.failed).length) failures.web = report.web.failed;
  if (Object.keys(report.fcm.failed).length) failures.fcm = report.fcm.failed;
  if (report.fcm.error) failures.fcmError = report.fcm.error;
  await db.update(env, 'notifications', q().eq('id', notificationId), {
    web_total: report.web.total,
    web_sent: report.web.sent,
    web_gone: report.web.gone,
    fcm_total: report.fcm.total,
    fcm_sent: report.fcm.sent,
    failures: Object.keys(failures).length ? failures : null,
  });
}

/** The Android in-app pickup: only an everyone-push becomes the announcement. */
export async function publishAnnouncement(env: DbEnv, msg: PushMessage, ts: number): Promise<void> {
  await writeSetting(env, 'announcement', { title: msg.title, body: msg.body, link: msg.link, ts }, 'push');
}
