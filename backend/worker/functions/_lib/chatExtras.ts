/**
 * 12.0 — the smaller helpers behind VinaX AI's chat route:
 *
 *  - isSmallTalk: "hi", "thanks", "ok" — answered on the fastest lane at once.
 *  - makeTitle: a 2–5 word title for a new chat ("BMW meaning explained"),
 *    written by a fast model beside the answer, never in its way.
 *  - planResearch: the 3 extra searches a deep-research question runs.
 *  - countToday: how many logged rows of one kind today (the research cap).
 *  - signed image links: pictures and site logos load through the Worker
 *    (/api/webimg, /api/favicon), never straight from other sites, and only
 *    pictures the chat itself returned can be loaded (an HMAC on the address).
 */
import { chat, type AiEnv } from './ai';
import { sbCountResult, supabaseConfigured, type SupabaseEnv } from './supabase';

// ------------------------------------------------------------------ small talk

const SMALL_TALK =
  /^(?:hi+|hey+|hello+|hii+|helo|yo|hola|namaste|namaskar(?:am)?|vanakkam|good (?:morning|afternoon|evening|night)|gm|gn|thanks?(?: you)?(?: so much| a lot)?|thank u|thx|ty|ok(?:ay)?|k|cool|nice|great|awesome|sure|yes|no|yep|nope|bye|see (?:you|ya)|how are (?:you|u)|how r u|what'?s up|sup|wassup|lol|haha+|hmm+|good|fine|love (?:you|u)|who are you|what is your name|what'?s your name)(?:\s+(?:there|vinax(?: ai)?|buddy|bro|friend|man|dear|sir|madam))?(?:[\s!.?,]|\p{Extended_Pictographic}|\u{FE0F})*$/iu;

/** A greeting, a thank-you or a one-word reaction: no tools, no search, the fast lane. Pure. */
export function isSmallTalk(q: string): boolean {
  const s = (q ?? '').trim();
  return !!s && s.length <= 40 && SMALL_TALK.test(s);
}

// ------------------------------------------------------------------ pictures

/** 12.1 — "bmw car images", "show me photos of the Taj Mahal": an image search. Pure. */
export function wantsImages(q: string): boolean {
  return /\b(?:images?|photos?|pictures?|pics?|wallpapers?|logos?|looks? like)\b/i.test(q ?? '');
}

const NOT_A_NAME = new Set(
  'help test testing music song songs playlist playlists album albums track tracks lyrics bgm remix remixes play pause stop next menu settings yes no ok okay hi hello hey thanks bye why how what who when where which explain summarise summarize translate write code chart diagram continue more again'.split(' '),
);

/** 12.1 — a bare name ("ktm", "BMW", "Taj Mahal"): one to three words, no
 *  question or request around it. Answered like a search engine: pictures and
 *  "are you asking about…". Pure. */
export function isBareEntity(q: string): boolean {
  const s = (q ?? '').trim().replace(/[?!.]+$/, '');
  if (!s || s.length > 40 || isSmallTalk(s)) return false;
  const words = s.split(/\s+/);
  if (words.length > 3) return false;
  if (!words.every((w) => /^[\p{L}\p{N}&.'-]{1,24}$/u.test(w))) return false;
  if (!/\p{L}/u.test(s)) return false;
  return !words.some((w) => NOT_A_NAME.has(w.toLowerCase()));
}

// ------------------------------------------------------------------ titles

/** A model's title → 2–6 plain words, no quotes or trailing punctuation; '' when unusable. Pure. */
export function cleanTitle(raw: string | null | undefined): string {
  if (!raw) return '';
  let t = raw.replace(/<think>[\s\S]*?<\/think>/gi, ' ').split('\n').map((l) => l.trim()).find(Boolean) ?? '';
  t = t
    .replace(/^(?:title|chat title)\s*[:\-–]\s*/i, '')
    .replace(/[*_`#"“”'‘’]/g, '')
    .replace(/[.!?:;,\s]+$/, '')
    .replace(/\s+/g, ' ')
    .trim();
  const words = t.split(' ').filter(Boolean);
  if (!words.length) return '';
  const short = words.slice(0, 6).join(' ').slice(0, 60).trim();
  return short.charAt(0).toUpperCase() + short.slice(1);
}

/** A short title for a new chat from its first message, or null (never throws, at most ~4 s). */
export async function makeTitle(env: AiEnv, firstMessage: string): Promise<string | null> {
  const text = firstMessage.replace(/\n\n--- File:[\s\S]*$/, '').replace(/\s+/g, ' ').trim().slice(0, 500);
  if (!text) return null;
  try {
    const r = await chat(
      env,
      [
        { role: 'system', content: 'You name chats. Reply with ONLY a 2 to 5 word title in the language of the message: no quotes, no full stop. Examples: "BMW meaning explained", "Telugu party playlist", "Fix React build error".' },
        { role: 'user', content: `Name this chat. The listener wrote:\n${text}` },
      ],
      { lane: 'scholar', maxTokens: 24, temperature: 0.3, timeoutMs: 4_000, deadlineAt: Date.now() + 4_500, feature: 'vinaxai', accept: (c) => !!cleanTitle(c) },
    );
    return cleanTitle(r.content) || null;
  } catch {
    return null;
  }
}

// ------------------------------------------------------------------ deep research

/** Up to `n` distinct search queries from a model's answer (JSON or lines). Pure. */
export function parsePlan(raw: string | null | undefined, n = 3): string[] {
  if (!raw) return [];
  let list: unknown[] = [];
  const json = /\[[\s\S]*\]/.exec(raw.replace(/<think>[\s\S]*?<\/think>/gi, ''));
  if (json) {
    try {
      const v = JSON.parse(json[0]) as unknown;
      if (Array.isArray(v)) list = v;
    } catch {
      /* fall back to lines */
    }
  }
  if (!list.length) list = raw.split('\n').map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, ''));
  const out: string[] = [];
  for (const x of list) {
    const q = typeof x === 'string' ? x.replace(/["“”]/g, '').replace(/\s+/g, ' ').trim().slice(0, 200) : '';
    if (q.split(' ').length >= 2 && !out.some((o) => o.toLowerCase() === q.toLowerCase())) out.push(q);
    if (out.length >= n) break;
  }
  return out;
}

/** The 3 further searches for a deep-research question (beside the question itself); a fixed fallback when the model can't help. */
export async function planResearch(env: AiEnv, query: string): Promise<string[]> {
  const fallback = [`${query} latest`, `${query} analysis`, `${query} statistics data`].map((q) => q.slice(0, 200));
  try {
    const r = await chat(
      env,
      [
        { role: 'system', content: 'You plan web research. Given a question, reply with ONLY a JSON array of 3 different, specific web search queries (each under 12 words) that together cover it: background, the latest facts, and data or expert analysis. No commentary.' },
        { role: 'user', content: query },
      ],
      { lane: 'scholar', maxTokens: 160, temperature: 0.4, timeoutMs: 5_000, deadlineAt: Date.now() + 6_000, feature: 'vinaxai', accept: (c) => parsePlan(c).length >= 2 },
    );
    const plan = parsePlan(r.content).filter((q) => q.toLowerCase() !== query.toLowerCase());
    return plan.length >= 2 ? plan.slice(0, 3) : fallback;
  } catch {
    return fallback;
  }
}

// ------------------------------------------------------------------ daily counts

const counts = new Map<string, { day: string; db: number; local: number; refreshAt: number }>();
/** Tests only. */
export function resetCounts(): void {
  counts.clear();
}

/** Successful rows of one feature/model today (UTC): the database's count, read at most once a minute, plus this isolate's since. */
export async function countToday(env: SupabaseEnv, feature: string, model: string, now = Date.now()): Promise<number> {
  const day = new Date(now).toISOString().slice(0, 10);
  const key = `${feature}|${model}`;
  let st = counts.get(key);
  if (st && st.day !== day) st = undefined;
  if (!supabaseConfigured(env)) return st?.local ?? 0;
  if (st && now < st.refreshAt) return st.db + st.local;
  const r = await sbCountResult(env, 'vinax_ai_events', `feature=eq.${encodeURIComponent(feature)}&model=eq.${encodeURIComponent(model)}&ok=eq.true&created_at=gte.${encodeURIComponent(`${day}T00:00:00.000Z`)}`, { timeoutMs: 2_000 }).catch(() => ({ ok: false as const }));
  const known = st ? st.db + st.local : 0;
  st = r.ok ? { day, db: Math.max(r.value, known), local: 0, refreshAt: now + 60_000 } : { day, db: st?.db ?? 0, local: st?.local ?? 0, refreshAt: now + 15_000 };
  counts.set(key, st);
  return st.db + st.local;
}

/** Note one more successful row of this kind in this isolate. */
export function noteToday(feature: string, model: string, now = Date.now()): void {
  const day = new Date(now).toISOString().slice(0, 10);
  const key = `${feature}|${model}`;
  const st = counts.get(key);
  if (!st || st.day !== day) counts.set(key, { day, db: 0, local: 1, refreshAt: 0 });
  else st.local += 1;
}

// ------------------------------------------------------------------ images through the Worker

export interface ImageEnv {
  TELEMETRY_PEPPER?: string;
  DEVICE_ID_SECRET?: string;
}
const secretOf = (env: ImageEnv): string | null => (env.TELEMETRY_PEPPER?.trim() || env.DEVICE_ID_SECRET?.trim() || null);

async function hmac(secret: string, text: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(`webimg:${secret}`), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(text)));
  let s = '';
  for (const b of sig.slice(0, 16)) s += b.toString(16).padStart(2, '0');
  return s;
}

/** The Worker address a picture loads through, or null (no secret, or not an http(s) address). */
export async function signedImagePath(env: ImageEnv, url: string): Promise<string | null> {
  const secret = secretOf(env);
  if (!secret || typeof url !== 'string' || url.length > 1500 || !/^https?:\/\/[^\s"'<>]+$/i.test(url)) return null;
  return `/api/webimg?u=${encodeURIComponent(url)}&s=${await hmac(secret, url)}`;
}

/** Is this signature the one signedImagePath made for this address? */
export async function imageSignatureOk(env: ImageEnv, url: string, sig: string): Promise<boolean> {
  const secret = secretOf(env);
  if (!secret || !/^[0-9a-f]{32}$/.test(sig)) return false;
  const want = await hmac(secret, url);
  let diff = 0;
  for (let i = 0; i < want.length; i++) diff |= want.charCodeAt(i) ^ sig.charCodeAt(i);
  return diff === 0;
}

/** A public host name a logo may be fetched for: letters, digits, dots and dashes, a real suffix, no IPs, no ports. Pure. */
export function logoHost(raw: unknown): string | null {
  const h = typeof raw === 'string' ? raw.trim().toLowerCase().replace(/^www\./, '') : '';
  if (!h || h.length > 120 || !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/.test(h)) return null;
  if (/^\d+(?:\.\d+){3}$/.test(h) || /(?:^|\.)(?:localhost|local|internal|lan|home|test|invalid)$/.test(h)) return null;
  return h;
}
