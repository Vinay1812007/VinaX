// @vitest-environment jsdom
/** One-tap destructive actions: undoable clears and the confirmed profile erase. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Song } from '@/types';

vi.mock('@/services/native', async (importOriginal) => ({ ...(await importOriginal<object>()), isNativePlatform: () => false }));
vi.mock('@/services/ai/recommendations', () => ({ requestCurator: async () => null }));
vi.mock('@/services/ai/taste', () => ({ buildTasteSnapshot: () => ({}) }));

import { useHistoryStore } from '@/store/historyStore';
import { useLibraryStore } from '@/store/libraryStore';
import { useToastStore } from '@/store/toastStore';
import { KEYS } from '@/constants/storage-keys';
import { clearFavoritesWithUndo, clearHistoryWithUndo, confirmClearPersonalization } from './actions';

const song = (id: string): Song => ({
  kind: 'song', id, title: id, subtitle: 'A', artists: [], album: null, images: [], audio: [], duration: 200,
  language: null, year: null, explicit: false, hasLyrics: false, playCount: null,
});
const lastToast = () => useToastStore.getState().toasts.slice(-1)[0];

beforeEach(() => {
  localStorage.clear();
  useToastStore.setState({ toasts: [] });
  useHistoryStore.setState({ entries: [] });
  useLibraryStore.getState().clearFavorites();
});
afterEach(() => vi.restoreAllMocks());

describe('clearHistoryWithUndo', () => {
  it('clears, offers Undo, and Undo keeps a play that arrived in between', () => {
    useHistoryStore.setState({ entries: [{ song: song('b'), ts: 200, completed: true, listenedSec: 180 }, { song: song('a'), ts: 100, completed: false }] });
    clearHistoryWithUndo();
    expect(useHistoryStore.getState().entries).toEqual([]);
    expect(lastToast()?.message).toBe('Cleared 2 plays');
    useHistoryStore.setState({ entries: [{ song: song('c'), ts: 300, completed: false }] });
    lastToast()?.action?.onClick();
    expect(useHistoryStore.getState().entries.map((e) => e.song.id)).toEqual(['c', 'b', 'a']);
    expect(useHistoryStore.getState().entries[1].listenedSec).toBe(180);
  });

  it('says so when there is nothing to clear', () => {
    clearHistoryWithUndo();
    expect(lastToast()).toMatchObject({ message: 'History is already empty' });
    expect(lastToast()?.action).toBeUndefined();
  });
});

describe('clearFavoritesWithUndo', () => {
  it('Undo restores the list AND the isFavorite index', async () => {
    useLibraryStore.setState({ favorites: [song('f1'), song('f2')] });
    clearFavoritesWithUndo();
    expect(useLibraryStore.getState().favorites).toEqual([]);
    expect(lastToast()?.message).toBe('Cleared 2 favorites');
    lastToast()?.action?.onClick();
    await Promise.resolve();
    const s = useLibraryStore.getState();
    expect(s.favorites.map((x) => x.id)).toEqual(['f1', 'f2']);
    expect(s.isFavorite('f1')).toBe(true);
    expect(s.isFavorite('f2')).toBe(true);
    expect((JSON.parse(localStorage.getItem(KEYS.library) ?? '{}') as { state: { favorites: Song[] } }).state.favorites).toHaveLength(2);
  });
});

describe('confirmClearPersonalization', () => {
  it('does nothing when the listener cancels', async () => {
    localStorage.setItem(KEYS.profile, '{"version":1}');
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    await confirmClearPersonalization();
    expect(localStorage.getItem(KEYS.profile)).toBe('{"version":1}');
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    await confirmClearPersonalization();
    expect(localStorage.getItem(KEYS.profile)).toBeNull();
  });
});
