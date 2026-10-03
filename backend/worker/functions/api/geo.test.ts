import { describe, expect, it } from 'vitest';
import { geoAnswer, onRequestGet, placeName, readCountry, readTimezone } from './geo';

interface Cf {
  country?: string;
  region?: string;
  city?: string;
  timezone?: string;
}

const req = (cf: Cf | null, headers: Record<string, string> = {}): Request => {
  const r = new Request('https://www.example.test/api/geo', { headers });
  if (cf) Object.defineProperty(r, 'cf', { value: cf });
  return r;
};

describe('/api/geo', () => {
  it('returns the coarse fields the edge supplied', () => {
    const a = geoAnswer(req({ region: 'Telangana', city: 'Hyderabad', timezone: 'Asia/Kolkata' }, { 'CF-IPCountry': 'IN' }));
    expect(a).toEqual({ country: 'IN', region: 'Telangana', city: 'Hyderabad', timezone: 'Asia/Kolkata', source: 'edge', unknown: false });
  });

  it('falls back to cf.country when the header is absent', () => {
    expect(geoAnswer(req({ country: 'GB' })).country).toBe('GB');
  });

  it('says unknown for XX, T1 and a missing country, and drops the finer fields with it', () => {
    for (const code of ['XX', 'T1', '', 'ZZZ', '1N']) {
      const a = geoAnswer(req({ region: 'Somewhere', city: 'Someplace' }, { 'CF-IPCountry': code }));
      expect(a.unknown).toBe(true);
      expect(a.country).toBeNull();
      expect(a.region).toBeNull();
      expect(a.city).toBeNull();
    }
  });

  it('keeps a time zone even when the country is unknown (it is a zone, not a place)', () => {
    expect(geoAnswer(req({ timezone: 'Asia/Kolkata' })).timezone).toBe('Asia/Kolkata');
  });

  it('answers for a request with no edge metadata at all (local dev)', () => {
    const a = geoAnswer(req(null));
    expect(a).toEqual({ country: null, region: null, city: null, timezone: null, source: 'edge', unknown: true });
  });

  it('rejects a region or city that is not a place name', () => {
    expect(placeName('<script>alert(1)</script>')).toBeNull();
    expect(placeName('Telangana')).toBe('Telangana');
    expect(placeName("Côte d'Ivoire")).toBe("Côte d'Ivoire");
    expect(placeName('New York (NY)')).toBe('New York (NY)');
    expect(placeName('x'.repeat(100))).toBeNull();
    expect(placeName(123)).toBeNull();
    expect(placeName('  ')).toBeNull();
  });

  it('rejects a time zone that is not an IANA zone', () => {
    expect(readTimezone('Asia/Kolkata')).toBe('Asia/Kolkata');
    expect(readTimezone('UTC')).toBe('UTC');
    expect(readTimezone('America/Argentina/Ushuaia')).toBe('America/Argentina/Ushuaia');
    expect(readTimezone('../../etc/passwd')).toBeNull();
    expect(readTimezone('Asia/Kolkata; DROP TABLE')).toBeNull();
    expect(readTimezone('x'.repeat(80))).toBeNull();
  });

  it('normalises a lower-case country code', () => {
    expect(readCountry('in')).toBe('IN');
  });

  it('never caches an answer publicly and allows the Android shell to read it', async () => {
    const res = await onRequestGet({ request: req({ country: 'IN' }) });
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    expect(await res.json()).toMatchObject({ country: 'IN' });
  });
});
