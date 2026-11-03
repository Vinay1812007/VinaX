/**
 * Cloudflare Turnstile — the human check that goes with every sign-in.
 *
 * GET /api/auth/google names the site key (null while the owner has not set
 * Turnstile up: then there is no check at all). At sign-in a widget runs in a
 * small panel at the bottom of the screen; most people pass without doing
 * anything ("interaction-only" shows it only when Cloudflare wants a click).
 * Each token works once, so every sign-in runs a fresh check.
 *
 * Loaded only when someone signs in, so it costs the first page nothing.
 */
const SCRIPT = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
/** Give up after this long (a challenge the listener left open). */
const TIMEOUT_MS = 90_000;

interface TurnstileApi {
  render(el: HTMLElement, o: Record<string, unknown>): string | undefined;
  remove(id: string): void;
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

/**
 * A fresh token for one sign-in. `undefined`: no check is needed (Turnstile
 * is off). `null`: the check could not run or did not pass.
 */
export async function turnstileToken(origin: string, action: 'app-signin'): Promise<string | null | undefined> {
  const siteKey = await turnstileSiteKey(origin);
  if (!siteKey) return undefined;
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
}
