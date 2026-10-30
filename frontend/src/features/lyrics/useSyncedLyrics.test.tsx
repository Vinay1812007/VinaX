// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { makeSong } from '@/__fixtures__/songs';

const getLyrics = vi.fn();
const fetchLrclibLyrics = vi.fn();
vi.mock('@/services/api', () => ({ getLyrics: (...a: unknown[]) => getLyrics(...a) }));
vi.mock('@/services/lyrics/lrclib', () => ({ fetchLrclibLyrics: (...a: unknown[]) => fetchLrclibLyrics(...a) }));
vi.mock('@/services/analytics/telemetry', () => ({ reportLyricMiss: vi.fn() }));

import { useSyncedLyrics } from './useSyncedLyrics';
import { useSettingsStore } from '@/store/settingsStore';

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>
);
const song = makeSong('4r-wShBa', { title: 'Srivalli' });
const tamilLrc = { plain: null, synced: [{ t: 1, text: 'நான் பாக்குறேன்' }], source: 'lrclib' as const };

beforeEach(() => {
  getLyrics.mockReset();
  fetchLrclibLyrics.mockReset().mockResolvedValue(tamilLrc);
});
afterEach(() => {
  cleanup();
  useSettingsStore.getState().setLyricsScript('original');
});

it('as written: LRCLIB synced lines win, and the catalogue is asked without a script', async () => {
  getLyrics.mockResolvedValue({ lyrics: 'x', copyright: null, synced: null });
  const { result } = renderHook(() => useSyncedLyrics(song), { wrapper });
  await waitFor(() => expect(result.current.data).toEqual(tamilLrc));
});

it('in English letters: the catalogue goes first with script=latin, synced lines included', async () => {
  useSettingsStore.getState().setLyricsScript('latin');
  getLyrics.mockResolvedValue({ lyrics: 'Naan paakkuren', copyright: null, synced: [{ t: 1, text: 'Naan paakkuren' }] });
  const { result } = renderHook(() => useSyncedLyrics(song), { wrapper });
  await waitFor(() => expect(result.current.data?.synced?.[0].text).toBe('Naan paakkuren'));
  expect(getLyrics).toHaveBeenCalledWith('4r-wShBa', { script: 'latin' });
  expect(fetchLrclibLyrics).not.toHaveBeenCalled();
});

it('in English letters: falls back to LRCLIB as written when the catalogue has nothing', async () => {
  useSettingsStore.getState().setLyricsScript('latin');
  getLyrics.mockRejectedValue(new Error('lyrics not found'));
  const { result } = renderHook(() => useSyncedLyrics(song), { wrapper });
  await waitFor(() => expect(result.current.data).toEqual(tamilLrc));
});
