/**
 * Account emails (Resend) — what the console shows and its test button.
 *
 * GET  /api/admin/email → { configured, from, replyTo, settings }
 *        Any admin. `configured`: RESEND_API_KEY is set. `settings`: the
 *        `email` setting with its defaults (every email on).
 * POST /api/admin/email { action: 'test' } (owner) → { ok, id } | 4xx/502 { error }
 *        Sends a test email to the signed-in admin (to the owners for a
 *        recovery-password session), whatever the setting says.
 *        503 not_configured without RESEND_API_KEY; 502 with Resend's error
 *        name when Resend refused it (an unverified sender domain is the
 *        usual one: `validation_error`).
 *
 * The switches themselves are saved through POST /api/admin/settings
 * { key: 'email' } (owner only).
 */
import { adminJson, badRequest } from '../../_lib/admin';
import { adminGet, adminPost } from '../../_lib/adminRoute';
import { ownerEmails } from '../../_lib/adminAuth';
import { DEFAULT_FROM, DEFAULT_REPLY_TO, emailConfigured, emailSettingsOf, sendEmail, testEmail, type EmailEnv } from '../../_lib/email';
import { setting } from '../../_lib/settings';

export const onRequestGet = adminGet(async ({ env }) => {
  const e = env as EmailEnv;
  return adminJson({
    configured: emailConfigured(e),
    from: e.EMAIL_FROM?.trim() || DEFAULT_FROM,
    replyTo: e.EMAIL_REPLY_TO?.trim() || DEFAULT_REPLY_TO,
    settings: emailSettingsOf(await setting(env, 'email')),
  });
});

export const onRequestPost = adminPost(async ({ env, body, me, audit }) => {
  if (body.action !== 'test') return badRequest('unknown_action');
  const e = env as EmailEnv;
  if (!emailConfigured(e)) return adminJson({ error: 'not_configured' }, 503);
  const to = me.via === 'password' ? await ownerEmails(env as never) : [me.email];
  if (!to.length) return adminJson({ error: 'no_recipient' }, 409);
  const sent = await sendEmail(e, { ...testEmail(to[0]!, me.email === 'owner' ? 'The owner' : me.email), to });
  await audit({ action: 'email-test', summary: sent.ok ? `test email sent to ${to.join(', ')}` : `test email failed (${sent.error})`, target: to.join(', ') });
  if (!sent.ok) return adminJson({ error: sent.error, status: sent.status }, 502);
  return adminJson({ ok: true, id: sent.id, to });
}, { role: 'owner' });
