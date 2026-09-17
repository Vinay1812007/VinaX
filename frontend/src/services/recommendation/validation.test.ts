// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { validateSequence } from './validation';
import { makeSong } from '@/__fixtures__/songs';

const ids = (songs: Array<{ id: string }>) => songs.map((s) => s.id);

describe('validateSequence', () => {
  it('never lets a rule-breaking song through, whoever ordered the list', () => {
    const order = [
      makeSong('ok1', { artist: 'A' }),
      makeSong('muted', { artist: 'B', language: 'punjabi' }),
      makeSong('blocked', { artist: 'C' }),
      makeSong('queued', { artist: 'D' }),
      makeSong('ok2', { artist: 'E' }),
      makeSong('ok1-live', { title: 'Song ok1 (Live)', artist: 'A' }),
    ];
    const out = validateSequence(order, { limit: 8, mutedLanguages: ['punjabi'], blocked: (s) => s.id === 'blocked', queuedIds: new Set(['queued']) });
    expect(ids(out.songs)).toEqual(['ok1', 'ok2']);
    expect(out.rejected.map((r) => `${r.song.id}:${r.reason}`)).toEqual(['muted:muted-language', 'blocked:blocked', 'queued:already-queued', 'ok1-live:duplicate-version']);
  });

  it('holds the language lock, and only relaxes it toward languages the listener plays when the queue would starve', () => {
    const te = (id: string, artist: string) => makeSong(id, { artist, language: 'telugu' });
    const hi = (id: string, artist: string) => makeSong(id, { artist, language: 'hindi' });
    const pa = (id: string, artist: string) => makeSong(id, { artist, language: 'punjabi' });
    const plenty = validateSequence([te('t1', 'A'), hi('h1', 'B'), te('t2', 'C'), te('t3', 'D')], { limit: 8, lockLanguage: 'telugu', familiarLanguages: ['hindi'] });
    expect(ids(plenty.songs)).toEqual(['t1', 't2', 't3']);
    expect(plenty.relaxed).toEqual([]);
    const starved = validateSequence([te('t1', 'A'), hi('h1', 'B'), pa('p1', 'C'), hi('h2', 'D')], { limit: 8, lockLanguage: 'telugu', familiarLanguages: ['hindi'] });
    expect(ids(starved.songs)).toEqual(['t1', 'h1', 'h2']);
    expect(starved.relaxed).toEqual(['language-lock']);
    expect(starved.rejected.map((r) => r.song.id)).toEqual(['p1']);
  });

  it('never queues a lead artist twice in a row — the seed counts as the previous song', () => {
    const seed = makeSong('seed', { artist: 'Sid Sriram' });
    const order = [makeSong('1', { artist: 'Sid Sriram' }), makeSong('2', { artist: 'Anirudh' }), makeSong('3', { artist: 'Anirudh' }), makeSong('4', { artist: 'Shreya Ghoshal' })];
    const out = validateSequence(order, { limit: 8, seed });
    const leads = out.songs.map((s) => s.artists[0].name);
    expect(leads[0]).not.toBe('Sid Sriram');
    for (let i = 1; i < leads.length; i += 1) expect(leads[i]).not.toBe(leads[i - 1]);
    expect(out.repairs).toBeGreaterThan(0);
    expect(out.songs).toHaveLength(4);
  });

  it('caps one artist at a quarter of the queue, and relaxes the cap before shipping a short queue', () => {
    const many = Array.from({ length: 6 }, (_, i) => makeSong(`a${i}`, { artist: 'Anirudh' }));
    const others = Array.from({ length: 6 }, (_, i) => makeSong(`o${i}`, { artist: `Other ${i}` }));
    const capped = validateSequence([...many, ...others], { limit: 8 });
    expect(capped.songs.filter((s) => s.artists[0].name === 'Anirudh')).toHaveLength(2);
    expect(capped.relaxed).toEqual([]);
    const small = validateSequence([...many, others[0]], { limit: 5 });
    expect(small.songs).toHaveLength(5);
    expect(small.relaxed).toEqual(['artist-cap']);
  });
});
