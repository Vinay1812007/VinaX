// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { validateSequence } from './validation';
import { makeSong } from '@/__fixtures__/songs';

const ids = (songs: Array<{ id: string }>) => songs.map((s) => s.id);

describe('validateSequence', () => {
  it('never lets a rule-breaking song through, whoever ordered the list', () => {
    const order = [
      makeSong('ok1', { artist: 'A' }),
      makeSong('muted', { artist: 'B', language: 'punjabi' }),
      makeSong('blocked', { artist: 'C' }),
      makeSong('queued', { artist: 'D' }),
      makeSong('ok2', { artist: 'E' }),
      makeSong('ok1-live', { title: 'Song ok1 (Live)', artist: 'A' }),
    ];
    const out = validateSequence(order, { limit: 8, mutedLanguages: ['punjabi'], blocked: (s) => s.id === 'blocked', queuedIds: new Set(['queued']) });
    expect(ids(out.songs)).toEqual(['ok1', 'ok2']);
    expect(out.rejected.map((r) => `${r.song.id}:${r.reason}`)).toEqual(['muted:muted-language', 'blocked:blocked', 'queued:already-queued', 'ok1-live:duplicate-version']);
  });

  it('holds the language lock, and only relaxes it toward languages the listener plays when the queue would starve', () => {
    const te = (id: string, artist: string) => makeSong(id, { artist, language: 'telugu' });
    const hi = (id: string, artist: string) => makeSong(id, { artist, language: 'hindi' });
    const pa = (id: string, artist: string) => makeSong(id, { artist, language: 'punjabi' });
    const plenty = validateSequence([te('t1', 'A'), hi('h1', 'B'), te('t2', 'C'), te('t3', 'D')], { limit: 8, lockLanguage: 'telugu', familiarLanguages: ['hindi'] });
    expect(ids(plenty.songs)).toEqual(['t1', 't2', 't3']);
    expect(plenty.relaxed).toEqual([]);
    const starved = validateSequence([te('t1', 'A'), hi('h1', 'B'), pa('p1', 'C'), hi('h2', 'D')], { limit: 8, lockLanguage: 'telugu', familiarLanguages: ['hindi'] });
    expect(ids(starved.songs)).toEqual(['t1', 'h1', 'h2']);
    expect(starved.relaxed).toEqual(['language-lock']);
    expect(starved.rejected.map((r) => r.song.id)).toEqual(['p1']);
  });

  it('never queues a lead artist twice in a row — the seed counts as the previous song', () => {
    const seed = makeSong('seed', { artist: 'Sid Sriram' });
    const order = [makeSong('1', { artist: 'Sid Sriram' }), makeSong('2', { artist: 'Anirudh' }), makeSong('3', { artist: 'Anirudh' }), makeSong('4', { artist: 'Shreya Ghoshal' })];
    const out = validateSequence(order, { limit: 8, seed });
    const leads = out.songs.map((s) => s.artists[0].name);
    expect(leads[0]).not.toBe('Sid Sriram');
    for (let i = 1; i < leads.length; i += 1) expect(leads[i]).not.toBe(leads[i - 1]);
    expect(out.repairs).toBeGreaterThan(0);
    expect(out.songs).toHaveLength(4);
  });

  it('caps one artist at a quarter of the queue, and relaxes the cap before shipping a short queue', () => {
    const many = Array.from({ length: 6 }, (_, i) => makeSong(`a${i}`, { artist: 'Anirudh' }));
    const others = Array.from({ length: 6 }, (_, i) => makeSong(`o${i}`, { artist: `Other ${i}` }));
    const capped = validateSequence([...many, ...others], { limit: 8 });
    expect(capped.songs.filter((s) => s.artists[0].name === 'Anirudh')).toHaveLength(2);
    expect(capped.relaxed).toEqual([]);
    const small = validateSequence([...many, others[0]], { limit: 5 });
    expect(small.songs).toHaveLength(5);
    expect(small.relaxed).toEqual(['artist-cap']);
  });
});

describe('7.2 — validation enforces the sequencer’s final policy', () => {
  const d = (n: number) => makeSong(`d${n}`, { artist: `Stranger ${n}` });
  const k = (n: number) => makeSong(`k${n}`, { artist: `Known ${n}` });
  const discoveryIds = new Set(['d1', 'd2', 'd3', 'd4']);

  it('an AI order that front-loads three discoveries ships with a familiar opening and within the discovery share', () => {
    const out = validateSequence([d(1), d(2), d(3), k(1), k(2), k(3), k(4)], { limit: 5, discoveryIds, discoveryShare: 0.2 });
    expect(ids(out.songs)).toEqual(['k1', 'k2', 'd1', 'k3', 'k4']);
    expect(out.songs.filter((s) => discoveryIds.has(s.id))).toHaveLength(1); // ⌊0.2 × 5 + 0.5⌋ = 1
    expect(out.relaxed).toEqual([]);
  });

  it('holds discovery out of slot 1 only when the stretch is shorter than four', () => {
    const out = validateSequence([d(1), k(1), k(2)], { limit: 3, discoveryIds, discoveryShare: 0.45 });
    expect(ids(out.songs)).toEqual(['k1', 'd1', 'k2']);
    expect(out.relaxed).toEqual([]);
  });

  it('a reserve top-up cannot push the stretch over the share', () => {
    // The sequenced arc (k1, k2) is short; the reserve behind it is mostly strangers.
    const out = validateSequence([k(1), k(2), d(1), d(2), d(3), k(3), k(4)], { limit: 5, discoveryIds, discoveryShare: 0.2 });
    expect(out.songs.filter((s) => discoveryIds.has(s.id))).toHaveLength(1);
    expect(ids(out.songs)).toEqual(['k1', 'k2', 'd1', 'k3', 'k4']);
  });

  it('relaxes the opening and the share only when the pool cannot fill the stretch otherwise — and says so', () => {
    const out = validateSequence([d(1), d(2), d(3), k(1)], { limit: 4, discoveryIds, discoveryShare: 0.2 });
    expect(ids(out.songs)).toEqual(['k1', 'd1', 'd2', 'd3']);
    expect(out.relaxed).toEqual(['familiar-opening', 'discovery-share']);
    // Traceable: one entry per slot that gave way, with the song and the reason.
    expect(out.relaxations.map((r) => `${r.rule}@${r.slot}:${r.songId}`)).toEqual(['familiar-opening@2:d1', 'discovery-share@3:d2', 'discovery-share@4:d3']);
    expect(out.relaxations.every((r) => r.detail.length > 0)).toBe(true);
  });

  it('the familiar opening can be switched off, and applies without a share', () => {
    expect(ids(validateSequence([d(1), k(1), k(2), k(3)], { limit: 4, discoveryIds }).songs)).toEqual(['k1', 'k2', 'd1', 'k3']);
    expect(ids(validateSequence([d(1), k(1), k(2), k(3)], { limit: 4, discoveryIds, familiarOpening: false }).songs)).toEqual(['d1', 'k1', 'k2', 'k3']);
  });

  it('never relaxes a hard rule, even when that leaves the stretch short', () => {
    const NOW = 1_800_000_000_000;
    const order = [
      makeSong('explicit', { artist: 'A', explicit: true }),
      makeSong('blocked', { artist: 'B' }),
      makeSong('muted', { artist: 'C', language: 'punjabi' }),
      makeSong('soft', { artist: 'Soft Muted' }),
      makeSong('recent', { artist: 'D' }),
      makeSong('skipped', { artist: 'E' }),
      makeSong('junk', { title: 'Film Jukebox', artist: 'F' }),
      makeSong('', { artist: 'G' }),
      makeSong('ok', { artist: 'H' }),
    ];
    const out = validateSequence(order, {
      limit: 5, hideExplicit: true, blocked: (s) => s.id === 'blocked', mutedLanguages: ['punjabi'], recentIds: new Set(['recent']),
      sessionSkippedIds: new Set(['skipped']), softMuted: { 'artist-soft-muted': { until: NOW + 1 } }, now: NOW,
    });
    expect(ids(out.songs)).toEqual(['ok']);
    expect(out.relaxed).toEqual([]);
    expect(out.rejected.map((r) => r.reason)).toEqual(['explicit', 'blocked', 'muted-language', 'soft-muted', 'recently-played', 'skipped-this-session', 'junk', 'invalid']);
  });

  it('reports which step of the language-lock relaxation was used', () => {
    const te = (id: string, artist: string) => makeSong(id, { artist, language: 'telugu' });
    const hi = (id: string, artist: string) => makeSong(id, { artist, language: 'hindi' });
    const pa = (id: string, artist: string) => makeSong(id, { artist, language: 'punjabi' });
    const held = validateSequence([te('t1', 'A'), te('t2', 'B'), te('t3', 'C'), hi('h1', 'D')], { limit: 8, lockLanguage: 'telugu', familiarLanguages: ['hindi'] });
    expect(held.languageLockStep).toBeNull();
    const familiar = validateSequence([te('t1', 'A'), hi('h1', 'B'), pa('p1', 'C'), hi('h2', 'D')], { limit: 8, lockLanguage: 'telugu', familiarLanguages: ['hindi'] });
    expect(familiar.languageLockStep).toBe('familiar');
    expect(familiar.relaxations).toContainEqual({ rule: 'language-lock', detail: expect.stringContaining('familiar') });
    const any = validateSequence([te('t1', 'A'), pa('p1', 'B'), pa('p2', 'C')], { limit: 8, lockLanguage: 'telugu', familiarLanguages: ['hindi'] });
    expect(any.languageLockStep).toBe('any');
    expect(ids(any.songs)).toEqual(['t1', 'p1', 'p2']);
  });
});

describe('7.2.0 — the stretch follows the last queued song, not the one playing', () => {
  it('keeps the same lead artist off both sides of the join', () => {
    const playing = makeSong('playing', { artist: 'Sid Sriram' });
    const lastQueued = makeSong('last', { artist: 'Anirudh' });
    const order = [makeSong('x', { artist: 'Anirudh' }), makeSong('y', { artist: 'Shreya' }), makeSong('z', { artist: 'Kaala' })];
    const withSeedOnly = validateSequence(order, { seed: playing, limit: 3 });
    expect(withSeedOnly.songs[0].id).toBe('x'); // nothing knows about the join
    const withPrevious = validateSequence(order, { seed: playing, limit: 3, previous: lastQueued });
    expect(withPrevious.songs[0].id).not.toBe('x');
    expect(withPrevious.songs.map((s) => s.id).sort()).toEqual(['x', 'y', 'z']);
    expect(withPrevious.repairs).toBe(1);
  });
});

describe('8.3.0 — the style quota', () => {
  const dj = (id: string, artist: string) => makeSong(id, { title: `Song ${id} (DJ Remix Song)`, artist });
  const film = (id: string, artist: string) => makeSong(id, { title: `Film ${id}`, artist });
  const style = { matches: (s: { title: string }) => /\bdj\b/i.test(s.title), min: 4, label: 'DJ remix' };

  it('keeps four of the next five in the style while the pool holds them, pulling style songs past off-style ones', () => {
    const order = [film('f1', 'A'), film('f2', 'B'), dj('d1', 'C'), film('f3', 'D'), dj('d2', 'E'), dj('d3', 'F'), dj('d4', 'G'), dj('d5', 'H')];
    const out = validateSequence(order, { limit: 5, style });
    expect(out.songs).toHaveLength(5);
    expect(out.songs.filter(style.matches).length).toBe(4);
    // Order is otherwise kept: the first off-style song takes the one open slot.
    expect(ids(out.songs)).toEqual(['f1', 'd1', 'd2', 'd3', 'd4']);
    expect(out.relaxed).toEqual([]);
  });

  it('gives way gracefully when the pool is short of the style, and never ships nothing', () => {
    const short = validateSequence([film('f1', 'A'), dj('d1', 'B'), film('f2', 'C'), film('f3', 'D'), film('f4', 'E')], { limit: 5, style });
    expect(short.songs).toHaveLength(5);
    expect(short.songs.filter(style.matches).length).toBe(1);
    expect(short.relaxed).toEqual(['style']);
    expect(short.relaxations[0].detail).toContain('1 DJ remix songs for 4 slots');
    const none = validateSequence([film('f1', 'A'), film('f2', 'B'), film('f3', 'C')], { limit: 5, style });
    expect(ids(none.songs)).toEqual(['f1', 'f2', 'f3']);
  });

  it('holds past the artist cap before it lets an off-style song in, but never past the rule against one artist twice in a row', () => {
    // Four remixes, three by one DJ, and two film songs: two per artist is the cap for a stretch of five.
    const order = [dj('a1', 'Eshwar'), dj('b1', 'Clement'), dj('a2', 'Eshwar'), dj('a3', 'Eshwar'), film('f1', 'X'), film('f2', 'Y')];
    const out = validateSequence(order, { limit: 5, style });
    expect(ids(out.songs)).toEqual(['a1', 'b1', 'a2', 'f1', 'a3']);
    for (let i = 1; i < out.songs.length; i += 1) expect(out.songs[i].artists[0].name).not.toBe(out.songs[i - 1].artists[0].name);
    expect(out.relaxed).toContain('artist-cap');
  });

  it('9.0: an artist this sitting pushed away comes last — after the discovery budget gives way, before back-to-back does', () => {
    const avoidLeads = new Set(['kiran']);
    // Kiran was skipped twice this sitting. Three of Kiran's songs rank first.
    const order = [makeSong('k1', { artist: 'Kiran' }), makeSong('k2', { artist: 'Kiran' }), makeSong('a1', { artist: 'Asha' }), makeSong('k3', { artist: 'Kiran' }), makeSong('b1', { artist: 'Bala' }), makeSong('c1', { artist: 'Chitra' })];
    const out = validateSequence(order, { limit: 4, avoidLeads, discoveryIds: new Set(['b1', 'c1']), discoveryShare: 0 });
    // The two discoveries are taken (the budget gives way) before any Kiran song.
    expect(ids(out.songs)).toEqual(['a1', 'b1', 'c1', 'k1']);
    expect(out.relaxed).toEqual(expect.arrayContaining(['discovery-share', 'sitting-avoid']));
    // With enough other songs, none of Kiran's ship at all.
    const plenty = validateSequence([...order, makeSong('d1', { artist: 'Devi' })], { limit: 4, avoidLeads });
    expect(ids(plenty.songs)).toEqual(['a1', 'b1', 'c1', 'd1']);
    expect(plenty.relaxed).not.toContain('sitting-avoid');
    // Without the sitting signal Kiran's first song opens (the cap of one per artist holds the others back).
    expect(ids(validateSequence(order, { limit: 4 }).songs)).toEqual(['k1', 'a1', 'b1', 'c1']);
  });

  it('9.0: a pushed-away artist never costs spacing — the stretch ends short instead, and an empty stretch still gets one song', () => {
    const out = validateSequence([makeSong('k1', { artist: 'Kiran' }), makeSong('a1', { artist: 'Asha' }), makeSong('k2', { artist: 'Kiran' })], { limit: 3, avoidLeads: new Set(['kiran']) });
    // a1, then one Kiran song (spacing holds); a second Kiran song would follow the first: the stretch stops.
    expect(ids(out.songs)).toEqual(['a1', 'k1']);
    expect(out.relaxed).toContain('sitting-avoid');
    // Nothing but Kiran: one song rather than none, never two in a row.
    expect(ids(validateSequence([makeSong('k1', { artist: 'Kiran' }), makeSong('k2', { artist: 'Kiran' })], { limit: 3, avoidLeads: new Set(['kiran']) }).songs)).toEqual(['k1']);
  });
});
