/**
 * Admin audit trail — every mutating admin action leaves a row.
 *
 * 7.2.0 — each row records WHO (actor), WHAT (action + summary + target),
 * WHEN (ISO timestamp), WHICH REQUEST (the edge request id, else a random
 * UUID) and, for configuration changes, safe BEFORE / AFTER values with
 * secrets and tokens redacted (redactSecrets) and oversized values reduced
 * to their size and a short digest.
 *
 * Storage is unchanged (no migration): vinax_feedback rows with
 * type='admin-audit' and status='audit' — outside the feedback KPI and the
 * inbox, and never removed by clear_feedback. The message column holds
 * `action|{"v":2,...}`; /api/admin/audit splits on the first pipe and still
 * reads the older `kind|text` rows. The actor id is also written to the
 * `name` column so the Query Console can filter by it.
 *
 * Persistence: callers pass the Worker context. With `waitUntil` the write is
 * registered with the runtime, so it survives the response and the action is
 * not delayed; without it (tests, direct calls) the returned promise is the
 * write itself. Best-effort by design: an audit write never fails the action
 * it describes (a failed write is logged).
 */
import { dbErrorCode, sbInsertResult, type DbResult, type SupabaseEnv } from './supabase';

/**
 * The "before" value of a change, from a read made just before the write: the
 * first row (mapped), null when there was none, or `{ unavailable }` when the
 * read failed — so a failed read is never recorded as "did not exist".
 */
export function auditPrior<T, U = T>(read: DbResult<T>, map: (row: T) => U = (row) => row as unknown as U): U | null | { unavailable: string } {
  if (!read.ok) return { unavailable: dbErrorCode(read.error) };
  return read.rows.length ? map(read.rows[0]) : null;
}

/**
 * Who acted. Today there is one shared admin token, so every action is the
 * `owner` via `shared-token`. The shape is ready for per-operator identities:
 * a session-based sign-in would record `{ id: '<operator id>', via: 'session' }`
 * (and a role) without changing readers of older rows.
 */
export interface AdminActor {
  id: string;
  via: 'shared-token' | 'session';
}

export function adminActor(_request?: Request): AdminActor {
  return { id: 'owner', via: 'shared-token' };
}

/** The edge's request id (cf-ray) when present, else a fresh UUID. */
export function auditRequestId(request?: Request): string {
  const ray = request?.headers.get('cf-ray')?.trim();
  return ray && /^[\w-]{4,80}$/.test(ray) ? ray : crypto.randomUUID();
}

export const REDACTED = '[redacted]';

/**
 * Key names whose values are always secret, wherever they appear. `token`
 * only as a suffix (accessToken, x-admin-token, fcm_token) so counts such as
 * dailyTokenCap or maxTokens stay readable.
 */
const SECRET_KEY = /(passw(or)?d|passphrase|secret|token$|(api|access|private|service|signing)[-_]?key$|apikey$|authorization|^auth$|bearer|cookie|session[-_]?(id|key)$|credential|signature|pepper|service[-_]?role|p256dh|^endpoint$|vapid)/i;
/** Query parameters that carry secrets inside an otherwise harmless URL. */
const SECRET_PARAM = /^(token|key|api[-_]?key|sig|signature|secret|auth|password|access[-_]?token|code)$/i;
const JWT = /^eyJ[\w-]{4,}\.[\w-]{4,}\.[\w-]{4,}$/;
const BEARER = /^bearer\s+\S+/i;
/** A long opaque credential-looking run: letters AND digits, no spaces. */
const OPAQUE = /^(?=.*[A-Za-z])(?=.*\d)[A-Za-z0-9_\-+/=.:]{32,}$/;
const MAX_STRING = 300;
const MAX_ITEMS = 50;
const MAX_KEYS = 100;
const MAX_DEPTH = 6;

function redactString(s: string): string {
  const t = s.trim();
  if (JWT.test(t) || BEARER.test(t) || OPAQUE.test(t)) return REDACTED;
  if (/^data:/i.test(t)) return `[data url, ${t.length} chars]`;
  let out = s;
  if (/^https?:\/\//i.test(t)) {
    try {
      const u = new URL(t);
      let touched = false;
      for (const k of [...u.searchParams.keys()]) {
        if (SECRET_PARAM.test(k)) {
          u.searchParams.set(k, REDACTED);
          touched = true;
        }
      }
      if (u.username || u.password) {
        u.username = '';
        u.password = '';
        touched = true;
      }
      if (touched) out = u.toString();
    } catch {
      /* not a URL after all */
    }
  }
  return out.length > MAX_STRING ? `${out.slice(0, MAX_STRING)}…(+${out.length - MAX_STRING} chars)` : out;
}

/**
 * A copy of `value` that is safe to keep in an audit row: values under
 * secret-looking keys are replaced, credential-looking strings (JWTs, bearer
 * headers, long opaque tokens, secret URL parameters, URL user info) are
 * replaced, data URLs are reduced to their length, long strings are clipped,
 * and very wide or deep structures are truncated with a note.
 */
export function redactSecrets(value: unknown, depth = 0, seen: WeakSet<object> = new WeakSet()): unknown {
  if (value === null || value === undefined) return value ?? null;
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

/** Largest serialised before/after value kept verbatim (after redaction). */
export const AUDIT_VALUE_MAX = 3000;

async function digest(text: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
  return [...bytes.slice(0, 8)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Redacted value, or — when that is still too large — its size and a short digest of the redacted form. */
export async function auditValue(value: unknown): Promise<unknown> {
  if (value === undefined) return undefined;
  const safe = redactSecrets(value);
  const text = JSON.stringify(safe) ?? 'null';
  if (text.length <= AUDIT_VALUE_MAX) return safe;
  return { omitted: 'too_large', chars: text.length, sha256_64: await digest(text) };
}

export interface AuditEntry {
  /** Machine name of the action, e.g. `config`, `blocklist-block`, `push-send`. */
  action: string;
  /** One human line. */
  summary: string;
  /** What the action touched (a config key, an experiment key…). */
  target?: string;
  /** Configuration changes: the value before and after (redacted here). */
  before?: unknown;
  after?: unknown;
}

export interface AuditContext {
  env: SupabaseEnv;
  request?: Request;
  waitUntil?: (p: Promise<unknown>) => void;
}

export interface AuditRecord {
  v: 2;
  actor: AdminActor;
  action: string;
  at: string;
  requestId: string;
  summary: string;
  target?: string;
  before?: unknown;
  after?: unknown;
}

const clipAction = (s: string): string => s.replace(/\|/g, '/').replace(/[^\w.:/-]/g, '-').slice(0, 40) || 'action';

/** The exact record written — exported for tests and for readers. */
export async function buildAuditRecord(ctx: AuditContext, entry: AuditEntry, now = new Date()): Promise<AuditRecord> {
  const record: AuditRecord = {
    v: 2,
    actor: adminActor(ctx.request),
    action: clipAction(entry.action),
    at: now.toISOString(),
    requestId: auditRequestId(ctx.request),
    summary: redactString(entry.summary.replace(/\s+/g, ' ').trim()).slice(0, 400),
  };
  if (entry.target) record.target = redactString(entry.target).slice(0, 120);
  if ('before' in entry) record.before = (await auditValue(entry.before)) ?? null;
  if ('after' in entry) record.after = (await auditValue(entry.after)) ?? null;
  return record;
}

/** Parse a stored audit message (`action|{v:2…}` or the legacy `kind|text`). */
export function parseAuditMessage(message: string | null | undefined): { action: string; text: string; record: AuditRecord | null } {
  const msg = message ?? '';
  const pipe = msg.indexOf('|');
  if (pipe <= 0) return { action: 'user-delete', text: msg, record: null };
  const action = msg.slice(0, pipe);
  const rest = msg.slice(pipe + 1);
  if (rest.startsWith('{"v":2')) {
    try {
      const record = JSON.parse(rest) as AuditRecord;
      if (record && record.v === 2) return { action, text: typeof record.summary === 'string' ? record.summary : '', record };
    } catch {
      /* a legacy row that happens to start with a brace */
    }
  }
  return { action, text: rest, record: null };
}

export function logAdminAudit(ctx: AuditContext, entry: AuditEntry): Promise<void> {
  const write = (async () => {
    const record = await buildAuditRecord(ctx, entry);
    const result = await sbInsertResult(ctx.env, 'vinax_feedback', {
      type: 'admin-audit',
      // Explicit status: the column defaults to 'new', which made every audit
      // write inflate the Overview "New feedback" KPI and render in the inbox;
      // 'resolved' would get erased by the clear_feedback maintenance action.
      // 'audit' is outside both filters (admin audit D-4).
      status: 'audit',
      name: record.actor.id,
      message: `${record.action}|${JSON.stringify(record)}`,
    });
    if (!result.ok && result.error !== 'not_configured') {
      console.warn(`[audit] write failed (${result.error}${result.httpStatus ? ` ${result.httpStatus}` : ''}) action=${record.action} request=${record.requestId}`);
    }
  })().catch(() => undefined);
  if (ctx.waitUntil) {
    ctx.waitUntil(write);
    return Promise.resolve();
  }
  return write;
}
