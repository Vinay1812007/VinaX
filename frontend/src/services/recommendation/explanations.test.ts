import { describe, expect, it } from 'vitest';
import { explainReasons, explainTopReasons } from './explanations';
import type { ReasonComponent } from './types';
import type { Song } from '@/types';

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
    expect(explainTopReasons([])).toBe('Picked on this device from your listening');
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

describe('8.3.0 — the style line', () => {
  it('says the style is kept, or that a song outside it was held back', () => {
    expect(explainReasons([r('style', 0.4, 'dj')])).toBe('Keeps the DJ remix going');
    expect(explainReasons([r('style', 0.25, 'folk')])).toBe('More folk songs, like the one playing');
    expect(explainReasons([r('style', 0.4, 'devotional')])).toBe('More devotional songs, like the one playing');
    expect(explainReasons([r('style', -0.3, 'off-dj')])).toBe('Held back — not a DJ remix song');
    expect(explainReasons([r('style', 0.1)])).toBe('Keeps the style that is playing');
  });
});

describe('9.0.0 — "Why this song?" quotes only what added to the score', () => {
  it('never explains a song by a penalty', () => {
    const line = explainTopReasons([r('history', -0.5), r('served', -0.04, 'shown recently'), r('fatigue', -0.08), r('related', 0.18, 'Neeli Megham')]);
    expect(line).toBe('Similar to “Neeli Megham”');
  });

  it('an unknown play count is not "Popular right now"', () => {
    expect(explainTopReasons([r('popularity', 0.04, 'unknown')])).toBe('Picked on this device from your listening');
    expect(explainTopReasons([r('popularity', 0.12)])).toBe('Popular right now');
  });

  it('tells the playing song’s language apart from the listener’s habit', () => {
    expect(explainReasons([r('language', 0.12, 'same:telugu')])).toBe('In the same language as the song playing');
    expect(explainReasons([r('language', 0.2, 'telugu')])).toBe('Because you listen to Telugu music');
  });

  it('a term too small to matter is not a reason', () => {
    expect(explainTopReasons([r('time', 0.005), r('dial', 0.01)])).toBe('Picked on this device from your listening');
  });

  it('a real scored candidate gets reasons from its real terms', async () => {
    const { scoreCandidate } = await import('./scoring');
    const { createEmptyProfile } = await import('../personalization/profile');
    const song: Song = { kind: 'song', id: 'x', title: 'X', subtitle: 'A', artists: [{ id: 'a', name: 'A' }], album: null, images: [], audio: [], duration: 200, language: 'telugu', year: null, explicit: false, hasLyrics: false, playCount: null };
    const scored = scoreCandidate({ song: { ...song }, source: 'related', seedTitle: 'Seed' }, { profile: createEmptyProfile(0), hour: 12, region: null, pinnedLanguages: [], mutedLanguages: [], intensity: 0.6, favorites: [], history: [], salt: 1, seedSong: { ...song, id: 'seed' } });
    const line = explainTopReasons(scored.reasons);
    expect(line).toContain('Similar to “Seed”');
    expect(line).toContain('In the same language as the song playing');
    expect(line).not.toMatch(/Popular right now/);
  });
});
