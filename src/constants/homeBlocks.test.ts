/**
 * Pins the Home builder contracts (4.16.0):
 *  - orderHomeBlocks merges a saved partial/stale order with the canonical
 *    default (unknown keys dropped, missing keys appended in place),
 *  - the store's move/toggle/reset actions behave and persist coherently.
 */
import { describe, expect, it } from 'vitest';
import { HOME_BLOCKS, HOME_BLOCK_KEYS, orderHomeBlocks } from './homeBlocks';
import { useSettingsStore } from '@/store/settingsStore';
import { moveHomeBlock, resetHomeLayout, toggleHomeBlock } from '@/features/settings/homeLayout';

describe('orderHomeBlocks', () => {
  it('returns the default order for an empty saved order', () => {
    expect(orderHomeBlocks([])).toStrictEqual([...HOME_BLOCK_KEYS]);
  });
  it('keeps saved keys first and appends the rest in default order', () => {
    const out = orderHomeBlocks(['feed', 'charts']);
    expect(out[0]).toBe('feed');
    expect(out[1]).toBe('charts');
    expect(out.length).toBe(HOME_BLOCK_KEYS.length);
    expect(new Set(out)).toStrictEqual(new Set(HOME_BLOCK_KEYS));
  });
  it('drops unknown/retired keys from a stale saved order', () => {
    const out = orderHomeBlocks(['retired-block', 'moods']);
    expect(out).not.toContain('retired-block');
    expect(out[0]).toBe('moods');
  });
  it('every block has a label and hint for the Settings UI', () => {
    for (const b of HOME_BLOCKS) {
      expect(b.label.length).toBeGreaterThan(0);
      expect(b.hint.length).toBeGreaterThan(0);
    }
  });
});

describe('settingsStore home builder actions', () => {
  it('toggleHomeBlock hides then unhides', () => {
    toggleHomeBlock('moods');
    expect(useSettingsStore.getState().hiddenHome).toContain('moods');
    toggleHomeBlock('moods');
    expect(useSettingsStore.getState().hiddenHome).not.toContain('moods');
  });
  it('moveHomeBlock swaps neighbours and clamps at the edges', () => {
    resetHomeLayout();
    moveHomeBlock(HOME_BLOCK_KEYS[1], -1, HOME_BLOCK_KEYS);
    const order = useSettingsStore.getState().homeOrder;
    expect(order[0]).toBe(HOME_BLOCK_KEYS[1]);
    expect(order[1]).toBe(HOME_BLOCK_KEYS[0]);
    // clamp: moving the first item up is a no-op
    moveHomeBlock(order[0], -1, HOME_BLOCK_KEYS);
    expect(useSettingsStore.getState().homeOrder[0]).toBe(order[0]);
  });
  it('resetHomeLayout clears both fields', () => {
    toggleHomeBlock('feed');
    resetHomeLayout();
    expect(useSettingsStore.getState().hiddenHome).toStrictEqual([]);
    expect(useSettingsStore.getState().homeOrder).toStrictEqual([]);
  });
});
