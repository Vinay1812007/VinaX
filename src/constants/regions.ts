export interface RegionDef {
  id: string;
  label: string;
  country: string;
  /** Languages strongly associated with the region, ordered. */
  languages: string[];
}

export const COUNTRIES = [
  { id: 'IN', label: 'India' },
  { id: 'US', label: 'United States' },
  { id: 'GB', label: 'United Kingdom' },
  { id: 'CA', label: 'Canada' },
  { id: 'AE', label: 'United Arab Emirates' },
  { id: 'AU', label: 'Australia' },
  { id: 'NP', label: 'Nepal' },
  { id: 'BD', label: 'Bangladesh' },
  { id: 'PK', label: 'Pakistan' },
  { id: 'SG', label: 'Singapore' },
];

export const REGIONS: RegionDef[] = [
  { id: 'in-north', label: 'North India', country: 'IN', languages: ['hindi', 'punjabi', 'haryanvi', 'urdu'] },
  { id: 'in-south', label: 'South India', country: 'IN', languages: ['tamil', 'telugu', 'malayalam', 'kannada'] },
  { id: 'in-west', label: 'West India', country: 'IN', languages: ['marathi', 'gujarati', 'hindi'] },
  { id: 'in-east', label: 'East India', country: 'IN', languages: ['bengali', 'bhojpuri', 'hindi'] },
  { id: 'global', label: 'Global', country: '*', languages: ['english', 'hindi'] },
];

export function regionsForCountry(country: string | null): RegionDef[] {
  if (!country) return REGIONS;
  return REGIONS.filter((r) => r.country === country || r.country === '*');
}

export function defaultLanguagesForCountry(country: string | null): string[] {
  if (country === 'IN') return ['hindi', 'english'];
  if (country === 'PK') return ['urdu', 'punjabi', 'english'];
  if (country === 'BD') return ['bengali', 'english'];
  if (country === 'NP') return ['hindi', 'english'];
  return ['english'];
}
