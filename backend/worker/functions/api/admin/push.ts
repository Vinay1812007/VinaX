/**
 * GET  /api/admin/push → { configured, web, fcm, people, geo, langs, rules, quiet }
 *        What can be sent: each channel (set up? how many signed-in phones and
 *        browsers), how many people that is, the places and languages they are
 *        in, and the Notification Rules in force.
 * POST /api/admin/push
 *        { title, body, link, image?, filter?, activity?, users?, dedupeKey?,
 *          dryRun?, test?, draft?, draftId?, when?: 'now' | 'schedule', scheduledFor?, ignoreQuiet? }
 *
 *   dryRun   → { dryRun, people, devices, web, fcm, skippedRecent, audience, quiet }  (sends nothing)
 *   test     → sends only to the signed-in admin's own devices (no history row)
 *   draft    → saves (or updates draftId) a draft: { ok, id, status: 'draft' }
 *   schedule → saves a scheduled send (the cron job sends it): { ok, id, status: 'scheduled', scheduledFor }
 *   now      → writes the row first (the dedupe key makes a double-click a 409),
 *              fans out, writes the receipt and — for everyone — publishes the
 *              announcement the Android app reads on open.
 *
 * Console rebuild: only people signed in with Google are reached; Notification
 * Rules apply (frequency cap, quiet hours in India time — "now" during quiet
 * hours answers 409 quiet_hours unless ignoreQuiet, and announcements may be
 * switched off).
 */
import { adminJson, badRequest, dbFailure } from '../../_lib/admin';
import { adminGet, adminPost } from '../../_lib/adminRoute';
import { db, q, firstFailure } from '../../_lib/db';
import { clip } from '../../_lib/edge';
import { fcmConfigured, type FcmEnv } from '../../_lib/fcm';
import {
  audienceDevices, audienceOf, devicesOfEmail, fanOut, kindAllowed, peopleIn, publishAnnouncement, pushRules, quietNow,
  recordReceipt, underCap, type Audience, type PushEnv,
} from '../../_lib/pushSend';
import { pushConfigured, type VapidEnv } from '../../_lib/webpush';

const SITE_ORIGIN = 'https://www.vinaxmusic.online';
const MAX_AHEAD_MS = 60 * 86_400_000;

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

/** A picture URL: https, no credentials, sane length. */
export function cleanImage(v: unknown): string | null {
  const s = clip(v, 500);
  if (!s) return null;
  try {
    const u = new URL(s);
    return u.protocol === 'https:' && !u.username && !u.password ? u.toString() : null;
  } catch {
    return null;
  }
}

interface GeoRow { country: string | null; region: string | null; city: string | null; lang: string | null; account_id: string | null; channel: string }

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
  const [all, signed, rules] = await Promise.all([
    db.select<{ channel: string }>(env, 'push_devices', q().eq('active', 'true').select('channel').limit(20_000)),
    db.select<GeoRow>(env, 'push_devices', q().eq('active', 'true').not('account_id', 'is', 'null').select('country,region,city,lang,account_id,channel').limit(5000)),
    pushRules(env),
  ]);
  const failed = firstFailure(all, signed);
  if (failed) return dbFailure(failed);
  if (!all.ok || !signed.ok) return adminJson({ configured: true, error: 'db_unavailable' }, 502);
  const count = (rows: Array<{ channel: string }>, ch: string) => rows.filter((r) => r.channel === ch).length;
  return adminJson({
    configured: true,
    web: { configured: pushConfigured(e as VapidEnv), active: count(signed.rows, 'web'), allDevices: count(all.rows, 'web') },
    fcm: { configured: fcmConfigured(e as FcmEnv), active: count(signed.rows, 'fcm'), allDevices: count(all.rows, 'fcm') },
    people: new Set(signed.rows.map((r) => r.account_id)).size,
    ...bucket(signed.rows),
    rules,
    quiet: quietNow(rules),
  });
});

/** Where the draft / scheduled row keeps everything needed to send it later. */
const audienceJson = (a: Audience, ts: number) => ({ ...a.filter, ...(a.activity ? { activity: a.activity } : {}), label: a.label, everyone: a.everyone, ts });

export const onRequestPost = adminPost(async ({ env, body, audit, me }) => {
  const e = env as unknown as PushEnv;
  const title = clip(body.title, 120) ?? 'VinaX';
  const text = clip(body.body, 300);
  if (!text) return badRequest('body_required');
  const link = clip(body.link, 300) ?? '/';
  if (!isInternalLink(link)) return badRequest('bad_link');
  const image = cleanImage(body.image);
  const audience = audienceOf(body.filter, body.activity, body.users);
  const rules = await pushRules(env);
  const now = Date.now();
  const draftId = Number.isInteger(body.draftId) && (body.draftId as number) > 0 ? (body.draftId as number) : null;

  // Send test to me: the admin's own phone and browser only, no history row.
  if (body.test === true) {
    if (me.via !== 'google') return adminJson({ error: 'no_own_account', message: 'Sign in with Google to send a test to your own phone.' }, 400);
    const own = await devicesOfEmail(env, me.email);
    if (!own.ok) return dbFailure(own);
    if (!own.rows.length) return adminJson({ error: 'no_own_devices', message: 'Your account has no phone or browser set up for notifications yet. Turn notifications on in the VinaX app while signed in with this Google account.' }, 400);
    if (!pushConfigured(e as VapidEnv) && !fcmConfigured(e as FcmEnv)) return adminJson({ error: 'push_not_configured' }, 400);
    const report = await fanOut(e, own.rows, { title, body: text, link, image });
    return adminJson({ ok: true, test: true, devices: own.rows.length, web: report.web, fcm: report.fcm });
  }

  // Drafts: saved, never sent.
  if (body.draft === true) {
    const row = { kind: 'announcement', title, body: text, link, image, audience: audienceJson(audience, now), status: 'draft', created_by: me.email, sent_by: me.email };
    const w = draftId
      ? await db.update<{ id: number }>(env, 'notifications', q().eq('id', draftId).eq('status', 'draft'), row, { returning: true })
      : await db.insert<{ id: number }>(env, 'notifications', row, { returning: true });
    if (!w.ok) return dbFailure(w);
    if (!w.rows.length) return adminJson({ error: 'not_found' }, 404);
    await audit({ action: 'push-draft', summary: `saved draft "${title.slice(0, 60)}"`, target: String(w.rows[0].id) });
    return adminJson({ ok: true, id: w.rows[0].id, status: 'draft' });
  }

  if (!kindAllowed(rules, 'announcements')) return adminJson({ error: 'kind_off', message: 'Announcements are switched off in App Settings → Notification Rules.' }, 409);

  const devices = await audienceDevices(env, audience, now);
  if (!devices.ok) return dbFailure(devices);
  const capped = underCap(devices.rows, rules, now);
  const web = capped.allowed.filter((d) => d.channel === 'web').length;
  const fcm = capped.allowed.length - web;
  const quiet = quietNow(rules, now);
  if (body.dryRun === true) {
    return adminJson({ dryRun: true, people: peopleIn(capped.allowed), devices: capped.allowed.length, web, fcm, skippedRecent: capped.skipped, audience: audience.label, quiet });
  }

  // Scheduled: the row waits; _lib/scheduledPush.ts sends it when its time comes.
  if (body.when === 'schedule') {
    const at = typeof body.scheduledFor === 'string' ? Date.parse(body.scheduledFor) : NaN;
    if (!Number.isFinite(at) || at < now + 60_000) return badRequest('schedule_in_past', { message: 'Pick a time at least a minute from now.' });
    if (at > now + MAX_AHEAD_MS) return badRequest('schedule_too_far', { message: 'Pick a time within the next 60 days.' });
    const row = {
      kind: 'announcement', title, body: text, link, image, audience: audienceJson(audience, now), status: 'scheduled',
      scheduled_for: new Date(at).toISOString(), web_total: web, fcm_total: fcm, created_by: me.email, sent_by: me.email,
    };
    const w = draftId
      ? await db.update<{ id: number }>(env, 'notifications', q().eq('id', draftId).eq('status', 'draft'), row, { returning: true })
      : await db.insert<{ id: number }>(env, 'notifications', { ...row, dedupe_key: clip(body.dedupeKey, 80) }, { returning: true });
    if (!w.ok && w.error === 'conflict') return adminJson({ error: 'duplicate', message: 'This notification was already scheduled' }, 409);
    if (!w.ok) return dbFailure(w);
    if (!w.rows.length) return adminJson({ error: 'not_found' }, 404);
    await audit({ action: 'push-schedule', summary: `scheduled "${title.slice(0, 60)}" for ${row.scheduled_for} to ${audience.label}`, target: String(w.rows[0].id) });
    return adminJson({ ok: true, id: w.rows[0].id, status: 'scheduled', scheduledFor: row.scheduled_for });
  }

  if (quiet.quiet && body.ignoreQuiet !== true) return adminJson({ error: 'quiet_hours', until: quiet.until, message: 'It is quiet hours now. Schedule it for later, or confirm to send anyway.' }, 409);
  if (!pushConfigured(e as VapidEnv) && !fcmConfigured(e as FcmEnv)) return adminJson({ error: 'push_not_configured' }, 400);

  const ts = now;
  const sentAt = new Date(now).toISOString();
  const rowFields = {
    kind: 'announcement', title, body: text, link, image, audience: audienceJson(audience, ts),
    web_total: web, fcm_total: fcm, status: 'sending', sent_by: me.email, created_by: me.email,
  };
  const made = draftId
    ? await db.update<{ id: number }>(env, 'notifications', q().eq('id', draftId).eq('status', 'draft'), { ...rowFields, at: sentAt }, { returning: true })
    : await db.insert<{ id: number }>(env, 'notifications', { ...rowFields, dedupe_key: clip(body.dedupeKey, 80) }, { returning: true });
  if (!made.ok && made.error === 'conflict') return adminJson({ error: 'duplicate', message: 'This notification was already sent' }, 409);
  if (!made.ok) return dbFailure(made);
  if (draftId && !made.rows.length) return adminJson({ error: 'not_found' }, 404);
  const id = made.rows[0]?.id ?? null;

  const msg = { title, body: text, link, image, id };
  const report = await fanOut(e, capped.allowed, msg);
  if (id !== null) await recordReceipt(env, id, report, sentAt);
  if (audience.everyone) await publishAnnouncement(env, msg, ts);
  await audit({ action: 'push-send', summary: `"${title.slice(0, 60)}" to ${audience.label}`, target: audience.label, after: { title, body: text, link, audience: audience.label, web: report.web.sent, fcm: report.fcm.sent } });
  return adminJson({
    ok: true,
    id,
    status: 'sent',
    people: peopleIn(capped.allowed),
    skippedRecent: capped.skipped,
    web: { total: report.web.total, sent: report.web.sent, gone: report.web.gone, failed: report.web.failed },
    fcm: { total: report.fcm.total, sent: report.fcm.sent, failed: report.fcm.failed, ...(report.fcm.error ? { error: report.fcm.error } : {}) },
    audience: audience.label,
  });
}, { cap: 16_000 });
