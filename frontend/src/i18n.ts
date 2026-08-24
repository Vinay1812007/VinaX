import { useCallback } from 'react';
import { useSettingsStore } from '@/store/settingsStore';

export type UiLang = 'en' | 'te' | 'hi' | 'ta';

export const UI_LANGS: { id: UiLang; label: string }[] = [
  { id: 'en', label: 'English' },
  { id: 'te', label: 'తెలుగు' },
  { id: 'hi', label: 'हिन्दी' },
  { id: 'ta', label: 'தமிழ்' },
];

// Translations are keyed by the English string, so untranslated keys fall back
// to English automatically and new strings can be wrapped incrementally.
const TE: Record<string, string> = {
  Listen: 'వినండి', 'Your Music': 'మీ సంగీతం', Explore: 'అన్వేషించండి',
  Home: 'హోమ్', Discover: 'డిస్కవర్', Charts: 'చార్ట్స్', 'Made For You': 'మీ కోసం',
  'Your Week': 'మీ వారం', 'AI Playlist': 'AI ప్లేలిస్ట్', Search: 'వెతకండి',
  Library: 'లైబ్రరీ', Favorites: 'ఇష్టమైనవి', History: 'చరిత్ర', Queue: 'క్యూ',
  'Your VinaX': 'మీ VinaX', Downloads: 'డౌన్‌లోడ్‌లు', 'Listen Together': 'కలిసి వినండి',
  Movies: 'సినిమాలు', Languages: 'భాషలు', Moods: 'మూడ్స్', Regions: 'ప్రాంతాలు',
  'Taste Profile': 'టేస్ట్ ప్రొఫైల్', Settings: 'సెట్టింగ్‌లు', 'For You': 'మీ కోసం',
  'Good morning': 'శుభోదయం', 'Good afternoon': 'శుభ మధ్యాహ్నం', 'Good evening': 'శుభ సాయంత్రం', 'Good night': 'శుభ రాత్రి',
  'App language': 'యాప్ భాష',
};

const HI: Record<string, string> = {
  Listen: 'सुनें', 'Your Music': 'आपका संगीत', Explore: 'एक्सप्लोर',
  Home: 'होम', Discover: 'खोजें', Charts: 'चार्ट', 'Made For You': 'आपके लिए',
  'Your Week': 'आपका सप्ताह', 'AI Playlist': 'AI प्लेलिस्ट', Search: 'खोज',
  Library: 'लाइब्रेरी', Favorites: 'पसंदीदा', History: 'इतिहास', Queue: 'क़तार',
  'Your VinaX': 'आपका VinaX', Downloads: 'डाउनलोड', 'Listen Together': 'साथ सुनें',
  Movies: 'फ़िल्में', Languages: 'भाषाएँ', Moods: 'मूड', Regions: 'क्षेत्र',
  'Taste Profile': 'टेस्ट प्रोफ़ाइल', Settings: 'सेटिंग्स', 'For You': 'आपके लिए',
  'Good morning': 'सुप्रभात', 'Good afternoon': 'नमस्कार', 'Good evening': 'शुभ संध्या', 'Good night': 'शुभ रात्रि',
  'App language': 'ऐप भाषा',
};

const TA: Record<string, string> = {
  Listen: 'கேளுங்கள்', 'Your Music': 'உங்கள் இசை', Explore: 'ஆராயுங்கள்',
  Home: 'முகப்பு', Discover: 'கண்டறி', Charts: 'சார்ட்ஸ்', 'Made For You': 'உங்களுக்காக',
  'Your Week': 'உங்கள் வாரம்', 'AI Playlist': 'AI பிளேலிஸ்ட்', Search: 'தேடல்',
  Library: 'நூலகம்', Favorites: 'பிடித்தவை', History: 'வரலாறு', Queue: 'வரிசை',
  'Your VinaX': 'உங்கள் VinaX', Downloads: 'பதிவிறக்கங்கள்', 'Listen Together': 'சேர்ந்து கேளுங்கள்',
  Movies: 'திரைப்படங்கள்', Languages: 'மொழிகள்', Moods: 'மனநிலைகள்', Regions: 'பகுதிகள்',
  'Taste Profile': 'ரசனை சுயவிவரம்', Settings: 'அமைப்புகள்', 'For You': 'உங்களுக்காக',
  'Good morning': 'காலை வணக்கம்', 'Good afternoon': 'மதிய வணக்கம்', 'Good evening': 'மாலை வணக்கம்', 'Good night': 'இரவு வணக்கம்',
  'App language': 'பயன்பாட்டு மொழி',
};

const DICT: Record<UiLang, Record<string, string>> = { en: {}, te: TE, hi: HI, ta: TA };

export function translate(key: string, lang: UiLang): string {
  if (lang === 'en') return key;
  return DICT[lang]?.[key] ?? key;
}

/** Reactive translator bound to the user's selected app language. */
export function useT(): (key: string) => string {
  const lang = useSettingsStore((s) => s.uiLanguage);
  return useCallback((key: string) => translate(key, lang), [lang]);
}
