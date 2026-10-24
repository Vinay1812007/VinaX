/**
 * Audit trail — every owner action that changes something leaves a row in
 * `audit_log`: who, what, which target, a one-line summary, and for setting
 * changes the value before and after, with anything secret-looking redacted.
 *
 * Best effort by design: a failed audit write is logged and never fails the
 * action it describes. With `waitUntil` the write outlives the response.
 */
import { db, type DbEnv } from './db';

export interface AuditEntry {
  /** Machine name: `settings`, `feedback-status`, `push-send`, `listener-delete`… */
  action: string;
  summary: string;
  target?: string;
  before?: unknown;
  after?: unknown;
}

export interface AuditContext {
  env: DbEnv;
  request?: Request;
  waitUntil?: (p: Promise<unknown>) => void;
}

export const REDACTED = '[redacted]';
const SECRET_KEY = /(passw(or)?d|secret|token$|(api|access|private|service|signing)[-_]?key$|apikey$|authorization|^auth$|bearer|cookie|credential|signature|pepper|p256dh|^endpoint$|^target$|vapid)/i;
const SECRET_PARAM = /^(token|key|api[-_]?key|sig|signature|secret|auth|password|access[-_]?token|code)$/i;
const JWT = /^eyJ[\w-]{4,}\.[\w-]{4,}\.[\w-]{4,}$/;
const OPAQUE = /^(?=.*[A-Za-z])(?=.*\d)[A-Za-z0-9_\-+/=.:]{32,}$/;
const MAX_STRING = 300;
const MAX_ITEMS = 50;
const MAX_KEYS = 100;
const MAX_DEPTH = 6;
/** Largest serialised before/after kept verbatim. */
export const AUDIT_VALUE_MAX = 4000;

function redactString(s: string): string {
  const t = s.trim();
  if (JWT.test(t) || /^bearer\s+\S+/i.test(t) || OPAQUE.test(t)) return REDACTED;
  if (/^data:/i.test(t)) return `[data url, ${t.length} chars]`;
  let out = s;
  if (/^https?:\/\//i.test(t)) {
    try {
      const u = new URL(t);
      let touched = false;
      for (const k of [...u.searchParams.keys()]) if (SECRET_PARAM.test(k)) { u.searchParams.set(k, REDACTED); touched = true; }
      if (u.username || u.password) { u.username = ''; u.password = ''; touched = true; }
      if (touched) out = u.toString();
    } catch { /* not a URL */ }
  }
  return out.length > MAX_STRING ? `${out.slice(0, MAX_STRING)}…(+${out.length - MAX_STRING} chars)` : out;
}

/** A copy of `value` safe to keep: secret-looking keys and strings replaced, long values clipped, wide or deep shapes truncated. */
export function redactSecrets(value: unknown, depth = 0, seen: WeakSet<object> = new WeakSet()): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return redactString(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value !== 'object') return String(value).slice(0, MAX_STRING);
  if (seen.has(value)) return '[circular]';
  if (depth >= MAX_DEPTH) return '[nested too deep]';
  seen.add(value);
  if (Array.isArray(value)) {
    const items = value.slice(0, MAX_ITEMS).map((v) => redactSecrets(v, depth + 1, seen));
    if (value.length > MAX_ITEMS) items.push(`[+${value.length - MAX_ITEMS} more]`);
    return items;
  }
  const out: Record<string, unknown> = {};
  const entries = Object.entries(value as Record<string, unknown>);
  for (const [k, v] of entries.slice(0, MAX_KEYS)) out[k] = SECRET_KEY.test(k) && v !== null && v !== undefined && v !== '' ? REDACTED : redactSecrets(v, depth + 1, seen);
  if (entries.length > MAX_KEYS) out['…'] = `+${entries.length - MAX_KEYS} more keys`;
  return out;
}

async function digest(text: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
  return [...bytes.slice(0, 8)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Redacted value, or when still too large its size and a short digest. */
export async function auditValue(value: unknown): Promise<unknown> {
  if (value === undefined) return null;
  const safe = redactSecrets(value);
  const text = JSON.stringify(safe) ?? 'null';
  if (text.length <= AUDIT_VALUE_MAX) return safe;
  return { omitted: 'too_large', chars: text.length, sha256_64: await digest(text) };
}

/** The edge request id when present (cf-ray), else a fresh UUID. */
export function requestId(request?: Request): string {
  const ray = request?.headers.get('cf-ray')?.trim();
  return ray && /^[\w-]{4,80}$/.test(ray) ? ray : crypto.randomUUID();
}

const cleanAction = (s: string): string => s.replace(/[^\w.:/-]/g, '-').slice(0, 40) || 'action';

export interface AuditRow {
  actor: string;
  action: string;
  target: string | null;
  summary: string;
  before: unknown;
  after: unknown;
  request_id: string;
}

/** The exact row written (exported for tests). */
export async function buildAuditRow(ctx: AuditContext, entry: AuditEntry): Promise<AuditRow> {
  return {
    actor: 'owner',
    action: cleanAction(entry.action),
    target: entry.target ? redactString(entry.target).slice(0, 160) : null,
    summary: redactString(entry.summary.replace(/\s+/g, ' ').trim()).slice(0, 400),
    before: 'before' in entry ? await auditValue(entry.before) : null,
    after: 'after' in entry ? await auditValue(entry.after) : null,
    request_id: requestId(ctx.request),
  };
}

export function audit(ctx: AuditContext, entry: AuditEntry): Promise<void> {
  const write = (async () => {
    const row = await buildAuditRow(ctx, entry);
    const r = await db.insert(ctx.env, 'audit_log', row);
    if (!r.ok && r.error !== 'not_configured') console.warn(`[audit] write failed (${r.error}${r.status ? ` ${r.status}` : ''}) action=${row.action} request=${row.request_id}`);
  })().catch(() => undefined);
  if (ctx.waitUntil) {
    ctx.waitUntil(write);
    return Promise.resolve();
  }
  return write;
}
