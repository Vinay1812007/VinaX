/**
 * Push fan-out shared by the console's sender (api/admin/push.ts), the
 * scheduled sends (_lib/scheduledPush.ts) and any job: pick the audience from
 * `push_devices`, apply the owner's Notification Rules (how often, quiet
 * hours, which kinds), send on both channels with bounded concurrency,
 * switch off dead devices, write the delivery receipt onto the
 * `notifications` row, and publish the `announcement` setting when the push
 * went to everyone (the Android app reads it on open).
 *
 * Console rebuild — only people signed in with Google are reached: a device counts
 * when `push_devices.account_id` is set (the app sends its session when it
 * registers). Activity filters read the ACCOUNT's last visit, not the device's.
 */
import { db, q, type DbEnv, type Rows } from './db';
import { fcmConfigured, sendFcm, type FcmEnv } from './fcm';
import { pushConfigured, sendPush, type VapidEnv } from './webpush';
import { setting, writeSetting } from './settings';

export type PushEnv = DbEnv & VapidEnv & FcmEnv;

export interface PushFilter {
  country?: string;
  region?: string;
  city?: string;
  lang?: string;
  channel?: 'web' | 'fcm';
  /** Chosen people (Google account ids), from the Users page. */
  users?: string[];
  /**
   * The kind of device (the Users page's keys: android-app, ios-app,
   * android-web, ios-web, ipados-web, macos-web, windows-web, linux-web,
   * chromeos-web, other-web), or `web` = any browser, `android` = app or web.
   * A browser kind reaches the person's browsers; the Android app reaches
   * their Android app (the two channels tell those apart; among browsers,
   * the kind comes from the devices the person uses).
   */
  device?: string;
  /** Only people carrying ANY of these owner tags (schema 15). */
  tags?: string[];
  /** Specific people, by the Google email they signed in with. */
  emails?: string[];
}
export type PushActivity = 'today' | 'active7' | 'active30' | 'quiet' | 'dormant14' | 'away7' | 'heavy' | null;
const ACTIVITIES: ReadonlyArray<Exclude<PushActivity, null>> = ['today', 'active7', 'active30', 'quiet', 'dormant14', 'away7', 'heavy'];

export const DEVICE_KEYS = ['android-app', 'ios-app', 'android-web', 'ios-web', 'ipados-web', 'macos-web', 'windows-web', 'linux-web', 'chromeos-web', 'other-web'] as const;
export const DEVICE_FILTERS: ReadonlyArray<string> = ['web', 'android', ...DEVICE_KEYS];
const DEVICE_NAMES: Record<string, string> = {
  web: 'Any web browser', android: 'Android (app or web)',
  'android-app': 'Android app', 'ios-app': 'iOS app', 'android-web': 'Android web', 'ios-web': 'iPhone web', 'ipados-web': 'iPad web',
  'macos-web': 'Mac web', 'windows-web': 'Windows web', 'linux-web': 'Linux web', 'chromeos-web': 'ChromeOS web', 'other-web': 'Other web',
};
export const deviceName = (key: string): string => DEVICE_NAMES[key] ?? key;

/** The Users page's device key for one device (the same rule as `_device_key` in schema.sql). */
export function deviceKeyOf(platform: string | null | undefined, os: string | null | undefined): string {
  const p = (platform ?? '').trim() || 'web';
  if (p === 'android') return 'android-app';
  if (p === 'ios') return 'ios-app';
  return os && ['android', 'ios', 'ipados', 'macos', 'windows', 'linux', 'chromeos'].includes(os) ? `${os}-web` : 'other-web';
}
/** Does a device of this key belong to the filter? */
export function deviceMatches(filter: string, key: string): boolean {
  if (filter === 'web') return key.endsWith('-web');
  if (filter === 'android') return key === 'android-app' || key === 'android-web';
  return filter === key;
}

const TAG_RE = /^[a-z0-9][a-z0-9 _-]{0,23}$/;
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/;
export const MAX_EMAILS = 200;
/** A pasted list of addresses: split on commas, semicolons, spaces and new lines; lower case; valid; unique; at most 200. */
export function emailList(raw: unknown): string[] {
  const list = Array.isArray(raw) ? raw.map(String) : typeof raw === 'string' ? raw.split(/[\s,;]+/) : [];
  const out: string[] = [];
  for (const v of list) {
    const e = v.trim().toLowerCase();
    if (e && e.length <= 254 && EMAIL_RE.test(e) && !out.includes(e)) out.push(e);
    if (out.length >= MAX_EMAILS) break;
  }
  return out;
}

export interface PushMessage {
  title: string;
  body: string;
  link: string;
  /** Picture shown in the notification (https only). */
  image?: string | null;
  /** The notifications row, so a tap can be counted. */
  id?: number | null;
}

export interface Audience {
  filter: PushFilter;
  activity: PushActivity;
  /** Plain-English label for the history ("Hyderabad · Telugu", "Everyone"). */
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
  account_id?: string | null;
  last_pushed_at?: string | null;
}

const DAY = 86_400_000;
const ACCOUNT_RE = /^\d{1,40}$/;
const LANG_NAMES: Record<string, string> = { te: 'Telugu', hi: 'Hindi', ta: 'Tamil', kn: 'Kannada', ml: 'Malayalam', en: 'English', pa: 'Punjabi', bn: 'Bengali', mr: 'Marathi', gu: 'Gujarati', ur: 'Urdu' };
const ACTIVITY_LABEL: Record<Exclude<PushActivity, null>, string> = {
  today: 'Active today', active7: 'Active in last 7 days', active30: 'Active in last 30 days', quiet: 'Quiet 7–14 days',
  dormant14: 'Inactive 14+ days', away7: 'Away 7+ days', heavy: 'Heavy listeners (2 h+ in 30 days)',
};
/** "Heavy listeners": at least this much listening in the last 30 days. */
export const HEAVY_SECONDS = 2 * 3600;

/** Normalise a raw filter / activity / chosen-users triple from a request body. */
export function audienceOf(rawFilter: unknown, rawActivity: unknown, rawUsers?: unknown): Audience {
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
  if (lang && lang !== 'all') filter.lang = lang;
  if (f.channel === 'web' || f.channel === 'fcm') filter.channel = f.channel;
  const device = str(f.device, 20)?.toLowerCase();
  if (device && DEVICE_FILTERS.includes(device)) filter.device = device;
  const tagsRaw = Array.isArray(f.tags) ? f.tags : typeof f.tags === 'string' ? f.tags.split(',') : [];
  const tags = [...new Set(tagsRaw.map((t) => String(t).trim().toLowerCase()).filter((t) => TAG_RE.test(t)))].slice(0, 12);
  if (tags.length) filter.tags = tags;
  const emails = emailList(f.emails);
  if (emails.length) filter.emails = emails;
  const usersRaw = rawUsers ?? f.users;
  const list = Array.isArray(usersRaw) ? usersRaw : typeof usersRaw === 'string' ? usersRaw.split(',') : [];
  const users = [...new Set(list.map((u) => String(u).trim()).filter((u) => ACCOUNT_RE.test(u)))].slice(0, 500);
  if (users.length) filter.users = users;
  const activity: PushActivity = typeof rawActivity === 'string' && (ACTIVITIES as readonly string[]).includes(rawActivity) ? (rawActivity as PushActivity) : null;
  const parts: string[] = [];
  if (users.length) parts.push(users.length === 1 ? '1 chosen user' : `${users.length} chosen users`);
  if (emails.length) parts.push(emails.length === 1 ? '1 person by email' : `${emails.length} people by email`);
  if (filter.city) parts.push(filter.city);
  else if (filter.region) parts.push(filter.region);
  else if (filter.country) parts.push(filter.country);
  if (filter.lang) parts.push(LANG_NAMES[filter.lang] ?? filter.lang);
  if (filter.device) parts.push(deviceName(filter.device));
  else if (filter.channel) parts.push(filter.channel === 'web' ? 'Web' : 'Android');
  if (tags.length) parts.push(tags.length <= 2 ? tags.join(', ') : `${tags.length} tags`);
  if (activity) parts.push(ACTIVITY_LABEL[activity]);
  return { filter, activity, label: parts.join(' · ') || 'Everyone', everyone: parts.length === 0 };
}

/** The channel a device filter implies: browsers for a web kind, the Android app for android-app, else any. */
export function channelOf(filter: PushFilter): 'web' | 'fcm' | null {
  if (filter.device === 'web' || /-web$/.test(filter.device ?? '')) return 'web';
  if (filter.device === 'android-app') return 'fcm';
  return filter.channel ?? null;
}

/** The PostgREST query for an audience: active devices that belong to a Google account. */
export function audienceQuery(a: Audience, users: string[] | undefined = a.filter.users) {
  const query = q().eq('active', 'true').not('account_id', 'is', 'null');
  if (a.filter.country) query.eq('country', a.filter.country);
  if (a.filter.region) query.eq('region', a.filter.region);
  if (a.filter.city) query.eq('city', a.filter.city);
  if (a.filter.lang) query.ilike('lang', `${a.filter.lang}*`);
  const channel = channelOf(a.filter);
  if (channel) query.eq('channel', channel);
  if (users) query.in('account_id', users);
  return query;
}

type AccountSet = Set<string> | null | 'failed';

/** Account ids whose last visit fits the activity filter (null = no activity filter). */
async function accountsForActivity(env: DbEnv, activity: PushActivity, now: number): Promise<AccountSet> {
  if (!activity) return null;
  if (activity === 'heavy') {
    // Schema 14: the listening-time ranking of the last 30 days.
    const r = await db.rpc<{ rows?: Array<{ id: string; seconds: number }> }>(env, 'stats_top_listeners', { p_days: 30, p_limit: 500 });
    if (!r.ok) return 'failed';
    return new Set((r.value?.rows ?? []).filter((x) => Number(x.seconds) >= HEAVY_SECONDS).map((x) => String(x.id)));
  }
  const istDay = new Date(now + 330 * 60_000).toISOString().slice(0, 10);
  const todayStart = new Date(`${istDay}T00:00:00+05:30`).toISOString();
  const d7 = new Date(now - 7 * DAY).toISOString();
  const d14 = new Date(now - 14 * DAY).toISOString();
  const d30 = new Date(now - 30 * DAY).toISOString();
  const query = q().select('id').limit(20_000);
  if (activity === 'today') query.gte('last_seen', todayStart);
  else if (activity === 'active7') query.gte('last_seen', d7);
  else if (activity === 'active30') query.gte('last_seen', d30);
  else if (activity === 'quiet') query.lt('last_seen', d7).gte('last_seen', d14);
  else if (activity === 'away7') query.lt('last_seen', d7);
  else query.lt('last_seen', d14);
  const r = await db.select<{ id: string }>(env, 'accounts', query);
  if (!r.ok) return 'failed';
  return new Set(r.rows.map((x) => x.id));
}

interface DeviceKindRow { account_id: string | null; platform: string | null; os: string | null }

/** Account ids who use a device of the filtered kind (null = the channel alone decides, or no device filter). */
async function accountsForDevice(env: DbEnv, device: string | undefined): Promise<AccountSet> {
  // Any browser, or the Android app: the push channel already tells those apart.
  if (!device || device === 'web' || device === 'android-app') return null;
  const r = await db.select<DeviceKindRow>(env, 'listeners', q().not('account_id', 'is', 'null').is('signed_out_at', 'null').select('account_id,platform,os').limit(20_000));
  if (!r.ok) return 'failed';
  const out = new Set<string>();
  for (const d of r.rows) if (d.account_id && deviceMatches(device, deviceKeyOf(d.platform, d.os))) out.add(d.account_id);
  return out;
}

/** Account ids carrying any of the tags (schema 15; an older database has nobody tagged). */
async function accountsForTags(env: DbEnv, tags: string[] | undefined): Promise<AccountSet> {
  if (!tags?.length) return null;
  const list = `{${tags.map((t) => `"${t}"`).join(',')}}`;
  const r = await db.select<{ account_id: string }>(env, 'owner_notes', q().raw(`tags=ov.${encodeURIComponent(list)}`).select('account_id').limit(5000));
  if (!r.ok) return r.code === 'PGRST205' || r.status === 404 ? new Set() : 'failed';
  return new Set(r.rows.map((x) => x.account_id));
}

/** The accounts behind a list of emails: ids, and the addresses nobody signed in with. */
export async function accountsForEmails(env: DbEnv, emails: string[] | undefined): Promise<{ ids: Set<string>; unresolved: string[] } | null | 'failed'> {
  if (!emails?.length) return null;
  const ids = new Set<string>();
  const found = new Set<string>();
  for (let i = 0; i < emails.length; i += 100) {
    const r = await db.select<{ id: string; email: string | null }>(env, 'accounts', q().in('email', emails.slice(i, i + 100)).select('id,email').limit(500));
    if (!r.ok) return 'failed';
    for (const a of r.rows) {
      ids.add(a.id);
      if (a.email) found.add(a.email.toLowerCase());
    }
  }
  return { ids, unresolved: emails.filter((e) => !found.has(e)) };
}

/**
 * Every signed-in device the audience reaches (up to 5000). Chosen users and
 * pasted emails are the same thing said two ways, so they ADD UP (the console
 * says "or by email"); the place, language, device, activity and tags then
 * narrow that list, each one an AND.
 */
export async function audienceDevices(env: DbEnv, a: Audience, now = Date.now()): Promise<Rows<DeviceRow>> {
  const COLS = 'id,channel,target,p256dh,auth,account_id,last_pushed_at';
  const fail = (detail: string): Rows<DeviceRow> => ({ ok: false, error: 'unavailable', status: null, code: null, detail, rows: [] });
  // The people named outright: the chosen users plus whoever the emails resolve to.
  const mailed = await accountsForEmails(env, a.filter.emails);
  if (mailed === 'failed') return fail('accounts');
  const named: string[] | undefined = a.filter.users || mailed ? [...new Set([...(a.filter.users ?? []), ...(mailed ? mailed.ids : [])])] : undefined;
  if (named && !named.length) return { ok: true, rows: [] };
  // Named people are asked for in groups of 150 (an address-length limit),
  // so a long list is never cut by the 5000-device cap of one read.
  const groups: Array<string[] | undefined> = [];
  if (named) for (let i = 0; i < named.length; i += 150) groups.push(named.slice(i, i + 150));
  else groups.push(undefined);
  const [reads, active, kind, tagged] = await Promise.all([
    Promise.all(groups.map((g) => db.select<DeviceRow>(env, 'push_devices', audienceQuery(a, g).select(COLS).limit(5000)))),
    accountsForActivity(env, a.activity, now),
    accountsForDevice(env, a.filter.device),
    accountsForTags(env, a.filter.tags),
  ]);
  const bad = reads.find((r) => !r.ok);
  if (bad) return bad;
  if (active === 'failed') return fail('accounts');
  if (kind === 'failed') return fail('listeners');
  if (tagged === 'failed') return fail('owner_notes');
  const sets: Set<string>[] = [];
  if (named) sets.push(new Set(named));
  for (const s of [active, kind, tagged]) if (s) sets.push(s);
  const rows = reads.flatMap((r) => r.rows).filter((d) => !!d.account_id && sets.every((s) => s.has(d.account_id!)));
  return { ok: true, rows };
}

/** Devices of the accounts with this email (the admin's own phone, for "Send test to me"). */
export async function devicesOfEmail(env: DbEnv, email: string): Promise<Rows<DeviceRow>> {
  const acc = await db.select<{ id: string }>(env, 'accounts', q().eq('email', email.toLowerCase()).select('id').limit(5));
  if (!acc.ok) return acc;
  if (!acc.rows.length) return { ok: true, rows: [] };
  return db.select<DeviceRow>(env, 'push_devices', q().eq('active', 'true').in('account_id', acc.rows.map((r) => r.id)).select('id,channel,target,p256dh,auth,account_id,last_pushed_at').limit(50));
}

/** Distinct people among devices. */
export const peopleIn = (devices: DeviceRow[]): number => new Set(devices.map((d) => d.account_id).filter(Boolean)).size;

/* ------------------------------------------------------ Notification Rules */

export type PushKind = 'announcements' | 'releases' | 'recommendations' | 'reminders';

export interface PushRules {
  /** No person gets two notifications closer than this (0 = no limit). */
  minGapHours: number;
  /** Quiet hours in India time, "HH:MM". */
  quiet: { enabled: boolean; start: string; end: string };
  /** Kinds switched off (missing = on). */
  types: Record<PushKind, boolean>;
}

const HM = /^([01]\d|2[0-3]):([0-5]\d)$/;
const hm = (v: unknown, fallback: string): string => {
  if (typeof v === 'string' && HM.test(v)) return v;
  if (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 23) return `${String(v).padStart(2, '0')}:00`;
  return fallback;
};

/** The owner's rules from the `push` setting, with the old { minGapHours, quietStart, quietEnd } shape still read. */
export function rulesOf(raw: unknown): PushRules {
  const r = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const gap = Number(r.minGapHours);
  const quietRaw = r.quiet && typeof r.quiet === 'object' ? (r.quiet as Record<string, unknown>) : null;
  const oldQuiet = r.quietStart != null && r.quietEnd != null;
  const quiet = quietRaw
    ? { enabled: quietRaw.enabled === true, start: hm(quietRaw.start, '22:00'), end: hm(quietRaw.end, '08:00') }
    : { enabled: oldQuiet, start: hm(r.quietStart, '22:00'), end: hm(r.quietEnd, '08:00') };
  const t = r.types && typeof r.types === 'object' ? (r.types as Record<string, unknown>) : {};
  return {
    minGapHours: Number.isFinite(gap) && gap > 0 ? Math.min(gap, 24 * 7) : 0,
    quiet,
    types: { announcements: t.announcements !== false, releases: t.releases !== false, recommendations: t.recommendations !== false, reminders: t.reminders !== false },
  };
}

export async function pushRules(env: DbEnv): Promise<PushRules> {
  return rulesOf(await setting(env, 'push'));
}

/** Minutes since midnight in India for a moment. */
function istMinutes(now: number): number {
  const d = new Date(now + 330 * 60_000);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}
const toMin = (s: string): number => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));

/** Is it quiet hours now? `until` is when they end (ISO). */
export function quietNow(rules: PushRules, now = Date.now()): { quiet: boolean; until: string | null } {
  if (!rules.quiet.enabled) return { quiet: false, until: null };
  const m = istMinutes(now), s = toMin(rules.quiet.start), e = toMin(rules.quiet.end);
  if (s === e) return { quiet: false, until: null };
  const inside = s < e ? m >= s && m < e : m >= s || m < e;
  if (!inside) return { quiet: false, until: null };
  const wait = (e - m + 1440) % 1440;
  return { quiet: true, until: new Date(Math.floor(now / 60_000) * 60_000 + wait * 60_000).toISOString() };
}

/** Devices that may get one more notification under the frequency cap. */
export function underCap(devices: DeviceRow[], rules: PushRules, now = Date.now()): { allowed: DeviceRow[]; skipped: number } {
  if (!rules.minGapHours) return { allowed: devices, skipped: 0 };
  const cut = now - rules.minGapHours * 3_600_000;
  const allowed = devices.filter((d) => !d.last_pushed_at || new Date(d.last_pushed_at).getTime() < cut);
  return { allowed, skipped: devices.length - allowed.length };
}

/** May a push of this kind go out at all? */
export const kindAllowed = (rules: PushRules, kind: PushKind): boolean => rules.types[kind] !== false;

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
 *
 * Each device's `last_pushed_at` is bumped, so the send counts toward the
 * listener frequency cap (`underCap`). `countTowardCap: false` skips that for
 * pushes that are not for listeners (Smart Alerts to admins' phones).
 */
export async function fanOut(env: PushEnv, devices: DeviceRow[], msg: PushMessage, opts: { countTowardCap?: boolean } = {}): Promise<SendReport> {
  const web = devices.filter((d) => d.channel === 'web' && d.p256dh && d.auth);
  const fcm = devices.filter((d) => d.channel === 'fcm');
  const report: SendReport = {
    web: { total: web.length, sent: 0, gone: 0, failed: {} },
    fcm: { total: fcm.length, sent: 0, failed: {}, error: fcmConfigured(env) ? null : 'not_configured' },
  };

  if (fcm.length && fcmConfigured(env)) {
    const r = await sendFcm(env, fcm.map((d) => d.target), { title: msg.title, body: msg.body, link: msg.link, image: msg.image ?? null, id: msg.id ?? null });
    report.fcm.sent = r.sent;
    report.fcm.failed = r.failed;
    report.fcm.error = r.error;
    if (r.dead.length) await db.update(env, 'push_devices', q().in('target', r.dead), { active: false });
  }

  if (web.length && pushConfigured(env)) {
    const results = await mapWithConcurrency(web, 32, (d) => sendPush(env, { endpoint: d.target, p256dh: d.p256dh!, auth: d.auth! }, { title: msg.title, body: msg.body, url: msg.link, icon: '/icons/icon-192.png', ...(msg.image ? { image: msg.image } : {}), ...(msg.id ? { id: msg.id } : {}) }));
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

  if (devices.length && opts.countTowardCap !== false) {
    const now = new Date().toISOString();
    const targets = devices.map((d) => d.target);
    for (let i = 0; i < targets.length; i += 200) await db.update(env, 'push_devices', q().in('target', targets.slice(i, i + 200)), { last_pushed_at: now });
  }
  return report;
}

/** Write the receipt onto the notification row. */
export async function recordReceipt(env: DbEnv, notificationId: number, report: SendReport, sentAt: string | null = null): Promise<void> {
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
    status: 'sent',
    at: sentAt ?? new Date().toISOString(),
  });
}

/** The Android in-app pickup: only an everyone-push becomes the announcement. */
export async function publishAnnouncement(env: DbEnv, msg: PushMessage, ts: number): Promise<void> {
  await writeSetting(env, 'announcement', { title: msg.title, body: msg.body, link: msg.link, ts }, 'push');
}
