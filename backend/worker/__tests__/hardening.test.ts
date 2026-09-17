/**
 * Reliability hardening: size-capped request bodies (declared AND streamed),
 * outbound timeouts that never outlive their purpose, and a chat() leash that
 * covers a stalled response body. Deterministic — fetch is stubbed and the
 * timer paths run on fake timers.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readCapped, readJsonCapped } from '../functions/_lib/body';
import { chat } from '../functions/_lib/ai';
import { fetchAsset, latestRelease } from '../functions/_lib/github';
import { onRequestGet as imgGet } from '../functions/img';
import { onRequestPost as assistantPost } from '../functions/api/assistant';
import { onRequestPost as playlistPost } from '../functions/api/playlist';
import { onRequestPost as vinaxaiPost } from '../functions/api/vinaxai';
import { onRequestPost as curatePost } from '../functions/api/curate';
import { onRequestPost as djPost } from '../functions/api/dj';

/** A chunked upload: no content-length, `total` bytes fed in 8 KB pieces. */
function chunkedBody(total: number, pulls: { n: number }): ReadableStream<Uint8Array> {
  let sent = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      pulls.n += 1;
      if (sent >= total) return controller.close();
      const size = Math.min(8_192, total - sent);
      sent += size;
      controller.enqueue(new Uint8Array(size).fill(0x20));
    },
  });
}

let ipSeq = 0;
function post(path: string, body: BodyInit, headers: Record<string, string> = {}): Request {
  ipSeq += 1;
  return new Request(`https://example.test${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'cf-connecting-ip': `10.8.${Math.floor(ipSeq / 250)}.${ipSeq % 250}`, ...headers },
    body,
    // Node's fetch needs this for a stream body; it is what makes the request chunked.
    duplex: 'half',
  } as RequestInit);
}

beforeEach(() => vi.unstubAllGlobals());
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('readCapped / readJsonCapped', () => {
  it('reads a body under the cap and parses it', async () => {
    const r = await readJsonCapped<{ a: number }>(post('/x', JSON.stringify({ a: 1 })), 1_000);
    expect(r).toEqual({ ok: true, value: { a: 1 } });
  });

  it('refuses on the declared content-length before touching the stream', async () => {
    const req = new Request('https://example.test/x', { method: 'POST', headers: { 'content-length': '5000' }, body: '{}' });
    expect(await readJsonCapped(req, 1_000)).toEqual({ ok: false, reason: 'too_large' });
  });

  it('stops reading a chunked body as soon as it passes the cap', async () => {
    const pulls = { n: 0 };
    expect(await readCapped(chunkedBody(10_000_000, pulls), 20_000)).toBeNull();
    // ~3 chunks to cross 20 KB — nowhere near the ~1200 the full body holds.
    expect(pulls.n).toBeLessThan(10);
  });

  it('reports malformed JSON separately from size', async () => {
    expect(await readJsonCapped(post('/x', '{nope'), 1_000)).toEqual({ ok: false, reason: 'bad_json' });
  });
});

describe('route body caps — a chunked oversized body answers 413 without buffering it', () => {
  const env = { VINAX_NVD_NEMOTRON_3_5_LIGHTNING_30B_A3B: 'k' };
  const routes: Array<[string, number, (ctx: { request: Request; env: typeof env }) => Promise<Response>]> = [
    ['/api/assistant', 64_000, assistantPost],
    ['/api/playlist', 32_000, playlistPost],
    ['/api/curate', 32_000, curatePost],
    ['/api/dj', 48_000, djPost],
    ['/api/vinaxai', 12_000_000, vinaxaiPost],
  ];

  it.each(routes)('%s (cap %d bytes)', async (path, cap, handler) => {
    const fetchSpy = vi.fn(() => Promise.resolve(new Response('{}')));
    vi.stubGlobal('fetch', fetchSpy);
    const pulls = { n: 0 };
    const total = cap * 4;
    const res = await handler({ request: post(path, chunkedBody(total, pulls)), env });
    expect(res.status).toBe(413);
    expect(((await res.json()) as { error: string }).error).toBe('too_large');
    expect(pulls.n).toBeLessThan(Math.ceil(total / 8_192)); // cut short, not drained
    expect(fetchSpy).not.toHaveBeenCalled(); // no engine was asked
  });

  it.each(routes)('%s refuses an oversized declared content-length', async (path, cap, handler) => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('{}'))));
    const res = await handler({ request: post(path, '{}', { 'content-length': String(cap + 1) }), env });
    expect(res.status).toBe(413);
  });

  it.each(routes)('%s still answers 400 for malformed or non-object JSON', async (path, _cap, handler) => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('{}'))));
    expect((await handler({ request: post(path, '{nope'), env })).status).toBe(400);
    expect((await handler({ request: post(path, 'null'), env })).status).toBe(400);
  });
});

/** A fetch that never answers on its own — it only settles when aborted. */
function hangingFetch(): ReturnType<typeof vi.fn> {
  return vi.fn((_input: RequestInfo | URL, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    }),
  );
}

describe('outbound timeouts', () => {
  const imgReq = (): { request: Request } => ({ request: new Request('https://example.test/img?url=' + encodeURIComponent('https://c.saavncdn.com/a.jpg')) });

  it('/img gives up on a hung artwork host with a 504', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', hangingFetch());
    const pending = imgGet(imgReq());
    await vi.advanceTimersByTimeAsync(8_100);
    expect((await pending).status).toBe(504);
  });

  it('/img clears the leash on headers — a slow image body still streams through', async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    vi.stubGlobal('fetch', (_input: RequestInfo | URL, init?: RequestInit) => {
      signal = init?.signal ?? undefined;
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          setTimeout(() => {
            controller.enqueue(new Uint8Array([1, 2, 3]));
            controller.close();
          }, 20_000);
        },
      });
      return Promise.resolve(new Response(body, { status: 200, headers: { 'content-type': 'image/png' } }));
    });
    const res = await imgGet(imgReq());
    const bytes = res.arrayBuffer();
    await vi.advanceTimersByTimeAsync(25_000);
    expect((await bytes).byteLength).toBe(3);
    expect(signal?.aborted).toBe(false);
  });

  it('the release lookup and asset fetch abandon a hung upstream and report null', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', hangingFetch());
    const env = { GITHUB_TOKEN: 't' };
    const release = latestRelease(env);
    const asset = fetchAsset(env, 'https://api.github.com/repos/o/r/releases/assets/1');
    await vi.advanceTimersByTimeAsync(10_100);
    expect(await release).toBeNull();
    expect(await asset).toBeNull();
  });
});

describe('chat() — a response body that stalls after headers', () => {
  it('is cut by the attempt leash and the ladder moves on', async () => {
    vi.useFakeTimers();
    let n = 0;
    vi.stubGlobal('fetch', (_input: RequestInfo | URL, init?: RequestInit) => {
      n += 1;
      if (n > 1) return Promise.resolve(new Response(JSON.stringify({ choices: [{ message: { content: 'rescued' } }] }), { status: 200 }));
      // Headers at once, then a body that never completes unless aborted.
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"choices":[{"message":{"content":"never fin'));
          init?.signal?.addEventListener('abort', () => controller.error(new DOMException('aborted', 'AbortError')));
        },
      });
      return Promise.resolve(new Response(body, { status: 200 }));
    });
    const env = { VINAX_NVD_NEMOTRON_3_5_LIGHTNING_30B_A3B: 'k1', VINAX_OAI_GPT_OSS_20B: 'k2' };
    const pending = chat(env, [{ role: 'user', content: 'hi' }], { lane: 'chat', timeoutMs: 4_000, deadlineAt: Date.now() + 30_000 });
    await vi.advanceTimersByTimeAsync(4_100);
    const r = await pending;
    expect(r.content).toBe('rescued');
    expect(n).toBeGreaterThanOrEqual(2);
  });
});
