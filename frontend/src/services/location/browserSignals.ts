import type { RegionInfo } from '@/types';
import { languagesFromLocales } from '@/constants/languages';

/** Timezone → coarse country hints. Only well-known unambiguous zones. */
const TZ_COUNTRY: Record<string, string> = {
  'Asia/Kolkata': 'IN',
  'Asia/Calcutta': 'IN',
  'Asia/Karachi': 'PK',
  'Asia/Dhaka': 'BD',
  'Asia/Kathmandu': 'NP',
  'Asia/Dubai': 'AE',
  'Asia/Singapore': 'SG',
  'Europe/London': 'GB',
  'Australia/Sydney': 'AU',
};

export interface BrowserSignals {
  country: string | null;
  languages: string[];
  timezone: string | null;
}

/**
 * Privacy note: this reads only what the browser already exposes to every
 * website (locale list + timezone). Nothing here touches IP addresses.
 */
export function readBrowserSignals(): BrowserSignals {
  const locales = navigator.languages?.length ? navigator.languages : [navigator.language ?? 'en'];
  let timezone: string | null = null;
  let country: string | null = null;
  try {
    timezone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? null;
  } catch {
    /* ignore */
  }
  if (timezone && TZ_COUNTRY[timezone]) country = TZ_COUNTRY[timezone];
  if (!country) {
    for (const loc of locales) {
      const parts = loc.split('-');
      if (parts.length > 1 && parts[1].length === 2) {
        country = parts[1].toUpperCase();
        break;
      }
    }
  }
  return { country, languages: languagesFromLocales(locales), timezone };
}

export function browserRegionInfo(): RegionInfo {
  const s = readBrowserSignals();
  return { country: s.country, regionLabel: null, source: s.country ? 'browser' : 'unknown' };
}
