/**
 * v5.11.2 — the sandbox that makes "Run" real. VinaX AI renders HTML / SVG /
 * JavaScript the assistant writes inside an iframe. A srcdoc / about:blank /
 * blob: document INHERITS the app's Content-Security-Policy (script-src is a
 * strict hash list), so every inline <script> in a generated page was
 * silently blocked — the preview stayed blank and "Open" gave an empty
 * about:blank tab. Documents served over the network carry their OWN policy,
 * so the client POSTs the page here (a plain form submission targeting the
 * iframe) and gets it echoed back with a permissive CSP of its own.
 *
 * Safety: the iframe is sandboxed without allow-same-origin (opaque origin —
 * no cookies, no storage, no DOM access to the app), the page can only be
 * embedded by the app (frame-ancestors), is never cached or indexed, and is
 * capped in size and rate. A small reporter is injected so runtime errors
 * reach the chat (postMessage) instead of a blank box.
 */
import { methodNotAllowed, rateLimit } from '../_lib/ratelimit';

const MAX_BYTES = 600_000;
const APP_ORIGINS = ['https://www.sirimillavinay.online', 'https://sirimillavinay.online', 'http://localhost:5173', 'http://localhost:4173'];

const REPORTER = `<script>
(function(){
  var T=document.currentScript&&document.currentScript.getAttribute('data-token')||'';
  function send(kind,text){try{parent.postMessage({vxPreview:T,kind:kind,text:String(text)},'*')}catch(e){}}
  var nativeError=console.error;
  console.error=function(){var a=Array.prototype.map.call(arguments,function(x){try{return typeof x==='string'?x:JSON.stringify(x)}catch(e){return String(x)}}).join(' ');send('error',a);try{nativeError.apply(console,arguments)}catch(e){}};
  var nativeLog=console.log;
  console.log=function(){var a=Array.prototype.map.call(arguments,function(x){try{return typeof x==='string'?x:JSON.stringify(x)}catch(e){return String(x)}}).join(' ');send('log',a);try{nativeLog.apply(console,arguments)}catch(e){}};
  window.addEventListener('error',function(ev){send('error',(ev.error&&ev.error.stack)||ev.message||'Script error')});
  window.addEventListener('unhandledrejection',function(ev){send('error',(ev.reason&&ev.reason.stack)||String(ev.reason))});
  window.addEventListener('load',function(){send('ready','loaded')});
})();
</script>`;

/** Put the reporter first so it sees every error, wherever <head> is. */
export function instrument(html: string, token: string): string {
  const tag = REPORTER.replace('<script>', `<script data-token="${token.replace(/[^\w-]/g, '')}">`);
  const head = /<head[^>]*>/i.exec(html);
  if (head && head.index !== undefined) {
    const at = head.index + head[0].length;
    return `${html.slice(0, at)}\n${tag}\n${html.slice(at)}`;
  }
  const doc = /<html[^>]*>/i.exec(html);
  if (doc && doc.index !== undefined) {
    const at = doc.index + doc[0].length;
    return `${html.slice(0, at)}\n${tag}\n${html.slice(at)}`;
  }
  return `<!doctype html><meta charset="utf-8">\n${tag}\n${html}`;
}

export const onRequestOptions = async (): Promise<Response> =>
  new Response(null, { status: 204, headers: { allow: 'POST, OPTIONS', 'cache-control': 'no-store' } });

export const onRequestGet = async (): Promise<Response> => methodNotAllowed();

export const onRequestPost = async (context: { request: Request; env?: Record<string, unknown> }): Promise<Response> => {
  const { request } = context;
  const rl = rateLimit(request, 'preview', { capacity: 60, refillPerMinute: 60 }, context.env as never);
  if (rl) return rl;

  const len = Number(request.headers.get('content-length') || 0);
  if (len > MAX_BYTES * 1.4) return new Response('Preview too large', { status: 413, headers: { 'cache-control': 'no-store' } });

  let html: string;
  let token: string;
  let title = 'Preview';
  const ct = request.headers.get('content-type') || '';
  try {
    if (ct.includes('application/x-www-form-urlencoded') || ct.includes('multipart/form-data')) {
      const form = await request.formData();
      html = String(form.get('html') ?? '');
      token = String(form.get('token') ?? '');
      title = String(form.get('title') ?? title);
    } else {
      const j = (await request.json()) as { html?: unknown; token?: unknown; title?: unknown };
      html = typeof j.html === 'string' ? j.html : '';
      token = typeof j.token === 'string' ? j.token : '';
      title = typeof j.title === 'string' ? j.title : title;
    }
  } catch {
    return new Response('Bad request', { status: 400, headers: { 'cache-control': 'no-store' } });
  }
  if (!html.trim()) return new Response('Nothing to preview', { status: 400, headers: { 'cache-control': 'no-store' } });
  if (html.length > MAX_BYTES) return new Response('Preview too large', { status: 413, headers: { 'cache-control': 'no-store' } });

  // Without a title tag the "Open" tab reads about:blank-ish; give it one.
  let body = instrument(html, token);
  if (!/<title[\s>]/i.test(body)) body = body.replace(/(<head[^>]*>)/i, `$1<title>${title.replace(/[<>&]/g, '').slice(0, 80)}</title>`);

  return new Response(body, {
    status: 200,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'x-robots-tag': 'noindex, nofollow',
      'referrer-policy': 'no-referrer',
      // Its own policy: inline scripts/styles and any https resource (CDN
      // libraries the assistant reaches for), but only the app may frame it.
      'content-security-policy': `default-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob: https: http:; frame-ancestors ${APP_ORIGINS.join(' ')}; base-uri 'none'`,
      'x-content-type-options': 'nosniff',
      'cross-origin-opener-policy': 'unsafe-none',
    },
  });
};
