// @vitest-environment jsdom
/**
 * Podcast resume and played state. Pins: an episode's place is kept in its
 * own list (newest last, capped), it is "played" past 95% (or the last
 * seconds of a short one) and a played episode's resume place is cleared so
 * it starts from the top; replaying past the opening makes it in progress
 * again; Continue your shows lists started, unfinished episodes newest
 * first; the player's 80-place song map never drops an episode's place.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import type { Song } from '@/types';
import { EPISODE_PROGRESS_KEY, resumeEvictee } from './episode';
import {
  continueListening,
  MAX_EPISODES,
  noteEpisodeProgress,
  playedAt,
  progressFraction,
  readEpisodeProgress,
  timeLeft,
} from './progress';

const RESUME = 'vinax.resume.v1';
const ep = (id: string): Song => ({
  kind: 'song', id, title: `Episode ${id}`, subtitle: 'Host', artists: [{ id: 'h', name: 'Host' }], album: { id: '62', name: 'Talking Music' },
  images: [], audio: [{ quality: 'original', url: `https://x/${id}.mp3` }], duration: 1800, language: 'hindi', year: null, explicit: false, hasLyrics: false, playCount: null,
});

beforeEach(() => localStorage.clear());

describe('episode progress', () => {
  it('keeps the place, and marks played past 95%', () => {
    noteEpisodeProgress(ep('a'), 600.7, 1800, 1000);
    expect(readEpisodeProgress().a).toMatchObject({ sec: 600, dur: 1800, at: 1000, played: false });
    noteEpisodeProgress(ep('a'), 1700, 1800, 2000);
    expect(readEpisodeProgress().a.played).toBe(false);
    noteEpisodeProgress(ep('a'), 1715, 1800, 3000);
    expect(readEpisodeProgress().a.played).toBe(true);
  });

  it('counts a short episode played in its last seconds', () => {
    expect(playedAt(39)).toBe(33);
    expect(playedAt(3600)).toBe(3420);
    noteEpisodeProgress(ep('t'), 35, 39);
    expect(readEpisodeProgress().t.played).toBe(true);
  });

  it('clears a played episode from the resume map, so it starts from the top', () => {
    localStorage.setItem(RESUME, JSON.stringify({ a: 1750, song: 90 }));
    noteEpisodeProgress(ep('a'), 1750, 1800);
    expect(JSON.parse(localStorage.getItem(RESUME)!)).toEqual({ song: 90 });
    // An unfinished one keeps its place there.
    localStorage.setItem(RESUME, JSON.stringify({ b: 300 }));
    noteEpisodeProgress(ep('b'), 300, 1800);
    expect(JSON.parse(localStorage.getItem(RESUME)!)).toEqual({ b: 300 });
  });

  it('stays played through the opening of a replay, then is in progress again', () => {
    noteEpisodeProgress(ep('a'), 1790, 1800, 1);
    noteEpisodeProgress(ep('a'), 0, 1800, 2);
    noteEpisodeProgress(ep('a'), 15, 1800, 3);
    expect(readEpisodeProgress().a.played).toBe(true);
    noteEpisodeProgress(ep('a'), 25, 1800, 4);
    expect(readEpisodeProgress().a).toMatchObject({ played: false, sec: 25 });
  });

  it('remembers the latest episodes only', () => {
    for (let i = 0; i < MAX_EPISODES + 5; i += 1) noteEpisodeProgress(ep(`e${i}`), 100, 1800, i);
    const ids = Object.keys(readEpisodeProgress());
    expect(ids).toHaveLength(MAX_EPISODES);
    expect(ids).not.toContain('e0');
    expect(ids).toContain(`e${MAX_EPISODES + 4}`);
  });

  it('ignores nonsense and survives a broken store', () => {
    noteEpisodeProgress(ep('a'), NaN, 1800);
    noteEpisodeProgress(ep('a'), 100, 0);
    expect(readEpisodeProgress()).toEqual({});
    localStorage.setItem(EPISODE_PROGRESS_KEY, '{not json');
    expect(readEpisodeProgress()).toEqual({});
    localStorage.setItem(EPISODE_PROGRESS_KEY, JSON.stringify({ x: { sec: 1 }, a: { song: ep('a'), sec: 100, dur: 1800, at: 1 } }));
    expect(Object.keys(readEpisodeProgress())).toEqual(['a']);
  });
});

describe('Continue your shows', () => {
  it('lists started, unfinished episodes, the latest first', () => {
    noteEpisodeProgress(ep('old'), 300, 1800, 1);
    noteEpisodeProgress(ep('new'), 900, 1800, 3);
    noteEpisodeProgress(ep('barely'), 10, 1800, 4);
    noteEpisodeProgress(ep('done'), 1790, 1800, 5);
    expect(continueListening(readEpisodeProgress()).map((e) => e.song.id)).toEqual(['new', 'old']);
  });

  it('says how far in and how long is left', () => {
    expect(progressFraction({ sec: 900, dur: 1800, played: false })).toBe(0.5);
    expect(progressFraction({ sec: 10, dur: 1800, played: true })).toBe(1);
    expect(timeLeft({ sec: 1080, dur: 1800 })).toBe('12 min left');
    expect(timeLeft({ sec: 1760, dur: 1800 })).toBe('40 sec left');
    expect(timeLeft({ sec: 0, dur: 3900 })).toBe('1 hr 5 min left');
    expect(timeLeft({ sec: 0, dur: 3600 })).toBe('1 hr left');
  });
});

describe('the song resume map', () => {
  it('pushes out the oldest place that is not an episode', () => {
    noteEpisodeProgress(ep('ep1'), 300, 1800);
    const raw = localStorage.getItem(EPISODE_PROGRESS_KEY) ?? '';
    expect(resumeEvictee(['ep1', 's1', 's2'], raw)).toBe('s1');
    expect(resumeEvictee(['s1', 'ep1'], raw)).toBe('s1');
    // An id that only appears inside an episode (its show, its host) is not protected.
    expect(resumeEvictee(['62', 's1'], raw)).toBe('62');
    expect(resumeEvictee(['s1'], '')).toBe('s1');
  });
});
