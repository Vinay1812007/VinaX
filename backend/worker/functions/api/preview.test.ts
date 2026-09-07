/**
 * v5.11.2 — /api/preview: the sandbox document that carries its OWN CSP so
 * assistant-written HTML/JS actually runs (srcdoc inherited the app's strict
 * hash policy and rendered blank).
 */
import { describe, expect, it } from 'vitest';
import { instrument, onRequestGet, onRequestPost } from './preview';

const post = (body: string, ct = 'application/x-www-form-urlencoded') =>
  onRequestPost({
    request: new Request('https://www.sirimillavinay.online/api/preview', {
      method: 'POST',
      headers: { 'content-type': ct, 'cf-connecting-ip': '203.0.113.7' },
      body,
    }),
  });

describe('/api/preview', () => {
  it('echoes the page as HTML with a permissive policy of its own, framed only by the app', async () => {
    const res = await post(`html=${encodeURIComponent('<!doctype html><html><head></head><body><script>document.body.textContent="hi"</script></body></html>')}&token=abc`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    const csp = res.headers.get('content-security-policy') ?? '';
    expect(csp).toContain("'unsafe-inline'");
    expect(csp).toContain('frame-ancestors https://www.sirimillavinay.online');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('x-robots-tag')).toContain('noindex');
    const text = await res.text();
    expect(text).toContain('data-token="abc"');
    expect(text).toContain('document.body.textContent="hi"');
  });

  it('accepts JSON too and adds a <title> when the page has none', async () => {
    const res = await post(JSON.stringify({ html: '<html><head></head><body>x</body></html>', title: 'Confetti' }), 'application/json');
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('<title>Confetti</title>');
  });

  it('rejects empty and oversized pages, and GET', async () => {
    expect((await post('html=')).status).toBe(400);
    expect((await post(`html=${'x'.repeat(700_000)}`)).status).toBe(413);
    expect((await onRequestGet()).status).toBe(405);
  });

  it('instrument() puts the error reporter first, whatever the page shape', () => {
    expect(instrument('<html><head><meta charset="utf-8"></head></html>', 't').indexOf('data-token="t"')).toBeLessThan(
      instrument('<html><head><meta charset="utf-8"></head></html>', 't').indexOf('<meta'),
    );
    expect(instrument('<svg></svg>', 't')).toMatch(/^<!doctype html>/);
    expect(instrument('<p>x</p>', 'a"b')).toContain('data-token="ab"');
  });
});
