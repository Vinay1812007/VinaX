import { regionsForCountry } from '@/constants/regions';
import { LANGUAGES } from '@/constants/languages';

/**
 * Indian states and territories as the edge names them (Cloudflare's
 * `region`), each with its part of the country and, when it has one, its own
 * language. Settings' Region override uses the region names ("South India");
 * the edge sends a state ("Telangana"), so both have to land on a region.
 */
const IN_STATES: Record<string, [regionId: string, lead?: string]> = {
  'andhra pradesh': ['in-south', 'telugu'],
  telangana: ['in-south', 'telugu'],
  'tamil nadu': ['in-south', 'tamil'],
  puducherry: ['in-south', 'tamil'],
  kerala: ['in-south', 'malayalam'],
  lakshadweep: ['in-south', 'malayalam'],
  karnataka: ['in-south', 'kannada'],
  maharashtra: ['in-west', 'marathi'],
  goa: ['in-west', 'konkani'],
  gujarat: ['in-west', 'gujarati'],
  'dadra and nagar haveli and daman and diu': ['in-west', 'gujarati'],
  'west bengal': ['in-east', 'bengali'],
  tripura: ['in-east', 'bengali'],
  bihar: ['in-east', 'bhojpuri'],
  jharkhand: ['in-east'],
  odisha: ['in-east', 'odia'],
  assam: ['in-east', 'assamese'],
  sikkim: ['in-east'],
  meghalaya: ['in-east'],
  manipur: ['in-east'],
  mizoram: ['in-east'],
  nagaland: ['in-east'],
  'arunachal pradesh': ['in-east'],
  'andaman and nicobar islands': ['in-east'],
  punjab: ['in-north', 'punjabi'],
  chandigarh: ['in-north', 'punjabi'],
  haryana: ['in-north', 'haryanvi'],
  delhi: ['in-north'],
  'national capital territory of delhi': ['in-north'],
  'uttar pradesh': ['in-north'],
  uttarakhand: ['in-north'],
  'himachal pradesh': ['in-north'],
  'jammu and kashmir': ['in-north', 'urdu'],
  ladakh: ['in-north'],
  rajasthan: ['in-north', 'rajasthani'],
  'madhya pradesh': ['in-north'],
  chhattisgarh: ['in-north'],
};

/**
 * The languages popular where the listener is, for Languages' "Popular in
 * your region" row (it replaced the Regions page). The listener's own region
 * (Settings › Region override, or the state the edge reports) comes first,
 * led by that state's own language; each language appears once.
 * Empty when the country is unknown: the row is then left out.
 */
export function regionLanguages(country: string | null | undefined, regionLabel?: string | null): string[] {
  if (!country) return [];
  const regions = regionsForCountry(country);
  const state = country === 'IN' && regionLabel ? IN_STATES[regionLabel.trim().toLowerCase()] : undefined;
  const own = regions.find((r) => r.label === regionLabel || r.id === state?.[0]);
  const ordered = own ? [own, ...regions.filter((r) => r !== own)] : regions;
  const known = new Set(LANGUAGES.map((l) => l.id));
  const lead = state?.[1] ? [state[1]] : [];
  return [...new Set([...lead, ...ordered.flatMap((r) => r.languages)])].filter((l) => known.has(l));
}
