/**
 * Version 11 — the console's Trending and Search Insights pages.
 *
 * GET  /api/admin/trends?view=trending&days=  → { configured, days, view, data }   (stats_trending)
 * GET  /api/admin/trends?view=search&days=    → { configured, days, view, data, pins, synonyms }   (stats_searches)
 * GET  /api/admin/trends?view=pins            → { configured, view, pins, synonyms }   (settings only)
 *   An older database (schema < 11, the function is missing) answers
 *   502 db_update_needed, like every route that is ahead of the schema.
 *
 * POST (editor) — fix what people could not find:
 *   { action: 'pin', query, song: { id, title, artist?, image? } } → `search-pins`
 *   { action: 'unpin', query }                                      → `search-pins`
 *   { action: 'synonym', typed, meant }                             → `search-synonyms`
 *   → { ok, key, value } (the whole stored value after the change)
 *
 * Pins and synonyms are ordinary published settings (_lib/settings.ts): the
 * app reads them from the client bundle (_lib/clientConfig.ts) within a
 * minute, and the change lands in settings history and the audit log.
 */
import { adminJson, badRequest, dbFailure } from '../../_lib/admin';
import { adminGet, adminPost } from '../../_lib/adminRoute';
import { cleanSearchPin, publicSearchPins, SEARCH_PINS_MAX, SEARCH_SYNONYMS_MAX, searchQueryKey } from '../../_lib/clientConfig';
import { db, type DbEnv } from '../../_lib/db';
import { daysParam } from '../../_lib/edge';
import { readSettings, resetSettingsMemo, writeSetting } from '../../_lib/settings';

const VIEWS = ['trending', 'search', 'pins'] as const;
type View = (typeof VIEWS)[number];
const LIMIT = 50;

const has = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

/** The synonyms as the app gets them: lower-case keys, string values. */
function cleanSynonyms(v: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, to] of Object.entries(obj(v))) {
    const from = k.trim().toLowerCase().slice(0, 60);
    if (from && from !== '__proto__' && typeof to === 'string' && to.trim()) out[from] = to.trim().slice(0, 80);
  }
  return out;
}

/** Fresh reads of the two settings this route edits (the memo is dropped first). */
async function fixes(env: DbEnv) {
  resetSettingsMemo();
  const r = await readSettings(env);
  if (!r.ok) return r;
  const value = (key: string) => r.rows.find((row) => row.key === key)?.value ?? null;
  return { ok: true as const, pins: publicSearchPins(value('search-pins')), synonyms: cleanSynonyms(value('search-synonyms')), rawSynonyms: obj(value('search-synonyms')) };
}

export const onRequestGet = adminGet(async ({ env, url }) => {
  const view = url.searchParams.get('view') as View | null;
  if (!view || !VIEWS.includes(view)) return badRequest('unknown_view', { views: VIEWS });
  if (view === 'pins') {
    const f = await fixes(env);
    if (!f.ok) return dbFailure(f);
    return adminJson({ configured: true, view, pins: f.pins, synonyms: f.synonyms });
  }
  const days = daysParam(url, 7, 90);
  if (view === 'trending') {
    const r = await db.rpc<Record<string, unknown> | null>(env, 'stats_trending', { p_days: days, p_limit: LIMIT });
    if (!r.ok) return dbFailure(r);
    return adminJson({ configured: true, days, view, data: r.value ?? {} });
  }
  const [r, f] = await Promise.all([db.rpc<Record<string, unknown> | null>(env, 'stats_searches', { p_days: days, p_limit: LIMIT }), fixes(env)]);
  if (!r.ok) return dbFailure(r);
  if (!f.ok) return dbFailure(f);
  return adminJson({ configured: true, days, view, data: r.value ?? {}, pins: f.pins, synonyms: f.synonyms });
});

export const onRequestPost = adminPost(async ({ env, body, me, audit }) => {
  const action = body.action;
  if (action !== 'pin' && action !== 'unpin' && action !== 'synonym') return badRequest('unknown_action');
  const f = await fixes(env);
  if (!f.ok) return dbFailure(f);

  if (action === 'synonym') {
    const typed = typeof body.typed === 'string' ? body.typed.trim().toLowerCase().slice(0, 60) : '';
    const meant = typeof body.meant === 'string' ? body.meant.trim().slice(0, 80) : '';
    if (!typed || typed === '__proto__' || !meant || typed === meant.toLowerCase()) return badRequest('bad_synonym');
    // Keep whatever else is stored, as the App Settings editor would.
    const before = f.rawSynonyms;
    const next: Record<string, unknown> = { ...before, [typed]: meant };
    if (!has(before, typed) && Object.keys(cleanSynonyms(before)).length >= SEARCH_SYNONYMS_MAX) return badRequest('too_many', { max: SEARCH_SYNONYMS_MAX });
    const w = await writeSetting(env, 'search-synonyms', next, me.email);
    if (!w.ok) return adminJson({ error: w.error, upstreamStatus: w.status }, w.error === 'too_large' ? 413 : 502);
    await audit({ action: 'settings', summary: `search synonym “${typed}” → “${meant}”`, target: 'search-synonyms', before, after: next });
    return adminJson({ ok: true, key: 'search-synonyms', value: cleanSynonyms(next) });
  }

  const query = searchQueryKey(body.query);
  if (!query) return badRequest('bad_query');
  const before = f.pins;
  const next: Record<string, unknown> = { ...before };
  let summary: string;
  if (action === 'pin') {
    const song = cleanSearchPin(body.song);
    if (!song) return badRequest('bad_song');
    if (!has(before, query) && Object.keys(before).length >= SEARCH_PINS_MAX) return badRequest('too_many', { max: SEARCH_PINS_MAX });
    next[query] = song;
    summary = `pinned “${song.title}” for the search “${query}”`;
  } else {
    if (!has(before, query)) return adminJson({ ok: true, key: 'search-pins', value: before, unchanged: true });
    delete next[query];
    summary = `unpinned the search “${query}”`;
  }
  const value = Object.keys(next).length ? next : null;
  const w = await writeSetting(env, 'search-pins', value, me.email);
  if (!w.ok) return adminJson({ error: w.error, upstreamStatus: w.status }, w.error === 'too_large' ? 413 : 502);
  await audit({ action: 'settings', summary, target: 'search-pins', before, after: value });
  return adminJson({ ok: true, key: 'search-pins', value: publicSearchPins(value) });
});
