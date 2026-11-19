import { describe, expect, it } from 'vitest';
import type { Song } from '@/types';
import { LIKED_COOLDOWN_MS, PLAYED_COOLDOWN_MS, SERVED_COOLDOWN_MS, jitter, medianYear, moodFit, pickSequence, rejectReason, scoreCandidate, type Candidate, type FilterContext, type ScoreContext, type Source } from './rules';

const song = (id: string, artist: string, extra: Partial<Song> = {}): Song => ({
  kind: 'song', id, title: `T ${id}`, subtitle: artist, artists: [{ id: `a-${artist}`, name: artist }], album: null,
  images: [], audio: [{ quality: '320kbps', url: `https://x/${id}.mp4` }], duration: 200, language: 'telugu', year: '2022', explicit: false, hasLyrics: false, playCount: null, ...extra,
});
const key = (s: Song): string => `${s.title}|${s.artists[0]?.name ?? ''}`.toLowerCase();
const HOUR = 3_600_000;
const NOW = 1_800_000_000_000;

const filter = (o: Partial<FilterContext> = {}): FilterContext => ({
  languages: new Set(['telugu']), mutedLanguages: new Set(), queuedIds: new Set(), queuedKeys: new Set(), keyOf: key,
  playedAt: new Map(), servedAt: new Map(), likedIds: new Set(), skippedIds: new Set(), avoidLeads: new Set(),
  blocked: () => false, softMuted: () => false, hideExplicit: false, now: NOW,
  playedCooldownMs: PLAYED_COOLDOWN_MS, likedCooldownMs: LIKED_COOLDOWN_MS, servedCooldownMs: SERVED_COOLDOWN_MS, ...o,
});

const scoring = (o: Partial<ScoreContext> = {}): ScoreContext => ({
  languages: ['telugu'], mood: null, year: null, likedLeads: new Map(), likedIds: new Set(), pull: {}, tasteLeads: new Set(),
  moodOf: () => 'neutral', exposure: () => 0, salt: 1, ...o,
});
const cand = (s: Song, ...sources: Source[]): Candidate => ({ song: s, sources: new Set(sources), at: 0 });

describe('1.12 — listening moments', () => {
  it('lifts the artists and languages the listener plays at this time of day, by confidence', () => {
    const mine = song('m', 'Evening Singer', { language: 'telugu' });
    const lang = song('l', 'Someone', { language: 'telugu' });
    const other = song('o', 'Other', { language: 'hindi' });
    const base = scoring({ languages: ['telugu', 'hindi'], salt: 0 });
    const moment = scoring({ languages: ['telugu', 'hindi'], salt: 0, moment: { languages: new Set(['telugu']), artists: new Set(['evening singer']), confidence: 0.5 } });
    const lift = (s: Song) => scoreCandidate(cand(s, 'anchor'), moment) - scoreCandidate(cand(s, 'anchor'), base);
    expect(lift(mine)).toBeCloseTo(0.3 * 0.5, 5);
    expect(lift(lang)).toBeCloseTo(0.3 * 0.5 * 0.4, 5);
    expect(lift(other)).toBe(0);
  });
});

describe('V2 Up Next rules — what may be picked', () => {
  it('no song comes back within 72 hours of playing; a liked one may after 48', () => {
    const s = song('x', 'A');
    expect(rejectReason(s, filter({ playedAt: new Map([[key(s), NOW - 10 * HOUR]]) }))).toBe('played-recently');
    expect(rejectReason(s, filter({ playedAt: new Map([[key(s), NOW - 73 * HOUR]]) }))).toBeNull();
    const liked = filter({ likedIds: new Set(['x']) });
    expect(rejectReason(s, { ...liked, playedAt: new Map([[key(s), NOW - 10 * HOUR]]) })).toBe('played-recently');
    expect(rejectReason(s, { ...liked, playedAt: new Map([[key(s), NOW - 30 * HOUR]]) })).toBe('played-recently');
    expect(rejectReason(s, { ...liked, playedAt: new Map([[key(s), NOW - 50 * HOUR]]) })).toBeNull();
  });

  it('a song queued automatically and never reached waits a day', () => {
    const s = song('x', 'A');
    expect(rejectReason(s, filter({ servedAt: new Map([[key(s), NOW - 2 * HOUR]]) }))).toBe('served-recently');
    expect(rejectReason(s, filter({ servedAt: new Map([[key(s), NOW - 25 * HOUR]]) }))).toBeNull();
  });

  it('holds the language, the skipped artist, the queue and the listener’s rules', () => {
    expect(rejectReason(song('t', 'A', { language: 'tamil' }), filter())).toBe('other-language');
    expect(rejectReason(song('u', 'A', { language: null }), filter())).toBeNull();
    expect(rejectReason(song('a', 'Skipped One'), filter({ avoidLeads: new Set(['skipped one']) }))).toBe('artist-skipped');
    expect(rejectReason(song('q', 'A'), filter({ queuedIds: new Set(['q']) }))).toBe('queued');
    expect(rejectReason(song('e', 'A', { explicit: true }), filter({ hideExplicit: true }))).toBe('explicit');
    expect(rejectReason(song('h', 'A', { language: 'hindi' }), filter({ languages: new Set(), mutedLanguages: new Set(['hindi']) }))).toBe('muted-language');
  });
});

describe('V2 Up Next rules — scoring', () => {
  it('a liked artist outranks a stranger, and agreement between sources counts', () => {
    const x = scoring({ likedLeads: new Map([['loved', 3]]), salt: 0 });
    const stranger = scoreCandidate(cand(song('s', 'Stranger'), 'anchor'), x);
    const loved = scoreCandidate(cand(song('l', 'Loved'), 'anchor'), x);
    expect(loved).toBeGreaterThan(stranger + 0.3);
    const agreed = scoreCandidate(cand(song('s', 'Stranger'), 'anchor', 'liked-similar'), x);
    expect(agreed).toBeGreaterThan(stranger + 0.25);
  });

  it('keeps devotional and film music apart, and the session’s mood', () => {
    expect(moodFit('devotional', 'romantic')).toBeLessThan(-0.5);
    expect(moodFit('romantic', 'devotional')).toBeLessThan(-0.5);
    expect(moodFit('devotional', 'devotional')).toBeGreaterThan(0);
    expect(moodFit('energetic', 'chill')).toBeLessThan(moodFit('romantic', 'chill'));
    expect(moodFit('chill', 'chill')).toBeGreaterThan(0);
    expect(moodFit('neutral', 'chill')).toBe(0);
  });

  it('a skip this sitting pushes, a like pulls; recent exposure costs', () => {
    const base = scoreCandidate(cand(song('a', 'A'), 'anchor'), scoring({ salt: 0 }));
    expect(scoreCandidate(cand(song('a', 'A'), 'anchor'), scoring({ salt: 0, pull: { a: 0.5 } }))).toBeGreaterThan(base);
    expect(scoreCandidate(cand(song('a', 'A'), 'anchor'), scoring({ salt: 0, exposure: () => 0.5 }))).toBeLessThan(base - 0.3);
  });

  it('jitter is stable per song and session', () => {
    expect(jitter('abc', 7)).toBe(jitter('abc', 7));
    expect(jitter('abc', 7)).not.toBe(jitter('abc', 8));
    expect(medianYear([song('a', 'A', { year: '2001' }), song('b', 'B', { year: '2020' }), song('c', 'C', { year: '2022' })])).toBe(2020);
  });
});

describe('V2 Up Next rules — ordering', () => {
  it('never brings an artist back within four songs, nor more than twice in ten', () => {
    const ranked = [
      song('a1', 'A'), song('a2', 'A'), song('a3', 'A'), song('a4', 'A'),
      song('b1', 'B'), song('c1', 'C'), song('d1', 'D'), song('e1', 'E'), song('f1', 'F'), song('g1', 'G'), song('h1', 'H'),
    ];
    const { songs, relaxed } = pickSequence(ranked, [], 9, key);
    const leads = songs.map((s) => s.artists[0].name);
    for (let i = 0; i < leads.length; i += 1) {
      for (let j = Math.max(0, i - 4); j < i; j += 1) expect(leads[j]).not.toBe(leads[i]);
    }
    expect(leads.filter((l) => l === 'A').length).toBeLessThanOrEqual(2);
    expect(relaxed).toEqual([]);
  });

  it('judges the spacing across what came before (history and the queue), not one batch', () => {
    const before = [song('p1', 'A'), song('p2', 'B')];
    const { songs } = pickSequence([song('a9', 'A'), song('b9', 'B'), song('c9', 'C')], before, 1, key);
    expect(songs.map((s) => s.id)).toEqual(['c9']);
  });

  it('never the same album twice in a row', () => {
    const album = { id: 'al', name: 'Album' };
    const before = [song('p', 'P', { album })];
    expect(pickSequence([song('x', 'X', { album }), song('y', 'Y')], before, 1, key).songs[0].id).toBe('y');
  });

  it('loosens step by step instead of stalling, and says so', () => {
    const { songs, relaxed } = pickSequence([song('a1', 'A'), song('a2', 'A'), song('a3', 'A')], [], 3, key);
    expect(songs).toHaveLength(3);
    expect(relaxed.length).toBeGreaterThan(0);
  });
});

describe('V2 Up Next rules — Never repeat', () => {
  it('a heard song is never picked, even with every cooldown loosened', () => {
    const s = song('x', 'A');
    const heard = (k: string): boolean => k === key(s);
    expect(rejectReason(s, filter({ heard }))).toBe('heard-before');
    expect(rejectReason(s, filter({ heard, playedCooldownMs: 0, likedCooldownMs: 0, servedCooldownMs: 0, languages: new Set() }))).toBe('heard-before');
    expect(rejectReason(song('y', 'A'), filter({ heard }))).toBeNull();
    expect(rejectReason(s, filter())).toBeNull();
  });
});

describe('1.19 — flow and the Discovery lean', () => {
  it('a stretch follows the energy of the song before it when scores are close', () => {
    const calm = song('calm', 'C', { title: 'Soft melody' });
    const loud = song('loud', 'L', { title: 'Dance party' });
    const scores = new Map([['loud', 1.0], ['calm', 0.98]]);
    const energy = (s: Song): number => (s.id === 'loud' ? 0.9 : 0.25);
    const before = [song('prev', 'P', { title: 'Slow' })];
    // Without flow the best score wins; with it, the calm song follows a calm one.
    expect(pickSequence([loud, calm], before, 1, key).songs[0].id).toBe('loud');
    expect(pickSequence([loud, calm], before, 1, key, { scoreOf: (s) => scores.get(s.id) ?? 0, energyOf: (s) => (s.id === 'prev' ? 0.2 : energy(s)) }).songs[0].id).toBe('calm');
    // A clearly better score still wins over a small energy step.
    scores.set('loud', 1.5);
    expect(pickSequence([loud, calm], before, 1, key, { scoreOf: (s) => scores.get(s.id) ?? 0, energyOf: (s) => (s.id === 'prev' ? 0.2 : energy(s)) }).songs[0].id).toBe('loud');
  });
  it('Discovery leans the score toward own music on familiar and new music on discover', () => {
    const base = scoring();
    const own: Candidate = { song: song('o', 'Own'), sources: new Set<Source>(['liked']), at: 0 };
    const fresh: Candidate = { song: song('f', 'New'), sources: new Set<Source>(['explore']), at: 0 };
    const gap = (lean: 'familiar' | 'balanced' | 'discover'): number => scoreCandidate(own, { ...base, discovery: lean }) - scoreCandidate(fresh, { ...base, discovery: lean });
    expect(gap('familiar')).toBeGreaterThan(gap('balanced'));
    expect(gap('discover')).toBeLessThan(gap('balanced'));
  });
  it('a release from this year or last gets a small lift', () => {
    const base = scoring();
    const old: Candidate = { song: song('old', 'A', { year: '2015' }), sources: new Set<Source>(['anchor']), at: 0 };
    const now: Candidate = { song: song('now', 'A', { year: String(new Date().getFullYear()) }), sources: new Set<Source>(['anchor']), at: 0 };
    expect(scoreCandidate(now, { ...base, year_now: new Date().getFullYear() })).toBeGreaterThan(scoreCandidate(old, { ...base, year_now: new Date().getFullYear() }));
  });
});
