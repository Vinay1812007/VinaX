// @vitest-environment jsdom
/**
 * Your Week is the weekly discovery mix ("New to you this week"), built with
 * the week's salt and the wider gather, cached until Monday; Made for you's
 * copy of that mix shows the same songs once the week is built. An older
 * cached week (the first 30 songs of every mix) is not reused.
 */
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeSong } from '@/__fixtures__/songs';
import type { Mix } from '@/services/recommendation/types';
import { KEYS } from '@/constants/storage-keys';
import { useSettingsStore } from '@/store/settingsStore';

const buildRecommendations = vi.fn();
const initHeardSet = vi.fn(async () => undefined);
vi.mock('@/services/recommendation/engine', () => ({ buildRecommendations: (ctx: unknown) => buildRecommendations(ctx) }));
vi.mock('@/services/recommendation/context', () => ({ getRecommendationContext: () => ({ salt: 1, pinnedLanguages: ['hindi'] }) }));
vi.mock('@/services/recommendation/heardSet', () => ({ initHeardSet: () => initHeardSet() }));

import { isoWeekKey, readYourWeek, useWeeklyMix, withYourWeek } from './useWeeklyMix';

const mixOf = (id: string, kind: Mix['kind'], songIds: string[]): Mix => ({ id, kind, title: id, explanation: '', songs: songIds.map((s) => makeSong(s)) });
const ids = (list: { id: string }[] | undefined) => (list ?? []).map((s) => s.id);

let client: QueryClient;
const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  localStorage.clear();
  useSettingsStore.setState({ pinnedLanguages: ['hindi'] });
  buildRecommendations.mockReset().mockResolvedValue([
    mixOf('made-for-you', 'made-for-you', ['m1', 'm2']),
    mixOf('discover-weekly-2026-11-16', 'discover-weekly', ['d1', 'd2', 'd3']),
  ]);
  initHeardSet.mockClear();
});
afterEach(() => localStorage.clear());

describe('useWeeklyMix', () => {
  it('is the discovery mix only, built with the week salt and the wider gather, after the heard-set loads', async () => {
    const { result } = renderHook(() => useWeeklyMix(), { wrapper });
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(ids(result.current.data)).toEqual(['d1', 'd2', 'd3']);
    expect(initHeardSet).toHaveBeenCalled();
    const ctx = buildRecommendations.mock.calls[0][0] as { salt: number; widen: number };
    expect(ctx.widen).toBe(2);
    expect(ctx.salt).not.toBe(1);
    expect(ids(readYourWeek() ?? [])).toEqual(['d1', 'd2', 'd3']);
  });

  it('serves the saved week without building again, and ignores a week saved before v2', async () => {
    localStorage.setItem(KEYS.weekly, JSON.stringify({ week: isoWeekKey(), langs: 'hindi', songs: [makeSong('old')] }));
    expect(readYourWeek()).toBeNull();
    localStorage.setItem(KEYS.weekly, JSON.stringify({ v: 2, week: isoWeekKey(), langs: 'hindi', songs: [makeSong('kept')] }));
    const { result } = renderHook(() => useWeeklyMix(), { wrapper });
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(ids(result.current.data)).toEqual(['kept']);
    expect(buildRecommendations).not.toHaveBeenCalled();
    // Another week, or other languages: not this week's list.
    expect(readYourWeek('2020-W01')).toBeNull();
    expect(readYourWeek(isoWeekKey(), 'telugu')).toBeNull();
  });

  it('puts the week into Made for you’s cached mixes once it is built', async () => {
    client.setQueryData(['mixes', 'x'], [mixOf('discover-weekly-x', 'discover-weekly', ['home1']), mixOf('made-for-you', 'made-for-you', ['m1'])]);
    const { result } = renderHook(() => useWeeklyMix(), { wrapper });
    await waitFor(() => expect(result.current.data).toBeDefined());
    const mixes = client.getQueryData<Mix[]>(['mixes', 'x'])!;
    expect(ids(mixes[0].songs)).toEqual(['d1', 'd2', 'd3']);
    expect(ids(mixes[1].songs)).toEqual(['m1']);
  });
});

describe('withYourWeek', () => {
  it('swaps only the discovery mix’s songs, and leaves the mixes alone with no week', () => {
    const mixes = [mixOf('made-for-you', 'made-for-you', ['m1']), mixOf('dw', 'discover-weekly', ['x'])];
    expect(withYourWeek(mixes, null)).toBe(mixes);
    const out = withYourWeek(mixes, [makeSong('w1'), makeSong('w2')]);
    expect(ids(out[1].songs)).toEqual(['w1', 'w2']);
    expect(out[0]).toBe(mixes[0]);
  });
});
