// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Song } from '@/types';
import type { Candidate, RecommendationContext } from './types';
import { makeContext, makePlay, makeSong, warmProfile } from '@/__fixtures__/songs';

/**
 * v7.1.0 — "the next five": same language as the seed, the strongest and most
 * familiar hand-off first, related songs introduced gradually — and a tune or
 * a pinned mood fetches songs FOR that intent.
 */
let pool: Candidate[] = [];
const seenCtx: RecommendationContext[] = [];
vi.mock('./candidates', () => ({
  gatherCandidates: vi.fn(async () => pool),
  generateNextCandidates: vi.fn(async (_seed: Song, ctx: RecommendationContext) => { seenCtx.push(ctx); return pool; }),
}));
vi.mock('@/services/ai/recommendations', () => ({ enrichSongs: vi.fn(async (songs: Song[]) => songs), aiRerankSongs: vi.fn(async (songs: Song[]) => songs) }));
vi.mock('@/services/ai/dj', () => ({ djSequence: vi.fn(async () => null), samplePool: (songs: Song[]) => songs }));
vi.mock('@/services/queryClient', () => ({ queryClient: { getQueryData: () => undefined } }));

import { recommendNextSongs } from './engine';
import { sequenceSongs } from './sequencer';
import { tuneSearchQuery } from './tune';
import { describePoolSong, knownTo } from '@/services/ai/dj';
import { useSettingsStore } from '@/store/settingsStore';
import { resetTransitionMemory } from './transitions';

vi.unmock('@/services/ai/dj');

const NOW = 1_800_000_000_000;
const seed = makeSong('seed', { title: 'Seed', artist: 'Sid Sriram' });
const cand = (song: Song, source: Candidate['source'] = 'related'): Candidate => ({ song, source });

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  resetTransitionMemory();
  seenCtx.length = 0;
  useSettingsStore.setState({ aiDj: false, kidMode: false, mutedLanguages: [] });
});

describe('the next five', () => {
  it('stays in the seed language in every discovery mode — Discover no longer detours', async () => {
    pool = [
      ...Array.from({ length: 9 }, (_, i) => cand(makeSong(`te${i}`, { artist: `Artist ${i}` }))),
      ...Array.from({ length: 6 }, (_, i) => cand(makeSong(`hi${i}`, { artist: `Hindi ${i}`, language: 'hindi', playCount: 90_000_000 }))),
    ];
    for (const discoveryMode of ['familiar', 'balanced', 'discover'] as const) {
      const out = await recommendNextSongs(seed, makeContext({ profile: warmProfile(NOW), pinnedLanguages: ['telugu', 'hindi'], discoveryMode }), { limit: 5 });
      expect(out).toHaveLength(5);
      expect(out.every((s) => s.language === 'telugu')).toBe(true);
    }
  });

  it('opens with a familiar hand-off and introduces never-played artists only later', () => {
    const known = [makeSong('k1', { artist: 'Known A' }), makeSong('k2', { artist: 'Known B' })];
    const fresh = Array.from({ length: 4 }, (_, i) => makeSong(`n${i}`, { artist: `New ${i}` }));
    // Ranked with the strangers FIRST: taste alone would open with them.
    const arc = sequenceSongs([...fresh, ...known], { seed, limit: 5, language: 'telugu', discovery: 0.45, sureIds: new Set(['k1', 'k2']), discoveryIds: new Set(fresh.map((s) => s.id)) });
    const order = arc.songs.map((s) => s.song.id);
    expect(order.slice(0, 2).sort()).toEqual(['k1', 'k2']);
    expect(arc.songs[0].why).toContain('a familiar way in');
    expect(order.slice(2).every((id) => id.startsWith('n'))).toBe(true);
    // The old behaviour is still available to callers that want a pure arc.
    const flat = sequenceSongs([...fresh, ...known], { seed, limit: 5, language: 'telugu', discovery: 0.45, familiarFirst: false, sureIds: new Set(['k1', 'k2']), discoveryIds: new Set(fresh.map((s) => s.id)) });
    expect(flat.songs[0].song.id.startsWith('n')).toBe(true);
  });

  it('a tune or a pinned mood fetches songs FOR the intent, in the queue’s language', async () => {
    pool = Array.from({ length: 8 }, (_, i) => cand(makeSong(`te${i}`, { artist: `Artist ${i}` })));
    await recommendNextSongs(seed, makeContext({ profile: warmProfile(NOW) }), { limit: 5, tune: 'devotional' });
    expect(seenCtx[0].intentQuery).toBe('telugu devotional songs');
    await recommendNextSongs(seed, makeContext({ profile: warmProfile(NOW), moodPin: 'melancholy' }), { limit: 5 });
    expect(seenCtx[1].intentQuery).toBe('telugu sad heartbreak songs');
    await recommendNextSongs(seed, makeContext({ profile: warmProfile(NOW) }), { limit: 5 });
    expect(seenCtx[2].intentQuery ?? null).toBeNull();
    expect(tuneSearchQuery('same-language', 'telugu')).toBeNull();
  });

  it('songs gathered for the intent outrank the passive pool', async () => {
    pool = [
      ...Array.from({ length: 8 }, (_, i) => cand(makeSong(`p${i}`, { artist: `Passive ${i}` }))),
      ...Array.from({ length: 5 }, (_, i) => cand(makeSong(`d${i}`, { title: `Govinda Bhajan ${i}`, artist: `Devotional ${i}` }), 'intent')),
    ];
    const out = await recommendNextSongs(seed, makeContext({ profile: warmProfile(NOW) }), { limit: 5, tune: 'devotional' });
    expect(out.filter((s) => s.id.startsWith('d')).length).toBeGreaterThanOrEqual(4);
  });
});

describe('what the DJ is told about a pool song', () => {
  it('adds album, year and familiarity — and nothing that identifies the listener', () => {
    const played = makeSong('played', { artist: 'Known Artist', album: { id: 'al', name: 'Ala Vaikunthapurramuloo' } as never, year: '2020' });
    const ctx = makeContext({ history: [makePlay(played, NOW)], favorites: [] });
    const known = knownTo(ctx);
    expect(describePoolSong(played, known)).toEqual({ id: 'played', title: 'Song played', artist: 'Known Artist', language: 'telugu', album: 'Ala Vaikunthapurramuloo', year: '2020', known: true });
    expect(describePoolSong(makeSong('other', { artist: 'Known Artist', year: 'soon' }), known)).toEqual({ id: 'other', title: 'Song other', artist: 'Known Artist', language: 'telugu', known: true });
    expect(describePoolSong(makeSong('new', { artist: 'Stranger' }), known)).not.toHaveProperty('known');
  });
});
