import { describe, expect, it } from 'vitest';
import type { RegionInfo } from '@/types';
import { countryLabel, describeRegion, describeRegionSource, REGION_USES, resolvedAgo } from './describeRegion';

const NOW = Date.UTC(2026, 9, 3, 12, 0, 0);
const region = (over: Partial<RegionInfo> = {}): RegionInfo => ({
  country: 'IN',
  regionLabel: 'Telangana',
  city: 'Hyderabad',
  timezone: 'Asia/Kolkata',
  source: 'edge',
  resolvedAt: NOW - 120_000,
  ...over,
});

describe('describeRegion — never overstates what is known', () => {
  it('names a city only as an approximation', () => {
    const line = describeRegion(region());
    expect(line).toContain('near Hyderabad');
    // Never the bare city, which would read as "you are in Hyderabad".
    expect(line).not.toMatch(/·\s*Hyderabad/);
  });

  it('shows the country, region, city and zone it has', () => {
    expect(describeRegion(region())).toBe('India · Telangana · near Hyderabad · Asia/Kolkata');
  });

  it('says plainly when nothing is known', () => {
    expect(describeRegion(null)).toMatch(/not using any place context/i);
    expect(describeRegion(region({ country: null, timezone: null, regionLabel: null, city: null, source: 'unknown' }))).toMatch(/not using any place context/i);
  });

  it('keeps the zone when only the zone is known', () => {
    const line = describeRegion(region({ country: null, regionLabel: null, city: null, timezone: 'Europe/London', source: 'browser' }));
    expect(line).toContain('Europe/London');
    expect(line).toContain('Country not known');
  });

  it('falls back to the raw code for a country it has no name for', () => {
    expect(countryLabel('ZZ')).toBe('ZZ');
    expect(countryLabel(null)).toBe('unknown');
    expect(countryLabel('IN')).toBe('India');
  });
});

describe('describeRegionSource', () => {
  it('names the source so a guess is never mistaken for a setting', () => {
    expect(describeRegionSource(region({ source: 'manual' }), NOW)).toMatch(/you set this yourself/i);
    expect(describeRegionSource(region({ source: 'edge' }), NOW)).toMatch(/coarse network hint/i);
    expect(describeRegionSource(region({ source: 'browser' }), NOW)).toMatch(/device’s language and time zone/i);
    expect(describeRegionSource(region({ source: 'unknown' }), NOW)).toMatch(/nothing could be worked out/i);
  });

  it('says when it was checked', () => {
    expect(describeRegionSource(region({ resolvedAt: NOW - 30_000 }), NOW)).toContain('just now');
    expect(describeRegionSource(region({ resolvedAt: NOW - 7_200_000 }), NOW)).toContain('2 h ago');
  });

  it('says nothing about timing when there is no timestamp', () => {
    expect(describeRegionSource(region({ resolvedAt: undefined }), NOW)).not.toContain('checked');
  });
});

describe('resolvedAgo', () => {
  it('reads a timestamp in plain words, and ignores a nonsensical one', () => {
    expect(resolvedAgo(region({ resolvedAt: NOW - 1_000 }), NOW)).toBe('just now');
    expect(resolvedAgo(region({ resolvedAt: NOW - 600_000 }), NOW)).toBe('10 min ago');
    expect(resolvedAgo(region({ resolvedAt: NOW - 3 * 86_400_000 }), NOW)).toBe('3 d ago');
    // A clock that ran backwards is not a duration.
    expect(resolvedAgo(region({ resolvedAt: NOW + 60_000 }), NOW)).toBe('');
    expect(resolvedAgo(region({ resolvedAt: Number.NaN }), NOW)).toBe('');
    expect(resolvedAgo(null, NOW)).toBe('');
  });
});

describe('what the listener is told it is for', () => {
  it('states the uses, and the two things it is never used for', () => {
    expect(REGION_USES).toMatch(/charts/i);
    expect(REGION_USES).toMatch(/date and time/i);
    expect(REGION_USES).toMatch(/never used to decide your music language/i);
    expect(REGION_USES).toMatch(/IP address is never stored or sent on/i);
  });
});
