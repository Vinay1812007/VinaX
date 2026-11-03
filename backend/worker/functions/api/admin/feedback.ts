/**
 * GET  /api/admin/feedback?status=new|read|resolved|all&kind=&platform=&days=&from=&to=&limit=&offset=
 *        → { configured, total, counts: { new, read, resolved, all }, rows }
 *   Each row: { id, at, kind, message, status, note, platform, appVersion, country, city, resolvedAt,
 *               name, user: { id, name, email, picture } | null, canReply }
 *   (the device id is never returned). Counts follow the kind/platform/date filters.
 * POST /api/admin/feedback
 *        { action: 'status', id, status, note? }
 *        { action: 'delete', id } | { action: 'delete_resolved' }
 *        { action: 'reply', id, title?, message }   a notification to the sender's signed-in devices
 *            → { ok, sent, devices } | 409 { error: 'no_account' | 'no_device' } | 400 push_not_configured
 */
import { adminJson, badRequest, dbFailure } from '../../_lib/admin';
import { adminGet, adminPost, camel, idOf, paging } from '../../_lib/adminRoute';
import { db, q, firstFailure, since, DAY_MS, type DbEnv, type Query } from '../../_lib/db';
import { clip, intIn, PLATFORMS } from '../../_lib/edge';
import { fcmConfigured, type FcmEnv } from '../../_lib/fcm';
import { fanOut, recordReceipt, type DeviceRow, type PushEnv } from '../../_lib/pushSend';
import { pushConfigured, type VapidEnv } from '../../_lib/webpush';

const STATUSES = ['new', 'read', 'resolved'] as const;
type Status = (typeof STATUSES)[number];
const KINDS = ['bug', 'idea', 'content', 'other'] as const;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** kind / platform / date filters (everything but the status tab). */
function base(url: URL): Query {
  const query = q();
  const kind = url.searchParams.get('kind');
  if (kind && (KINDS as readonly string[]).includes(kind)) query.eq('kind', kind);
  const platform = url.searchParams.get('platform');
  if (platform && (PLATFORMS as readonly string[]).includes(platform)) query.eq('platform', platform);
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');
  if (from && DAY_RE.test(from) && to && DAY_RE.test(to)) {
    // Calendar days in India.
    query.gte('at', new Date(`${from}T00:00:00+05:30`).toISOString());
    query.lt('at', new Date(new Date(`${to}T00:00:00+05:30`).getTime() + DAY_MS).toISOString());
  } else {
    const days = intIn(url.searchParams.get('days'), 1, 365);
    if (days) query.gte('at', since(days * DAY_MS));
  }
  return query;
}
function filters(url: URL): Query {
  const query = base(url);
  const status = url.searchParams.get('status') ?? 'new';
  if (status !== 'all' && (STATUSES as readonly string[]).includes(status)) query.eq('status', status);
  return query;
}

interface Person { id: string; name: string | null; email: string | null; picture: string | null }

/** listener id → the Google account it belongs to (when it has one). */
async function peopleOf(env: DbEnv, listenerIds: string[]): Promise<Map<string, Person>> {
  const out = new Map<string, Person>();
  const ids = [...new Set(listenerIds.filter(Boolean))].slice(0, 200);
  if (!ids.length) return out;
  const [devices, direct] = await Promise.all([
    db.select<{ id: string; account_id: string | null }>(env, 'listeners', q().in('id', ids).select('id,account_id')),
    db.select<{ id: string; listener_id: string | null }>(env, 'accounts', q().in('listener_id', ids).select('id,listener_id')),
  ]);
  const acctOf = new Map<string, string>();
  if (direct.ok) for (const a of direct.rows) if (a.listener_id) acctOf.set(a.listener_id, a.id);
  if (devices.ok) for (const d of devices.rows) if (d.account_id) acctOf.set(d.id, d.account_id);
  const accts = [...new Set(acctOf.values())];
  if (!accts.length) return out;
  const rows = await db.select<Person>(env, 'accounts', q().in('id', accts).select('id,name,email,picture'));
  const byId = new Map<string, Person>(rows.ok ? rows.rows.map((r) => [r.id, r]) : []);
  for (const [l, a] of acctOf) { const p = byId.get(a); if (p) out.set(l, p); }
  return out;
}

/** Active push devices of these accounts. */
async function devicesOf(env: DbEnv, accounts: string[]): Promise<{ ok: boolean; rows: Array<DeviceRow & { account_id: string }> }> {
  if (!accounts.length) return { ok: true, rows: [] };
  const r = await db.select<DeviceRow & { account_id: string }>(env, 'push_devices', q().in('account_id', accounts).eq('active', 'true').select('id,channel,target,p256dh,auth,account_id').limit(500));
  return { ok: r.ok, rows: r.ok ? r.rows : [] };
}

export const onRequestGet = adminGet(async ({ env, url }) => {
  const { limit, offset } = paging(url, 50, 200);
  const [rows, total, nNew, nRead, nResolved] = await Promise.all([
    db.select<Record<string, unknown>>(env, 'feedback', filters(url).select('*').order('at', 'desc').limit(limit).offset(offset)),
    db.count(env, 'feedback', filters(url)),
    db.count(env, 'feedback', base(url).eq('status', 'new')),
    db.count(env, 'feedback', base(url).eq('status', 'read')),
    db.count(env, 'feedback', base(url).eq('status', 'resolved')),
  ]);
  const failed = firstFailure(rows, total, nNew, nRead, nResolved);
  if (failed) return dbFailure(failed);
  if (!rows.ok || !total.ok || !nNew.ok || !nRead.ok || !nResolved.ok) return adminJson({ configured: true, error: 'db_unavailable' }, 502);

  const people = await peopleOf(env, rows.rows.map((r) => String(r.listener_id ?? '')));
  const accounts = [...new Set([...people.values()].map((p) => p.id))];
  const devs = await devicesOf(env, accounts);
  const reachable = new Set(devs.rows.map((d) => d.account_id));
  return adminJson({
    configured: true,
    total: total.value,
    limit,
    offset,
    counts: { new: nNew.value, read: nRead.value, resolved: nResolved.value, all: nNew.value + nRead.value + nResolved.value },
    rows: rows.rows.map((r) => {
      const person = people.get(String(r.listener_id ?? '')) ?? null;
      const { listenerId: _drop, ...rest } = camel(r);
      void _drop;
      return { ...rest, user: person, canReply: !!person && reachable.has(person.id) };
    }),
  });
});

export const onRequestPost = adminPost(async ({ env, body, audit, me }) => {
  if (body.action === 'status') {
    const id = idOf(body.id);
    const status = body.status as Status;
    if (!id || !STATUSES.includes(status)) return badRequest();
    const patch: Record<string, unknown> = { status, resolved_at: status === 'resolved' ? new Date().toISOString() : null };
    if ('note' in body) patch.note = clip(body.note, 1000);
    const r = await db.update<Record<string, unknown>>(env, 'feedback', q().eq('id', id), patch, { returning: true });
    if (!r.ok) return dbFailure(r);
    if (!r.rows.length) return adminJson({ error: 'not_found' }, 404);
    await audit({ action: 'feedback-status', summary: `feedback #${id} → ${status}`, target: String(id), after: patch });
    const { listenerId: _drop, ...row } = camel(r.rows[0]);
    void _drop;
    return adminJson({ ok: true, row });
  }
  if (body.action === 'delete') {
    const id = idOf(body.id);
    if (!id) return badRequest();
    const r = await db.remove<{ id: number; message: string }>(env, 'feedback', q().eq('id', id).select('id,message'), { returning: true });
    if (!r.ok) return dbFailure(r);
    if (!r.rows.length) return adminJson({ error: 'not_found' }, 404);
    await audit({ action: 'feedback-delete', summary: `deleted feedback #${id}`, target: String(id), before: r.rows[0] });
    return adminJson({ ok: true, deleted: 1 });
  }
  if (body.action === 'delete_resolved') {
    const r = await db.remove<{ id: number }>(env, 'feedback', q().eq('status', 'resolved').select('id'), { returning: true });
    if (!r.ok) return dbFailure(r);
    await audit({ action: 'feedback-delete-resolved', summary: `deleted ${r.rows.length} resolved feedback message${r.rows.length === 1 ? '' : 's'}` });
    return adminJson({ ok: true, deleted: r.rows.length });
  }
  if (body.action === 'reply') {
    const id = idOf(body.id);
    const text = clip(body.message, 300);
    const title = clip(body.title, 120) ?? 'Thanks for your feedback';
    if (!id || !text) return badRequest('message_required');
    const e = env as unknown as PushEnv;
    if (!pushConfigured(e as VapidEnv) && !fcmConfigured(e as FcmEnv)) return adminJson({ error: 'push_not_configured' }, 400);
    const fb = await db.one<{ id: number; listener_id: string | null; note: string | null; status: string }>(env, 'feedback', q().eq('id', id).select('id,listener_id,note,status'));
    if (!fb.ok) return dbFailure(fb);
    if (!fb.value) return adminJson({ error: 'not_found' }, 404);
    const person = fb.value.listener_id ? (await peopleOf(env, [fb.value.listener_id])).get(fb.value.listener_id) ?? null : null;
    if (!person) return adminJson({ error: 'no_account', message: 'This message was sent by someone who was not signed in, so there is nobody to reply to.' }, 409);
    const devs = await devicesOf(env, [person.id]);
    if (!devs.ok) return adminJson({ error: 'db_unavailable' }, 502);
    if (!devs.rows.length) return adminJson({ error: 'no_device', message: 'This person has not turned on notifications on any phone or browser.' }, 409);
    // The same reply to the same message twice (a double-click) is refused.
    const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${title}\n${text}`)))].slice(0, 6).map((b) => b.toString(16).padStart(2, '0')).join('');
    const made = await db.insert<{ id: number }>(env, 'notifications', {
      kind: 'announcement', title, body: text, link: '/', status: 'sent', created_by: me.email, sent_by: me.email, dedupe_key: `fb-reply:${id}:${digest}`,
      audience: { label: `reply to feedback #${id}`, account: person.id, feedback: id },
      web_total: devs.rows.filter((d) => d.channel === 'web').length, fcm_total: devs.rows.filter((d) => d.channel === 'fcm').length,
    }, { returning: true });
    if (!made.ok && made.error === 'conflict') return adminJson({ error: 'duplicate', message: 'This reply was already sent.' }, 409);
    if (!made.ok) return dbFailure(made);
    // The row id travels with the push so a tap is counted on History.
    const msg = { title, body: text, link: '/', id: made.rows[0]?.id };
    const report = await fanOut(e, devs.rows, msg);
    if (made.rows[0]?.id != null) await recordReceipt(env, made.rows[0].id, report);
    const sent = report.web.sent + report.fcm.sent;
    const note = [fb.value.note, `Replied by notification ${new Date().toISOString().slice(0, 10)}: ${text}`].filter(Boolean).join('\n').slice(0, 1000);
    await db.update(env, 'feedback', q().eq('id', id), { note, ...(fb.value.status === 'new' ? { status: 'read' } : {}) });
    await audit({ action: 'feedback-reply', summary: `replied to feedback #${id} by notification (${sent} of ${devs.rows.length} devices)`, target: String(id), after: { title, body: text } });
    return adminJson({ ok: true, sent, devices: devs.rows.length });
  }
  return badRequest('unknown_action');
});
