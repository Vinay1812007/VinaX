/**
 * Admin auth — the token check and its brute-force lockout.
 */
import { describe, expect, it } from 'vitest';
import { isAdmin } from '../functions/_lib/admin';

const ENV = { ADMIN_LOGIN_PASSWORD: 'test-secret' };

describe('admin auth brute-force lockout', () => {
  it('locks a source out after repeated wrong tokens — even a later correct guess fails', () => {
    const mk = (tok: string) =>
      new Request('https://admin.test/api/admin/x', {
        headers: { 'x-admin-token': tok, 'cf-connecting-ip': '198.51.100.7' },
      });
    for (let i = 0; i < 15; i++) expect(isAdmin(mk(`wrong-${i}`), ENV)).toBe(false);
    expect(isAdmin(mk('test-secret'), ENV)).toBe(false); // locked out
    // A different source with the right token is unaffected.
    const other = new Request('https://admin.test/api/admin/x', {
      headers: { 'x-admin-token': 'test-secret', 'cf-connecting-ip': '198.51.100.8' },
    });
    expect(isAdmin(other, ENV)).toBe(true);
  });
});
