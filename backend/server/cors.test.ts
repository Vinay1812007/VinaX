import { request as httpRequest } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp, type App, type WorkerLike } from './app';
import { allowedOrigin, corsAdditions, preflight } from './cors';

describe('allowedOrigin', () => {
  it('echoes the app origins and loopback dev, nothing else', () => {
    expect(allowedOrigin('https://www.vinaxmusic.online')).toBe('https://www.vinaxmusic.online');
    expect(allowedOrigin('capacitor://localhost')).toBe('capacitor://localhost');
    expect(allowedOrigin('http://localhost:5173')).toBe('http://localhost:5173');
    expect(allowedOrigin('https://evil.example')).toBeNull();
    expect(allowedOrigin('https://www.vinaxmusic.online.evil.example')).toBeNull();
    expect(allowedOrigin(null)).toBeNull();
  });
});

describe('preflight', () => {
  const pre = (origin: string, headers = 'authorization, content-type') =>
    new Request('https://api.vinaxmusic.online/api/ai/chat', { method: 'OPTIONS', headers: { origin, 'access-control-request-method': 'POST', 'access-control-request-headers': headers } });

  it('answers an app origin with its own headers, cached a day', () => {
    const res = preflight(pre('https://www.vinaxmusic.online'))!;
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe('https://www.vinaxmusic.online');
    expect(res.headers.get('access-control-allow-headers')).toBe('authorization, content-type');
    expect(res.headers.get('access-control-allow-methods')).toContain('POST');
    expect(res.headers.get('access-control-max-age')).toBe('86400');
  });

  it('leaves other origins and plain OPTIONS to the route', () => {
    expect(preflight(pre('https://evil.example'))).toBeNull();
    expect(preflight(new Request('https://api.vinaxmusic.online/api/geo', { method: 'OPTIONS', headers: { origin: 'https://www.vinaxmusic.online' } }))).toBeNull();
    expect(preflight(new Request('https://api.vinaxmusic.online/api/geo', { headers: { origin: 'https://www.vinaxmusic.online' } }))).toBeNull();
  });
});

describe('corsAdditions', () => {
  const site = 'https://www.vinaxmusic.online';
  it('adds the origin, exposes headers and varies on Origin', () => {
    expect(corsAdditions(site, new Headers())).toEqual([
      ['access-control-allow-origin', site],
      ['access-control-expose-headers', '*'],
      ['vary', 'Origin'],
    ]);
  });
  it("keeps a route's own CORS answer", () => {
    expect(corsAdditions(site, new Headers({ 'access-control-allow-origin': '*', 'access-control-expose-headers': 'x-a', vary: 'origin' }))).toEqual([]);
  });
  it('adds nothing for other origins or none', () => {
    expect(corsAdditions('https://evil.example', new Headers())).toEqual([]);
    expect(corsAdditions(null, new Headers())).toEqual([]);
  });
});

describe('the server answers cross-origin calls from the app', () => {
  let app: App;
  let port = 0;
  let reached = 0;
  const worker: WorkerLike = {
    fetch() {
      reached += 1;
      return new Response('{"ok":true}', { headers: { 'content-type': 'application/json', 'retry-after': '5' } });
    },
  };
  beforeAll(async () => {
    app = createApp({ worker, env: {}, protocol: 'https' });
    await new Promise<void>((r) => app.server.listen(0, '127.0.0.1', r));
    port = (app.server.address() as AddressInfo).port;
  });
  afterAll(() => new Promise<void>((r) => app.server.close(() => r())));

  const call = (method: string, headers: Record<string, string>) =>
    new Promise<{ status: number; headers: Record<string, string | string[] | undefined> }>((resolve, reject) => {
      const req = httpRequest({ host: '127.0.0.1', port, path: '/api/x', method, headers }, (res) => {
        res.resume();
        res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers }));
      });
      req.on('error', reject);
      req.end();
    });

  it('answers the preflight without reaching the route', async () => {
    reached = 0;
    const r = await call('OPTIONS', { origin: 'https://www.vinaxmusic.online', 'access-control-request-method': 'POST', 'access-control-request-headers': 'authorization' });
    expect(r.status).toBe(204);
    expect(r.headers['access-control-allow-origin']).toBe('https://www.vinaxmusic.online');
    expect(r.headers['access-control-allow-headers']).toBe('authorization');
    expect(reached).toBe(0);
  });

  it('adds CORS to the real answer', async () => {
    const r = await call('GET', { origin: 'https://www.vinaxmusic.online' });
    expect(r.status).toBe(200);
    expect(r.headers['access-control-allow-origin']).toBe('https://www.vinaxmusic.online');
    expect(r.headers['access-control-expose-headers']).toBe('*');
    expect(r.headers['retry-after']).toBe('5');
  });

  it('a call without Origin gets no CORS headers', async () => {
    const r = await call('GET', {});
    expect(r.headers['access-control-allow-origin']).toBeUndefined();
  });
});
