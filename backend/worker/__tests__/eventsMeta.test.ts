/**
 * `events.meta` is checked by the database in BYTES (events_meta_shape:
 * octet_length(meta::text) <= 2048). The Worker's own cap must be measured
 * the same way, or a meta made of multi-byte text passes the Worker and is
 * then refused by the insert — the event is lost without a trace.
 */
import { describe, expect, it } from 'vitest';
import { sanitizeMeta } from '../functions/api/events';

const bytes = (v: unknown) => new TextEncoder().encode(JSON.stringify(v)).length;

describe('sanitizeMeta', () => {
  it('keeps a small flat record', () => {
    expect(sanitizeMeta('rec_served', { source: 'home', n: 3, ok: true, ids: ['a', 'b'] })).toEqual({ source: 'home', n: 3, ok: true, ids: ['a', 'b'] });
  });

  it('is null for kinds that carry no meta', () => {
    expect(sanitizeMeta('play', { a: 1 })).toBeNull();
  });

  it('refuses a meta over the byte cap even when it is under the character cap', () => {
    // 6 keys × 200 chars of a 4-byte character: 1,200 chars (< 1 KB of
    // characters per key, every value within its own limit) but ~4.8 KB.
    const raw: Record<string, string> = {};
    for (let i = 0; i < 6; i += 1) raw[`k${i}`] = '😀'.repeat(200);
    expect(bytes(raw)).toBeGreaterThan(1024);
    expect(sanitizeMeta('rec_served', raw)).toBeNull();
  });

  it('accepts a meta that fits in bytes', () => {
    const raw: Record<string, string> = {};
    for (let i = 0; i < 4; i += 1) raw[`k${i}`] = 'é'.repeat(100); // 2 bytes each: ~ 850 B
    const out = sanitizeMeta('rec_served', raw);
    expect(out).not.toBeNull();
    expect(bytes(out)).toBeLessThanOrEqual(1024);
  });
});
