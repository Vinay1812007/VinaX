// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { classifiedFields, hardFilter, rejectReasonFor } from './filters';
import { applyMetadata } from '@/services/ai/recommendations';
import type { Candidate } from './types';
import { makeSong } from '@/__fixtures__/songs';

const cand = (song: ReturnType<typeof makeSong>, source: Candidate['source'] = 'related'): Candidate => ({ song, source });

describe('hardFilter', () => {
  it('names the reason for every rejection and lets a clean song through', () => {
    const seed = makeSong('seed', { title: 'Seed Song', artist: 'A' });
    const rules = {
      seed,
      queuedIds: new Set(['queued']),
      queuedKeys: new Set<string>(),
      recentIds: new Set(['recent']),
      sessionSkippedIds: new Set(['skipped']),
      mutedLanguages: ['punjabi'],
      blocked: (s: { id: string }) => s.id === 'blocked',
      hideExplicit: true,
    };
    const reasons = (id: string, over = {}) => rejectReasonFor(makeSong(id, over), rules);
    expect(reasons('clean')).toBeNull();
    expect(reasons('seed', { title: 'Seed Song', artist: 'A' })).toBe('seed');
    expect(reasons('seed-remix', { title: 'Seed Song (Remix)', artist: 'A' })).toBe('seed');
    expect(reasons('queued')).toBe('already-queued');
    expect(reasons('recent')).toBe('recently-played');
    expect(reasons('skipped')).toBe('skipped-this-session');
    expect(reasons('muted', { language: 'punjabi' })).toBe('muted-language');
    expect(reasons('blocked')).toBe('blocked');
    expect(reasons('explicit', { explicit: true })).toBe('explicit');
    expect(reasons('junk', { title: 'Movie Dialogue 3' })).toBe('junk');
    expect(reasons('short', { duration: 42 })).toBe('too-short');
    expect(reasons('', {})).toBe('invalid');
  });

  it('catches another version of a recently played or already queued song by identity', () => {
    const rules = { recentKeys: new Set(['monica|anirudh']), queuedKeys: new Set(['hukum|anirudh']) };
    expect(rejectReasonFor(makeSong('x', { title: 'Monica (Lofi Flip)', artist: 'Anirudh' }), rules)).toBe('recently-played');
    expect(rejectReasonFor(makeSong('y', { title: 'Hukum - From "Jailer"', artist: 'Anirudh' }), rules)).toBe('already-queued');
  });

  it('collapses versions onto the original and reports the others as duplicates', () => {
    const remix = makeSong('remix', { title: 'Monica (Remix)', artist: 'Anirudh' });
    const original = makeSong('orig', { title: 'Monica', artist: 'Anirudh' });
    const { admitted, rejected } = hardFilter([cand(remix), cand(original), cand(original, 'trending')]);
    expect(admitted.map((c) => c.song.id)).toEqual(['orig']);
    expect(rejected).toEqual([{ song: remix, reason: 'duplicate-version', stage: 'filter' }]);
  });
});

describe('7.2 — provenance and soft mutes in the hard filter', () => {
  const NOW = 1_800_000_000_000;

  it('keeps every source of a song that arrives more than once, with intent as the primary', () => {
    const song = makeSong('x', { artist: 'Anirudh' });
    const { admitted, rejected } = hardFilter([
      { song, source: 'trending', seedTitle: 'telugu' },
      { song, source: 'intent', seedTitle: 'telugu devotional songs' },
      { song, source: 'related', seedTitle: 'Seed' },
      cand(makeSong('y', { artist: 'Other' }), 'trending'),
    ]);
    expect(admitted.map((c) => c.song.id)).toEqual(['x', 'y']);
    expect(admitted[0].source).toBe('intent');
    expect(admitted[0].sources).toEqual(['intent', 'related', 'trending']);
    expect(admitted[0].seedTitles).toEqual(['telugu', 'telugu devotional songs', 'Seed']);
    expect(admitted[0].seedTitle).toBe('telugu devotional songs');
    expect(rejected).toEqual([]);
  });

  it('rejects an artist under an active "show fewer like this" with a named reason, by id or by name', () => {
    const softMuted = { 'artist-anirudh': { until: NOW + 60_000 }, 'sid sriram': { until: NOW + 60_000 }, 'artist-old': { until: NOW - 1 } };
    const rules = { softMuted, now: NOW };
    expect(rejectReasonFor(makeSong('a', { artist: 'Anirudh' }), rules)).toBe('soft-muted');
    expect(rejectReasonFor(makeSong('b', { artist: 'Sid Sriram', artists: [{ id: '', name: 'Sid Sriram' }] }), rules)).toBe('soft-muted');
    expect(rejectReasonFor(makeSong('c', { artist: 'Old' }), rules)).toBeNull(); // expired
    expect(rejectReasonFor(makeSong('d', { artist: 'Shreya Ghoshal' }), rules)).toBeNull();
    const { admitted, rejected } = hardFilter([cand(makeSong('a', { artist: 'Anirudh' })), cand(makeSong('d', { artist: 'Shreya Ghoshal' }))], rules);
    expect(admitted.map((c) => c.song.id)).toEqual(['d']);
    expect(rejected.map((r) => `${r.song.id}:${r.reason}`)).toEqual(['a:soft-muted']);
  });

  it('names the features the classifier added, and none the catalogue already had', () => {
    const before = makeSong('s', { mood: 'romantic', genres: [] });
    const after = applyMetadata([before], [{ id: 's', mood: 'chill', energy: 0.4, tempo: 96, genre: ['film'], vibe: [] }])[0];
    expect(classifiedFields(before, after)).toEqual(['energy', 'tempo', 'genre']);
    expect(classifiedFields(before, before)).toEqual([]);
  });
});

describe('8.1.0 — the mix policy allow-list', () => {
  it('rejects a known language outside the allow-list as off-language and passes unknown ones', async () => {
    const { rejectReasonFor } = await import('./filters');
    const { makeSong } = await import('@/__fixtures__/songs');
    const allowedLanguages = new Set(['telugu', 'hindi']);
    expect(rejectReasonFor(makeSong('a', { language: 'tamil' }), { allowedLanguages })).toBe('off-language');
    expect(rejectReasonFor(makeSong('b', { language: 'hindi' }), { allowedLanguages })).toBeNull();
    expect(rejectReasonFor(makeSong('c', { language: 'unknown' }), { allowedLanguages })).toBeNull();
    expect(rejectReasonFor(makeSong('d', { language: 'tamil' }), {})).toBeNull();
  });
});

