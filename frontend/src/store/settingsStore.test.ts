// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { KEYS } from '@/constants/storage-keys';
import { resolveDiscoveryMode, useSettingsStore, pickSettings } from './settingsStore';

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

it('11.0 — the app style defaults to Aura, survives a reload, and never takes an unknown id', async () => {
  useSettingsStore.getState().resetSettings();
  expect(useSettingsStore.getState().template).toBe('aura');
  useSettingsStore.getState().setTemplate('vibe');
  expect(useSettingsStore.getState().template).toBe('vibe');
  useSettingsStore.getState().setTemplate('not-a-style');
  expect(useSettingsStore.getState().template).toBe('aura');
  // A record from before 11.0 has no style: the default applies.
  localStorage.setItem(KEYS.settings, JSON.stringify({ version: 4, state: { theme: 'light' } }));
  await useSettingsStore.persist.rehydrate();
  expect(useSettingsStore.getState()).toMatchObject({ theme: 'light', template: 'aura' });
  // A stored style comes back; a damaged one is ignored.
  localStorage.setItem(KEYS.settings, JSON.stringify({ version: 4, state: { template: 'marquee' } }));
  await useSettingsStore.persist.rehydrate();
  expect(useSettingsStore.getState().template).toBe('marquee');
  localStorage.setItem(KEYS.settings, JSON.stringify({ version: 4, state: { template: 'constructor' } }));
  await useSettingsStore.persist.rehydrate();
  expect(useSettingsStore.getState().template).toBe('marquee');
  expect(pickSettings({ template: 'sangam' })).toEqual({ template: 'sangam' });
  expect(pickSettings({ template: 7 })).toEqual({});
  useSettingsStore.getState().resetSettings();
});
