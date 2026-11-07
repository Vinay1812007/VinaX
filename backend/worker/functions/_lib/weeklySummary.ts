/**
 * The owner's weekly summary email: every Monday from 9 AM India time, last
 * week's numbers (Monday to Sunday) next to the week before, through Resend.
 *
 * The `weekly-summary` job (_lib/jobs.ts) runs hourly; it sends once a week:
 * when India time is past Monday 09:00 and no summary has gone out for that
 * week yet (a `weekly-summary-sent` row in job_runs remembers it, as the daily
 * co-listening rebuild does). A missed Monday is caught up later that week.
 *
 * Who gets it: the `email` setting's `weeklyTo`, or every Owner when empty.
 * Off with `email.enabled` or `email.weeklySummary` false, and without
 * RESEND_API_KEY. The numbers come from weekly_summary() (schema 17).
 */
import { ownerEmails } from './adminAuth';
import { db, q, type DbEnv } from './db';
import { CONSOLE, emailConfigured, emailSettingsOf, escapeHtml, layout, sendEmail, type Email, type EmailEnv, type SendResult } from './email';
import { setting } from './settings';

export interface WeeklyRow { title?: string; artist: string; plays: number; people: number }

export interface WeeklySummary {
  from: string;
  to: string;
  newUsers: number;
  newUsersPrev: number;
  totalUsers: number;
  activeUsers: number;
  activeUsersPrev: number;
  plays: number;
  playsPrev: number;
  listenSeconds: number;
  listenSecondsPrev: number;
  topSongs: WeeklyRow[];
  topArtists: WeeklyRow[];
  atRisk: number;
  errors: number;
  errorsPrev: number;
  feedback: number;
}

const IST_MS = 330 * 60_000;
export const SEND_HOUR_IST = 9;
export const SENT_MARKER = 'weekly-summary-sent';

/** The India-time date (YYYY-MM-DD) of the Monday that starts the week holding `now`. */
export function mondayOf(now: number): string {
  const ist = new Date(now + IST_MS);
  const back = (ist.getUTCDay() + 6) % 7; // Monday = 0
  return new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate() - back)).toISOString().slice(0, 10);
}

/**
 * The week whose summary is due at `now`, or null: the summary for the week
 * that ENDED on the Sunday before this Monday is due from Monday 09:00 IST,
 * once (`lastSent` is the key of the last one sent). The key is that Monday.
 */
export function weekDue(now: number, lastSent: string | null): string | null {
  const monday = mondayOf(now);
  const sendFrom = Date.parse(`${monday}T00:00:00Z`) - IST_MS + SEND_HOUR_IST * 3_600_000;
  if (now < sendFrom) return null;
  return lastSent === monday ? null : monday;
}

// ── The email ─────────────────────────────────────────────────────────

const fmtInt = (n: number): string => Math.round(n).toLocaleString('en-IN');

/** "3 h 12 min", "45 min", "0 min". */
export function hoursText(seconds: number): string {
  const m = Math.round(Math.max(0, seconds) / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${fmtInt(h)} h ${r} min` : `${fmtInt(h)} h`;
}

/** "▲ 12%" / "▼ 3%" / "same" / "new" against last week. */
export function change(cur: number, prev: number): string {
  if (!prev) return cur ? 'new this week' : 'same as last week';
  const pct = Math.round(((cur - prev) / prev) * 100);
  if (pct === 0) return 'same as last week';
  return `${pct > 0 ? '▲' : '▼'} ${Math.abs(pct)}% vs last week`;
}

const dayName = (iso: string): string => {
  const d = new Date(`${iso}T00:00:00Z`);
  return Number.isFinite(d.getTime()) ? new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(d) : iso;
};

export const weekLabel = (s: Pick<WeeklySummary, 'from' | 'to'>): string => `${dayName(s.from)} – ${dayName(s.to)}`;

/** The summary as an email (HTML and plain text). */
export function weeklySummaryEmail(to: string | string[], s: WeeklySummary, opts: { test?: boolean } = {}): Email {
  const range = weekLabel(s);
  const tiles: Array<[string, string, string]> = [
    ['Listening', hoursText(s.listenSeconds), change(s.listenSeconds, s.listenSecondsPrev)],
    ['Active people', fmtInt(s.activeUsers), change(s.activeUsers, s.activeUsersPrev)],
    ['New people', fmtInt(s.newUsers), change(s.newUsers, s.newUsersPrev)],
    ['Songs played', fmtInt(s.plays), change(s.plays, s.playsPrev)],
  ];
  const tileHtml = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:separate;border-spacing:0 8px">${
    [0, 2].map((i) => `<tr>${tiles.slice(i, i + 2).map(([k, v, c]) =>
      `<td width="48%" style="background:#f4f2f8;border-radius:12px;padding:12px 14px;vertical-align:top"><span style="display:block;font-size:12px;color:#6b6480">${escapeHtml(k)}</span><strong style="display:block;font-size:22px;line-height:1.3">${escapeHtml(v)}</strong><span style="display:block;font-size:12px;color:${c.startsWith('▼') ? '#b45309' : '#047857'}">${escapeHtml(c)}</span></td>`,
    ).join('<td width="4%" style="font-size:0;line-height:0">&nbsp;</td>')}</tr>`).join('')
  }</table>`;
  const list = (title: string, rows: WeeklyRow[], label: (r: WeeklyRow) => string): string =>
    rows.length
      ? `<strong>${escapeHtml(title)}</strong><br>${rows.map((r, i) => `${i + 1}. ${escapeHtml(label(r))} <span style="color:#6b6480">· ${fmtInt(r.plays)} plays, ${fmtInt(r.people)} ${r.people === 1 ? 'person' : 'people'}</span>`).join('<br>')}`
      : `<strong>${escapeHtml(title)}</strong><br><span style="color:#6b6480">Nothing played last week.</span>`;
  const songLabel = (r: WeeklyRow): string => `${r.title ?? 'Unknown song'} — ${r.artist}`;
  const health = [
    `${fmtInt(s.atRisk)} ${s.atRisk === 1 ? 'regular listener has' : 'regular listeners have'} not been back for a week (At risk).`,
    `${fmtInt(s.errors)} app ${s.errors === 1 ? 'error' : 'errors'} (${change(s.errors, s.errorsPrev).replace(' vs last week', '')}) and ${fmtInt(s.feedback)} new feedback ${s.feedback === 1 ? 'message' : 'messages'}.`,
    `${fmtInt(s.totalUsers)} people have signed in to VinaX so far.`,
  ];
  const subject = `${opts.test ? '[Test] ' : ''}VinaX last week: ${hoursText(s.listenSeconds)} listened, ${fmtInt(s.activeUsers)} active, ${fmtInt(s.newUsers)} new`;
  return {
    kind: 'weeklySummary',
    to,
    subject,
    idempotencyKey: opts.test ? undefined : `weekly-summary:${s.from}`,
    html: layout({
      title: `Your week in VinaX · ${range}`,
      lines: [
        tileHtml,
        list('Top songs', s.topSongs, songLabel),
        list('Top artists', s.topArtists, (r) => r.artist),
        health.map(escapeHtml).join('<br>'),
      ],
      button: { label: 'Open the console', href: CONSOLE },
      footer: 'Signed-in people only, India time, Monday to Sunday. Listening time is an estimate from the app’s “still playing” pings. Owners can change who gets this, or switch it off, in App Settings › Notification Rules › Account emails.',
    }),
    text: [
      `Your week in VinaX · ${range}`,
      '',
      ...tiles.map(([k, v, c]) => `${k}: ${v} (${c})`),
      '',
      'Top songs:',
      ...(s.topSongs.length ? s.topSongs.map((r, i) => `${i + 1}. ${songLabel(r)} · ${r.plays} plays`) : ['Nothing played last week.']),
      '',
      'Top artists:',
      ...(s.topArtists.length ? s.topArtists.map((r, i) => `${i + 1}. ${r.artist} · ${r.plays} plays`) : ['Nothing played last week.']),
      '',
      ...health,
      '',
      `Console: ${CONSOLE}`,
    ].join('\n'),
  };
}

// ── Reading and sending ───────────────────────────────────────────────

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : Number(v) || 0);
const rows = (v: unknown): WeeklyRow[] => (Array.isArray(v) ? v : []).slice(0, 5).map((r) => {
  const o = (r && typeof r === 'object' ? r : {}) as Record<string, unknown>;
  return { title: typeof o.title === 'string' ? o.title : undefined, artist: typeof o.artist === 'string' ? o.artist : 'Unknown artist', plays: num(o.plays), people: num(o.people) };
});

/** weekly_summary() for the week before `monday` (YYYY-MM-DD, India time). */
export async function readWeeklySummary(env: DbEnv, monday: string): Promise<{ ok: true; value: WeeklySummary } | { ok: false; error: string }> {
  const r = await db.rpc<Record<string, unknown>>(env, 'weekly_summary', { p_to: monday }, { timeoutMs: 60_000 });
  if (!r.ok) return { ok: false, error: r.error };
  const v = r.value ?? {};
  return {
    ok: true,
    value: {
      from: String(v.from ?? ''), to: String(v.to ?? ''),
      newUsers: num(v.newUsers), newUsersPrev: num(v.newUsersPrev), totalUsers: num(v.totalUsers),
      activeUsers: num(v.activeUsers), activeUsersPrev: num(v.activeUsersPrev),
      plays: num(v.plays), playsPrev: num(v.playsPrev),
      listenSeconds: num(v.listenSeconds), listenSecondsPrev: num(v.listenSecondsPrev),
      topSongs: rows(v.topSongs), topArtists: rows(v.topArtists),
      atRisk: num(v.atRisk), errors: num(v.errors), errorsPrev: num(v.errorsPrev), feedback: num(v.feedback),
    },
  };
}

/** Who gets the summary: the setting's list, or every Owner. */
export async function weeklyRecipients(env: EmailEnv, raw?: unknown): Promise<string[]> {
  const s = emailSettingsOf(raw === undefined ? await setting(env, 'email') : raw);
  return s.weeklyTo.length ? s.weeklyTo : ownerEmails(env as never);
}

/** When the last summary went out and for which week, or null. */
export async function lastWeeklySent(env: DbEnv): Promise<{ week: string | null; at: string; to: string[] } | null> {
  const r = await db.select<{ started_at: string; summary: Record<string, unknown> | null }>(env, 'job_runs', q().eq('job', SENT_MARKER).select('started_at,summary').order('started_at', 'desc').limit(1));
  const row = r.ok ? r.rows[0] : undefined;
  if (!row) return null;
  const to = Array.isArray(row.summary?.to) ? (row.summary.to as unknown[]).filter((x): x is string => typeof x === 'string') : [];
  return { week: typeof row.summary?.week === 'string' ? row.summary.week : null, at: row.started_at, to };
}

/** The job: send last week's summary once, from Monday 09:00 India time. Throws on a failed send so the run shows as failed. */
export async function runWeeklySummary(env: EmailEnv, now = Date.now()): Promise<Record<string, unknown>> {
  const raw = await setting(env, 'email');
  const s = emailSettingsOf(raw);
  if (!emailConfigured(env)) return { skipped: 'no RESEND_API_KEY' };
  if (!s.enabled || !s.weeklySummary) return { skipped: 'switched off' };
  const last = await db.select<{ summary: Record<string, unknown> | null }>(env, 'job_runs', q().eq('job', SENT_MARKER).select('summary').order('started_at', 'desc').limit(1));
  if (!last.ok) throw new Error(`weekly-summary: last send unreadable (${last.error})`);
  const lastWeek = last.rows[0]?.summary?.week;
  const week = weekDue(now, typeof lastWeek === 'string' ? lastWeek : null);
  if (!week) return { skipped: 'not due', nextFor: mondayOf(now) };
  const to = await weeklyRecipients(env, raw);
  if (!to.length) return { skipped: 'no recipient' };
  const data = await readWeeklySummary(env, week);
  if (!data.ok) throw new Error(`weekly-summary: numbers unreadable (${data.error})`);
  const sent = await sendEmail(env, weeklySummaryEmail(to, data.value));
  if (!sent.ok) throw new Error(`weekly-summary: not sent (${sent.error})`);
  await db.insert(env, 'job_runs', { job: SENT_MARKER, started_at: new Date(now).toISOString(), finished_at: new Date().toISOString(), ok: true, summary: { week, to, id: sent.id } });
  return { sent: week, to: to.length };
}

/** The console's "Send a test now": this week's numbers so far are not ready, so it sends LAST week's, marked [Test]. */
export async function sendWeeklyTest(env: EmailEnv, to: string[], now = Date.now()): Promise<SendResult> {
  const data = await readWeeklySummary(env, mondayOf(now));
  if (!data.ok) return { ok: false, error: `db_${data.error}`, status: null };
  return sendEmail(env, weeklySummaryEmail(to, data.value, { test: true }));
}
