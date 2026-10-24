/**
 * The Worker's database client — PostgREST over fetch, service-role key.
 *
 * One small surface, every call answers a result object and never throws:
 *
 *   const r = await db.select<Row>(env, 'listeners', q().eq('platform', 'web').order('last_seen', 'desc').limit(50));
 *   if (!r.ok) return dbFailure(r);            // r.error names why
 *   r.rows                                      // typed rows
 *
 *   db.insert / db.upsert / db.update / db.remove / db.count / db.rpc
 *
 * Every request carries a deadline (DB_TIMEOUT_MS) that covers the whole
 * exchange, so a stalled database can never hold a route open. Reads that ask
 * for more than one page (PostgREST answers at most 1000 rows per request)
 * are paged transparently.
 *
 * The key is read from env and never leaves the Worker. Row-level security is
 * forced on every table with no policy, so this key is the only way in.
 */

export interface DbEnv {
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
}

/** Deadline for one request, connect to last byte. */
export const DB_TIMEOUT_MS = 8_000;
/** PostgREST's default `max-rows`: a bigger limit is cut to this per request. */
export const DB_PAGE_ROWS = 1000;
/** Pages one read may take (subrequest budget). */
const MAX_PAGES = 20;

/**
 * Why a call failed:
 *   not_configured — SUPABASE_URL or the key is not set on this Worker
 *   unauthorized   — the database refused the key (401/403)
 *   not_found      — table or function missing (404): schema.sql not applied
 *   conflict       — a unique constraint refused the write (409)
 *   bad_request    — the query or payload was refused (other 4xx)
 *   unavailable    — 5xx, network failure, bad body, or the deadline passed
 */
export type DbError = 'not_configured' | 'unauthorized' | 'not_found' | 'conflict' | 'bad_request' | 'unavailable';

export interface DbFail {
  ok: false;
  error: DbError;
  status: number | null;
  /** PostgREST's own code when it sent one (PGRST204 = unknown column, 23505 = unique violation…). */
  code: string | null;
  /** A short, safe description for logs; never the key. */
  detail: string | null;
}
export type Rows<T> = { ok: true; rows: T[] } | (DbFail & { rows: [] });
export type Value<T> = { ok: true; value: T } | DbFail;

export function dbConfigured(env: DbEnv): boolean {
  return !!(env.SUPABASE_URL?.trim() && env.SUPABASE_SERVICE_ROLE_KEY?.trim());
}

/** The JSON error code a route answers with for a failed database call. */
export function dbErrorCode(error: DbError): string {
  return `db_${error}`;
}

function errorFromStatus(status: number): DbError {
  if (status === 401 || status === 403) return 'unauthorized';
  if (status === 404) return 'not_found';
  if (status === 409) return 'conflict';
  if (status >= 400 && status < 500) return 'bad_request';
  return 'unavailable';
}

const fail = (error: DbError, status: number | null = null, code: string | null = null, detail: string | null = null): DbFail => ({
  ok: false, error, status, code, detail,
});

// ----------------------------------------------------------------- queries

/**
 * PostgREST filter builder. Values are encoded, so a listener's name with
 * a comma or an ampersand can never change the query.
 *
 *   q().eq('kind', 'play').gte('at', iso).select('id,at').order('at', 'desc').limit(100)
 *   q().or(`name.ilike.*${like(text)}*`, `handle.ilike.*${like(text)}*`)
 */
export class Query {
  private parts: string[] = [];
  private add(col: string, op: string, v: unknown): this {
    this.parts.push(`${col}=${op}.${encodeURIComponent(String(v))}`);
    return this;
  }
  eq(col: string, v: unknown): this { return this.add(col, 'eq', v); }
  neq(col: string, v: unknown): this { return this.add(col, 'neq', v); }
  gt(col: string, v: unknown): this { return this.add(col, 'gt', v); }
  gte(col: string, v: unknown): this { return this.add(col, 'gte', v); }
  lt(col: string, v: unknown): this { return this.add(col, 'lt', v); }
  lte(col: string, v: unknown): this { return this.add(col, 'lte', v); }
  /** Case-insensitive pattern; use `like()` to escape the text and `*` as the wildcard. */
  ilike(col: string, pattern: string): this { return this.add(col, 'ilike', pattern); }
  is(col: string, v: 'null' | 'true' | 'false'): this { return this.add(col, 'is', v); }
  not(col: string, op: string, v: unknown): this { this.parts.push(`${col}=not.${op}.${encodeURIComponent(String(v))}`); return this; }
  in(col: string, values: Array<string | number>): this {
    this.parts.push(`${col}=in.(${values.map((v) => encodeURIComponent(`"${String(v).replace(/"/g, '\\"')}"`)).join(',')})`);
    return this;
  }
  /** Disjunction of raw PostgREST conditions (each `col.op.value`, already escaped with `like()`). */
  or(...conds: string[]): this { this.parts.push(`or=(${conds.map((c) => encodeURIComponent(c)).join(',')})`); return this; }
  select(cols: string): this { this.parts.push(`select=${encodeURIComponent(cols)}`); return this; }
  order(col: string, dir: 'asc' | 'desc' = 'asc', nulls?: 'first' | 'last'): this {
    this.parts.push(`order=${col}.${dir}${nulls ? `.nulls${nulls}` : ''}`);
    return this;
  }
  limit(n: number): this { this.parts.push(`limit=${Math.max(0, Math.floor(n))}`); return this; }
  offset(n: number): this { this.parts.push(`offset=${Math.max(0, Math.floor(n))}`); return this; }
  /** An already-encoded fragment, for the rare operator this builder lacks. */
  raw(fragment: string): this { if (fragment) this.parts.push(fragment); return this; }
  toString(): string { return this.parts.join('&'); }
}

export const q = (): Query => new Query();

/** Escape text for an `ilike` pattern inside `or()`: PostgREST reserved characters and the SQL wildcards. */
export function like(text: string): string {
  return text.replace(/[%_\\,.()"*]/g, (c) => `\\${c}`).replace(/\s+/g, ' ').trim();
}

// ------------------------------------------------------------------ fetch

function endpoint(env: DbEnv): { url: string; key: string } | null {
  if (!dbConfigured(env)) return null;
  return { url: env.SUPABASE_URL!.trim().replace(/\/+$/, ''), key: env.SUPABASE_SERVICE_ROLE_KEY!.trim() };
}

const NULL_BODY = new Set([101, 103, 204, 205, 304]);

/** fetch with a deadline on the WHOLE exchange: the body is buffered under the same timer. */
export async function dbFetch(url: string, init: RequestInit = {}, ms = DB_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    const body = NULL_BODY.has(res.status) ? null : await res.arrayBuffer();
    return new Response(body, { status: res.status, statusText: res.statusText, headers: res.headers });
  } finally {
    clearTimeout(timer);
  }
}

interface CallOpts {
  timeoutMs?: number;
  prefer?: string[];
  headers?: Record<string, string>;
}

async function call(env: DbEnv, method: string, path: string, body: unknown, opts: CallOpts): Promise<{ ok: true; res: Response } | DbFail> {
  const ep = endpoint(env);
  if (!ep) return fail('not_configured');
  const headers: Record<string, string> = {
    apikey: ep.key,
    authorization: `Bearer ${ep.key}`,
    'content-type': 'application/json',
    ...(opts.prefer?.length ? { prefer: opts.prefer.join(',') } : {}),
    ...(opts.headers ?? {}),
  };
  try {
    const res = await dbFetch(`${ep.url}/rest/v1/${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }, opts.timeoutMs);
    if (res.ok) return { ok: true, res };
    const parsed = (await res.json().catch(() => null)) as { code?: unknown; message?: unknown; details?: unknown } | null;
    const code = typeof parsed?.code === 'string' ? parsed.code : null;
    const detail = typeof parsed?.message === 'string' ? parsed.message.slice(0, 200) : null;
    const error = code === '23505' ? 'conflict' : errorFromStatus(res.status);
    return fail(error, res.status, code, detail);
  } catch (e) {
    const aborted = e instanceof Error && e.name === 'AbortError';
    return fail('unavailable', null, null, aborted ? 'timeout' : 'network');
  }
}

async function rowsOf<T>(r: { ok: true; res: Response } | DbFail): Promise<Rows<T>> {
  if (!r.ok) return { ...r, rows: [] };
  if (r.res.status === 204) return { ok: true, rows: [] };
  const text = await r.res.text();
  if (!text) return { ok: true, rows: [] };
  try {
    const body = JSON.parse(text) as unknown;
    return { ok: true, rows: Array.isArray(body) ? (body as T[]) : [body as T] };
  } catch {
    return { ...fail('unavailable', r.res.status, null, 'bad body'), rows: [] };
  }
}

const queryString = (query: Query | string | undefined): string => (query === undefined ? '' : String(query));
const limitOf = (qs: string): number | null => {
  const m = /(^|&)limit=(\d+)(?=&|$)/.exec(qs);
  return m ? Number(m[2]) : null;
};

// -------------------------------------------------------------------- api

export const db = {
  /**
   * SELECT. A `limit` above DB_PAGE_ROWS without an `offset` is read in pages
   * of DB_PAGE_ROWS (up to MAX_PAGES), so `limit(5000)` really yields 5000.
   */
  async select<T>(env: DbEnv, table: string, query?: Query | string, opts: CallOpts = {}): Promise<Rows<T>> {
    const qs = queryString(query);
    const wanted = limitOf(qs);
    if (wanted !== null && wanted > DB_PAGE_ROWS && !/(^|&)offset=/.test(qs)) {
      const out: T[] = [];
      const total = Math.min(wanted, DB_PAGE_ROWS * MAX_PAGES);
      for (let from = 0; from < total; from += DB_PAGE_ROWS) {
        const take = Math.min(DB_PAGE_ROWS, total - from);
        const page = await rowsOf<T>(await call(env, 'GET', `${table}?${qs.replace(/(^|&)limit=\d+(?=&|$)/, `$1limit=${take}&offset=${from}`)}`, undefined, opts));
        if (!page.ok) return page;
        out.push(...page.rows);
        if (page.rows.length < take) break;
      }
      return { ok: true, rows: out };
    }
    return rowsOf<T>(await call(env, 'GET', qs ? `${table}?${qs}` : table, undefined, opts));
  },

  /** The first row, null when there is none. */
  async one<T>(env: DbEnv, table: string, query: Query | string, opts: CallOpts = {}): Promise<Value<T | null>> {
    const r = await db.select<T>(env, table, `${queryString(query)}&limit=1`.replace(/^&/, ''), opts);
    return r.ok ? { ok: true, value: r.rows[0] ?? null } : r;
  },

  /**
   * INSERT one row or many. `returning` answers the rows written (default: nothing moves back).
   * `ignoreDuplicates` with `onConflict` skips a row whose key exists — the
   * returned rows are then EMPTY on a collision, which is how a caller tells.
   */
  async insert<T = unknown>(env: DbEnv, table: string, rows: unknown, opts: { returning?: boolean; onConflict?: string; ignoreDuplicates?: boolean; timeoutMs?: number } = {}): Promise<Rows<T>> {
    const prefer = [opts.returning ? 'return=representation' : 'return=minimal'];
    if (opts.ignoreDuplicates) prefer.push('resolution=ignore-duplicates');
    const path = opts.onConflict ? `${table}?on_conflict=${encodeURIComponent(opts.onConflict)}` : table;
    return rowsOf<T>(await call(env, 'POST', path, rows, { prefer, timeoutMs: opts.timeoutMs }));
  },

  /** INSERT … ON CONFLICT (onConflict) DO UPDATE with every column sent. */
  async upsert<T = unknown>(env: DbEnv, table: string, rows: unknown, onConflict: string, opts: { returning?: boolean; timeoutMs?: number } = {}): Promise<Rows<T>> {
    const prefer = ['resolution=merge-duplicates', opts.returning ? 'return=representation' : 'return=minimal'];
    return rowsOf<T>(await call(env, 'POST', `${table}?on_conflict=${encodeURIComponent(onConflict)}`, rows, { prefer, timeoutMs: opts.timeoutMs }));
  },

  /** UPDATE the rows the query matches. With `returning`, [] means nothing matched. */
  async update<T = unknown>(env: DbEnv, table: string, query: Query | string, patch: unknown, opts: { returning?: boolean; timeoutMs?: number } = {}): Promise<Rows<T>> {
    const prefer = [opts.returning ? 'return=representation' : 'return=minimal'];
    return rowsOf<T>(await call(env, 'PATCH', `${table}?${queryString(query)}`, patch, { prefer, timeoutMs: opts.timeoutMs }));
  },

  /** DELETE the rows the query matches. With `returning`, the rows removed ([] = nothing matched). */
  async remove<T = unknown>(env: DbEnv, table: string, query: Query | string, opts: { returning?: boolean; timeoutMs?: number } = {}): Promise<Rows<T>> {
    const qs = queryString(query);
    if (!qs) return { ...fail('bad_request', null, null, 'refusing to delete without a filter'), rows: [] };
    const prefer = [opts.returning ? 'return=representation' : 'return=minimal'];
    return rowsOf<T>(await call(env, 'DELETE', `${table}?${qs}`, undefined, { prefer, timeoutMs: opts.timeoutMs }));
  },

  /** Exact row count (no rows move). */
  async count(env: DbEnv, table: string, query?: Query | string, opts: CallOpts = {}): Promise<Value<number>> {
    const qs = queryString(query);
    const r = await call(env, 'GET', `${table}?select=id&limit=1${qs ? `&${qs}` : ''}`, undefined, { ...opts, prefer: ['count=exact'] });
    if (!r.ok) return r;
    const total = Number((r.res.headers.get('content-range') ?? '').split('/')[1]);
    return Number.isFinite(total) ? { ok: true, value: total } : fail('unavailable', r.res.status, null, 'no content-range');
  },

  /** Call a function (POST /rpc/<name>). The answer is whatever it returns, parsed. */
  async rpc<T>(env: DbEnv, fn: string, args: Record<string, unknown> = {}, opts: CallOpts = {}): Promise<Value<T>> {
    const r = await call(env, 'POST', `rpc/${fn}`, args, opts);
    if (!r.ok) return r;
    const text = await r.res.text();
    try {
      return { ok: true, value: (text ? JSON.parse(text) : null) as T };
    } catch {
      return fail('unavailable', r.res.status, null, 'bad body');
    }
  },
};

/** The first failed result among several, or null when every call succeeded. */
export function firstFailure(...results: Array<{ ok: true } | DbFail>): DbFail | null {
  for (const r of results) if (!r.ok) return r;
  return null;
}

/** ISO string for `now - ms`. */
export const since = (ms: number, now = Date.now()): string => new Date(now - ms).toISOString();
export const DAY_MS = 86_400_000;
