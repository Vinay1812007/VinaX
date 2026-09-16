/**
 * Song matching — Indic titles must stay distinguishable, an empty
 * normalised title must never match, and unrelated results must never be
 * accepted just because they came first.
 */
import { describe, expect, it } from 'vitest';
import type { Song } from '@/types';
import { betterMatch, matchPick, normalizeTitle, scoreCandidates } from './songMatch';

const song = (id: string, title: string, artist: string, album = ''): Song => ({
  kind: 'song',
  id,
  title,
  subtitle: artist,
  artists: artist ? artist.split(',').map((n) => ({ id: `a-${n.trim()}`, name: n.trim() })) : [],
  album: album ? { id: `al-${album}`, name: album } : null,
  images: [],
  audio: [],
  duration: 200,
  language: 'telugu',
  year: '2022',
  explicit: false,
  hasLyrics: false,
  playCount: null,
});

describe('normalizeTitle', () => {
  it('keeps Telugu and Hindi letters and vowel signs', () => {
    expect(normalizeTitle('నీలి నీలి ఆకాశం')).toBe('నీలి నీలి ఆకాశం');
    expect(normalizeTitle('कल हो ना हो')).toBe('कल हो ना हो');
    // Two distinct Telugu titles stay distinct after normalisation.
    expect(normalizeTitle('నీలి నీలి ఆకాశం')).not.toBe(normalizeTitle('నీవే నీవే'));
  });
  it('strips Latin diacritics, punctuation and "(From …)" tags', () => {
    expect(normalizeTitle('Kesariya (From "Brahmastra")')).toBe('kesariya');
    expect(normalizeTitle('Séñorita!')).toBe('senorita');
    expect(normalizeTitle('***')).toBe('');
  });
});

describe('matchPick', () => {
  const srivalli = song('1', 'Srivalli', 'Sid Sriram', 'Pushpa');
  const srivalliHindi = song('2', 'Srivalli (Hindi)', 'Javed Ali', 'Pushpa (Hindi)');
  const unrelated = song('3', 'Naatu Naatu', 'Rahul Sipligunj, Kaala Bhairava', 'RRR');

  it('accepts an exact title + artist as matched', () => {
    const m = matchPick({ title: 'Srivalli', artist: 'Sid Sriram' }, [unrelated, srivalliHindi, srivalli]);
    expect(m.status).toBe('matched');
    expect(m.song?.id).toBe('1');
    expect(m.alternatives[0].id).toBe('1');
  });

  it('never accepts an unrelated first result', () => {
    const m = matchPick({ title: 'Samajavaragamana', artist: 'Sid Sriram' }, [unrelated, srivalli]);
    expect(m.status).toBe('missing');
    expect(m.song).toBeNull();
  });

  it('rejects picks whose normalised title is empty', () => {
    expect(matchPick({ title: '—', artist: 'Anyone' }, [unrelated]).status).toBe('missing');
    expect(scoreCandidates({ title: '()', artist: '' }, [unrelated])).toEqual([]);
  });

  it('same title, contradicting artist → uncertain, not matched', () => {
    const m = matchPick({ title: 'Srivalli', artist: 'Javed Ali' }, [srivalli]);
    expect(m.status).toBe('uncertain');
    expect(m.song?.id).toBe('1');
  });

  it('prefers the artist-confirmed version among same-titled songs', () => {
    const m = matchPick({ title: 'Srivalli', artist: 'Javed Ali' }, [srivalli, srivalliHindi]);
    expect(m.status).toBe('matched');
    expect(m.song?.id).toBe('2');
  });

  it('a bare title (no artist) still matches an exact title', () => {
    const m = matchPick({ title: 'Naatu Naatu', artist: '' }, [srivalli, unrelated]);
    expect(m.status).toBe('matched');
    expect(m.song?.id).toBe('3');
  });

  it('keeps distinct Indic titles apart', () => {
    const a = song('t1', 'నీలి నీలి ఆకాశం', 'Anurag Kulkarni');
    const b = song('t2', 'నీవే నీవే', 'Sid Sriram');
    const m = matchPick({ title: 'నీవే నీవే', artist: 'Sid Sriram' }, [a, b]);
    expect(m.status).toBe('matched');
    expect(m.song?.id).toBe('t2');
    const miss = matchPick({ title: 'ఎవరో ఎవరో', artist: 'Sid Sriram' }, [a]);
    expect(miss.status).toBe('missing');
  });

  it('a Hindi title with an extra word is uncertain, not silently accepted', () => {
    const m = matchPick({ title: 'कल हो ना हो', artist: 'Sonu Nigam' }, [song('h1', 'कल हो ना हो (Sad)', 'Sonu Nigam')]);
    expect(['matched', 'uncertain']).toContain(m.status);
    expect(m.song?.id).toBe('h1');
    const other = matchPick({ title: 'कल हो ना हो', artist: 'Sonu Nigam' }, [song('h2', 'तुम ही हो', 'Arijit Singh')]);
    expect(other.status).toBe('missing');
  });

  it('betterMatch keeps the stronger attempt and pools alternatives', () => {
    const weak = matchPick({ title: 'Srivalli', artist: 'Sid Sriram' }, [unrelated]);
    const strong = matchPick({ title: 'Srivalli', artist: 'Sid Sriram' }, [srivalli]);
    expect(betterMatch(weak, strong).song?.id).toBe('1');
    expect(betterMatch(strong, weak).song?.id).toBe('1');
  });
});
