/** User Management: paginated + searchable user list with summary counts.
 *
 *  13.6.4 — two sources. `vinax_users` is the usage-sharing record: a row
 *  appears only after the listener ticks "share usage" (unticked by default)
 *  and the app posts its first event. Since 13.0 every listener signs in with
 *  Google first, which writes `vinax_accounts` — so a new listener who never
 *  opted in had no row here at all and the page looked frozen. The list now
 *  merges both: usage rows (with the linked account's name and username when
 *  the device is linked) plus one row per signed-in account that has no linked
 *  device yet (`device_id` = `account:<google id>`, no location or plays).
 *  The email is never sent to the console. */
import { adminJson, dbFailure, isAdminAsync, unauthorized, type AdminEnv } from '../../_lib/admin';
import {
  sbCountResult,
  sbRpcResult,
  sbSelectResult,
  supabaseConfigured,
  type DbResult,
  type SupabaseEnv,
} from '../../_lib/supabase';

type Env = AdminEnv & SupabaseEnv;

/** Prefix of an account-only row's id in the list, the drill-down and delete. */
export const ACCOUNT_ROW_PREFIX = 'account:';

interface UserRow {
  device_id: string;
  name: string | null;
  username?: string | null;
  platform: string | null;
  country: string | null;
  city: string | null;
  is_playing: boolean | null;
  first_seen: string;
  last_seen: string;
  /** 13.6.4 — 'account' = signed in, not sharing usage; absent = usage row. */
  kind?: 'account';
  /** 13.6.4 — the usage row belongs to a signed-in account. */
  signed_in?: boolean;
}
interface AccountRow {
  google_sub: string;
  name: string | null;
  username: string | null;
  device_id: string | null;
  created_at: string;
  last_seen: string;
}
interface Summary {
  total_users: number;
  active_24h: number;
  new_24h: number;
  total_plays: number;
  /** 13.6.4 — every signed-in account, linked to a usage row or not. */
  accounts_total?: number | null;
}

/** Supabase answers at most 1000 rows per request (its max-rows default). */
const CHUNK = 1000;
/** Deepest merged position served: the CSV export walks 100 pages of 100. */
const MAX_WINDOW = 10_100;

/** The first `count` rows of an ordered query, read in chunks of CHUNK. */
async function readWindow<T>(env: Env, table: string, query: string, count: number): Promise<DbResult<T>> {
  const rows: T[] = [];
  for (let from = 0; from < count; from += CHUNK) {
    const take = Math.min(CHUNK, count - from);
    const r = await sbSelectResult<T>(env, table, `${query}&limit=${take}&offset=${from}`);
    if (!r.ok) return r;
    rows.push(...r.rows);
    if (r.rows.length < take) break;
  }
  return { ok: true, rows };
}

const newerFirst = (a: UserRow, b: UserRow): number => {
  const d = Date.parse(b.last_seen) - Date.parse(a.last_seen);
  return d || (a.device_id < b.device_id ? -1 : a.device_id > b.device_id ? 1 : 0);
};

export function accountToRow(a: AccountRow): UserRow {
  return {
    device_id: ACCOUNT_ROW_PREFIX + a.google_sub,
    kind: 'account',
    name: a.name,
    username: a.username,
    platform: null,
    country: null,
    city: null,
    is_playing: false,
    first_seen: a.created_at,
    last_seen: a.last_seen,
  };
}

export const onRequestGet = async (context: { request: Request; env: Env }): Promise<Response> => {
  const { request, env } = context;
  if (!(await isAdminAsync(request, env))) return unauthorized();

  const url = new URL(request.url);
  const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') ?? '50', 10) || 50, 1), 100);
  const offset = Math.min(Math.max(parseInt(url.searchParams.get('offset') ?? '0', 10) || 0, 0), MAX_WINDOW - limit - 1);
  // PostgREST treats , ( ) as or=() filter syntax and * % as wildcards —
  // strip them so a crafted q can't reshape the filter (defense-in-depth,
  // DQA-17; the route is already admin-only).
  const q = (url.searchParams.get('q') ?? '').replace(/[,()*%"\\]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
  const like = encodeURIComponent(q);

  if (!supabaseConfigured(env)) return adminJson({ configured: false, users: [], summary: null, limit, offset, hasMore: false });

  // limit+1 past the page: the extra row is a cheap, exact hasMore signal —
  // the UI used to infer it from rows.length >= limit, which shows a Next
  // button that lands on an empty page whenever the last page is exactly
  // full (D-22). Both sources are read up to the same depth, merged by
  // last_seen and sliced, so the page is exact whichever source fills it.
  const window = offset + limit + 1;
  let deviceQuery = 'select=device_id,name,username,platform,country,city,is_playing,first_seen,last_seen&order=last_seen.desc,device_id.asc';
  if (q) deviceQuery += `&or=(name.ilike.*${like}*,username.ilike.*${like}*,device_id.ilike.*${like}*)`;
  // Accounts already linked to a device show as that device's usage row.
  let accountQuery = 'select=google_sub,name,username,device_id,created_at,last_seen&device_id=is.null&order=last_seen.desc,google_sub.asc';
  if (q) accountQuery += `&or=(name.ilike.*${like}*,username.ilike.*${like}*)`;

  const since = encodeURIComponent(new Date(Date.now() - 86_400_000).toISOString());
  const [read, summary, accounts, accTotal, accNew, accActive, accAll] = await Promise.all([
    readWindow<UserRow>(env, 'vinax_users', deviceQuery, window),
    sbRpcResult<Summary>(env, 'vinax_user_summary', {}),
    readWindow<AccountRow>(env, 'vinax_accounts', accountQuery, window),
    sbCountResult(env, 'vinax_accounts', 'device_id=is.null'),
    sbCountResult(env, 'vinax_accounts', `device_id=is.null&created_at=gte.${since}`),
    sbCountResult(env, 'vinax_accounts', `device_id=is.null&last_seen=gte.${since}`),
    sbCountResult(env, 'vinax_accounts'),
  ]);
  // 7.2.0 — a failed read is not "no users": the list and its counts are
  // unavailable together.
  if (!read.ok) return dbFailure(read);
  if (!summary.ok) return dbFailure(summary);

  // The account half is a separate part: if it fails, the usage list still
  // shows and the answer names what is missing instead of passing off a
  // partial count as the whole.
  const accountsOk = accounts.ok && accTotal.ok && accNew.ok && accActive.ok && accAll.ok;
  const devices = read.rows;

  // Name and username of the accounts linked to the devices on screen.
  const linked = new Map<string, { name: string | null; username: string | null }>();
  if (accountsOk && devices.length) {
    const ids = devices.map((d) => `"${String(d.device_id).replace(/"/g, '')}"`).join(',');
    const l = await sbSelectResult<{ device_id: string; name: string | null; username: string | null }>(
      env,
      'vinax_accounts',
      `select=device_id,name,username&device_id=in.(${encodeURIComponent(ids)})&limit=${devices.length}`,
    );
    if (l.ok) for (const r of l.rows) linked.set(r.device_id, { name: r.name, username: r.username });
  }
  for (const d of devices) {
    const a = linked.get(d.device_id);
    if (!a) continue;
    d.signed_in = true;
    if (!d.name) d.name = a.name;
    if (!d.username) d.username = a.username;
  }

  const merged = accountsOk ? [...devices, ...accounts.rows.map(accountToRow)].sort(newerFirst) : devices;
  const users = merged.slice(offset, offset + limit + 1);
  const hasMore = users.length > limit;
  if (hasMore) users.length = limit;

  const s = summary.value ?? null;
  const total = s && accountsOk
    ? {
        ...s,
        total_users: (s.total_users || 0) + (accTotal.ok ? accTotal.value : 0),
        new_24h: (s.new_24h || 0) + (accNew.ok ? accNew.value : 0),
        active_24h: (s.active_24h || 0) + (accActive.ok ? accActive.value : 0),
        accounts_total: accAll.ok ? accAll.value : null,
      }
    : s && { ...s, accounts_total: null };

  return adminJson({
    configured: true,
    users,
    summary: total,
    limit,
    offset,
    hasMore,
    ...(accountsOk ? {} : { unavailable: ['accounts'] }),
  });
};
