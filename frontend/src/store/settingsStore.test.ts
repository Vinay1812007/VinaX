// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { KEYS } from '@/constants/storage-keys';
import { resolveDiscoveryMode, useSettingsStore, pickSettings } from './settingsStore';

it('migrates retired queue and Home controls while preserving listener preferences', async () => {
  localStorage.setItem('vinax.home.shown.v1', '[]');
  localStorage.setItem('vinax.aihome.recent.v1', '[]');
  localStorage.setItem(KEYS.settings, JSON.stringify({
    version: 2,
    state: { theme: 'light', accent: 'ocean', accentCustom: '#123456', dynamicTheme: true, pinnedLanguages: ['telugu'], crossfade: false, autoqueueSimilar: true, hiddenHome: ['personal'], homeOrder: ['feed'], aiDj: true, aiAssist: true, aiHomeShelves: true, djVoice: true },
  }));
  await useSettingsStore.persist.rehydrate();
  const saved = JSON.parse(localStorage.getItem(KEYS.settings) ?? '{}');
  expect(saved.version).toBe(6);
  expect(localStorage.getItem('vinax.home.shown.v1')).toBeNull();
  expect(localStorage.getItem('vinax.aihome.recent.v1')).toBeNull();
  expect(saved.state).toMatchObject({ pinnedLanguages: ['telugu'], crossfade: false });
  // 1.15 — one dark look: the theme, accent and dynamic theme are gone.
  for (const key of ['theme', 'accent', 'accentCustom', 'dynamicTheme', 'autoqueueSimilar', 'hiddenHome', 'homeOrder', 'aiDj', 'aiAssist', 'aiHomeShelves', 'djVoice']) {
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

it('2.0 — there is one app style: it is the default, survives a reload, and every older id opens in it', async () => {
  useSettingsStore.getState().resetSettings();
  expect(useSettingsStore.getState().template).toBe('vinax');
  useSettingsStore.getState().setTemplate('not-a-style');
  expect(useSettingsStore.getState().template).toBe('vinax');
  // A record from before 11.0 has no style: the default applies.
  localStorage.setItem(KEYS.settings, JSON.stringify({ version: 4, state: { uiScale: 'lg' } }));
  await useSettingsStore.persist.rehydrate();
  expect(useSettingsStore.getState()).toMatchObject({ uiScale: 'lg', template: 'vinax' });
  // A style stored by 15.0–1.13, or by 11.0–14.x, comes back as the one look; a damaged one is ignored.
  for (const stored of ['onyx', 'monsoon', 'pulse', 'marquee', 'constructor']) {
    localStorage.setItem(KEYS.settings, JSON.stringify({ version: 4, state: { template: stored } }));
    await useSettingsStore.persist.rehydrate();
    expect(useSettingsStore.getState().template).toBe('vinax');
  }
  expect(pickSettings({ template: 'marquee' })).toEqual({ template: 'vinax' });
  expect(pickSettings({ template: 'monsoon' })).toEqual({ template: 'vinax' });
  expect(pickSettings({ template: 'vinax' })).toEqual({ template: 'vinax' });
  expect(pickSettings({ template: 7 })).toEqual({});
  useSettingsStore.getState().resetSettings();
});
