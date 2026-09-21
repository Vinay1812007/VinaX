import { describe, expect, it } from 'vitest';
import { explainReasons, explainTopReasons } from './explanations';
import type { ReasonComponent } from './types';

const r = (kind: ReasonComponent['kind'], weight: number, detail?: string): ReasonComponent => ({
  kind,
  weight,
  detail,
});

describe('explainReasons — discovery (A4)', () => {
  it('names the unheard language when known', () => {
    expect(explainReasons([r('discovery', 0.08, 'bhojpuri')])).toMatch(/Something different — Bhojpuri/);
    expect(explainReasons([r('discovery', 0.08)])).toBe('Something different — outside your usual');
  });
});

describe('explainTopReasons (C4)', () => {
  it('joins up to three distinct reasons into one plain line', () => {
    const line = explainTopReasons([
      r('artist', 0.3, 'Sid Sriram'),
      r('artist', 0.2, 'Sid Sriram'), // duplicate kind — skipped
      r('language', 0.2, 'telugu'),
      r('trending', 0.1),
      r('time', 0.05),
    ]);
    expect(line).toBe('Because you play Sid Sriram · Because you listen to Telugu music · Trending in your languages');
  });

  it('falls back honestly when there are no reasons', () => {
    expect(explainTopReasons([])).toBe('Popular right now');
  });
});

describe('7.2.0 — every recorded reason has its own line', () => {
  it('never falls back to "Popular right now" for a term that is not popularity', () => {
    const kinds: ReasonComponent['kind'][] = ['language', 'artist', 'co-play', 'popularity', 'low-skip', 'trending', 'rediscovery', 'related', 'time', 'mood', 'session', 'region', 'discovery', 'dialect', 'genre', 'vibe', 'energy', 'tempo', 'history', 'likes', 'diversity', 'song', 'day', 'familiar', 'fatigue', 'intent', 'agreement', 'fresh', 'festival', 'dial'];
    for (const kind of kinds) {
      const line = explainReasons([{ kind, weight: 0.1 }]);
      expect(line.length).toBeGreaterThan(3);
      if (kind !== 'popularity') expect(line).not.toBe('Popular right now');
    }
  });
});
