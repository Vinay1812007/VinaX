/**
 * Account emails, sent through Resend (https://resend.com).
 *
 * Four emails, each switchable in the console's `email` setting:
 *   welcome        the first time a Google account signs in to VinaX
 *   newSignIn      every later sign-in to the app (says when it is a device
 *                  the account has not used before)
 *   adminInvite    an owner adds an email to the console's admins
 *   weeklySummary  every Monday at 9 AM India time, last week's numbers to the
 *                  owner (`weeklyTo`, or every Owner when empty); built and
 *                  sent by the `weekly-summary` job (_lib/weeklySummary.ts)
 *
 * Off until the Worker has RESEND_API_KEY. EMAIL_FROM (default
 * `VinaX <notifications@vinaxmusic.online>`) must be on a domain verified in Resend;
 * EMAIL_REPLY_TO (default support@vinaxmusic.online) is where replies go.
 *
 * Signing in to the owner console sends nothing (owner decision, 2026-11-09:
 * the console's own audit trail records every sign-in).
 *
 * Every email is one branded card (`layout`): the VinaX mark and wordmark, the
 * ember-to-rose ribbon and the app's plum canvas, so a mail from VinaX looks
 * like the app it comes from.
 *
 * Sending never throws and never blocks a sign-in: callers hand the promise
 * to waitUntil. Each email carries an Idempotency-Key, so a retried request
 * does not send the same email twice within Resend's 24 hours.
 */
import { setting } from './settings';
import type { DbEnv } from './db';
import { deviceOf, type DeviceOs } from './edge';

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

export type EmailKind = 'welcome' | 'newSignIn' | 'adminInvite' | 'weeklySummary' | 'test' | 'code';
export const EMAIL_KINDS: readonly Exclude<EmailKind, 'test'>[] = ['welcome', 'newSignIn', 'adminInvite', 'weeklySummary'];
/** The VinaX mark the emails carry (hosted, so every mail app shows the same logo). */
export const LOGO_URL = `${SITE}/icons/icon-192.png`;

export interface EmailSettings {
  enabled: boolean;
  welcome: boolean;
  newSignIn: boolean;
  adminInvite: boolean;
  weeklySummary: boolean;
  /** Who gets the weekly summary; empty = every Owner. */
  weeklyTo: string[];
}

const EMAIL_RE = /^[^\s@<>",;]+@[^\s@<>",;]+\.[^\s@<>",;]+$/;

/** A list of email addresses, cleaned: lower case, valid shape, no repeats, at most 10. */
export function emailList(raw: unknown): string[] {
  const src = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(/[\s,;]+/) : [];
  const out = new Set<string>();
  for (const v of src) {
    const e = typeof v === 'string' ? v.trim().toLowerCase() : '';
    if (e && e.length <= 254 && EMAIL_RE.test(e)) out.add(e);
  }
  return [...out].slice(0, 10);
}

/** The `email` setting, read safely: anything not explicitly false is on. */
export function emailSettingsOf(raw: unknown): EmailSettings {
  const o = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const on = (k: string): boolean => o[k] !== false;
  return {
    enabled: on('enabled'), welcome: on('welcome'), newSignIn: on('newSignIn'), adminInvite: on('adminInvite'),
    weeklySummary: on('weeklySummary'), weeklyTo: emailList(o.weeklyTo),
  };
}

export const emailConfigured = (env: EmailEnv): boolean => !!env.RESEND_API_KEY?.trim();

/** May this kind of email go out now? Needs the key, and the setting not switched off. */
export async function emailAllowed(env: EmailEnv, kind: EmailKind): Promise<boolean> {
  if (!emailConfigured(env)) return false;
  if (kind === 'test' || kind === 'code') return true;
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
  const d = deviceOf(ua);
  const os = d.os === 'android' ? (d.androidVersion ? `Android ${d.androidVersion}` : 'Android') : d.os ? OS_NAME[d.os] : null;
  // The Android app is a WebView (`; wv)`): name it, not "Chrome".
  if (d.androidVersion && d.webView) return `the VinaX Android app (${os})`;
  if (d.browser && os) return `${d.browser} on ${os}`;
  return d.browser ?? os;
}

const OS_NAME: Record<DeviceOs, string> = { android: 'Android', ios: 'iOS', ipados: 'iPadOS', macos: 'macOS', windows: 'Windows', chromeos: 'ChromeOS', linux: 'Linux' };

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

export interface Layout { title: string; lines: string[]; button?: { label: string; href: string }; footer: string; /** A short line above the title ("Account", "Console"). */ kicker?: string }

/**
 * 1.19 — the emails wear the app's own look: black canvas with a faint green
 * glow, one frosted ("glass") card, the mark and the "VinaX Music" wordmark,
 * green buttons. Every colour has a solid fallback: mail apps paint no
 * gradients or translucency reliably, so the card is readable on #141414 alone.
 */
export const C = {
  canvas: '#000000',
  canvasGlow: '#07140b',
  card: '#141414',
  cardGlass: 'rgba(255,255,255,0.05)',
  cardBorder: '#2a2a2a',
  cardEdge: 'rgba(255,255,255,0.14)',
  box: '#1d1d1d',
  text: '#e6e6e6',
  muted: '#a7a7a7',
  title: '#ffffff',
  accent: '#1ed760',
  accent2: '#19b6c9',
  onAccent: '#000000',
  danger: '#f3727f',
} as const;

/**
 * One branded card that reads the same in every mail app: the mark and the
 * wordmark on top, the green ribbon, the title, the lines, one button and a
 * quiet footer. Table layout with inline styles and bgcolor fallbacks
 * (Outlook paints no gradients, so every gradient has a solid colour under
 * it). `lines` are already-escaped HTML.
 */
export function layout({ title, lines, button, footer, kicker }: Layout): string {
  const btn = button
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:28px 0 6px"><tr><td bgcolor="${C.accent}" style="background:${C.accent};border-radius:999px;box-shadow:0 8px 24px rgba(30,215,96,0.25)"><a href="${escapeHtml(button.href)}" style="display:inline-block;color:${C.onAccent};text-decoration:none;font-weight:800;font-size:15px;padding:13px 26px;border-radius:999px;letter-spacing:-0.01em">${escapeHtml(button.label)}</a></td></tr></table>`
    : '';
  const kick = kicker ? `<p style="margin:0 0 10px;font-size:11px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:${C.accent}">${escapeHtml(kicker)}</p>` : '';
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark"><meta name="supported-color-schemes" content="dark"><title>${escapeHtml(title)}</title></head>
<body style="margin:0;padding:0;background:${C.canvas};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${C.text}" bgcolor="${C.canvas}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="${C.canvas}" style="background:${C.canvas};background-image:radial-gradient(60% 50% at 20% 0%,${C.canvasGlow},${C.canvas} 70%);padding:36px 16px 28px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px">
<tr><td style="padding:0 6px 20px">
  <table role="presentation" cellpadding="0" cellspacing="0"><tr>
    <td style="padding-right:12px"><a href="${SITE}" style="text-decoration:none"><img src="${LOGO_URL}" width="44" height="44" alt="VinaX" style="display:block;width:44px;height:44px;border-radius:12px;border:0"></a></td>
    <td style="vertical-align:middle"><a href="${SITE}" style="font-size:22px;font-weight:800;letter-spacing:-0.02em;color:${C.title};text-decoration:none">VinaX <span style="color:${C.accent}">Music</span></a><br><span style="font-size:12px;color:${C.muted}">Free music, for everyone</span></td>
  </tr></table>
</td></tr>
<tr><td bgcolor="${C.card}" style="background:${C.card};background-image:linear-gradient(180deg,rgba(255,255,255,0.07),rgba(255,255,255,0.02));border:1px solid ${C.cardBorder};border-top-color:${C.cardEdge};border-radius:20px;overflow:hidden;box-shadow:0 24px 64px rgba(0,0,0,0.6)">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
    <tr><td height="3" bgcolor="${C.accent}" style="height:3px;line-height:3px;font-size:0;background:${C.accent};background-image:linear-gradient(90deg,${C.accent},${C.accent2})">&nbsp;</td></tr>
    <tr><td style="padding:30px 28px 28px">
      ${kick}
      <h1 style="margin:0 0 16px;font-size:24px;line-height:1.25;color:${C.title};font-weight:800;letter-spacing:-0.02em">${escapeHtml(title)}</h1>
      ${lines.map((l) => `<p style="margin:0 0 12px;font-size:15px;line-height:1.65;color:${C.text}">${l}</p>`).join('\n')}
      ${btn}
    </td></tr>
  </table>
</td></tr>
<tr><td style="padding:20px 8px 0;font-size:12px;line-height:1.6;color:${C.muted}">${footer}<br><a href="${SITE}" style="color:${C.muted}">vinaxmusic.online</a> · Hindi, Telugu, Tamil, Punjabi and 8 more languages · free, no subscription.</td></tr>
</table>
</td></tr></table></body></html>`;
}

/** A frosted box inside the card (facts, codes, numbers), as inline styles. */
export const BOX_STYLE = `background:${C.box};background-image:linear-gradient(180deg,rgba(255,255,255,0.05),rgba(255,255,255,0));border:1px solid ${C.cardBorder};border-radius:14px`;

const SUPPORT = 'support@vinaxmusic.online';
const ACCOUNT_FOOTER = `You get this because this address has a <a href="${SITE}" style="color:${C.muted}">VinaX</a> account. Questions? Reply to this email or write to ${SUPPORT}.`;

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
      kicker: 'Your account',
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
    html: [`<span style="display:block;${BOX_STYLE};padding:12px 16px;line-height:1.8">${rows.map(([k, v]) => `<strong style="color:${C.title}">${k}:</strong> ${escapeHtml(v)}`).join('<br>')}</span>`],
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
      kicker: 'Security',
      title: newDevice ? 'New device signed in to VinaX' : 'New sign-in to VinaX',
      lines: [
        `${hi ? `Hi ${escapeHtml(hi)}, your` : 'Your'} VinaX account ${what}.`,
        ...f.html,
        'If this was you, there&rsquo;s nothing to do.',
        'If it wasn&rsquo;t, change your VinaX password (Settings &rsaquo; Account, or &ldquo;Forgot password?&rdquo; on the sign-in screen) and secure your Google account if you sign in with Google, then reply to this email and we&rsquo;ll sign that device out.',
      ],
      button: { label: 'Check your Google account', href: 'https://myaccount.google.com/notifications' },
      footer: ACCOUNT_FOOTER,
    }),
    text: `Your VinaX account ${what.replace('&rsquo;', "'")}.\n\n${f.text.join('\n')}\n\nIf this was you, there's nothing to do.\nIf it wasn't, change your VinaX password (Settings > Account, or "Forgot password?" on the sign-in screen) and secure your Google account if you sign in with Google (https://myaccount.google.com/notifications), then reply to this email and we'll sign that device out.`,
  };
}

/**
 * Schema 20 — the 6-digit code for email sign-up or a forgotten password.
 * Sent straight away (not through the owner's on/off switches: without it
 * nobody can sign up with email).
 */
export function codeEmail(to: string, code: string, reset: boolean): Email {
  const title = reset ? 'Your VinaX password code' : 'Your VinaX sign-up code';
  const why = reset ? 'Someone asked to set a new password for the VinaX account on this address.' : 'Someone is creating a VinaX account with this address.';
  return {
    kind: 'code',
    to,
    subject: `${code} is your VinaX code`,
    html: layout({
      kicker: 'Your account',
      title,
      lines: [
        `${why} Enter this code in VinaX to carry on:`,
        `<span style="display:inline-block;${BOX_STYLE};padding:14px 22px;font-size:30px;font-weight:800;letter-spacing:.3em;color:${C.accent}">${escapeHtml(code)}</span>`,
        'It works for 15 minutes. If this wasn&rsquo;t you, ignore this email: nothing changes without the code.',
      ],
      footer: `You get this because someone typed this address into <a href="${SITE}" style="color:${C.muted}">VinaX</a>. Questions? Reply to this email or write to ${SUPPORT}.`,
    }),
    text: `${title}\n\n${why} Enter this code in VinaX to carry on:\n\n${code}\n\nIt works for 15 minutes. If this wasn't you, ignore this email: nothing changes without the code.`,
  };
}

export function adminInviteEmail(to: string, role: string, invitedBy: string): Email {
  const what: Record<string, string> = { viewer: 'see the dashboards', editor: 'see the dashboards and change settings and content', owner: 'run everything, including admins and the database' };
  return {
    kind: 'adminInvite',
    to,
    subject: 'You have been added to the VinaX console',
    html: layout({
      kicker: 'Owner console',
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
      kicker: 'Console test',
      title: 'Email works',
      lines: [`${escapeHtml(by)} sent this from the VinaX console to check that account emails go out through Resend.`],
      footer: 'Sent from the VinaX console.',
    }),
    text: `${by} sent this from the VinaX console to check that account emails go out through Resend.`,
  };
}
