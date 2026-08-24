export interface LanguageDef {
  id: string;
  label: string;
  /** BCP-47 prefixes that hint at this language. */
  locales: string[];
}

export const LANGUAGES: LanguageDef[] = [
  { id: 'hindi', label: 'Hindi', locales: ['hi'] },
  { id: 'punjabi', label: 'Punjabi', locales: ['pa'] },
  { id: 'tamil', label: 'Tamil', locales: ['ta'] },
  { id: 'telugu', label: 'Telugu', locales: ['te'] },
  { id: 'malayalam', label: 'Malayalam', locales: ['ml'] },
  { id: 'kannada', label: 'Kannada', locales: ['kn'] },
  { id: 'marathi', label: 'Marathi', locales: ['mr'] },
  { id: 'bengali', label: 'Bengali', locales: ['bn'] },
  { id: 'gujarati', label: 'Gujarati', locales: ['gu'] },
  { id: 'english', label: 'English', locales: ['en'] },
  { id: 'bhojpuri', label: 'Bhojpuri', locales: ['bho'] },
  { id: 'haryanvi', label: 'Haryanvi', locales: ['bgc'] },
  { id: 'urdu', label: 'Urdu', locales: ['ur'] },
  { id: 'odia', label: 'Odia', locales: ['or'] },
  { id: 'assamese', label: 'Assamese', locales: ['as'] },
  { id: 'rajasthani', label: 'Rajasthani', locales: ['raj'] },
  { id: 'konkani', label: 'Konkani', locales: ['kok'] },
  { id: 'maithili', label: 'Maithili', locales: ['mai'] },
  { id: 'nepali', label: 'Nepali', locales: ['ne'] },
  { id: 'sanskrit', label: 'Sanskrit', locales: ['sa'] },
  { id: 'tulu', label: 'Tulu', locales: ['tcy'] },
  { id: 'dogri', label: 'Dogri', locales: ['doi'] },
  { id: 'kashmiri', label: 'Kashmiri', locales: ['ks'] },
];

export const UNKNOWN_LANGUAGE = 'unknown';

const KNOWN = new Set(LANGUAGES.map((l) => l.id));

/** Normalize free-form upstream language metadata into our taxonomy. */
export function normalizeLanguage(raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  const v = raw.trim().toLowerCase();
  if (KNOWN.has(v)) return v;
  // common upstream variants
  if (v === 'hindustani') return 'hindi';
  if (v === 'panjabi') return 'punjabi';
  if (v === 'oriya') return 'odia';
  return UNKNOWN_LANGUAGE;
}

export function languageLabel(id: string | null): string {
  if (!id) return 'Unknown';
  const def = LANGUAGES.find((l) => l.id === id);
  return def ? def.label : 'Other';
}

/** Map browser locale list to likely preferred language ids, ordered. */
export function languagesFromLocales(locales: readonly string[]): string[] {
  const out: string[] = [];
  for (const loc of locales) {
    const prefix = loc.toLowerCase().split('-')[0];
    for (const def of LANGUAGES) {
      if (def.locales.includes(prefix) && !out.includes(def.id)) out.push(def.id);
    }
    // Indian English speakers very often also listen to Hindi.
    if (loc.toLowerCase() === 'en-in' && !out.includes('hindi')) out.push('hindi');
  }
  return out;
}

/** Languages with a dedicated SEO hub page at /<id>-songs. */
export const HUB_LANGUAGES = [
  'hindi',
  'telugu',
  'tamil',
  'english',
  'punjabi',
  'kannada',
  'malayalam',
  'bengali',
  'marathi',
  'bhojpuri',
  'gujarati',
  'urdu',
] as const;
