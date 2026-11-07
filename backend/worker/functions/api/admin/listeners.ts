/**
 * Console rebuild — the console's Users page. Signed-in (Google) people only:
 * anonymous devices never leave this route.
 *
 * GET  /api/admin/listeners?q=&platform=&active=&joined=&joinedFrom=&joinedTo=
 *        &country=&region=&city=&version=&language=&sort=&limit=&offset=&ids=
 *        → { configured, total, limit, offset, rows, counts }
 *        rows: [{ id (Google account id), name, email, picture, platform, appVersion,
 *                 country, region, city, nowPlaying, isPlaying, joined, lastSeen,
 *                 devices, plays, language, blocked, os, browser, device, listen30d, listenToday }]
 *        counts: { users, new7d, activeToday, byPlatform: { android, web, ios },
 *                  byDevice: { 'android-app': n, 'macos-web': n, … }, listenToday, listenersToday }
 *        platform: android | web | ios, or a device key (DEVICES below, schema 13)
 *        sort: last_active (default) | joined | plays | listening | name
 *        listen30d / listenToday are seconds of listening (schema 13's listen_time)
 *        tag: only people carrying this owner tag (schema 15); rows carry `tags`
 * GET  /api/admin/listeners?filters=1 → { configured, places, versions, languages, tags }
 * GET  /api/admin/listeners?account=<id> → { configured, profile }   (user_profile)
 *        profile.extras (schema 15, null before): { hours, skips, topSkipped,
 *        topReplayed, searches, notes: { tags, note, updatedAt, updatedBy } | null }
 * GET  /api/admin/listeners?view=top&days=1|7|30 → { configured, days, since, people, total, rows }
 *        Top listeners (schema 14): ranked by listening seconds in the window
 *        (1 = today since midnight India time); rows: { id, name, email, picture,
 *        seconds, days, plays, topArtist, device, os, browser, platform, appVersion, place…, lastSeen }
 * GET  /api/admin/listeners?view=at-risk&quiet=7 → { configured, quiet, rule, total, rows }
 *        At risk (schema 14): quiet for `quiet` days (1–60) after listening ≥ 2 h or
 *        on ≥ 5 days in the 30 days before; rows add lastActive.
 * POST /api/admin/listeners
 *        { action: 'block', account, reason? }       the person cannot sign in again
 *        { action: 'unblock', account }
 *        { action: 'signout_device', account, device } that device's session stops working
 *        { action: 'delete', account, reason }       owner only: everything about the person
 *        { action: 'notes', account, tags?, note? }   the owner's private tags and note (schema 15)
 */
import { forgetBlocked } from '../../_lib/googleAuth';
import { removeAccountFiles } from '../../_lib/ai/attachments';
import { adminJson, badRequest, dbFailure } from '../../_lib/admin';
import { adminGet, adminPost, paging } from '../../_lib/adminRoute';
import { db, q } from '../../_lib/db';
import { clip, intIn, PLATFORMS } from '../../_lib/edge';

const ID_RE = /^[a-z]_[a-f0-9]{16,64}$/;
const SUB_RE = /^\d{1,40}$/;
/** Schema 15: an owner tag — lower case letters, digits, spaces and dashes, 1–24 characters. */
const TAG_RE = /^[a-z0-9][a-z0-9 _-]{0,23}$/;
const MAX_TAGS = 12;
/** The account ids `admin_users` can never match: a tag nobody carries filters to nothing. */
const NOBODY = ['0'];
const SORTS = ['last_active', 'joined', 'plays', 'listening', 'name'] as const;
/** Schema 13: the kinds of device the Users page shows and filters by. */
export const DEVICES = ['android-app', 'ios-app', 'android-web', 'ios-web', 'ipados-web', 'macos-web', 'windows-web', 'linux-web', 'chromeos-web', 'other-web'] as const;

interface UserRow {
  id: string; name: string | null; email: string | null; picture: string | null; platform: string; app_version: string | null;
  country: string | null; region: string | null; city: string | null; now_playing: unknown; is_playing: boolean;
  joined: string; last_seen: string; devices: number; plays: number; language: string | null; blocked_at: string | null;
  os?: string | null; browser?: string | null; device?: string | null; listen30d?: number; listen_today?: number;
}
interface NoteRow { account_id: string; tags: string[] | null; note?: string | null }
interface UsersAnswer { total: number; rows: UserRow[]; counts: Record<string, unknown> }

const shape = (r: UserRow, tags: Map<string, string[]>) => ({
  id: r.id, name: r.name, email: r.email, picture: r.picture, platform: r.platform, appVersion: r.app_version,
  country: r.country, region: r.region, city: r.city, nowPlaying: r.now_playing ?? null, isPlaying: !!r.is_playing,
  joined: r.joined, lastSeen: r.last_seen, devices: Number(r.devices) || 0, plays: Number(r.plays) || 0,
  language: r.language, blocked: !!r.blocked_at,
  os: r.os ?? null, browser: r.browser ?? null, device: r.device ?? null,
  listen30d: Number(r.listen30d) || 0, listenToday: Number(r.listen_today) || 0,
  tags: tags.get(r.id) ?? [],
});

/** Owner tags typed in the console: trimmed, lower case, valid, unique, at most 12. Null when the input is not a list. */
export function cleanTags(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null;
  const out: string[] = [];
  for (const t of raw) {
    if (typeof t !== 'string') continue;
    const v = t.trim().toLowerCase().replace(/\s+/g, ' ');
    if (TAG_RE.test(v) && !out.includes(v)) out.push(v);
  }
  return out.slice(0, MAX_TAGS);
}

/** The tag in `?tag=`, or null. */
export function tagParam(url: URL): string | null {
  const v = (url.searchParams.get('tag') ?? '').trim().toLowerCase();
  return TAG_RE.test(v) ? v : null;
}

const dayIso = (v: string | null): string | null => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)) ? new Date(`${v}T00:00:00+05:30`).toISOString() : null);

/** The admin_users arguments from the query string (only valid values pass). */
export function userArgs(url: URL): Record<string, unknown> {
  const p = url.searchParams;
  const { limit, offset } = paging(url, 50, 200);
  const platform = p.get('platform');
  const sort = p.get('sort');
  const rawCountry = p.get('country');
  const country = rawCountry && /^[A-Za-z]{2}$/.test(rawCountry) ? rawCountry.toUpperCase() : null;
  const to = dayIso(p.get('joinedTo'));
  const ids = (p.get('ids') ?? '').split(',').map((s) => s.trim()).filter((s) => SUB_RE.test(s)).slice(0, 200);
  return {
    p_q: clip(p.get('q'), 80) ?? null,
    p_platform: platform && ((PLATFORMS as readonly string[]).includes(platform) || (DEVICES as readonly string[]).includes(platform)) ? platform : null,
    p_active_days: intIn(p.get('active'), 1, 365) ?? null,
    p_joined_days: intIn(p.get('joined'), 1, 365) ?? null,
    p_joined_from: dayIso(p.get('joinedFrom')),
    // "to" is inclusive in the console: the day after, at midnight India time.
    p_joined_to: to ? new Date(Date.parse(to) + 86_400_000).toISOString() : null,
    p_country: country,
    p_region: clip(p.get('region'), 80) ?? null,
    p_city: clip(p.get('city'), 80) ?? null,
    p_version: clip(p.get('version'), 40) ?? null,
    p_language: clip(p.get('language'), 24)?.toLowerCase() ?? null,
    p_ids: ids.length ? ids : null,
    p_sort: sort && (SORTS as readonly string[]).includes(sort) ? sort : 'last_active',
    p_limit: limit,
    p_offset: offset,
  };
}

interface SignInRow { at: string; ip: string | null; browser: string | null; platform: string | null; app_version: string | null; country: string | null; region: string | null; city: string | null; new_device: boolean; signup: boolean }

export const onRequestGet = adminGet(async ({ env, url }) => {
  const view = url.searchParams.get('view');
  if (view === 'top') {
    const days = intIn(url.searchParams.get('days'), 1, 90) ?? 7;
    const r = await db.rpc<Record<string, unknown>>(env, 'stats_top_listeners', { p_days: days, p_limit: 100 });
    if (!r.ok) return dbFailure(r);
    const v = r.value ?? {};
    return adminJson({ configured: true, days, since: v.since ?? null, people: Number(v.people) || 0, total: Number(v.total) || 0, rows: Array.isArray(v.rows) ? v.rows : [] });
  }
  if (view === 'at-risk') {
    const quiet = intIn(url.searchParams.get('quiet'), 1, 60) ?? 7;
    const r = await db.rpc<Record<string, unknown>>(env, 'stats_at_risk', { p_quiet_days: quiet, p_limit: 200 });
    if (!r.ok) return dbFailure(r);
    const v = r.value ?? {};
    return adminJson({ configured: true, quiet, rule: v.rule ?? null, total: Number(v.total) || 0, rows: Array.isArray(v.rows) ? v.rows : [] });
  }
  if (view !== null) return badRequest('unknown_view', { views: ['top', 'at-risk'] });
  if (url.searchParams.get('filters') === '1') {
    const [r, t] = await Promise.all([
      db.rpc<{ places?: unknown[]; versions?: unknown[]; languages?: unknown[] }>(env, 'admin_user_filters'),
      // Schema 15: the owner's tags. Before the update: none.
      db.rpc<unknown[]>(env, 'owner_tags'),
    ]);
    if (!r.ok) return dbFailure(r);
    const v = r.value ?? {};
    return adminJson({ configured: true, places: v.places ?? [], versions: v.versions ?? [], languages: v.languages ?? [], tags: t.ok && Array.isArray(t.value) ? t.value : [] });
  }
  const account = url.searchParams.get('account');
  if (account !== null) {
    if (!SUB_RE.test(account)) return badRequest('bad_id');
    const [r, s, x] = await Promise.all([
      db.rpc<Record<string, unknown> | null>(env, 'user_profile', { p_account: account }),
      // Schema 12: the last 100 sign-ins. Before the update the table is missing: an empty list.
      db.select<SignInRow>(env, 'sign_ins', q().eq('account_id', account).select('at,ip,browser,platform,app_version,country,region,city,new_device,signup').order('at', 'desc').limit(100)),
      // Schema 15: hours, skips, replays, searches, the owner's notes. Before the update: null.
      db.rpc<Record<string, unknown> | null>(env, 'profile_extras', { p_account: account }),
    ]);
    if (!r.ok) return dbFailure(r);
    if (!r.value || typeof r.value !== 'object') return adminJson({ configured: true, error: 'not_found' }, 404);
    const signIns = s.ok ? s.rows.map((x) => ({ at: x.at, ip: x.ip, browser: x.browser, platform: x.platform, appVersion: x.app_version, country: x.country, region: x.region, city: x.city, newDevice: x.new_device, signup: x.signup })) : [];
    const extras = x.ok && x.value && typeof x.value === 'object' ? x.value : null;
    return adminJson({ configured: true, profile: { ...r.value, signIns, extras } });
  }
  const args = userArgs(url);
  // Schema 15: a tag filter narrows the people to the accounts carrying it
  // (with ?ids= as well, to the ones on both lists).
  const tag = tagParam(url);
  if (tag) {
    const t = await db.select<NoteRow>(env, 'owner_notes', q().raw(`tags=cs.${encodeURIComponent(`{"${tag}"}`)}`).select('account_id').limit(200));
    if (!t.ok) return dbFailure(t);
    const tagged = t.rows.map((x) => x.account_id);
    const ids = Array.isArray(args.p_ids) ? tagged.filter((id) => (args.p_ids as string[]).includes(id)) : tagged;
    args.p_ids = ids.length ? ids : NOBODY;
  }
  const r = await db.rpc<UsersAnswer>(env, 'admin_users', args);
  if (!r.ok) return dbFailure(r);
  const v = r.value ?? { total: 0, rows: [], counts: {} };
  const rows = Array.isArray(v.rows) ? v.rows : [];
  const tags = new Map<string, string[]>();
  if (rows.length) {
    // Before the update the table is missing: nobody has tags.
    const n = await db.select<NoteRow>(env, 'owner_notes', q().in('account_id', rows.map((x) => x.id)).select('account_id,tags'));
    if (n.ok) for (const x of n.rows) if (x.tags?.length) tags.set(x.account_id, x.tags);
  }
  return adminJson({
    configured: true,
    total: Number(v.total) || 0,
    limit: args.p_limit,
    offset: args.p_offset,
    rows: rows.map((x) => shape(x, tags)),
    counts: v.counts ?? {},
  });
});

/** Every device row that belongs to an account (its own link, or the account's latest device). */
async function devicesOf(env: Parameters<typeof db.select>[0], account: string): Promise<string[] | null> {
  const [linked, acct] = await Promise.all([
    db.select<{ id: string }>(env, 'listeners', q().eq('account_id', account).select('id').limit(100)),
    db.one<{ listener_id: string | null }>(env, 'accounts', q().eq('id', account).select('listener_id')),
  ]);
  if (!linked.ok || !acct.ok) return null;
  const ids = new Set(linked.rows.map((r) => r.id));
  if (acct.value?.listener_id) ids.add(acct.value.listener_id);
  return [...ids];
}

export const onRequestPost = adminPost(async ({ env, body, audit, me }) => {
  const account = typeof body.account === 'string' ? body.account : '';
  if (!SUB_RE.test(account)) return badRequest('bad_id');
  const who = await db.one<{ id: string; email: string | null; name: string | null; listener_id: string | null; blocked_at: string | null }>(env, 'accounts', q().eq('id', account).select('id,email,name,listener_id,blocked_at'));
  if (!who.ok) return dbFailure(who);
  if (!who.value) return adminJson({ error: 'not_found' }, 404);
  const label = who.value.email ?? who.value.name ?? `account ${account}`;

  if (body.action === 'block' || body.action === 'unblock') {
    const blocked_at = body.action === 'block' ? new Date().toISOString() : null;
    const r = await db.update(env, 'accounts', q().eq('id', account), { blocked_at }, { returning: true });
    if (!r.ok) return dbFailure(r);
    forgetBlocked(account);
    // A blocked person gets no more notifications: their phones leave the
    // audience (they link again by themselves after an unblock and sign-in).
    if (blocked_at) await db.update(env, 'push_devices', q().eq('account_id', account), { account_id: null });
    const reason = clip(body.reason, 200);
    await audit({ action: body.action === 'block' ? 'user-block' : 'user-unblock', summary: `${body.action === 'block' ? 'blocked' : 'unblocked'} ${label}${reason ? ` — ${reason}` : ''}`, target: account, before: { blocked: !!who.value.blocked_at }, after: { blocked: !!blocked_at } });
    return adminJson({ ok: true, blocked: !!blocked_at });
  }

  if (body.action === 'notes') {
    const tags = body.tags === undefined ? undefined : cleanTags(body.tags);
    if (tags === null) return badRequest('bad_tags');
    if (body.note !== undefined && body.note !== null && typeof body.note !== 'string') return badRequest('bad_note');
    const note = typeof body.note === 'string' ? body.note.trim().slice(0, 2000) || null : body.note === null ? null : undefined;
    const before = await db.one<NoteRow>(env, 'owner_notes', q().eq('account_id', account).select('account_id,tags,note'));
    if (!before.ok) return dbFailure(before);
    const row = {
      account_id: account,
      tags: tags ?? before.value?.tags ?? [],
      note: note === undefined ? before.value?.note ?? null : note,
      updated_at: new Date().toISOString(),
      updated_by: me.email,
    };
    const r = await db.upsert(env, 'owner_notes', row, 'account_id');
    if (!r.ok) return dbFailure(r);
    await audit({ action: 'user-notes', summary: `updated the notes and tags on ${label}`, target: account,
      before: { tags: before.value?.tags ?? [], note: !!before.value?.note }, after: { tags: row.tags, note: !!row.note } });
    return adminJson({ ok: true, notes: { tags: row.tags, note: row.note, updatedAt: row.updated_at, updatedBy: row.updated_by } });
  }

  if (body.action === 'signout_device') {
    const device = typeof body.device === 'string' ? body.device : '';
    if (!ID_RE.test(device)) return badRequest('bad_device');
    const mine = await devicesOf(env, account);
    if (!mine) return adminJson({ configured: true, error: 'db_unavailable' }, 502);
    if (!mine.includes(device)) return adminJson({ error: 'not_found' }, 404);
    const now = new Date().toISOString();
    const r = await db.update(env, 'listeners', q().eq('id', device), { signed_out_at: now, account_id: null });
    if (!r.ok) return dbFailure(r);
    if (who.value.listener_id === device) {
      const a = await db.update(env, 'accounts', q().eq('id', account).eq('listener_id', device), { listener_id: null });
      if (!a.ok) return dbFailure(a);
    }
    await audit({ action: 'user-signout-device', summary: `signed ${label} out of one device`, target: account });
    return adminJson({ ok: true, signedOutAt: now });
  }

  if (body.action === 'delete') {
    const reason = clip(body.reason, 200) ?? 'no reason given';
    const devices = await devicesOf(env, account);
    if (!devices) return adminJson({ configured: true, error: 'db_unavailable' }, 502);
    // VinaX AI files live in Storage, not in a row that cascades: remove them first.
    await removeAccountFiles(env, account);
    const totals: Record<string, number> = {};
    const add = (v: Record<string, number> | null) => { for (const [k, n] of Object.entries(v ?? {})) totals[k] = (totals[k] ?? 0) + (Number(n) || 0); };
    for (const device of devices.length ? devices : [null]) {
      const r = await db.rpc<Record<string, number>>(env, 'delete_listener', { p_listener: device, p_account: account });
      if (!r.ok) return dbFailure(r);
      add(r.value);
    }
    await audit({ action: 'user-delete', summary: `deleted every record of ${label} — ${reason}`, target: account, after: totals });
    return adminJson({ ok: true, deleted: totals });
  }

  return badRequest('unknown_action');
}, { role: (b) => (b.action === 'delete' ? 'owner' : 'editor') });
