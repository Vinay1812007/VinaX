// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Song } from '@/types';
import type { Candidate } from './types';
import { makeContext, makePlay, makeSong, warmProfile } from '@/__fixtures__/songs';

/**
 * v7.0.0 — the next-song pipeline, end to end, on fixed fixtures: what goes
 * in is a candidate pool; what comes out must obey every rule whether the
 * local sequencer or the AI DJ chose the order — and the queue must still
 * be built when the AI is off, down, slow or talking nonsense.
 */
let pool: Candidate[] = [];
const djSequence = vi.fn();
vi.mock('./candidates', () => ({ gatherCandidates: vi.fn(async () => pool), generateNextCandidates: vi.fn(async () => pool) }));
vi.mock('@/services/ai/recommendations', () => ({ enrichSongs: vi.fn(async (songs: Song[]) => songs), aiRerankSongs: vi.fn(async (songs: Song[]) => songs) }));
vi.mock('@/services/ai/dj', () => ({ djSequence: (...args: unknown[]) => djSequence(...args), samplePool: (songs: Song[]) => songs }));
vi.mock('@/services/queryClient', () => ({ queryClient: { getQueryData: () => undefined } }));

import { recommendNextSongs } from './engine';
import { useSettingsStore } from '@/store/settingsStore';
import { useLibraryStore } from '@/store/libraryStore';
import { useRecsDebugStore } from '@/store/recsDebugStore';
import { resetTransitionMemory } from './transitions';

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
  djSequence.mockReset();
  useSettingsStore.setState({ aiDj: false, kidMode: false, mutedLanguages: [] });
  useLibraryStore.setState({ hiddenSongIds: [], hiddenArtists: [] });
  useRecsDebugStore.getState().clear();
});

describe('recommendNextSongs — rules hold with the AI off', () => {
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

describe('recommendNextSongs — the AI DJ is optional and never trusted', () => {
  beforeEach(() => useSettingsStore.setState({ aiDj: true }));

  it('ships the local order when the DJ is unavailable, slow or fails', async () => {
    pool = telugu(12);
    useSettingsStore.setState({ aiDj: false });
    const local = await recommendNextSongs(seed, ctx(), { limit: 8 });
    useSettingsStore.setState({ aiDj: true });
    djSequence.mockResolvedValueOnce(null); // timed out / 503 / unconfigured all surface as null
    expect((await recommendNextSongs(seed, ctx(), { limit: 8 })).map((s) => s.id)).toEqual(local.map((s) => s.id));
    djSequence.mockResolvedValueOnce({ intro: '', picks: [] }); // an answer with nothing usable in it
    expect((await recommendNextSongs(seed, ctx(), { limit: 8 })).map((s) => s.id)).toEqual(local.map((s) => s.id));
  });

  it('runs whatever the DJ returns through validation: muted, off-language, duplicate and already-queued picks never play', async () => {
    const te = telugu(12);
    pool = te;
    const pick = (song: Song, discovered = false) => ({ song, reason: 'r', segue: '', confidence: 0.9, discovered });
    djSequence.mockResolvedValueOnce({
      intro: 'hi',
      picks: [
        pick(makeSong('dj-muted', { artist: 'M', language: 'punjabi' }), true),
        pick(makeSong('dj-hindi', { artist: 'H', language: 'hindi' }), true),
        pick(makeSong('dj-queued', { artist: 'Q' }), true),
        pick(te[0].song),
        pick(makeSong('te0-remix', { title: `${te[0].song.title} (Remix)`, artist: lead(te[0].song) }), true),
        pick(te[1].song),
        pick(te[2].song),
      ],
    });
    const out = await recommendNextSongs(seed, ctx({ mutedLanguages: ['punjabi'] }), { limit: 8, excludeIds: ['dj-queued'] });
    const idsOut = out.map((s) => s.id);
    for (const bad of ['dj-muted', 'dj-hindi', 'dj-queued', 'te0-remix']) expect(idsOut).not.toContain(bad);
    // The DJ's usable picks lead, in its order — proof its answer was accepted, then cleaned.
    expect(idsOut.slice(0, 3)).toEqual(['te0', 'te1', 'te2']);
    expect(out.every((s) => s.language === 'telugu')).toBe(true);
    expect(out).toHaveLength(8);
  });

  it('gives the DJ a gate that applies the same rules to its catalogue discoveries', async () => {
    pool = telugu(12);
    djSequence.mockResolvedValueOnce(null);
    await recommendNextSongs(seed, ctx({ mutedLanguages: ['punjabi'] }), { limit: 8, excludeIds: ['already'] });
    const hints = djSequence.mock.calls[0][5] as { gate: { language: string | null; admit: (s: Song) => boolean } };
    expect(hints.gate.language).toBe('telugu');
    expect(hints.gate.admit(makeSong('fresh', { artist: 'F' }))).toBe(true);
    expect(hints.gate.admit(makeSong('already', { artist: 'F' }))).toBe(false);
    expect(hints.gate.admit(makeSong('m', { artist: 'F', language: 'punjabi' }))).toBe(false);
    expect(hints.gate.admit(makeSong('j', { title: 'Film Jukebox', artist: 'F' }))).toBe(false);
    expect(hints.gate.admit(seed)).toBe(false);
  });
});
