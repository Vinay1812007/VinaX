import { describe, it, expect } from 'vitest';
import { createShelfDeduper, dedupeShelves } from './dedupeShelves';
import type { Song } from '../../types';

const s = (id: string): Song => ({
  kind: 'song',
  id,
  title: id,
  subtitle: '',
  artists: [],
  album: null,
  images: [],
  audio: [],
  duration: 0,
  language: null,
  year: null,
  explicit: false,
  hasLyrics: false,
  playCount: null,
});

describe('createShelfDeduper', () => {
  it('drops songs already seen in an earlier call', () => {
    const d = createShelfDeduper();
    expect(d([s('a'), s('b')]).map((x) => x.id)).toEqual(['a', 'b']);
    expect(d([s('b'), s('c')]).map((x) => x.id)).toEqual(['c']);
  });

  it('removes intra-shelf duplicates too', () => {
    const d = createShelfDeduper();
    expect(d([s('a'), s('a'), s('b')]).map((x) => x.id)).toEqual(['a', 'b']);
  });
});

describe('dedupeShelves', () => {
  it('keeps the first occurrence across shelves, in order', () => {
    const out = dedupeShelves([
      [s('a'), s('b')],
      [s('b'), s('c')],
      [s('a'), s('d')],
    ]);
    expect(out.map((sh) => sh.map((x) => x.id))).toEqual([['a', 'b'], ['c'], ['d']]);
  });
});

it('keeps visible shelves stable when React renders the page again', () => {
  const songs = [s('a'), s('b')];
  expect(createShelfDeduper()(songs)).toEqual(songs);
  expect(createShelfDeduper()(songs)).toEqual(songs);
});

describe('v7.0.0 — identity-aware Home de-duplication', () => {
  const v = (id: string, title: string, artist: string): Song => ({ ...s(id), title, subtitle: artist, artists: [{ id: `a-${artist}`, name: artist }] });

  it('shows one cut of a song across all shelves, whatever its catalogue id', () => {
    const shelves = dedupeShelves([
      [v('1', 'Monica', 'Anirudh'), v('2', 'Hukum', 'Anirudh')],
      [v('3', 'Monica (From "Coolie")', 'Anirudh'), v('4', 'Kaavaalaa', 'Shilpa Rao')],
      [v('5', 'Monica - Lofi Flip', 'Anirudh'), v('6', 'Hukum (Live)', 'Anirudh'), v('7', 'Monica', 'Someone Else')],
    ]);
    expect(shelves.map((shelf) => shelf.map((x) => x.id))).toEqual([['1', '2'], ['4'], ['7']]);
  });

  it('the per-render deduper applies the same rule', () => {
    const d = createShelfDeduper();
    expect(d([v('1', 'Monica', 'Anirudh')]).map((x) => x.id)).toEqual(['1']);
    expect(d([v('9', 'Monica (2025 Remix)', 'Anirudh'), v('8', 'Other', 'Anirudh')]).map((x) => x.id)).toEqual(['8']);
  });
});
