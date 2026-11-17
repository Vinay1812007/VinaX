// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { ensureDictionary, loadedDictionaries, translate, UI_LANGS } from './i18n';
import TE from './i18n/te';
import HI from './i18n/hi';
import TA from './i18n/ta';

describe('1.12 — app language', () => {
  it('English is the key; an unknown string stays English in every language', () => {
    expect(translate('Home', 'en')).toBe('Home');
    expect(translate('Home', 'te')).toBe('హోమ్');
    expect(translate('Something new', 'hi')).toBe('Something new');
    expect(UI_LANGS.map((l) => l.id)).toEqual(['en', 'te', 'hi', 'ta']);
  });

  it('the three extended dictionaries cover the same strings, none empty', () => {
    const keys = Object.keys(TE).sort();
    expect(Object.keys(HI).sort()).toEqual(keys);
    expect(Object.keys(TA).sort()).toEqual(keys);
    expect(keys.length).toBeGreaterThan(100);
    for (const d of [TE, HI, TA]) for (const [k, v] of Object.entries(d)) expect(v.trim(), k).not.toBe('');
    // The song menu, the Settings sections and the common section titles are in.
    for (const k of ['Add to queue', 'Play next', 'Playback', 'Your data', 'Recently played', 'Show all', 'Listening calendar']) expect(keys).toContain(k);
  });

  it('extended strings arrive once the dictionary is fetched, and keep the first-load words', async () => {
    expect(translate('Play next', 'ta')).toBe('Play next');
    await ensureDictionary('ta');
    expect(loadedDictionaries().ta).toBeDefined();
    expect(translate('Play next', 'ta')).toBe('அடுத்து இயக்கு');
    expect(translate('Home', 'ta')).toBe('முகப்பு');
    await ensureDictionary('en'); // nothing to fetch
  });
});
