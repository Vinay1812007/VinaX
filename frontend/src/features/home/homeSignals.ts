import type { HomeSection } from '@/services/recommendation/homeDesign';
import { onPlaybackEvent, transitionOutcome } from '@/services/playback/session';

/**
 * 8.2.0 — what the listener does with Home, remembered on this device only.
 *
 *  - taps: how often each Home block is used (a tap on a card, tile or link
 *    inside it), decayed so last week counts more than last season;
 *  - outcomes: whether songs started from a block were heard through or
 *    skipped (the "discovery behaviour" signal: completed discovery picks lift
 *    the discovery block, skipped ones lower it).
 *
 * The block order is computed from these once per session (homeOrder.ts), so
 * nothing here ever moves a shelf while the listener is looking at Home.
 */
export const HOME_SIGNALS_KEY = 'vinax.home.signals.v1';
export const SIGNAL_HALF_LIFE_DAYS = 14;
const DAY_MS = 86_400_000;

export interface Decayed {
  /** Value at time `t`. */
  s: number;
  t: number;
}

export interface BlockOutcomes {
  done: Decayed;
  skipped: Decayed;
}

export interface HomeSignals {
  v: 1;
  taps: Partial<Record<HomeSection, Decayed>>;
  outcomes: Partial<Record<HomeSection, BlockOutcomes>>;
}

export function emptySignals(): HomeSignals {
  return { v: 1, taps: {}, outcomes: {} };
}

/** The decayed value of `d` at `now`. */
export function decayedValue(d: Decayed | undefined, now: number, halfLifeDays = SIGNAL_HALF_LIFE_DAYS): number {
  if (!d || !(d.s > 0)) return 0;
  const age = Math.max(0, now - d.t) / DAY_MS;
  return d.s * Math.pow(0.5, age / halfLifeDays);
}

/** Decay `d` to `now` and add `by`. */
export function bumpDecayed(d: Decayed | undefined, now: number, by = 1): Decayed {
  return { s: decayedValue(d, now) + by, t: now };
}

const isDecayed = (v: unknown): v is Decayed =>
  !!v && typeof v === 'object' && Number.isFinite((v as Decayed).s) && Number.isFinite((v as Decayed).t) && (v as Decayed).s >= 0;

/** Parse stored signals, dropping anything malformed (storage is user-editable). */
export function parseSignals(raw: unknown): HomeSignals {
  const out = emptySignals();
  if (!raw || typeof raw !== 'object') return out;
  const r = raw as { taps?: unknown; outcomes?: unknown };
  if (r.taps && typeof r.taps === 'object') {
    for (const [k, v] of Object.entries(r.taps as Record<string, unknown>)) if (isDecayed(v)) out.taps[k as HomeSection] = v;
  }
  if (r.outcomes && typeof r.outcomes === 'object') {
    for (const [k, v] of Object.entries(r.outcomes as Record<string, unknown>)) {
      const o = v as Partial<BlockOutcomes> | null;
      if (o && isDecayed(o.done) && isDecayed(o.skipped)) out.outcomes[k as HomeSection] = { done: o.done, skipped: o.skipped };
    }
  }
  return out;
}

export function loadHomeSignals(): HomeSignals {
  try {
    const raw = window.localStorage.getItem(HOME_SIGNALS_KEY);
    return raw ? parseSignals(JSON.parse(raw)) : emptySignals();
  } catch {
    return emptySignals();
  }
}

function saveHomeSignals(s: HomeSignals): void {
  try {
    window.localStorage.setItem(HOME_SIGNALS_KEY, JSON.stringify(s));
  } catch {
    /* storage full or blocked: Home just stays in its default order */
  }
}

/** 8.2.0 — forget what Home learned (Reset taste profile). */
export function resetHomeSignals(): void {
  try {
    window.localStorage.removeItem(HOME_SIGNALS_KEY);
  } catch {
    /* nothing stored */
  }
}

/** A tap on something inside a Home block. */
export function noteBlockTap(block: HomeSection, now = Date.now()): void {
  const s = loadHomeSignals();
  s.taps[block] = bumpDecayed(s.taps[block], now);
  saveHomeSignals(s);
}

/** A song started from a Home block was heard through or skipped. */
export function noteBlockOutcome(block: HomeSection, outcome: 'completed' | 'skipped', now = Date.now()): void {
  const s = loadHomeSignals();
  const prev = s.outcomes[block] ?? { done: { s: 0, t: now }, skipped: { s: 0, t: now } };
  s.outcomes[block] =
    outcome === 'completed'
      ? { done: bumpDecayed(prev.done, now), skipped: prev.skipped }
      : { done: prev.done, skipped: bumpDecayed(prev.skipped, now) };
  saveHomeSignals(s);
}

/* ---- which songs a Home block started (in memory, this session) ---- */

const ATTRIBUTION_CAP = 40;
const started = new Map<string, HomeSection>();
let tracking = false;

/** Remember that `songId` was started from `block`, so its outcome can be credited to it. */
export function attributeSong(songId: string, block: HomeSection): void {
  started.delete(songId);
  started.set(songId, block);
  while (started.size > ATTRIBUTION_CAP) started.delete(started.keys().next().value as string);
}

/** The block a song was started from, if any (exposed for tests). */
export function attributedBlock(songId: string): HomeSection | null {
  return started.get(songId) ?? null;
}

/**
 * Listen for how songs started from Home end. Idempotent: the listener is
 * installed once per app run and outlives Home (a song started from Home
 * usually ends while the listener is somewhere else).
 */
export function installHomeOutcomeTracking(): void {
  if (tracking) return;
  tracking = true;
  onPlaybackEvent((e) => {
    if (e.kind !== 'end') return;
    const block = started.get(e.song.id);
    if (!block) return;
    const outcome = transitionOutcome(e.heardSec, e.durationSec, e.reason);
    // A song replaced before it could be judged keeps its attribution for its next end.
    if (!outcome) return;
    started.delete(e.song.id);
    noteBlockOutcome(block, outcome);
  });
}

/** Reset the in-memory attribution (tests). */
export function resetHomeAttribution(): void {
  started.clear();
}
