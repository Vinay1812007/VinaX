// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ensureDictionary, initI18n, loadedDictionaries, tr, translate, UI_LANGS } from './i18n';
import { pickSettings, useSettingsStore } from './store/settingsStore';
import { TUNE_OPTIONS } from './services/recommendation/tune';
import { MOODS } from './constants/seeds';
import { SONG_SORT_LABELS } from './features/search/sortSongs';
import TE from './i18n/te';
import HI from './i18n/hi';
import TA from './i18n/ta';
import KN from './i18n/kn';
import ML from './i18n/ml';

describe('1.12 — app language', () => {
  it('English is the key; an unknown string stays English in every language', () => {
    expect(translate('Home', 'en')).toBe('Home');
    expect(translate('Home', 'te')).toBe('హోమ్');
    expect(translate('Something new', 'hi')).toBe('Something new');
    expect(UI_LANGS.map((l) => l.id)).toEqual(['en', 'te', 'hi', 'ta', 'kn', 'ml']);
    // The picker shows each language in its own script.
    expect(UI_LANGS.find((l) => l.id === 'kn')?.label).toBe('ಕನ್ನಡ');
    expect(UI_LANGS.find((l) => l.id === 'ml')?.label).toBe('മലയാളം');
    expect(translate('Home', 'kn')).toBe('ಮುಖಪುಟ');
    expect(translate('Settings', 'ml')).toBe('ക്രമീകരണങ്ങൾ');
  });

  it('the five extended dictionaries cover the same strings, none empty', () => {
    const keys = Object.keys(TE).sort();
    expect(Object.keys(HI).sort()).toEqual(keys);
    expect(Object.keys(TA).sort()).toEqual(keys);
    expect(Object.keys(KN).sort()).toEqual(keys);
    expect(Object.keys(ML).sort()).toEqual(keys);
    expect(keys.length).toBeGreaterThan(100);
    for (const d of [TE, HI, TA, KN, ML]) for (const [k, v] of Object.entries(d)) expect(v.trim(), k).not.toBe('');
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

  it('Kannada and Malayalam load their own dictionaries and keep the first-load words', async () => {
    expect(translate('Play next', 'kn')).toBe('Play next');
    await Promise.all([ensureDictionary('kn'), ensureDictionary('ml')]);
    expect(translate('Play next', 'kn')).toBe(KN['Play next']);
    expect(translate('Play next', 'ml')).toBe(ML['Play next']);
    expect(translate('Sleeping in {n} min', 'ml', { n: 5 })).toBe(ML['Sleeping in {n} min'].replace('{n}', '5'));
    expect(translate('Library', 'kn')).toBe('ಲೈಬ್ರರಿ');
  });

  it('the page language follows the app language, Kannada and Malayalam included', () => {
    useSettingsStore.setState({ uiLanguage: 'en' });
    initI18n();
    expect(document.documentElement.lang).toBe('en');
    useSettingsStore.setState({ uiLanguage: 'kn' });
    expect(document.documentElement.lang).toBe('kn');
    useSettingsStore.setState({ uiLanguage: 'ml' });
    expect(document.documentElement.lang).toBe('ml');
    useSettingsStore.setState({ uiLanguage: 'en' });
    expect(document.documentElement.lang).toBe('en');
  });

  it('a stored or restored Kannada or Malayalam choice is kept, an unknown one is dropped', () => {
    expect(pickSettings({ uiLanguage: 'kn' }).uiLanguage).toBe('kn');
    expect(pickSettings({ uiLanguage: 'ml' }).uiLanguage).toBe('ml');
    expect(pickSettings({ uiLanguage: 'xx' }).uiLanguage).toBeUndefined();
  });
});

/** The listener-facing screens that read their words through `useT` / `tr`. */
const WRAPPED = [
  'components/PlayerBar.tsx',
  'components/States.tsx',
  'components/OnboardingSheet.tsx',
  'components/auth/CodeAndPasswordForm.tsx',
  'components/auth/PasswordField.tsx',
  'pages/auth/AuthShell.tsx',
  'pages/auth/LoginPage.tsx',
  'pages/auth/SignupPage.tsx',
  'pages/auth/ForgotPasswordPage.tsx',
  'pages/NowPlayingPage.tsx',
  'pages/SearchPage.tsx',
  'features/search/RecentSearches.tsx',
  'features/search/resultCount.ts',
  'services/auth/email.ts',
  'store/playerStore.ts',
];

/** Every plain `t('…')`, `tx('…')` and `tr('…')` key in a source file. */
function literalKeys(file: string): string[] {
  const src = readFileSync(resolve(__dirname, file), 'utf8');
  return [...src.matchAll(/(?<![\w.])(?:t|tx|tr)\('((?:[^'\\]|\\.)*)'/g)].map((m) => m[1].replace(/\\(.)/g, '$1'));
}

const slots = (s: string): string[] => (s.match(/\{\w+\}/g) ?? []).sort();

describe('1.16 — more than the menus', () => {
  afterEach(() => useSettingsStore.setState({ uiLanguage: 'en' }));

  it('fills {name} slots, in English and in a translation, and leaves an unknown slot as written', async () => {
    expect(translate('Sleeping in {n} min', 'en', { n: 5 })).toBe('Sleeping in 5 min');
    expect(translate('Casting to {device}', 'en', {})).toBe('Casting to {device}');
    await ensureDictionary('te');
    expect(translate('Sleeping in {n} min', 'te', { n: 5 })).toBe('5 నిమి.లో ఆగుతుంది');
    expect(translate('A key nobody wrote {n}', 'hi', { n: 2 })).toBe('A key nobody wrote 2');
  });

  it('tr() reads the app language at the moment it is called (stores and toasts)', async () => {
    await ensureDictionary('hi');
    expect(tr('Added to queue')).toBe('Added to queue');
    useSettingsStore.setState({ uiLanguage: 'hi' });
    expect(tr('Added to queue')).toBe('क़तार में जोड़ा');
    expect(tr('Added {n} songs to queue', { n: 3 })).toBe('3 गाने क़तार में जोड़े गए');
  });

  it('every key the player, Now Playing, Search, the welcome, sign-in and snackbars ask for is in all five dictionaries', () => {
    const missing: string[] = [];
    for (const file of WRAPPED) {
      const keys = literalKeys(file);
      expect(keys.length, file).toBeGreaterThan(0);
      for (const key of keys) {
        for (const [lang, d] of [['te', TE], ['hi', HI], ['ta', TA], ['kn', KN], ['ml', ML]] as const) {
          if (!(key in d) && translate(key, lang) === key) missing.push(`${lang} ${file}: ${key}`);
        }
      }
    }
    expect(missing).toEqual([]);
    // Keys built at run time (labels from lists, tabs, the repeat mode, toasts from stores).
    const built = [
      'Repeat: off', 'Repeat: all', 'Repeat: one', 'See all songs', 'See all podcasts', 'All', 'Artists', 'Playlists',
      'Sign in to VinaX', 'Create your VinaX account', 'Set a new password', 'Up next', 'Credits', 'Together', 'Singer',
      'More chill', 'Surprise me', 'Road Trip', 'Relevance', 'After hours', 'No matching songs yet', 'Four places to go',
      'Nothing playing', 'Queue is empty', 'No liked songs yet', 'Added to Liked songs', 'Link copied', 'Added 1 song to queue', 'View',
    ];
    for (const d of [TE, HI, TA, KN, ML]) for (const k of built) expect(d[k], k).toBeTruthy();
  });

  it('the lists the wrapped screens translate at run time are all in the dictionaries', () => {
    const built = [
      ...TUNE_OPTIONS.map((o) => o.label),
      ...MOODS.map((m) => m.label),
      // 'A→Z' reads the same in every language.
      ...Object.values(SONG_SORT_LABELS).filter((l) => l !== 'A→Z'),
      // Search tabs and their "See all …" links; the empty tab states.
      'All', ...['Songs', 'Albums', 'Artists', 'Playlists', 'Podcasts'].flatMap((tab) => [tab, `See all ${tab.toLowerCase()}`]),
      ...['songs', 'albums', 'artists', 'playlists', 'podcasts'].map((noun) => `No matching ${noun} yet`),
      'Try another name or spelling — or look under a different tab.',
      'Try clearing a refinement, switching languages, or loading more songs.',
      'Try another title, artist, or spelling.',
      'Podcasts are matched by show name. Try a shorter name, or browse every show.',
      'No song has those words — try a longer line.',
      'The lyrics service matches whole phrases best — a full line beats a couple of words.',
      'No results',
      // Search section titles and their lines (SectionHeader translates both).
      'Trending searches', 'What listeners look for now', 'Try searching',
      'A lyric line, an artist and a film, or a mood in your language', 'From your artists', 'The artists you play most',
      'Moods and moments', 'Browse all', 'Trending now', 'Top result', 'Songs with those words', 'Recent searches',
      // Search moments.
      'After hours', 'Slow down. Tune in.', 'The golden years', 'Forever on repeat.', 'Full volume',
      'Find your second wind.', 'Heart on sleeve', 'For all the feelings.',
      // Now Playing tabs, credit roles, the empty stage.
      'Up next', 'Lyrics', 'Credits', 'Together', 'Music', 'Singer', 'Artist', 'Podcast', 'Film',
      'Nothing playing', 'Pick a song and it will take the stage here.',
      // Auth page titles and ledes come in as props.
      'Sign in to VinaX', 'Create your VinaX account', 'Set a new password',
      'Forgot it, or signed up with Google and never set one? We’ll email you a code.',
      // Shared states' defaults.
      'Couldn’t reach the music servers', 'Check your connection and try again.', 'Retry',
      'Couldn’t load {what}.', 'Couldn’t load this section.',
      // Toasts made as plain literals in the player and the Now Playing / Tune paths.
      'Added 1 song to queue', 'Cleared 1 upcoming song', 'Cleared 1 played song', 'Surprise coming up ✦',
      'Up next ran out of songs for this session — pick something or start a radio', 'Undo', 'View',
    ];
    const missing: string[] = [];
    for (const [lang, d] of [['te', TE], ['hi', HI], ['ta', TA], ['kn', KN], ['ml', ML]] as const) {
      for (const k of built) if (!d[k] && translate(k, lang) === k) missing.push(`${lang}: ${k}`);
    }
    expect(missing).toEqual([]);
  });

  it('a translation keeps exactly the slots of its English key', () => {
    for (const d of [TE, HI, TA, KN, ML]) for (const [k, v] of Object.entries(d)) expect(slots(v), k).toEqual(slots(k));
  });
});
