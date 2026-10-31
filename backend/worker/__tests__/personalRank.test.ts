/**
 * Ranking: the exposure penalty and cooling windows (the device's numbers),
 * the score terms and their reasons, and the re-rank's rules.
 */
import { describe, expect, it } from 'vitest';
import { PERSONAL_WEIGHT_DEFAULTS } from '../functions/_lib/personal/config';
import { exposureOf, reasonLine, rerank, scoreOne, scorePool, simToFit } from '../functions/_lib/personal/scoring';
import { emptyTaste, foldEvents } from '../functions/_lib/personal/taste';
import type { Candidate, CandidateSource, ExposureRow, SongRow, Taste } from '../functions/_lib/personal/types';

const NOW = Date.UTC(2026, 9, 31, 12);
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const iso = (ms: number) => new Date(ms).toISOString();

const row = (id: string, over: Partial<SongRow> = {}): SongRow => ({
  id, title: `Song ${id}`, artist: 'Sid Sriram', artist_id: 'ar1', artists: [{ id: 'ar1', name: 'Sid Sriram' }], album: 'Album', album_id: 'al1',
  language: 'telugu', year: 2026, duration: 240, image: null, key: `song ${id}|sid sriram`, facets: {}, embed_model: 'm', embedded_at: iso(NOW),
  plays: 100, completes: 50, skips: 5, likes: 10, first_seen: iso(NOW - 100 * DAY), last_seen: iso(NOW), ...over,
});
const cand = (id: string, sources: CandidateSource[], over: Partial<Candidate> = {}): Candidate => ({ id, sources: new Set(sources), ...over });
const exposure = (over: Partial<ExposureRow> = {}): ExposureRow => ({
  song_id: 'x', shown: 0, queued: 0, played: 0, completed: 0, skipped: 0, liked: false, disliked: false,
  last_shown: null, last_queued: null, last_played: null, last_completed: null, last_skipped: null, ...over,
});

const tasteWith = (): Taste => foldEvents(emptyTaste(NOW - DAY), [
  { id: 'e1', kind: 'like', songId: 'liked', at: NOW - HOUR, context: { hour: 21 } },
  { id: 'e2', kind: 'complete', songId: 'liked', at: NOW - HOUR, context: { hour: 21 } },
  { id: 'e3', kind: 'skip', songId: 'skipped', at: NOW - HOUR },
], new Map([
  ['liked', row('liked')],
  ['skipped', row('skipped', { artist: 'Other', artist_id: 'ar9', artists: [{ id: 'ar9', name: 'Other' }] })],
]), NOW);

const ctx = (taste: Taste, exp: Map<string, ExposureRow> = new Map(), over: Partial<Parameters<typeof scoreOne>[2]> = {}) => ({
  taste, exposure: exp, weights: PERSONAL_WEIGHT_DEFAULTS, now: NOW, hour: 21, intent: 'taste' as const, maxColisten: 10, ...over,
});

describe('exposureOf', () => {
  it('is nothing for a song never met', () => {
    expect(exposureOf(undefined, NOW)).toEqual({ penalty: 0, cooling: false, recentlyPlayed: false, disliked: false });
  });
  it('fades linearly to the horizon and cools for the window', () => {
    const fresh = exposureOf(exposure({ played: 1, last_played: iso(NOW - HOUR) }), NOW);
    expect(fresh.penalty).toBeCloseTo(0.3 * (1 - HOUR / (10 * DAY)), 3);
    expect(fresh.cooling).toBe(true);
    expect(fresh.recentlyPlayed).toBe(true);
    const old = exposureOf(exposure({ played: 1, last_played: iso(NOW - 4 * DAY) }), NOW);
    expect(old.cooling).toBe(false);
    expect(old.recentlyPlayed).toBe(false);
    expect(old.penalty).toBeCloseTo(0.3 * 0.6, 3);
    expect(exposureOf(exposure({ played: 1, last_played: iso(NOW - 11 * DAY) }), NOW).penalty).toBe(0);
  });
  it('counts skips up to three times and forgives a liked song three quarters', () => {
    const three = exposureOf(exposure({ skipped: 3, last_skipped: iso(NOW) }), NOW);
    const five = exposureOf(exposure({ skipped: 5, last_skipped: iso(NOW) }), NOW);
    expect(three.penalty).toBeCloseTo(0.9, 5);
    expect(five.penalty).toBeCloseTo(0.9, 5);
    const liked = exposureOf(exposure({ skipped: 3, last_skipped: iso(NOW), liked: true }), NOW);
    expect(liked.penalty).toBeCloseTo(0.225, 5);
  });
  it('a dislike cools for 45 days', () => {
    const d = exposureOf(exposure({ disliked: true, last_played: iso(NOW - 40 * DAY) }), NOW);
    expect(d.disliked).toBe(true);
    expect(d.cooling).toBe(true);
  });
});

describe('scoreOne', () => {
  it('keeps every term as a reason that adds up to the score', () => {
    const s = scoreOne(row('s1'), cand('s1', ['neighbours', 'similar'], { similarity: 0.8, colisten: 5 }), ctx(tasteWith()));
    expect(s.reasons.reduce((n, r) => n + r.weight, 0)).toBeCloseTo(s.score, 10);
    const kinds = s.reasons.map((r) => r.kind);
    expect(kinds).toEqual(expect.arrayContaining(['taste-fit', 'artist', 'language', 'co-listen', 'source', 'agreement', 'hour', 'fresh', 'community']));
    expect(s.reasons.find((r) => r.kind === 'taste-fit')!.weight).toBeCloseTo(PERSONAL_WEIGHT_DEFAULTS.tasteFit * simToFit(0.8), 10);
    expect(s.cooling).toBe(false);
  });

  it('a known artist and language score higher than strangers', () => {
    const t = tasteWith();
    const known = scoreOne(row('s1'), cand('s1', ['similar']), ctx(t));
    const stranger = scoreOne(row('s2', { artist: 'New', artist_id: 'ar5', artists: [{ id: 'ar5', name: 'New' }], language: 'english' }), cand('s2', ['similar']), ctx(t));
    expect(known.score).toBeGreaterThan(stranger.score);
    expect(reasonLine(known)).toBe('Because you listen to Sid Sriram');
  });

  it('exposure, a recent play and skips pull a song down', () => {
    const t = tasteWith();
    const clean = scoreOne(row('s1'), cand('s1', ['similar']), ctx(t));
    const played = scoreOne(row('s1'), cand('s1', ['similar']), ctx(t, new Map([['s1', exposure({ played: 1, last_played: iso(NOW - HOUR) })]])));
    expect(played.score).toBeLessThan(clean.score - 0.5);
    expect(played.cooling).toBe(true);
    const skippedArtist = scoreOne(row('s3', { artist: 'Other', artist_id: 'ar9', artists: [{ id: 'ar9', name: 'Other' }] }), cand('s3', ['similar']), ctx(t));
    expect(skippedArtist.reasons.find((r) => r.kind === 'skips')!.weight).toBeLessThan(0);
  });

  it('Familiar leans to known artists and Discover away from them', () => {
    const t = tasteWith();
    const fam = { ...t, mode: 'familiar' as const };
    const dis = { ...t, mode: 'discover' as const };
    const known = row('s1');
    const stranger = row('s2', { artist: 'New', artist_id: 'ar5', artists: [{ id: 'ar5', name: 'New' }] });
    expect(scoreOne(known, cand('s1', ['similar']), ctx(fam)).reasons.find((r) => r.kind === 'novelty')!.weight).toBeGreaterThan(0);
    expect(scoreOne(stranger, cand('s2', ['similar']), ctx(fam)).reasons.find((r) => r.kind === 'novelty')!.weight).toBeLessThan(0);
    expect(scoreOne(stranger, cand('s2', ['similar']), ctx(dis)).reasons.find((r) => r.kind === 'novelty')!.weight).toBeGreaterThan(0);
  });

  it('a seeded ranking favours the catalogue similar list; a taste ranking the vector neighbours', () => {
    const t = tasteWith();
    const seed = ctx(t, new Map(), { intent: 'seed' });
    const sim = scoreOne(row('a'), cand('a', ['similar'], { rank: 0 }), seed).reasons.find((r) => r.kind === 'source')!.weight;
    const nb = scoreOne(row('b'), cand('b', ['neighbours']), seed).reasons.find((r) => r.kind === 'source')!.weight;
    expect(sim).toBeGreaterThan(nb);
  });
});

describe('scorePool and rerank', () => {
  it('drops disliked songs and anything at or below zero, then sorts', () => {
    const t = tasteWith();
    const pool = new Map([['s1', cand('s1', ['similar'])], ['bad', cand('bad', ['similar'])], ['gone', cand('gone', ['similar'])]]);
    const songs = new Map([['s1', row('s1')], ['bad', row('bad')]]);
    const scored = scorePool(pool, songs, { taste: t, exposure: new Map([['bad', exposure({ disliked: true })]]), weights: PERSONAL_WEIGHT_DEFAULTS, now: NOW, hour: null, intent: 'taste' });
    expect(scored.map((s) => s.song.id)).toEqual(['s1']);
  });

  it('never repeats an artist back to back, caps an artist at three, folds identity families and puts cooling songs last', () => {
    const t = tasteWith();
    const mk = (id: string, artist: string, extra: Partial<SongRow> = {}) => row(id, { artist, artist_id: artist, artists: [{ id: artist, name: artist }], key: `${id}|${artist}`, ...extra });
    const rows = [mk('a1', 'A'), mk('a2', 'A'), mk('a3', 'A'), mk('a4', 'A'), mk('b1', 'B'), mk('b2', 'B'), mk('c1', 'C'), mk('dup', 'A', { key: 'a1|A' })];
    const pool = new Map(rows.map((r) => [r.id, cand(r.id, ['similar'], { rank: Number(r.id.slice(1)) || 0 })]));
    const exp = new Map([['c1', exposure({ shown: 1, last_shown: iso(NOW - HOUR) })]]);
    const scored = scorePool(pool, new Map(rows.map((r) => [r.id, r])), { taste: t, exposure: exp, weights: PERSONAL_WEIGHT_DEFAULTS, now: NOW, hour: null, intent: 'taste' });
    const out = rerank(scored, { limit: 10 });
    const ids = out.map((s) => s.song.id);
    expect(ids.filter((id) => id.startsWith('a') || id === 'dup')).toHaveLength(3);
    for (let i = 1; i < out.length - 1; i += 1) expect(out[i].song.artist_id === out[i - 1].song.artist_id && out[i].song.artist_id === 'A').toBe(false);
    expect(ids.includes('dup') && ids.includes('a1')).toBe(false);
    expect(ids[ids.length - 1]).toBe('c1');
    expect(rerank(scored, { limit: 10, dropCooling: true }).map((s) => s.song.id)).not.toContain('c1');
    expect(rerank(scored, { limit: 10, claimed: new Set(['a1', 'b1|B']) }).map((s) => s.song.id)).toEqual(expect.not.arrayContaining(['a1', 'b1']));
  });
});
