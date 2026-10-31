/**
 * A fake PostgREST for route tests: stubs global fetch, records every call the
 * Worker makes to the database and answers from a small in-memory table set.
 *
 *   const fake = fakeDb({ listeners: [{ id: 'd_1', handle: 'vinay' }] });
 *   … call the route with DB_ENV …
 *   fake.calls                 → [{ method, table, query, body, prefer }]
 *   fake.rows('events')        → what was inserted / upserted
 *   fake.answer('rpc/x', fn)   → custom answer for a path (table or rpc/<fn>)
 *
 * Filters understood on GET/PATCH/DELETE: `col=eq.v`, `col=in.("a","b")`, `col=ilike.pattern`,
 * `limit`, `select`, `order` (ignored). Everything else matches every row.
 */
import { vi } from 'vitest';

export const DB_URL = 'https://db.test.supabase.co';
export const DB_ENV = { SUPABASE_URL: DB_URL, SUPABASE_SERVICE_ROLE_KEY: 'service-role-key-for-tests' };

export interface DbCall {
  method: string;
  table: string;
  query: string;
  body: unknown;
  prefer: string;
}

type Row = Record<string, unknown>;
type Answer = (call: DbCall) => Response | Promise<Response>;

export interface FakeDb {
  calls: DbCall[];
  tables: Record<string, Row[]>;
  rows(table: string): Row[];
  answer(path: string, fn: Answer): void;
  /** Calls that did NOT go to the database (Google keys, probes…). */
  other: Array<{ url: string; method: string }>;
}

function matches(row: Row, query: string): boolean {
  const params = new URLSearchParams(query);
  for (const [k, v] of params.entries()) {
    if (['select', 'limit', 'offset', 'order', 'on_conflict'].includes(k)) continue;
    const inList = /^in\.\((.*)\)$/s.exec(v);
    if (inList) {
      const values = inList[1] ? inList[1].split(',').map((x) => x.replace(/^"|"$/g, '')) : [];
      if (!values.includes(String(row[k]))) return false;
      continue;
    }
    const m = /^(eq|neq|ilike|gte|lte|gt|lt|is)\.(.*)$/s.exec(v);
    if (!m) continue;
    const [, op, raw] = m;
    const cell = row[k];
    if (op === 'eq' && String(cell) !== raw) return false;
    if (op === 'neq' && String(cell) === raw) return false;
    if (op === 'is' && !((raw === 'null' && cell == null) || String(cell) === raw)) return false;
    if (op === 'ilike') {
      // `\x` is a literal x; `*` and `%` are wildcards; everything else is literal.
      let re = '^';
      for (let i = 0; i < raw.length; i += 1) {
        const ch = raw[i];
        if (ch === '\\' && i + 1 < raw.length) { re += raw[++i].replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); continue; }
        re += ch === '*' || ch === '%' ? '.*' : ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      }
      if (!new RegExp(re + '$', 'i').test(String(cell ?? ''))) return false;
    }
    // SQL: comparing with null is unknown, so the row does not match.
    if ((op === 'gte' || op === 'gt' || op === 'lte' || op === 'lt') && cell == null) return false;
    if ((op === 'gte' || op === 'gt' || op === 'lte' || op === 'lt') && cell != null) {
      const a = String(cell), b = raw;
      if (op === 'gte' && a < b) return false;
      if (op === 'gt' && a <= b) return false;
      if (op === 'lte' && a > b) return false;
      if (op === 'lt' && a >= b) return false;
    }
  }
  return true;
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

export function fakeDb(seed: Record<string, Row[]> = {}, fallback?: (url: string, init?: RequestInit) => Response | Promise<Response>): FakeDb {
  const tables: Record<string, Row[]> = {};
  for (const [t, rows] of Object.entries(seed)) tables[t] = rows.map((r) => ({ ...r }));
  const answers = new Map<string, Answer>();
  const calls: DbCall[] = [];
  const other: Array<{ url: string; method: string }> = [];
  let nextId = 1000;

  const table = (name: string): Row[] => (tables[name] ??= []);
  const keyOf = (row: Row, cols: string[]): string => cols.map((c) => String(row[c] ?? '')).join('|');

  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    const method = init?.method ?? 'GET';
    if (!url.startsWith(`${DB_URL}/rest/v1/`)) {
      other.push({ url, method });
      return fallback ? fallback(url, init) : new Response('ok', { status: 200 });
    }
    const u = new URL(url);
    const path = u.pathname.slice('/rest/v1/'.length);
    const prefer = (init?.headers as Record<string, string> | undefined)?.prefer ?? '';
    let body: unknown;
    try { body = init?.body ? JSON.parse(String(init.body)) : null; } catch { body = null; }
    const call: DbCall = { method, table: path, query: u.search.slice(1), body, prefer };
    calls.push(call);
    const custom = answers.get(path);
    if (custom) return custom(call);
    if (path.startsWith('rpc/')) return json(null);
    const rows = table(path);
    const representation = prefer.includes('return=representation');
    if (method === 'GET') {
      const params = new URLSearchParams(call.query);
      const limit = Number(params.get('limit') ?? 1000);
      const list = rows.filter((r) => matches(r, call.query)).slice(0, limit);
      const headers: Record<string, string> = {};
      if (prefer.includes('count=exact')) headers['content-range'] = `0-${Math.max(0, list.length - 1)}/${rows.filter((r) => matches(r, call.query)).length}`;
      return json(list, 200, headers);
    }
    if (method === 'POST') {
      const incoming = (Array.isArray(body) ? body : [body]) as Row[];
      const conflictCols = (new URLSearchParams(call.query).get('on_conflict') ?? '').split(',').filter(Boolean);
      const written: Row[] = [];
      for (const row of incoming) {
        const stored: Row = { ...row };
        if (stored.id === undefined && !conflictCols.includes('id')) stored.id = nextId++;
        const existing = conflictCols.length ? rows.find((r) => keyOf(r, conflictCols) === keyOf(stored, conflictCols)) : undefined;
        if (existing) {
          if (prefer.includes('ignore-duplicates')) continue;
          if (prefer.includes('merge-duplicates')) { Object.assign(existing, row); written.push(existing); continue; }
          return json({ code: '23505', message: 'duplicate key value violates unique constraint' }, 409);
        }
        rows.push(stored);
        written.push(stored);
      }
      return representation ? json(written, 201) : new Response(null, { status: 201 });
    }
    if (method === 'PATCH') {
      const hit = rows.filter((r) => matches(r, call.query));
      for (const r of hit) Object.assign(r, body as Row);
      return representation ? json(hit) : new Response(null, { status: 204 });
    }
    if (method === 'DELETE') {
      const hit = rows.filter((r) => matches(r, call.query));
      tables[path] = rows.filter((r) => !hit.includes(r));
      return representation ? json(hit) : new Response(null, { status: 204 });
    }
    return json({ message: 'unsupported' }, 400);
  }));

  return {
    calls,
    tables,
    other,
    rows: (name) => table(name),
    answer: (path, fn) => { answers.set(path, fn); },
  };
}

/** A database that is set but refuses everything (5xx). */
export function brokenDb(): FakeDb {
  const fake = fakeDb();
  const fetchFn = globalThis.fetch;
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.startsWith(`${DB_URL}/rest/v1/`)) {
      fake.calls.push({ method: init?.method ?? 'GET', table: new URL(url).pathname.slice('/rest/v1/'.length), query: new URL(url).search.slice(1), body: null, prefer: '' });
      return new Response('{"message":"down"}', { status: 503, headers: { 'content-type': 'application/json' } });
    }
    return fetchFn(input, init);
  }));
  return fake;
}
