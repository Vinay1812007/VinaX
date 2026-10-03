// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { HOME_TTL_MS, expireHomeIfStale, homeGeneration, homeIsStrict, refreshHome, resetHomeGeneration } from './homeRefresh';

const T0 = Date.UTC(2026, 9, 3, 12, 0, 0);

beforeEach(() => resetHomeGeneration(T0));

describe('when Home builds itself again', () => {
  it('an explicit refresh starts a new generation', () => {
    const before = homeGeneration().gen;
    expect(refreshHome({}, T0 + 1_000)).toBe(before + 1);
    expect(homeGeneration().gen).toBe(before + 1);
  });

  it('ordinary navigation inside the window does NOT — returning to Home is a cache hit', () => {
    const before = homeGeneration().gen;
    // Several visits, all inside the TTL.
    expect(expireHomeIfStale(T0 + 60_000)).toBe(before);
    expect(expireHomeIfStale(T0 + 5 * 60_000)).toBe(before);
    expect(expireHomeIfStale(T0 + HOME_TTL_MS - 1)).toBe(before);
    expect(homeGeneration().gen).toBe(before);
  });

  it('a visit after the window expires does start a new generation', () => {
    const before = homeGeneration().gen;
    expect(expireHomeIfStale(T0 + HOME_TTL_MS)).toBe(before + 1);
    // …and the clock restarts from that visit, so the next one is a hit again.
    expect(expireHomeIfStale(T0 + HOME_TTL_MS + 1_000)).toBe(before + 1);
  });

  it('an explicit refresh restarts the window too', () => {
    refreshHome({}, T0 + 1_000);
    const after = homeGeneration().gen;
    expect(expireHomeIfStale(T0 + 1_000 + HOME_TTL_MS - 1)).toBe(after);
  });

  describe('"fewer repeats" lasts exactly one generation', () => {
    it('is off for an ordinary refresh', () => {
      refreshHome({}, T0 + 1_000);
      expect(homeIsStrict()).toBe(false);
    });

    it('is on for the generation that asked for it', () => {
      refreshHome({ fewerRepeats: true }, T0 + 1_000);
      expect(homeIsStrict()).toBe(true);
    });

    it('is cleared by the next ordinary refresh', () => {
      refreshHome({ fewerRepeats: true }, T0 + 1_000);
      refreshHome({}, T0 + 2_000);
      expect(homeIsStrict()).toBe(false);
    });

    it('is cleared by an expiry, which is an ordinary rebuild', () => {
      refreshHome({ fewerRepeats: true }, T0 + 1_000);
      expect(homeIsStrict()).toBe(true);
      expireHomeIfStale(T0 + 1_000 + HOME_TTL_MS);
      expect(homeIsStrict()).toBe(false);
    });

    it('is off after a reset', () => {
      refreshHome({ fewerRepeats: true }, T0 + 1_000);
      resetHomeGeneration(T0);
      expect(homeIsStrict()).toBe(false);
    });
  });

  it('keeps the older call shape working (a bare `now`)', () => {
    const before = homeGeneration().gen;
    expect(refreshHome(T0 + 1_000)).toBe(before + 1);
    expect(homeIsStrict()).toBe(false);
    // The window restarted from the timestamp that was passed.
    expect(expireHomeIfStale(T0 + 1_000 + HOME_TTL_MS - 1)).toBe(before + 1);
  });
});
