import { useCallback, useSyncExternalStore } from 'react';
import { useSettingsStore } from '@/store/settingsStore';

export type UiLang = 'en' | 'te' | 'hi' | 'ta';

export const UI_LANGS: { id: UiLang; label: string }[] = [
  { id: 'en', label: 'English' },
  { id: 'te', label: 'తెలుగు' },
  { id: 'hi', label: 'हिन्दी' },
  { id: 'ta', label: 'தமிழ்' },
];

/**
 * Translations are keyed by the English string, so untranslated keys fall
 * back to English automatically and new strings can be wrapped incrementally.
 *
 * Two layers (1.12): the sidebar's few words live here, in the first load,
 * so the menu is never English for a beat; everything else — Settings
 * titles and rows, the song menu, section and page titles — is in
 * `i18n/<lang>.ts`, fetched once the app language asks for it. Until it
 * arrives those strings show in English; `useT` re-renders when it lands.
 */
const TE: Record<string, string> = {
  Listen: 'వినండి', 'Your Music': 'మీ సంగీతం', Explore: 'అన్వేషించండి',
  Home: 'హోమ్', Discover: 'డిస్కవర్', Charts: 'చార్ట్స్', 'Made For You': 'మీ కోసం',
  'Your Week': 'మీ వారం', Search: 'వెతకండి',
  Library: 'లైబ్రరీ', Favorites: 'ఇష్టమైనవి', History: 'చరిత్ర', Queue: 'క్యూ',
  'Your VinaX': 'మీ VinaX', Downloads: 'డౌన్‌లోడ్‌లు', 'Listen Together': 'కలిసి వినండి', Following: 'అనుసరిస్తున్నవి',
  Movies: 'సినిమాలు', Languages: 'భాషలు', Moods: 'మూడ్స్',
  'Taste Profile': 'టేస్ట్ ప్రొఫైల్', Settings: 'సెట్టింగ్‌లు', 'For You': 'మీ కోసం',
  'Good morning': 'శుభోదయం', 'Good afternoon': 'శుభ మధ్యాహ్నం', 'Good evening': 'శుభ సాయంత్రం', 'Good night': 'శుభ రాత్రి',
  'App language': 'యాప్ భాష',
};

const HI: Record<string, string> = {
  Listen: 'सुनें', 'Your Music': 'आपका संगीत', Explore: 'एक्सप्लोर',
  Home: 'होम', Discover: 'खोजें', Charts: 'चार्ट', 'Made For You': 'आपके लिए',
  'Your Week': 'आपका सप्ताह', Search: 'खोज',
  Library: 'लाइब्रेरी', Favorites: 'पसंदीदा', History: 'इतिहास', Queue: 'क़तार',
  'Your VinaX': 'आपका VinaX', Downloads: 'डाउनलोड', 'Listen Together': 'साथ सुनें', Following: 'फ़ॉलो किए गए',
  Movies: 'फ़िल्में', Languages: 'भाषाएँ', Moods: 'मूड',
  'Taste Profile': 'टेस्ट प्रोफ़ाइल', Settings: 'सेटिंग्स', 'For You': 'आपके लिए',
  'Good morning': 'सुप्रभात', 'Good afternoon': 'नमस्कार', 'Good evening': 'शुभ संध्या', 'Good night': 'शुभ रात्रि',
  'App language': 'ऐप भाषा',
};

const TA: Record<string, string> = {
  Listen: 'கேளுங்கள்', 'Your Music': 'உங்கள் இசை', Explore: 'ஆராயுங்கள்',
  Home: 'முகப்பு', Discover: 'கண்டறி', Charts: 'சார்ட்ஸ்', 'Made For You': 'உங்களுக்காக',
  'Your Week': 'உங்கள் வாரம்', Search: 'தேடல்',
  Library: 'நூலகம்', Favorites: 'பிடித்தவை', History: 'வரலாறு', Queue: 'வரிசை',
  'Your VinaX': 'உங்கள் VinaX', Downloads: 'பதிவிறக்கங்கள்', 'Listen Together': 'சேர்ந்து கேளுங்கள்', Following: 'பின்தொடர்பவை',
  Movies: 'திரைப்படங்கள்', Languages: 'மொழிகள்', Moods: 'மனநிலைகள்',
  'Taste Profile': 'ரசனை சுயவிவரம்', Settings: 'அமைப்புகள்', 'For You': 'உங்களுக்காக',
  'Good morning': 'காலை வணக்கம்', 'Good afternoon': 'மதிய வணக்கம்', 'Good evening': 'மாலை வணக்கம்', 'Good night': 'இரவு வணக்கம்',
  'App language': 'பயன்பாட்டு மொழி',
};

const CORE: Record<UiLang, Record<string, string>> = { en: {}, te: TE, hi: HI, ta: TA };

/** The extended dictionaries, once fetched. */
const EXTRA: Partial<Record<UiLang, Record<string, string>>> = {};
const loading = new Set<UiLang>();
let version = 0;
const listeners = new Set<() => void>();
const bump = (): void => { version += 1; for (const l of listeners) l(); };

const LOADERS: Record<Exclude<UiLang, 'en'>, () => Promise<{ default: Record<string, string> }>> = {
  te: () => import('./i18n/te'),
  hi: () => import('./i18n/hi'),
  ta: () => import('./i18n/ta'),
};

/** Fetch a language's full dictionary (once). Resolves when it is in place. */
export function ensureDictionary(lang: UiLang): Promise<void> {
  if (lang === 'en' || EXTRA[lang] || loading.has(lang)) return Promise.resolve();
  loading.add(lang);
  return LOADERS[lang]()
    .then((m) => { EXTRA[lang] = m.default; bump(); })
    .catch(() => undefined)
    .finally(() => loading.delete(lang));
}

/** For tests: the loaded extended dictionaries. */
export const loadedDictionaries = (): Partial<Record<UiLang, Record<string, string>>> => EXTRA;

export function translate(key: string, lang: UiLang): string {
  if (lang === 'en') return key;
  return CORE[lang]?.[key] ?? EXTRA[lang]?.[key] ?? key;
}

const subscribe = (fn: () => void): (() => void) => { listeners.add(fn); return () => listeners.delete(fn); };
const getVersion = (): number => version;

/** Reactive translator bound to the user's selected app language. */
export function useT(): (key: string) => string {
  const lang = useSettingsStore((s) => s.uiLanguage);
  const v = useSyncExternalStore(subscribe, getVersion, getVersion);
  if (lang !== 'en' && !EXTRA[lang]) void ensureDictionary(lang);
  // A new callback when the language changes or a dictionary lands (the
  // version is read inside so the dependency is real).
  return useCallback((key: string) => (v >= 0 ? translate(key, lang) : key), [lang, v]);
}

/** The page's language tag (assistive tech, hyphenation, fonts) follows the app language; the dictionary is fetched early. */
export function initI18n(): void {
  const apply = (lang: UiLang): void => {
    if (typeof document !== 'undefined') document.documentElement.lang = lang;
    if (lang !== 'en') void ensureDictionary(lang);
  };
  apply(useSettingsStore.getState().uiLanguage);
  useSettingsStore.subscribe((s, prev) => { if (s.uiLanguage !== prev.uiLanguage) apply(s.uiLanguage); });
}
