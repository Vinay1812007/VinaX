// @vitest-environment jsdom
/**
 * What a persisted store accepts on rehydrate: a damaged or hand-edited
 * record must never put a wrong-typed value into live state, and once a
 * restore has frozen local writes no store may persist over it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { KEYS } from '@/constants/storage-keys';

vi.mock('@/services/native', async (importOriginal) => ({ ...(await importOriginal<object>()), isNativePlatform: () => false }));

import { useSettingsStore, pickSettings } from '@/store/settingsStore';
import { useLibraryStore } from '@/store/libraryStore';
import { useAlarmStore } from '@/store/alarmStore';
import { useLyricsOffsetStore } from '@/store/lyricsOffsetStore';
import { freezeLocalWrites, resetLocalGuardsForTests } from './local';

const put = (key: string, state: unknown, version = 0) => localStorage.setItem(key, JSON.stringify({ state, version }));

beforeEach(() => {
  localStorage.clear();
  resetLocalGuardsForTests();
});
afterEach(() => resetLocalGuardsForTests());

describe('settings merge', () => {
  it('takes known keys of the right type and leaves the rest at their current value', async () => {
    useSettingsStore.getState().resetSettings();
    put(KEYS.settings, { theme: 'light', crossfade: 'yes', crossfadeSeconds: null, eqGains: 'loud', pinnedLanguages: ['telugu', 3], setTheme: 'oops', resetSettings: 1, bogus: true, balance: 7, uiScale: 'huge' }, 4);
    await useSettingsStore.persist.rehydrate();
    const s = useSettingsStore.getState();
    expect(s.theme).toBe('light');
    expect(s.crossfade).toBe(true);
    expect(s.crossfadeSeconds).toBe(5);
    expect(s.eqGains).toEqual([0, 0, 0, 0, 0]);
    expect(s.pinnedLanguages).toEqual(['telugu']);
    expect(s.balance).toBe(1);
    expect(s.uiScale).toBe('md');
    expect(typeof s.setTheme).toBe('function');
    expect(typeof s.resetSettings).toBe('function');
    expect(s).not.toHaveProperty('bogus');
  });

  it('derives the discovery mode from the old explore switch only when the mode is missing', () => {
    expect(pickSettings({ exploreMode: true }).discoveryMode).toBe('discover');
    expect(pickSettings({ exploreMode: false }).discoveryMode).toBe('balanced');
    expect(pickSettings({ exploreMode: true, discoveryMode: 'familiar' }).discoveryMode).toBe('familiar');
    expect(pickSettings({ exploreMode: true, discoveryMode: 'everything' }).discoveryMode).toBe('discover');
    expect(pickSettings({ theme: 'dark' })).not.toHaveProperty('discoveryMode');
    expect(pickSettings(null)).toEqual({});
    expect(pickSettings({ inferredRegion: { country: 'IN', regionLabel: 5, source: 'gps' } }).inferredRegion).toEqual({ country: 'IN', regionLabel: null, source: 'unknown' });
  });
});

describe('library merge', () => {
  it('drops trash entries without a song list and non-list fields', async () => {
    const now = Date.now();
    put(KEYS.library, {
      favorites: 'nope',
      collections: [{ id: 'c1', name: 'Fine', createdAt: 1, songs: [] }, { id: 'c2', name: 'Broken', createdAt: 1, songs: null }],
      trash: [
        { collection: { id: 't1', name: 'Ok', createdAt: 1, songs: [] }, deletedAt: now - 5 },
        { collection: { id: 't2', name: 'No list', createdAt: 1 }, deletedAt: now - 5 },
        { collection: { id: 't3', name: 'String list', createdAt: 1, songs: 'x' }, deletedAt: now - 5 },
      ],
    });
    await useLibraryStore.persist.rehydrate();
    const s = useLibraryStore.getState();
    expect(s.favorites).toEqual([]);
    expect(s.collections.map((c) => c.id)).toEqual(['c1']);
    expect(s.trash.map((t) => t.collection.id)).toEqual(['t1']);
  });
});

describe('alarm and lyric offset merges', () => {
  it('reject a malformed time, non-booleans and an unknown action', async () => {
    put(KEYS.alarm, { enabled: 1, time: '7:5', action: 'sing', collectionId: 9, fadeIn: 'no', lastFired: 20260901 });
    await useAlarmStore.persist.rehydrate();
    expect(useAlarmStore.getState()).toMatchObject({ enabled: false, time: '07:00', action: 'favorites', collectionId: null, fadeIn: true, lastFired: '' });
    put(KEYS.alarm, { enabled: true, time: '05:45', action: 'resume', collectionId: null, fadeIn: false, lastFired: '2026-09-16' });
    await useAlarmStore.persist.rehydrate();
    expect(useAlarmStore.getState()).toMatchObject({ enabled: true, time: '05:45', action: 'resume', fadeIn: false, lastFired: '2026-09-16' });
  });

  it('clamp offsets to ±10 s and drop non-numbers', async () => {
    put(KEYS.lyricsOffset, { offsets: { a: 1.26, b: 99, c: -99, d: '2', e: null } });
    await useLyricsOffsetStore.persist.rehydrate();
    expect(useLyricsOffsetStore.getState().offsets).toEqual({ a: 1.3, b: 10, c: -10 });
  });
});

describe('write freeze', () => {
  it('a store set after a restore does not overwrite the restored key', () => {
    useLyricsOffsetStore.getState().nudge('s1', 1);
    const restored = JSON.stringify({ state: { offsets: { restored: 2 } }, version: 0 });
    localStorage.setItem(KEYS.lyricsOffset, restored);
    freezeLocalWrites();
    useLyricsOffsetStore.getState().nudge('s1', 1);
    useSettingsStore.getState().setTheme('amoled');
    expect(localStorage.getItem(KEYS.lyricsOffset)).toBe(restored);
  });
});
