/**
 * Account emails, sent through Resend (https://resend.com).
 *
 * Four emails, each switchable in the console's `email` setting:
 *   welcome        the first time a Google account signs in to VinaX
 *   newSignIn      every later sign-in to the app (says when it is a device
 *                  the account has not used before)
 *   consoleSignIn  someone signs in to the owner console (to that admin;
 *                  recovery-password sign-ins go to the owners)
 *   adminInvite    an owner adds an email to the console's admins
 *
 * Off until the Worker has RESEND_API_KEY. EMAIL_FROM (default
 * `VinaX <notifications@vinaxmusic.online>`) must be on a domain verified in Resend;
 * EMAIL_REPLY_TO (default support@vinaxmusic.online) is where replies go.
 *
 * Sending never throws and never blocks a sign-in: callers hand the promise
 * to waitUntil. Each email carries an Idempotency-Key, so a retried request
 * does not send the same email twice within Resend's 24 hours.
 */
import { setting } from './settings';
import type { DbEnv } from './db';

export interface EmailEnv extends DbEnv {
  RESEND_API_KEY?: string;
  EMAIL_FROM?: string;
  EMAIL_REPLY_TO?: string;
}

export const RESEND_URL = 'https://api.resend.com/emails';
export const DEFAULT_FROM = 'VinaX <notifications@vinaxmusic.online>';
export const DEFAULT_REPLY_TO = 'support@vinaxmusic.online';
export const SITE = 'https://www.vinaxmusic.online';
export const CONSOLE = 'https://admin.vinaxmusic.online/admin/';

export type EmailKind = 'welcome' | 'newSignIn' | 'consoleSignIn' | 'adminInvite' | 'test';
export const EMAIL_KINDS: readonly Exclude<EmailKind, 'test'>[] = ['welcome', 'newSignIn', 'consoleSignIn', 'adminInvite'];

export interface EmailSettings {
  enabled: boolean;
  welcome: boolean;
  newSignIn: boolean;
  consoleSignIn: boolean;
  adminInvite: boolean;
}

/** The `email` setting, read safely: anything not explicitly false is on. */
export function emailSettingsOf(raw: unknown): EmailSettings {
  const o = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const on = (k: string): boolean => o[k] !== false;
  return { enabled: on('enabled'), welcome: on('welcome'), newSignIn: on('newSignIn'), consoleSignIn: on('consoleSignIn'), adminInvite: on('adminInvite') };
}

export const emailConfigured = (env: EmailEnv): boolean => !!env.RESEND_API_KEY?.trim();

/** May this kind of email go out now? Needs the key, and the setting not switched off. */
export async function emailAllowed(env: EmailEnv, kind: EmailKind): Promise<boolean> {
  if (!emailConfigured(env)) return false;
  if (kind === 'test') return true;
  const s = emailSettingsOf(await setting(env, 'email'));
  return s.enabled && s[kind];
}

export interface Email {
  to: string | string[];
  subject: string;
  html: string;
  text: string;
  kind: EmailKind;
  /** Same key within 24 hours = Resend sends it once. */
  idempotencyKey?: string;
}

export type SendResult = { ok: true; id: string | null } | { ok: false; error: string; status: number | null };

/** Send one email through Resend. Never throws. */
export async function sendEmail(env: EmailEnv, email: Email): Promise<SendResult> {
  const key = env.RESEND_API_KEY?.trim();
  if (!key) return { ok: false, error: 'not_configured', status: null };
  const to = (Array.isArray(email.to) ? email.to : [email.to]).filter(Boolean).slice(0, 50);
  if (!to.length) return { ok: false, error: 'no_recipient', status: null };
  const headers: Record<string, string> = { authorization: `Bearer ${key}`, 'content-type': 'application/json' };
  if (email.idempotencyKey) headers['idempotency-key'] = email.idempotencyKey.slice(0, 256);
  try {
    const res = await fetch(RESEND_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        from: env.EMAIL_FROM?.trim() || DEFAULT_FROM,
        to,
        reply_to: env.EMAIL_REPLY_TO?.trim() || DEFAULT_REPLY_TO,
        subject: email.subject,
        html: email.html,
        text: email.text,
        tags: [{ name: 'kind', value: email.kind }],
      }),
    });
    const body = (await res.json().catch(() => null)) as { id?: string; name?: string; message?: string } | null;
    if (!res.ok) {
      const error = body?.name || `http_${res.status}`;
      console.warn(`[email] ${email.kind} not sent (${res.status} ${error}${body?.message ? `: ${body.message}` : ''})`);
      return { ok: false, error, status: res.status };
    }
    return { ok: true, id: body?.id ?? null };
  } catch (e) {
    console.warn(`[email] ${email.kind} not sent (${e instanceof Error ? e.message : 'network'})`);
    return { ok: false, error: 'network', status: null };
  }
}

/**
 * Build and send when allowed; the caller's waitUntil keeps it alive past the
 * response. The email is built only once it may go out, and nothing here can
 * throw into the caller: a broken template costs the email, never the sign-in.
 */
export function sendLater(env: EmailEnv, waitUntil: ((p: Promise<unknown>) => void) | undefined, kind: EmailKind, build: () => Email | Promise<Email>): Promise<SendResult | null> {
  const p = emailAllowed(env, kind)
    .then(async (ok) => (ok ? sendEmail(env, await build()) : null))
    .catch((e: unknown) => {
      console.warn(`[email] ${kind} not sent (${e instanceof Error ? e.message : 'error'})`);
      return null;
    });
  if (waitUntil) waitUntil(p);
  return p;
}

// ── What the emails say ───────────────────────────────────────────────

export const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** Where and on what a sign-in happened, as the edge saw it. */
export interface SignInFacts {
  platform: string | null;
  city: string | null;
  region: string | null;
  country: string | null;
  /** IANA zone from the edge, for the time line. */
  timezone?: string | null;
  /** The connection's IP address (shown in the email, never stored by VinaX). */
  ip?: string | null;
  /** "Chrome on macOS", read from the user agent. */
  browser?: string | null;
  at?: Date;
}

const PLATFORM_NAME: Record<string, string> = { web: 'a web browser', android: 'the VinaX Android app', ios: 'iPhone' };

/** "Chrome on Windows", "Safari on iOS", "Android app (Android 14)"… or null for an unknown agent. */
export function describeAgent(ua: string | null | undefined): string | null {
  if (!ua) return null;
  const u = ua.slice(0, 512);
  const android = /Android (\d+(?:\.\d+)?)/.exec(u);
  const os = /iPhone|iPod/.test(u) ? 'iOS'
    : /iPad/.test(u) ? 'iPadOS'
      : android ? `Android ${android[1]}`
        : /Windows NT/.test(u) ? 'Windows'
          : /CrOS/.test(u) ? 'ChromeOS'
            : /Mac OS X|Macintosh/.test(u) ? 'macOS'
              : /Linux/.test(u) ? 'Linux' : null;
  // The Android app is a WebView (`; wv)`): name it, not "Chrome".
  if (android && /; wv\)/.test(u)) return `the VinaX Android app (${os})`;
  const browser = /Edg(e|A|iOS)?\//.test(u) ? 'Edge'
    : /OPR\/|Opera/.test(u) ? 'Opera'
      : /SamsungBrowser/.test(u) ? 'Samsung Internet'
        : /Firefox\/|FxiOS/.test(u) ? 'Firefox'
          : /Chrome\/|CriOS/.test(u) ? 'Chrome'
            : /Safari\//.test(u) && /Version\//.test(u) ? 'Safari' : null;
  if (browser && os) return `${browser} on ${os}`;
  return browser ?? os;
}

/** IP and browser of a request, for a sign-in email. */
export function requestFacts(request: Request): Pick<SignInFacts, 'ip' | 'browser' | 'timezone'> {
  const ip = request.headers.get('cf-connecting-ip')?.trim() || null;
  return {
    ip: ip && ip.length <= 45 && /^[0-9a-fA-F:.]+$/.test(ip) ? ip : null,
    browser: describeAgent(request.headers.get('user-agent')),
    timezone: edgeTimezone(request),
  };
}

export function placeOf(f: Pick<SignInFacts, 'city' | 'region' | 'country'>): string | null {
  const country = f.country ? (() => {
    try { return new Intl.DisplayNames(['en'], { type: 'region' }).of(f.country) ?? f.country; } catch { return f.country; }
  })() : null;
  const parts = [f.city, f.region && f.region !== f.city ? f.region : null, country].filter((x): x is string => !!x);
  return parts.length ? parts.join(', ') : null;
}

export function timeOf(at: Date, timezone?: string | null): string {
  const fmt = (tz: string) => new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: tz, timeZoneName: 'short' }).format(at);
  try { return fmt(timezone || 'Asia/Kolkata'); } catch { return fmt('UTC'); }
}

/** The Cloudflare zone for the request, when the edge knows it. */
export function edgeTimezone(request: Request): string | null {
  const tz = (request as Request & { cf?: { timezone?: string } }).cf?.timezone;
  return typeof tz === 'string' && tz.length <= 64 ? tz : null;
}

interface Layout { title: string; lines: string[]; button?: { label: string; href: string }; footer: string }

/** One plain, light card that reads the same in every mail app. `lines` are already-escaped HTML. */
function layout({ title, lines, button, footer }: Layout): string {
  const btn = button
    ? `<p style="margin:28px 0 8px"><a href="${escapeHtml(button.href)}" style="display:inline-block;background:#7c3aed;color:#ffffff;text-decoration:none;font-weight:600;padding:12px 22px;border-radius:999px">${escapeHtml(button.label)}</a></p>`
    : '';
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${escapeHtml(title)}</title></head>
<body style="margin:0;padding:0;background:#f4f2f8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1f1b2d">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f2f8;padding:32px 16px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:16px;padding:32px 28px">
<tr><td>
<p style="margin:0 0 24px;font-size:20px;font-weight:800;letter-spacing:-0.02em;color:#7c3aed">VinaX</p>
<h1 style="margin:0 0 16px;font-size:22px;line-height:1.3">${escapeHtml(title)}</h1>
${lines.map((l) => `<p style="margin:0 0 12px;font-size:15px;line-height:1.6">${l}</p>`).join('\n')}
${btn}
</td></tr></table>
<p style="max-width:520px;margin:16px auto 0;font-size:12px;line-height:1.5;color:#6b6480">${footer}</p>
</td></tr></table></body></html>`;
}

const SUPPORT = 'support@vinaxmusic.online';
const ACCOUNT_FOOTER = `You get this because you signed in to <a href="${SITE}" style="color:#6b6480">VinaX</a> with this Google account. Questions? Reply to this email or write to ${SUPPORT}.`;

const firstName = (name: string | null | undefined): string | null => {
  const n = (name ?? '').trim().split(/\s+/)[0];
  return n ? n.slice(0, 40) : null;
};

export function welcomeEmail(to: string, name: string | null, facts?: SignInFacts): Email {
  const hi = firstName(name);
  const f = facts ? factLines(facts) : null;
  return {
    kind: 'welcome',
    to,
    subject: 'Welcome to VinaX',
    html: layout({
      title: hi ? `Welcome, ${hi}!` : 'Welcome to VinaX!',
      lines: [
        'Your VinaX account is ready. Your favourites, playlists and history now follow you to every device you sign in on.',
        'Pick your languages on Home and VinaX will fill it with songs you&rsquo;ll like. The more you play, the better it gets.',
        ...(f ? ['You signed up from:', ...f.html, 'If this wasn&rsquo;t you, reply to this email.'] : []),
      ],
      button: { label: 'Start listening', href: SITE },
      footer: ACCOUNT_FOOTER,
    }),
    text: `${hi ? `Welcome, ${hi}!` : 'Welcome to VinaX!'}\n\nYour VinaX account is ready. Your favourites, playlists and history now follow you to every device you sign in on.\n\n${f ? `You signed up from:\n${f.text.join('\n')}\n\n` : ''}Start listening: ${SITE}\n\nQuestions? Reply to this email or write to ${SUPPORT}.`,
  };
}

function factLines(f: SignInFacts): { html: string[]; text: string[] } {
  const device = f.browser ?? (f.platform ? PLATFORM_NAME[f.platform] ?? f.platform : null);
  const place = placeOf(f);
  const when = timeOf(f.at ?? new Date(), f.timezone);
  const rows: Array<[string, string]> = [['When', when]];
  if (device) rows.push(['Device', device]);
  if (f.ip) rows.push(['IP address', f.ip]);
  if (place) rows.push(['Near', `${place} (approximate)`]);
  return {
    html: [`<span style="display:block;background:#f4f2f8;border-radius:12px;padding:12px 16px">${rows.map(([k, v]) => `<strong>${k}:</strong> ${escapeHtml(v)}`).join('<br>')}</span>`],
    text: rows.map(([k, v]) => `${k}: ${v}`),
  };
}

export function newSignInEmail(to: string, name: string | null, facts: SignInFacts, newDevice = true): Email {
  const hi = firstName(name);
  const f = factLines(facts);
  const what = newDevice ? 'was just signed in to on a device it hasn&rsquo;t used before' : 'was just signed in to';
  return {
    kind: 'newSignIn',
    to,
    subject: newDevice ? 'New device signed in to your VinaX account' : 'New sign-in to your VinaX account',
    html: layout({
      title: newDevice ? 'New device signed in to VinaX' : 'New sign-in to VinaX',
      lines: [
        `${hi ? `Hi ${escapeHtml(hi)}, your` : 'Your'} VinaX account ${what}.`,
        ...f.html,
        'If this was you, there&rsquo;s nothing to do.',
        'If it wasn&rsquo;t, secure your Google account (VinaX signs in only with Google), then reply to this email and we&rsquo;ll sign that device out.',
      ],
      button: { label: 'Check your Google account', href: 'https://myaccount.google.com/notifications' },
      footer: ACCOUNT_FOOTER,
    }),
    text: `Your VinaX account ${what.replace('&rsquo;', "'")}.\n\n${f.text.join('\n')}\n\nIf this was you, there's nothing to do.\nIf it wasn't, secure your Google account (https://myaccount.google.com/notifications), then reply to this email and we'll sign that device out.`,
  };
}

export function consoleSignInEmail(to: string | string[], who: string, role: string, via: 'google' | 'password', facts: SignInFacts): Email {
  const f = factLines(facts);
  const how = via === 'password' ? 'with the owner recovery password' : 'with Google';
  return {
    kind: 'consoleSignIn',
    to,
    subject: via === 'password' ? 'VinaX console: recovery password used' : 'VinaX console sign-in',
    html: layout({
      title: via === 'password' ? 'The recovery password was used' : 'You signed in to the VinaX console',
      lines: [
        `${escapeHtml(who)} signed in to the owner console ${how} (${escapeHtml(role)}).`,
        ...f.html,
        via === 'password'
          ? 'If this wasn&rsquo;t you, change ADMIN_LOGIN_PASSWORD on the Worker now: that ends every recovery-password session.'
          : 'If this wasn&rsquo;t you, secure that Google account and ask an owner to remove it under Admins &amp; Roles.',
      ],
      button: { label: 'Open the change log', href: `${CONSOLE}#/database/changes` },
      footer: 'You get this because you are an admin of the VinaX console. Owners can switch these emails off in App Settings › Notification Rules › Account emails.',
    }),
    text: `${who} signed in to the VinaX owner console ${how} (${role}).\n\n${f.text.join('\n')}\n\nIf this wasn't you, ${via === 'password' ? 'change ADMIN_LOGIN_PASSWORD on the Worker now' : 'secure that Google account and ask an owner to remove it'}.\nChange log: ${CONSOLE}#/database/changes`,
  };
}

export function adminInviteEmail(to: string, role: string, invitedBy: string): Email {
  const what: Record<string, string> = { viewer: 'see the dashboards', editor: 'see the dashboards and change settings and content', owner: 'run everything, including admins and the database' };
  return {
    kind: 'adminInvite',
    to,
    subject: 'You have been added to the VinaX console',
    html: layout({
      title: 'You’re a VinaX admin',
      lines: [
        `${escapeHtml(invitedBy)} added you to the VinaX owner console as <strong>${escapeHtml(role)}</strong>: you can ${escapeHtml(what[role] ?? 'use the console')}.`,
        `Sign in with Google as <strong>${escapeHtml(to)}</strong>.`,
      ],
      button: { label: 'Open the console', href: CONSOLE },
      footer: 'You get this because an owner of the VinaX console added this email address. If you didn&rsquo;t expect it, you can ignore it.',
    }),
    text: `${invitedBy} added you to the VinaX owner console as ${role}.\n\nSign in with Google as ${to}: ${CONSOLE}`,
  };
}

export function testEmail(to: string, by: string): Email {
  return {
    kind: 'test',
    to,
    subject: 'VinaX test email',
    html: layout({
      title: 'Email works',
      lines: [`${escapeHtml(by)} sent this from the VinaX console to check that account emails go out through Resend.`],
      footer: 'Sent from the VinaX console.',
    }),
    text: `${by} sent this from the VinaX console to check that account emails go out through Resend.`,
  };
}
