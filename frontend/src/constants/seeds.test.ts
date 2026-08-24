import { describe, it, expect } from 'vitest';
import { trendingSeed, newReleasesSeed, moodSeed } from './seeds';

describe('trendingSeed', () => {
  it('includes the language label', () => {
    expect(trendingSeed('telugu', 0).toLowerCase()).toContain('telugu');
  });

  it('varies with the salt (anti-repeat)', () => {
    expect(trendingSeed('telugu', 0)).not.toBe(trendingSeed('telugu', 3));
  });

  it('drops the "unknown" placeholder language', () => {
    expect(trendingSeed('unknown', 0).toLowerCase()).not.toContain('unknown');
  });
});

describe('seed helpers', () => {
  it('newReleasesSeed mentions the language', () => {
    expect(newReleasesSeed('hindi').toLowerCase()).toContain('hindi');
  });
  it('moodSeed combines language + mood query', () => {
    const s = moodSeed('workout', 'tamil').toLowerCase();
    expect(s).toContain('tamil');
    expect(s).toContain('workout');
  });
});
