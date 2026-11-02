import { describe, expect, it } from 'vitest';
import { inAudience, pickVariant, variantFor } from './useExperiment';

/** Console rebuild — A/B test targeting (mirrors functions/_lib/experiments.ts inAudience; same fixtures as the Worker test). */
describe('inAudience', () => {
  it('no audience is everyone', () => {
    expect(inAudience('d1', 'k', null, { platform: 'web', version: '1.0.0' })).toBe(true);
  });
  it('platform and minimum version', () => {
    expect(inAudience('d1', 'k', { platform: 'android' }, { platform: 'web', version: '9.9.9' })).toBe(false);
    expect(inAudience('d1', 'k', { platform: 'android', minVersion: '1.8.0' }, { platform: 'android', version: '1.7.9' })).toBe(false);
    expect(inAudience('d1', 'k', { platform: 'android', minVersion: '1.8.0' }, { platform: 'android', version: '1.10.0' })).toBe(true);
    expect(inAudience('d1', 'k', { platform: 'all', minVersion: '2.0' }, { platform: 'web', version: '' })).toBe(false);
  });
  it('percent is a stable second hash: about that share of devices, nested as it grows', () => {
    let n = 0;
    for (let i = 0; i < 2000; i += 1) {
      const id = `dev-${i}`;
      const at25 = inAudience(id, 'k', { percent: 25 }, { platform: 'web', version: '1' });
      if (at25) {
        n += 1;
        expect(inAudience(id, 'k', { percent: 60 }, { platform: 'web', version: '1' })).toBe(true);
      }
    }
    expect(n).toBeGreaterThan(400);
    expect(n).toBeLessThan(600);
    expect(inAudience('d1', 'k', { percent: 0 }, { platform: 'web', version: '1' })).toBe(false);
  });
  it('variantFor leaves out devices outside the audience', () => {
    const exp = { key: 'k', variants: [{ name: 'a', pct: 100 }], audience: { percent: 0 } };
    expect(variantFor('d1', exp)).toBeNull();
    expect(variantFor('d1', { ...exp, audience: null })).toBe(pickVariant('d1', 'k', exp.variants));
  });
});
