// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { deriveIntent, EMPTY_INTENT, getSessionIntent, noteSessionEvent, resetSessionIntent, type SessionEvent } from './sessionIntent';
import { makeSong } from '@/__fixtures__/songs';

const MIN = 60_000;
const NOW = 1_800_000_000_000;
const ev = (minsAgo: number, type: SessionEvent['type'], artist: string, over: Partial<SessionEvent> = {}): SessionEvent => ({ t: NOW - minsAgo * MIN, type, artist, language: 'telugu', energy: 0.5, songId: `${artist}-${minsAgo}`, ...over });

beforeEach(() => resetSessionIntent());

describe('deriveIntent', () => {
  it('is empty without events and ignores a previous sitting', () => {
    expect(deriveIntent([], NOW)).toBe(EMPTY_INTENT);
    const intent = deriveIntent([ev(200, 'skip', 'old'), ev(199, 'skip', 'old'), ev(2, 'complete', 'new')], NOW);
    expect(intent.size).toBe(1);
    expect(intent.artistPull.old).toBeUndefined();
    expect(intent.skipStreak).toBe(0);
    expect(intent.completionStreak).toBe(1);
  });

  it('counts a skip streak, pushes the skipped artist down and leans familiar', () => {
    const intent = deriveIntent([ev(9, 'complete', 'a'), ev(6, 'skip', 'b'), ev(4, 'skip', 'b'), ev(1, 'skip', 'c')], NOW);
    expect(intent.skipStreak).toBe(3);
    expect(intent.completionStreak).toBe(0);
    expect(intent.artistPull.b).toBeLessThan(-0.5);
    expect(intent.artistPull.a).toBeGreaterThan(0);
    expect(intent.discoveryAppetite).toBeLessThan(0);
    expect([...intent.skippedSongIds]).toEqual(['b-6', 'b-4', 'c-1']);
  });

  it('lets likes and queue-adds sit inside a completion streak, and earns room to explore after four', () => {
    const events = [ev(20, 'complete', 'a'), ev(16, 'complete', 'a'), ev(15, 'like', 'a'), ev(12, 'complete', 'b'), ev(8, 'complete', 'c'), ev(4, 'complete', 'd')];
    const intent = deriveIntent(events, NOW);
    expect(intent.completionStreak).toBe(5);
    expect(intent.discoveryAppetite).toBeGreaterThan(0);
    expect(intent.artistPull.a).toBeGreaterThan(intent.artistPull.b);
  });

  it('treats searches and hand queue-adds as a strong pull and as knowing what you want', () => {
    const intent = deriveIntent([ev(3, 'search_play', 'sid sriram'), ev(2, 'queue_add', 'sid sriram')], NOW);
    expect(intent.artistPull['sid sriram']).toBeGreaterThan(0.6);
    expect(intent.discoveryAppetite).toBeLessThan(0);
  });

  it('steers energy toward what was finished and away from what was skipped, within bounds', () => {
    const events = [ev(10, 'complete', 'a', { energy: 0.2 }), ev(8, 'complete', 'b', { energy: 0.25 }), ev(5, 'skip', 'c', { energy: 0.9 }), ev(2, 'skip', 'd', { energy: 0.9 })];
    const intent = deriveIntent(events, NOW);
    expect(intent.energySteer).toBe(-0.3);
    expect(deriveIntent(events.slice(0, 3), NOW).energySteer).toBe(0); // one skip is not a pattern
  });

  it('moves a language slower and less far than an artist, and keeps every pull bounded', () => {
    const many = Array.from({ length: 12 }, (_, i) => ev(12 - i, 'skip', 'x'));
    const intent = deriveIntent(many, NOW);
    expect(intent.artistPull.x).toBe(-1);
    expect(intent.languagePull.telugu).toBe(-0.6);
    const two = deriveIntent(many.slice(-2), NOW);
    expect(Math.abs(two.languagePull.telugu)).toBeLessThan(Math.abs(two.artistPull.x) / 2);
  });
});

describe('noteSessionEvent', () => {
  it('survives a corrupt store and keeps the session apart from long-term data', () => {
    window.sessionStorage.setItem('vinax.session.intent.v1', '{not json');
    noteSessionEvent('skip', makeSong('1', { artist: 'Skipped One' }), NOW - MIN);
    noteSessionEvent('skip', makeSong('2', { artist: 'Skipped One' }), NOW);
    const intent = getSessionIntent(NOW);
    expect(intent.skipStreak).toBe(2);
    expect(intent.artistPull['skipped one']).toBeLessThan(0);
    expect(window.localStorage.getItem('vinax.session.intent.v1')).toBeNull();
  });
});
