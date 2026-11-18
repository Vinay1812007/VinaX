import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { request as httpRequest } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { RATE_LIMIT_TIERS } from '../worker/functions/_lib/ratelimit';
import { buildEnv, createApp, startCron, type App, type WorkerLike } from './app';
import { cfFromHeaders, fileKv, fixedWindowLimiter, workersAiRest } from './bindings';
import { readEnvFile, readWranglerVars, serverSettings } from './env';
import { outgoingHeaders } from './http';

const tmp = mkdtempSync(join(tmpdir(), 'vinax-server-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe('env', () => {
  it('reads the [vars] table of wrangler.toml and nothing else', () => {
    const vars = readWranglerVars(readFileSync(fileURLToPath(new URL('../worker/wrangler.toml', import.meta.url)), 'utf8'));
    expect(vars.ASSETS_HOST).toBe('vinax.pages.dev');
    expect(vars.SEARCH_API_PROVIDER).toBe('tavily');
    expect(vars.REALTIME_URL).toMatch(/^wss:\/\//);
    // Keys of other tables stay out.
    expect(vars).not.toHaveProperty('name');
    expect(vars).not.toHaveProperty('binding');
    expect(vars).not.toHaveProperty('crons');
  });

  it('handles quotes, escapes and trailing comments', () => {
    const vars = readWranglerVars('[vars]\nA = "x # y" # note\nB = \'lit\\n\'\nC = "a\\"b"\n[other]\nD = "no"\n');
    expect(vars).toEqual({ A: 'x # y', B: 'lit\\n', C: 'a"b' });
  });

  it('reads an env file; a missing one is empty', () => {
    const p = join(tmp, 'test.env');
    writeFileSync(p, 'SUPABASE_URL=https://x.supabase.co\n# c\nMULTI="a b"\n');
    expect(readEnvFile(p)).toEqual({ SUPABASE_URL: 'https://x.supabase.co', MULTI: 'a b' });
    expect(readEnvFile(join(tmp, 'nope.env'))).toEqual({});
  });

  it('server settings: safe defaults, process env over the file', () => {
    expect(serverSettings({}, {})).toEqual({ host: '127.0.0.1', port: 8787, protocol: 'https', dataDir: './data', cron: false, logRequests: false });
    const s = serverSettings({ PORT: '9000', VINAX_CRON: 'on' }, { PORT: '9100', VINAX_PROTO: 'http' });
    expect(s.port).toBe(9100);
    expect(s.cron).toBe(true);
    expect(s.protocol).toBe('http');
    expect(serverSettings({ PORT: 'abc' }, {}).port).toBe(8787);
  });
});

describe('bindings', () => {
  it('fileKv keeps values across restarts and honours expirationTtl', async () => {
    let now = 1_000_000;
    const path = join(tmp, 'kv', 'kv.json');
    const kv = fileKv(path, () => now);
    expect(await kv.get('a')).toBeNull();
    await kv.put('a', 'one');
    await kv.put('b', 'two', { expirationTtl: 60 });
    const again = fileKv(path, () => now);
    expect(await again.get('a')).toBe('one');
    expect(await again.get('b')).toBe('two');
    now += 61_000;
    expect(await again.get('b')).toBeNull();
    await again.delete('a');
    expect(await fileKv(path, () => now).get('a')).toBeNull();
  });

  it('fixedWindowLimiter allows `limit` per key per window', async () => {
    let now = 0;
    const rl = fixedWindowLimiter(2, 60, () => now);
    const ok = async (key: string) => (await rl.limit({ key })).success;
    expect([await ok('a'), await ok('a'), await ok('a'), await ok('b')]).toEqual([true, true, false, true]);
    now += 60_000;
    expect(await ok('a')).toBe(true);
  });

  it('cfFromHeaders rebuilds request.cf from the visitor location headers', () => {
    const cf = cfFromHeaders(new Headers({ 'cf-ipcountry': 'IN', 'cf-ipcity': 'Hyderabad', 'cf-region': 'Telangana', 'cf-timezone': 'Asia/Kolkata' }));
    expect(cf).toEqual({ country: 'IN', city: 'Hyderabad', region: 'Telangana', timezone: 'Asia/Kolkata' });
    expect(cfFromHeaders(new Headers())).toEqual({});
  });

  describe('workersAiRest', () => {
    const call = (res: Response) => {
      const f = vi.fn(async (_url: string, _init?: RequestInit) => res);
      return { ai: workersAiRest('acct', 'tok', f), f };
    };

    it('posts to the run URL with the token; a stream answers the SSE body', async () => {
      const { ai, f } = call(new Response('data: {"response":"hi"}\n\n', { headers: { 'content-type': 'text/event-stream' } }));
      const out = await ai.run('@cf/openai/gpt-oss-120b', { messages: [], stream: true });
      expect(f.mock.calls[0][0]).toBe('https://api.cloudflare.com/client/v4/accounts/acct/ai/run/@cf/openai/gpt-oss-120b');
      expect((f.mock.calls[0][1]?.headers as Record<string, string>).authorization).toBe('Bearer tok');
      expect(out).toBeInstanceOf(ReadableStream);
      expect(await new Response(out as ReadableStream).text()).toContain('"hi"');
    });

    it('answers the JSON result (FLUX: { image })', async () => {
      const { ai } = call(Response.json({ success: true, result: { image: 'aGk=' } }));
      expect(await ai.run('@cf/black-forest-labs/flux-1-schnell', { prompt: 'x' })).toEqual({ image: 'aGk=' });
    });

    it('throws with Cloudflare’s code in the message, as the binding does', async () => {
      const { ai } = call(Response.json({ success: false, errors: [{ code: 4006, message: 'you have used up your daily free allocation' }] }, { status: 429 }));
      await expect(ai.run('m', {})).rejects.toThrow(/4006/);
      const { ai: limited } = call(new Response('slow down', { status: 429 }));
      await expect(limited.run('m', {})).rejects.toThrow(/3036/);
    });
  });

  it('buildEnv adds every binding; AI only with an account and token', () => {
    const env = buildEnv({ FOO: 'bar' }, join(tmp, 'data'));
    expect(env.FOO).toBe('bar');
    expect(typeof (env.HANDOFF as { get: unknown }).get).toBe('function');
    for (const t of RATE_LIMIT_TIERS) expect(typeof (env[t.binding] as { limit: unknown }).limit).toBe('function');
    expect(typeof (env.ADMIN_AUTH_FAILS as { limit: unknown }).limit).toBe('function');
    expect(env.AI).toBeUndefined();
    expect(typeof (buildEnv({ CF_ACCOUNT_ID: 'a', CF_AI_TOKEN: 't' }, join(tmp, 'data')).AI as { run: unknown }).run).toBe('function');
  });
});

describe('outgoingHeaders', () => {
  it('drops content-encoding and its length (the body is plain), keeps every set-cookie', () => {
    const h = new Headers({ 'content-type': 'text/plain', 'content-encoding': 'gzip', 'content-length': '10', connection: 'close' });
    h.append('set-cookie', 'a=1; Path=/');
    h.append('set-cookie', 'b=2; Path=/');
    const out = outgoingHeaders(new Response('x', { headers: h }));
    expect(out).toContainEqual(['content-type', 'text/plain']);
    expect(out.filter(([k]) => k === 'set-cookie')).toEqual([['set-cookie', 'a=1; Path=/'], ['set-cookie', 'b=2; Path=/']]);
    expect(out.map(([k]) => k)).not.toContain('content-encoding');
    expect(out.map(([k]) => k)).not.toContain('content-length');
    expect(out.map(([k]) => k)).not.toContain('connection');
  });

  it('keeps an explicit length when nothing is encoded', () => {
    const out = outgoingHeaders(new Response('hello', { headers: { 'content-length': '5' } }));
    expect(out).toContainEqual(['content-length', '5']);
  });
});

describe('the server', () => {
  let app: App;
  let base = '';
  const seen: Request[] = [];
  let streamCancelled = false;
  const waited: string[] = [];

  const worker: WorkerLike = {
    async fetch(request, env, ctx) {
      seen.push(request);
      const url = new URL(request.url);
      if (url.pathname === '/echo') {
        const body = request.method === 'GET' || request.method === 'HEAD' ? '' : await request.text();
        return Response.json({
          method: request.method,
          url: request.url,
          body,
          ip: request.headers.get('cf-connecting-ip'),
          hop: request.headers.get('connection'),
          cf: (request as Request & { cf?: unknown }).cf,
          env: env.FOO,
        });
      }
      if (url.pathname === '/stream') {
        let n = 0;
        const stream = new ReadableStream<Uint8Array>({
          async pull(c) {
            n += 1;
            c.enqueue(new TextEncoder().encode(`data: ${n}\n\n`));
            await new Promise((r) => setTimeout(r, 20));
            if (n === 3) c.close();
          },
        });
        return new Response(stream, { headers: { 'content-type': 'text/event-stream' } });
      }
      if (url.pathname === '/forever') {
        const stream = new ReadableStream<Uint8Array>({
          async pull(c) {
            c.enqueue(new TextEncoder().encode('tick\n'));
            await new Promise((r) => setTimeout(r, 20));
          },
          cancel() {
            streamCancelled = true;
          },
        });
        return new Response(stream);
      }
      if (url.pathname === '/later') {
        ctx.waitUntil(new Promise<void>((r) => setTimeout(() => { waited.push('done'); r(); }, 30)));
        return new Response('ok');
      }
      if (url.pathname === '/cookies') {
        const h = new Headers();
        h.append('set-cookie', 'a=1');
        h.append('set-cookie', 'b=2');
        return new Response(null, { status: 204, headers: h });
      }
      if (url.pathname === '/gz') return new Response('plain text', { headers: { 'content-encoding': 'gzip', 'content-length': '3' } });
      throw new Error('boom');
    },
  };

  beforeAll(async () => {
    app = createApp({ worker, env: { FOO: 'bar' }, protocol: 'https' });
    await new Promise<void>((r) => app.server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((r) => app.server.close(() => r())));
  afterEach(() => {
    seen.length = 0;
  });

  it('answers /__health without the Worker', async () => {
    const res = await fetch(`${base}/__health`);
    expect(await res.text()).toBe('ok');
    expect(seen).toHaveLength(0);
  });

  it('hands the Worker a full Request: https URL, body, client address, cf, env', async () => {
    // fetch() cannot set Host, so talk node:http here.
    const j = await new Promise<Record<string, unknown> & { url: string }>((resolve, reject) => {
      const req = httpRequest(`${base}/echo?x=1`, { method: 'POST', headers: { host: 'api.vinaxmusic.online', 'cf-ipcountry': 'IN', 'content-type': 'text/plain' } }, (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => resolve(JSON.parse(data)));
      });
      req.on('error', reject);
      req.end('hello');
    });
    expect(j.method).toBe('POST');
    expect(j.url).toBe('https://api.vinaxmusic.online/echo?x=1');
    expect(j.body).toBe('hello');
    expect(j.ip).toBe('127.0.0.1');
    expect(j.hop).toBeNull();
    expect(j.cf).toEqual({ country: 'IN' });
    expect(j.env).toBe('bar');
  });

  it('trusts x-forwarded-proto and cf-connecting-ip from Cloudflare', async () => {
    const res = await fetch(`${base}/echo`, { headers: { 'x-forwarded-proto': 'http', 'cf-connecting-ip': '203.0.113.9' } });
    const j = await res.json();
    expect(j.url.startsWith('http://')).toBe(true);
    expect(j.ip).toBe('203.0.113.9');
  });

  it('HEAD sends headers only', async () => {
    const res = await fetch(`${base}/echo`, { method: 'HEAD' });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('');
  });

  it('streams a body chunk by chunk', async () => {
    const res = await fetch(`${base}/stream`);
    const reader = res.body!.getReader();
    const chunks: string[] = [];
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(new TextDecoder().decode(value));
    }
    expect(chunks.join('')).toBe('data: 1\n\ndata: 2\n\ndata: 3\n\n');
    expect(chunks.length).toBeGreaterThan(1);
  });

  it('cancels the body when the client goes away', async () => {
    const ctrl = new AbortController();
    const res = await fetch(`${base}/forever`, { signal: ctrl.signal });
    const reader = res.body!.getReader();
    await reader.read();
    ctrl.abort();
    await vi.waitFor(() => expect(streamCancelled).toBe(true), { timeout: 2000 });
  });

  it('runs waitUntil work after the reply, and drain waits for it', async () => {
    expect(await (await fetch(`${base}/later`)).text()).toBe('ok');
    await app.drain(1000);
    expect(waited).toEqual(['done']);
  });

  it('sends every set-cookie and a plain body for content-encoding', async () => {
    const c = await fetch(`${base}/cookies`);
    expect(c.status).toBe(204);
    expect(c.headers.getSetCookie()).toEqual(['a=1', 'b=2']);
    const g = await fetch(`${base}/gz`);
    expect(g.headers.get('content-encoding')).toBeNull();
    expect(await g.text()).toBe('plain text');
  });

  it('a throwing handler answers 500', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const res = await fetch(`${base}/nope`);
    expect(res.status).toBe(500);
    spy.mockRestore();
  });
});

describe('startCron', () => {
  it('fires scheduled on each 5-minute boundary with that time', async () => {
    vi.useFakeTimers();
    const start = Date.UTC(2026, 10, 18, 9, 3, 0);
    vi.setSystemTime(start);
    const times: number[] = [];
    const w: WorkerLike = { fetch: () => new Response(), scheduled: (e) => void times.push(e.scheduledTime) };
    const stop = startCron(w, {}, { waitUntil: () => undefined });
    await vi.advanceTimersByTimeAsync(2 * 60_000);
    expect(times).toEqual([Date.UTC(2026, 10, 18, 9, 5, 0)]);
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(times).toEqual([Date.UTC(2026, 10, 18, 9, 5, 0), Date.UTC(2026, 10, 18, 9, 10, 0)]);
    stop();
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(times).toHaveLength(2);
    vi.useRealTimers();
  });
});
