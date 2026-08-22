/**
 * Push-notification language resolution (4.16.0) — shared by the song push
 * (per-language personalization) and mirroring the cohort logic ai-daily-push
 * pioneered in-file. Device-declared locale wins; geography infers the rest;
 * 'en' when nothing matches. Coarse and conservative by design.
 */
export interface PushLangRow {
  country?: string | null;
  region?: string | null;
  city?: string | null;
  lang?: string | null;
}

/** "hi-IN" | "te" | "en-US" → coarse two-letter primary code. */
export function primaryLang(locale: string | null | undefined): string {
  if (!locale) return 'en';
  const two = locale.toLowerCase().split(/[-_]/)[0];
  return two && two.length === 2 ? two : 'en';
}

/** Geography → language fallback for rows with no declared locale. */
export function inferLangForGeo(city?: string | null, region?: string | null, country?: string | null): string {
  const bag = `${city ?? ''} ${region ?? ''} ${country ?? ''}`.toLowerCase();
  if (/telangana|andhra|hyderabad|warangal|vijayawada|visakhapatnam|guntur|nellore|karimnagar/.test(bag)) return 'te';
  if (/tamil|chennai|madurai|coimbatore|salem|puducherry|tiruchi/.test(bag)) return 'ta';
  if (/karnataka|bengaluru|bangalore|mysore|hubli|mangalore/.test(bag)) return 'kn';
  if (/kerala|kochi|thiruvananthapuram|kozhikode|calicut|malappuram/.test(bag)) return 'ml';
  if (/maharashtra|goa|mumbai|bombay|pune|nagpur|nashik/.test(bag)) return 'mr';
  if (/west bengal|kolkata|calcutta|howrah|tripura|siliguri/.test(bag)) return 'bn';
  if (/gujarat|ahmedabad|surat|vadodara|rajkot/.test(bag)) return 'gu';
  if (/punjab|chandigarh|amritsar|ludhiana|jalandhar/.test(bag)) return 'pa';
  if (/bihar|jharkhand|patna|ranchi|dhanbad/.test(bag)) return 'bh';
  if (/kashmir|jammu|srinagar/.test(bag)) return 'ur';
  if (/odisha|orissa|bhubaneswar|cuttack/.test(bag)) return 'or';
  if (/assam|guwahati|shillong/.test(bag)) return 'as';
  if (/india|delhi|noida|gurgaon|lucknow|jaipur|kanpur|indore|bhopal/.test(bag)) return 'hi';
  return 'en';
}

/** Best language for one subscriber row: declared locale first, geo second. */
export function langForRow(row: PushLangRow): string {
  if (row.lang) return primaryLang(row.lang);
  return inferLangForGeo(row.city, row.region, row.country);
}

const LANG_NAMES: Record<string, string> = {
  te: 'Telugu', ta: 'Tamil', kn: 'Kannada', ml: 'Malayalam', mr: 'Marathi',
  bn: 'Bengali', gu: 'Gujarati', pa: 'Punjabi', bh: 'Bhojpuri', ur: 'Urdu',
  or: 'Odia', as: 'Assamese', hi: 'Hindi', en: 'English',
};
export function langName(code: string): string {
  return LANG_NAMES[code] ?? code;
}

/** Catalog search language for a coarse code ('bh' has no own catalog tag). */
const CATALOG_LANG: Record<string, string> = {
  te: 'telugu', ta: 'tamil', kn: 'kannada', ml: 'malayalam', mr: 'marathi',
  bn: 'bengali', gu: 'gujarati', pa: 'punjabi', bh: 'bhojpuri', ur: 'urdu',
  or: 'odia', as: 'assamese', hi: 'hindi', en: 'english',
};
export function catalogLang(code: string): string {
  return CATALOG_LANG[code] ?? 'hindi';
}

/** Group subscriber rows by resolved language, largest groups first. */
export function groupByLang<T extends PushLangRow>(rows: T[]): Array<{ lang: string; rows: T[] }> {
  const groups = new Map<string, T[]>();
  for (const r of rows) {
    const l = langForRow(r);
    const g = groups.get(l);
    if (g) g.push(r);
    else groups.set(l, [r]);
  }
  return [...groups.entries()]
    .map(([lang, rs]) => ({ lang, rows: rs }))
    .sort((a, b) => b.rows.length - a.rows.length);
}
