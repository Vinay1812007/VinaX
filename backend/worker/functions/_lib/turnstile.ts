/**
 * 11.1.0 — human check (Turnstile) for the few writes a script could abuse.
 *
 * The client renders the widget, gets a one-time token and sends it with the
 * request as `turnstile_token`; this module asks the siteverify endpoint
 * whether that token is real, unused, issued for one of our hostnames and for
 * the expected action.
 *
 *   verifyTurnstile(env, request, token, action)
 *     → 'ok'        token checked and valid
 *     → 'off'       TURNSTILE_SECRET_KEY unset: the check is not enforced
 *     → 'skipped'   siteverify unreachable, answered non-2xx, or could not
 *                   check the token (bad secret, internal error): let it
 *                   through — an outage or a setup slip must not stop real
 *                   listeners
 *     → 'missing'   no token sent
 *     → 'invalid'   siteverify said no (forged, expired, reused, wrong action)
 *
 * Callers refuse only 'missing' and 'invalid'.
 */
export interface TurnstileEnv {
  /** Secret key of the Turnstile widget. Unset = the check is off. */
  TURNSTILE_SECRET_KEY?: string;
}

export type TurnstileResult = 'ok' | 'off' | 'skipped' | 'missing' | 'invalid';

const SITEVERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
/** Tokens are at most 2048 characters; anything longer is not one. */
const MAX_TOKEN = 2048;
/** siteverify error codes that describe our setup or their service, not the token. */
const SERVER_SIDE_CODES = new Set(['missing-input-secret', 'invalid-input-secret', 'internal-error']);

interface SiteverifyReply {
  success?: boolean;
  action?: string;
  'error-codes'?: string[];
}

export async function verifyTurnstile(
  env: TurnstileEnv,
  request: Request,
  token: unknown,
  action: string,
): Promise<TurnstileResult> {
  const secret = env.TURNSTILE_SECRET_KEY?.trim();
  if (!secret) return 'off';
  if (typeof token !== 'string' || !token || token.length > MAX_TOKEN) return 'missing';
  const form = new FormData();
  form.append('secret', secret);
  form.append('response', token);
  const ip = request.headers.get('cf-connecting-ip');
  if (ip) form.append('remoteip', ip);
  let reply: SiteverifyReply;
  try {
    const res = await fetch(SITEVERIFY, { method: 'POST', body: form, signal: AbortSignal.timeout(5000) });
    if (!res.ok) {
      console.warn(`[turnstile] siteverify answered ${res.status}; letting the request through`);
      return 'skipped';
    }
    reply = (await res.json()) as SiteverifyReply;
  } catch (err) {
    console.warn('[turnstile] siteverify unreachable; letting the request through', err);
    return 'skipped';
  }
  if (reply.success !== true) {
    const codes = Array.isArray(reply['error-codes']) ? reply['error-codes'] : [];
    // A wrong or missing secret, or an error on their side, is not the
    // listener's fault: say so in the log and let the request through.
    if (codes.some((c) => SERVER_SIDE_CODES.has(c))) {
      console.warn(`[turnstile] siteverify could not check the token (${codes.join(', ')}); letting the request through`);
      return 'skipped';
    }
    return 'invalid';
  }
  // A token minted for another form on the site must not unlock this one.
  if (reply.action !== action) return 'invalid';
  return 'ok';
}
