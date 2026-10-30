// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Song } from '@/types';
import type { Candidate } from './types';
import { makeContext, makePlay, makeSong, warmProfile } from '@/__fixtures__/songs';

/**
 * v7.0.0 — the next-song pipeline, end to end, on fixed fixtures: what goes
 * in is a candidate pool; what comes out must obey every rule — and the
 * queue must still be built when a source is slow or down.
 */
let pool: Candidate[] = [];
vi.mock('./candidates', () => ({ gatherCandidates: vi.fn(async () => pool), generateNextCandidates: vi.fn(async () => pool) }));
vi.mock('@/services/queryClient', () => ({ queryClient: { getQueryData: () => undefined } }));

import { recommendNextSongs } from './engine';
import { useSettingsStore } from '@/store/settingsStore';
import { useLibraryStore } from '@/store/libraryStore';
import { useRecsDebugStore } from '@/store/recsDebugStore';
import { resetTransitionMemory } from './transitions';
import { resetRecMemory } from './recMemory';
import { resetExposure } from './exposure';

const NOW = 1_800_000_000_000;
const seed = makeSong('seed', { title: 'Seed', artist: 'Sid Sriram' });
const cand = (song: Song, source: Candidate['source'] = 'related'): Candidate => ({ song, source });
const telugu = (n: number, artist: (i: number) => string = (i) => `Artist ${i}`): Candidate[] => Array.from({ length: n }, (_, i) => cand(makeSong(`te${i}`, { artist: artist(i), playCount: 5_000_000 - i * 1000 })));
const ctx = (over = {}) => makeContext({ profile: warmProfile(NOW), pinnedLanguages: ['telugu', 'hindi'], surface: 'next', ...over });
const lead = (s: Song) => s.artists[0].name;

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  resetTransitionMemory();
  useSettingsStore.setState({ kidMode: false, mutedLanguages: [] });
  useLibraryStore.setState({ hiddenSongIds: [], hiddenArtists: [] });
  useRecsDebugStore.getState().clear();
});

describe('recommendNextSongs — the rules hold', () => {
  it('keeps the queue in the seed language, drops muted languages and never repeats the seed or a version of it', async () => {
    pool = [
      ...telugu(10),
      cand(makeSong('hi1', { artist: 'Arijit Singh', language: 'hindi', playCount: 90_000_000 })),
      cand(makeSong('pa1', { artist: 'Diljit', language: 'punjabi', playCount: 90_000_000 })),
      cand(makeSong('seed-lofi', { title: 'Seed (Lofi Flip)', artist: 'Sid Sriram' })),
      cand(seed),
    ];
    const out = await recommendNextSongs(seed, ctx({ mutedLanguages: ['punjabi'] }), { limit: 8 });
    expect(out).toHaveLength(8);
    expect(out.every((s) => s.language === 'telugu')).toBe(true);
    expect(out.map((s) => s.id)).not.toContain('seed');
    expect(out.map((s) => s.id)).not.toContain('seed-lofi');
  });

  it('does not re-offer what is queued, recently played or skipped in this sitting — by id or by identity', async () => {
    const recent = makeSong('recent', { title: 'Heard It', artist: 'Artist R' });
    pool = [...telugu(10), cand(makeSong('queued', { artist: 'Q' })), cand(makeSong('recent-remix', { title: 'Heard It (Remix)', artist: 'Artist R' })), cand(makeSong('skipped', { artist: 'S' }))];
    const out = await recommendNextSongs(seed, ctx({ history: [makePlay(recent, NOW - 600_000)], sessionIntent: { skipStreak: 0, completionStreak: 0, artistPull: {}, languagePull: {}, skippedSongIds: new Set(['skipped']), energySteer: 0, discoveryAppetite: 0, size: 3 } }), { limit: 8, excludeIds: ['queued'] });
    const idsOut = out.map((s) => s.id);
    expect(idsOut).not.toContain('queued');
    expect(idsOut).not.toContain('recent-remix');
    expect(idsOut).not.toContain('skipped');
  });

  it('spaces artists: no lead artist back to back, and no artist owns the queue', async () => {
    pool = telugu(16, (i) => (i < 8 ? 'Anirudh' : `Other ${i}`));
    const out = await recommendNextSongs(seed, ctx(), { limit: 8 });
    for (let i = 1; i < out.length; i += 1) expect(lead(out[i])).not.toBe(lead(out[i - 1]));
    expect(out.filter((s) => lead(s) === 'Anirudh').length).toBeLessThanOrEqual(2);
  });

  it('is deterministic for a fixed context', async () => {
    pool = telugu(14);
    const a = await recommendNextSongs(seed, ctx(), { limit: 8 });
    // 8.2.0 — the engine remembers the opening it served after this seed, and
    // 9.1.0 — it records the stretch the player accepted in the shared exposure
    // ledger. A fixed context includes both memories.
    resetRecMemory();
    resetExposure();
    const b = await recommendNextSongs(seed, ctx(), { limit: 8 });
    expect(a.map((s) => s.id)).toEqual(b.map((s) => s.id));
  });

  it('gives Discover more never-played artists than Familiar from the same pool', async () => {
    const knownArtists = ['Known A', 'Known B', 'Known C', 'Known D', 'Known E', 'Known F'];
    const history = knownArtists.map((a, i) => makePlay(makeSong(`h${i}`, { artist: a }), NOW - (30 + i) * 86_400_000));
    pool = [...knownArtists.map((a, i) => cand(makeSong(`k${i}`, { artist: a }))), ...Array.from({ length: 6 }, (_, i) => cand(makeSong(`n${i}`, { artist: `New ${i}` })))];
    const strangers = (songs: Song[]) => songs.filter((s) => lead(s).startsWith('New')).length;
    const familiar = await recommendNextSongs(seed, ctx({ history, discoveryMode: 'familiar' }), { limit: 6 });
    const discover = await recommendNextSongs(seed, ctx({ history, discoveryMode: 'discover' }), { limit: 6 });
    expect(strangers(discover)).toBeGreaterThan(strangers(familiar));
    expect(strangers(familiar)).toBeLessThanOrEqual(1);
  });

  it('publishes a developer breakdown: selected songs with components, rejected songs with reasons, stage counts', async () => {
    localStorage.setItem('vinax.debug.recs', '1');
    pool = [...telugu(9), cand(makeSong('pa1', { artist: 'Diljit', language: 'punjabi' })), cand(makeSong('junk', { title: 'Movie Dialogue', artist: 'X' }))];
    const out = await recommendNextSongs(seed, ctx({ mutedLanguages: ['punjabi'] }), { limit: 6 });
    await vi.waitFor(() => expect(useRecsDebugStore.getState().batches.length).toBeGreaterThan(0));
    const batch = useRecsDebugStore.getState().batches[0];
    expect(batch.rows.map((r) => r.song.id)).toEqual(out.map((s) => s.id));
    expect(batch.rows[0].components.length).toBeGreaterThan(0);
    expect(batch.rows[0].picker).toBe('local');
    expect(batch.rejected.map((r) => `${r.song.id}:${r.reason}`)).toEqual(expect.arrayContaining(['pa1:muted-language', 'junk:junk']));
    expect(batch.trace?.stages).toMatchObject({ candidates: 11, admitted: 9, validated: 6 });
    expect(batch.trace?.mode).toBe('balanced');
    expect(batch.passedOver.length).toBe(3);
  });
});

describe('recommendNextSongs — 8.1.0 queue languages', () => {
  const mixedPool = (): Candidate[] => [
    ...telugu(12),
    cand(makeSong('hi1', { artist: 'Arijit Singh', language: 'hindi', playCount: 90_000_000 })),
    cand(makeSong('hi2', { artist: 'Shreya Ghoshal', language: 'hindi', playCount: 80_000_000 })),
    cand(makeSong('hi3', { artist: 'Sonu Nigam', language: 'hindi', playCount: 70_000_000 })),
    cand(makeSong('ta1', { artist: 'Anirudh', language: 'tamil', playCount: 95_000_000 })),
  ];

  it("'mix' lets the listener's other languages in, keeps the seed language leading and never switches twice in a row", async () => {
    pool = mixedPool();
    const out = await recommendNextSongs(seed, ctx({ queueLanguages: 'mix' }), { limit: 8 });
    expect(out).toHaveLength(8);
    const langs = out.map((s) => s.language);
    expect(langs).toContain('hindi');
    // Tamil is neither pinned nor played by this listener: it stays out even under 'mix'.
    expect(langs).not.toContain('tamil');
    expect(langs[0]).toBe('telugu');
    expect(langs.filter((l) => l === 'telugu').length).toBeGreaterThanOrEqual(4);
    for (let i = 1; i < langs.length - 1; i += 1) if (langs[i] !== 'telugu') expect(langs[i + 1]).toBe('telugu');
  });

  it("'mix' never starves the queue: with the seed language used up, the rules give way rather than ship a short stretch", async () => {
    pool = [...telugu(3), ...['a', 'b', 'c', 'd', 'e'].map((k) => cand(makeSong(`hi-${k}`, { artist: `Singer ${k}`, language: 'hindi', playCount: 50_000_000 })))];
    const out = await recommendNextSongs(seed, ctx({ queueLanguages: 'mix' }), { limit: 8 });
    expect(out).toHaveLength(8);
    expect(out.slice(0, 2).every((s) => s.language === 'telugu')).toBe(true);
  });

  it("'one' (and a context that says nothing) keeps the 7.1 rule: the seed language only", async () => {
    pool = mixedPool();
    for (const over of [{ queueLanguages: 'one' as const }, {}]) {
      const out = await recommendNextSongs(seed, ctx(over), { limit: 6 });
      expect(out.every((s) => s.language === 'telugu')).toBe(true);
    }
  });

  it("'mix' with only one language changes nothing", async () => {
    pool = mixedPool();
    const out = await recommendNextSongs(seed, ctx({ queueLanguages: 'mix', pinnedLanguages: ['telugu'], profile: { ...warmProfile(NOW), languages: {} } }), { limit: 6 });
    expect(out.every((s) => s.language === 'telugu')).toBe(true);
  });
});
