/**
 * Cloudflare Turnstile — the human check that goes with every sign-in.
 *
 * GET /api/auth/google names the site key (null while the owner has not set
 * Turnstile up: then there is no check at all). The sign-in control shows the
 * widget under the Google button (`mountTurnstile`), as the console does; it
 * usually passes on its own while the page is read. A sign-in made where no
 * widget is on screen runs one in a small panel instead. Each token works
 * once, so the widget runs again after every try.
 *
 * Loaded on demand, so it costs the first page load nothing.
 */
const SCRIPT = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
/** Give up after this long (a challenge the listener left open). */
const TIMEOUT_MS = 90_000;

interface TurnstileApi {
  render(el: HTMLElement, o: Record<string, unknown>): string | undefined;
  remove(id: string): void;
  reset(id: string): void;
}

let keyLoad: Promise<string | null> | null = null;
let scriptLoad: Promise<TurnstileApi | null> | null = null;

/** The site key, asked once per page. Null: no check (off, or the server can't say). */
export function turnstileSiteKey(origin: string, fetchImpl: typeof fetch = fetch): Promise<string | null> {
  if (!keyLoad) {
    keyLoad = fetchImpl(`${origin}/api/auth/google`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { turnstileSiteKey?: unknown } | null) => (typeof j?.turnstileSiteKey === 'string' && j.turnstileSiteKey ? j.turnstileSiteKey : null))
      .catch(() => {
        keyLoad = null;
        return null;
      });
  }
  return keyLoad;
}

function loadScript(): Promise<TurnstileApi | null> {
  const ready = (window as unknown as { turnstile?: TurnstileApi }).turnstile;
  if (ready) return Promise.resolve(ready);
  if (!scriptLoad) {
    scriptLoad = new Promise((resolve) => {
      const s = document.createElement('script');
      s.src = SCRIPT;
      s.async = true;
      s.onload = () => resolve((window as unknown as { turnstile?: TurnstileApi }).turnstile ?? null);
      s.onerror = () => {
        scriptLoad = null;
        s.remove();
        resolve(null);
      };
      document.head.appendChild(s);
    });
  }
  return scriptLoad;
}

interface Mounted {
  api: TurnstileApi;
  id: string;
  token: string | null;
  failed: boolean;
  waiters: Array<(token: string | null) => void>;
}
/** The widget on screen under the sign-in button, if any. */
let mounted: Mounted | null = null;

function settle(m: Mounted, token: string | null): void {
  m.token = token;
  m.failed = token === null;
  const waiting = m.waiters.splice(0);
  for (const w of waiting) w(token);
}

/**
 * Show the check under a sign-in button (the welcome page, the sign-in
 * sheet). It runs as soon as it is drawn, so its token is usually ready by
 * the time someone taps Sign in. False when there is no check (off) or it
 * could not load; the returned cleanup removes it.
 */
export async function mountTurnstile(el: HTMLElement, origin: string, action: 'app-signin'): Promise<(() => void) | false> {
  const siteKey = await turnstileSiteKey(origin);
  if (!siteKey || !el.isConnected) return false;
  const api = await loadScript();
  if (!api || !el.isConnected) return false;
  const m: Mounted = { api, id: '', token: null, failed: false, waiters: [] };
  try {
    const id = api.render(el, {
      sitekey: siteKey,
      action,
      theme: document.documentElement.classList.contains('light') ? 'light' : 'dark',
      'refresh-expired': 'auto',
      callback: (token: string) => settle(m, token),
      'expired-callback': () => { m.token = null; },
      'error-callback': () => { settle(m, null); return true; },
    });
    if (!id) return false;
    m.id = id;
  } catch {
    return false;
  }
  mounted = m;
  return () => {
    if (mounted === m) mounted = null;
    settle(m, null);
    try { api.remove(m.id); } catch { /* already gone */ }
  };
}

/** Wait for the widget on screen; its token is used once, then the widget runs again for the next try. */
function takeMounted(m: Mounted): Promise<string | null> {
  const take = (token: string | null): string | null => {
    if (token) {
      m.token = null;
      try { m.api.reset(m.id); } catch { /* gone */ }
    }
    return token;
  };
  if (m.token) return Promise.resolve(take(m.token));
  if (m.failed) {
    // It failed earlier: run it again and wait for the new answer.
    m.failed = false;
    try { m.api.reset(m.id); } catch { /* gone */ }
  }
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => {
      m.waiters = m.waiters.filter((w) => w !== done);
      resolve(null);
    }, TIMEOUT_MS);
    const done = (token: string | null): void => {
      window.clearTimeout(timer);
      resolve(take(token));
    };
    m.waiters.push(done);
  });
}

/**
 * A fresh token for one sign-in. `undefined`: no check is needed (Turnstile
 * is off). `null`: the check could not run or did not pass. Uses the widget
 * on screen when there is one; otherwise runs one in a small panel.
 */
export async function turnstileToken(origin: string, action: 'app-signin'): Promise<string | null | undefined> {
  const siteKey = await turnstileSiteKey(origin);
  if (!siteKey) return undefined;
  if (mounted) return takeMounted(mounted);
  const api = await loadScript();
  if (!api) return null;
  const panel = document.createElement('div');
  panel.className = 'vx-turnstile';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'Security check');
  document.body.appendChild(panel);
  return new Promise((resolve) => {
    let id: string | undefined;
    let done = false;
    const finish = (token: string | null): void => {
      if (done) return;
      done = true;
      window.clearTimeout(timer);
      try { if (id) api.remove(id); } catch { /* already gone */ }
      panel.remove();
      resolve(token);
    };
    const timer = window.setTimeout(() => finish(null), TIMEOUT_MS);
    try {
      id = api.render(panel, {
        sitekey: siteKey,
        action,
        appearance: 'interaction-only',
        theme: document.documentElement.classList.contains('light') ? 'light' : 'dark',
        callback: (token: string) => finish(token),
        'error-callback': () => { finish(null); return true; },
        'expired-callback': () => finish(null),
        'timeout-callback': () => finish(null),
      });
    } catch {
      finish(null);
    }
  });
}

/** Tests: forget the cached key and script. */
export function resetTurnstileForTests(): void {
  keyLoad = null;
  scriptLoad = null;
  mounted = null;
}
