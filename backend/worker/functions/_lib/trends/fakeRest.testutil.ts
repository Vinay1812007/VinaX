/**
 * Test-only: an in-memory stand-in for the database's REST surface, just
 * large enough for the trend tables. It honours the parts the trend code
 * relies on — the unique keys from the migration, `on_conflict` with
 * ignore-duplicates / merge-duplicates, `return=representation`, eq / in /
 * gt / gte / lt / lte / is / not.is filters, order and limit, identity ids and
 * the snapshot → observation cascade — so idempotency is tested against the
 * same rules the real tables enforce. Never imported by Worker code.
 */

type Row = Record<string, unknown>;

const UNIQUE: Record<string, string[][]> = {
  vinax_trend_runs: [['id']],
  vinax_trend_snapshots: [['source', 'region', 'chart', 'snapshot_key']],
  vinax_trend_observations: [['snapshot_id', 'source_item_id'], ['snapshot_id', 'source_rank']],
  vinax_trend_matches: [['source', 'source_item_id']],
  vinax_trend_editorial: [['dedupe_key']],
  vinax_feedback: [],
};
const IDENTITY = new Set(['vinax_trend_snapshots', 'vinax_trend_observations', 'vinax_trend_matches', 'vinax_trend_editorial', 'vinax_feedback']);

export interface FakeRest {
  tables: Record<string, Row[]>;
  /** Tables that answer with this HTTP status instead of working. */
  failing: Map<string, number>;
  requests: Array<{ method: string; table: string; query: string }>;
  handle(url: string, init?: RequestInit): Promise<Response> | null;
  insert(table: string, row: Row): Row;
}

function cmp(a: unknown, b: unknown): number {
  const na = typeof a === 'number' ? a : Number.NaN;
  const nb = typeof b === 'number' ? b : Number(b);
  if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
  const sa = String(a ?? '');
  const sb = String(b ?? '');
  // Timestamps: compare as instants when both parse.
  const ta = Date.parse(sa);
  const tb = Date.parse(sb);
  if (/^\d{4}-\d{2}-\d{2}T/.test(sa) && /^\d{4}-\d{2}-\d{2}T/.test(sb) && Number.isFinite(ta) && Number.isFinite(tb)) return ta - tb;
  return sa < sb ? -1 : sa > sb ? 1 : 0;
}

function parseList(v: string): string[] {
  const inner = v.replace(/^\(/, '').replace(/\)$/, '');
  const out: string[] = [];
  const re = /"((?:[^"\\]|\\.)*)"|([^,]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(inner))) out.push(m[1] !== undefined ? m[1] : m[2]);
  return out;
}

function matches(row: Row, col: string, expr: string): boolean {
  const v = row[col];
  if (expr.startsWith('not.is.')) return !(expr.slice(7) === 'null' ? v === null || v === undefined : String(v) === expr.slice(7));
  const dot = expr.indexOf('.');
  const op = expr.slice(0, dot);
  const val = expr.slice(dot + 1);
  switch (op) {
    case 'eq':
      return typeof v === 'boolean' ? String(v) === val : typeof v === 'number' ? v === Number(val) : String(v ?? '') === val;
    case 'neq':
      return String(v ?? '') !== val;
    case 'in':
      return parseList(val).some((x) => (typeof v === 'number' ? v === Number(x) : String(v ?? '') === x));
    case 'is':
      return val === 'null' ? v === null || v === undefined : String(v) === val;
    case 'gt':
      return v !== null && v !== undefined && cmp(v, val) > 0;
    case 'gte':
      return v !== null && v !== undefined && cmp(v, val) >= 0;
    case 'lt':
      return v !== null && v !== undefined && cmp(v, val) < 0;
    case 'lte':
      return v !== null && v !== undefined && cmp(v, val) <= 0;
    default:
      throw new Error(`fakeRest: unsupported operator ${op}`);
  }
}

interface Query {
  filters: Array<[string, string]>;
  order: Array<{ col: string; desc: boolean; nullsLast: boolean }>;
  limit: number | null;
  onConflict: string[] | null;
}

function parseQuery(qs: string): Query {
  const q: Query = { filters: [], order: [], limit: null, onConflict: null };
  for (const part of qs.split('&').filter(Boolean)) {
    const i = part.indexOf('=');
    const key = decodeURIComponent(part.slice(0, i));
    const value = decodeURIComponent(part.slice(i + 1));
    if (key === 'select') continue;
    if (key === 'limit') q.limit = Number(value);
    else if (key === 'order')
      q.order = value.split(',').map((o) => {
        const bits = o.split('.');
        return { col: bits[0], desc: bits[1] === 'desc', nullsLast: bits.includes('nullslast') };
      });
    else if (key === 'on_conflict') q.onConflict = value.split(',');
    else q.filters.push([key, value]);
  }
  return q;
}

function select(rows: Row[], q: Query): Row[] {
  let out = rows.filter((r) => q.filters.every(([c, e]) => matches(r, c, e)));
  if (q.order.length) {
    out = [...out].sort((a, b) => {
      for (const o of q.order) {
        const av = a[o.col];
        const bv = b[o.col];
        const an = av === null || av === undefined;
        const bn = bv === null || bv === undefined;
        if (an || bn) {
          if (an && bn) continue;
          return an ? (o.nullsLast ? 1 : -1) : o.nullsLast ? -1 : 1;
        }
        const c = cmp(av, bv);
        if (c !== 0) return o.desc ? -c : c;
      }
      return 0;
    });
  }
  return q.limit !== null ? out.slice(0, q.limit) : out;
}

const reply = (body: unknown, status = 200): Response => new Response(body === null ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

export function createFakeRest(base = 'https://sb.test'): FakeRest {
  const tables: Record<string, Row[]> = {};
  const seq: Record<string, number> = {};
  const failing = new Map<string, number>();
  const requests: FakeRest['requests'] = [];
  const t = (name: string): Row[] => (tables[name] ??= []);

  const conflictWith = (table: string, row: Row, keys?: string[][]): Row | null => {
    for (const cols of keys ?? UNIQUE[table] ?? []) {
      const hit = t(table).find((r) => cols.every((c) => String(r[c]) === String(row[c])));
      if (hit) return hit;
    }
    return null;
  };

  const insert = (table: string, row: Row): Row => {
    const copy: Row = { ...row };
    if (IDENTITY.has(table) && copy.id === undefined) copy.id = (seq[table] = (seq[table] ?? 0) + 1);
    t(table).push(copy);
    return copy;
  };

  const handle = (url: string, init?: RequestInit): Promise<Response> | null => {
    if (!url.startsWith(`${base}/rest/v1/`)) return null;
    const rest = url.slice(`${base}/rest/v1/`.length);
    const qi = rest.indexOf('?');
    const table = qi < 0 ? rest : rest.slice(0, qi);
    const qs = qi < 0 ? '' : rest.slice(qi + 1);
    const method = (init?.method ?? 'GET').toUpperCase();
    requests.push({ method, table, query: qs });
    const fail = failing.get(table);
    if (fail) return Promise.resolve(reply({ message: 'failing' }, fail));
    const q = parseQuery(qs);
    const prefer = String((init?.headers as Record<string, string> | undefined)?.prefer ?? '');

    if (method === 'GET') return Promise.resolve(reply(select(t(table), q)));
    if (method === 'DELETE') {
      const gone = select(t(table), { ...q, order: [], limit: null });
      tables[table] = t(table).filter((r) => !gone.includes(r));
      if (table === 'vinax_trend_snapshots') {
        const ids = new Set(gone.map((r) => r.id));
        tables.vinax_trend_observations = t('vinax_trend_observations').filter((o) => !ids.has(o.snapshot_id));
      }
      return Promise.resolve(prefer.includes('return=representation') ? reply(gone) : reply(null, 204));
    }
    if (method === 'PATCH') {
      const patch = JSON.parse(String(init?.body ?? '{}')) as Row;
      const hit = select(t(table), { ...q, order: [], limit: null });
      for (const r of hit) Object.assign(r, patch);
      return Promise.resolve(reply(null, 204));
    }
    if (method === 'POST') {
      const body = JSON.parse(String(init?.body ?? 'null')) as Row | Row[];
      const list = Array.isArray(body) ? body : [body];
      const keys = q.onConflict ? [q.onConflict] : undefined;
      const out: Row[] = [];
      for (const row of list) {
        const clash = conflictWith(table, row, keys) ?? (keys ? conflictWith(table, row) : null);
        if (clash) {
          if (prefer.includes('ignore-duplicates')) continue;
          if (prefer.includes('merge-duplicates')) {
            Object.assign(clash, row);
            out.push(clash);
            continue;
          }
          return Promise.resolve(reply({ code: '23505', message: 'duplicate key' }, 409));
        }
        out.push(insert(table, row));
      }
      return Promise.resolve(prefer.includes('return=representation') ? reply(out, 201) : reply(null, 201));
    }
    return Promise.resolve(reply({ message: 'method' }, 405));
  };

  return { tables, failing, requests, handle, insert };
}
