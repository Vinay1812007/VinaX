import { describe, expect, it } from 'vitest';
import { appIntentUrl, codeFromScan, deepLinkPath, inviteUrl } from './invite';

describe('Listen Together invites', () => {
  it('a QR carries the canonical invite link, and a scan reads the code back', () => {
    expect(inviteUrl('ABC123')).toBe('https://www.vinaxmusic.online/together?code=ABC123');
    expect(codeFromScan(inviteUrl('ABC123'))).toBe('ABC123');
    expect(codeFromScan('https://vinaxmusic.online/together/?code=abc123')).toBe('ABC123');
  });

  it('a bare code scans too; anything else is ignored', () => {
    expect(codeFromScan('  xy12z9 ')).toBe('XY12Z9');
    expect(codeFromScan('')).toBeNull();
    expect(codeFromScan('upi://pay?pa=someone@bank')).toBeNull();
    expect(codeFromScan('https://example.com/together?code=ABC123')).toBeNull();
    expect(codeFromScan('https://www.vinaxmusic.online/song/abc?code=ABC123')).toBeNull();
    expect(codeFromScan('https://www.vinaxmusic.online/together?code=!!')).toBeNull();
  });

  it('the intent link names the app, the path and a download fallback', () => {
    const link = appIntentUrl('/together?code=ABC123');
    expect(link.startsWith('intent://www.vinaxmusic.online/together?code=ABC123#Intent;scheme=https;package=app.Vinax.music;')).toBe(true);
    expect(link).toContain(`S.browser_fallback_url=${encodeURIComponent('https://www.vinaxmusic.online/download')}`);
    expect(link.endsWith(';end')).toBe(true);
    // Only in-app paths: never another host.
    expect(appIntentUrl('//evil.example/x')).toContain('intent://www.vinaxmusic.online/#Intent');
  });

  it('a link opened in the app becomes an in-app path, only for our own site', () => {
    expect(deepLinkPath('https://www.vinaxmusic.online/together?code=ABC123')).toBe('/together?code=ABC123');
    expect(deepLinkPath('https://vinaxmusic.online/album/x-1')).toBe('/album/x-1');
    expect(deepLinkPath('https://www.vinaxmusic.online/')).toBeNull();
    expect(deepLinkPath('https://www.vinaxmusic.online/?widget=play')).toBeNull();
    expect(deepLinkPath('https://example.com/together?code=ABC123')).toBeNull();
    expect(deepLinkPath('http://www.vinaxmusic.online/together')).toBeNull();
    expect(deepLinkPath('not a link')).toBeNull();
  });
});
