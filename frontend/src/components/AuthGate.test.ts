/**
 * 13.9 — which pages a signed-out visitor may open in the live app. Personal
 * pages and Home stay the sign-in screen; browse pages, song, album, artist
 * and video pages and every language and mood hub open.
 */
import { describe, expect, it } from 'vitest';
import { browsableSignedOut, PUBLIC_PATHS } from './AuthGate';

describe('browsableSignedOut', () => {
  it('opens the browse destinations and the catalogue pages', () => {
    for (const p of ['/explore', '/discover', '/charts', '/top-songs', '/trending', '/search', '/search/arijit', '/song/abc', '/album/xyz', '/artist/455132', '/video/21uSZLdz', '/videos', '/moods', '/movies', '/languages', '/regions', '/telugu-songs', '/hindi-romantic-songs']) {
      expect(browsableSignedOut(p), p).toBe(true);
    }
  });

  it('keeps Home and the personal pages behind sign-in', () => {
    for (const p of ['/', '/library', '/favorites', '/later', '/history', '/queue', '/settings', '/stats', '/recap', '/together', '/radio', '/flow', '/now-playing', '/made-for-you', '/weekly', '/collection/1', '/smart/1', '/song/', '/nonsense-songs']) {
      expect(browsableSignedOut(p), p).toBe(false);
    }
  });

  it('the legal and help pages are public on their own list', () => {
    expect(PUBLIC_PATHS.has('/privacy')).toBe(true);
    expect(browsableSignedOut('/privacy')).toBe(false);
  });
});
