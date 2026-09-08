/** v5.13.0 — feature flags: only well-named booleans reach clients. */
import { describe, expect, it } from 'vitest';
import { publicFlags } from '../functions/api/appconfig';
import { ALLOWED_KEYS } from '../functions/api/admin/appconfig';

describe('publicFlags', () => {
  it('keeps boolean flags with sane names and drops everything else', () => {
    expect(publicFlags({ codeRun: false, listenTogether: true, 'bad name': true, nested: { a: 1 }, count: 3, '9x': true })).toEqual({
      codeRun: false,
      listenTogether: true,
    });
  });
  it('is empty for non-objects', () => {
    expect(publicFlags(null)).toEqual({});
    expect(publicFlags(['a'])).toEqual({});
    expect(publicFlags('x')).toEqual({});
  });
  it('caps the number of flags shipped', () => {
    const many: Record<string, boolean> = {};
    for (let i = 0; i < 80; i++) many[`f${i}`] = true;
    expect(Object.keys(publicFlags(many)).length).toBeLessThanOrEqual(50);
  });
});

describe('admin config keys', () => {
  it('allows the v5.13.0 keys the console now publishes', () => {
    for (const k of ['flags', 'runbook', 'trending-pins', 'status-note']) expect(ALLOWED_KEYS.has(k)).toBe(true);
  });
});
