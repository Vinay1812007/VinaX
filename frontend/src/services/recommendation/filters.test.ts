// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { hardFilter, rejectReasonFor } from './filters';
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
