// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { emitPlaybackEvent, newRun } from '@/services/playback/session';
import { makeSong } from '@/__fixtures__/songs';
import {
  attributeSong,
  attributedBlock,
  bumpDecayed,
  decayedValue,
  HOME_SIGNALS_KEY,
  installHomeOutcomeTracking,
  loadHomeSignals,
  noteBlockTap,
  parseSignals,
  resetHomeAttribution,
  resetHomeSignals,
} from './homeSignals';

const DAY = 86_400_000;

const end = (id: string, heardSec: number, durationSec = 200) =>
  emitPlaybackEvent({ kind: 'end', instanceId: id, song: makeSong(id), from: null, heardSec, durationSec, reason: 'manual-skip', run: newRun(), auto: null });

beforeEach(() => {
  window.localStorage.clear();
  resetHomeAttribution();
});

describe('Home signals', () => {
  it('forgets everything on reset (Reset taste profile)', () => {
    noteBlockTap('moods', 1000);
    expect(window.localStorage.getItem(HOME_SIGNALS_KEY)).not.toBeNull();
    resetHomeSignals();
    expect(window.localStorage.getItem(HOME_SIGNALS_KEY)).toBeNull();
    expect(loadHomeSignals().taps.moods).toBeUndefined();
  });

  it('decays with a two-week half-life', () => {
    expect(decayedValue({ s: 8, t: 0 }, 14 * DAY)).toBeCloseTo(4);
    expect(decayedValue(undefined, 0)).toBe(0);
    expect(bumpDecayed({ s: 8, t: 0 }, 14 * DAY).s).toBeCloseTo(5);
  });

  it('records taps per block on this device', () => {
    noteBlockTap('moods', 1000);
    noteBlockTap('moods', 1000);
    noteBlockTap('charts', 1000);
    const s = loadHomeSignals();
    expect(s.taps.moods?.s).toBe(2);
    expect(s.taps.charts?.s).toBe(1);
  });

  it('drops malformed storage instead of trusting it', () => {
    window.localStorage.setItem(HOME_SIGNALS_KEY, '{"taps":{"moods":{"s":"x","t":1},"loved":{"s":2,"t":3}},"outcomes":{"discovery":{"done":null}}}');
    const s = loadHomeSignals();
    expect(s.taps.moods).toBeUndefined();
    expect(s.taps.loved).toEqual({ s: 2, t: 3 });
    expect(s.outcomes).toEqual({});
    expect(parseSignals('nope').taps).toEqual({});
    window.localStorage.setItem(HOME_SIGNALS_KEY, '{broken');
    expect(loadHomeSignals().taps).toEqual({});
  });

  it('credits a heard-through or skipped song to the block that started it', () => {
    installHomeOutcomeTracking();
    installHomeOutcomeTracking(); // idempotent: one listener
    attributeSong('d1', 'discovery');
    attributeSong('d2', 'discovery');
    end('d1', 190);
    end('d2', 10);
    end('other', 10); // not started from Home: ignored
    const o = loadHomeSignals().outcomes.discovery!;
    expect(o.done.s).toBe(1);
    expect(o.skipped.s).toBe(1);
    expect(attributedBlock('d1')).toBeNull();
  });

  it('a middling listen judges nothing and keeps the attribution', () => {
    installHomeOutcomeTracking();
    attributeSong('m', 'moods');
    end('m', 100);
    expect(loadHomeSignals().outcomes.moods).toBeUndefined();
    expect(attributedBlock('m')).toBe('moods');
  });
});
