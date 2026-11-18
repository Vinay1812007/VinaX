// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import type { Video } from '@/services/api/videos';
import {
  SEEN_CAP, appendReels, flowVideoPath, markSeen, notePageAsked, notePageCount, pageCount, pickPage, readSeen, reelKey, reelQueries, reelSources, searchableTitle, withLead,
  type PageBook,
} from './reels';

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
    expect(reelSources(video('1', 'A', { streamUrl: null }))).toEqual(['https://v/preview-1.mp4']);
    expect(reelSources(video('1', 'A', { streamUrl: 'https://v/preview-1.mp4' }))).toEqual(['https://v/preview-1.mp4']);
    expect(reelSources(video('1', 'A', { previewUrl: null, streamUrl: null }))).toEqual([]);
  });

  it('opens on the asked-for video, whatever its language, without a second copy of its song', () => {
    const lead = video('L', 'Kesariya (Lyric Video)', { language: 'Hindi' });
    expect(withLead([], lead)).toEqual([lead]);
    const feed = withLead([video('a', "Kesariya (From 'Brahmastra')"), video('b', 'Other')], lead);
    expect(feed.map((v) => v.id)).toEqual(['L', 'b']);
    const already = [video('x', 'X'), lead];
    expect(withLead(already, lead)).toBe(already);
    // The rounds after it skip its song and keep it first.
    const next = appendReels([lead], [video('c', 'Kesariya (Video)'), video('d', 'New')], { languages: ['telugu'], seen: new Set() });
    expect(next.reels.map((v) => v.id)).toEqual(['L', 'd']);
  });

  it('builds the Flow address for one video', () => {
    expect(flowVideoPath('21uSZLdz')).toBe('/flow?v=21uSZLdz');
    expect(flowVideoPath('a b&c')).toBe('/flow?v=a%20b%26c');
  });

  it('appends only playable reels labelled with the listener’s languages, holding back watched ones, never moving the current ones', () => {
    const current = [video('c', 'Current')];
    const incoming = [
      video('seen', 'Seen Song'),
      video('new', 'New Song'),
      video('dupe', 'New Song (Lyric Video)'),
      video('tamil', 'Tamil Song', { language: 'Tamil' }),
      video('unknown', 'All The Stars (Official Video)', { language: null }),
      video('dead', 'No Clip', { previewUrl: null, streamUrl: null }),
      video('c', 'Current'),
    ];
    const out = appendReels(current, incoming, { languages: ['telugu'], seen: new Set(['seen']) });
    expect(out.reels.map((v) => v.id)).toEqual(['c', 'new']);
    expect(out.held.map((v) => v.id)).toEqual(['seen']);
    const later = appendReels(out.reels, out.held, { languages: ['telugu'], seen: new Set(['seen']), includeSeen: true });
    expect(later.reels.map((v) => v.id)).toEqual(['c', 'new', 'seen']);
    expect(appendReels(later.reels, [], { languages: ['telugu'], seen: new Set() }).reels).toBe(later.reels);
  });

  it('reads a random unread page of each language’s video list, a language-bound mood search, then song titles', () => {
    const book: PageBook = new Map();
    const r0 = reelQueries({
      languages: ['telugu', 'hindi'], titles: ["Srivalli (From 'Pushpa')", 'Oo Antava', 'A', 'B', 'C'], round: 0,
      asked: new Set(['oo antava']), book, rand: () => 0.99,
    });
    expect(r0.map((q) => q.query)).toEqual(['telugu video songs', 'hindi video songs', 'telugu love', 'Srivalli', 'A', 'B']);
    // Before the API has said how many pages there are, a page from the first ten.
    expect(r0[0]).toEqual({ query: 'telugu video songs', page: 10 });
    // Never a bare mood word: "party" alone finds English, Tamil and German videos.
    expect(r0.every((q) => !/^(love|dance|party|mass|sad)$/.test(q.query))).toBe(true);

    for (const q of r0) notePageAsked(book, q);
    notePageCount(book, 'telugu video songs', 1282, 10);
    expect(book.get('telugu video songs')?.pages).toBe(128);
    const r1 = reelQueries({ languages: ['telugu', 'hindi'], titles: [], round: 1, asked: new Set(), book, rand: () => 0.5 });
    expect(r1[0].query).toBe('telugu video songs');
    expect(r1[0].page).toBeGreaterThan(10);
    expect(r1[2].query).toBe('hindi dance');
  });

  it('opens on different pages on different visits', () => {
    const first = (rand: () => number) =>
      reelQueries({ languages: ['telugu'], titles: [], round: 0, asked: new Set(), book: new Map(), rand })[0].page;
    expect(first(() => 0)).not.toBe(first(() => 0.7));
  });

  it('picks pages it has not read yet, and leaves out the list’s last partial page', () => {
    expect(pageCount(1282, 10)).toBe(128);
    expect(pageCount(3, 10)).toBe(1);
    const used = new Set([1, 2, 3, 4]);
    for (const r of [0, 0.3, 0.99]) expect(used.has(pickPage(5, used, () => r))).toBe(false);
    expect(pickPage(2, new Set([1, 2]), () => 0)).toBe(1);
  });

  it('cleans a title for the search', () => {
    expect(searchableTitle('Heeriye (feat. Arijit Singh)')).toBe('Heeriye');
    expect(searchableTitle("Naatu Naatu (From 'RRR')")).toBe('Naatu Naatu');
    expect(searchableTitle('Badass (From "Leo (Telugu)")')).toBe('Badass');
    expect(searchableTitle('Kesariya [Lyric Video] - Remix')).toBe('Kesariya');
  });

  it('remembers watched reels, newest last, up to the cap', () => {
    for (let i = 0; i < SEEN_CAP + 5; i += 1) markSeen(`v${i}`);
    const seen = readSeen();
    expect(seen.size).toBe(SEEN_CAP);
    expect(seen.has('v0')).toBe(false);
    expect(seen.has(`v${SEEN_CAP + 4}`)).toBe(true);
  });
});
