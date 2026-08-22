import { describe, expect, it } from 'vitest';
import { assignVariant, bucketOf, sanitizeVariants } from '../../worker/functions/_lib/experiments';
import { pickVariant } from '../features/experiments/useExperiment';

/**
 * E2 — the whole framework rests on ONE invariant: the client's pickVariant
 * and the server's assignVariant produce the same answer for the same device,
 * forever. These tests pin both to shared fixtures; if either side's hash or
 * bucket-walk drifts, this file goes red before any dashboard lies.
 */
const VARIANTS = [
  { name: 'control', pct: 50 },
  { name: 'b', pct: 50 },
];

describe('client/server assignment parity (E2)', () => {
  it('agrees on every device across a wide sample', () => {
    for (let i = 0; i < 500; i += 1) {
      const dev = `device-${i}-${(i * 2654435761) >>> 0}`;
      const server = assignVariant(dev, { key: 'exp-a', variants: VARIANTS, active: true });
      const client = pickVariant(dev, 'exp-a', VARIANTS);
      expect(client).toBe(server);
    }
  });

  it('assignment is sticky and experiment-scoped', () => {
    expect(pickVariant('dev-1', 'exp-a', VARIANTS)).toBe(pickVariant('dev-1', 'exp-a', VARIANTS));
    // Different experiments re-shuffle: buckets must not correlate across keys.
    const same = Array.from({ length: 200 }, (_, i) => `d${i}`).filter(
      (d) => bucketOf(d, 'exp-a') === bucketOf(d, 'exp-b'),
    ).length;
    expect(same).toBeLessThan(20); // ~2 expected by chance; 20 = generous ceiling
  });

  it('splits traffic roughly by pct and leaves the remainder out', () => {
    const partial = [
      { name: 'control', pct: 10 },
      { name: 'b', pct: 10 },
    ];
    let inExp = 0;
    for (let i = 0; i < 1000; i += 1) {
      if (pickVariant(`u${i}`, 'small-exp', partial) != null) inExp += 1;
    }
    // 20% allocated → expect ~200 of 1000, wide tolerance for hash variance.
    expect(inExp).toBeGreaterThan(120);
    expect(inExp).toBeLessThan(280);
  });

  it('paused experiments and empty devices assign nothing (server side)', () => {
    expect(assignVariant('dev-1', { key: 'x', variants: VARIANTS, active: false })).toBeNull();
    expect(assignVariant('', { key: 'x', variants: VARIANTS, active: true })).toBeNull();
  });
});

describe('sanitizeVariants (E2)', () => {
  it('bounds names/pcts and refuses over-allocation past 100%', () => {
    const out = sanitizeVariants([
      { name: 'control', pct: 60 },
      { name: 'b', pct: 50 }, // 60+50 > 100 → dropped
      { name: '', pct: 10 },
      { name: 'c', pct: 0 },
    ]);
    expect(out).toEqual([{ name: 'control', pct: 60 }]);
  });

  it('tolerates garbage', () => {
    expect(sanitizeVariants(null)).toEqual([]);
    expect(sanitizeVariants([{ name: 'x', pct: 'lots' }])).toEqual([]);
  });
});

describe('home-shelf-order surface (roadmap O.2)', async () => {
  const { EXP_HOME_SHELF_ORDER, homeShelfOrder } = await import('../features/experiments/homeShelfOrder');

  it('defaults to control for the hook cold state, unknown variants, and typos', () => {
    expect(homeShelfOrder('control')).toBe('control'); // pre-config hook value
    expect(homeShelfOrder('')).toBe('control');
    expect(homeShelfOrder('discovery_first')).toBe('control'); // admin typo → safe
    expect(homeShelfOrder('some-future-variant')).toBe('control');
  });

  it('maps only the exact discovery-first variant to the reordered layout', () => {
    expect(homeShelfOrder('discovery-first')).toBe('discovery-first');
  });

  it('the experiment key matches what the admin dashboard must create', () => {
    expect(EXP_HOME_SHELF_ORDER).toBe('home-shelf-order');
  });
});
