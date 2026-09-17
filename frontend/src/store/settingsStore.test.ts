// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { KEYS } from '@/constants/storage-keys';
import { resolveDiscoveryMode, useSettingsStore } from './settingsStore';

it('migrates retired queue and Home controls while preserving listener preferences', async () => {
  localStorage.setItem('vinax.home.shown.v1', '[]');
  localStorage.setItem('vinax.aihome.recent.v1', '[]');
  localStorage.setItem(KEYS.settings, JSON.stringify({
    version: 2,
    state: { theme: 'light', pinnedLanguages: ['telugu'], autoqueueSimilar: true, hiddenHome: ['personal'], homeOrder: ['feed'] },
  }));
  await useSettingsStore.persist.rehydrate();
  const saved = JSON.parse(localStorage.getItem(KEYS.settings) ?? '{}');
  expect(saved.version).toBe(4);
  expect(localStorage.getItem('vinax.home.shown.v1')).toBeNull();
  expect(localStorage.getItem('vinax.aihome.recent.v1')).toBeNull();
  expect(saved.state).toMatchObject({ theme: 'light', pinnedLanguages: ['telugu'] });
  for (const key of ['autoqueueSimilar', 'hiddenHome', 'homeOrder']) {
    expect(saved.state).not.toHaveProperty(key);
    expect(useSettingsStore.getState()).not.toHaveProperty(key);
  }
});

it('turns the old explore switch into the three-way discovery mode, and keeps the two in step', async () => {
  localStorage.setItem(KEYS.settings, JSON.stringify({ version: 3, state: { exploreMode: true } }));
  await useSettingsStore.persist.rehydrate();
  expect(useSettingsStore.getState().discoveryMode).toBe('discover');
  localStorage.setItem(KEYS.settings, JSON.stringify({ version: 3, state: { exploreMode: false } }));
  await useSettingsStore.persist.rehydrate();
  expect(useSettingsStore.getState().discoveryMode).toBe('balanced');
  useSettingsStore.getState().setDiscoveryMode('familiar');
  expect(useSettingsStore.getState()).toMatchObject({ discoveryMode: 'familiar', exploreMode: false });
  useSettingsStore.getState().setDiscoveryMode('discover');
  expect(useSettingsStore.getState().exploreMode).toBe(true);
  useSettingsStore.getState().setExploreMode(false);
  expect(useSettingsStore.getState().discoveryMode).toBe('balanced');
  expect(resolveDiscoveryMode({ exploreMode: true })).toBe('discover');
  expect(resolveDiscoveryMode({ discoveryMode: 'nonsense', exploreMode: false })).toBe('balanced');
});
