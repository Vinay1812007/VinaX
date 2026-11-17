/**
 * VinaX AI — keeping a reply when the page goes away in the middle of it.
 *
 * The Worker passes the model's bytes straight through, so when the page
 * closes (pagehide) or is frozen (freeze) mid-reply, only the page holds
 * what was written. It then sends that text to POST /api/ai/keep with
 * `fetch(…, { keepalive: true })` (sendBeacon cannot carry the Bearer
 * header), trimmed under keepalive's ~64 KB body limit, and writes a small
 * draft to this device. The next time VinaX AI opens, `finishDraft()` sends
 * the draft again (the whole text), so a save that did not get through, or
 * was trimmed, is finished. The keep route lets a longer or finished reply
 * replace a kept part, never the other way round.
 *
 * Live voice uses `sendKeepalive` for its transcript on pagehide too
 * (LiveView.tsx). Backgrounding the app is not leaving: nothing here
 * listens to visibilitychange.
 */
import { currentAccount } from '@/services/auth/google';
import { queryClient } from '@/services/queryClient';
import { AI_BASE, AiError, keepReply, type KeepBody } from './api';

/** keepalive requests share a 64 KiB body budget per page; stay under it. */
export const KEEPALIVE_MAX_BYTES = 60_000;
export const DRAFT_KEY = 'vinax.vxai.keep.v1';
/** Replies a draft list holds (newest first) and the longest text it keeps. */
const DRAFT_MAX = 3;
const DRAFT_MAX_CHARS = 100_000;
/** A draft older than this is dropped unsent. */
export const DRAFT_MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000;

interface Draft {
  at: number;
  /** Whose reply it is: another account signed in on this device never sends it. */
  who: string;
  body: KeepBody;
}

const enc = new TextEncoder();
const size = (s: string): number => enc.encode(s).length;
/** The first `n` characters, never ending inside a surrogate pair. */
const cut = (s: string, n: number): string => {
  const t = s.slice(0, n);
  return /[\uD800-\uDBFF]$/.test(t) ? t.slice(0, -1) : t;
};

/**
 * The keep request's JSON, at most `max` bytes: the reasoning goes first,
 * then the end of the text. Null when no text is left.
 */
export function keepaliveBody(body: KeepBody, max = KEEPALIVE_MAX_BYTES): string | null {
  if (!body.text.trim()) return null;
  const whole = JSON.stringify(body);
  if (size(whole) <= max) return whole;
  const lean: KeepBody = { ...body };
  delete lean.thinking;
  const leanJson = JSON.stringify(lean);
  if (size(leanJson) <= max) return leanJson;
  let lo = 0;
  let hi = lean.text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (size(JSON.stringify({ ...lean, text: cut(lean.text, mid) })) <= max) lo = mid;
    else hi = mid - 1;
  }
  const text = cut(lean.text, lo);
  return text.trim() ? JSON.stringify({ ...lean, text }) : null;
}

/** A Live voice call's transcript, as POST /api/ai/live-transcript takes it. */
export interface TranscriptBody {
  conversationId: string | null;
  parentMessageId?: string;
  model: string;
  turns: Array<{ role: 'user' | 'assistant'; text: string; sources?: unknown }>;
}

/** The longest turn the transcript route keeps, and the most turns it takes (live-transcript.ts MAX_TURN_CHARS, MAX_TURNS). */
const TURN_MAX_CHARS = 8_000;
const TURNS_MAX = 200;

/**
 * The transcript's JSON, at most `max` bytes: each turn cut to what the
 * route keeps, then the call's first turns (at most 200) as far as they
 * fit. Null when not even one fits.
 */
export function transcriptKeepaliveBody(body: TranscriptBody, max = KEEPALIVE_MAX_BYTES): string | null {
  const turns = body.turns.filter((t) => t.text.trim()).slice(0, TURNS_MAX).map((t) => ({ ...t, text: cut(t.text, TURN_MAX_CHARS) }));
  const json = (n: number): string => JSON.stringify({ ...body, turns: turns.slice(0, n) });
  let lo = 0;
  let hi = turns.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (size(json(mid)) <= max) lo = mid;
    else hi = mid - 1;
  }
  return lo > 0 ? json(lo) : null;
}

/**
 * POST `body` (JSON) to /api/ai/<path> with keepalive, so it is sent even as
 * the page goes away. The answer cannot be read. False when nobody is signed
 * in or the browser refused it.
 */
export function sendKeepalive(path: string, body: string): boolean {
  const account = currentAccount();
  if (!account || typeof fetch !== 'function') return false;
  try {
    const sent = fetch(`${AI_BASE}${path}`, {
      method: 'POST',
      keepalive: true,
      headers: { accept: 'application/json', 'content-type': 'application/json', authorization: `Bearer ${account.session}` },
      body,
    });
    void Promise.resolve(sent).catch(() => undefined);
    return true;
  } catch {
    return false;
  }
}

const whoIs = (): string | null => {
  const a = currentAccount();
  return a ? a.user.email ?? a.user.username ?? '' : null;
};

function readDrafts(): Draft[] {
  try {
    const raw = JSON.parse(localStorage.getItem(DRAFT_KEY) ?? 'null') as unknown;
    return Array.isArray(raw) ? raw.filter((d): d is Draft => !!d && typeof d === 'object' && typeof (d as Draft).at === 'number' && typeof (d as Draft).body?.assistantMessageId === 'string' && typeof (d as Draft).body?.text === 'string') : [];
  } catch {
    return [];
  }
}

function writeDrafts(list: Draft[]): void {
  try {
    if (list.length) localStorage.setItem(DRAFT_KEY, JSON.stringify(list.slice(0, DRAFT_MAX)));
    else localStorage.removeItem(DRAFT_KEY);
  } catch { /* storage blocked or full: the keepalive save is all there is */ }
}

/** Keep `body` on this device until a save of it gets through (replaces an older draft of the same reply). */
export function saveDraft(body: KeepBody): void {
  const who = whoIs();
  if (who === null || !body.text.trim()) return;
  const draft: Draft = { at: Date.now(), who, body: { ...body, text: cut(body.text, DRAFT_MAX_CHARS) } };
  if (body.text.length > DRAFT_MAX_CHARS) delete draft.body.thinking;
  writeDrafts([draft, ...readDrafts().filter((d) => d.body.assistantMessageId !== body.assistantMessageId)]);
}

/** The reply was saved (or cannot be): forget its draft. */
export function dropDraft(assistantMessageId: string): void {
  const list = readDrafts();
  const left = list.filter((d) => d.body.assistantMessageId !== assistantMessageId);
  if (left.length !== list.length) writeDrafts(left);
}

/** A failed save worth trying again later: offline, signed out, busy or a server fault. */
export const retryable = (e: unknown): boolean =>
  !(e instanceof AiError) || e.status === 0 || e.status === 401 || e.status === 429 || e.status >= 500;

let finishing: Promise<string | null> | null = null;

async function finishAll(): Promise<string | null> {
  const who = whoIs();
  if (who === null) return null;
  const now = Date.now();
  const all = readDrafts();
  // Too old, or another account's (not left on a shared device): dropped unsent.
  const mine = all.filter((d) => now - d.at < DRAFT_MAX_AGE_MS && d.who === who);
  if (mine.length !== all.length) writeDrafts(mine);
  let last: string | null = null;
  for (const d of mine) {
    try {
      const r = await keepReply(d.body);
      dropDraft(d.body.assistantMessageId);
      if (r.saved) last = d.body.conversationId;
    } catch (e) {
      if (!retryable(e)) dropDraft(d.body.assistantMessageId);
    }
  }
  if (last) void queryClient.invalidateQueries({ queryKey: ['vinaxai', 'conversations'] }).catch(() => undefined);
  return last;
}

/**
 * Send the replies kept on this device the last time the page went away.
 * Runs once per page load (once someone is signed in); resolves with the
 * chat a reply was saved into (the last one), or null. Never rejects.
 */
export function finishDraft(): Promise<string | null> {
  // Signed out: nothing is sent yet, and a sign-in later in this page load still finishes them.
  if (!finishing && whoIs() === null) return Promise.resolve(null);
  finishing ??= finishAll().catch(() => null);
  return finishing;
}

/** Tests: forget that this page load already sent its drafts. */
export function _resetFinishForTests(): void {
  finishing = null;
}
