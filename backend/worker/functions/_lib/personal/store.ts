/**
 * The personal engine's reads and writes: the taste row (with the version
 * check that keeps two Workers from losing a batch), the exposure rows a
 * ranking needs, and the composed pages. Every call answers the db result
 * shape and never throws.
 */
import { db, q, type DbEnv, type DbFail, type Value } from '../db';
import { emptySummary, emptyTaste, isTasteMode } from './taste';
import { TASTE_COLUMNS, type ExposureRow, type HomePage, type PlaylistPage, type Taste, type TasteRow } from './types';

const obj = <T extends object>(v: unknown, fallback: T): T => (v && typeof v === 'object' && !Array.isArray(v) ? (v as T) : fallback);

export function tasteFromRow(row: TasteRow): Taste {
  const base = emptyTaste(Date.parse(row.updated_at) || Date.now());
  return {
    artists: obj(row.artists, {}),
    languages: obj(row.languages, {}),
    facets: { ...base.facets, ...obj(row.facets, {}) },
    hours: obj(row.hours, {}),
    songs: obj(row.songs, {}),
    summary: { ...emptySummary(), ...obj(row.summary, {}) },
    mode: isTasteMode(row.mode) ? row.mode : 'balanced',
    eventsSeen: typeof row.events_seen === 'number' ? row.events_seen : 0,
    version: typeof row.version === 'number' ? row.version : 1,
    updatedAt: Date.parse(row.updated_at) || Date.now(),
  };
}

/** The account's model, or an empty one (`fresh: true`) when it has none yet. */
export async function loadTaste(env: DbEnv, accountId: string): Promise<{ ok: true; taste: Taste; fresh: boolean; embedModel: string | null } | DbFail> {
  const r = await db.one<TasteRow>(env, 'personal_taste', q().eq('account_id', accountId).select(TASTE_COLUMNS));
  if (!r.ok) return r;
  if (!r.value) return { ok: true, taste: emptyTaste(), fresh: true, embedModel: null };
  return { ok: true, taste: tasteFromRow(r.value), fresh: false, embedModel: r.value.embed_model };
}

/**
 * Write a folded model. `fresh` inserts (and loses to a row another Worker
 * made a moment ago); otherwise the update lands only while the stored
 * version is still the one that was read. False means: read again and
 * re-fold.
 */
export async function saveTaste(env: DbEnv, accountId: string, t: Taste, readVersion: number, fresh: boolean): Promise<Value<boolean>> {
  // The payload is spelled out here (not built by a helper) so the schema-usage test can read its columns.
  if (fresh) {
    const r = await db.insert(env, 'personal_taste', {
      account_id: accountId, artists: t.artists, languages: t.languages, facets: t.facets, hours: t.hours, songs: t.songs,
      summary: t.summary, mode: t.mode, events_seen: t.eventsSeen, version: readVersion + 1, updated_at: new Date(t.updatedAt).toISOString(),
    }, { returning: true, onConflict: 'account_id', ignoreDuplicates: true });
    if (!r.ok) return r.code === '23503' ? { ok: true, value: false } : r;
    return { ok: true, value: r.rows.length > 0 };
  }
  const r = await db.update(env, 'personal_taste', q().eq('account_id', accountId).eq('version', readVersion).select('version'), {
    artists: t.artists, languages: t.languages, facets: t.facets, hours: t.hours, songs: t.songs,
    summary: t.summary, mode: t.mode, events_seen: t.eventsSeen, version: readVersion + 1, updated_at: new Date(t.updatedAt).toISOString(),
  }, { returning: true });
  if (!r.ok) return r;
  return { ok: true, value: r.rows.length > 0 };
}

/** The account's exposure rows for a set of songs (the pool), keyed by song. */
export async function loadExposure(env: DbEnv, accountId: string, songIds: readonly string[]): Promise<Map<string, ExposureRow>> {
  const out = new Map<string, ExposureRow>();
  if (!songIds.length) return out;
  const r = await db.rpc<ExposureRow[]>(env, 'personal_exposure_for', { p_account: accountId, p_songs: [...new Set(songIds)] });
  if (r.ok && Array.isArray(r.value)) for (const row of r.value) out.set(row.song_id, row);
  return out;
}

interface PageRow<T> { id: string; page: T; taste_version: number | null; events_seen: number | null; model_id: string | null; composed: boolean; created_at: string; expires_at: string | null }

/** The newest unexpired page of a kind, or null. */
export async function loadPage<T>(env: DbEnv, accountId: string, kind: 'home' | 'playlist' | 'radio', now = Date.now()): Promise<PageRow<T> | null> {
  const r = await db.one<PageRow<T>>(env, 'personal_pages',
    q().eq('account_id', accountId).eq('kind', kind).gt('expires_at', new Date(now).toISOString()).select('id,page,taste_version,events_seen,model_id,composed,created_at,expires_at').order('created_at', 'desc'));
  return r.ok ? r.value : null;
}

export async function savePage(env: DbEnv, accountId: string, kind: 'home' | 'playlist' | 'radio', page: HomePage | PlaylistPage, o: { id: string; prompt?: string | null; tasteVersion: number | null; eventsSeen: number | null; modelId: string | null; composed: boolean; builtMs: number; expiresAt: string | null }): Promise<void> {
  await db.insert(env, 'personal_pages', {
    id: o.id, account_id: accountId, kind, prompt: o.prompt ?? null, page, taste_version: o.tasteVersion, events_seen: o.eventsSeen,
    model_id: o.modelId, composed: o.composed, built_ms: o.builtMs, expires_at: o.expiresAt,
  });
}

export async function loadPlaylistPage(env: DbEnv, accountId: string, id: string): Promise<PlaylistPage | null> {
  const r = await db.one<PageRow<PlaylistPage>>(env, 'personal_pages', q().eq('account_id', accountId).eq('kind', 'playlist').eq('id', id).select('id,page,taste_version,events_seen,model_id,composed,created_at,expires_at'));
  return r.ok && r.value ? r.value.page : null;
}
