import { describe, expect, it } from 'vitest';
import { connectionAllows, planSmartDownloads, planSmartRemovals, SMART_MAX } from './smart';

describe('15.0 — smart downloads', () => {
  it('fetches only on Wi-Fi or wired when the browser can tell, and says "unknown" otherwise', () => {
    expect(connectionAllows({ connection: { type: 'wifi' } })).toBe(true);
    expect(connectionAllows({ connection: { type: 'ethernet' } })).toBe(true);
    expect(connectionAllows({ connection: { type: 'cellular' } })).toBe(false);
    expect(connectionAllows({ connection: { type: 'wifi', saveData: true } })).toBe(false);
    expect(connectionAllows({ connection: { type: 'unknown' } })).toBeNull();
    expect(connectionAllows({})).toBeNull();
  });

  it('plans at most SMART_MAX new downloads and skips what is already on the device', () => {
    const mix = Array.from({ length: 30 }, (_, i) => `s${i}`);
    const have = new Set(['s0', 's2', 's4']);
    const plan = planSmartDownloads(mix, have);
    expect(plan).toHaveLength(SMART_MAX);
    expect(plan).not.toContain('s0');
    expect(plan[0]).toBe('s1');
    expect(planSmartDownloads(['a', 'b'], new Set(['a', 'b']))).toEqual([]);
  });

  it('removes last week\'s automatic copies, never a manual download or a song still in the mix', () => {
    const previous = { week: '2026-W42', ids: ['old1', 'old2', 'keep', 'manual'], done: true };
    const removals = planSmartRemovals(previous, new Set(['keep', 'new1']), new Set(['manual']));
    expect(removals).toEqual(['old1', 'old2']);
    expect(planSmartRemovals(null, new Set(), new Set())).toEqual([]);
  });
});
