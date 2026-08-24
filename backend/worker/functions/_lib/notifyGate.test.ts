/**
 * Notification gate: quiet-hours + frequency-cap eligibility (engine steps 5/7).
 */
import { describe, expect, it } from 'vitest';
import { cleanTzOffset, gateRecipients, inQuietHours, localHour, tzOffsetFor } from './notifyGate';

// A fixed instant: 2026-01-15T18:00:00Z (UTC 18:00).
const NOW = Date.UTC(2026, 0, 15, 18, 0, 0);

describe('localHour / quiet hours', () => {
  it('converts UTC to local by offset', () => {
    expect(localHour(330, NOW)).toBe(23); // IST 23:30 → hour 23
    expect(localHour(0, NOW)).toBe(18);
    expect(localHour(-300, NOW)).toBe(13); // US Eastern-ish 13:00
  });

  it('blocks 11pm–8am local, allows daytime', () => {
    expect(inQuietHours(330, NOW)).toBe(true); // IST 23:30 → quiet
    expect(inQuietHours(0, NOW)).toBe(false); // UTC 18:00 → fine
    expect(inQuietHours(-300, NOW)).toBe(false); // 13:00 → fine
    // A device at local 03:00 is quiet; local 09:00 is not.
    const at3 = Date.UTC(2026, 0, 15, 3, 0, 0);
    expect(inQuietHours(0, at3)).toBe(true);
    const at9 = Date.UTC(2026, 0, 15, 9, 0, 0);
    expect(inQuietHours(0, at9)).toBe(false);
  });
});

describe('tzOffsetFor fallback', () => {
  it('prefers the stored offset', () => {
    expect(tzOffsetFor({ tz_offset: 60, country: 'IN' })).toBe(60);
  });
  it('falls back to country, then India default', () => {
    expect(tzOffsetFor({ tz_offset: null, country: 'US' })).toBe(-300);
    expect(tzOffsetFor({ tz_offset: null, country: 'ZZ' })).toBe(330);
    expect(tzOffsetFor({})).toBe(330);
  });
});

describe('gateRecipients', () => {
  const env = { NOTIFY_MIN_GAP_HOURS: '18' };
  it('drops quiet-hours and recently-pushed devices', () => {
    const rows = [
      { id: 'daytime-fresh', tz_offset: 0, last_pushed_at: null }, // 18:00 local, never pushed → eligible
      { id: 'quiet', tz_offset: 330, last_pushed_at: null }, // 23:30 IST → quiet
      { id: 'recent', tz_offset: 0, last_pushed_at: new Date(NOW - 2 * 3_600_000).toISOString() }, // pushed 2h ago → fatigue
      { id: 'old-push', tz_offset: 0, last_pushed_at: new Date(NOW - 20 * 3_600_000).toISOString() }, // 20h ago → eligible
    ];
    const r = gateRecipients(rows, env, NOW);
    expect(r.eligible.map((x) => x.id)).toEqual(['daytime-fresh', 'old-push']);
    expect(r.skippedQuiet).toBe(1);
    expect(r.skippedFatigue).toBe(1);
  });
});

describe('cleanTzOffset', () => {
  it('accepts sane offsets, rejects junk', () => {
    expect(cleanTzOffset(330)).toBe(330);
    expect(cleanTzOffset(-300)).toBe(-300);
    expect(cleanTzOffset(9999)).toBeNull();
    expect(cleanTzOffset('330')).toBeNull();
    expect(cleanTzOffset(undefined)).toBeNull();
  });
});
