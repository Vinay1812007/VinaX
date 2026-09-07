/**
 * v5.11.3 — the sandbox that makes "Run" real, and the last hop of the chain
 * AI response -> code block UI -> Run -> sandbox/runtime -> output.
 *
 * VinaX AI renders HTML / SVG / JavaScript the assistant writes inside an
 * iframe. A srcdoc / about:blank / blob: document INHERITS the app's
 * Content-Security-Policy (script-src is a strict hash list), so every inline
 * <script> in a generated page was silently blocked — the preview stayed blank
 * and "Open" gave an empty about:blank tab. Documents served over the network
 * carry their OWN policy, so the client POSTs the page here (a plain form
 * submission targeting the sandboxed iframe) and gets it echoed back with a
 * permissive policy of its own.
 *
 * SECURITY — this endpoint reflects caller-supplied HTML, so three controls do
 * the load-bearing work:
 *  1. `sandbox` in the response CSP. Without it the reflection would be a
 *     same-origin XSS sink: "Open in a new tab" is a TOP-LEVEL document at
 *     www.sirimillavinay.online, where an iframe's sandbox attribute does not
 *     apply and frame-ancestors is irrelevant. The CSP sandbox directive
 *     applies to the document itself, top-level included, so the page always
 *     runs in an opaque origin — no cookies, no app localStorage, no service
 *     worker, no DOM access to the app.
 *  2. A same-origin gate (Sec-Fetch-Site, falling back to Origin). Without it
 *     any third-party page could POST here and host content under this domain.
 *  3. A streaming body cap, so a bodyless-Content-Length upload cannot buffer
 *     the isolate to death (which would also reset the rate-limit state).
 * Plus: never cached, never indexed, rate limited, and only the app may frame
 * it. The injected reporter turns runtime failures into postMessage events so
 * the chat shows an error instead of a blank box, and shims the storage APIs
 * that throw in an opaque origin (the single most common way an AI-written
 * page dies on line 1).
 */
import { methodNotAllowed, rateLimit } from '../_lib/ratelimit';

/** Largest page we will echo. */
const MAX_BYTES = 600_000;
/** Raw request cap — urlencoded expansion measured at worst ~1.64x. */
const MAX_BODY = MAX_BYTES * 2;

/** Origins the app is actually served from. Deliberately NO *.pages.dev: the
 *  Worker only routes /api/* on www, so a pages.dev embedder could never
 *  reach this endpoint anyway, and listing it would widen framing for free. */
const APP_ORIGINS = [
  'https://www.sirimillavinay.online',
  'https://sirimillavinay.online',
  'http://localhost:5173',
  'http://localhost:4173',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:4173',
];

/** Sandbox flags, kept identical in the CSP and on the client's iframe — the
 *  effective sandbox is the INTERSECTION of the two, so they must agree. */
const SANDBOX = 'allow-scripts allow-forms allow-modals allow-popups allow-pointer-lock allow-downloads';

/**
 * Injected first, before any page script. It (a) shims the storage APIs that
 * THROW in an opaque origin, (b) mirrors console / alert / errors / CSP
 * violations / failed subresource loads back to the chat, and (c) announces
 * that the document loaded so the UI can tell "finished quietly" apart from
 * "never arrived". Plain ES5 in one inline <script>: no backticks and no
 * ${ } so it survives this template literal untouched.
 */
const REPORTER = `<script>
(function(){
  var T=document.currentScript&&document.currentScript.getAttribute('data-token')||'';
  function send(kind,text){try{parent.postMessage({vxPreview:T,kind:kind,text:String(text)},'*')}catch(e){}}
  function fmt(a){return Array.prototype.map.call(a,function(x){try{return typeof x==='string'?x:JSON.stringify(x)}catch(e){return String(x)}}).join(' ')}
  function def(o,p,v){try{Object.defineProperty(o,p,{value:v,configurable:true,writable:true})}catch(e){}}
  function dead(o,p){try{void o[p];return false}catch(e){return true}}

  /* --- storage: reading these throws SecurityError in an opaque origin --- */
  function memStore(){
    var m=Object.create(null);
    var api={
      getItem:function(k){k=String(k);return k in m?m[k]:null},
      setItem:function(k,v){m[String(k)]=String(v)},
      removeItem:function(k){delete m[String(k)]},
      clear:function(){m=Object.create(null)},
      key:function(i){var ks=Object.keys(m);return i<ks.length?ks[i]:null}
    };
    try{Object.defineProperty(api,'length',{get:function(){return Object.keys(m).length},configurable:true})}catch(e){}
    try{
      return new Proxy(api,{
        get:function(o,p){return p in o?o[p]:(typeof p==='string'&&p in m?m[p]:undefined)},
        set:function(o,p,v){if(p in o){o[p]=v}else{m[String(p)]=String(v)}return true},
        has:function(o,p){return p in o||p in m},
        deleteProperty:function(o,p){delete m[String(p)];return true}
      });
    }catch(e){return api}
  }
  if(dead(window,'localStorage'))def(window,'localStorage',memStore());
  if(dead(window,'sessionStorage'))def(window,'sessionStorage',memStore());
  if(dead(document,'cookie'))def(document,'cookie','');

  /* --- console --- */
  var nLog=console.log,nErr=console.error,nWarn=console.warn;
  def(console,'log',function(){send('log',fmt(arguments));try{nLog.apply(console,arguments)}catch(e){}});
  def(console,'info',function(){send('log',fmt(arguments));try{nLog.apply(console,arguments)}catch(e){}});
  def(console,'debug',function(){send('log',fmt(arguments));try{nLog.apply(console,arguments)}catch(e){}});
  def(console,'warn',function(){send('log',fmt(arguments));try{nWarn.apply(console,arguments)}catch(e){}});
  def(console,'error',function(){send('error',fmt(arguments));try{nErr.apply(console,arguments)}catch(e){}});

  /* --- dialogs: a hidden runner frame swallows these, so mirror the text --- */
  var nA=window.alert,nC=window.confirm,nP=window.prompt;
  def(window,'alert',function(m){send('log','alert: '+String(m));try{return nA.call(window,m)}catch(e){}});
  def(window,'confirm',function(m){send('log','confirm: '+String(m));try{return nC.call(window,m)}catch(e){return false}});
  def(window,'prompt',function(m,d){send('log','prompt: '+String(m));try{return nP.call(window,m,d)}catch(e){return d===undefined?null:d}});

  /* --- failures --- */
  window.addEventListener('error',function(ev){send('error',(ev.error&&ev.error.stack)||ev.message||'Script error')});
  /* capture phase: a failed <script src>/<img>/<link> does not bubble */
  window.addEventListener('error',function(ev){
    var t=ev.target;
    if(t&&t!==window&&(t.src||t.href))send('error','Failed to load '+String(t.tagName||'').toLowerCase()+': '+String(t.src||t.href));
  },true);
  window.addEventListener('unhandledrejection',function(ev){send('error',(ev.reason&&ev.reason.stack)||String(ev.reason))});
  document.addEventListener('securitypolicyviolation',function(ev){send('error','Blocked by the preview sandbox: '+String(ev.violatedDirective)+' — '+String(ev.blockedURI))});
  window.addEventListener('load',function(){send('ready','loaded')});
})();
</script>`;

/** Put the reporter ahead of every page script, whatever shape the page is. */
export function instrument(html: string, token: string): string {
  const tag = REPORTER.replace('<script>', `<script data-token="${token.replace(/[^\w-]/g, '')}">`);
  const headM = /<head[^>]*>/i.exec(html);
  const scriptM = /<script\b/i.exec(html);
  const headAt = headM && headM.index !== undefined ? headM.index + headM[0].length : -1;
  const scriptAt = scriptM && scriptM.index !== undefined ? scriptM.index : -1;
  // Normally just inside <head>; but if a script somehow precedes <head>, go
  // in front of THAT — the reporter is worthless after the page's first line.
  let at = headAt;
  if (scriptAt >= 0 && (headAt < 0 || scriptAt < headAt)) at = scriptAt;
  if (at >= 0) return `${html.slice(0, at)}\n${tag}\n${html.slice(at)}`;
  const htmlM = /<html[^>]*>/i.exec(html);
  if (htmlM && htmlM.index !== undefined) {
    const a = htmlM.index + htmlM[0].length;
    return `${html.slice(0, a)}\n${tag}\n${html.slice(a)}`;
  }
  return `<!doctype html><meta charset="utf-8">\n${tag}\n${html}`;
}

const plain = (body: string, status: number): Response =>
  new Response(body, { status, headers: { 'cache-control': 'no-store' } });

/** Read at most `cap` bytes; null means the body ran past the cap. */
async function readCapped(body: ReadableStream<Uint8Array> | null, cap: number): Promise<Uint8Array | null> {
  if (!body) return new Uint8Array(0);
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > cap) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.byteLength;
  }
  return out;
}

/**
 * Only the app may drive this endpoint. Sec-Fetch-Site is set by the browser
 * and cannot be forged from page script; Origin is the fallback for clients
 * that do not send it. A cross-site POST is what would turn this into a
 * content host for someone else's page under our domain.
 */
export function isSameOriginRequest(request: Request): boolean {
  const site = request.headers.get('sec-fetch-site');
  if (site) return site === 'same-origin';
  const origin = request.headers.get('origin');
  return !!origin && APP_ORIGINS.includes(origin);
}

export const onRequestOptions = async (): Promise<Response> =>
  new Response(null, { status: 204, headers: { allow: 'POST, OPTIONS', 'cache-control': 'no-store' } });

// GET must never render: the service worker caches successful HTML
// navigations as the app shell, so a renderable GET here would let a crafted
// link overwrite the cached shell.
export const onRequestGet = async (): Promise<Response> => methodNotAllowed();

export const onRequestPost = async (context: { request: Request; env?: Record<string, unknown> }): Promise<Response> => {
  const { request } = context;
  if (!isSameOriginRequest(request)) return plain('Forbidden', 403);

  const rl = rateLimit(request, 'preview', { capacity: 60, refillPerMinute: 60 }, context.env as never);
  if (rl) return rl;

  const declared = Number(request.headers.get('content-length') || 0);
  if (declared > MAX_BODY) return plain('Preview too large', 413);

  const ct = request.headers.get('content-type') || '';
  // Cap while READING: content-length is absent on a chunked body, so the
  // declared check above cannot be the only guard.
  const raw = await readCapped(request.body, MAX_BODY);
  if (raw === null) return plain('Preview too large', 413);

  let html: string;
  let token: string;
  let title = 'Preview';
  try {
    const buffered = new Response(raw.buffer as ArrayBuffer, { headers: { 'content-type': ct } });
    if (ct.includes('application/x-www-form-urlencoded') || ct.includes('multipart/form-data')) {
      const form = await buffered.formData();
      html = String(form.get('html') ?? '');
      token = String(form.get('token') ?? '');
      title = String(form.get('title') ?? title);
    } else {
      const j = (await buffered.json()) as { html?: unknown; token?: unknown; title?: unknown };
      html = typeof j.html === 'string' ? j.html : '';
      token = typeof j.token === 'string' ? j.token : '';
      title = typeof j.title === 'string' ? j.title : title;
    }
  } catch {
    return plain('Bad request', 400);
  }
  if (!html.trim()) return plain('Nothing to preview', 400);
  if (html.length > MAX_BYTES) return plain('Preview too large', 413);

  // Without a title tag the "Open" tab reads about:blank-ish; give it one.
  // Function replacement — a title containing $& or $' must not expand.
  let body = instrument(html, token);
  if (!/<title[\s>]/i.test(body)) {
    const safe = title.replace(/[<>&]/g, '').slice(0, 80);
    body = body.replace(/<head[^>]*>/i, (m) => `${m}<title>${safe}</title>`);
  }

  return new Response(body, {
    status: 200,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'x-robots-tag': 'noindex, nofollow',
      'referrer-policy': 'no-referrer',
      // Its own policy. `sandbox` is the security control (opaque origin even
      // at top level); the rest is deliberately wide so generated pages can
      // pull CDN libraries, fonts, images, media and websockets.
      'content-security-policy': `default-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob: https: wss:; frame-ancestors ${APP_ORIGINS.join(' ')}; base-uri 'none'; sandbox ${SANDBOX}`,
      'x-content-type-options': 'nosniff',
      // Isolate the browsing-context group, so a popup handle held by another
      // page cannot be used for cross-window leaks.
      'cross-origin-opener-policy': 'same-origin',
    },
  });
};
