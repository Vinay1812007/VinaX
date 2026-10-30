/** v5.13.0 — feature flags: only well-named booleans reach clients. */
import { describe, expect, it } from 'vitest';
import { publicFlags } from '../functions/api/appconfig';

describe('publicFlags', () => {
  it('keeps boolean flags with sane names and drops everything else', () => {
    expect(publicFlags({ festivalBar: false, listenTogether: true, 'bad name': true, nested: { a: 1 }, count: 3, '9x': true })).toEqual({
      festivalBar: false,
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
