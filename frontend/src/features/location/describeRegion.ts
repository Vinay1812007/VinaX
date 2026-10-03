import type { RegionInfo } from '@/types';

/**
 * 9.1.0 — plain words for the place context VinaX is using, for the Settings
 * row that lets a listener inspect it.
 *
 * Every line here is written so it cannot overstate what is known:
 *
 *   - a city is always "near <city>", never "<city>", because the edge's city is
 *     often the network exchange rather than the listener's town;
 *   - "could not be worked out" is said plainly rather than filled in with a guess;
 *   - the SOURCE is always named, so a listener can tell a guess from their own
 *     setting;
 *   - an IP address is never mentioned, because none is ever received.
 */
export const COUNTRY_NAMES: Record<string, string> = {
  IN: 'India',
  LK: 'Sri Lanka',
  PK: 'Pakistan',
  BD: 'Bangladesh',
  NP: 'Nepal',
  AE: 'United Arab Emirates',
  SG: 'Singapore',
  MY: 'Malaysia',
  GB: 'United Kingdom',
  US: 'United States',
  CA: 'Canada',
  AU: 'Australia',
  NZ: 'New Zealand',
  ZA: 'South Africa',
};

export const countryLabel = (code: string | null): string => (code ? (COUNTRY_NAMES[code] ?? code) : 'unknown');

const SOURCE_WORDS: Record<RegionInfo['source'], string> = {
  manual: 'you set this yourself',
  edge: 'a coarse network hint, accurate to a region at best',
  browser: 'your device’s language and time zone',
  unknown: 'nothing could be worked out',
};

/** How long ago, in words. Empty when there is no timestamp. */
export function resolvedAgo(region: RegionInfo | null, now = Date.now()): string {
  const at = region?.resolvedAt;
  if (typeof at !== 'number' || !Number.isFinite(at) || at > now) return '';
  const ms = now - at;
  if (ms < 60_000) return 'just now';
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)} min ago`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)} h ago`;
  return `${Math.floor(ms / 86_400_000)} d ago`;
}

/** One sentence naming what is known, and nothing more. */
export function describeRegion(region: RegionInfo | null): string {
  if (!region || (!region.country && !region.timezone)) return 'Not known — VinaX is not using any place context.';
  const bits: string[] = [];
  if (region.country) bits.push(countryLabel(region.country));
  if (region.regionLabel) bits.push(region.regionLabel);
  // Never "Hyderabad" — always "near Hyderabad".
  if (region.city) bits.push(`near ${region.city}`);
  const where = bits.length ? bits.join(' · ') : 'Country not known';
  const zone = region.timezone ? ` · ${region.timezone}` : '';
  return `${where}${zone}`;
}

/** The second line: where the value came from, and when. */
export function describeRegionSource(region: RegionInfo | null, now = Date.now()): string {
  if (!region) return 'Inference is off.';
  const how = SOURCE_WORDS[region.source] ?? SOURCE_WORDS.unknown;
  const ago = resolvedAgo(region, now);
  return ago ? `${how} · checked ${ago}` : how;
}

/** What this place context is actually used for — the listener should be able to see it. */
export const REGION_USES =
  'Used for local charts, the date and time in answers, festival timing and the wording of web searches. Never used to decide your music language, and your IP address is never stored or sent on.';
