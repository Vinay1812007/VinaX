/**
 * Shape checks shared by a store's persist `merge` and the backup importer,
 * so a stored or restored record can never put a wrong-typed value into a
 * live store. Pure — no store imports (the stores import this).
 */
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

export type AlarmAction = 'favorites' | 'resume' | 'collection';

export interface AlarmData {
  enabled: boolean;
  time: string;
  action: AlarmAction;
  collectionId: string | null;
  fadeIn: boolean;
  lastFired: string;
}

export const ALARM_DEFAULTS: AlarmData = { enabled: false, time: '07:00', action: 'favorites', collectionId: null, fadeIn: true, lastFired: '' };

/** "HH:MM" on a 24-hour clock. */
export function isAlarmTime(v: unknown): v is string {
  if (typeof v !== 'string' || !/^\d{2}:\d{2}$/.test(v)) return false;
  const [h, m] = v.split(':').map(Number);
  return h <= 23 && m <= 59;
}

/** Field-by-field: a bad value falls back to `base`, never into the store. */
export function sanitizeAlarm(v: unknown, base: AlarmData = ALARM_DEFAULTS): AlarmData {
  const r = isObj(v) ? v : {};
  return {
    enabled: typeof r.enabled === 'boolean' ? r.enabled : base.enabled,
    time: isAlarmTime(r.time) ? r.time : base.time,
    action: r.action === 'favorites' || r.action === 'resume' || r.action === 'collection' ? r.action : base.action,
    collectionId: typeof r.collectionId === 'string' ? r.collectionId.slice(0, 64) : r.collectionId === null ? null : base.collectionId,
    fadeIn: typeof r.fadeIn === 'boolean' ? r.fadeIn : base.fadeIn,
    lastFired: typeof r.lastFired === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(r.lastFired) ? r.lastFired : base.lastFired,
  };
}

export const LYRIC_OFFSET_LIMIT = 10;

/** Per-song lyric offsets: finite seconds clamped to ±10, zero dropped (zero = no entry). */
export function sanitizeLyricOffsets(v: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!isObj(v)) return out;
  for (const [id, n] of Object.entries(v).slice(0, 5000)) {
    if (typeof n !== 'number' || !Number.isFinite(n)) continue;
    const clamped = Math.max(-LYRIC_OFFSET_LIMIT, Math.min(LYRIC_OFFSET_LIMIT, Math.round(n * 10) / 10));
    if (clamped !== 0) out[id.slice(0, 128)] = clamped;
  }
  return out;
}
