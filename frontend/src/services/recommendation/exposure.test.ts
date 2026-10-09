// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  EXPOSURE_CAP,
  EXPOSURE_KEY,
  EXPOSURE_WEIGHTS,
  LEGACY_KEYS,
  MIGRATION_FLAG,
  exposureLedger,
  exposureStats,
  migrateLegacyExposure,
  recordExposure,
  recordReplayRequest,
  resetExposure,
  snoozeSong,
  snoozedKeySet,
  snoozedSongs,
  unsnooze,
} from './exposure';
import { songKey } from './songIdentity';
import { makeSong as song } from '@/__fixtures__/songs';

const HOUR = 3_600_000;
const DAY = 86_400_000;
const T0 = Date.UTC(2026, 9, 2, 12, 0, 0);

// Every call here is given its own `now`, with one exception that cannot be:
// a snooze receipt's `undo()` reads the clock itself (it runs seconds after
// the snooze in real life). T0 is a fixed date, so from the moment the real
// clock passed T0 + 7 days the undo test's snoozes were already expired and
// it failed for good. Freeze Date for the file — the explicit `now`
// arguments keep saying what each test means.
beforeEach(() => vi.useFakeTimers({ now: T0, toFake: ['Date'] }));
afterEach(() => vi.useRealTimers());

describe('exposure ledger', () => {
  beforeEach(() => {
    localStorage.clear();
    resetExposure();
  });

  it('is empty for a song the listener has never met', () => {
    const s = song('a', { title: 'Nee Kosam', artist: 'Sai Kiran' });
    const ledger = exposureLedger(T0);
    expect(ledger.penalty(songKey(s))).toBe(0);
    expect(ledger.cooling(songKey(s))).toBe(false);
  });

  it('keeps shown, queued and skipped apart: each costs its own amount', () => {
    const shown = song('a', { title: 'One', artist: 'A' });
    const queued = song('b', { title: 'Two', artist: 'B' });
    const skipped = song('c', { title: 'Three', artist: 'C' });
    recordExposure([shown], 'shown', T0);
    recordExposure([queued], 'queued', T0);
    recordExposure([skipped], 'skipped', T0);
    const l = exposureLedger(T0 + HOUR);
    expect(l.penalty(songKey(shown))).toBeGreaterThan(0);
    expect(l.penalty(songKey(queued))).toBeGreaterThan(l.penalty(songKey(shown)));
    expect(l.penalty(songKey(skipped))).toBeGreaterThan(l.penalty(songKey(queued)));
  });

  it('a shown penalty is large enough to move an order (unlike 8.2 served, 0.04)', () => {
    const s = song('a', { title: 'One', artist: 'A' });
    recordExposure([s], 'shown', T0);
    expect(exposureLedger(T0).penalty(songKey(s))).toBeGreaterThan(0.1);
  });

  it('decays to nothing across the horizon', () => {
    const s = song('a', { title: 'One', artist: 'A' });
    recordExposure([s], 'shown', T0);
    const fresh = exposureLedger(T0).penalty(songKey(s));
    const later = exposureLedger(T0 + EXPOSURE_WEIGHTS.shown.horizonMs / 2).penalty(songKey(s));
    expect(later).toBeLessThan(fresh);
    expect(later).toBeGreaterThan(0);
    expect(exposureLedger(T0 + EXPOSURE_WEIGHTS.shown.horizonMs + 1).penalty(songKey(s))).toBe(0);
  });

  it('stacks repeated skips, up to a cap', () => {
    const s = song('a', { title: 'One', artist: 'A' });
    recordExposure([s], 'skipped', T0);
    const one = exposureLedger(T0).penalty(songKey(s));
    recordExposure([s], 'skipped', T0);
    const two = exposureLedger(T0).penalty(songKey(s));
    expect(two).toBeGreaterThan(one);
    recordExposure([s], 'skipped', T0);
    recordExposure([s], 'skipped', T0);
    const capped = exposureLedger(T0).penalty(songKey(s));
    expect(capped).toBeCloseTo(one * 3, 5);
  });

  it('cools a song on a discovery surface, then lets it back', () => {
    const s = song('a', { title: 'One', artist: 'A' });
    recordExposure([s], 'shown', T0);
    expect(exposureLedger(T0 + HOUR).cooling(songKey(s))).toBe(true);
    expect(exposureLedger(T0 + EXPOSURE_WEIGHTS.shown.coolingMs + 1).cooling(songKey(s))).toBe(false);
  });

  it('forgives a favourite: a liked song is never cooled and pays a fraction', () => {
    const s = song('a', { title: 'One', artist: 'A' });
    recordExposure([s], 'played', T0);
    const plain = exposureLedger(T0).penalty(songKey(s));
    recordExposure([s], 'liked', T0);
    const liked = exposureLedger(T0);
    expect(liked.penalty(songKey(s))).toBeLessThan(plain);
    expect(liked.cooling(songKey(s))).toBe(false);
  });

  it('an explicit replay request clears the cooling entirely', () => {
    const s = song('a', { title: 'One', artist: 'A' });
    recordExposure([s], 'played', T0);
    recordExposure([s], 'skipped', T0);
    expect(exposureLedger(T0).cooling(songKey(s))).toBe(true);
    recordReplayRequest(s, T0);
    const l = exposureLedger(T0);
    expect(l.cooling(songKey(s))).toBe(false);
    expect(l.penalty(songKey(s))).toBe(0);
  });

  it('finishing a song answers its earlier skips', () => {
    const s = song('a', { title: 'One', artist: 'A' });
    recordExposure([s], 'skipped', T0);
    recordExposure([s], 'skipped', T0);
    const skipped = exposureLedger(T0).penalty(songKey(s));
    recordExposure([s], 'completed', T0 + DAY);
    expect(exposureLedger(T0 + DAY).penalty(songKey(s))).toBeLessThan(skipped);
  });

  it('collapses alternate releases of one song onto a single row', () => {
    const original = song('a', { title: 'Monica', artist: 'Sai Kiran' });
    const remix = song('b', { title: 'Monica (2025 Remix)', artist: 'Sai Kiran' });
    recordExposure([original], 'shown', T0);
    const l = exposureLedger(T0);
    expect(l.penalty(songKey(remix))).toBeGreaterThan(0);
    expect(l.size).toBe(1);
  });

  it('survives a reload (it is written through to storage)', () => {
    const s = song('a', { title: 'One', artist: 'A' });
    recordExposure([s], 'queued', T0);
    expect(localStorage.getItem(EXPOSURE_KEY)).toBeTruthy();
    // A fresh read with no in-memory help:
    const raw = localStorage.getItem(EXPOSURE_KEY)!;
    resetExposure();
    localStorage.setItem(EXPOSURE_KEY, raw);
    expect(exposureLedger(T0 + HOUR).penalty(songKey(s))).toBeGreaterThan(0);
  });

  it('forgets rows past the cap, oldest first', () => {
    for (let i = 0; i < EXPOSURE_CAP + 40; i += 1) {
      recordExposure([song(`s${i}`, { title: `Title ${i}`, artist: `Artist ${i}` })], 'shown', T0 + i);
    }
    const l = exposureLedger(T0 + EXPOSURE_CAP + 40);
    expect(l.size).toBe(EXPOSURE_CAP);
    // The newest survived, the very first did not.
    expect(l.keys.has(songKey(song('s0', { title: 'Title 0', artist: 'Artist 0' })))).toBe(false);
    const lastIndex = EXPOSURE_CAP + 39;
    expect(l.keys.has(songKey(song(`s${lastIndex}`, { title: `Title ${lastIndex}`, artist: `Artist ${lastIndex}` })))).toBe(true);
  });

  it('never records a song with no title or id', () => {
    recordExposure([{ ...song('a', { title: 'One', artist: 'A' }), title: '' }], 'shown', T0);
    expect(exposureLedger(T0).size).toBe(0);
  });

  it('reports counts for the diagnostics view', () => {
    recordExposure([song('a', { title: 'One', artist: 'A' })], 'shown', T0);
    recordExposure([song('b', { title: 'Two', artist: 'B' })], 'skipped', T0);
    const stats = exposureStats(T0);
    expect(stats.rows).toBe(2);
    expect(stats.shown).toBe(1);
    expect(stats.skipped).toBe(1);
    expect(stats.cooling).toBe(2);
  });

  describe('9.1 — snooze: "not this song, for a while"', () => {
    it('snoozes by canonical identity, so the remix goes quiet too', () => {
      const original = song('a', { title: 'Monica', artist: 'Sai Kiran' });
      const remix = song('b', { title: 'Monica (2025 Remix)', artist: 'Sai Kiran' });
      snoozeSong(original, 7, T0);
      const keys = snoozedKeySet(T0);
      expect(keys.has(songKey(original))).toBe(true);
      expect(keys.has(songKey(remix))).toBe(true);
      expect(keys.has(songKey(song('c', { title: 'Monica', artist: 'Someone Else' })))).toBe(false);
    });

    it('ends on its own', () => {
      const s = song('a', { title: 'One', artist: 'A' });
      snoozeSong(s, 7, T0);
      expect(snoozedKeySet(T0 + 6 * DAY).size).toBe(1);
      expect(snoozedKeySet(T0 + 8 * DAY).size).toBe(0);
    });

    it('undo lifts exactly this one and nothing else', () => {
      const a = song('a', { title: 'One', artist: 'A' });
      const b = song('b', { title: 'Two', artist: 'B' });
      snoozeSong(a, 7, T0);
      const receipt = snoozeSong(b, 7, T0)!;
      receipt.undo();
      const keys = snoozedKeySet(T0);
      expect(keys.has(songKey(a))).toBe(true);
      expect(keys.has(songKey(b))).toBe(false);
    });

    it('undo is idempotent', () => {
      const s = song('a', { title: 'One', artist: 'A' });
      const receipt = snoozeSong(s, 7, T0)!;
      receipt.undo();
      receipt.undo();
      expect(snoozedKeySet(T0).size).toBe(0);
    });

    it('undo restores an earlier snooze this one replaced', () => {
      const s = song('a', { title: 'One', artist: 'A' });
      snoozeSong(s, 30, T0);
      const longer = snoozedSongs(T0)[0].until;
      const receipt = snoozeSong(s, 7, T0)!;
      expect(snoozedSongs(T0)[0].until).toBeLessThan(longer);
      receipt.undo();
      expect(snoozedSongs(T0)[0].until).toBe(longer);
    });

    it('clamps a silly duration rather than storing it', () => {
      const s = song('a', { title: 'One', artist: 'A' });
      snoozeSong(s, 10_000, T0);
      expect(snoozedSongs(T0)[0].until).toBeLessThanOrEqual(T0 + 90 * DAY);
      unsnooze(songKey(s), T0);
      snoozeSong(s, -5, T0);
      expect(snoozedSongs(T0)[0].until).toBeGreaterThan(T0);
    });

    it('lists what is snoozed, soonest to end first', () => {
      snoozeSong(song('a', { title: 'Later', artist: 'A' }), 30, T0);
      snoozeSong(song('b', { title: 'Sooner', artist: 'B' }), 7, T0);
      expect(snoozedSongs(T0).map((x) => x.title)).toEqual(['Sooner', 'Later']);
    });

    it('refuses a song with no usable identity', () => {
      expect(snoozeSong({ ...song('a', { title: 'One', artist: 'A' }), title: '' }, 7, T0)).toBeNull();
    });

    it('is a HARD rule, not a penalty: the safety filter rejects it', async () => {
      const { safetyReasonFor } = await import('./filters');
      const s = song('a', { title: 'One', artist: 'A' });
      snoozeSong(s, 7, T0);
      expect(safetyReasonFor(s, { snoozedKeys: snoozedKeySet(T0) })).toBe('snoozed');
      expect(safetyReasonFor(song('z', { title: 'Other', artist: 'Z' }), { snoozedKeys: snoozedKeySet(T0) })).toBeNull();
    });

    it('is forgotten by "Erase everything"', () => {
      snoozeSong(song('a', { title: 'One', artist: 'A' }), 7, T0);
      resetExposure();
      expect(snoozedKeySet(T0).size).toBe(0);
    });

    it('survives a corrupt store', () => {
      localStorage.setItem('vinax.recs.snoozed.v1', '{not json');
      expect(snoozedKeySet(T0).size).toBe(0);
    });
  });

  describe('migration from the 9.0 memories', () => {
    it('imports the served list with its timestamps, once', () => {
      const s = song('a', { title: 'One', artist: 'A' });
      localStorage.setItem(LEGACY_KEYS.served, JSON.stringify([{ k: songKey(s), t: T0 - HOUR }]));
      const first = migrateLegacyExposure(T0);
      expect(first).toEqual({ imported: 1, already: false });
      expect(exposureLedger(T0).penalty(songKey(s))).toBeGreaterThan(0);
      expect(localStorage.getItem(MIGRATION_FLAG)).toBe('1');
      expect(migrateLegacyExposure(T0)).toEqual({ imported: 0, already: true });
    });

    it('leaves the legacy list on disk and drops entries past the TTL', () => {
      const old = song('a', { title: 'One', artist: 'A' });
      const raw = JSON.stringify([{ k: songKey(old), t: T0 - 100 * DAY }]);
      localStorage.setItem(LEGACY_KEYS.served, raw);
      expect(migrateLegacyExposure(T0).imported).toBe(0);
      expect(localStorage.getItem(LEGACY_KEYS.served)).toBe(raw);
    });

    it('survives a malformed legacy list', () => {
      localStorage.setItem(LEGACY_KEYS.served, 'not json');
      expect(() => migrateLegacyExposure(T0)).not.toThrow();
      expect(exposureLedger(T0).size).toBe(0);
    });

    it('never moves a fresher ledger row backwards', () => {
      const s = song('a', { title: 'One', artist: 'A' });
      recordExposure([s], 'shown', T0);
      const fresh = exposureLedger(T0).penalty(songKey(s));
      localStorage.setItem(LEGACY_KEYS.served, JSON.stringify([{ k: songKey(s), t: T0 - 2 * DAY }]));
      migrateLegacyExposure(T0);
      expect(exposureLedger(T0).penalty(songKey(s))).toBeCloseTo(fresh, 10);
    });
  });
});
