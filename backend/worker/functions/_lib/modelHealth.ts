/**
 * 1.2.7 — which AI models actually answer. The `ai-models` job (jobs.ts,
 * modelHealthJob.ts) asks every listed chat, image, speech and transcription
 * model a tiny question on a schedule and keeps the result here, in the
 * database's `meta` table under one key. The model menu (/api/aimodels), the
 * voice list (/api/voices) and the automatic media pick (pickMedia) then offer
 * only models whose last check passed.
 *
 * Safe by default: with no database, no record yet, or a record older than a
 * day (the job stopped), nothing is filtered. Before the first full pass a
 * model with no result yet is still offered; after it, a new model waits for
 * its first passing check (the next run checks new models first).
 */
import { db, dbConfigured, q, type DbEnv } from './db';

export type HealthKind = 'chat' | 'image' | 'speech' | 'transcription';
export const HEALTH_KINDS: readonly HealthKind[] = ['chat', 'image', 'speech', 'transcription'];

/** Why a check failed: hard reasons hide a model at once, transient ones after two in a row. */
export type HealthReason = 'gone' | 'refused' | 'not_free' | 'empty' | 'busy' | 'down';
const TRANSIENT: ReadonlySet<HealthReason> = new Set(['busy', 'down']);

export interface HealthEntry {
  ok: boolean;
  /** The last failure's reason; null when the last check passed. */
  reason: HealthReason | null;
  /** When it was last checked (epoch ms). */
  at: number;
  /** Failures in a row. */
  fails: number;
}

export interface HealthMap {
  v: 1;
  /** When the job last wrote (epoch ms). */
  checkedAt: number;
  /** When every listed model first had a result (epoch ms), or null. */
  fullPassAt: number | null;
  models: Record<string, HealthEntry>;
}

export const HEALTH_META_KEY = 'ai-model-health';
/** Older than this, the record is ignored: the job has stopped and its view is stale. */
export const HEALTH_MAX_AGE_MS = 24 * 60 * 60_000;
const MEMO_MS = 60_000;

export const healthKey = (kind: HealthKind, provider: string, id: string): string => `${kind}|${provider}|${id}`;

/** A check's outcome from the provider's answer: an HTTP status (0 = no answer) and whether text or audio came back. */
export function classify(status: number, produced: boolean): HealthReason | null {
  if (status >= 200 && status < 300) return produced ? null : 'empty';
  if (status === 402) return 'not_free';
  if (status === 401 || status === 403) return 'refused';
  if (status === 429) return 'busy';
  if (status === 400 || status === 404 || status === 410 || status === 422) return 'gone';
  return 'down';
}

/** The next record for one model. A model that used to pass survives one transient failure. */
export function nextEntry(prev: HealthEntry | undefined, reason: HealthReason | null, now: number): HealthEntry {
  if (reason === null) return { ok: true, reason: null, at: now, fails: 0 };
  const fails = (prev?.fails ?? 0) + 1;
  const ok = TRANSIENT.has(reason) && prev?.ok === true && fails < 2;
  return { ok, reason, at: now, fails };
}

let memo: { at: number; map: HealthMap | null } | null = null;

/** Tests only. */
export function resetHealthMemo(): void {
  memo = null;
}

function parseMap(v: unknown): HealthMap | null {
  const m = v as Partial<HealthMap> | null;
  if (!m || m.v !== 1 || typeof m.checkedAt !== 'number' || !m.models || typeof m.models !== 'object') return null;
  return { v: 1, checkedAt: m.checkedAt, fullPassAt: typeof m.fullPassAt === 'number' ? m.fullPassAt : null, models: m.models as Record<string, HealthEntry> };
}

/** The stored record (memoised a minute per isolate), or null when there is none or it cannot be read. */
export async function readHealth(env: DbEnv, now = Date.now()): Promise<HealthMap | null> {
  if (!dbConfigured(env)) return null;
  if (memo && now - memo.at < MEMO_MS) return memo.map;
  const r = await db.select<{ value: unknown }>(env, 'meta', q().eq('key', HEALTH_META_KEY).select('value').limit(1));
  // A failed read keeps the last good record for this minute rather than dropping the filter.
  const map = r.ok ? parseMap(r.rows[0]?.value) : (memo?.map ?? null);
  memo = { at: now, map };
  return map;
}

export async function writeHealth(env: DbEnv, map: HealthMap): Promise<boolean> {
  const r = await db.upsert(env, 'meta', [{ key: HEALTH_META_KEY, value: map, updated_at: new Date(map.checkedAt).toISOString() }], 'key');
  if (r.ok) memo = { at: Date.now(), map };
  return r.ok;
}

/** The record if it should be applied now: present and fresh. */
export function activeMap(map: HealthMap | null, now = Date.now()): HealthMap | null {
  return map && now - map.checkedAt <= HEALTH_MAX_AGE_MS ? map : null;
}

/** May this model be offered? */
export function usable(map: HealthMap | null, kind: HealthKind, provider: string, id: string, now = Date.now()): boolean {
  const live = activeMap(map, now);
  if (!live) return true;
  const e = live.models[healthKey(kind, provider, id)];
  if (!e) return live.fullPassAt === null;
  return e.ok;
}

/**
 * The models of one kind that may be offered, per provider. For chat, if the
 * filter would leave nothing at all the lists come back unfiltered: an empty
 * chat menu helps nobody, and it more likely means the checker is wrong. A
 * media kind may end up empty — the app then hides that feature.
 */
export function filterUsable<T extends { id: string }>(
  map: HealthMap | null,
  kind: HealthKind,
  lists: Record<string, T[]>,
  now = Date.now(),
): Record<string, T[]> {
  if (!activeMap(map, now)) return lists;
  const out: Record<string, T[]> = {};
  let kept = 0;
  let total = 0;
  for (const [provider, list] of Object.entries(lists)) {
    out[provider] = list.filter((m) => usable(map, kind, provider, m.id, now));
    kept += out[provider].length;
    total += list.length;
  }
  return kind === 'chat' && kept === 0 && total > 0 ? lists : out;
}

/** Media lists with the checked kinds (image, speech, transcription) filtered; other kinds pass through. */
export function filterMediaLists<T extends { id: string; kind: string }>(map: HealthMap | null, lists: Record<string, T[]>, now = Date.now()): Record<string, T[]> {
  if (!activeMap(map, now)) return lists;
  const out: Record<string, T[]> = {};
  for (const [provider, list] of Object.entries(lists)) {
    out[provider] = list.filter((m) => !(HEALTH_KINDS as readonly string[]).includes(m.kind) || m.kind === 'chat' || usable(map, m.kind as HealthKind, provider, m.id, now));
  }
  return out;
}
