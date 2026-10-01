/**
 * Each hub language's name in its own script, with the BCP-47 tag that lets
 * the browser pick the right font and shaping (and a screen reader the right
 * voice). Urdu reads right to left.
 */
export interface NativeName {
  text: string;
  lang: string;
  dir?: 'rtl';
}

export const NATIVE_NAMES: Record<string, NativeName> = {
  telugu: { text: 'తెలుగు', lang: 'te' },
  hindi: { text: 'हिन्दी', lang: 'hi' },
  tamil: { text: 'தமிழ்', lang: 'ta' },
  malayalam: { text: 'മലയാളം', lang: 'ml' },
  kannada: { text: 'ಕನ್ನಡ', lang: 'kn' },
  punjabi: { text: 'ਪੰਜਾਬੀ', lang: 'pa' },
  bengali: { text: 'বাংলা', lang: 'bn' },
  marathi: { text: 'मराठी', lang: 'mr' },
  gujarati: { text: 'ગુજરાતી', lang: 'gu' },
  urdu: { text: 'اردو', lang: 'ur', dir: 'rtl' },
  bhojpuri: { text: 'भोजपुरी', lang: 'bho' },
  english: { text: 'English', lang: 'en' },
};

/** A first syllable from three scripts, for the Languages tile's corner. */
export const SCRIPT_SAMPLES: NativeName[] = [
  { text: 'తె', lang: 'te' },
  { text: 'हि', lang: 'hi' },
  { text: 'த', lang: 'ta' },
];
