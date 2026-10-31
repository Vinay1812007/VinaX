import { describe, expect, it } from 'vitest';
import { BloomFilter, bloomShape } from './bloom';

describe('BloomFilter', () => {
  it('never forgets a key it was given', () => {
    const f = new BloomFilter(5_000, 0.01);
    const keys = Array.from({ length: 5_000 }, (_, i) => `song ${i}|artist ${i % 97}`);
    for (const k of keys) f.add(k);
    expect(keys.every((k) => f.has(k))).toBe(true);
    expect(f.count).toBe(5_000);
    expect(f.full).toBe(false);
  });

  it('keeps false positives near the rate it was sized for', () => {
    const f = new BloomFilter(10_000, 0.01);
    for (let i = 0; i < 10_000; i += 1) f.add(`heard ${i}|singer`);
    let hits = 0;
    const probes = 20_000;
    for (let i = 0; i < probes; i += 1) if (f.has(`never ${i}|someone`)) hits += 1;
    // About 1 %: allow the sampling noise, never anything like a broken filter.
    expect(hits / probes).toBeLessThan(0.02);
  });

  it('says so once it holds more than it was sized for', () => {
    const f = new BloomFilter(10, 0.01);
    for (let i = 0; i <= 10; i += 1) f.add(String(i));
    expect(f.full).toBe(true);
  });

  it('sizes itself from capacity and rate (about 9.6 bits and 7 hashes per key at 1 %)', () => {
    const { bits, hashes } = bloomShape(1_000, 0.01);
    expect(bits / 1_000).toBeGreaterThan(9.5);
    expect(bits / 1_000).toBeLessThan(9.7);
    expect(hashes).toBe(7);
  });
});
