// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeSong } from '@/__fixtures__/songs';
import { EXPOSURE_KEY, exposureLedger, recordExposure, resetExposure } from '@/services/recommendation/exposure';
import { songKey } from '@/services/recommendation/songIdentity';
import { appendFeed, createShownRecorder, hasAudio, interleave } from './feed';

const playable = (id: string, over: Parameters<typeof makeSong>[1] = {}) =>
  makeSong(id, { audio: [{ quality: '160kbps', url: `https://cdn.example/${id}.mp4` }], ...over });
const allowAll = () => true;

beforeEach(() => {
  localStorage.clear();
  resetExposure();
});

describe('Flow feed', () => {
  it('skips songs with no audio', () => {
    const silent = makeSong('x');
    expect(hasAudio(silent)).toBe(false);
    expect(hasAudio(makeSong('y', { audio: [{ quality: '160kbps', url: '' }] }))).toBe(false);
    expect(appendFeed([], [silent, playable('a')], { allowed: allowAll }).map((s) => s.id)).toEqual(['a']);
  });

  it('interleaves the sources round-robin', () => {
    const a = [playable('a1'), playable('a2'), playable('a3')];
    const b = [playable('b1')];
    expect(interleave([a, undefined, b]).map((s) => s.id)).toEqual(['a1', 'b1', 'a2', 'a3']);
  });

  it('is append-only: what is on screen never moves, repeats and other cuts of a song never join', () => {
    const first = appendFeed([], [playable('a'), playable('b')], { allowed: allowAll });
    const remaster = playable('a-remaster', { title: 'Song a' });
    const next = appendFeed(first, [playable('b'), remaster, playable('c')], { allowed: allowAll });
    expect(next.map((s) => s.id)).toEqual(['a', 'b', 'c']);
    expect(next.slice(0, 2)).toEqual(first);
    // Nothing new: the very same array comes back (no re-render).
    expect(appendFeed(next, [playable('c')], { allowed: allowAll })).toBe(next);
  });

  it('follows the safety rules', () => {
    const out = appendFeed([], [playable('ok'), playable('bad', { explicit: true })], { allowed: (s) => !s.explicit });
    expect(out.map((s) => s.id)).toEqual(['ok']);
  });

  it('leaves out songs heard, queued or skipped lately and sends songs only shown elsewhere after fresh ones', () => {
    const shownOnHome = playable('shown', { title: 'Shown on Home' });
    const played = playable('played', { title: 'Played yesterday' });
    const skipped = playable('skipped', { title: 'Skipped twice' });
    recordExposure([shownOnHome], 'shown');
    recordExposure([played], 'played');
    recordExposure([skipped], 'skipped');
    const out = appendFeed([], [shownOnHome, played, skipped, playable('fresh', { title: 'Brand new' })], { allowed: allowAll, ledger: exposureLedger() });
    expect(out.map((s) => s.id)).toEqual(['fresh', 'shown']);
  });
});

describe('Flow exposure', () => {
  it('records a settled card as shown in the shared ledger, once per visit', () => {
    const song = playable('s1', { title: 'Settled song' });
    const record = createShownRecorder();
    expect(record(song)).toBe(true);
    expect(record(song)).toBe(false);
    const rows = JSON.parse(localStorage.getItem(EXPOSURE_KEY) ?? '[]') as Array<{ k: string; s?: number }>;
    expect(rows).toHaveLength(1);
    expect(rows[0].k).toBe(songKey(song));
    expect(typeof rows[0].s).toBe('number');
    // Every other surface now sees it as met.
    expect(exposureLedger().shownKeys.has(songKey(song))).toBe(true);
  });

  it('records with the ledger kind "shown" only (never played or queued)', () => {
    const spy = vi.fn();
    const record = createShownRecorder(spy);
    const a = playable('a');
    record(a);
    record(playable('b'));
    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy).toHaveBeenNthCalledWith(1, [a], 'shown');
  });
});
