/**
 * Published settings — the `settings` table: one key, one JSON value, written
 * only from the owner console, read by the public config routes and by the
 * Worker itself (retention, site mode).
 *
 * `SETTING_KEYS` is the whole vocabulary: a key not listed here cannot be
 * written. Values are stored as the owner typed them (after a size cap) and
 * sanitised on the way OUT by the route that reads them, so a bad value can
 * never break a listener's app.
 *
 * Reads are memoised per isolate for a minute: the public routes answer from
 * memory between database reads.
 */
import { db, dbConfigured, q, type DbEnv, type Rows } from './db';

export interface SettingSpec {
  key: string;
  group: 'Home & promotion' | 'App' | 'Catalog' | 'Operations';
  title: string;
  note: string;
  /** What the value looks like, for the console's editor. */
  shape: 'object' | 'array' | 'string' | 'boolean-map';
}

export const SETTING_KEYS: readonly SettingSpec[] = [
  { key: 'banners', group: 'Home & promotion', title: 'Banners & offers', note: 'Cards at the top of Home (at most 10 live): [{ id, title, subtitle, img, linkType: song | album | playlist | artist | charts | page, linkId, start, end, enabled }]. Off or outside its dates = not shown.', shape: 'array' },
  { key: 'festival', group: 'Home & promotion', title: 'Festival theme', note: 'Festival look: { mode: auto | off | force, id, color, start, end, enabled }. off = no festival look; force = that festival now, with an optional own colour.', shape: 'object' },
  { key: 'greeting', group: 'Home & promotion', title: 'Home greeting', note: 'A line under the Home title: { enabled, morning, afternoon, evening, night, withName, start, end } (older apps read { text }).', shape: 'object' },
  { key: 'broadcast', group: 'Home & promotion', title: 'Broadcast bar', note: 'The message bar at the top of the app: { id, text, link, style: info | success | warning | urgent, dismissible, start, end, enabled }. A new id shows it again to everyone.', shape: 'object' },
  { key: 'home-layout', group: 'Home & promotion', title: 'Home layout', note: 'Home sections: { title, description, order: [section], hidden: [section] } (at most 12 hidden, so one always stays).', shape: 'object' },
  { key: 'announcement', group: 'Home & promotion', title: 'Announcement', note: 'Pop-up shown when the app opens: { title, body, button, link, show: once | always | daily, platforms, popup, start, end, enabled, ts }. The notification sender writes a plain one too.', shape: 'object' },
  { key: 'support-faq', group: 'App', title: 'Help center FAQ', note: 'Questions and answers shown in Help Center, with a category and an on/off switch each.', shape: 'array' },
  { key: 'flags', group: 'App', title: 'Feature switches', note: 'Feature switches the app reads: { listenTogether }. Off hides the feature.', shape: 'boolean-map' },
  { key: 'vinax-ai', group: 'App', title: 'VinaX AI', note: 'VinaX AI: { enabled, testers: [Google account], search, models: { model: { enabled, order } }, discover, dailyLimit } — off for everyone but the testers until enabled; discover: false hides the free models found in the providers’ lists.', shape: 'object' },
  { key: 'personal-config', group: 'App', title: 'Personal engine', note: 'Recommendations: { enabled, composer, embedModel, weights } — each weight stays within half to double its built-in value.', shape: 'object' },
  { key: 'ai-music', group: 'App', title: 'Music AI', note: 'Music AI: { enabled, rerank, home, generate: { enabled, dailyQuota } } — off falls back to the app\'s own picks; song making stays off until switched on.', shape: 'object' },
  { key: 'min-version', group: 'App', title: 'Minimum app build', note: 'Oldest app allowed: { android | web | ios: { minVersion, mode: suggest | force }, message, build (older Android apps) }.', shape: 'object' },
  { key: 'site-mode', group: 'Operations', title: 'Site mode', note: 'How the app runs: normal, read-only (people can listen but changes are not saved) or maintenance (everyone sees a maintenance screen).', shape: 'object' },
  { key: 'maintenance-window', group: 'Operations', title: 'Maintenance window', note: 'A planned maintenance time: the app warns people beforehand and shows the maintenance screen while it lasts.', shape: 'object' },
  { key: 'status-note', group: 'Operations', title: 'Status page note', note: 'A message at the top of the public status page, with a level (all good, minor issue, major outage).', shape: 'object' },
  { key: 'retention', group: 'Operations', title: 'Data retention', note: 'How long each kind of data is kept before it is deleted automatically: play history, error reports, feedback, notification logs.', shape: 'object' },
  { key: 'push', group: 'Operations', title: 'Push rules', note: 'Notification limits: at most one per few hours per person, quiet hours, and which kinds of notification may be sent.', shape: 'object' },
  { key: 'search-synonyms', group: 'Catalog', title: 'Search synonyms', note: 'Words people type that should search for something else (bday → birthday).', shape: 'object' },
  { key: 'catalog-sources', group: 'Catalog', title: 'Catalog sources', note: 'Which music sources the app uses, and in which order it tries them.', shape: 'object' },
  { key: 'language-order', group: 'Catalog', title: 'Language order', note: 'The order of languages on Home, and which languages are hidden.', shape: 'array' },
  { key: 'robots', group: 'Operations', title: 'Bots allowed to read the site', note: 'Which crawlers robots.txt allows: { bots: { "<bot name>": false } } — false blocks that bot; anything not listed keeps the built-in rule.', shape: 'object' },
  { key: 'jobs', group: 'Operations', title: 'Scheduled jobs', note: 'Switch a background job off or slow it down: { "<job>": { enabled, every } }.', shape: 'object' },
  { key: 'push-audiences', group: 'Operations', title: 'Saved notification audiences', note: 'Audiences the owner saved on Send Notification: [{ id, name, filter, activity }]. Console only.', shape: 'array' },
] as const;

export const SETTING_KEY_SET: ReadonlySet<string> = new Set(SETTING_KEYS.map((s) => s.key));
export const isSettingKey = (k: unknown): k is string => typeof k === 'string' && SETTING_KEY_SET.has(k);

/** Largest serialised value a key may hold. */
export const SETTING_MAX_BYTES = 60_000;

export interface SettingRow {
  key: string;
  value: unknown;
  updated_at: string;
  updated_by: string;
}

const MEMO_MS = 60_000;
let memo: { at: number; rows: SettingRow[] } | null = null;

/** Tests only. */
export function resetSettingsMemo(): void {
  memo = null;
}

/** Every setting row (memoised a minute). A failed read answers the failure, never an empty table. */
export async function readSettings(env: DbEnv, now = Date.now()): Promise<Rows<SettingRow>> {
  if (!dbConfigured(env)) return { ok: false, error: 'not_configured', status: null, code: null, detail: null, rows: [] };
  if (memo && now - memo.at < MEMO_MS) return { ok: true, rows: memo.rows };
  const r = await db.select<SettingRow>(env, 'settings', q().select('key,value,updated_at,updated_by').limit(200));
  if (r.ok) memo = { at: now, rows: r.rows };
  return r;
}

/** Settings as a key → value map; {} when nothing is published or the database is not configured. */
export async function settingsMap(env: DbEnv, now = Date.now()): Promise<{ ok: boolean; values: Record<string, unknown> }> {
  const r = await readSettings(env, now);
  const values: Record<string, unknown> = {};
  for (const row of r.rows) values[row.key] = row.value;
  return { ok: r.ok || r.error === 'not_configured', values };
}

/** One key's value, or null when unset / unreadable. */
export async function setting<T = unknown>(env: DbEnv, key: string, now = Date.now()): Promise<T | null> {
  const r = await readSettings(env, now);
  return (r.rows.find((row) => row.key === key)?.value as T | undefined) ?? null;
}

/**
 * Write (value) or clear (null) one key, recording the change in
 * settings_history. The memo is dropped so the next read sees it.
 */
export async function writeSetting(env: DbEnv, key: string, value: unknown, by = 'owner'): Promise<{ ok: true; row: SettingRow | null } | { ok: false; error: string; status: number | null }> {
  if (!isSettingKey(key)) return { ok: false, error: 'unknown_key', status: null };
  if (value !== null && JSON.stringify(value).length > SETTING_MAX_BYTES) return { ok: false, error: 'too_large', status: null };
  const now = new Date().toISOString();
  const r = value === null
    ? await db.remove<SettingRow>(env, 'settings', q().eq('key', key), { returning: true })
    : await db.upsert<SettingRow>(env, 'settings', { key, value, updated_at: now, updated_by: by }, 'key', { returning: true });
  if (!r.ok) return { ok: false, error: `db_${r.error}`, status: r.status };
  memo = null;
  await db.insert(env, 'settings_history', { key, value, at: now, by });
  return { ok: true, row: value === null ? null : (r.rows[0] ?? { key, value, updated_at: now, updated_by: by }) };
}
