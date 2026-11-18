/**
 * Node http <-> web Request/Response, with the Workers runtime's behaviour
 * where the two differ:
 *
 * - Hop-by-hop headers (connection, transfer-encoding, …) never reach a
 *   handler: undici's fetch refuses them, and a passthrough would forward them.
 * - A Response's `content-encoding: gzip|br|deflate|zstd` asks the Workers
 *   runtime to encode the body, and a body from fetch() is already decoded on
 *   both runtimes. Node sends bodies as they are, so those headers (and the
 *   now-wrong content-length) are dropped and the body goes out plain;
 *   Cloudflare compresses it on the way to the listener.
 * - Bodies are streamed chunk by chunk (VinaX AI's replies are SSE), and a
 *   listener who goes away cancels the body, like a page closing on Workers.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import { cfFromHeaders } from './bindings';

const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-connection',
  'transfer-encoding',
  'te',
  'trailer',
  'upgrade',
  'http2-settings',
  'expect',
]);

const ENCODINGS = /^\s*(gzip|br|deflate|zstd)\s*$/i;

export interface RequestOptions {
  /** Scheme when no x-forwarded-proto says otherwise (production: https). */
  protocol: 'http' | 'https';
  signal: AbortSignal;
}

/** Build the web Request a Worker handler receives, with `request.cf` attached. */
export function toWebRequest(req: IncomingMessage, opts: RequestOptions): Request {
  const headers = new Headers();
  const raw = req.rawHeaders;
  for (let i = 0; i + 1 < raw.length; i += 2) {
    const name = raw[i].toLowerCase();
    if (HOP_BY_HOP.has(name) || name.startsWith(':')) continue;
    headers.append(name, raw[i + 1]);
  }
  // Off Cloudflare (a local run) there is no cf-connecting-ip: use the
  // socket's address so per-address rate limits still tell callers apart.
  if (!headers.has('cf-connecting-ip') && req.socket.remoteAddress) headers.set('cf-connecting-ip', req.socket.remoteAddress);

  const forwarded = headers.get('x-forwarded-proto')?.split(',')[0]?.trim().toLowerCase();
  const proto = forwarded === 'http' || forwarded === 'https' ? forwarded : opts.protocol;
  const host = headers.get('host') ?? 'localhost';
  const url = new URL(req.url ?? '/', `${proto}://${host}`);

  const method = (req.method ?? 'GET').toUpperCase();
  const hasBody = method !== 'GET' && method !== 'HEAD';
  const init: RequestInit & { duplex?: 'half' } = { method, headers, signal: opts.signal };
  if (hasBody) {
    init.body = Readable.toWeb(req) as unknown as ReadableStream<Uint8Array>;
    init.duplex = 'half';
  }
  const request = new Request(url, init);
  Object.defineProperty(request, 'cf', { value: cfFromHeaders(headers), enumerable: false });
  return request;
}

/** The response headers Node should send, as [name, value] pairs. */
export function outgoingHeaders(response: Response): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  const encoded = ENCODINGS.test(response.headers.get('content-encoding') ?? '');
  response.headers.forEach((value, name) => {
    if (name === 'set-cookie' || HOP_BY_HOP.has(name)) return;
    if (encoded && (name === 'content-encoding' || name === 'content-length')) return;
    out.push([name, value]);
  });
  for (const cookie of response.headers.getSetCookie()) out.push(['set-cookie', cookie]);
  return out;
}

/** Write a web Response to Node's ServerResponse, streaming the body. */
export async function sendWebResponse(res: ServerResponse, response: Response, method: string): Promise<void> {
  const headers = outgoingHeaders(response);
  res.writeHead(response.status, response.statusText || undefined, headers.flat());
  const body = response.body;
  const noBody = method === 'HEAD' || response.status === 204 || response.status === 304 || (response.status >= 100 && response.status < 200);
  if (!body || noBody) {
    if (body) await body.cancel().catch(() => undefined);
    res.end();
    return;
  }
  res.flushHeaders();
  const reader = body.getReader();
  const onClose = (): void => {
    if (!res.writableFinished) reader.cancel().catch(() => undefined);
  };
  res.on('close', onClose);
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (res.destroyed) break;
      if (!res.write(value)) {
        await new Promise<void>((resolve) => {
          const done = (): void => {
            res.off('drain', done);
            res.off('close', done);
            resolve();
          };
          res.on('drain', done);
          res.on('close', done);
        });
      }
    }
    res.end();
  } catch (e) {
    // The body failed half way (an upstream dropped): cut the connection so
    // the client sees an incomplete reply rather than a clean end.
    if (!res.destroyed) res.destroy(e instanceof Error ? e : new Error(String(e)));
  } finally {
    res.off('close', onClose);
  }
}
