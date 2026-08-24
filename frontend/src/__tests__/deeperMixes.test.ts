/**
 * 4.13.0 — deeper personal mixes. Each new mix ("Late Night Yours",
 * "Welcome Back", "Artist Radio", "Sunday Slowburn", "Discover Weekly")
 * only appears when the moment actually justifies it — no fake always-on
 * shelves. These tests pin the appearance contract, not the ordering of
 * songs (that's the scorer's business).
 */
import { describe, expect, it, vi, afterEach } from 'vitest';
import type { HistoryEntry, Song } from '@/types';
import { buildMixes } from '../services/recommendation/mixes';
import type { RecommendationContext, ScoredCandidate } from '../services/recommendation/types';
import { createEmptyProfile } from '../services/personalization/profile';

let seq = 0;
function song(id: string, extra: Partial<Song> = {}): Song {
  seq += 1;
  return {
    kind: 'song', id: id || `s${seq}`, title: `Track ${seq}`, subtitle: 'Artist',
    artists: extra.artists ?? [], album: null, images: [], audio: [],
    duration: extra.duration ?? 220, language: 'telugu', year: '2024',
    explicit: false, hasLyrics: false, playCount: null,
    ...extra,
  };
}
const cand = (s: Song, source: ScoredCandidate['candidate']['source'] = 'related'): ScoredCandidate => ({
  candidate: { song: s, source, seedTitle: undefined },
  score: 1,
  reasons: [{ kind: 'artist', weight: 0.3 }],
});

function ctxAt(hour: number, opts: Partial<RecommendationContext> = {}): RecommendationContext {
  const profile = createEmptyProfile(Date.now());
  return {
    salt: 0, profile, hour, region: null,
    pinnedLanguages: ['telugu'], mutedLanguages: [],
    intensity: 0.7, favorites: [], history: [], sessionSize: 0,
    festival: null, explore: false,
    ...opts,
  };
}

afterEach(() => vi.useRealTimers());

describe('Late Night — only 22:00–04:00', () => {
  it('appears at 23:00, absent at 15:00', () => {
    const pool = Array.from({ length: 220 }, (_, i) => cand(song(`n${i}`)));
    expect(buildMixes(pool, ctxAt(23)).some((m) => m.kind === 'late-night')).toBe(true);
    expect(buildMixes(pool, ctxAt(15)).some((m) => m.kind === 'late-night')).toBe(false);
    expect(buildMixes(pool, ctxAt(3)).some((m) => m.kind === 'late-night')).toBe(true);
  });
});

describe('Weekend Slowburn — only Sat/Sun', () => {
  it('appears on Sunday with slower tracks, absent midweek', () => {
    const pool = Array.from({ length: 220 }, (_, i) => cand(song(`w${i}`, { duration: 260 })));
    // Sunday 10 AM
    vi.setSystemTime(new Date(2026, 7, 9, 10, 0));
    expect(buildMixes(pool, ctxAt(10)).some((m) => m.kind === 'weekend')).toBe(true);
    // Wednesday 10 AM
    vi.setSystemTime(new Date(2026, 7, 12, 10, 0));
    expect(buildMixes(pool, ctxAt(10)).some((m) => m.kind === 'weekend')).toBe(false);
  });
});

describe('Welcome Back — only after a real break', () => {
  it('appears after 3+ days idle, absent for daily listeners', () => {
    const pool = Array.from({ length: 220 }, (_, i) => cand(song(`c${i}`)));
    const stale: HistoryEntry[] = [{ song: song('old'), ts: Date.now() - 7 * 86_400_000, completed: true }];
    const fresh: HistoryEntry[] = [{ song: song('now'), ts: Date.now() - 2 * 60_000, completed: true }];
    expect(buildMixes(pool, ctxAt(11, { history: stale })).some((m) => m.kind === 'comeback')).toBe(true);
    expect(buildMixes(pool, ctxAt(11, { history: fresh })).some((m) => m.kind === 'comeback')).toBe(false);
  });
});

describe('Artist Radio — anchors on the #1 artist once they cross 5 plays', () => {
  it("emits the artist's name in the title", () => {
    const profile = createEmptyProfile(Date.now());
    profile.artists['anirudh'] = { name: 'Anirudh Ravichander', score: 8, plays: 42, completes: 30, skips: 1, lastTs: Date.now() };
    // Six candidates truly BY the artist — enough to clear MIN_MIX_SIZE even
    // with the per-artist diversity cap (which allows up to 3), plus a co-play
    // reason for the rest so the shelf can fill.
    const byArtist = Array.from({ length: 6 }, (_, i) =>
      cand(song(`a${i}`, { artists: [{ id: 'a', name: 'Anirudh Ravichander' }] })),
    );
    const coPlay = Array.from({ length: 20 }, (_, i) => ({
      ...cand(song(`cp${i}`)),
      reasons: [{ kind: 'co-play' as const, weight: 0.1 }],
    }));
    const pool = [...byArtist, ...coPlay, ...Array.from({ length: 220 }, (_, i) => cand(song(`x${i}`)))];
    const mixes = buildMixes(pool, ctxAt(15, { profile }));
    const radio = mixes.find((m) => m.kind === 'artist-radio');
    expect(radio).toBeDefined();
    expect(radio!.title).toContain('Anirudh Ravichander');
  });
});

describe('Discover Weekly — always present, refreshes Monday', () => {
  it('id carries a week-anchored stamp, not the day', () => {
    const pool = Array.from({ length: 220 }, (_, i) => cand(song(`d${i}`)));
    vi.setSystemTime(new Date(2026, 7, 12, 10, 0)); // Wed
    const wed = buildMixes(pool, ctxAt(10)).find((m) => m.kind === 'discover-weekly');
    vi.setSystemTime(new Date(2026, 7, 13, 10, 0)); // Thu
    const thu = buildMixes(pool, ctxAt(10)).find((m) => m.kind === 'discover-weekly');
    expect(wed?.id).toBe(thu?.id); // same week → same id
    vi.setSystemTime(new Date(2026, 7, 17, 10, 0)); // next Mon
    const mon = buildMixes(pool, ctxAt(10)).find((m) => m.kind === 'discover-weekly');
    expect(mon?.id).not.toBe(wed?.id);
  });
});
