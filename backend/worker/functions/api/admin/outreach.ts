/**
 * The console's Automatic Notifications page and the Notification Rules
 * previews (schema 18, _lib/outreach.ts).
 *
 * GET  /api/admin/outreach?days=14
 *        → { configured, settings: { recap, winback, release }, rules: { reminders, releases, minGapHours, quiet },
 *            kinds: { recap: { label, when, cap, rule } … }, job: { at, ok, summary } | null,
 *            summary: outreach_summary(days) — { days, kinds, runs, latest, byDay } }
 *        A database before version 18 answers 502 db_update_needed.
 * POST /api/admin/outreach { action: 'preview', kind }  (editor)
 *        → { ok, devices, sent, message, real } — the real message of that kind to
 *          the signed-in admin's own phones, marked [Preview]; 409 no_devices when
 *          none of their devices has notifications on, 409 no_google for the
 *          recovery password (it has no Google account).
 * POST /api/admin/outreach { action: 'run' }  (owner) → the job's run summary.
 */
import { adminJson, badRequest, dbFailure } from '../../_lib/admin';
import { adminGet, adminPost } from '../../_lib/adminRoute';
import { db, type DbEnv } from '../../_lib/db';
import { intIn } from '../../_lib/edge';
import { runJob } from '../../_lib/jobs';
import { isOutreachKind, KIND_INFO, lastOutreachRun, outreachSettingsOf, sendOutreachPreview } from '../../_lib/outreach';
import { pushRules, type PushEnv } from '../../_lib/pushSend';
import { setting } from '../../_lib/settings';

export const onRequestGet = adminGet(async ({ env, url }) => {
  const days = intIn(url.searchParams.get('days'), 1, 90) ?? 14;
  const [raw, rules, job, summary] = await Promise.all([
    setting(env, 'outreach'),
    pushRules(env),
    lastOutreachRun(env),
    db.rpc<Record<string, unknown>>(env, 'outreach_summary', { p_days: days }, { timeoutMs: 30_000 }),
  ]);
  if (!summary.ok) return dbFailure(summary);
  return adminJson({
    configured: true,
    settings: outreachSettingsOf(raw),
    rules: { reminders: rules.types.reminders !== false, releases: rules.types.releases !== false, minGapHours: rules.minGapHours, quiet: rules.quiet },
    kinds: KIND_INFO,
    job,
    summary: summary.value ?? {},
  });
});

export const onRequestPost = adminPost(async ({ env, body, me, audit }) => {
  if (body.action === 'run') {
    const r = await runJob(env as DbEnv, 'outreach');
    await audit({ action: 'outreach-run', summary: `automatic notifications run by hand (${r.ok ? 'ok' : 'failed'})`, after: r.summary });
    return adminJson({ ok: r.ok, startedAt: r.startedAt, ms: r.ms, summary: r.summary });
  }
  if (body.action !== 'preview') return badRequest('unknown_action');
  if (!isOutreachKind(body.kind)) return badRequest('unknown_kind', { kinds: Object.keys(KIND_INFO) });
  if (me.via === 'password' || !me.email.includes('@')) return adminJson({ error: 'no_google' }, 409);
  const r = await sendOutreachPreview(env as PushEnv & DbEnv, body.kind, me.email);
  await audit({ action: 'outreach-preview', summary: r.ok ? `${KIND_INFO[body.kind].label.toLowerCase()} preview sent to ${me.email} (${r.sent} of ${r.devices} devices)` : `${KIND_INFO[body.kind].label.toLowerCase()} preview not sent (${r.error})`, target: me.email });
  if (!r.ok) return adminJson({ error: r.error }, r.error === 'no_devices' ? 409 : 502);
  return adminJson(r);
}, { role: (b) => (b.action === 'run' ? 'owner' : 'editor') });
