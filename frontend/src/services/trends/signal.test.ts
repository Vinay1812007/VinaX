// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TrendsSnapshot } from './client';

const fetchVerifiedTrends = vi.fn<() => Promise<TrendsSnapshot | null>>();
vi.mock('./client', () => ({ fetchVerifiedTrends: () => fetchVerifiedTrends() }));

import { resetTrendSignal, trendSignalNow, TREND_EDITORIAL_MAX, TREND_MAX } from './signal';

const ctx = (country: string | null) => ({ region: country ? { country, regionLabel: null, source: 'edge' as const } : null, pinnedLanguages: ['telugu'] });
const item = (over: Partial<TrendsSnapshot['items'][number]>) => ({
  catalogId: 'x', title: 'T', artist: 'A', language: 'telugu', region: 'IN', source: 'chart', sourceLabel: 'Public video chart',
  sourceKind: 'public-chart' as const, sourceRank: 1, sourceUrl: null, observedAt: '', expiresAt: '', mappingConfidence: 1, momentum: null, newEntry: false, ...over,
});
/** The refresh runs through a dynamic import: let real timers drain it. */
const settle = async () => { for (let i = 0; i < 4; i += 1) await new Promise((r) => setTimeout(r, 0)); };

beforeEach(() => { resetTrendSignal(); fetchVerifiedTrends.mockReset(); });
afterEach(() => vi.useRealTimers());

describe('verified charts as one bounded signal', () => {
  it('never waits: the first round gets nothing and the snapshot serves the next one', async () => {
    fetchVerifiedTrends.mockResolvedValue({ generatedAt: '', sources: [], items: [item({ catalogId: 'top' })] });
    expect(trendSignalNow(ctx('IN')).bonus.size).toBe(0);
    await settle();
    expect(trendSignalNow(ctx('IN')).bonus.get('top')).toBeCloseTo(TREND_MAX);
  });

  it('caps the bonus, fades it down the list, and weighs an editorial pick less', async () => {
    fetchVerifiedTrends.mockResolvedValue({ generatedAt: '', sources: [], items: [
      item({ catalogId: 'one', sourceRank: 1 }),
      item({ catalogId: 'mid', sourceRank: 25 }),
      item({ catalogId: 'unsure', sourceRank: 1, mappingConfidence: 0.8 }),
      item({ catalogId: 'pick', sourceRank: 1, sourceKind: 'editorial', sourceLabel: 'Editorial pick' }),
    ] });
    trendSignalNow(ctx('IN'));
    await settle();
    const s = trendSignalNow(ctx('IN'));
    expect(s.bonus.get('one')).toBeCloseTo(TREND_MAX);
    expect(s.bonus.get('mid')!).toBeLessThan(TREND_MAX / 1.5);
    expect(s.bonus.get('unsure')!).toBeLessThan(s.bonus.get('one')!);
    expect(s.bonus.get('pick')!).toBeLessThanOrEqual(TREND_EDITORIAL_MAX);
    for (const v of s.bonus.values()) expect(v).toBeLessThanOrEqual(TREND_MAX);
    expect(s.label.get('pick')).toBe('Editorial pick');
  });

  it('is empty when the read is unavailable, and does not poll again at once', async () => {
    fetchVerifiedTrends.mockResolvedValue(null);
    trendSignalNow(ctx('IN'));
    await settle();
    expect(trendSignalNow(ctx('IN')).bonus.size).toBe(0);
    trendSignalNow(ctx('IN'));
    await settle();
    expect(fetchVerifiedTrends).toHaveBeenCalledTimes(1);
  });

  it('never applies another region’s chart', async () => {
    fetchVerifiedTrends.mockResolvedValue({ generatedAt: '', sources: [], items: [item({ catalogId: 'in-top' })] });
    trendSignalNow(ctx('IN'));
    await settle();
    expect(trendSignalNow(ctx('IN')).bonus.size).toBe(1);
    expect(trendSignalNow(ctx('US')).bonus.size).toBe(0);
  });
});
