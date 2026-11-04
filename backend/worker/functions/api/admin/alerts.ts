/**
 * Smart Alerts (_lib/alerts.ts) for the console page.
 *
 * GET  /api/admin/alerts → {
 *        configured, rules (cleaned), saved, updatedAt,
 *        recipients: [{ email, name, role, gets, phones }]   every admin; gets = the rules' `who` includes them,
 *                                                            phones = linked devices (null when unreadable)
 *        me: { email, via, phones },
 *        push: { web, fcm }                                  which push channels the server can send on
 *        recent: [{ id, at, rule, title, body, devices, sent, failed }]   the last 30 alerts
 *        job: { enabled, every, lastAt, finishedAt, ok, summary, nextAt },
 *        signals: { errorsLastHour, errorsHourBefore, playsLastHour, newFeedback, probes: { website, api, catalog } },
 *      }
 * POST /api/admin/alerts
 *        { action: 'test' }  (editor)  a test alert to the signed-in admin's own phones only (no history row);
 *                                       the recovery-password principal ("owner") has no phone: 400 no_own_account
 *        { action: 'check' } (owner)   run the check now → { ok, result } (cooldown, quiet hours and the dedupe key apply)
 *
 * The rules themselves are saved through POST /api/admin/settings { key: 'alert-rules' } (owner only), which
 * keeps settings_history and the change log.
 */
import { adminJson, badRequest, dbFailure } from '../../_lib/admin';
import { adminGet, adminPost } from '../../_lib/adminRoute';
import { alertRulesOf, listAdmins, recipientDevices, ruleOfKey, runAlerts, whoIncludes, WATCHED } from '../../_lib/alerts';
import { db, firstFailure, q, since } from '../../_lib/db';
import { fcmConfigured, type FcmEnv } from '../../_lib/fcm';
import { jobSettings } from '../../_lib/jobs';
import { devicesOfEmail, fanOut, type PushEnv } from '../../_lib/pushSend';
import { readSettings, resetSettingsMemo } from '../../_lib/settings';
import { pushConfigured, type VapidEnv } from '../../_lib/webpush';
import { probeAll } from '../status';

interface AlertRow { id: number; at: string; title: string; body: string; dedupe_key: string | null; web_total: number; web_sent: number; fcm_total: number; fcm_sent: number }
interface RunRow { started_at: string; finished_at: string | null; ok: boolean | null; summary: unknown }

const HOUR = 3_600_000;

export const onRequestGet = adminGet(async ({ env, me }) => {
  resetSettingsMemo();
  const settings = await readSettings(env);
  if (!settings.ok) return dbFailure(settings);
  const row = settings.rows.find((r) => r.key === 'alert-rules') ?? null;
  const rules = alertRulesOf(row?.value ?? null);
  const jobs = jobSettings(settings.rows.find((r) => r.key === 'jobs')?.value ?? null);
  const now = Date.now();

  const [admins, recent, lastRun, errorsLastHour, errorsHourBefore, playsLastHour, newFeedback] = await Promise.all([
    listAdmins(env),
    db.select<AlertRow>(env, 'notifications', q().eq('kind', 'system').ilike('dedupe_key', 'alert:*').select('id,at,title,body,dedupe_key,web_total,web_sent,fcm_total,fcm_sent').order('at', 'desc').limit(30)),
    db.select<RunRow>(env, 'job_runs', q().eq('job', 'alerts').select('started_at,finished_at,ok,summary').order('started_at', 'desc').limit(1)),
    db.count(env, 'events', q().eq('kind', 'error').gte('at', since(HOUR, now))),
    db.count(env, 'events', q().eq('kind', 'error').gte('at', since(2 * HOUR, now)).lt('at', since(HOUR, now))),
    db.count(env, 'events', q().eq('kind', 'play').gte('at', since(HOUR, now))),
    db.count(env, 'feedback', q().eq('status', 'new')),
  ]);
  const failed = firstFailure(admins, recent, lastRun, errorsLastHour, errorsHourBefore, playsLastHour, newFeedback);
  if (failed) return dbFailure(failed);
  if (!admins.ok || !recent.ok || !lastRun.ok || !errorsLastHour.ok || !errorsHourBefore.ok || !playsLastHour.ok || !newFeedback.ok) return adminJson({ configured: true, error: 'db_unavailable' }, 502);

  const linkedMe = me.via === 'google' && !admins.rows.some((a) => a.email === me.email);
  const [phones, mine, probes] = await Promise.all([
    recipientDevices(env, admins.rows),
    // An admin who signed in with Google but is not on the list (cannot happen today) still sees their own phones.
    linkedMe ? devicesOfEmail(env, me.email) : Promise.resolve(null),
    probeAll(now).catch(() => null),
  ]);

  const run = lastRun.rows[0] ?? null;
  const cfg = jobs.alerts;
  const nextAt = !cfg.enabled ? null : run ? new Date(Math.max(Date.parse(run.started_at) + cfg.every * 60_000, now)).toISOString() : null;
  const myPhones = me.via !== 'google' ? null : linkedMe ? (mine && mine.ok ? mine.rows.length : null) : phones.perEmail.get(me.email) ?? null;
  const e = env as unknown as VapidEnv & FcmEnv;

  return adminJson({
    configured: true,
    rules,
    saved: row !== null,
    updatedAt: row?.updated_at ?? null,
    recipients: admins.rows.map((a) => ({ email: a.email, name: a.name, role: a.role, gets: whoIncludes(rules.who, a.role), phones: phones.perEmail.get(a.email) ?? null })),
    me: { email: me.email, via: me.via, phones: myPhones },
    push: { web: pushConfigured(e), fcm: fcmConfigured(e) },
    recent: recent.rows.map((r) => {
      const devices = (Number(r.web_total) || 0) + (Number(r.fcm_total) || 0);
      const sent = (Number(r.web_sent) || 0) + (Number(r.fcm_sent) || 0);
      return { id: r.id, at: r.at, rule: ruleOfKey(r.dedupe_key), title: r.title, body: r.body, devices, sent, failed: Math.max(0, devices - sent) };
    }),
    job: { enabled: cfg.enabled, every: cfg.every, lastAt: run?.started_at ?? null, finishedAt: run?.finished_at ?? null, ok: run?.ok ?? null, summary: run?.summary ?? null, nextAt },
    signals: {
      errorsLastHour: errorsLastHour.value,
      errorsHourBefore: errorsHourBefore.value,
      playsLastHour: playsLastHour.value,
      newFeedback: newFeedback.value,
      probes: Object.fromEntries(WATCHED.map((c) => [c, probes?.get(c)?.ok ?? null])),
    },
  });
});

export const onRequestPost = adminPost(async ({ env, body, me, audit }) => {
  const e = env as unknown as PushEnv;
  if (body.action === 'test') {
    if (me.via !== 'google') return adminJson({ error: 'no_own_account', message: 'You signed in with the recovery password, which has no phone. Sign in with Google to send a test alert to your own phone.' }, 400);
    if (!pushConfigured(e as VapidEnv) && !fcmConfigured(e as FcmEnv)) return adminJson({ error: 'push_not_configured', message: 'The server cannot send notifications yet.' }, 400);
    const own = await devicesOfEmail(env, me.email);
    if (!own.ok) return dbFailure(own);
    if (!own.rows.length) return adminJson({ error: 'no_own_devices', message: 'No phone is linked to your Google account yet. Sign in to the VinaX app on your phone with this Google account and allow notifications.' }, 400);
    const report = await fanOut(e, own.rows, { title: 'VinaX: Test alert', body: 'Smart Alerts can reach this phone. Real alerts look like this.', link: '/admin/#/alerts' }, { countTowardCap: false });
    const sent = report.web.sent + report.fcm.sent;
    await audit({ action: 'alert-test', summary: `test alert to own phones (${sent} of ${own.rows.length})`, target: me.email });
    return adminJson({ ok: true, devices: own.rows.length, sent, web: report.web, fcm: report.fcm });
  }
  if (body.action === 'check') {
    const result = await runAlerts(e as never, Date.now(), me.email);
    if (result.error) return adminJson({ configured: true, error: 'db_unavailable', result }, 502);
    await audit({ action: 'alert-check', summary: result.sent.length ? `checked now: sent ${result.sent.map((s) => s.rule).join(', ')}` : `checked now: ${result.firing.length ? 'nothing new to send' : 'all clear'}`, after: { firing: result.firing, sent: result.sent.length } });
    return adminJson({ ok: true, result });
  }
  return badRequest('unknown_action');
}, {
  // A test goes only to the caller's own phone; checking (which may alert everyone) is for owners.
  role: (b) => (b.action === 'test' ? 'editor' : 'owner'),
});
