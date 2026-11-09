/**
 * Automatic notifications (schema 18): the pushes VinaX sends on its own,
 * one message per person, from the `outreach` job (_lib/jobs.ts, hourly).
 *
 *   recap    Sunday from 7 PM in each person's own time (a missed Sunday is
 *            caught up Monday morning): "Your week in VinaX — 3 h 12 min of
 *            music · top artist X · most played Y", only when they listened
 *            30 minutes or more that week. Opens /weekly. Once a week.
 *   winback  nothing from any of their devices for 7 days or more (but active
 *            in the 30 days before): a recent song from their top artist, in
 *            the daytime, at most one a week per person, and no more after
 *            three in a row went unanswered. Counts as a Reminder.
 *   release  songs released in the last day and a half by one of the person's
 *            top three artists (the catalogue's new releases in the languages
 *            they play, matched by artist name): one push a day per person,
 *            never the same song twice. Counts as a New release.
 *
 * Every send keeps to Notification Rules (quiet hours, the per-person cap,
 * the Reminders / New releases switches) and to the `outreach` setting's own
 * switches. A run writes ONE `notifications` row per kind (taps are counted
 * there, as for every push) and one `outreach` row per person; the row's
 * dedupe key is the cap, so two overlapping runs never send the same thing
 * twice. The job never throws: what went wrong is in its summary.
 */
import { audit } from './audit';
import { DAY_MS, db, dbConfigured, q, type DbEnv, type Rows } from './db';
import { devicesOfEmail, fanOut, kindAllowed, pushRules, quietNow, recordReceipt, underCap, type DeviceRow, type PushEnv, type PushKind, type PushRules, type SendReport } from './pushSend';
import { setting } from './settings';
import { catalogNewReleases, CatalogUnavailable, searchCatalogSongs } from './trends/catalog';
import { latinKey, type CatalogCandidate } from './trends/matcher';
import { hoursText } from './weeklySummary';

export type OutreachKind = 'recap' | 'winback' | 'release';
export const OUTREACH_KINDS: readonly OutreachKind[] = ['recap', 'winback', 'release'];
export const isOutreachKind = (v: unknown): v is OutreachKind => typeof v === 'string' && (OUTREACH_KINDS as readonly string[]).includes(v);

export interface OutreachSettings { recap: boolean; winback: boolean; release: boolean }

/** The `outreach` setting: every kind is on unless switched off. */
export function outreachSettingsOf(raw: unknown): OutreachSettings {
  const o = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  return { recap: o.recap !== false, winback: o.winback !== false, release: o.release !== false };
}

/** The rules, in plain words, for the console and the tips. */
export const KIND_INFO: Record<OutreachKind, { label: string; when: string; cap: string; rule: PushKind | null }> = {
  recap: { label: 'Weekly recap', when: 'Sunday from 7 PM in each person’s own time (a missed Sunday is caught up Monday morning)', cap: 'once a week, only to people who listened 30 minutes or more that week', rule: null },
  winback: { label: 'Win-back', when: 'in the daytime (9 AM – 9 PM, their time) once nothing has come from any of their devices for 7 days', cap: 'one a week per person; no more after three in a row go unanswered', rule: 'reminders' },
  release: { label: 'New releases', when: 'in the daytime, within a day and a half of a release by one of their top three artists', cap: 'one a day per person, never the same song twice', rule: 'releases' },
};

export const RECAP_HOUR = 19;
export const RECAP_MIN_SECONDS = 30 * 60;
export const WINBACK_QUIET_DAYS = 7;
export const WINBACK_GAP_DAYS = 7;
export const WINBACK_MAX_UNANSWERED = 3;
export const RELEASE_WINDOW_MS = 36 * 3_600_000;
/** People per run and kind: each one is its own fan-out, and a Worker run has a request budget. */
export const PER_RUN: Record<OutreachKind, number> = { recap: 300, winback: 100, release: 200 };
const SAMPLE_ARTIST = 'A.R. Rahman';

// ── Time, in the person's own zone ───────────────────────────────────

const IST = 330;
const tzOf = (tz: unknown): number => (typeof tz === 'number' && Number.isFinite(tz) && Math.abs(tz) <= 840 ? Math.round(tz) : IST);

/** Weekday (0 = Sunday), hour and date where the person is (tz in minutes east of UTC; India when unknown). */
export function localParts(now: number, tz: unknown): { dow: number; hour: number; date: string } {
  const d = new Date(now + tzOf(tz) * 60_000);
  return { dow: d.getUTCDay(), hour: d.getUTCHours(), date: d.toISOString().slice(0, 10) };
}
const shiftDate = (iso: string, days: number): string => new Date(Date.parse(`${iso}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);

/** The Sunday a recap is due for right now where the person is (Sunday from 19:00, or Monday before noon as a catch-up), or null. */
export function recapWeek(now: number, tz: unknown): string | null {
  const p = localParts(now, tz);
  if (p.dow === 0 && p.hour >= RECAP_HOUR) return p.date;
  if (p.dow === 1 && p.hour < 12) return shiftDate(p.date, -1);
  return null;
}
/** 9 AM to 9 PM where the person is. */
export const daytime = (now: number, tz: unknown): boolean => { const h = localParts(now, tz).hour; return h >= 9 && h < 21; };
/** The calendar day in India (the once-a-day keys). */
export const istDate = (now: number): string => localParts(now, IST).date;

// ── Candidates (the outreach_* functions' rows) ──────────────────────

export interface RecapCandidate { id: string; name: string | null; tzOffset: number | null; seconds: number; plays: number; days: number; topArtist: string | null; topSong: string | null; topSongId: string | null; topSongArtist: string | null }
export interface WinbackCandidate { id: string; name: string | null; tzOffset: number | null; lastActive: string | null; topArtist: string | null; lastWinbackAt: string | null; unanswered: number }
export interface ReleaseCandidate { id: string; name: string | null; tzOffset: number | null; artists: string[]; languages: string[]; sentSongs: string[]; lastReleaseAt: string | null }

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : Number(v) || 0);
const tz = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const list = (v: unknown): string[] => (Array.isArray(v) ? v.map((x) => str(x)).filter((x): x is string => !!x) : []);
const rows = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v.filter((r): r is Record<string, unknown> => !!r && typeof r === 'object' && typeof (r as Record<string, unknown>).id === 'string') : []);

export const asRecaps = (v: unknown): RecapCandidate[] => rows(v).map((r) => ({
  id: String(r.id), name: str(r.name), tzOffset: tz(r.tzOffset), seconds: num(r.seconds), plays: num(r.plays), days: num(r.days),
  topArtist: str(r.topArtist), topSong: str(r.topSong), topSongId: str(r.topSongId), topSongArtist: str(r.topSongArtist),
}));
export const asWinbacks = (v: unknown): WinbackCandidate[] => rows(v).map((r) => ({
  id: String(r.id), name: str(r.name), tzOffset: tz(r.tzOffset), lastActive: str(r.lastActive), topArtist: str(r.topArtist), lastWinbackAt: str(r.lastWinbackAt), unanswered: num(r.unanswered),
}));
export const asReleases = (v: unknown): ReleaseCandidate[] => rows(v).map((r) => ({
  id: String(r.id), name: str(r.name), tzOffset: tz(r.tzOffset), artists: list(r.artists).slice(0, 3), languages: list(r.languages).slice(0, 3), sentSongs: list(r.sentSongs), lastReleaseAt: str(r.lastReleaseAt),
}));

// ── Messages ─────────────────────────────────────────────────────────

export interface Message { title: string; body: string; link: string; image?: string | null }

const firstName = (name: string | null): string | null => str(name)?.split(/\s+/)[0]?.replace(/[“”"']/g, '') ?? null;
export const songLink = (id: string): string => `/song/${encodeURIComponent(id)}`;
const quote = (s: string): string => `“${s.trim().slice(0, 60)}”`;

/** "Your week in VinaX" — the time, the top artist, the most played song. */
export function recapMessage(c: Pick<RecapCandidate, 'seconds' | 'topArtist' | 'topSong'>): Message {
  const parts = [`${hoursText(c.seconds)} of music`];
  if (c.topArtist) parts.push(`top artist ${c.topArtist}`);
  if (c.topSong) parts.push(`most played ${quote(c.topSong)}`);
  return { title: 'Your week in VinaX', body: `${parts.join(' · ')}. Tap for your week.`, link: '/weekly' };
}

/** A nudge for someone who went quiet, naming a recent song from their top artist when the catalogue has one. */
export function winbackMessage(c: Pick<WinbackCandidate, 'name' | 'topArtist'>, song: CatalogCandidate | null): Message {
  const who = firstName(c.name);
  const artist = song?.primaryArtists[0] ?? c.topArtist;
  if (song && artist) {
    return { title: `New from ${artist}`, body: `${quote(song.title)} and more from ${artist} are waiting for you on VinaX.`, link: songLink(song.id), image: song.image ?? null };
  }
  if (artist) return { title: `${who ? `${who}, your` : 'Your'} music missed you`, body: `Songs from ${artist} are waiting for you. Tap to pick up where you left off.`, link: '/' };
  return { title: `${who ? `${who}, your` : 'Your'} music missed you`, body: 'Your songs and playlists are right where you left them. Tap to play.', link: '/' };
}

/** One or more new songs from the person's artists. */
export function releaseMessage(songs: CatalogCandidate[]): Message {
  const [first] = songs;
  if (!first) return { title: 'New releases', body: 'New songs from your artists are out.', link: '/discover' };
  const artist = first.primaryArtists[0] ?? 'your artist';
  if (songs.length === 1) return { title: `New from ${artist}`, body: `${quote(first.title)} is out now. Tap to listen.`, link: songLink(first.id), image: first.image ?? null };
  const artists = [...new Set(songs.map((s) => s.primaryArtists[0]).filter((a): a is string => !!a))];
  const names = artists.length <= 2 ? artists.join(' and ') : `${artists.slice(0, 2).join(', ')} and more`;
  return {
    title: `${songs.length} new songs from ${names}`,
    body: `${songs.slice(0, 3).map((s) => `${quote(s.title)} by ${s.primaryArtists[0] ?? 'your artist'}`).join(', ')}. Tap to listen.`,
    link: songLink(first.id),
    image: first.image ?? null,
  };
}

// ── The catalogue: artists and songs ─────────────────────────────────

/** Is this song by the artist? Spelling-folded names: "A.R. Rahman" = "A R Rahman" = "ఎ.ఆర్. రెహమాన్". */
export function byArtist(song: Pick<CatalogCandidate, 'primaryArtists' | 'featuredArtists'>, artist: string): boolean {
  const k = latinKey(artist);
  if (k.length < 3) return false;
  return [...song.primaryArtists, ...song.featuredArtists].some((a) => {
    const ak = latinKey(a);
    if (!ak || ak === k) return !!ak;
    const [shorter, longer] = ak.length < k.length ? [ak, k] : [k, ak];
    return shorter.length >= 6 && longer.includes(shorter);
  });
}

/** Released within the last day and a half (a day ahead is tolerated: catalogue dates are not timezoned). */
export function isFresh(song: Pick<CatalogCandidate, 'releaseDate'>, now: number): boolean {
  if (!song.releaseDate) return false;
  const t = Date.parse(`${song.releaseDate}T00:00:00Z`);
  return Number.isFinite(t) && now - t <= RELEASE_WINDOW_MS + DAY_MS / 2 && t - now <= DAY_MS;
}

/** The newest song in a list (release date, then year; the catalogue's order breaks ties). */
export function newest(songs: CatalogCandidate[]): CatalogCandidate | null {
  return [...songs].sort((a, b) => (b.releaseDate ?? '').localeCompare(a.releaseDate ?? '') || (b.year ?? 0) - (a.year ?? 0))[0] ?? null;
}

interface Catalogue {
  search: (query: string, limit: number) => Promise<CatalogCandidate[]>;
  newReleases: (language: string, limit: number) => Promise<CatalogCandidate[]>;
}
const CATALOGUE: Catalogue = { search: (query, limit) => searchCatalogSongs(query, limit), newReleases: (language, limit) => catalogNewReleases(language, limit) };

/** A recent song by the artist, or null (the catalogue down, or nothing by them). Errors are counted, never thrown. */
async function recentSongBy(cat: Catalogue, artist: string, errors: { n: number }): Promise<CatalogCandidate | null> {
  if (errors.n >= 3) return null;
  try {
    const found = (await cat.search(artist, 10)).filter((s) => byArtist(s, artist));
    return newest(found);
  } catch {
    errors.n += 1;
    return null;
  }
}

// ── Sending ──────────────────────────────────────────────────────────

export interface KindSummary { candidates: number; due: number; people: number; sent: number; skipped: Record<string, number>; notificationId?: number | null; note?: string }

interface Planned { account: string; key: string; msg: Message; facts: Record<string, unknown> }

const DEVICE_COLS = 'id,channel,target,p256dh,auth,account_id,last_pushed_at';

/** Active, linked push devices of these people, by account. */
async function devicesByAccount(env: DbEnv, accounts: string[]): Promise<Rows<DeviceRow> & { byAccount: Map<string, DeviceRow[]> }> {
  const byAccount = new Map<string, DeviceRow[]>();
  for (let i = 0; i < accounts.length; i += 150) {
    const r = await db.select<DeviceRow>(env, 'push_devices', q().eq('active', 'true').in('account_id', accounts.slice(i, i + 150)).select(DEVICE_COLS).limit(5000));
    if (!r.ok) return { ...r, byAccount };
    for (const d of r.rows) {
      if (!d.account_id) continue;
      const l = byAccount.get(d.account_id) ?? [];
      l.push(d);
      byAccount.set(d.account_id, l);
    }
  }
  return { ok: true, rows: [...byAccount.values()].flat(), byAccount };
}

const emptyReport = (): SendReport => ({ web: { total: 0, sent: 0, gone: 0, failed: {} }, fcm: { total: 0, sent: 0, failed: {}, error: null } });
function addReport(sum: SendReport, r: SendReport): void {
  sum.web.total += r.web.total; sum.web.sent += r.web.sent; sum.web.gone += r.web.gone;
  for (const [k, v] of Object.entries(r.web.failed)) sum.web.failed[k] = (sum.web.failed[k] ?? 0) + v;
  sum.fcm.total += r.fcm.total; sum.fcm.sent += r.fcm.sent;
  for (const [k, v] of Object.entries(r.fcm.failed)) sum.fcm.failed[k] = (sum.fcm.failed[k] ?? 0) + v;
  if (r.fcm.error) sum.fcm.error = r.fcm.error;
}
const bump = (o: Record<string, number>, k: string): void => { o[k] = (o[k] ?? 0) + 1; };

/**
 * Send one planned message per person: devices under the cap, a claimed
 * `outreach` row per person (its dedupe key stops doubles), one
 * `notifications` row for the run, then the fan-outs and the receipts.
 */
async function deliver(env: PushEnv & DbEnv, kind: OutreachKind, planned: Planned[], rules: PushRules, now: number, summary: KindSummary): Promise<void> {
  if (!planned.length) return;
  const devices = await devicesByAccount(env, planned.map((p) => p.account));
  if (!devices.ok) throw new Error(`push devices unreadable (${devices.error})`);
  const claimed: Array<Planned & { rowId: number; devices: DeviceRow[] }> = [];
  for (const p of planned) {
    const mine = devices.byAccount.get(p.account) ?? [];
    if (!mine.length) { bump(summary.skipped, 'noDevice'); continue; }
    const { allowed } = underCap(mine, rules, now);
    if (!allowed.length) { bump(summary.skipped, 'recentlyNotified'); continue; }
    const claim = await db.insert<{ id: number }>(env, 'outreach', {
      account_id: p.account, kind, sent_at: new Date(now).toISOString(), dedupe_key: p.key, title: p.msg.title, body: p.msg.body, link: p.msg.link, facts: p.facts,
    }, { returning: true });
    if (!claim.ok) { bump(summary.skipped, claim.code === '23505' ? 'alreadySent' : 'notSaved'); continue; }
    const rowId = claim.rows[0]?.id;
    if (rowId === undefined) { bump(summary.skipped, 'notSaved'); continue; }
    claimed.push({ ...p, rowId, devices: allowed });
  }
  if (!claimed.length) return;
  const info = KIND_INFO[kind];
  const note = await db.insert<{ id: number }>(env, 'notifications', {
    at: new Date(now).toISOString(), kind, title: info.label, body: `${claimed.length} ${claimed.length === 1 ? 'person' : 'people'}, one message each`, link: '/',
    audience: { label: `Automatic · ${info.label}`, auto: kind }, status: 'sending', sent_by: 'auto', created_by: 'auto',
  }, { returning: true });
  const notificationId = note.ok ? note.rows[0]?.id ?? null : null;
  summary.notificationId = notificationId;
  if (notificationId != null) {
    const ids = claimed.map((c) => c.rowId);
    for (let i = 0; i < ids.length; i += 200) await db.update(env, 'outreach', q().in('id', ids.slice(i, i + 200).map(String)), { notification_id: notificationId });
  }
  const total = emptyReport();
  for (const c of claimed) {
    const report = await fanOut(env, c.devices, { ...c.msg, id: notificationId });
    addReport(total, report);
    const sent = report.web.sent + report.fcm.sent;
    summary.people += 1;
    summary.sent += sent;
    await db.update(env, 'outreach', q().eq('id', String(c.rowId)), { devices: c.devices.length, sent });
  }
  if (notificationId != null) await recordReceipt(env, notificationId, total, new Date(now).toISOString());
  await audit({ env, actor: 'auto' }, { action: 'outreach-send', summary: `${info.label.toLowerCase()} sent to ${claimed.length} ${claimed.length === 1 ? 'person' : 'people'}`, target: notificationId != null ? String(notificationId) : undefined, after: { people: claimed.length, web: total.web.sent, fcm: total.fcm.sent } });
}

const fresh = (): KindSummary => ({ candidates: 0, due: 0, people: 0, sent: 0, skipped: {} });

/** The rows a candidate function answered, or an error naming it (the database may be older than version 18). */
function rowsOf<T>(fn: string, r: Awaited<ReturnType<typeof db.rpc<unknown>>>, parse: (v: unknown) => T[]): T[] {
  if (!r.ok) throw new Error(`${fn} unreadable (${r.error}${r.code ? ` ${r.code}` : ''})`);
  return parse(r.value);
}
const RPC = { timeoutMs: 60_000 };

async function runRecap(env: PushEnv & DbEnv, rules: PushRules, now: number): Promise<KindSummary> {
  const s = fresh();
  const cands = rowsOf('outreach_recap', await db.rpc<unknown>(env, 'outreach_recap', { p_since: new Date(now - 7 * DAY_MS).toISOString(), p_min_seconds: RECAP_MIN_SECONDS }, RPC), asRecaps);
  s.candidates = cands.length;
  const planned: Planned[] = [];
  for (const c of cands) {
    const week = recapWeek(now, c.tzOffset);
    if (!week) { bump(s.skipped, 'notTheirEveningYet'); continue; }
    s.due += 1;
    if (planned.length >= PER_RUN.recap) { bump(s.skipped, 'nextRun'); continue; }
    planned.push({ account: c.id, key: `recap:${week}:${c.id}`, msg: recapMessage(c), facts: { seconds: c.seconds, plays: c.plays, days: c.days, topArtist: c.topArtist, topSong: c.topSong, topSongId: c.topSongId } });
  }
  await deliver(env, 'recap', planned, rules, now, s);
  return s;
}

async function runWinback(env: PushEnv & DbEnv, rules: PushRules, now: number, cat: Catalogue): Promise<KindSummary> {
  const s = fresh();
  const cands = rowsOf('outreach_winback', await db.rpc<unknown>(env, 'outreach_winback', { p_quiet_days: WINBACK_QUIET_DAYS, p_limit: 300 }, RPC), asWinbacks);
  s.candidates = cands.length;
  const songs = new Map<string, Promise<CatalogCandidate | null>>();
  const errors = { n: 0 };
  const planned: Planned[] = [];
  for (const c of cands) {
    if (c.unanswered >= WINBACK_MAX_UNANSWERED) { bump(s.skipped, 'threeUnanswered'); continue; }
    if (c.lastWinbackAt && now - Date.parse(c.lastWinbackAt) < WINBACK_GAP_DAYS * DAY_MS) { bump(s.skipped, 'nudgedThisWeek'); continue; }
    if (!daytime(now, c.tzOffset)) { bump(s.skipped, 'notTheirDaytime'); continue; }
    s.due += 1;
    if (planned.length >= PER_RUN.winback) { bump(s.skipped, 'nextRun'); continue; }
    let song: CatalogCandidate | null = null;
    if (c.topArtist) {
      let p = songs.get(c.topArtist);
      if (!p) { p = recentSongBy(cat, c.topArtist, errors); songs.set(c.topArtist, p); }
      song = await p;
    }
    planned.push({ account: c.id, key: `winback:${c.id}:${istDate(now)}`, msg: winbackMessage(c, song), facts: { topArtist: c.topArtist, lastActive: c.lastActive, unanswered: c.unanswered, songIds: song ? [song.id] : [], songTitle: song?.title ?? null } });
  }
  if (errors.n) s.note = `the catalogue failed ${errors.n} ${errors.n === 1 ? 'time' : 'times'}; those nudges name no song`;
  await deliver(env, 'winback', planned, rules, now, s);
  return s;
}

/** New songs: the catalogue's new-release feeds for the languages, then a search per popular artist, fresh ones only. */
async function freshReleases(cat: Catalogue, languages: string[], artists: string[], now: number, s: KindSummary): Promise<CatalogCandidate[]> {
  const pool = new Map<string, CatalogCandidate>();
  const add = (songs: CatalogCandidate[]): void => { for (const song of songs) if (isFresh(song, now) && !pool.has(song.id)) pool.set(song.id, song); };
  let down = false;
  for (const lang of languages.slice(0, 8)) {
    try { add(await cat.newReleases(lang, 50)); } catch (e) { if (e instanceof CatalogUnavailable) { down = true; break; } }
  }
  if (!down) {
    let failures = 0;
    for (const artist of artists.slice(0, 40)) {
      if (failures >= 3) break;
      try { add((await cat.search(artist, 15)).filter((song) => byArtist(song, artist))); } catch { failures += 1; }
    }
    if (failures) s.note = `the catalogue failed ${failures} ${failures === 1 ? 'search' : 'searches'}`;
  } else s.note = 'the catalogue was down; nothing sent';
  return [...pool.values()];
}

async function runRelease(env: PushEnv & DbEnv, rules: PushRules, now: number, cat: Catalogue): Promise<KindSummary> {
  const s = fresh();
  const cands = rowsOf('outreach_release_people', await db.rpc<unknown>(env, 'outreach_release_people', { p_limit: 500 }, RPC), asReleases);
  s.candidates = cands.length;
  const today = istDate(now);
  const due: ReleaseCandidate[] = [];
  for (const c of cands) {
    if (c.lastReleaseAt && istDate(Date.parse(c.lastReleaseAt)) === today) { bump(s.skipped, 'alreadyToday'); continue; }
    if (!daytime(now, c.tzOffset)) { bump(s.skipped, 'notTheirDaytime'); continue; }
    if (!c.artists.length) { bump(s.skipped, 'noArtists'); continue; }
    due.push(c);
  }
  s.due = due.length;
  if (!due.length) return s;
  const langCount = new Map<string, number>();
  const artistCount = new Map<string, number>();
  for (const c of due) {
    for (const l of c.languages) langCount.set(l, (langCount.get(l) ?? 0) + 1);
    for (const a of c.artists) artistCount.set(a, (artistCount.get(a) ?? 0) + 1);
  }
  const byCount = (m: Map<string, number>): string[] => [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([k]) => k);
  const songs = await freshReleases(cat, byCount(langCount), byCount(artistCount), now, s);
  s.skipped.freshSongsFound = songs.length;
  const planned: Planned[] = [];
  for (const c of due) {
    const mine = songs.filter((song) => !c.sentSongs.includes(song.id) && c.artists.some((a) => byArtist(song, a))).slice(0, 3);
    if (!mine.length) { bump(s.skipped, 'nothingNewForThem'); continue; }
    if (planned.length >= PER_RUN.release) { bump(s.skipped, 'nextRun'); continue; }
    planned.push({ account: c.id, key: `release:${c.id}:${today}`, msg: releaseMessage(mine), facts: { songIds: mine.map((x) => x.id), titles: mine.map((x) => x.title), artists: mine.map((x) => x.primaryArtists[0] ?? null) } });
  }
  await deliver(env, 'release', planned, rules, now, s);
  return s;
}

const failed = (e: unknown): { error: string } => ({ error: (e instanceof Error ? e.message : String(e)).slice(0, 200) });

/** The job: every kind that is on and allowed, each in turn. Never throws; the summary says what happened. */
export async function runOutreach(env: PushEnv & DbEnv, now = Date.now(), cat: Catalogue = CATALOGUE): Promise<Record<string, unknown>> {
  if (!dbConfigured(env)) return { skipped: 'no database' };
  const s = outreachSettingsOf(await setting(env, 'outreach'));
  const rules = await pushRules(env);
  const quiet = quietNow(rules, now);
  if (quiet.quiet) return { waiting: 'quiet_hours', until: quiet.until };
  const out: Record<string, unknown> = {};
  out.recap = !s.recap ? 'off' : await runRecap(env, rules, now).catch(failed);
  out.winback = !s.winback ? 'off' : !kindAllowed(rules, 'reminders') ? 'off (Reminders are off in Notification Rules)' : await runWinback(env, rules, now, cat).catch(failed);
  out.release = !s.release ? 'off' : !kindAllowed(rules, 'releases') ? 'off (New releases are off in Notification Rules)' : await runRelease(env, rules, now, cat).catch(failed);
  return out;
}

/** When the job last ran and what it did, for the console. */
export async function lastOutreachRun(env: DbEnv): Promise<{ at: string; ok: boolean | null; summary: unknown } | null> {
  const r = await db.select<{ started_at: string; ok: boolean | null; summary: unknown }>(env, 'job_runs', q().eq('job', 'outreach').select('started_at,ok,summary').order('started_at', 'desc').limit(1));
  const row = r.ok ? r.rows[0] : undefined;
  return row ? { at: row.started_at, ok: row.ok, summary: row.summary } : null;
}

// ── The console's "Send me a preview" ────────────────────────────────

export type PreviewResult = { ok: true; devices: number; sent: number; message: Message; real: boolean } | { ok: false; error: 'no_devices' | 'db_unavailable' };

/**
 * The real message of one kind, to the admin's own phones (the devices of the
 * accounts with this Google email), from their own listening when there is
 * any, else a sample. Marked [Preview]; it leaves no outreach row and does not
 * count toward the per-person cap.
 */
export async function sendOutreachPreview(env: PushEnv & DbEnv, kind: OutreachKind, email: string, now = Date.now(), cat: Catalogue = CATALOGUE): Promise<PreviewResult> {
  const devices = await devicesOfEmail(env, email);
  if (!devices.ok) return { ok: false, error: 'db_unavailable' };
  if (!devices.rows.length) return { ok: false, error: 'no_devices' };
  const accounts = [...new Set(devices.rows.map((d) => d.account_id).filter((x): x is string => !!x))];
  const recaps = await db.rpc<unknown>(env, 'outreach_recap', { p_since: new Date(now - 7 * DAY_MS).toISOString(), p_min_seconds: 0, p_accounts: accounts }, { timeoutMs: 30_000 });
  const mine = recaps.ok ? asRecaps(recaps.value)[0] ?? null : null;
  const artist = mine?.topArtist ?? SAMPLE_ARTIST;
  const errors = { n: 0 };
  let message: Message;
  if (kind === 'recap') {
    message = mine ? recapMessage(mine) : recapMessage({ seconds: 3 * 3600 + 12 * 60, topArtist: SAMPLE_ARTIST, topSong: 'Kanne Kanne' });
  } else if (kind === 'winback') {
    message = winbackMessage({ name: mine?.name ?? null, topArtist: artist }, await recentSongBy(cat, artist, errors));
  } else {
    const song = await recentSongBy(cat, artist, errors);
    message = song ? releaseMessage([song]) : { title: `New from ${artist}`, body: `“A new song” is out now. Tap to listen.`, link: '/discover' };
  }
  message = { ...message, title: `[Preview] ${message.title}` };
  const report = await fanOut(env, devices.rows, message, { countTowardCap: false });
  return { ok: true, devices: devices.rows.length, sent: report.web.sent + report.fcm.sent, message, real: !!mine };
}
