import { describe, expect, it } from 'vitest';
import type { Song } from '@/types';
import {
  addToQueue,
  alignRuns,
  clearQueued,
  dropAutoplay,
  dropFromAutoplay,
  inferContext,
  isQueueContext,
  jumpTo,
  moveEntry,
  normalize,
  removeEntry,
  repeatList,
  shuffleOff,
  shuffleOn,
  spreadArtists,
  startList,
  trimPlayed,
  type QueueRun,
  type QueueSnapshot,
} from './queueRules';

const song = (id: string, artist = id): Song => ({
  kind: 'song', id, title: id, subtitle: artist, artists: [{ id: artist, name: artist }], album: null,
  images: [], audio: [], duration: 200, language: 'telugu', year: '2024', explicit: false, hasLyrics: false, playCount: null,
} as unknown as Song);

/** "a | q:x c:y" → a snapshot: entries before `|` are played/current (the last one plays). */
function snap(spec: string): QueueSnapshot {
  const [head, tail = ''] = spec.split('|').map((x) => x.trim());
  const parse = (part: string) => part.split(/\s+/).filter(Boolean).map((t) => {
    const [r, id] = t.includes(':') ? t.split(':') : ['c', t];
    const run: QueueRun = r === 'q' ? 'queued' : r === 'a' ? 'autoplay' : 'context';
    return { song: song(id), run };
  });
  const h = parse(head);
  const t = parse(tail);
  return { queue: [...h, ...t].map((e) => e.song), runs: [...h, ...t].map((e) => e.run), index: h.length - 1 };
}
const show = (s: QueueSnapshot): string => {
  const tag = (i: number) => `${s.runs[i] === 'queued' ? 'q:' : s.runs[i] === 'autoplay' ? 'a:' : ''}${s.queue[i].id}`;
  return `${s.queue.slice(0, s.index + 1).map((_, i) => tag(i)).join(' ')} | ${s.queue.slice(s.index + 1).map((_, i) => tag(s.index + 1 + i)).join(' ')}`.trim();
};
const seq = (rand: number[]) => {
  let i = 0;
  return () => rand[i++ % rand.length];
};

describe('queueRules', () => {
  it('normalize keeps Next in queue, then the list, then Autoplay, each in its own order', () => {
    expect(show(normalize(snap('x | a:s1 b q:m c q:n')))).toBe('x | q:m q:n b c a:s1');
  });

  it('alignRuns fills a missing or broken run with the list', () => {
    expect(alignRuns([1, 2, 3], ['queued', 'nope'])).toEqual(['queued', 'context', 'context']);
    expect(alignRuns([1], null)).toEqual(['context']);
  });

  it('startList plays in order from the chosen song, keeping Next in queue when asked', () => {
    const list = ['a', 'b', 'c', 'd'].map((id) => song(id));
    const old = snap('x | q:m y');
    expect(show(startList(old, list, 2, { keepQueued: true }))).toBe('a b c | q:m d');
    expect(show(startList(old, list, 2))).toBe('a b c | d');
    const shuffled = startList(old, list, 1, { shuffle: true, keepQueued: true, rand: seq([0]) });
    expect(shuffled.index).toBe(0);
    expect(shuffled.queue[0].id).toBe('b');
    expect(shuffled.runs[1]).toBe('queued');
    expect(shuffled.queue.slice(2).map((s) => s.id).sort()).toEqual(['a', 'c', 'd']);
  });

  it('addToQueue goes after the current song and earlier adds, before the list', () => {
    expect(show(addToQueue(snap('x | q:m b a:s'), [song('n')]))).toBe('x | q:m q:n b a:s');
    expect(show(addToQueue(snap('x |'), [song('n'), song('o')]))).toBe('x | q:n q:o');
  });

  it('jumpTo skips list songs above (Back reaches them), keeps adds above a list row, drops adds above an add', () => {
    expect(show(jumpTo(snap('x | q:m b c d'), 3))).toBe('x b c | q:m d');
    expect(show(jumpTo(snap('x | q:m q:n b'), 2))).toBe('x q:n | b');
    expect(show(jumpTo(snap('a b c | d'), 0))).toBe('a | b c d');
  });

  it('removeEntry keeps the index on the same song, or on the one that takes the playing song’s place', () => {
    expect(show(removeEntry(snap('a b | c'), 0))).toBe('b | c');
    const s = removeEntry(snap('a b | c'), 1);
    expect(s.index).toBe(1);
    expect(s.queue[s.index].id).toBe('c');
  });

  it('moveEntry: a row joins the run of the row it lands on', () => {
    expect(show(moveEntry(snap('x | q:m b c'), 3, 1))).toBe('x | q:c q:m b');
    expect(show(moveEntry(snap('x | q:m b c'), 1, 3))).toBe('x | b c m');
    // The playing song and the played ones never move.
    expect(moveEntry(snap('x | b c'), 0, 2)).toEqual(snap('x | b c'));
  });

  it('clearQueued and dropAutoplay take out only their run', () => {
    expect(show(clearQueued(snap('x | q:m b a:s')))).toBe('x | b a:s');
    expect(show(dropAutoplay(snap('x | q:m b a:s')))).toBe('x | q:m b');
    expect(show(dropFromAutoplay(snap('x | b a:s a:t'), new Set(['s'])))).toBe('x | b a:t');
  });

  it('shuffleOn reorders only the list; shuffleOff puts it back from the last list song played', () => {
    const on = shuffleOn(snap('a | q:m b c d a:s'), seq([0]));
    expect(on.runs.slice(1)).toEqual(['queued', 'context', 'context', 'context', 'autoplay']);
    expect(on.queue.slice(2, 5).map((s) => s.id).sort()).toEqual(['b', 'c', 'd']);
    expect(show(shuffleOff(snap('a c | q:m d b a:s'), ['a', 'b', 'c', 'd']))).toBe('a c | q:m d b a:s');
  });

  it('repeatList appends the list again, dropping Autoplay', () => {
    const list = ['a', 'b'].map((id) => song(id));
    expect(show(repeatList(snap('a b | a:s'), list))).toBe('a b | a b');
    const shuffled = repeatList(snap('a b |'), list, { shuffle: true, rand: seq([0.99]) });
    expect(shuffled.queue[2].id).not.toBe('b');
  });

  it('trimPlayed keeps only the last played entries', () => {
    expect(show(trimPlayed(snap('a b c d | e'), 1))).toBe('c d | e');
  });

  it('spreadArtists keeps one artist’s songs apart when it can', () => {
    const s = [song('1', 'x'), song('2', 'x'), song('3', 'y')];
    expect(spreadArtists(s, (v) => v.subtitle).map((v) => v.id)).toEqual(['1', '3', '2']);
  });

  it('inferContext reads what the listener played from the page', () => {
    expect(inferContext('/album/1', 'Pushpa 2 · VinaX')).toEqual({ kind: 'album', label: 'Pushpa 2', path: '/album/1' });
    expect(inferContext('/queue', 'Queue · VinaX')).toBeNull();
    expect(isQueueContext({ kind: 'album', label: 'x' })).toBe(true);
    expect(isQueueContext({ kind: 'nope', label: 'x' })).toBe(false);
  });
});
