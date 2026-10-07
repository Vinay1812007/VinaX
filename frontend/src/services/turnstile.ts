/**
 * 11.1.0 — human check (Turnstile) for the few writes a script could abuse.
 *
 * The widget runs in "interaction-only" mode: almost every listener sees
 * nothing at all and gets a token in the background; only when the check
 * needs a tap does a small box appear in the slot it was given (the slot
 * carries data-check="interactive" while it shows).
 *
 *   mountHumanCheck(host, action) → { token(), remove() }
 *       renders into `host` straight away, so a token is usually ready by the
 *       time the listener presses Continue. token() hands over the current
 *       token (one use each) and starts minting the next one.
 *   oneShotHumanToken(action)
 *       for a request made with no form on screen (a parked username claim
 *       retried later): a temporary floating slot, removed once done.
 *
 * Both resolve to null when the check is off, the script cannot load or the
 * widget fails. The request is then sent without a token and the server
 * decides (backend/worker/functions/_lib/turnstile.ts).
 */
import { isNativePlatform } from '@/services/native';

/**
 * Public site key of the Turnstile widget (Cloudflare dashboard → Turnstile).
 * Not a secret: it ships in the page. Empty = the check is off in the app.
 * Widget "sirimillavinay.online": Managed, hostname sirimillavinay.online.
 */
export const TURNSTILE_SITE_KEY = '0x4AAAAAAFQTTp2fbL-zrUTa';
/** Cloudflare's always-pass test key, used by `npm run dev` on localhost. */
const DEV_TEST_KEY = '1x00000000000000000000AA';
const SCRIPT = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
/** How long to wait for a token the listener does not have to act on. */
const SILENT_WAIT_MS = 20_000;
/** How long to wait once the widget has asked the listener to tap it. */
const INTERACTIVE_WAIT_MS = 120_000;

interface TurnstileApi {
  render(host: HTMLElement, opts: Record<string, unknown>): string | undefined;
  reset(id: string): void;
  remove(id: string): void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

function siteKey(): string {
  // `npm run dev` only — unit tests (mode "test") never load the widget.
  if (import.meta.env.MODE === 'development') return DEV_TEST_KEY;
  // VITE_TURNSTILE_SITE_KEY overrides the constant (a test or a staging build).
  const key = import.meta.env.VITE_TURNSTILE_SITE_KEY || TURNSTILE_SITE_KEY;
  if (!key || typeof location === 'undefined') return '';
  // The widget only accepts the hostnames it was set up for. The Android app
  // loads the production origin, so it passes; preview and test builds on
  // other hosts skip the check instead of showing a widget error.
  const host = location.hostname;
  const ours = host === 'sirimillavinay.online' || host.endsWith('.sirimillavinay.online');
  return ours || isNativePlatform() ? key : '';
}

/** True when claims should carry a token. */
export function turnstileEnabled(): boolean {
  return siteKey() !== '';
}

let loading: Promise<TurnstileApi> | null = null;

function loadScript(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (loading) return loading;
  loading = new Promise<TurnstileApi>((resolve, reject) => {
    const s = document.createElement('script');
    s.src = SCRIPT;
    s.async = true;
    const fail = (): void => {
      window.clearTimeout(timer);
      s.remove();
      loading = null; // a later attempt may load it
      reject(new Error('turnstile script unavailable'));
    };
    const timer = window.setTimeout(fail, 10_000);
    s.onload = () => {
      window.clearTimeout(timer);
      if (window.turnstile) resolve(window.turnstile);
      else fail();
    };
    s.onerror = fail;
    document.head.appendChild(s);
  });
  return loading;
}

export interface HumanCheck {
  /** A one-use token, or null when none could be had. */
  token(): Promise<string | null>;
  /** Take the widget down. Pending token() calls resolve to null. */
  remove(): void;
}

const OFF: HumanCheck = { token: () => Promise.resolve(null), remove: () => undefined };

export function mountHumanCheck(host: HTMLElement, action: string): HumanCheck {
  const key = siteKey();
  if (!key) return OFF;
  let api: TurnstileApi | null = null;
  let id: string | null = null;
  let current: string | null = null;
  let dead = false;
  let interactive = false;
  const waiters = new Set<(t: string | null) => void>();
  const flush = (t: string | null): void => {
    for (const w of [...waiters]) w(t);
  };
  // The host is styled by this: it only takes room while the box is showing.
  const setInteractive = (on: boolean): void => {
    interactive = on;
    if (on) host.dataset.check = 'interactive';
    else delete host.dataset.check;
  };

  void loadScript()
    .then((ts) => {
      if (dead) return;
      api = ts;
      id =
        ts.render(host, {
          sitekey: key,
          action,
          appearance: 'interaction-only',
          size: 'flexible',
          theme: document.documentElement.classList.contains('dark') ? 'dark' : 'light',
          'refresh-expired': 'auto',
          callback: (t: string) => {
            setInteractive(false);
            current = t;
            flush(t);
          },
          'expired-callback': () => {
            current = null;
          },
          'before-interactive-callback': () => setInteractive(true),
          'after-interactive-callback': () => setInteractive(false),
          // Returning true marks the error handled; the widget retries on its
          // own while anyone waiting goes ahead without a token.
          'error-callback': () => {
            flush(null);
            return true;
          },
          'timeout-callback': () => {
            current = null;
            flush(null);
          },
        }) ?? null;
      if (!id) {
        dead = true;
        flush(null);
      }
    })
    .catch(() => {
      dead = true;
      flush(null);
    });

  return {
    token() {
      if (current) {
        const t = current;
        current = null;
        // Tokens work once; start on the next one for a possible retry.
        if (api && id) api.reset(id);
        return Promise.resolve(t);
      }
      if (dead) return Promise.resolve(null);
      return new Promise<string | null>((resolve) => {
        let timer = 0;
        const done = (t: string | null): void => {
          window.clearTimeout(timer);
          waiters.delete(done);
          if (t && t === current) {
            current = null;
            if (api && id) api.reset(id);
          }
          resolve(t);
        };
        const arm = (ms: number): void => {
          timer = window.setTimeout(() => {
            // The listener was asked to tap the box: give them time to do it.
            if (interactive && ms === SILENT_WAIT_MS) arm(INTERACTIVE_WAIT_MS);
            else done(null);
          }, ms);
        };
        waiters.add(done);
        arm(SILENT_WAIT_MS);
      });
    },
    remove() {
      dead = true;
      flush(null);
      if (api && id) api.remove(id);
      id = null;
    },
  };
}

/** One token with no form on screen: a temporary floating slot, removed after. */
export async function oneShotHumanToken(action: string): Promise<string | null> {
  if (!turnstileEnabled() || typeof document === 'undefined') return null;
  const host = document.createElement('div');
  host.className = 'vx-human-check-float';
  document.body.appendChild(host);
  const check = mountHumanCheck(host, action);
  try {
    return await check.token();
  } finally {
    check.remove();
    host.remove();
  }
}
