// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HomeSection } from '@/services/recommendation/homeDesign';
import { blockLifts, dayPartOf, MAX_SHIFT, orderHomeBlocks, resetSessionHomeOrder, sessionHomeOrder } from './homeOrder';
import { emptySignals, type HomeSignals } from './homeSignals';

const BASE: HomeSection[] = ['quick', 'personal', 'aihome', 'discovery', 'charts', 'seasonal', 'moods', 'genres', 'artists', 'albums', 'daypicks', 'loved', 'feed'];
const NOW = Date.UTC(2026, 8, 28, 12);
const AFTERNOON = 14;

const withTaps = (taps: Partial<Record<HomeSection, number>>): HomeSignals => {
  const s = emptySignals();
  for (const [k, v] of Object.entries(taps)) s.taps[k as HomeSection] = { s: v, t: NOW };
  return s;
};
const withOutcome = (block: HomeSection, done: number, skipped: number): HomeSignals => {
  const s = emptySignals();
  s.outcomes[block] = { done: { s: done, t: NOW }, skipped: { s: skipped, t: NOW } };
  return s;
};

describe('dynamic Home order', () => {
  it('maps hours to day parts', () => {
    expect(dayPartOf(7)).toBe('morning');
    expect(dayPartOf(13)).toBe('afternoon');
    expect(dayPartOf(19)).toBe('evening');
    expect(dayPartOf(23)).toBe('night');
    expect(dayPartOf(2)).toBe('night');
    expect(dayPartOf(-1)).toBe('night');
  });

  it('is a permutation of the base, deterministic, and never moves the shortcut row or the feed', () => {
    const input = { base: BASE, hour: 21, now: NOW, signals: withTaps({ loved: 10, moods: 4 }), genreStrength: 0.6 };
    const a = orderHomeBlocks(input);
    expect([...a].sort()).toEqual([...BASE].sort());
    expect(orderHomeBlocks(input)).toEqual(a);
    expect(a[0]).toBe('quick');
    expect(a[a.length - 1]).toBe('feed');
  });

  it('with no signals in the afternoon only time of day nudges, and within the shift limit', () => {
    const order = orderHomeBlocks({ base: BASE, hour: AFTERNOON, now: NOW, signals: emptySignals() });
    for (const k of BASE) expect(Math.abs(order.indexOf(k) - BASE.indexOf(k))).toBeLessThanOrEqual(MAX_SHIFT + 1);
    expect(order.indexOf('discovery')).toBeLessThanOrEqual(BASE.indexOf('discovery'));
  });

  it('mornings lift the day picks; nights lift moods and favourites and lower charts', () => {
    const morning = orderHomeBlocks({ base: BASE, hour: 8, now: NOW, signals: emptySignals() });
    expect(morning.indexOf('daypicks')).toBeLessThan(BASE.indexOf('daypicks'));
    const night = orderHomeBlocks({ base: BASE, hour: 23, now: NOW, signals: emptySignals() });
    expect(night.indexOf('loved')).toBeLessThan(BASE.indexOf('loved'));
    expect(night.indexOf('charts')).toBeGreaterThan(BASE.indexOf('charts'));
  });

  it('blocks the listener uses rise; a few stray taps do nothing', () => {
    const used = orderHomeBlocks({ base: BASE, hour: AFTERNOON, now: NOW, signals: withTaps({ albums: 12, personal: 2 }) });
    expect(used.indexOf('albums')).toBeLessThan(BASE.indexOf('albums'));
    const stray = blockLifts({ base: BASE, hour: AFTERNOON, now: NOW, signals: withTaps({ albums: 1 }) });
    expect(stray.albums).toBeUndefined();
  });

  it('old taps fade: the same taps half a year ago barely count', () => {
    const s = withTaps({ albums: 12 });
    s.taps.albums!.t = NOW - 180 * 86_400_000;
    const lifts = blockLifts({ base: BASE, hour: AFTERNOON, now: NOW, signals: s });
    expect(lifts.albums ?? 0).toBe(0);
  });

  it('completed discovery picks lift discovery; skipped ones lower it', () => {
    const liked = orderHomeBlocks({ base: BASE, hour: 23, now: NOW, signals: withOutcome('discovery', 8, 0) });
    const skipped = orderHomeBlocks({ base: BASE, hour: 23, now: NOW, signals: withOutcome('discovery', 0, 8) });
    expect(liked.indexOf('discovery')).toBeLessThan(skipped.indexOf('discovery'));
    expect(skipped.indexOf('discovery')).toBeGreaterThan(BASE.indexOf('discovery'));
    // One outcome is not a pattern yet.
    expect(blockLifts({ base: BASE, hour: AFTERNOON, now: NOW, signals: withOutcome('discovery', 1, 0) }).discovery).toBe(1);
  });

  it('a clear favourite genre brings the genre block forward', () => {
    const order = orderHomeBlocks({ base: BASE, hour: AFTERNOON, now: NOW, signals: emptySignals(), genreStrength: 0.7 });
    expect(order.indexOf('genres')).toBeLessThan(BASE.indexOf('genres'));
    const flat = orderHomeBlocks({ base: BASE, hour: AFTERNOON, now: NOW, signals: emptySignals(), genreStrength: 0.1 });
    expect(flat.indexOf('genres')).toBe(BASE.indexOf('genres'));
  });

  it('never moves a block further than the shift limit, whatever the signals', () => {
    const order = orderHomeBlocks({ base: BASE, hour: 23, now: NOW, signals: withTaps({ loved: 500 }), genreStrength: 1 });
    expect(BASE.indexOf('loved') - order.indexOf('loved')).toBeLessThanOrEqual(MAX_SHIFT + 1);
  });

  it('works on a shortened layout (owner or listener hid blocks)', () => {
    const base: HomeSection[] = ['personal', 'moods', 'loved'];
    const order = orderHomeBlocks({ base, hour: 23, now: NOW, signals: emptySignals() });
    expect([...order].sort()).toEqual([...base].sort());
  });
});

describe('sessionHomeOrder', () => {
  afterEach(() => resetSessionHomeOrder());

  it('computes once per session and reuses the order, so shelves never reshuffle', () => {
    const compute = vi.fn((): HomeSection[] => ['loved', 'moods']);
    const base: HomeSection[] = ['moods', 'loved'];
    expect(sessionHomeOrder(base, compute)).toEqual(['loved', 'moods']);
    expect(sessionHomeOrder(base, () => ['moods', 'loved'])).toEqual(['loved', 'moods']);
    expect(compute).toHaveBeenCalledOnce();
  });

  it('survives a reload of the tab through session storage', () => {
    const base: HomeSection[] = ['moods', 'loved'];
    sessionHomeOrder(base, () => ['loved', 'moods']);
    const stored = window.sessionStorage.getItem('vinax.home.order.session.v1');
    resetSessionHomeOrder();
    window.sessionStorage.setItem('vinax.home.order.session.v1', stored!);
    expect(sessionHomeOrder(base, () => ['moods', 'loved'])).toEqual(['loved', 'moods']);
  });

  it('recomputes when the layout changes, and rejects a result that is not a permutation', () => {
    sessionHomeOrder(['moods', 'loved'], () => ['loved', 'moods']);
    expect(sessionHomeOrder(['moods', 'loved', 'charts'], () => ['charts', 'moods', 'loved'])).toEqual(['charts', 'moods', 'loved']);
    resetSessionHomeOrder();
    expect(sessionHomeOrder(['moods', 'loved'], () => ['moods'] as HomeSection[])).toEqual(['moods', 'loved']);
  });
});
