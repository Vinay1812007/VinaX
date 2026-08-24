/**
 * Notification eligibility gate (engine steps 5 + 7) — the server-side
 * fatigue + send-time guard that every user-facing push (ai-daily-push,
 * song-push) runs its recipient list through before sending.
 *
 * Privacy note: per-user TASTE stays on the device and never reaches here.
 * This gate only uses coarse, non-identifying facts the server already keeps
 * on a subscription row — the device's UTC offset (for quiet hours) and when
 * we last pushed it (for the frequency cap). Nothing about what a person
 * listens to is involved.
 *
 * Two rules:
 *   1. QUIET HOURS — never wake someone overnight. A device whose LOCAL time
 *      is within [QUIET_START, QUIET_END) is skipped this fire; the next
 *      daytime fire reaches them instead.
 *   2. FREQUENCY CAP — at most one push per device per ~MIN_GAP_HOURS, so a
 *      device that got the daily song push doesn't also get an AI push the
 *      same evening. Tunable via env NOTIFY_MIN_GAP_HOURS.
 */

/** Local hours in [start,end) are quiet. 23→8 = 11pm through 8am. */
export const QUIET_START = 23;
export const QUIET_END = 8;
const DEFAULT_MIN_GAP_HOURS = 18;

import { sbUpdate, type SupabaseEnv } from './supabase';

export interface GateEnv {
  NOTIFY_MIN_GAP_HOURS?: string;
}

/** One recipient row, as the crons already fetch it (plus the two gate cols). */
export interface GateRow {
  tz_offset?: number | null; // minutes EAST of UTC (India = +330)
  last_pushed_at?: string | null; // ISO, or null if never pushed
  country?: string | null; // fallback tz source when tz_offset is absent
}

/**
 * Coarse country→UTC-offset fallback (minutes) for rows subscribed before the
 * client began sending tz_offset. India-first: unknown countries default to
 * IST since that's the overwhelming majority of the base. Multi-zone
 * countries (US, etc.) use a representative offset — good enough to avoid
 * pushing at 3am, not a precise clock.
 */
const COUNTRY_TZ: Record<string, number> = {
  IN: 330, LK: 330, NP: 345, PK: 300, BD: 360,
  AE: 240, SA: 180, QA: 180, KW: 180, OM: 240, BH: 180,
  SG: 480, MY: 480, HK: 480, CN: 480, JP: 540, KR: 540, TH: 420, ID: 420, PH: 480,
  GB: 0, IE: 0, DE: 60, FR: 60, IT: 60, ES: 60, NL: 60, SE: 60, CH: 60,
  US: -300, CA: -300, // Eastern-ish representative
  AU: 600, NZ: 720, ZA: 120, NG: 60, KE: 180, EG: 120,
};

export function tzOffsetFor(row: GateRow): number {
  if (typeof row.tz_offset === 'number' && Number.isFinite(row.tz_offset)) return row.tz_offset;
  const cc = (row.country ?? '').toUpperCase();
  return COUNTRY_TZ[cc] ?? 330;
}

/** Local hour (0–23) for a device given its UTC offset. */
export function localHour(offsetMin: number, nowMs: number): number {
  const localMs = nowMs + offsetMin * 60_000;
  return Math.floor(localMs / 3_600_000) % 24;
}

export function inQuietHours(offsetMin: number, nowMs: number): boolean {
  const h = localHour(offsetMin, nowMs);
  // 23→8 wraps midnight: blocked when h>=23 OR h<8.
  return QUIET_START > QUIET_END ? h >= QUIET_START || h < QUIET_END : h >= QUIET_START && h < QUIET_END;
}

export function minGapHours(env: GateEnv): number {
  const n = Number(env.NOTIFY_MIN_GAP_HOURS);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_MIN_GAP_HOURS;
}

export interface GateResult<T> {
  eligible: T[];
  skippedQuiet: number;
  skippedFatigue: number;
}

/**
 * Filter a recipient list to those that may be pushed right now. Pure — the
 * caller sends only to `eligible` and reports the skip counts for the admin
 * notify log.
 */
export function gateRecipients<T extends GateRow>(rows: T[], env: GateEnv, nowMs: number): GateResult<T> {
  const gapMs = minGapHours(env) * 3_600_000;
  const eligible: T[] = [];
  let skippedQuiet = 0;
  let skippedFatigue = 0;
  for (const row of rows) {
    if (row.last_pushed_at) {
      const last = new Date(row.last_pushed_at).getTime();
      if (Number.isFinite(last) && nowMs - last < gapMs) {
        skippedFatigue += 1;
        continue;
      }
    }
    if (inQuietHours(tzOffsetFor(row), nowMs)) {
      skippedQuiet += 1;
      continue;
    }
    eligible.push(row);
  }
  return { eligible, skippedQuiet, skippedFatigue };
}

/** Sanitize a client-sent tz offset (minutes east of UTC) to a sane range. */
export function cleanTzOffset(raw: unknown): number | null {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return null;
  const v = Math.round(raw);
  return v >= -720 && v <= 840 ? v : null;
}

/**
 * Record that these devices were just pushed, so the frequency cap sees them
 * on the next fire. Chunked bulk PATCH (…?col=in.(…)) — one write per ~50
 * devices instead of one per device. Best-effort: a failed stamp only risks
 * an extra push next fire, never a lost send. `keys` are endpoints (web) or
 * tokens (fcm); `col` names the matching primary-key column.
 */
export async function stampPushed(
  env: SupabaseEnv,
  table: 'vinax_push_subscriptions' | 'vinax_fcm_tokens',
  col: 'endpoint' | 'token',
  keys: string[],
  nowIso: string,
): Promise<void> {
  const CHUNK = 50;
  for (let i = 0; i < keys.length; i += CHUNK) {
    const slice = keys.slice(i, i + CHUNK);
    // Double-quote each value so reserved URL chars in endpoints are treated
    // as literal; percent-encode for URL safety (PostgREST decodes).
    const list = slice.map((k) => `"${encodeURIComponent(k)}"`).join(',');
    await sbUpdate(env, table, `${col}=in.(${list})`, { last_pushed_at: nowIso }).catch(() => false);
  }
}
