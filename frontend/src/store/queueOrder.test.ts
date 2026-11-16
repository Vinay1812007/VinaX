import { describe, expect, it } from 'vitest';
import type { Song } from '@/types';
import { inferContext, isQueueContext, queueInsertAt, shuffledStart, shuffleUpcoming, unshuffleUpcoming, type QueueRun } from './queueOrder';

const song = (id: string): Song => ({
  kind: 'song', id, title: id, subtitle: '', artists: [], album: null,
  images: [], audio: [], duration: 200, language: 'telugu', year: '2024',
  explicit: false, hasLyrics: false, playCount: null,
});
const q = (...ids: string[]) => ids.map(song);
const ids = (songs: Song[]) => songs.map((s) => s.id);
/** m* = added by hand, a* = Autoplay, anything else = the list. */
const runOf = (id: string): QueueRun => (id.startsWith('m') ? 'manual' : id.startsWith('a') ? 'auto' : 'list');
/** Deterministic "random": Fisher–Yates always swaps with the first slot. */
const first = () => 0;

describe('queueInsertAt — Add to queue', () => {
  it('goes right after the current song, ahead of the rest of the list', () => {
    expect(queueInsertAt(q('x1', 'x2', 'x3'), 0, (id) => runOf(id) === 'manual')).toBe(1);
  });
  it('goes after songs already added, so adds play in the order they were made', () => {
    expect(queueInsertAt(q('x1', 'm1', 'm2', 'x2', 'a1'), 0, (id) => runOf(id) === 'manual')).toBe(3);
  });
  it('appends at the end of an empty or finished queue', () => {
    expect(queueInsertAt([], 0, () => false)).toBe(0);
    expect(queueInsertAt(q('x1'), 0, () => false)).toBe(1);
  });
});

describe('shuffle', () => {
  it('shuffles only the list: adds stay on top, Autoplay stays last, history untouched', () => {
    const out = shuffleUpcoming(q('p1', 'now', 'm1', 'x1', 'x2', 'x3', 'a1'), 1, runOf, first);
    expect(ids(out)).toEqual(['p1', 'now', 'm1', 'x2', 'x3', 'x1', 'a1']);
  });
  it('switching off restores the original order, carrying on from the song playing', () => {
    const order = ['x1', 'x2', 'x3', 'x4', 'x5'];
    // x3 is playing; x5, x1 and x4 are still to come in shuffled order.
    const out = unshuffleUpcoming(q('x2', 'x3', 'm1', 'x5', 'x1', 'x4', 'a1'), 1, order, runOf);
    expect(ids(out)).toEqual(['x2', 'x3', 'm1', 'x4', 'x5', 'x1', 'a1']);
  });
  it('switching off while an added song plays reads from the last list song heard', () => {
    const out = unshuffleUpcoming(q('x3', 'm1', 'x1', 'x4'), 1, ['x1', 'x2', 'x3', 'x4'], runOf);
    expect(ids(out)).toEqual(['x3', 'm1', 'x4', 'x1']);
  });
  it('a list started on shuffle begins with the chosen song and keeps every song once', () => {
    const list = q('x1', 'x2', 'x3', 'x4');
    const out = shuffledStart(list, list[2], Math.random);
    expect(out[0].id).toBe('x3');
    expect(ids(out).sort()).toEqual(['x1', 'x2', 'x3', 'x4']);
  });
});

describe('inferContext — Playing from', () => {
  it('names albums, playlists and artists from the page title', () => {
    expect(inferContext('/album/123', 'Pushpa 2 · VinaX')).toEqual({ kind: 'album', label: 'Pushpa 2', path: '/album/123' });
    expect(inferContext('/playlist/9', 'Telugu Hits · VinaX')).toMatchObject({ kind: 'playlist', label: 'Telugu Hits' });
    expect(inferContext('/collection/c1', 'Road trip · VinaX')).toMatchObject({ kind: 'playlist', label: 'Road trip' });
    expect(inferContext('/artist/7', 'Sid Sriram · VinaX')).toMatchObject({ kind: 'artist', label: 'Sid Sriram' });
  });
  it('knows the fixed places by their route', () => {
    expect(inferContext('/', 'VinaX')).toMatchObject({ kind: 'home', label: 'Home' });
    expect(inferContext('/favorites', 'VinaX')).toMatchObject({ kind: 'liked', label: 'Liked songs' });
    expect(inferContext('/search/sid%20sriram', 'VinaX')).toMatchObject({ kind: 'search', label: 'Search: sid sriram' });
  });
  it('gives nothing for the player pages and untitled pages', () => {
    expect(inferContext('/now-playing', 'Now playing · VinaX')).toBeNull();
    expect(inferContext('/queue', 'Queue · VinaX')).toBeNull();
    expect(inferContext('/album/1', 'VinaX')).toBeNull();
  });
  it('validates a stored context', () => {
    expect(isQueueContext({ kind: 'album', label: 'X', path: '/album/1' })).toBe(true);
    expect(isQueueContext({ kind: 'album', label: '' })).toBe(false);
    expect(isQueueContext({ kind: 'nope', label: 'X' })).toBe(false);
    expect(isQueueContext({ kind: 'page', label: 'X', path: 'https://evil' })).toBe(false);
  });
});
