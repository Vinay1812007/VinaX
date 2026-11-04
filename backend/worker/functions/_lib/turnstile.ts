/**
 * Cloudflare Turnstile — the human check on sign-in (the app's Google
 * sign-in and the console's Google and recovery-password sign-in).
 *
 * On only when BOTH are set on the Worker: the public site key
 * (`TURNSTILE_SITE_KEY`, a plain var) and the secret (`TURNSTILE_SECRET_KEY`).
 * Until then every check passes, so the code can ship before the keys exist.
 *
 * The page shows the widget with the site key, gets a one-use token and sends
 * it as `turnstile` with the sign-in. The Worker checks it with Siteverify:
 * success, the action the page named, and a hostname of ours. Each token can
 * be checked once and lives five minutes, so a failed sign-in needs a new one.
 */
export interface TurnstileEnv {
  TURNSTILE_SITE_KEY?: string;
  TURNSTILE_SECRET_KEY?: string;
}

export type TurnstileAction = 'app-signin' | 'console-signin';

const SITEVERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
/** Tokens are at most 2048 characters (Cloudflare's docs). */
const MAX_TOKEN = 2048;

/** Hosts a token may come from: vinaxmusic.online and its subdomains. */
const OUR_HOST = /^(?:[a-z0-9-]+\.)*vinaxmusic\.online$/;

const siteKeyOf = (env: TurnstileEnv): string | null => env.TURNSTILE_SITE_KEY?.trim() || null;
const secretOf = (env: TurnstileEnv): string | null => env.TURNSTILE_SECRET_KEY?.trim() || null;

/** The site key the page renders the widget with, or null when the check is off. */
export function turnstileSiteKey(env: TurnstileEnv): string | null {
  return siteKeyOf(env) && secretOf(env) ? siteKeyOf(env) : null;
}

export const turnstileOn = (env: TurnstileEnv): boolean => turnstileSiteKey(env) !== null;

/**
 * ok: passed (or the check is off) · missing: no token sent · failed: Cloudflare
 * said no, or the token was for another action or site · unavailable:
 * Siteverify could not be reached (the caller decides whether to let it pass).
 */
export type TurnstileVerdict = 'ok' | 'missing' | 'failed' | 'unavailable';

export async function verifyTurnstile(env: TurnstileEnv, token: unknown, request: Request, action: TurnstileAction, fetchImpl: typeof fetch = fetch): Promise<TurnstileVerdict> {
  const secret = secretOf(env);
  if (!turnstileOn(env) || !secret) return 'ok';
  if (typeof token !== 'string' || !token || token.length > MAX_TOKEN) return 'missing';
  const form = new FormData();
  form.append('secret', secret);
  form.append('response', token);
  const ip = request.headers.get('cf-connecting-ip');
  if (ip) form.append('remoteip', ip);
  try {
    const res = await fetchImpl(SITEVERIFY, { method: 'POST', body: form, signal: AbortSignal.timeout(8_000) });
    if (!res.ok) return 'unavailable';
    const j = (await res.json().catch(() => null)) as { success?: unknown; action?: unknown; hostname?: unknown; 'error-codes'?: unknown } | null;
    if (!j) return 'unavailable';
    const ok = j.success === true && j.action === action && typeof j.hostname === 'string' && OUR_HOST.test(j.hostname);
    if (!ok) {
      // Why it failed (Cloudflare's error codes, the action and host it saw), for the Worker's logs. No token or IP.
      console.warn('turnstile failed', JSON.stringify({ want: action, success: j.success === true, action: j.action ?? null, hostname: j.hostname ?? null, codes: j['error-codes'] ?? null }));
    }
    return ok ? 'ok' : 'failed';
  } catch {
    return 'unavailable';
  }
}
