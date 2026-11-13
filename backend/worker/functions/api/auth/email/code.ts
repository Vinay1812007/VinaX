/**
 * POST /api/auth/email/code { email, turnstile? }
 *   → 200 { ok: true }                 a 6-digit code was emailed (sign-up, or a new password)
 *   → 400 { error: 'bad_email' }
 *   → 403 { error: 'human_check' }     Turnstile is on and did not pass
 *   → 429 { error: 'wait', retryIn }   a code went to this address less than a minute ago (seconds)
 *   → 502 { error: 'not_sent' }        Resend refused or could not be reached
 *   → 503 { error: 'not_configured' }  no database, no Resend key or no signing secret
 *
 * Schema 20. The answer is the same whether or not the address already has an
 * account, so the form cannot be used to find out who listens on VinaX; the
 * email itself says "sign-up" or "new password". See _lib/emailAuth.ts.
 */
import { readJsonCapped } from '../../../_lib/body';
import { rateLimitAsync } from '../../../_lib/ratelimit';
import { db, dbConfigured, q } from '../../../_lib/db';
import { CORS, json } from '../../../_lib/authShared';
import { verifyTurnstile, type TurnstileEnv } from '../../../_lib/turnstile';
import { codeEmail, emailConfigured, sendEmail } from '../../../_lib/email';
import { accountByEmail, CODE_RESEND_MS, CODE_TTL_MS, codeHash, newCode, normalEmail, type CodeRow } from '../../../_lib/emailAuth';
import type { SignInEnv } from '../../../_lib/signIn';

type Env = SignInEnv & TurnstileEnv;

export const onRequestOptions = async (): Promise<Response> => new Response(null, { status: 204, headers: CORS });

export const onRequestPost = async (ctx: { request: Request; env: Env }): Promise<Response> => {
  const { request, env } = ctx;
  const limited = await rateLimitAsync(request, 'auth-email-code', { capacity: 5, refillPerMinute: 3 }, env);
  if (limited) return limited;
  if (!dbConfigured(env) || !emailConfigured(env)) return json({ error: 'not_configured' }, 503);
  const read = await readJsonCapped<Record<string, unknown> | null>(request, 4_000);
  if (!read.ok || !read.value || typeof read.value !== 'object') return json({ error: 'bad_request' }, 400);
  const body = read.value;
  const email = normalEmail(body.email);
  if (!email) return json({ error: 'bad_email' }, 400);
  const human = await verifyTurnstile(env, body.turnstile, request, 'app-signin');
  if (human === 'missing' || human === 'failed') return json({ error: 'human_check' }, 403);

  const prev = await db.one<CodeRow>(env, 'email_codes', q().eq('email', email).select('sent_at'));
  if (!prev.ok) return json({ error: 'unavailable' }, 503);
  const since = prev.value ? Date.now() - Date.parse(prev.value.sent_at) : Infinity;
  if (since < CODE_RESEND_MS) return json({ error: 'wait', retryIn: Math.ceil((CODE_RESEND_MS - since) / 1000) }, 429);

  const code = newCode();
  const hash = await codeHash(env, email, code);
  if (!hash) return json({ error: 'not_configured' }, 503);
  const now = Date.now();
  const saved = await db.upsert(env, 'email_codes', { email, code_hash: hash, tries: 0, sent_at: new Date(now).toISOString(), expires_at: new Date(now + CODE_TTL_MS).toISOString() }, 'email');
  if (!saved.ok) return json({ error: 'unavailable' }, 503);
  const owner = await accountByEmail(env, email);
  const sent = await sendEmail(env, codeEmail(email, code, owner.ok && !!owner.row));
  if (!sent.ok) {
    // Let them ask again straight away: nothing reached them.
    await db.remove(env, 'email_codes', q().eq('email', email));
    return json({ error: 'not_sent' }, 502);
  }
  return json({ ok: true });
};
