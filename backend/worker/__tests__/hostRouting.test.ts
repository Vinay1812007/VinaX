/**
 * Host-level routing regression — the update.<domain> APK loop.
 *
 * _middleware.ts used to 302 EVERY request on the update host to
 * `${origin}/api/apk` — including /api/apk itself, which sits on the same
 * origin. The browser followed the redirect straight back into the same
 * rule forever (ERR_TOO_MANY_REDIRECTS) and no APK ever streamed. The
 * download route must reach its handler; everything else still bounces.
 */
import { describe, expect, it } from 'vitest';
import { isApkDownloadPath, onRequest as hostMiddleware } from '../functions/_middleware';
import worker from '../index';

const UPDATE = 'https://update.sirimillavinay.online';

const run = (url: string, next = async () => new Response('handler', { status: 200 })) =>
  hostMiddleware({ request: new Request(url), next });

describe('isApkDownloadPath', () => {
  it('matches only the two download routes', () => {
    for (const p of ['/api/apk', '/api/apk/', '/apk', '/apk/']) expect(isApkDownloadPath(p), p).toBe(true);
    for (const p of ['/', '/api/apkx', '/api/status', '/apk/latest', '/download']) expect(isApkDownloadPath(p), p).toBe(false);
  });
});

describe('update host middleware', () => {
  it('bounces the root and arbitrary paths to /api/apk on the same origin', async () => {
    for (const path of ['/', '/latest', '/something?x=1']) {
      const res = await run(`${UPDATE}${path}`);
      expect(res.status, path).toBe(302);
      expect(res.headers.get('location'), path).toBe(`${UPDATE}/api/apk`);
    }
  });

  it('lets /api/apk reach its handler instead of redirecting to itself', async () => {
    let reached = 0;
    const res = await run(`${UPDATE}/api/apk`, async () => {
      reached += 1;
      return new Response('apk-bytes', { status: 200 });
    });
    expect(res.status).toBe(200);
    expect(reached).toBe(1);
    expect(res.headers.get('location')).toBeNull();
  });

  it('terminates within one hop: the redirect target is never itself redirected', async () => {
    // Follow redirects by hand, the way a browser would, and prove the chain
    // ends on a non-redirect response after a bounded number of hops.
    let url = `${UPDATE}/`;
    let hops = 0;
    let res: Response;
    for (;;) {
      res = await run(url);
      if (res.status !== 301 && res.status !== 302) break;
      hops += 1;
      expect(hops, 'redirect loop on the update host').toBeLessThan(4);
      url = res.headers.get('location') ?? '';
    }
    expect(url).toBe(`${UPDATE}/api/apk`);
    expect(res.status).toBe(200);
  });

  it('keeps the apex canonicalisation and admin root redirect intact', async () => {
    const apex = await run('https://sirimillavinay.online/song/abc?x=1');
    expect(apex.status).toBe(301);
    expect(apex.headers.get('location')).toBe('https://www.sirimillavinay.online/song/abc?x=1');
    const admin = await run('https://admin.sirimillavinay.online/');
    expect(admin.status).toBe(302);
    expect(admin.headers.get('location')).toBe('https://admin.sirimillavinay.online/admin/');
    const plain = await run('https://www.sirimillavinay.online/api/apk');
    expect(plain.status).toBe(200);
  });
});

describe('worker entry point on the update host', () => {
  const ctx = { waitUntil: () => undefined };
  const env = {}; // no GitHub token → the handler answers 503, proving it ran

  it('routes /api/apk to the APK handler (503 without a release token, not a 302)', async () => {
    const res = await worker.fetch(new Request(`${UPDATE}/api/apk`), env, ctx);
    expect(res.status).toBe(503);
    expect(await res.text()).toBe('Updates not configured');
  });

  it('/apk on the update host redirects once to /api/apk, which then serves', async () => {
    const first = await worker.fetch(new Request(`${UPDATE}/apk`), env, ctx);
    expect(first.status).toBe(302);
    const target = first.headers.get('location') ?? '';
    expect(target).toBe(`${UPDATE}/api/apk`);
    const second = await worker.fetch(new Request(target), env, ctx);
    expect(second.status).toBe(503);
  });

  it('the bare update host still redirects to the download route', async () => {
    const res = await worker.fetch(new Request(`${UPDATE}/`), env, ctx);
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(`${UPDATE}/api/apk`);
  });
});
