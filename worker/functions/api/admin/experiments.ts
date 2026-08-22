/**
 * Package E2 — admin experiments: CRUD + per-variant metrics.
 *
 * Metrics need no event tagging: the newest 14d of vinax_events (device_id,
 * type) are re-joined to variants by the SAME deterministic hash the client
 * uses. Per variant: devices, plays/device, completion %, skip % — the
 * signals the audit named (skip rate, session length proxied honestly as
 * plays per device).
 */
import { isAdmin, unauthorized, type AdminEnv } from '../../_lib/admin';
import { logAdminAudit } from '../../_lib/adminAudit';
import { sbDelete, sbSelect, sbSelectRes, sbUpdate, sbUpsert, type SupabaseEnv } from '../../_lib/supabase';
import { assignVariant, sanitizeVariants, type ExperimentConfig } from '../../_lib/experiments';

type Env = AdminEnv & SupabaseEnv;

const json = (o: unknown, status = 200): Response =>
  new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

interface ExpRow {
  key: string;
  name: string | null;
  variants: unknown;
  active: boolean | null;
  created_at: string;
}

interface EventRow {
  device_id: string | null;
  type: string | null;
}

export const onRequestGet = async (context: { request: Request; env: Env }): Promise<Response> => {
  const { request, env } = context;
  if (!isAdmin(request, env)) return unauthorized();

  // Error-aware read: a missing vinax_experiments table (migration not run)
  // must report configured:false — not masquerade as "configured, empty" (D-1).
  const sel = await sbSelectRes<ExpRow>(env, 'vinax_experiments', 'select=key,name,variants,active,created_at&order=created_at.desc.nullslast&limit=50');
  if (!sel.ok) return json({ configured: false, experiments: [] });
  const rows = sel.rows;
  if (!rows.length) return json({ configured: true, experiments: [] });

  // One events sample serves every experiment's metrics.
  const since = new Date(Date.now() - 14 * 86_400_000).toISOString();
  const events = await sbSelect<EventRow>(
    env,
    'vinax_events',
    `created_at=gte.${encodeURIComponent(since)}&type=in.(play,complete,skip)&select=device_id,type&order=created_at.desc&limit=10000`,
  ).catch(() => [] as EventRow[]);

  const experiments = rows.map((r) => {
    const exp: ExperimentConfig = { key: r.key, name: r.name, variants: sanitizeVariants(r.variants), active: r.active === true };
    // variant -> per-device tallies (assignment re-derived, never stored).
    const perVariant = new Map<string, Map<string, { plays: number; completes: number; skips: number }>>();
    for (const v of exp.variants) perVariant.set(v.name, new Map());
    if (exp.variants.length) {
      for (const e of events) {
        if (!e.device_id || e.device_id === 'admin') continue;
        const variant = assignVariant(e.device_id, { ...exp, active: true }); // metrics even while paused
        if (!variant) continue;
        const devices = perVariant.get(variant);
        if (!devices) continue;
        let t = devices.get(e.device_id);
        if (!t) {
          t = { plays: 0, completes: 0, skips: 0 };
          devices.set(e.device_id, t);
        }
        if (e.type === 'play') t.plays += 1;
        else if (e.type === 'complete') t.completes += 1;
        else if (e.type === 'skip') t.skips += 1;
      }
    }
    const metrics = exp.variants.map((v) => {
      const devices = perVariant.get(v.name) ?? new Map<string, { plays: number; completes: number; skips: number }>();
      let plays = 0;
      let completes = 0;
      let skips = 0;
      for (const t of devices.values()) {
        plays += t.plays;
        completes += t.completes;
        skips += t.skips;
      }
      const finished = completes + skips;
      return {
        variant: v.name,
        pct: v.pct,
        devices: devices.size,
        playsPerDevice: devices.size ? Math.round((plays / devices.size) * 10) / 10 : 0,
        skipRatePct: finished ? Math.round((skips / finished) * 100) : null,
      };
    });
    return { key: exp.key, name: r.name, active: exp.active, variants: exp.variants, metrics, created_at: r.created_at };
  });

  return json({ configured: true, experiments, sampledEvents: events.length });
};

export const onRequestPost = async (context: { request: Request; env: Env }): Promise<Response> => {
  const { request, env } = context;
  if (!isAdmin(request, env)) return unauthorized();
  const body = (await request.json().catch(() => null)) as
    | { action?: string; key?: string; name?: string; variants?: unknown; active?: boolean }
    | null;
  const action = typeof body?.action === 'string' ? body.action : '';
  const key = typeof body?.key === 'string' ? body.key.trim().toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 40) : '';
  if (!key) return json({ error: 'bad_request' }, 400);

  if (action === 'save') {
    const variants = sanitizeVariants(body?.variants);
    if (variants.length < 2) return json({ error: 'need_two_variants' }, 400);
    // created_at only on first insert — writing it on every save reset the
    // creation date and reshuffled the list on each edit (D-16b).
    const existing = await sbSelect<{ key: string }>(env, 'vinax_experiments', `key=eq.${encodeURIComponent(key)}&select=key&limit=1`);
    const patch = {
      key,
      name: typeof body?.name === 'string' ? body.name.slice(0, 80) : null,
      variants,
      active: body?.active === true,
      ...(existing.length ? {} : { created_at: new Date().toISOString() }),
    };
    const ok = await sbUpsert(env, 'vinax_experiments', patch, 'key');
    if (ok) void logAdminAudit(env, 'experiment-save', `${key} · ${variants.map((v) => `${v.name}:${v.pct}%`).join(' / ')} · ${body?.active ? 'ACTIVE' : 'paused'}`);
    return json({ ok }, ok ? 200 : 500);
  }
  if (action === 'toggle') {
    // Update-only: an upsert on an unknown key used to INSERT a phantom
    // experiment with null variants that broke the list sort (D-16).
    const ok = await sbUpdate(env, 'vinax_experiments', `key=eq.${encodeURIComponent(key)}`, { active: body?.active === true });
    if (ok) void logAdminAudit(env, 'experiment-toggle', `${key} → ${body?.active ? 'ACTIVE' : 'paused'}`);
    return json({ ok });
  }
  if (action === 'delete') {
    const ok = await sbDelete(env, 'vinax_experiments', `key=eq.${encodeURIComponent(key)}`);
    if (ok) void logAdminAudit(env, 'experiment-delete', key);
    return json({ ok });
  }
  return json({ error: 'unknown_action' }, 400);
};
