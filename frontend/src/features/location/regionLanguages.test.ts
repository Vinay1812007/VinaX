import { describe, expect, it } from 'vitest';
import { regionLanguages } from './regionLanguages';

describe('regionLanguages', () => {
  it('is empty when the country is unknown', () => {
    expect(regionLanguages(null)).toEqual([]);
    expect(regionLanguages(undefined, 'South India')).toEqual([]);
  });

  it('lists every Indian region’s languages once, north first by default', () => {
    const langs = regionLanguages('IN');
    expect(langs.slice(0, 4)).toEqual(['hindi', 'punjabi', 'haryanvi', 'urdu']);
    expect(langs).toContain('telugu');
    expect(langs).toContain('english');
    expect(new Set(langs).size).toBe(langs.length);
  });

  it('puts the listener’s own region first', () => {
    expect(regionLanguages('IN', 'South India').slice(0, 4)).toEqual(['tamil', 'telugu', 'malayalam', 'kannada']);
  });

  it('maps the state the edge reports onto its region, led by its own language', () => {
    expect(regionLanguages('IN', 'Telangana').slice(0, 4)).toEqual(['telugu', 'tamil', 'malayalam', 'kannada']);
    expect(regionLanguages('IN', 'maharashtra').slice(0, 3)).toEqual(['marathi', 'gujarati', 'hindi']);
    expect(regionLanguages('IN', 'Odisha').slice(0, 3)).toEqual(['odia', 'bengali', 'bhojpuri']);
    // A state VinaX does not know keeps the default order.
    expect(regionLanguages('IN', 'Atlantis')).toEqual(regionLanguages('IN'));
    // State names only mean something inside India.
    expect(regionLanguages('US', 'Telangana')).toEqual(['english', 'hindi']);
  });

  it('falls back to the global languages outside the mapped countries', () => {
    expect(regionLanguages('US')).toEqual(['english', 'hindi']);
    expect(regionLanguages('US', 'South India')).toEqual(['english', 'hindi']);
  });
});
