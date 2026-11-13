import { describe, expect, it } from 'vitest';
import { authHref, safeNext } from './next';

describe('safeNext', () => {
  it('keeps a same-site path with its query and hash', () => {
    expect(safeNext('/library')).toBe('/library');
    expect(safeNext('/vinaxai/c/abc?x=1#m')).toBe('/vinaxai/c/abc?x=1#m');
  });

  it('falls back to / for anything that could leave the site', () => {
    for (const bad of [null, undefined, '', 'library', '//evil.com', '/\\evil.com', 'https://evil.com', 'javascript:alert(1)', '/a\nb', '/a\\b']) {
      expect(safeNext(bad)).toBe('/');
    }
    expect(safeNext(`/${'a'.repeat(2001)}`)).toBe('/');
  });

  it('never sends you back to a sign-in page', () => {
    for (const loop of ['/login', '/login/', '/signup?next=/x', '/forgot-password', '/login#top']) expect(safeNext(loop)).toBe('/');
    expect(safeNext('/loginx')).toBe('/loginx');
  });
});

describe('authHref', () => {
  it('carries next and the typed email', () => {
    expect(authHref('/signup', { next: '/library', email: ' a@b.co ' })).toBe('/signup?next=%2Flibrary&email=a%40b.co');
  });

  it('leaves out a home next, an empty email and an unsafe next', () => {
    expect(authHref('/login', { next: '/', email: '' })).toBe('/login');
    expect(authHref('/forgot-password', { next: '//evil.com' })).toBe('/forgot-password');
  });
});
