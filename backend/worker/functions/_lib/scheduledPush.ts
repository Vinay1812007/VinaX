/**
 * Console rebuild — scheduled notifications.
 *
 * The console saves a notification with status 'scheduled' and a
 * scheduled_for time (api/admin/push.ts, when: 'schedule'). The cron job calls
 * `runScheduledNotifications` on every run: each due row is claimed
 * (scheduled → sending, so two overlapping runs never send it twice), its
 * audience is rebuilt from the row (filters, activity, chosen users — signed-in
 * people only), the Notification Rules apply (frequency cap; during quiet
 * hours nothing is claimed and the row waits for the next run), it is sent on
 * both channels and the receipt marks it 'sent'. Idempotent and never throws.
 */
import { db, dbConfigured, q, type DbEnv } from './db';
import { audit } from './audit';
import { audienceDevices, audienceOf, fanOut, kindAllowed, publishAnnouncement, pushRules, quietNow, recordReceipt, underCap, type PushEnv } from './pushSend';

interface DueRow { id: number; title: string; body: string; link: string; image: string | null; audience: Record<string, unknown> | null }

/** At most this many scheduled notifications go out per run (each fans out to up to 5000 devices). */
/** One notification per run: a large audience alone can use most of a Worker run's outgoing requests. */
const PER_RUN = 1;
/** A notification still "sending" this long after its run started died with that run. */
const STUCK_MS = 15 * 60_000;

export interface ScheduledRunSummary {
  due: number;
  sent: number;
  waiting: 'quiet_hours' | 'kind_off' | null;
  failed: number;
}

/** Send every scheduled notification whose time has come. Summary for the job log. */
export async function runScheduledNotifications(env: PushEnv & DbEnv, now = Date.now()): Promise<ScheduledRunSummary> {
  const summary: ScheduledRunSummary = { due: 0, sent: 0, waiting: null, failed: 0 };
  if (!dbConfigured(env)) return summary;
  try {
    // A run that died mid-send leaves its row "sending" forever: mark it failed
    // (shown in History) instead of sending it again and risking doubles.
    await db.update(env, 'notifications', q().eq('status', 'sending').lt('scheduled_for', new Date(now - STUCK_MS).toISOString()), { status: 'failed' });
    const due = await db.select<DueRow>(env, 'notifications', q().eq('status', 'scheduled').lte('scheduled_for', new Date(now).toISOString()).select('id,title,body,link,image,audience').order('scheduled_for', 'asc').limit(PER_RUN));
    if (!due.ok || !due.rows.length) return summary;
    summary.due = due.rows.length;
    const rules = await pushRules(env);
    if (quietNow(rules, now).quiet) { summary.waiting = 'quiet_hours'; return summary; }
    if (!kindAllowed(rules, 'announcements')) { summary.waiting = 'kind_off'; return summary; }
    for (const row of due.rows) {
      // Claim it: only one run moves it from scheduled to sending.
      const claim = await db.update<{ id: number }>(env, 'notifications', q().eq('id', row.id).eq('status', 'scheduled'), { status: 'sending' }, { returning: true });
      if (!claim.ok || !claim.rows.length) continue;
      const a = row.audience ?? {};
      const audience = audienceOf(a, a.activity, a.users);
      const devices = await audienceDevices(env, audience, now);
      if (!devices.ok) {
        // Put it back so the next run tries again.
        await db.update(env, 'notifications', q().eq('id', row.id).eq('status', 'sending'), { status: 'scheduled' });
        summary.failed += 1;
        continue;
      }
      const capped = underCap(devices.rows, rules, now);
      const msg = { title: row.title, body: row.body, link: row.link || '/', image: row.image, id: row.id };
      const report = await fanOut(env, capped.allowed, msg);
      await recordReceipt(env, row.id, report, new Date(now).toISOString());
      if (audience.everyone) await publishAnnouncement(env, msg, now);
      await audit({ env, actor: 'schedule' }, { action: 'push-send', summary: `scheduled "${row.title.slice(0, 60)}" sent to ${audience.label}`, target: String(row.id), after: { web: report.web.sent, fcm: report.fcm.sent } });
      summary.sent += 1;
    }
  } catch (e) {
    console.warn(`[scheduled-push] ${String(e).slice(0, 200)}`);
  }
  return summary;
}
