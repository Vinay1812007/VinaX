import { describe, expect, it } from 'vitest';
import { apexTarget } from './apexRedirect';

const loc = (hostname: string, pathname = '/', search = '', hash = '') => ({ hostname, pathname, search, hash });

describe('11.7.1 apexRedirect', () => {
  it('sends the bare domain to www, keeping path, query and hash', () => {
    expect(apexTarget(loc('vinaxmusic.online', '/settings', '?x=1', '#notifications'))).toBe('https://www.vinaxmusic.online/settings?x=1#notifications');
  });
  it('leaves www, the console, previews and localhost alone', () => {
    for (const h of ['www.vinaxmusic.online', 'admin.vinaxmusic.online', 'vinax.pages.dev', 'localhost']) expect(apexTarget(loc(h))).toBeNull();
  });
});
