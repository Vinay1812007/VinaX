/** 13.7 — the console's script and stylesheet links carry a content stamp, so a
 *  zone-level browser cache can never serve an owner a stale app.js. */
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
// @ts-expect-error — a plain .mjs build script without types
import { stampAdmin } from '../../scripts/admin-stamp.mjs';

describe('admin-stamp', () => {
  it('stamps every /admin/ js and css link with the file hash, and only those', async () => {
    const html = await readFile(new URL('../../public/admin/index.html', import.meta.url), 'utf8');
    const files: Record<string, string> = {};
    const { html: out, count } = await stampAdmin(html, async (p: string) => (files[p] = `body of ${p}`));
    expect(count).toBeGreaterThanOrEqual(6);
    expect(out).toMatch(/src="\/admin\/app\.js\?v=[0-9a-f]{10}"/);
    expect(out).toMatch(/href="\/admin\/console\.css\?v=[0-9a-f]{10}"/);
    // No unstamped console asset is left behind.
    expect(out).not.toMatch(/(?:src|href)="\/admin\/[\w./-]+\.(?:js|css)"/);
    expect(Object.keys(files)).toContain('/admin/app.js');
  });

  it('a changed file gets a new stamp; the same file keeps its stamp', async () => {
    const html = '<script src="/admin/app.js"></script>';
    const a = (await stampAdmin(html, async () => 'one')).html;
    const b = (await stampAdmin(html, async () => 'two')).html;
    expect(a).not.toBe(b);
    expect((await stampAdmin(html, async () => 'one')).html).toBe(a);
  });
});
