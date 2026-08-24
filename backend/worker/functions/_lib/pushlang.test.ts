/**
 * Pins the push-language cohort contracts (4.16.0) used by the personalized
 * song push: declared locale beats geography, geography infers sensibly,
 * grouping sorts largest-first, and catalog names resolve for every code.
 */
import { describe, expect, it } from 'vitest';
import { catalogLang, groupByLang, inferLangForGeo, langForRow, langName, primaryLang } from './pushlang';

describe('primaryLang', () => {
  it('coarsens full locales and survives junk', () => {
    expect(primaryLang('te-IN')).toBe('te');
    expect(primaryLang('hi_IN')).toBe('hi');
    expect(primaryLang('en-US')).toBe('en');
    expect(primaryLang(null)).toBe('en');
    expect(primaryLang('x')).toBe('en');
  });
});

describe('langForRow', () => {
  it('device-declared locale wins over geography', () => {
    expect(langForRow({ lang: 'ta-IN', region: 'Telangana', country: 'IN' })).toBe('ta');
  });
  it('geography infers when no locale is declared', () => {
    expect(langForRow({ lang: null, city: 'Hyderabad', region: 'Telangana', country: 'IN' })).toBe('te');
    expect(langForRow({ lang: null, city: 'Chennai', region: 'Tamil Nadu', country: 'IN' })).toBe('ta');
    expect(langForRow({ lang: null, city: null, region: null, country: 'India' })).toBe('hi');
    expect(langForRow({ lang: null, city: 'Berlin', country: 'DE' })).toBe('en');
  });
});

describe('inferLangForGeo', () => {
  it('is conservative — unknown geography lands on English', () => {
    expect(inferLangForGeo(null, null, null)).toBe('en');
  });
});

describe('groupByLang', () => {
  it('groups rows and sorts largest cohort first', () => {
    const rows = [
      { lang: 'te' }, { lang: 'te' }, { lang: 'te' },
      { lang: 'hi' }, { lang: 'hi' },
      { lang: null, city: 'Chennai' },
    ];
    const groups = groupByLang(rows);
    expect(groups[0]).toMatchObject({ lang: 'te' });
    expect(groups[0].rows.length).toBe(3);
    expect(groups.map((g) => g.lang)).toStrictEqual(['te', 'hi', 'ta']);
  });
});

describe('catalog + display names', () => {
  it('every inferable code has a catalog language and a display name', () => {
    for (const code of ['te', 'ta', 'kn', 'ml', 'mr', 'bn', 'gu', 'pa', 'bh', 'ur', 'or', 'as', 'hi', 'en']) {
      expect(catalogLang(code).length).toBeGreaterThan(2);
      expect(langName(code)).not.toBe(code);
    }
    expect(catalogLang('zz')).toBe('hindi'); // unknown → safest big catalog
  });
});
