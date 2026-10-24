/**
 * Published settings — the `settings` table: one key, one JSON value, written
 * only from the owner console, read by the public config routes and by the
 * Worker itself (AI controls, retention, site mode).
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
  group: 'Home & promotion' | 'App' | 'Catalog' | 'VinaX AI' | 'Operations';
  title: string;
  note: string;
  /** What the value looks like, for the console's editor. */
  shape: 'object' | 'array' | 'string' | 'boolean-map';
}

export const SETTING_KEYS: readonly SettingSpec[] = [
  { key: 'banners', group: 'Home & promotion', title: 'Banners & offers', note: 'Cards on Home: title, subtitle, link, start/end dates, image. At most 10 live.', shape: 'array' },
  { key: 'festival', group: 'Home & promotion', title: 'Festival theme', note: 'Festival skin override: { mode: "auto" | "off" | "force", id?, start?, end? } — force shows the named festival now, off hides skins.', shape: 'object' },
  { key: 'greeting', group: 'Home & promotion', title: 'Home greeting', note: 'A line under the Home title: { text, start?, end? }.', shape: 'object' },
  { key: 'broadcast', group: 'Home & promotion', title: 'Broadcast bar', note: 'A dismissible message in the app: { id, text, link?, start?, end? }.', shape: 'object' },
  { key: 'home-layout', group: 'Home & promotion', title: 'Home layout', note: 'Shelf order and hidden shelves: { title, description, order: [...], hidden: [...] }.', shape: 'object' },
  { key: 'announcement', group: 'Home & promotion', title: 'Announcement', note: 'What the Android app shows on open: { title, body, link?, ts }. Written by the push sender too.', shape: 'object' },
  { key: 'support-faq', group: 'App', title: 'Help center FAQ', note: 'Questions and answers: [{ q, a }].', shape: 'array' },
  { key: 'flags', group: 'App', title: 'Feature switches', note: 'Boolean flags the app reads: { aiHome, listenTogether, codeRun, … }.', shape: 'boolean-map' },
  { key: 'min-version', group: 'App', title: 'Minimum app build', note: 'Older Android builds must update: { build }.', shape: 'object' },
  { key: 'site-mode', group: 'Operations', title: 'Site mode', note: '{ mode: "live" | "maintenance", note? } — maintenance shows the gate to everyone.', shape: 'object' },
  { key: 'maintenance-window', group: 'Operations', title: 'Maintenance window', note: 'A planned window: { start, end, note }. The gate shows inside it.', shape: 'object' },
  { key: 'status-note', group: 'Operations', title: 'Status page note', note: 'An owner note at the top of the status page: { text }.', shape: 'object' },
  { key: 'retention', group: 'Operations', title: 'Data retention', note: 'How long usage events are kept: { eventsDays } (default 180).', shape: 'object' },
  { key: 'push', group: 'Operations', title: 'Push rules', note: '{ minGapHours, quietStart, quietEnd } — frequency cap and quiet hours for pushes.', shape: 'object' },
  { key: 'search-synonyms', group: 'Catalog', title: 'Search synonyms', note: '{ "typed": "meant" } pairs applied to searches.', shape: 'object' },
  { key: 'catalog-sources', group: 'Catalog', title: 'Catalog sources', note: '{ sourceId: false } disables a catalogue source for everyone.', shape: 'object' },
  { key: 'language-order', group: 'Catalog', title: 'Language order', note: 'Languages in the order Home offers them: ["telugu", "hindi", …].', shape: 'array' },
  { key: 'ai-starters', group: 'VinaX AI', title: 'Starter prompts', note: 'Suggestions on the empty chat: ["…"].', shape: 'array' },
  { key: 'ai-quick', group: 'VinaX AI', title: 'Quick actions', note: '[{ icon, label, prompt, mode? }] under the composer.', shape: 'array' },
  { key: 'ai-rules', group: 'VinaX AI', title: 'House rules', note: 'Plain text appended to the assistant’s instructions.', shape: 'string' },
  { key: 'ai-controls', group: 'VinaX AI', title: 'AI controls', note: '{ emergencyOff, features: { chat|dj|playlist|search|home|title…: bool }, dailyTokenCap } — refused calls answer 503 ai_disabled / ai_over_budget.', shape: 'object' },
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
