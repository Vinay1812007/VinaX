// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import type { Video } from '@/services/api/videos';
import { SEEN_CAP, appendReels, markSeen, readSeen, reelKey, reelQueries, reelSources, searchableTitle } from './reels';

const video = (id: string, title: string, over: Partial<Video> = {}): Video => ({
  id, title, subtitle: 'Singer', language: 'Telugu', year: '2024', duration: 200, thumbnail: null,
  streamUrl: `https://v/full-${id}.mp4`, previewUrl: `https://v/preview-${id}.mp4`, songIds: [`s-${id}`], artists: [], ...over,
});

beforeEach(() => localStorage.clear());

describe('Flow reels', () => {
  it('treats every cut of one song as one reel', () => {
    const a = reelKey(video('1', 'Kesariya (Lyric Video)'));
    expect(reelKey(video('2', "Kesariya (From 'Brahmastra')"))).toBe(a);
    expect(reelKey(video('3', 'Kesariya (Lyric Video (Version, 02))'))).toBe(a);
    expect(reelKey(video('4', 'Apna Bana Le - Bhediya (Video)'))).toBe('apna bana le');
  });

  it('plays the preview first (the full stream is 404 upstream today)', () => {
    expect(reelSources(video('1', 'A'))).toEqual(['https://v/preview-1.mp4', 'https://v/full-1.mp4']);
    expect(reelSources(video('1', 'A', { previewUrl: null }))).toEqual(['https://v/full-1.mp4']);
  });

  it('appends only playable reels in the listener’s languages, unseen ones first, never moving the current ones', () => {
    const current = [video('c', 'Current')];
    const incoming = [
      video('seen', 'Seen Song'),
      video('new', 'New Song'),
      video('dupe', 'New Song (Lyric Video)'),
      video('tamil', 'Tamil Song', { language: 'Tamil' }),
      video('unknown', 'Mystery Song', { language: null }),
      video('dead', 'No Clip', { previewUrl: null, streamUrl: null }),
      video('c', 'Current'),
    ];
    const out = appendReels(current, incoming, { languages: ['telugu'], seen: new Set(['seen']) });
    expect(out.map((v) => v.id)).toEqual(['c', 'new', 'unknown', 'seen']);
    expect(appendReels(out, [], { languages: ['telugu'], seen: new Set() })).toBe(out);
  });

  it('asks with song titles first, then a deeper page of the language searches each round', () => {
    const r0 = reelQueries({ languages: ['telugu'], titles: ["Srivalli (From 'Pushpa')", 'Oo Antava', 'A', 'B', 'C'], round: 0, asked: new Set(['oo antava']) });
    expect(r0.slice(0, 4).map((q) => q.query)).toEqual(['Srivalli', 'A', 'B', 'C']);
    expect(r0).toContainEqual({ query: 'telugu video songs', page: 1 });
    const r3 = reelQueries({ languages: ['telugu'], titles: [], round: 3, asked: new Set() });
    expect(r3).toContainEqual({ query: 'telugu video songs', page: 2 });
  });

  it('cleans a title for the search', () => {
    expect(searchableTitle('Heeriye (feat. Arijit Singh)')).toBe('Heeriye');
    expect(searchableTitle("Naatu Naatu (From 'RRR')")).toBe('Naatu Naatu');
  });

  it('remembers watched reels, newest last, up to the cap', () => {
    for (let i = 0; i < SEEN_CAP + 5; i += 1) markSeen(`v${i}`);
    const seen = readSeen();
    expect(seen.size).toBe(SEEN_CAP);
    expect(seen.has('v0')).toBe(false);
    expect(seen.has(`v${SEEN_CAP + 4}`)).toBe(true);
  });
});
