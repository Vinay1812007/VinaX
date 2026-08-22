/**
 * Same-origin image proxy so canvas exports (share-as-image) aren't blocked by
 * the upstream CDN's missing CORS headers. Server-side fetch has no CORS
 * restriction; we re-emit the bytes with Access-Control-Allow-Origin. Limited
 * to known artwork hosts to avoid being an open proxy.
 */
// Audit finding M-SRV-1: the previous rule matched *.akamaized.net — a huge
// shared CDN that hosts many unrelated tenants, so a same-suffix subdomain
// takeover on any of them turned /img into an open image proxy under our
// access-control-allow-origin: * headers. Narrowed to the specific artwork
// hosts VinaX actually pulls from. saavn.akamaized.net is the one Saavn-branded
// akamai edge; if the upstream API ever starts returning others we'll add
// them explicitly rather than reintroducing the wildcard.
const ALLOWED = /(^|\.)(saavncdn\.com|jiosaavn\.com)$|^saavn\.akamaized\.net$/i;
const MAX_REDIRECTS = 3;

function hostOf(u: string): string | null {
  try {
    const parsed = new URL(u);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
    return parsed.hostname;
  } catch {
    return null;
  }
}

export const onRequestGet = async (context: { request: Request }): Promise<Response> => {
  const target = new URL(context.request.url).searchParams.get('url');
  if (!target) return new Response('missing url', { status: 400 });
  const initialHost = hostOf(target);
  if (!initialHost) return new Response('bad url', { status: 400 });
  if (!ALLOWED.test(initialHost)) return new Response('forbidden host', { status: 403 });

  // Follow redirects manually so an allowed CDN can't 302-punt us into an
  // arbitrary URL and turn /img into an open proxy (audit finding M14). A
  // classic subdomain-takeover on jiosaavn/akamai would otherwise let an
  // attacker have us serve any host they control with our
  // access-control-allow-origin: * headers.
  let url = target;
  let upstream: Response | null = null;
  for (let i = 0; i <= MAX_REDIRECTS; i++) {
    upstream = await fetch(url, {
      redirect: 'manual',
      cf: { cacheTtl: 86400, cacheEverything: true },
    } as RequestInit);
    // 3xx with a Location header: re-validate the host before following.
    if (upstream.status >= 300 && upstream.status < 400) {
      const next = upstream.headers.get('location');
      if (!next) return new Response('redirect without location', { status: 502 });
      const resolved = new URL(next, url).toString();
      const nextHost = hostOf(resolved);
      if (!nextHost || !ALLOWED.test(nextHost)) {
        return new Response('redirected to disallowed host', { status: 502 });
      }
      url = resolved;
      continue;
    }
    break;
  }
  if (!upstream) return new Response('no response', { status: 502 });
  if (!upstream.ok) return new Response('upstream error', { status: 502 });
  return new Response(upstream.body, {
    headers: {
      'content-type': upstream.headers.get('content-type') ?? 'image/jpeg',
      'access-control-allow-origin': '*',
      'cache-control': 'public, max-age=86400',
    },
  });
};
