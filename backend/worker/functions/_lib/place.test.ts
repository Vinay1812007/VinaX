import { describe, expect, it } from 'vitest';
import { clockLine, placeContextLines, readCoarsePlace } from './place';

const NOW = new Date('2026-10-03T08:12:00Z');

describe('readCoarsePlace', () => {
  it('reads a well-formed place', () => {
    expect(readCoarsePlace({ country: 'in', region: 'Telangana', city: 'Hyderabad', timezone: 'Asia/Kolkata', source: 'edge' })).toEqual({
      country: 'IN',
      region: 'Telangana',
      city: 'Hyderabad',
      timezone: 'Asia/Kolkata',
      source: 'edge',
    });
  });

  it('keeps a time zone with no country (a device setting, not a place)', () => {
    expect(readCoarsePlace({ timezone: 'Europe/London' })).toMatchObject({ country: null, timezone: 'Europe/London' });
  });

  it('drops a region or city that arrives without a country', () => {
    const p = readCoarsePlace({ region: 'Somewhere', city: 'Someplace', timezone: 'UTC' })!;
    expect(p.region).toBeNull();
    expect(p.city).toBeNull();
  });

  it('answers null when there is nothing usable', () => {
    for (const junk of [null, undefined, 'IN', 42, [], {}, { country: 'nonsense' }, { timezone: '../etc' }]) {
      expect(readCoarsePlace(junk)).toBeNull();
    }
  });

  it('refuses a crafted country, zone or place name', () => {
    expect(readCoarsePlace({ country: 'IN; DROP TABLE' })).toBeNull();
    expect(readCoarsePlace({ country: 'IN', timezone: 'Asia/Kolkata; rm -rf /' })).toMatchObject({ timezone: null });
    expect(readCoarsePlace({ country: 'IN', region: '<script>alert(1)</script>', timezone: 'UTC' })!.region).toBeNull();
  });

  it('keeps nothing but the four coarse fields: an IP or coordinates cannot ride along', () => {
    const p = readCoarsePlace({ country: 'IN', timezone: 'Asia/Kolkata', ip: '203.0.113.5', lat: 17.38, lon: 78.48, address: '1 Main St' })!;
    expect(Object.keys(p).sort()).toEqual(['city', 'country', 'region', 'source', 'timezone']);
    expect(JSON.stringify(p)).not.toContain('203.0.113');
    expect(JSON.stringify(p)).not.toContain('17.38');
  });

  it('falls back to `edge` for an unknown source rather than trusting the label', () => {
    expect(readCoarsePlace({ country: 'IN', timezone: 'UTC', source: 'gps' })!.source).toBe('edge');
  });
});

describe('clockLine', () => {
  it('states the time in the given zone', () => {
    expect(clockLine('Asia/Kolkata', 'IST', NOW)).toBe('Current date & time: Saturday 3 October 2026, 1:42 pm IST.');
    expect(clockLine('Europe/London', 'local time (Europe/London)', NOW)).toContain('9:12 am local time (Europe/London)');
  });
});

describe('placeContextLines', () => {
  it('with no place, opens with the IST clock exactly as 9.0 did', () => {
    const line = placeContextLines(null, NOW);
    expect(line).toBe('Current date & time: Saturday 3 October 2026, 1:42 pm IST.');
    expect(line).not.toMatch(/LISTENER PLACE/);
  });

  it('uses the listener’s own zone when they have one', () => {
    const line = placeContextLines({ country: 'GB', region: null, city: null, timezone: 'Europe/London', source: 'edge' }, NOW);
    expect(line).toContain('9:12 am local time (Europe/London)');
    expect(line).toContain('country GB');
  });

  it('labels a city as approximate, never as a fact', () => {
    const line = placeContextLines({ country: 'IN', region: 'Telangana', city: 'Hyderabad', timezone: 'Asia/Kolkata', source: 'edge' }, NOW);
    expect(line).toContain('approximate city Hyderabad');
    expect(line).toMatch(/never an address/i);
    expect(line).toMatch(/network exchange/i);
  });

  it('tells the model never to infer the listener’s language from where they are', () => {
    const line = placeContextLines({ country: 'IN', region: null, city: null, timezone: 'Asia/Kolkata', source: 'edge' }, NOW);
    expect(line).toMatch(/NEVER infer what language/i);
    expect(line).toMatch(/preferences are given separately and always win/i);
  });

  it('says how the place was arrived at', () => {
    expect(placeContextLines({ country: 'LK', region: null, city: null, timezone: null, source: 'manual' }, NOW)).toMatch(/set this themselves/i);
    expect(placeContextLines({ country: 'GB', region: null, city: null, timezone: null, source: 'browser' }, NOW)).toMatch(/device locale/i);
    expect(placeContextLines({ country: 'IN', region: null, city: null, timezone: null, source: 'edge' }, NOW)).toMatch(/coarse network-level hint/i);
  });

  it('falls back to IST for a zone ICU cannot use, rather than throwing', () => {
    const line = placeContextLines({ country: 'IN', region: null, city: null, timezone: 'Mars/Olympus', source: 'edge' }, NOW);
    expect(line).toContain('IST');
    expect(line).toContain('country IN');
  });

  it('is just the clock when a place carries nothing but a zone', () => {
    const line = placeContextLines({ country: null, region: null, city: null, timezone: 'Europe/London', source: 'browser' }, NOW);
    expect(line).toContain('Europe/London');
    expect(line).not.toMatch(/LISTENER PLACE/);
  });
});
