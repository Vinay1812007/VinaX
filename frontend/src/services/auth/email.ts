/**
 * Schema 20 — email and password sign-in, next to Google (loaded only when
 * the email form or the Settings password row opens).
 *
 *   requestEmailCode   → POST /api/auth/email/code    a 6-digit code to the address
 *   verifyEmailCode    → POST /api/auth/email/verify  code + new password: sign up, or reset
 *   signInWithPassword → POST /api/auth/email/login
 *   setPassword        → POST /api/auth/password      Settings, signed in
 */
import { acceptSignIn, currentAccount, deviceFacts, ORIGIN, setAccount, turnstileCheck, type HumanCheck } from './google';
import { tr } from '@/i18n';

/** Each failure the forms show their own line for. */
export type EmailAuthResult =
  | 'ok' | 'offline' | 'unavailable' | 'check_failed' | 'not_configured'
  | 'bad_email' | 'wrong_password' | 'blocked'
  | 'wait' | 'not_sent'
  | 'bad_code' | 'wrong_code' | 'code_expired'
  | 'password_short' | 'password_long' | 'signed_out';

export const MIN_PASSWORD = 8;

const KNOWN = new Set<EmailAuthResult>(['not_configured', 'bad_email', 'wrong_password', 'blocked', 'wait', 'not_sent', 'bad_code', 'wrong_code', 'code_expired', 'password_short', 'password_long', 'signed_out']);

interface Outcome { result: EmailAuthResult; retryIn?: number; triesLeft?: number }

async function post(path: string, body: Record<string, unknown>, fetchImpl: typeof fetch, headers: Record<string, string> = {}): Promise<{ res: Response; json: Record<string, unknown> }> {
  const res = await fetchImpl(`${ORIGIN}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  const json = ((await res.json().catch(() => null)) ?? {}) as Record<string, unknown>;
  return { res, json };
}

function failure(res: Response, json: Record<string, unknown>): Outcome {
  const e = json.error;
  if (e === 'human_check') return { result: 'check_failed' };
  if (typeof e === 'string' && KNOWN.has(e as EmailAuthResult)) {
    return { result: e as EmailAuthResult, retryIn: typeof json.retryIn === 'number' ? json.retryIn : undefined, triesLeft: typeof json.triesLeft === 'number' ? json.triesLeft : undefined };
  }
  return { result: res.status === 429 ? 'wait' : 'unavailable' };
}

const offline = (): Outcome => ({ result: typeof navigator !== 'undefined' && navigator.onLine === false ? 'offline' : 'unavailable' });

/** Email a 6-digit code (sign-up, or a forgotten password). */
export async function requestEmailCode(email: string, fetchImpl: typeof fetch = fetch, check: HumanCheck = turnstileCheck): Promise<Outcome> {
  try {
    const turnstile = await check();
    if (turnstile === null) return { result: 'check_failed' };
    const { res, json } = await post('/api/auth/email/code', { email, ...(turnstile ? { turnstile } : {}) }, fetchImpl);
    return res.ok ? { result: 'ok' } : failure(res, json);
  } catch {
    return offline();
  }
}

/** The code and a new password: creates the account, or sets the password of the one this address has. Signs in. */
export async function verifyEmailCode(p: { email: string; code: string; password: string; name?: string }, fetchImpl: typeof fetch = fetch): Promise<Outcome> {
  try {
    const { res, json } = await post('/api/auth/email/verify', { ...p, ...(await deviceFacts()) }, fetchImpl);
    if (!res.ok) return failure(res, json);
    return { result: acceptSignIn(json, 'email') === 'ok' ? 'ok' : 'unavailable' };
  } catch {
    return offline();
  }
}

export async function signInWithPassword(email: string, password: string, fetchImpl: typeof fetch = fetch, check: HumanCheck = turnstileCheck): Promise<Outcome> {
  try {
    const turnstile = await check();
    if (turnstile === null) return { result: 'check_failed' };
    const { res, json } = await post('/api/auth/email/login', { email, password, ...(turnstile ? { turnstile } : {}), ...(await deviceFacts()) }, fetchImpl);
    if (!res.ok) return failure(res, json);
    return { result: acceptSignIn(json, 'password') === 'ok' ? 'ok' : 'unavailable' };
  } catch {
    return offline();
  }
}

/** Settings: set a first password (Google accounts), or change it (`current` needed once one is set). */
export async function setPassword(password: string, current?: string, fetchImpl: typeof fetch = fetch): Promise<Outcome> {
  const a = currentAccount();
  if (!a) return { result: 'signed_out' };
  try {
    const { res, json } = await post('/api/auth/password', { password, ...(current ? { current } : {}) }, fetchImpl, { authorization: `Bearer ${a.session}` });
    if (!res.ok) return failure(res, json);
    const now = currentAccount();
    if (now && now.session === a.session) setAccount({ ...now, user: { ...now.user, hasPassword: true } });
    return { result: 'ok' };
  } catch {
    return offline();
  }
}

/** The line a form shows for an outcome; null for 'ok'. */
export function emailAuthMessage(o: Outcome): string | null {
  // English keys; the app language's words when its dictionary has them (../../i18n.ts).
  switch (o.result) {
    case 'ok': return null;
    case 'offline': return tr('You’re offline — connect and try again.');
    case 'check_failed': return tr('The security check didn’t finish. Try again.');
    case 'not_configured': return tr('Email sign-in isn’t available right now. Use Google for now.');
    case 'bad_email': return tr('That doesn’t look like an email address.');
    case 'wrong_password': return tr('That email and password don’t match. If you made your account with Google, sign in with Google or use “Forgot password?” to set one.');
    case 'blocked': return tr('This account can’t sign in. Write to {email}.', { email: 'support@vinaxmusic.online' });
    case 'wait': return o.retryIn ? tr('A code was just sent. You can ask for another in {n} s.', { n: o.retryIn }) : tr('Too many tries — wait a minute and try again.');
    case 'not_sent': return tr('The email couldn’t be sent. Check the address and try again.');
    case 'bad_code': return tr('The code is the 6 digits in the email.');
    case 'wrong_code': return o.triesLeft ? tr(o.triesLeft === 1 ? 'That code isn’t right. {n} try left.' : 'That code isn’t right. {n} tries left.', { n: o.triesLeft }) : tr('That code isn’t right.');
    case 'code_expired': return tr('That code has run out. Ask for a new one.');
    case 'password_short': return tr('Use at least {n} characters.', { n: MIN_PASSWORD });
    case 'password_long': return tr('That password is too long — use up to 72 characters.');
    case 'signed_out': return tr('You were signed out. Sign in again.');
    default: return tr('Something went wrong. Try again in a moment.');
  }
}
