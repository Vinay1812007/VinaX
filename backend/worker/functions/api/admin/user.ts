/** Per-user drill-down: the user's latest-state row + recent raw events.
 *  Top songs / languages / recents are derived client-side from the events. */
import { adminJson, dbFailure, isAdminAsync, unauthorized, type AdminEnv } from '../../_lib/admin';
import { sbSelectResult, supabaseConfigured, type SupabaseEnv } from '../../_lib/supabase';
import { ACCOUNT_ROW_PREFIX, accountToRow, readAccounts, type AccountRow } from './users';

type Env = AdminEnv & SupabaseEnv;

interface UserRow {
  device_id: string;
  name: string | null;
  username?: string | null;
  platform: string | null;
  country: string | null;
  city: string | null;
  region: string | null;
  app_version: string | null;
  is_playing: boolean | null;
  first_seen: string;
  last_seen: string;
  current_song_title: string | null;
  current_song_artist: string | null;
}
interface EventRow {
  type: string;
  song_title: string | null;
  song_artist: string | null;
  language: string | null;
  created_at: string;
  country: string | null;
  city: string | null;
}

export const onRequestGet = async (context: { request: Request; env: Env }): Promise<Response> => {
  const { request, env } = context;
  if (!(await isAdminAsync(request, env))) return unauthorized();

  const rawId = new URL(request.url).searchParams.get('deviceId');
  // Length-capped: a huge id produced an over-length PostgREST URL whose 414
  // was swallowed and answered as an indistinguishable 'no such user'.
  const deviceId = rawId && rawId.length <= 128 ? rawId : null;
  if (!deviceId) {
    return new Response(JSON.stringify({ error: 'bad_request' }), {
      status: 400,
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
    });
  }
  if (!supabaseConfigured(env)) return adminJson({ configured: false, user: null, events: [] });

  // 13.6.4 — an account row (signed in, no usage row): the account's name and
  // dates, no plays. If the account has since been linked to a device, the
  // device's record answers instead.
  let lookupId = deviceId;
  // The account an `account:<sub>` id named, kept so a linked device with no
  // usage row still opens as the account (13.8) instead of "not found".
  let accountRow: AccountRow | null = null;
  if (deviceId.startsWith(ACCOUNT_ROW_PREFIX)) {
    const sub = deviceId.slice(ACCOUNT_ROW_PREFIX.length);
    const acc = await readAccounts((cols) =>
      sbSelectResult<AccountRow>(env, 'vinax_accounts', `google_sub=eq.${encodeURIComponent(sub)}&select=${cols}&limit=1`),
    );
    if (!acc.ok) return dbFailure(acc);
    const row = acc.rows[0];
    if (!row) return adminJson({ configured: true, user: null, events: [] });
    if (!row.device_id) return adminJson({ configured: true, user: accountToRow(row), events: [] });
    lookupId = row.device_id;
    accountRow = row;
  }
  const enc = encodeURIComponent(lookupId);

  // full=1 → the profile-download export: a much larger event window with
  // every column the server holds, so User Management's "Download profile"
  // ships everything there IS. Honesty note: this is the server-side coarse
  // record (events + latest state). The on-device taste profile is never
  // uploaded — by design — so it cannot appear here.
  const full = new URL(request.url).searchParams.get('full') === '1';
  const eventCols = full
    ? 'type,song_id,song_title,song_artist,song_image,language,platform,app_version,created_at,country,city,region,origin_verified'
    : 'type,song_title,song_artist,language,created_at,country,city';
  const eventLimit = full ? 2000 : 150;

  const [users, events, account] = await Promise.all([
    sbSelectResult<UserRow>(
      env,
      'vinax_users',
      `device_id=eq.${enc}&limit=1&select=device_id,name,username,platform,country,city,region,app_version,is_playing,first_seen,last_seen,current_song_title,current_song_artist`,
    ),
    sbSelectResult<EventRow>(
      env,
      'vinax_events',
      `device_id=eq.${enc}&order=created_at.desc&limit=${eventLimit}&select=${eventCols}`,
    ),
    // 13.7 — the account linked to this device: Gmail, photo, sign-in facts.
    readAccounts((cols) => sbSelectResult<AccountRow>(env, 'vinax_accounts', `device_id=eq.${enc}&select=${cols}&order=last_seen.desc&limit=1`)),
  ]);

  // 7.2.0 — a failed read is not "no such user"; a profile export built on
  // one would silently ship an empty history.
  if (!users.ok) return dbFailure(users);
  if (!events.ok) return dbFailure(events);
  const u = users.rows[0] ?? null;
  const a = account.ok ? account.rows[0] : undefined;
  const merged = u && a ? { ...u, signed_in: true, email: a.email ?? null, picture: a.picture ?? null, name: u.name ?? a.name, username: u.username ?? a.username, account_created: a.created_at } : u;
  const user = merged ?? (accountRow ? accountToRow(accountRow) : null);
  return adminJson({ configured: true, user, events: events.rows });
};
