import { describe, expect, it } from 'vitest';
import { artistTagline } from './artistTagline';

describe('artistTagline', () => {
  it('drops the kind and raw counts the header already shows', () => {
    expect(artistTagline('Artist • 9487361 Listeners')).toBeNull();
    expect(artistTagline('Artist')).toBeNull();
    expect(artistTagline('artist · 1.2M followers')).toBeNull();
    expect(artistTagline(null)).toBeNull();
  });
  it('keeps a real tagline, capitalised', () => {
    expect(artistTagline('singer · Artist • 12,400 listeners')).toBe('Singer');
    expect(artistTagline('Music director and composer')).toBe('Music director and composer');
  });
});
