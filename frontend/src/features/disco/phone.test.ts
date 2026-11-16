import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TORCH_GAP_MS, TORCH_HOLD_MS, TorchPulser, discoPluginAvailable, setSystemBarsHidden } from './phone';

describe('TorchPulser', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('turns the flashlight on at a beat and off a moment later', () => {
    const set = vi.fn();
    const p = new TorchPulser(set);
    expect(p.beat(1000)).toBe(true);
    expect(set).toHaveBeenLastCalledWith(true);
    vi.advanceTimersByTime(TORCH_HOLD_MS);
    expect(set).toHaveBeenLastCalledWith(false);
  });

  it('never flashes more than three times a second, however fast the beat', () => {
    const p = new TorchPulser(() => undefined);
    for (let t = 0; t < 3000; t += 100) p.beat(t);
    expect(TORCH_GAP_MS).toBeGreaterThan(1000 / 3);
    expect(p.flashes).toBeLessThanOrEqual(9);
    expect(p.flashes).toBeGreaterThanOrEqual(8);
  });

  it('stop turns it off and cancels the pending off', () => {
    const set = vi.fn();
    const p = new TorchPulser(set);
    p.beat(0);
    p.stop();
    expect(set).toHaveBeenLastCalledWith(false);
    const calls = set.mock.calls.length;
    vi.advanceTimersByTime(1000);
    expect(set.mock.calls.length).toBe(calls);
  });
});

describe('outside the Android app', () => {
  it('has no plugin, and leaves the bars to the browser', () => {
    expect(discoPluginAvailable()).toBe(false);
    expect(setSystemBarsHidden(true)).toBe(false);
  });
});
