import type { HomeSection } from '@/services/recommendation/homeDesign';
import { decayedValue, type HomeSignals } from './homeSignals';

/**
 * 8.2.0 — dynamic Home order.
 *
 * When nobody has chosen an order (no Home Studio layout, no owner-published
 * order, no running shelf-order experiment), Home orders its blocks by what
 * the listener does:
 *
 *  - time of day: day picks lead in the morning, moods and favourites in the
 *    evening and at night;
 *  - usage: blocks the listener taps into rise, blocks they never touch sink;
 *  - outcomes: songs started from a block and heard through lift it, skipped
 *    ones lower it (weighted double for the discovery block — that is the
 *    "does this listener want new music" signal);
 *  - genre affinity: a listener with a clear favourite genre gets the genre
 *    block (which now opens with their top genres) sooner.
 *
 * The result is a pure function of its inputs. HomePage computes it once per
 * session (see sessionHomeOrder) so shelves never move while scrolling.
 * Each block can move at most MAX_SHIFT places from its default slot, and the
 * shortcut row and the endless feed never move.
 */

export type DayPart = 'morning' | 'afternoon' | 'evening' | 'night';

/** Blocks that keep their exact position. */
export const ANCHORED: readonly HomeSection[] = ['quick', 'feed'];
/** The furthest a block can move from its default slot, in places. */
export const MAX_SHIFT = 3;
/** Taps needed before usage says anything. */
export const MIN_TAPS = 3;
/** Heard-through + skipped songs needed before outcomes say anything. */
export const MIN_OUTCOMES = 2;

export function dayPartOf(hour: number): DayPart {
  const h = ((Math.floor(hour) % 24) + 24) % 24;
  if (h >= 5 && h < 12) return 'morning';
  if (h >= 12 && h < 17) return 'afternoon';
  if (h >= 17 && h < 22) return 'evening';
  return 'night';
}

const DAYPART_LIFT: Record<DayPart, Partial<Record<HomeSection, number>>> = {
  morning: { daypicks: 2, moods: 0.5, charts: -0.5 },
  afternoon: { discovery: 1, charts: 0.5 },
  evening: { moods: 1, daypicks: 0.5, loved: 0.5 },
  night: { moods: 1, loved: 1.5, discovery: -0.5, charts: -1 },
};

export interface HomeOrderInput {
  /** The composed, visible order (after owner and listener hides). */
  base: readonly HomeSection[];
  hour: number;
  now: number;
  signals: HomeSignals;
  /** The top genre's share of the listener's genre affinity, 0..1 (genreAffinity.ts). */
  genreStrength?: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Every block's lift in places (positive = earlier), before clamping. Exposed for tests and debugging. */
export function blockLifts(input: HomeOrderInput): Partial<Record<HomeSection, number>> {
  const { base, hour, now, signals, genreStrength = 0 } = input;
  const movable = base.filter((k) => !ANCHORED.includes(k));
  const lifts: Partial<Record<HomeSection, number>> = {};
  const add = (k: HomeSection, v: number) => {
    if (v) lifts[k] = (lifts[k] ?? 0) + v;
  };

  // Time of day.
  const part = DAYPART_LIFT[dayPartOf(hour)];
  for (const k of movable) add(k, part[k] ?? 0);

  // Usage: each block's share of taps against an even share.
  const taps = movable.map((k) => decayedValue(signals.taps[k], now));
  const total = taps.reduce((a, b) => a + b, 0);
  if (total >= MIN_TAPS && movable.length > 1) {
    const even = 1 / movable.length;
    movable.forEach((k, i) => add(k, clamp((taps[i] / total - even) * movable.length, -1.5, 2.5)));
  }

  // Outcomes: heard through vs skipped, smoothed so two plays don't swing it.
  for (const k of movable) {
    const o = signals.outcomes[k];
    if (!o) continue;
    const done = decayedValue(o.done, now);
    const skipped = decayedValue(o.skipped, now);
    if (done + skipped < MIN_OUTCOMES) continue;
    const rate = (done - skipped) / (done + skipped + 2);
    add(k, rate * (k === 'discovery' ? 2.5 : 1));
  }

  // Genre affinity: a clear favourite brings the genre block (top genres first) forward.
  if (movable.includes('genres') && genreStrength > 0.2) add('genres', Math.min(2, genreStrength * 3));

  return lifts;
}

/** The dynamic order for `input.base`. Deterministic; a permutation of `base`. */
export function orderHomeBlocks(input: HomeOrderInput): HomeSection[] {
  const { base } = input;
  const lifts = blockLifts(input);
  const movable = base
    .map((k, i) => ({ k, i }))
    .filter(({ k }) => !ANCHORED.includes(k))
    .map(({ k, i }) => {
      const lift = clamp(lifts[k] ?? 0, -MAX_SHIFT, MAX_SHIFT);
      return { k, i, lift, score: -i + lift };
    })
    // A tie goes to the block with the stronger lift (a lowered block yields its slot), then to the default order.
    .sort((a, b) => b.score - a.score || b.lift - a.lift || a.i - b.i);
  // Anchored blocks keep their slots; the rest fill the others in score order.
  let next = 0;
  return base.map((k) => (ANCHORED.includes(k) ? k : movable[next++].k));
}

/* ---- once per session ---- */

export const HOME_ORDER_SESSION_KEY = 'vinax.home.order.session.v1';
let memo: { sig: string; order: HomeSection[] } | null = null;

const sameBlocks = (a: readonly HomeSection[], b: readonly HomeSection[]) =>
  a.length === b.length && [...a].sort().join(',') === [...b].sort().join(',');

/**
 * The session's order for `base`: computed on first use, then reused for
 * the rest of the session (in memory, and in sessionStorage so a reload of
 * the same tab keeps it). A different `base` (the owner or the listener
 * changed the layout) computes afresh.
 */
export function sessionHomeOrder(base: readonly HomeSection[], compute: () => HomeSection[]): HomeSection[] {
  const sig = base.join(',');
  if (memo?.sig === sig) return memo.order;
  try {
    const raw = window.sessionStorage.getItem(HOME_ORDER_SESSION_KEY);
    const stored = raw ? (JSON.parse(raw) as { sig?: unknown; order?: unknown }) : null;
    if (stored?.sig === sig && Array.isArray(stored.order) && sameBlocks(stored.order as HomeSection[], base)) {
      memo = { sig, order: stored.order as HomeSection[] };
      return memo.order;
    }
  } catch {
    /* no session storage: in-memory only */
  }
  const computed = compute();
  const order = sameBlocks(computed, base) ? computed : [...base];
  memo = { sig, order };
  try {
    window.sessionStorage.setItem(HOME_ORDER_SESSION_KEY, JSON.stringify(memo));
  } catch {
    /* in-memory only */
  }
  return order;
}

/** Forget the session order (tests, and an explicit Home refresh). */
export function resetSessionHomeOrder(): void {
  memo = null;
  try {
    window.sessionStorage.removeItem(HOME_ORDER_SESSION_KEY);
  } catch {
    /* ignore */
  }
}
