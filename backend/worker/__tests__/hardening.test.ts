/**
 * Reliability hardening: size-capped request bodies (declared AND streamed),
 * and outbound timeouts that never outlive their purpose. Deterministic — fetch is stubbed and the
 * timer paths run on fake timers.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readCapped, readJsonCapped } from '../functions/_lib/body';
import { fetchAsset, latestRelease } from '../functions/_lib/github';
import { onRequestGet as imgGet } from '../functions/img';

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
