/**
 * v5.11.2/3 — /api/preview: the sandbox document that carries its OWN CSP so
 * assistant-written HTML/JS actually runs (srcdoc inherited the app's strict
 * hash policy and rendered blank), hardened so the reflection can never
 * execute on the app's origin.
 */
import { describe, expect, it } from 'vitest';
import { instrument, isSameOriginRequest, onRequestGet, onRequestOptions, onRequestPost } from './preview';

const HEADERS = {
  'content-type': 'application/x-www-form-urlencoded',
  'cf-connecting-ip': '203.0.113.7',
  'sec-fetch-site': 'same-origin',
};

const post = (body: string, extra: Record<string, string> = {}) =>
  onRequestPost({
    request: new Request('https://www.sirimillavinay.online/api/preview', {
      method: 'POST',
      headers: { ...HEADERS, ...extra },
      body,
    }),
  });

const PAGE = '<!doctype html><html><head></head><body><script>document.body.textContent="hi"</script></body></html>';

describe('/api/preview', () => {
  it('echoes the page as HTML with a permissive policy of its own, framed only by the app', async () => {
    const res = await post(`html=${encodeURIComponent(PAGE)}&token=abc`);
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

  it('sandboxes the document itself, so even a top-level "Open" runs in an opaque origin', async () => {
    // Without this the reflection is a same-origin XSS sink: an iframe's
    // sandbox attribute does not apply to a top-level navigation.
    const res = await post(`html=${encodeURIComponent(PAGE)}&token=abc`);
    const csp = res.headers.get('content-security-policy') ?? '';
    expect(csp).toContain('sandbox allow-scripts');
    expect(csp).toContain('allow-downloads');
    expect(csp).not.toContain('allow-same-origin');
    expect(res.headers.get('cross-origin-opener-policy')).toBe('same-origin');
  });

  it('refuses a cross-site POST — this is not a content host for other sites', async () => {
    expect((await post(`html=${encodeURIComponent(PAGE)}`, { 'sec-fetch-site': 'cross-site' })).status).toBe(403);
    expect((await post(`html=${encodeURIComponent(PAGE)}`, { 'sec-fetch-site': 'same-site' })).status).toBe(403);
  });

  it('falls back to Origin when Sec-Fetch-Site is absent (older browsers)', () => {
    const mk = (h: Record<string, string>) => new Request('https://x/api/preview', { method: 'POST', headers: h });
    expect(isSameOriginRequest(mk({ origin: 'https://www.sirimillavinay.online' }))).toBe(true);
    expect(isSameOriginRequest(mk({ origin: 'https://evil.example' }))).toBe(false);
    expect(isSameOriginRequest(mk({}))).toBe(false);
    // Sec-Fetch-Site wins when present, whatever Origin claims.
    expect(isSameOriginRequest(mk({ 'sec-fetch-site': 'cross-site', origin: 'https://www.sirimillavinay.online' }))).toBe(false);
  });

  it('ships the opaque-origin survival kit: storage shims and failure reporting', async () => {
    const text = await (await post(`html=${encodeURIComponent(PAGE)}&token=abc`)).text();
    // localStorage THROWS in an opaque origin — the single most common way an
    // AI-written page dies on line 1.
    expect(text).toContain("def(window,'localStorage',memStore())");
    expect(text).toContain("def(window,'sessionStorage',memStore())");
    // A failed CDN <script src> does not bubble; only a capture-phase listener sees it.
    expect(text).toContain('Failed to load ');
    expect(text).toContain('securitypolicyviolation');
    expect(text).toContain("send('ready','loaded')");
  });

  it('accepts JSON too and adds a <title> when the page has none', async () => {
    const res = await post(JSON.stringify({ html: '<html><head></head><body>x</body></html>', title: 'Confetti' }), {
      'content-type': 'application/json',
    });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('<title>Confetti</title>');
  });

  it('does not let a $-pattern in the title duplicate the page body', async () => {
    // String.replace expands $&, $' and $` in the REPLACEMENT — a naive
    // template here would splice the whole document back into the title.
    const res = await post(JSON.stringify({ html: '<html><head></head><body>UNIQUEBODY</body></html>', title: "a$&b$'c" }), {
      'content-type': 'application/json',
    });
    const text = await res.text();
    expect(text.match(/UNIQUEBODY/g) ?? []).toHaveLength(1);
    // & is stripped by the HTML-safety pass; the $ sequences survive literally.
    expect(text).toContain("<title>a$b$'c</title>");
  });

  it('rejects empty, oversized and non-POST requests', async () => {
    expect((await post('html=')).status).toBe(400);
    expect((await post(`html=${'x'.repeat(700_000)}`)).status).toBe(413);
    expect((await onRequestGet()).status).toBe(405);
    expect((await onRequestOptions()).status).toBe(204);
  });

  it('caps the body while READING, so a chunked upload cannot buffer the isolate to death', async () => {
    // No content-length: the declared-size guard is skipped entirely, so the
    // streaming cap is the only thing standing between us and an OOM.
    const big = new ReadableStream<Uint8Array>({
      start(c) {
        const chunk = new Uint8Array(64_000).fill(120);
        for (let i = 0; i < 40; i += 1) c.enqueue(chunk);
        c.close();
      },
    });
    const res = await onRequestPost({
      request: new Request('https://www.sirimillavinay.online/api/preview', {
        method: 'POST',
        headers: HEADERS,
        body: big,
        // @ts-expect-error undici requires duplex for a stream body
        duplex: 'half',
      }),
    });
    expect(res.status).toBe(413);
  });

  it('instrument() puts the reporter ahead of every page script, whatever the shape', () => {
    const withHead = instrument('<html><head><meta charset="utf-8"></head></html>', 't');
    expect(withHead.indexOf('data-token="t"')).toBeLessThan(withHead.indexOf('<meta'));
    // A script before <head> must still not run first.
    const early = instrument('<html><script>boom()</script><head></head></html>', 't');
    expect(early.indexOf('data-token="t"')).toBeLessThan(early.indexOf('boom()'));
    expect(instrument('<svg></svg>', 't')).toMatch(/^<!doctype html>/);
    expect(instrument('<p>x</p>', 'a"b')).toContain('data-token="ab"');
  });
});
