// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Song } from '@/types';

vi.mock('@/services/audio/engine', () => ({
  audioEngine: { load: vi.fn(), preloadNext: vi.fn(), pause: vi.fn(), play: vi.fn(), seek: vi.fn() },
  orderedSources: () => [],
}));
vi.mock('@/services/media-session', () => ({
  setMediaHandlers: vi.fn(), updateMediaMetadata: vi.fn(), updatePlaybackState: vi.fn(), updatePositionState: vi.fn(),
}));
vi.mock('@/services/native', () => ({ checkNotificationOnFirstPlay: vi.fn(), haptic: vi.fn(), isNativePlatform: () => false, platformName: () => 'web' }));
vi.mock('@/services/personalization/updater', () => ({
  recordComplete: vi.fn(), recordPlay: vi.fn(), recordQueueAdd: vi.fn(), recordSkip: vi.fn(),
}));
const search = vi.fn(async (_q: string, _n?: number, _o?: unknown): Promise<Song[]> => []);
vi.mock('@/services/api', () => ({ searchSongs: (q: string, n?: number, o?: unknown) => search(q, n, o) }));
const generatePlaylist = vi.fn(async () => ({ ok: false as const, reason: 'empty' as const }));
vi.mock('@/services/ai/playlist', () => ({ generatePlaylist: (...a: unknown[]) => generatePlaylist(...(a as [])) }));

import AiRadioPage from './AiRadioPage';
import { usePlayerStore } from '@/store/playerStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useHistoryStore } from '@/store/historyStore';
import { useLibraryStore } from '@/store/libraryStore';
import { makeSong } from '@/__fixtures__/songs';

const startRadio = vi.fn();
const mount = () => render(<MemoryRouter><AiRadioPage /></MemoryRouter>);

beforeEach(() => {
  search.mockReset();
  search.mockResolvedValue([]);
  generatePlaylist.mockClear();
  startRadio.mockReset();
  usePlayerStore.setState({ startRadio, queue: [], index: 0 });
  useSettingsStore.setState({ pinnedLanguages: ['telugu'], mutedLanguages: [], aiDj: true, aiAssist: true });
  useHistoryStore.setState({ entries: [] });
  useLibraryStore.setState({ hiddenSongIds: [], hiddenArtists: [] });
});
afterEach(cleanup);

describe('AI Radio page', () => {
  it('a mood starts radio from its songs with that tune, in the listener language', async () => {
    const songs = ['1', '2', '3', '4', '5', '6'].map((id) => makeSong(`s${id}`));
    search.mockResolvedValue(songs);
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Start Melody radio' }));
    await waitFor(() => expect(startRadio).toHaveBeenCalledOnce());
    expect(search.mock.calls[0][0]).toBe('telugu melody songs');
    const [seed, opts] = startRadio.mock.calls[0] as [Song, { seeds: Song[]; tune: string }];
    expect(opts.tune).toBe('melody');
    expect([seed, ...opts.seeds]).toHaveLength(5);
    expect(await screen.findByText(/Playing AI Radio: Melody/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'See what’s next' }).getAttribute('href')).toBe('/queue');
  });

  it('free text finds seeds in the catalogue and steers the radio by the mood it names', async () => {
    search.mockImplementation(async (q: string) => (q === 'telugu melody songs' ? [makeSong('m1', { year: '1994' }), makeSong('m2', { year: '2020' })] : [makeSong('x1')]));
    mount();
    fireEvent.change(screen.getByRole('textbox', { name: 'Describe your radio' }), { target: { value: 'Telugu 90s melodies' } });
    fireEvent.click(screen.getByRole('button', { name: 'Start radio' }));
    await waitFor(() => expect(startRadio).toHaveBeenCalledOnce());
    const [seed, opts] = startRadio.mock.calls[0] as [Song, { seeds: Song[]; tune: string }];
    expect(seed.id).toBe('m1'); // the 90s song opens
    expect(opts.tune).toBe('melody');
    expect(generatePlaylist).not.toHaveBeenCalled();
  });

  it('asks VinaX AI only when the catalogue finds too little, and says so when nothing works', async () => {
    mount();
    fireEvent.change(screen.getByRole('textbox', { name: 'Describe your radio' }), { target: { value: 'rainy evening drive' } });
    fireEvent.click(screen.getByRole('button', { name: 'Start radio' }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toMatch(/Couldn’t find songs for “rainy evening drive”/);
    expect(generatePlaylist).toHaveBeenCalledOnce();
    expect(startRadio).not.toHaveBeenCalled();
  });

  it('a recent song starts radio from that song', () => {
    const recent = makeSong('r1', { title: 'Recent one' });
    useHistoryStore.setState({ entries: [{ song: recent, ts: Date.now() } as never] });
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Start AI Radio from Recent one' }));
    expect(startRadio).toHaveBeenCalledWith(recent);
    expect(screen.getByText(/Playing AI Radio: Recent one/)).toBeTruthy();
  });

  it('an artist starts radio from songs credited to them', async () => {
    const byThem = makeSong('a1', { artist: 'Sid Sriram' });
    useHistoryStore.setState({ entries: [{ song: byThem, ts: Date.now() } as never] });
    search.mockResolvedValue([makeSong('other', { artist: 'Someone' }), byThem, makeSong('a2', { artist: 'Sid Sriram' })]);
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Start AI Radio from Sid Sriram' }));
    await waitFor(() => expect(startRadio).toHaveBeenCalledOnce());
    const [seed, opts] = startRadio.mock.calls[0] as [Song, { seeds: Song[] }];
    expect([seed, ...opts.seeds].map((s) => s.id).sort()).toEqual(['a1', 'a2']);
  });
});
