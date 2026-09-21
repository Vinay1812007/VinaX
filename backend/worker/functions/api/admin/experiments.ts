/**
 * Package E2 — admin experiments: CRUD + per-variant metrics.
 *
 * Metrics need no event tagging: the newest 14d of vinax_events (device_id,
 * type) are re-joined to variants by the SAME deterministic hash the client
 * uses. Per variant: devices, plays/device, completion %, skip % — the
 * signals the audit named (skip rate, session length proxied honestly as
 * plays per device).
 */
import { dbFailure, isAdminAsync, unauthorized, type AdminEnv } from '../../_lib/admin';
import { auditPrior, logAdminAudit } from '../../_lib/adminAudit';
import { sbDelete, sbSelectResult, sbUpdate, sbUpsert, type SupabaseEnv } from '../../_lib/supabase';
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
  if (!(await isAdminAsync(request, env))) return unauthorized();

  // Error-aware read: a missing vinax_experiments table (migration not run)
  // must report configured:false — not masquerade as "configured, empty" (D-1).
  // 7.2.0 — only a missing table or an unconfigured Worker means that; an
  // outage (5xx, timeout, refused key) answers 502 instead of claiming the
  // experiments feature was never set up.
  const sel = await sbSelectResult<ExpRow>(env, 'vinax_experiments', 'select=key,name,variants,active,created_at&order=created_at.desc.nullslast&limit=50');
  if (!sel.ok) {
    if (sel.error === 'not_found' || sel.error === 'not_configured') return json({ configured: false, experiments: [] });
    return dbFailure(sel);
  }
  const rows = sel.rows;
  if (!rows.length) return json({ configured: true, experiments: [] });

  // One events sample serves every experiment's metrics.
  const since = new Date(Date.now() - 14 * 86_400_000).toISOString();
  const eventsRead = await sbSelectResult<EventRow>(
    env,
    'vinax_events',
    `created_at=gte.${encodeURIComponent(since)}&type=in.(play,complete,skip)&select=device_id,type&order=created_at.desc&limit=10000`,
  );
  // 7.2.0 — the experiment list stays usable (pause / resume still work) when
  // only the metrics read fails; each experiment's metrics are then null,
  // never "0 devices".
  const events = eventsRead.rows;

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
    return { key: exp.key, name: r.name, active: exp.active, variants: exp.variants, metrics: eventsRead.ok ? metrics : null, created_at: r.created_at };
  });

  if (!eventsRead.ok) return json({ configured: true, experiments, sampledEvents: null, unavailable: ['metrics'] });
  return json({ configured: true, experiments, sampledEvents: events.length });
};

export const onRequestPost = async (context: { request: Request; env: Env; waitUntil?: (p: Promise<unknown>) => void }): Promise<Response> => {
  const { request, env } = context;
  if (!(await isAdminAsync(request, env))) return unauthorized();
  const body = (await request.json().catch(() => null)) as
    | { action?: string; key?: string; name?: string; variants?: unknown; active?: boolean }
    | null;
  const action = typeof body?.action === 'string' ? body.action : '';
  const key = typeof body?.key === 'string' ? body.key.trim().toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 40) : '';
  if (!key) return json({ error: 'bad_request' }, 400);
  // 7.2.0 — the experiment as it was, for the audit row.
  const readPrior = () =>
    sbSelectResult<{ key: string; name: string | null; variants: unknown; active: boolean | null }>(env, 'vinax_experiments', `key=eq.${encodeURIComponent(key)}&select=key,name,variants,active&limit=1`);
  const shape = (row: { name: string | null; variants: unknown; active: boolean | null }) => ({ name: row.name, variants: row.variants, active: row.active });

  if (action === 'save') {
    const variants = sanitizeVariants(body?.variants);
    if (variants.length < 2) return json({ error: 'need_two_variants' }, 400);
    // created_at only on first insert — writing it on every save reset the
    // creation date and reshuffled the list on each edit (D-16b). Best-effort
    // on purpose: a failed read only means created_at is re-stamped.
    const existing = await readPrior();
    const patch = {
      key,
      name: typeof body?.name === 'string' ? body.name.slice(0, 80) : null,
      variants,
      active: body?.active === true,
      ...(existing.ok && existing.rows.length ? {} : { created_at: new Date().toISOString() }),
    };
    const ok = await sbUpsert(env, 'vinax_experiments', patch, 'key');
    if (ok) {
      await logAdminAudit(context, {
        action: 'experiment-save',
        summary: `${key} · ${variants.map((v) => `${v.name}:${v.pct}%`).join(' / ')} · ${body?.active ? 'ACTIVE' : 'paused'}`,
        target: key,
        before: auditPrior(existing, shape),
        after: { name: patch.name, variants, active: patch.active },
      });
    }
    return json({ ok }, ok ? 200 : 500);
  }
  if (action === 'toggle') {
    // Update-only: an upsert on an unknown key used to INSERT a phantom
    // experiment with null variants that broke the list sort (D-16).
    const prior = await readPrior();
    const ok = await sbUpdate(env, 'vinax_experiments', `key=eq.${encodeURIComponent(key)}`, { active: body?.active === true });
    if (ok) {
      await logAdminAudit(context, {
        action: 'experiment-toggle',
        summary: `${key} → ${body?.active ? 'ACTIVE' : 'paused'}`,
        target: key,
        before: auditPrior(prior, (row) => ({ active: row.active })),
        after: { active: body?.active === true },
      });
    }
    return json({ ok });
  }
  if (action === 'delete') {
    const prior = await readPrior();
    const ok = await sbDelete(env, 'vinax_experiments', `key=eq.${encodeURIComponent(key)}`);
    if (ok) await logAdminAudit(context, { action: 'experiment-delete', summary: key, target: key, before: auditPrior(prior, shape), after: null });
    return json({ ok });
  }
  return json({ error: 'unknown_action' }, 400);
};
