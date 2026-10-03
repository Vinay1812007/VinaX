// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TrendsSnapshot } from './client';

const fetchVerifiedTrends = vi.fn<() => Promise<TrendsSnapshot | null>>();
vi.mock('./client', () => ({ fetchVerifiedTrends: () => fetchVerifiedTrends() }));

import { resetTrendSignal, trendSignalNow, TREND_EDITORIAL_MAX, TREND_MAX } from './signal';

const ctx = (country: string | null, languages: string[] = ['telugu']) => ({ region: country ? { country, regionLabel: null, source: 'edge' as const } : null, pinnedLanguages: languages });
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

  // 9.1.0 — the region is unchanged but the language is not. 9.0 compared the
  // region only: the Telugu snapshot was handed to a Hindi listener and the
  // mismatch started no refresh of its own.
  it('never applies another language’s chart, and refreshes for the new one', async () => {
    fetchVerifiedTrends.mockResolvedValue({ generatedAt: '', sources: [], items: [item({ catalogId: 'te-top', language: 'telugu' })] });
    trendSignalNow(ctx('IN', ['telugu']));
    await settle();
    expect(trendSignalNow(ctx('IN', ['telugu'])).bonus.size).toBe(1);

    fetchVerifiedTrends.mockResolvedValue({ generatedAt: '', sources: [], items: [item({ catalogId: 'hi-top', language: 'hindi' })] });
    // Same region, new language: nothing is applied yet…
    expect(trendSignalNow(ctx('IN', ['hindi'])).bonus.size).toBe(0);
    // …and the mismatch itself started the refresh for the new language.
    await settle();
    const hindi = trendSignalNow(ctx('IN', ['hindi']));
    expect(hindi.bonus.get('hi-top')).toBeGreaterThan(0);
    expect(hindi.language).toBe('hindi');
    expect(fetchVerifiedTrends).toHaveBeenCalledTimes(2);
  });

  it('carries the verified entries themselves, best rank first, so they can enter a pool', async () => {
    fetchVerifiedTrends.mockResolvedValue({ generatedAt: '', sources: [], items: [
      item({ catalogId: 'five', sourceRank: 5, title: 'Five', artist: 'E' }),
      item({ catalogId: 'one', sourceRank: 1, title: 'One', artist: 'A', sourceUrl: 'https://chart.example/one' }),
    ] });
    trendSignalNow(ctx('IN'));
    await settle();
    const s = trendSignalNow(ctx('IN'));
    expect(s.items.map((i) => i.catalogId)).toEqual(['one', 'five']);
    expect(s.items[0]).toMatchObject({ title: 'One', artist: 'A', sourceRank: 1, sourceKind: 'public-chart', sourceUrl: 'https://chart.example/one' });
  });
});
