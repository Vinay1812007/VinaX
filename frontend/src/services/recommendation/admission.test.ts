// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeSong } from '@/__fixtures__/songs';
import { useSettingsStore } from '@/store/settingsStore';
import { useLibraryStore } from '@/store/libraryStore';
import { useHistoryStore } from '@/store/historyStore';
import { admitSongs } from './admission';
import { initHeardSet, memoryBackend, recordHeard, resetHeardSetForTests } from './heardSet';

const playing = makeSong('now', { title: 'Now Playing', artist: 'Z' });
const heard = makeSong('old', { title: 'Old Favourite', artist: 'A' });
const remaster = makeSong('old-r', { title: 'Old Favourite (Remastered 2024)', artist: 'A' });
const fresh = makeSong('new', { title: 'Brand New', artist: 'B' });

beforeEach(async () => {
  localStorage.clear();
  resetHeardSetForTests();
  useLibraryStore.setState({ favorites: [], hiddenSongIds: [], hiddenArtists: [] });
  useHistoryStore.setState({ entries: [] });
  useSettingsStore.setState({ kidMode: false, mutedLanguages: [], neverRepeat: false });
  await initHeardSet({ backend: memoryBackend(), backfill: null, listen: false });
  recordHeard(heard);
});
afterEach(() => resetHeardSetForTests());

describe('the admission gate under Never repeat', () => {
  it('turns away every version of a heard song from an automatic change', () => {
    useSettingsStore.setState({ neverRepeat: true });
    const out = admitSongs([heard, remaster, fresh], { queue: [playing], index: 0 });
    expect(out.admitted.map((s) => s.id)).toEqual(['new']);
    expect(out.rejected.map((r) => r.reason)).toEqual(['heard-before', 'heard-before']);
  });

  it('never blocks a plan the listener installs on purpose', () => {
    useSettingsStore.setState({ neverRepeat: true });
    const out = admitSongs([heard, fresh], { queue: [playing], index: 0, mode: 'plan' });
    expect(out.admitted.map((s) => s.id)).toEqual(['old', 'new']);
  });

  it('does nothing while the mode is off', () => {
    const out = admitSongs([heard, fresh], { queue: [playing], index: 0 });
    expect(out.admitted.map((s) => s.id)).toEqual(['old', 'new']);
  });
});
