/**
 * Cloudflare D1 data layer — the database behind every VinaX feature.
 *
 * Replaces the former Supabase/PostgREST integration wholesale: same helper
 * surface (select / insert / upsert / update / delete / count / rpc), now
 * executed as parameterized SQLite against the D1 binding `DB` declared in
 * wrangler.toml. No external service, no API keys, free-plan friendly.
 *
 * Query strings keep the compact PostgREST-style filter grammar the call
 * sites already use ("type=eq.play&created_at=gte.<iso>&select=a,b&order=
 * created_at.desc&limit=50") — translated here into WHERE/ORDER BY/LIMIT
 * with bound parameters. Identifiers (table + column names) are validated
 * against strict allow-patterns; values are always bound, never spliced.
 *
 * The schema is SELF-BOOTSTRAPPING: the first query on a fresh isolate
 * checks vinax_meta.schema_version and applies the DDL below when needed,
 * so a brand-new D1 database becomes fully usable on first deploy with no
 * manual console work.
 *
 * Timestamps are ISO-8601 UTC strings ("2026-08-25T05:12:33.123Z") end to
 * end — the same format the app already writes with new Date().toISOString()
 * — so lexicographic comparison equals chronological comparison.
 */

// ---------- Minimal structural types for the D1 binding (no SDK dep) ----------
export interface D1Result<T = unknown> {
  results?: T[];
  success?: boolean;
  meta?: { changes?: number };
}
export interface D1Stmt {
  bind(...values: unknown[]): D1Stmt;
  all<T = unknown>(): Promise<D1Result<T>>;
  run(): Promise<D1Result>;
  first<T = unknown>(): Promise<T | null>;
}
export interface D1Db {
  prepare(sql: string): D1Stmt;
  batch<T = unknown>(stmts: D1Stmt[]): Promise<D1Result<T>[]>;
}

export interface DbEnv {
  DB?: D1Db;
}

export function dbConfigured(env: DbEnv): boolean {
  return !!env.DB;
}

// ============================== SCHEMA ==============================
// Bump SCHEMA_VERSION when DDL below changes; new statements must be
// individually idempotent (IF NOT EXISTS) or guarded in ensureSchema.
const SCHEMA_VERSION = 1;

const SCHEMA_DDL: string[] = [
  `create table if not exists vinax_meta (key text primary key, value text)`,

  `create table if not exists vinax_users (
    device_id            text primary key,
    name                 text,
    username             text,
    platform             text,
    app_version          text,
    country              text,
    city                 text,
    region               text,
    current_song_title   text,
    current_song_artist  text,
    current_song_image   text,
    is_playing           integer default 0,
    first_seen           text default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    last_seen            text default (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  )`,
  `create unique index if not exists vinax_users_username_unique
     on vinax_users (lower(username)) where username is not null`,

  `create table if not exists vinax_events (
    id          integer primary key autoincrement,
    device_id   text,
    type        text,
    song_id     text,
    song_title  text,
    song_artist text,
    song_image  text,
    language    text,
    platform    text,
    app_version text,
    error_kind  text,
    message     text,
    country     text,
    city        text,
    region      text,
    origin_verified integer default 0,
    created_at  text default (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  )`,

  `create table if not exists vinax_feedback (
    id          integer primary key autoincrement,
    device_id   text,
    name        text,
    type        text,
    message     text,
    app_version text,
    platform    text,
    country     text,
    city        text,
    status      text default 'new',
    created_at  text default (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  )`,

  `create table if not exists vinax_blocklist (
    song_id    text primary key,
    song_title text,
    reason     text,
    created_at text default (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  )`,

  `create table if not exists vinax_ai_events (
    id          integer primary key autoincrement,
    created_at  text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    feature     text not null,
    model       text,
    ok          integer not null default 0,
    status      integer,
    error       text,
    client      text,
    latency_ms  integer
  )`,

  `create table if not exists vinax_rooms (
    code        text primary key,
    host_name   text,
    song        text,
    position    real default 0,
    playing     integer default 0,
    updated_at  text default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    created_at  text default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    host_token  text
  )`,

  `create table if not exists vinax_room_members (
    code       text,
    device_id  text,
    name       text,
    last_seen  text default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    reaction   text,
    reacted_at text,
    primary key (code, device_id)
  )`,

  `create table if not exists vinax_push_subscriptions (
    endpoint       text primary key,
    p256dh         text not null,
    auth           text not null,
    lang           text,
    country        text,
    region         text,
    city           text,
    tz_offset      integer,
    last_pushed_at text,
    active         integer not null default 1,
    updated_at     text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  )`,

  `create table if not exists vinax_fcm_tokens (
    token          text primary key,
    platform       text,
    lang           text,
    country        text,
    region         text,
    city           text,
    tz_offset      integer,
    last_pushed_at text,
    active         integer not null default 1,
    updated_at     text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  )`,

  `create table if not exists vinax_seo_urls (
    key         text primary key,
    type        text not null,
    entity_id   text not null,
    slug        text not null,
    title       text,
    lang        text,
    added_at    text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    lastmod     text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    expanded_at text,
    expand_page integer not null default 0
  )`,

  `create table if not exists vinax_config (
    key        text primary key,
    value      text not null,
    updated_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  )`,

  `create table if not exists vinax_experiments (
    key        text primary key,
    name       text,
    variants   text not null default '[]',
    active     integer not null default 0,
    created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  )`,

  `create index if not exists idx_vinax_users_last_seen   on vinax_users (last_seen desc)`,
  `create index if not exists idx_vinax_events_created    on vinax_events (created_at desc)`,
  `create index if not exists idx_vinax_events_device     on vinax_events (device_id)`,
  `create index if not exists idx_vinax_feedback_created  on vinax_feedback (created_at desc)`,
  `create index if not exists idx_vinax_room_members_seen on vinax_room_members (code, last_seen desc)`,
  `create index if not exists vinax_room_members_reacted_idx on vinax_room_members (code, reacted_at) where reaction is not null`,
  `create index if not exists vinax_ai_events_created_idx on vinax_ai_events (created_at desc)`,
  `create index if not exists vinax_ai_events_feature_idx on vinax_ai_events (feature)`,
  `create index if not exists idx_vinax_fcm_tokens_active on vinax_fcm_tokens (active, updated_at desc)`,
  `create index if not exists idx_vinax_push_subs_geo on vinax_push_subscriptions (country, region, city) where active = 1`,
  `create index if not exists idx_vinax_fcm_tokens_geo on vinax_fcm_tokens (country, region, city) where active = 1`,
  `create index if not exists vinax_seo_urls_type_added on vinax_seo_urls (type, added_at, key)`,
  // SQLite CREATE INDEX has no NULLS FIRST — the frontier query orders with
  // "nulls first" at query time instead; (type, expanded_at) still serves it.
  `create index if not exists vinax_seo_urls_frontier   on vinax_seo_urls (type, expanded_at)`,
];

// Applied once per isolate; concurrent callers share the same promise.
let ensured: Promise<boolean> | null = null;

async function ensureSchema(db: D1Db): Promise<boolean> {
  try {
    const row = await db
      .prepare(`select value from vinax_meta where key = 'schema_version'`)
      .first<{ value: string }>();
    if (row && Number(row.value) >= SCHEMA_VERSION) return true;
  } catch {
    /* vinax_meta missing — fresh database, fall through and create */
  }
  try {
    await db.batch(SCHEMA_DDL.map((sql) => db.prepare(sql)));
    await db
      .prepare(
        `insert into vinax_meta (key, value) values ('schema_version', ?)
         on conflict(key) do update set value = excluded.value`,
      )
      .bind(String(SCHEMA_VERSION))
      .run();
    return true;
  } catch {
    return false;
  }
}

async function ready(env: DbEnv): Promise<D1Db | null> {
  const db = env.DB;
  if (!db) return null;
  if (!ensured) ensured = ensureSchema(db);
  const ok = await ensured;
  if (!ok) {
    ensured = null; // let the next request retry a failed bootstrap
    return null;
  }
  return db;
}

/** Test-only: reset the per-isolate schema memo (fresh fake DB per test). */
export function __resetDbBootstrap(): void {
  ensured = null;
}

/** Apply the schema now (tests seed rows before calling any helper). */
export async function dbEnsureSchema(env: DbEnv): Promise<boolean> {
  return (await ready(env)) !== null;
}

// ============================== VALUE CODECS ==============================
// SQLite has no boolean/json types; these column sets round-trip them.
const BOOL_COLS = new Set(['is_playing', 'playing', 'active', 'ok', 'origin_verified']);
const JSON_COLS = new Set(['song', 'variants', 'value']);

const IDENT_RE = /^[a-z_][a-z0-9_]*$/;
const TABLE_RE = /^vinax_[a-z0-9_]+$/;

function assertTable(table: string): string {
  if (!TABLE_RE.test(table)) throw new Error(`bad table: ${table}`);
  return table;
}
function assertCol(col: string): string {
  if (!IDENT_RE.test(col)) throw new Error(`bad column: ${col}`);
  return col;
}

function encodeValue(v: unknown): unknown {
  if (v === undefined) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (v !== null && typeof v === 'object') return JSON.stringify(v);
  return v;
}

function decodeRow<T>(row: Record<string, unknown>): T {
  for (const k of Object.keys(row)) {
    const v = row[k];
    if (BOOL_COLS.has(k) && (v === 0 || v === 1)) row[k] = v === 1;
    else if (JSON_COLS.has(k) && typeof v === 'string' && v.length > 0) {
      try {
        row[k] = JSON.parse(v);
      } catch {
        /* leave as string */
      }
    }
  }
  return row as T;
}

// ============================== FILTER GRAMMAR ==============================
interface Parsed {
  where: string;
  params: unknown[];
  order: string;
  limit: number | null;
  offset: number | null;
  select: string;
}

function likePattern(raw: string): string {
  // PostgREST `*` wildcard → SQL `%`; escape literal % _ \ in between.
  return raw
    .split('*')
    .map((part) => part.replace(/([\\%_])/g, '\\$1'))
    .join('%');
}

function filterValue(raw: string): unknown {
  if (raw === 'true') return 1;
  if (raw === 'false') return 0;
  return raw;
}

/** One `col.op.value` (or `col=op.value`) condition → SQL + params. */
function condition(col: string, expr: string): { sql: string; params: unknown[] } {
  assertCol(col);
  if (expr === 'is.null') return { sql: `${col} is null`, params: [] };
  if (expr === 'not.is.null') return { sql: `${col} is not null`, params: [] };
  if (expr.startsWith('in.(') && expr.endsWith(')')) {
    const items = expr
      .slice(4, -1)
      .split(',')
      .map((s) => filterValue(decodeURIComponent(s)));
    if (items.length === 0) return { sql: '0', params: [] };
    return { sql: `${col} in (${items.map(() => '?').join(',')})`, params: items };
  }
  const dot = expr.indexOf('.');
  const op = dot === -1 ? 'eq' : expr.slice(0, dot);
  const raw = dot === -1 ? expr : expr.slice(dot + 1);
  const val = decodeURIComponent(raw);
  switch (op) {
    case 'eq':
      return { sql: `${col} = ?`, params: [filterValue(val)] };
    case 'neq':
      // Postgres <> semantics: null rows never match a neq filter.
      return { sql: `${col} <> ?`, params: [filterValue(val)] };
    case 'gt':
      return { sql: `${col} > ?`, params: [val] };
    case 'gte':
      return { sql: `${col} >= ?`, params: [val] };
    case 'lt':
      return { sql: `${col} < ?`, params: [val] };
    case 'lte':
      return { sql: `${col} <= ?`, params: [val] };
    case 'ilike':
    case 'like':
      return { sql: `${col} like ? escape '\\'`, params: [likePattern(val)] };
    default:
      throw new Error(`bad op: ${op}`);
  }
}

function parseQuery(query: string): Parsed {
  const where: string[] = [];
  const params: unknown[] = [];
  let order = '';
  let limit: number | null = null;
  let offset: number | null = null;
  let select = '*';

  for (const part of query.split('&')) {
    if (!part) continue;
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const key = part.slice(0, eq);
    const value = part.slice(eq + 1);

    if (key === 'select') {
      const cols = value.split(',').map((c) => decodeURIComponent(c).trim());
      if (cols.length && !cols.includes('*')) select = cols.map(assertCol).join(', ');
      continue;
    }
    if (key === 'order') {
      const terms = value.split(',').map((t) => {
        const bits = decodeURIComponent(t).split('.');
        const col = assertCol(bits[0]);
        const dir = bits[1] === 'desc' ? 'desc' : 'asc';
        let nulls = dir === 'desc' ? 'nulls last' : 'nulls last';
        if (bits.includes('nullsfirst')) nulls = 'nulls first';
        if (bits.includes('nullslast')) nulls = 'nulls last';
        return `${col} ${dir} ${nulls}`;
      });
      order = ` order by ${terms.join(', ')}`;
      continue;
    }
    if (key === 'limit') {
      const n = Number(value);
      if (Number.isFinite(n)) limit = Math.max(0, Math.floor(n));
      continue;
    }
    if (key === 'offset') {
      const n = Number(value);
      if (Number.isFinite(n)) offset = Math.max(0, Math.floor(n));
      continue;
    }
    if (key === 'on_conflict') continue;
    if (key === 'or') {
      // or=(a.ilike.*x*,b.eq.y) — commas inside values are %-encoded, so a
      // raw split on ',' is safe; each item is col.op[.value].
      const inner = value.startsWith('(') && value.endsWith(')') ? value.slice(1, -1) : value;
      const parts = inner.split(',').filter(Boolean);
      const group: string[] = [];
      for (const item of parts) {
        const d = item.indexOf('.');
        if (d === -1) continue;
        const c = condition(item.slice(0, d), item.slice(d + 1));
        group.push(c.sql);
        params.push(...c.params);
      }
      if (group.length) where.push(`(${group.join(' or ')})`);
      continue;
    }
    const c = condition(key, value);
    where.push(c.sql);
    params.push(...c.params);
  }

  return {
    where: where.length ? ` where ${where.join(' and ')}` : '',
    params,
    order,
    limit,
    offset,
    select,
  };
}

// ============================== CRUD HELPERS ==============================

export async function dbSelectRes<T>(
  env: DbEnv,
  table: string,
  query: string,
): Promise<{ ok: boolean; rows: T[] }> {
  const db = await ready(env);
  if (!db) return { ok: false, rows: [] };
  try {
    const q = parseQuery(query);
    let sql = `select ${q.select} from ${assertTable(table)}${q.where}${q.order}`;
    if (q.limit !== null) sql += ` limit ${q.limit}`;
    if (q.offset !== null) sql += `${q.limit === null ? ' limit -1' : ''} offset ${q.offset}`;
    const res = await db.prepare(sql).bind(...q.params).all<Record<string, unknown>>();
    return { ok: true, rows: (res.results ?? []).map((r) => decodeRow<T>(r)) };
  } catch {
    return { ok: false, rows: [] };
  }
}

export async function dbSelect<T>(env: DbEnv, table: string, query: string): Promise<T[]> {
  return (await dbSelectRes<T>(env, table, query)).rows;
}

/** Chunked multi-row insert honoring D1's ~100 bound-params-per-statement cap. */
function insertStatements(
  db: D1Db,
  table: string,
  rows: Record<string, unknown>[],
  head: string,
  tail: string,
): D1Stmt[] {
  const cols = Object.keys(rows[0]).map(assertCol);
  const perRow = cols.length;
  const chunkRows = Math.max(1, Math.floor(90 / Math.max(1, perRow)));
  const stmts: D1Stmt[] = [];
  for (let i = 0; i < rows.length; i += chunkRows) {
    const chunk = rows.slice(i, i + chunkRows);
    const placeholders = chunk.map(() => `(${cols.map(() => '?').join(',')})`).join(',');
    const params: unknown[] = [];
    for (const row of chunk) for (const c of cols) params.push(encodeValue(row[c]));
    stmts.push(
      db
        .prepare(`${head} into ${assertTable(table)} (${cols.join(',')}) values ${placeholders}${tail}`)
        .bind(...params),
    );
  }
  return stmts;
}

export async function dbInsert(env: DbEnv, table: string, row: unknown): Promise<boolean> {
  const db = await ready(env);
  if (!db) return false;
  try {
    const rows = (Array.isArray(row) ? row : [row]) as Record<string, unknown>[];
    if (rows.length === 0) return true;
    await db.batch(insertStatements(db, table, rows, 'insert', ''));
    return true;
  } catch {
    return false;
  }
}

/**
 * INSERT that skips conflicting rows and RETURNS the rows actually inserted
 * (length 0 = everything collided). Mirrors PostgREST's ignore-duplicates
 * contract the seo corpus + room-create paths rely on.
 */
export async function dbInsertIgnore<T>(
  env: DbEnv,
  table: string,
  row: unknown,
  _onConflict: string,
): Promise<T[] | null> {
  const db = await ready(env);
  if (!db) return null;
  try {
    const rows = (Array.isArray(row) ? row : [row]) as Record<string, unknown>[];
    if (rows.length === 0) return [];
    const stmts = insertStatements(db, table, rows, 'insert or ignore', ' returning *');
    const results = await db.batch<Record<string, unknown>>(stmts);
    const out: T[] = [];
    for (const res of results) for (const r of res.results ?? []) out.push(decodeRow<T>(r));
    return out;
  } catch {
    return null;
  }
}

export async function dbUpsert(
  env: DbEnv,
  table: string,
  row: unknown,
  onConflict: string,
): Promise<boolean> {
  const db = await ready(env);
  if (!db) return false;
  try {
    const rows = (Array.isArray(row) ? row : [row]) as Record<string, unknown>[];
    if (rows.length === 0) return true;
    const keys = onConflict.split(',').map((k) => assertCol(k.trim()));
    const cols = Object.keys(rows[0]).map(assertCol);
    const updates = cols.filter((c) => !keys.includes(c));
    const tail =
      ` on conflict(${keys.join(',')}) do ` +
      (updates.length ? `update set ${updates.map((c) => `${c} = excluded.${c}`).join(', ')}` : 'nothing');
    await db.batch(insertStatements(db, table, rows, 'insert', tail));
    return true;
  } catch {
    return false;
  }
}

export async function dbCount(env: DbEnv, table: string, query = ''): Promise<number | null> {
  const db = await ready(env);
  if (!db) return null;
  try {
    const q = parseQuery(query);
    const row = await db
      .prepare(`select count(*) as c from ${assertTable(table)}${q.where}`)
      .bind(...q.params)
      .first<{ c: number }>();
    return row ? Number(row.c) : null;
  } catch {
    return null;
  }
}

export async function dbDelete(env: DbEnv, table: string, query: string): Promise<boolean> {
  const db = await ready(env);
  if (!db) return false;
  try {
    const q = parseQuery(query);
    await db.prepare(`delete from ${assertTable(table)}${q.where}`).bind(...q.params).run();
    return true;
  } catch {
    return false;
  }
}

export async function dbDeleteReturning<T>(
  env: DbEnv,
  table: string,
  query: string,
): Promise<T[] | null> {
  const db = await ready(env);
  if (!db) return null;
  try {
    const q = parseQuery(query);
    const res = await db
      .prepare(`delete from ${assertTable(table)}${q.where} returning *`)
      .bind(...q.params)
      .all<Record<string, unknown>>();
    return (res.results ?? []).map((r) => decodeRow<T>(r));
  } catch {
    return null;
  }
}

export async function dbUpdate(
  env: DbEnv,
  table: string,
  query: string,
  patch: unknown,
): Promise<boolean> {
  const db = await ready(env);
  if (!db) return false;
  try {
    const q = parseQuery(query);
    const obj = (patch ?? {}) as Record<string, unknown>;
    const cols = Object.keys(obj).filter((c) => obj[c] !== undefined).map(assertCol);
    if (cols.length === 0) return true;
    const sets = cols.map((c) => `${c} = ?`).join(', ');
    const params = cols.map((c) => encodeValue(obj[c]));
    await db
      .prepare(`update ${assertTable(table)} set ${sets}${q.where}`)
      .bind(...params, ...q.params)
      .run();
    return true;
  } catch {
    return false;
  }
}

// ============================== ANALYTICS (former Postgres RPCs) ==============================

const iso = (msAgo: number): string => new Date(Date.now() - msAgo).toISOString();
const daysAgo = (d: number): string => iso(d * 86_400_000);
const DAY = `substr(created_at, 1, 10)`;

async function rows<T>(db: D1Db, sql: string, params: unknown[]): Promise<T[]> {
  const res = await db.prepare(sql).bind(...params).all<Record<string, unknown>>();
  return (res.results ?? []).map((r) => decodeRow<T>(r));
}

async function scalarBatch(db: D1Db, pairs: [string, string, unknown[]][]): Promise<Record<string, number>> {
  const results = await db.batch<{ c: number }>(pairs.map(([, sql, params]) => db.prepare(sql).bind(...params)));
  const out: Record<string, number> = {};
  pairs.forEach(([name], i) => {
    out[name] = Number(results[i]?.results?.[0]?.c ?? 0);
  });
  return out;
}

type RpcArgs = Record<string, unknown>;
const num = (v: unknown, dflt: number): number => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : dflt;
};

const RPCS: Record<string, (db: D1Db, a: RpcArgs) => Promise<unknown>> = {
  vinax_top_songs: (db, a) =>
    rows(
      db,
      `select song_title, song_artist, max(song_image) as song_image, count(*) as plays
       from vinax_events
       where type = 'play' and song_title is not null and created_at > ?
       group by song_title, song_artist order by plays desc limit ?`,
      [daysAgo(num(a.days, 7)), num(a.lim, 25)],
    ),

  vinax_top_artists: (db, a) =>
    rows(
      db,
      `select song_artist, count(*) as plays from vinax_events
       where type = 'play' and song_artist is not null and created_at > ?
       group by song_artist order by plays desc limit ?`,
      [daysAgo(num(a.days, 7)), num(a.lim, 25)],
    ),

  vinax_top_languages: (db, a) =>
    rows(
      db,
      `select coalesce(language, 'unknown') as language, count(*) as plays
       from vinax_events where type = 'play' and created_at > ?
       group by coalesce(language, 'unknown') order by plays desc limit ?`,
      [daysAgo(num(a.days, 7)), num(a.lim, 20)],
    ),

  vinax_plays_by_day: (db, a) =>
    rows(
      db,
      `select ${DAY} as day, count(*) as plays from vinax_events
       where type = 'play' and created_at > ? group by 1 order by 1`,
      [daysAgo(num(a.days, 14))],
    ),

  vinax_geo: (db, a) =>
    rows(
      db,
      `select coalesce(country, '??') as country, coalesce(city, 'Unknown') as city,
              count(distinct device_id) as listeners,
              count(*) filter (where type = 'play') as plays
       from vinax_events where created_at > ?
       group by 1, 2 order by listeners desc`,
      [daysAgo(num(a.days, 7))],
    ),

  vinax_platforms: (db) =>
    rows(
      db,
      `select coalesce(platform, 'web') as platform, count(*) as listeners
       from vinax_users group by 1 order by listeners desc`,
      [],
    ),

  vinax_user_summary: (db) =>
    scalarBatch(db, [
      ['total_users', `select count(*) as c from vinax_users`, []],
      ['active_24h', `select count(*) as c from vinax_users where last_seen > ?`, [daysAgo(1)]],
      ['new_24h', `select count(*) as c from vinax_users where first_seen > ?`, [daysAgo(1)]],
      ['total_plays', `select count(*) as c from vinax_events where type = 'play'`, []],
    ]),

  vinax_versions: (db) =>
    rows(
      db,
      `select coalesce(app_version, 'unknown') as app_version,
              coalesce(platform, 'web') as platform, count(*) as users
       from vinax_users group by 1, 2 order by users desc`,
      [],
    ),

  vinax_errors: (db, a) =>
    rows(
      db,
      `select coalesce(error_kind, 'error') as error_kind, coalesce(message, '') as message,
              count(*) as hits, max(created_at) as last_seen
       from vinax_events where type = 'error' and created_at > ?
       group by 1, 2 order by hits desc limit ?`,
      [daysAgo(num(a.days, 7)), num(a.lim, 50)],
    ),

  vinax_errors_by_day: (db, a) =>
    rows(
      db,
      `select ${DAY} as day, count(*) as hits from vinax_events
       where type = 'error' and created_at > ? group by 1 order by 1`,
      [daysAgo(num(a.days, 14))],
    ),

  vinax_tech_summary: (db) =>
    scalarBatch(db, [
      ['errors_24h', `select count(*) as c from vinax_events where type = 'error' and created_at > ?`, [daysAgo(1)]],
      ['plays_24h', `select count(*) as c from vinax_events where type = 'play' and created_at > ?`, [daysAgo(1)]],
      ['active_sessions', `select count(*) as c from vinax_users where last_seen > ?`, [iso(5 * 60_000)]],
      ['versions', `select count(distinct app_version) as c from vinax_users where app_version is not null`, []],
    ]),

  vinax_blockable_songs: (db, a) =>
    rows(
      db,
      `select song_id, max(song_title) as song_title, max(song_artist) as song_artist, count(*) as plays
       from vinax_events where type = 'play' and song_id is not null and created_at > ?
       group by song_id order by plays desc limit ?`,
      [daysAgo(num(a.days, 30)), num(a.lim, 40)],
    ),

  vinax_overview: (db) =>
    scalarBatch(db, [
      ['active_now', `select count(*) as c from vinax_users where last_seen > ?`, [iso(60_000)]],
      ['total_users', `select count(*) as c from vinax_users`, []],
      ['new_today', `select count(*) as c from vinax_users where first_seen > ?`, [daysAgo(1)]],
      ['plays_today', `select count(*) as c from vinax_events where type='play' and created_at > ?`, [daysAgo(1)]],
      ['plays_7d', `select count(*) as c from vinax_events where type='play' and created_at > ?`, [daysAgo(7)]],
      ['errors_24h', `select count(*) as c from vinax_events where type='error' and created_at > ?`, [daysAgo(1)]],
      ['dau', `select count(distinct device_id) as c from vinax_events where created_at > ?`, [daysAgo(1)]],
      ['wau', `select count(distinct device_id) as c from vinax_events where created_at > ?`, [daysAgo(7)]],
      ['mau', `select count(distinct device_id) as c from vinax_events where created_at > ?`, [daysAgo(30)]],
      ['feedback_new', `select count(*) as c from vinax_feedback where status = 'new'`, []],
    ]),

  vinax_new_users_by_day: (db, a) =>
    rows(
      db,
      `select substr(first_seen, 1, 10) as day, count(*) as users from vinax_users
       where first_seen > ? group by 1 order by 1`,
      [daysAgo(num(a.days, 14))],
    ),

  vinax_plays_by_hour: (db, a) =>
    rows(
      db,
      `select cast(substr(created_at, 12, 2) as integer) as hour, count(*) as plays
       from vinax_events where type='play' and created_at > ? group by 1 order by 1`,
      [daysAgo(num(a.days, 7))],
    ),

  vinax_trending: (db, a) => {
    const d = num(a.days, 7);
    return rows(
      db,
      `with cur as (
         select song_title, song_artist, max(song_image) as img, count(*) as c
         from vinax_events
         where type='play' and song_title is not null and created_at > ?
         group by song_title, song_artist
       ),
       prev as (
         select song_title, song_artist, count(*) as c
         from vinax_events
         where type='play' and song_title is not null and created_at <= ? and created_at > ?
         group by song_title, song_artist
       )
       select cur.song_title, cur.song_artist, cur.img as song_image,
              cur.c as plays, coalesce(prev.c, 0) as prev_plays
       from cur left join prev
         on prev.song_title = cur.song_title and prev.song_artist = cur.song_artist
       order by (cur.c - coalesce(prev.c, 0)) desc, cur.c desc limit ?`,
      [daysAgo(d), daysAgo(d), daysAgo(d * 2), num(a.lim, 15)],
    );
  },

  vinax_top_listeners: (db, a) =>
    rows(
      db,
      `select e.device_id, max(u.name) as name, max(u.username) as username, count(*) as plays
       from vinax_events e left join vinax_users u on u.device_id = e.device_id
       where e.type='play' and e.created_at > ?
       group by e.device_id order by plays desc limit ?`,
      [daysAgo(num(a.days, 7)), num(a.lim, 20)],
    ),

  vinax_languages: (db, a) =>
    rows(
      db,
      `select coalesce(language, 'unknown') as language, count(*) as plays,
              count(distinct device_id) as listeners
       from vinax_events where type='play' and created_at > ?
       group by 1 order by plays desc`,
      [daysAgo(num(a.days, 7))],
    ),

  vinax_segments: (db) =>
    scalarBatch(db, [
      ['new_7d', `select count(*) as c from vinax_users where first_seen > ?`, [daysAgo(7)]],
      ['returning_7d', `select count(*) as c from vinax_users where last_seen > ? and first_seen <= ?`, [daysAgo(7), daysAgo(7)]],
      ['inactive_30d', `select count(*) as c from vinax_users where last_seen <= ? and last_seen > ?`, [daysAgo(7), daysAgo(30)]],
      [
        'power_users',
        `select count(*) as c from (
           select device_id from vinax_events
           where type='play' and created_at > ?
           group by device_id having count(*) >= 20
         )`,
        [daysAgo(30)],
      ],
    ]),

  vinax_retention: (db, a) =>
    rows(
      db,
      `with firsts as (
         select device_id, min(created_at) as first_at
         from vinax_events
         where device_id is not null and device_id <> 'admin'
         group by device_id
       ),
       cohorts as (
         select device_id, first_at,
                date(substr(first_at, 1, 10),
                     '-' || ((cast(strftime('%w', substr(first_at, 1, 10)) as integer) + 6) % 7) || ' days')
                  as cohort_week
         from firsts where first_at >= ?
       ),
       marked as (
         select c.cohort_week, c.device_id,
                max(case when julianday(replace(substr(e.created_at,1,23),'T',' '))
                          - julianday(replace(substr(c.first_at,1,23),'T',' ')) >= 1
                      and julianday(replace(substr(e.created_at,1,23),'T',' '))
                          - julianday(replace(substr(c.first_at,1,23),'T',' ')) < 2
                     then 1 else 0 end) as r1,
                max(case when julianday(replace(substr(e.created_at,1,23),'T',' '))
                          - julianday(replace(substr(c.first_at,1,23),'T',' ')) >= 2
                      and julianday(replace(substr(e.created_at,1,23),'T',' '))
                          - julianday(replace(substr(c.first_at,1,23),'T',' ')) < 8
                     then 1 else 0 end) as r7,
                max(case when julianday(replace(substr(e.created_at,1,23),'T',' '))
                          - julianday(replace(substr(c.first_at,1,23),'T',' ')) >= 8
                      and julianday(replace(substr(e.created_at,1,23),'T',' '))
                          - julianday(replace(substr(c.first_at,1,23),'T',' ')) < 31
                     then 1 else 0 end) as r30
         from cohorts c join vinax_events e on e.device_id = c.device_id
         group by c.cohort_week, c.device_id
       )
       select cohort_week, count(*) as cohort_size,
              sum(r1) as d1, sum(r7) as d7, sum(r30) as d30
       from marked group by cohort_week order by cohort_week desc`,
      [daysAgo(num(a.p_weeks, 8) * 7)],
    ),

  vinax_ai_metrics: async (db, a) => {
    const since = daysAgo(Math.max(num(a.p_days, 7), 1));
    const counts = await scalarBatch(db, [
      ['total', `select count(*) as c from vinax_ai_events where created_at >= ?`, [since]],
      ['ok', `select count(*) as c from vinax_ai_events where created_at >= ? and ok = 1`, [since]],
      ['fail', `select count(*) as c from vinax_ai_events where created_at >= ? and ok = 0`, [since]],
      [
        'avg_latency_ms',
        `select coalesce(cast(round(avg(latency_ms)) as integer), 0) as c
         from vinax_ai_events where created_at >= ? and latency_ms is not null`,
        [since],
      ],
    ]);
    const byFeature = await rows(
      db,
      `select feature, count(*) as total, count(*) filter (where ok = 1) as ok,
              count(*) filter (where ok = 0) as fail
       from vinax_ai_events where created_at >= ? group by feature order by total desc`,
      [since],
    );
    const byModel = await rows(
      db,
      `select coalesce(model, '(none)') as model, count(*) as count
       from vinax_ai_events where created_at >= ? group by model order by count desc`,
      [since],
    );
    const byClient = await rows(
      db,
      `select coalesce(client, '(unknown)') as client, count(*) as count
       from vinax_ai_events where created_at >= ? group by client order by count desc`,
      [since],
    );
    const byError = await rows(
      db,
      `select error, count(*) as count from vinax_ai_events
       where created_at >= ? and error is not null
       group by error order by count desc limit 12`,
      [since],
    );
    const byDay = await rows(
      db,
      `select ${DAY} as day, count(*) as total, count(*) filter (where ok = 1) as ok,
              count(*) filter (where ok = 0) as fail
       from vinax_ai_events where created_at >= ? group by 1 order by 1`,
      [since],
    );
    const recent = await rows(
      db,
      `select replace(substr(created_at, 1, 19), 'T', ' ') as ts, feature,
              coalesce(model, '') as model, ok, status, error, client, latency_ms
       from vinax_ai_events where created_at >= ?
       order by created_at desc limit 30`,
      [since],
    );
    return {
      ...counts,
      by_feature: byFeature,
      by_model: byModel,
      by_client: byClient,
      by_error: byError,
      by_day: byDay,
      recent,
    };
  },

  /**
   * Atomic-enough append to a room's requests[] list (former plpgsql
   * vinax_room_append_request). D1 serializes writes on a single primary, so
   * the read-modify-write window is tiny; de-dupe + the 20-entry cap follow
   * the original function exactly.
   */
  vinax_room_append_request: async (db, a) => {
    const code = String(a.p_code ?? '');
    const song = a.p_song as Record<string, unknown> | null;
    const by = typeof a.p_by === 'string' ? a.p_by : '';
    const row = await db
      .prepare(`select song from vinax_rooms where code = ?`)
      .bind(code)
      .first<{ song: string | null }>();
    if (!row) return null;
    let parsed: Record<string, unknown> | null = null;
    try {
      parsed = row.song ? (JSON.parse(row.song) as Record<string, unknown>) : null;
    } catch {
      /* malformed json — treat as legacy v1 shape */
    }
    let current: unknown = parsed;
    let queue: unknown[] = [];
    let requests: { song?: Record<string, unknown> | null; by?: string | null }[] = [];
    if (parsed && parsed.v === '2') {
      current = parsed.current ?? null;
      queue = Array.isArray(parsed.queue) ? parsed.queue : [];
      requests = Array.isArray(parsed.requests)
        ? (parsed.requests as { song?: Record<string, unknown> | null; by?: string | null }[])
        : [];
    }
    const newId = song && typeof song.id === 'string' ? song.id : '';
    if (newId) {
      const inQueue = queue.some(
        (e) => (e as { song?: { id?: unknown } })?.song?.id === newId,
      );
      const inReq = requests.some((e) => e?.song?.id === newId);
      if (inQueue || inReq) return {}; // already present, ignore
    }
    requests.push({ song, by: by || null });
    if (requests.length > 20) requests = requests.slice(-20);
    await db
      .prepare(`update vinax_rooms set song = ? where code = ?`)
      .bind(JSON.stringify({ v: '2', current, queue, requests }), code)
      .run();
    return {};
  },
};

/** Run a named analytics query (the former PostgREST /rpc/<fn> surface). */
export async function dbRpc<T>(env: DbEnv, fn: string, args: Record<string, unknown>): Promise<T | null> {
  const db = await ready(env);
  if (!db) return null;
  const impl = RPCS[fn];
  if (!impl) return null;
  try {
    return (await impl(db, args ?? {})) as T;
  } catch {
    return null;
  }
}
