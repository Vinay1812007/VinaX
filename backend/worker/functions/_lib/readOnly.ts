/**
 * v8 — read-only mode (App Settings → Maintenance → Site Mode "Read-only").
 *
 * People can still open the app and listen; anything that would SAVE a change
 * on the server is refused with 503 `read_only`: feedback, the synced library
 * backup, profiles, follows, shared playlists and usernames. Listening
 * (catalogue, events, Listen Together rooms), sign-in, push registration and
 * the owner console keep working. The app reads the same mode from
 * /api/site-mode and shows a banner, so people see why before they try.
 */
import { settingsMap } from './settings';
import type { DbEnv } from './db';

const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

/** Public routes whose writes are refused in read-only mode. */
export const READ_ONLY_PATHS = ['/api/feedback', '/api/account/data', '/api/profile', '/api/follow', '/api/shared-playlist', '/api/username'] as const;
const WRITE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** Is the site in read-only mode? (settings are memoised a minute per isolate) */
export async function isReadOnly(env: DbEnv): Promise<boolean> {
  const { values } = await settingsMap(env);
  const sm = obj(values['site-mode']);
  return !!sm && sm.mode === 'readonly';
}

/** The 503 answer for a write while read-only, or null to carry on. */
export async function readOnlyRefusal(path: string, method: string, env: DbEnv): Promise<Response | null> {
  if (!WRITE.has(method.toUpperCase())) return null;
  const p = path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path;
  if (!(READ_ONLY_PATHS as readonly string[]).includes(p)) return null;
  if (!(await isReadOnly(env))) return null;
  return new Response(JSON.stringify({ error: 'read_only', message: 'VinaX is in read-only mode right now. You can keep listening; changes are not saved until it ends.' }), {
    status: 503,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'retry-after': '300', 'access-control-allow-origin': '*' },
  });
}
