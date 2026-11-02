/**
 * The frame every database-backed admin route shares: the owner check, the
 * "no database" answers, the capped JSON body and the context the handlers
 * receive. Routes stay small and read the same way.
 *
 *   export const onRequestGet = adminGet(async ({ env, url }) => { … return adminJson(x); });
 *   export const onRequestPost = adminPost(async ({ env, body, audit }) => { … });
 */
import { adminJson, adminPrincipal, forbidden, unauthorized, type AdminAuthEnv } from './admin';
import { roleAllows, type AdminPrincipal, type AdminRole } from './adminAuth';
import { audit as writeAudit, type AuditEntry } from './audit';
import { readJsonCapped } from './body';
import { dbConfigured, type DbEnv } from './db';

export type AdminDbEnv = AdminAuthEnv & DbEnv & Record<string, unknown>;

export interface AdminCtx<E = AdminDbEnv> {
  request: Request;
  env: E;
  url: URL;
  waitUntil: ((p: Promise<unknown>) => void) | undefined;
  /** Who is calling (console rebuild): email, role, how they signed in. */
  me: AdminPrincipal;
  /** Record what this action changed (best effort, outlives the response). */
  audit: (entry: AuditEntry) => Promise<void>;
}

export interface AdminPostCtx<E = AdminDbEnv> extends AdminCtx<E> {
  body: Record<string, unknown>;
}

interface RawCtx { request: Request; env: AdminDbEnv; waitUntil?: (p: Promise<unknown>) => void }

function frame(raw: RawCtx, me: AdminPrincipal): AdminCtx {
  const ctx: AdminCtx = {
    request: raw.request,
    env: raw.env,
    url: new URL(raw.request.url),
    waitUntil: raw.waitUntil,
    me,
    audit: (entry) => writeAudit({ env: raw.env, request: raw.request, waitUntil: raw.waitUntil, actor: me.email }, entry),
  };
  return ctx;
}

/** GET: any admin (viewer and up) → `{ configured: false }` without a database → the handler. */
export function adminGet(handler: (ctx: AdminCtx) => Promise<Response>, opts: { withoutDb?: boolean } = {}) {
  return async (raw: RawCtx): Promise<Response> => {
    const me = await adminPrincipal(raw.request, raw.env);
    if (!me) return unauthorized();
    if (!opts.withoutDb && !dbConfigured(raw.env)) return adminJson({ configured: false });
    return handler(frame(raw, me));
  };
}

/**
 * POST: an admin whose role allows it (editor by default; `role` may be a
 * function of the body, e.g. owner for one destructive action) →
 * `503 db_not_configured` → capped JSON object body → the handler.
 */
export function adminPost(handler: (ctx: AdminPostCtx) => Promise<Response>, opts: { cap?: number; role?: AdminRole | ((body: Record<string, unknown>) => AdminRole) } = {}) {
  return async (raw: RawCtx): Promise<Response> => {
    const me = await adminPrincipal(raw.request, raw.env);
    if (!me) return unauthorized();
    // Viewers change nothing: refuse before reading the body.
    if (!roleAllows(me.role, 'editor')) return forbidden('editor');
    if (!dbConfigured(raw.env)) return adminJson({ error: 'db_not_configured' }, 503);
    const read = await readJsonCapped<unknown>(raw.request, opts.cap ?? 64_000);
    if (!read.ok) return adminJson({ error: read.reason === 'too_large' ? 'too_large' : 'bad_request' }, read.reason === 'too_large' ? 413 : 400);
    const body = read.value && typeof read.value === 'object' && !Array.isArray(read.value) ? (read.value as Record<string, unknown>) : null;
    if (!body) return adminJson({ error: 'bad_request' }, 400);
    const need = typeof opts.role === 'function' ? opts.role(body) : opts.role ?? 'editor';
    if (!roleAllows(me.role, need)) return forbidden(need);
    return handler({ ...frame(raw, me), body });
  };
}

/** `?limit=` clamped to [1, max] (default `fallback`), `?offset=` ≥ 0. */
export function paging(url: URL, fallback: number, max: number): { limit: number; offset: number } {
  const n = Number(url.searchParams.get('limit'));
  const o = Number(url.searchParams.get('offset'));
  return {
    limit: Number.isFinite(n) && n > 0 ? Math.min(max, Math.floor(n)) : fallback,
    offset: Number.isFinite(o) && o > 0 ? Math.floor(o) : 0,
  };
}

/** Rename snake_case keys of a row to camelCase (one level). */
export function camel<T extends Record<string, unknown>>(row: T): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) out[k.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())] = v;
  return out;
}

/** A positive integer id from a body field, else null. */
export function idOf(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : NaN;
  return Number.isInteger(n) && n > 0 ? n : null;
}
