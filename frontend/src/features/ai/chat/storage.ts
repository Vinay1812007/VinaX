/**
 * v7.1 — where chats live on the device, and everything that reads or writes
 * them: load / save, grouping for the sidebar, export, import, and the small
 * string preferences the chat keeps. No React.
 *
 * Persisted keys are unchanged from earlier builds (`vinax_ai_chats_v1` and
 * the `vinax.ai*` preferences).
 *
 * 10.2 — VinaX AI no longer searches the web, so a message no longer carries
 * `sources`, `sourcePreviews` or agent `steps`. Chats saved by an older build
 * still hold them; they are dropped when the chats are read, so the next save
 * writes the device clean, and an import never revives them.
 */
import { isProviderId } from './models';
import type { Conversation, Msg } from './types';

export const STORE_KEY = 'vinax_ai_chats_v1';
export const MAX_STORED_CHATS = 50;

export const uid = (): string =>
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}_${Math.random().toString(36).slice(2)}`;

export const freshChat = (): Conversation => ({
  id: uid(),
  title: 'New chat',
  messages: [],
  updatedAt: Date.now(),
});

/** Message fields earlier builds stored and 10.2 retired (see the module note). */
const RETIRED_MSG_FIELDS = ['sources', 'sourcePreviews', 'steps'] as const;

/** 10.2 — a stored chat without the retired fields (see the module note). */
function dropRetiredFields(c: Conversation): Conversation {
  if (!c || !Array.isArray(c.messages)) return c;
  if (!c.messages.some((m) => m && RETIRED_MSG_FIELDS.some((k) => k in m))) return c;
  return {
    ...c,
    messages: c.messages.map((m) => {
      if (!m || !RETIRED_MSG_FIELDS.some((k) => k in m)) return m;
      const copy: Record<string, unknown> = { ...m };
      for (const k of RETIRED_MSG_FIELDS) delete copy[k];
      return copy as unknown as Msg;
    }),
  };
}

/**
 * 11.0 — a reply that was still being written when the page was reloaded or
 * left is stored as an empty placeholder. Nothing is writing it any more, so
 * on load it becomes a failed turn (the thread shows “No reply — try again”
 * with Retry) instead of a thinking mark that never ends. The in-flight turn
 * tag never outlives the visit that made it.
 */
function settleInterrupted(c: Conversation): Conversation {
  if (!c || !Array.isArray(c.messages)) return c;
  const stale = (m: Msg): boolean => !!m && m.role === 'assistant' && ('turn' in m || 'creating' in m || (!m.content && !m.media && !m.player && !m.failed));
  if (!c.messages.some(stale)) return c;
  return {
    ...c,
    messages: c.messages.map((m) => {
      if (!stale(m)) return m;
      const rest: Msg = { ...m };
      delete rest.turn;
      delete rest.creating;
      return rest.content || rest.media || rest.player ? rest : { ...rest, failed: true };
    }),
  };
}

export function loadChats(): Conversation[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORE_KEY);
    const arr = raw ? (JSON.parse(raw) as Conversation[]) : [];
    return Array.isArray(arr) ? arr.map(dropRetiredFields).map(settleInterrupted) : [];
  } catch {
    return [];
  }
}

/** What the page starts with: at most one empty "New chat" survives a reload
 *  (earlier builds let every New-chat tap stack another blank entry). */
export function loadInitialChats(): Conversation[] {
  const kept: Conversation[] = [];
  let blank = false;
  for (const c of loadChats()) {
    if (!c || !Array.isArray(c.messages)) continue;
    if (c.messages.length === 0) {
      if (blank) continue;
      blank = true;
    }
    kept.push(c);
  }
  return kept.length ? kept : [freshChat()];
}

// Strip base64 image data URLs from messages before persisting: they live in
// React state only, so a chat with 3-4 attachments never bloats localStorage
// past the ~5MB quota. Placeholders keep the message shape stable for reload.
// 10.3 — a created picture or music clip follows the same rule: its model,
// provider and prompt are kept, its data is not, and the thread shows a
// placeholder line in its place after a reload.
export function stripImagesForPersist(chats: Conversation[]): Conversation[] {
  return chats.map((c) => ({
    ...c,
    messages: c.messages.map((m) => {
      let out = m;
      if (m.images && m.images.length) out = { ...out, images: m.images.map(() => '') };
      if (m.media?.src) out = { ...out, media: { ...m.media, src: '' } };
      return out;
    }),
  }));
}

/**
 * 9.1.0 — a TEMPORARY chat is never written to the device. It lives in React
 * state for as long as the tab shows it and leaves nothing behind: no entry in
 * the chat list on the next load, and nothing for an export to pick up. The
 * filter is here, at the one place that writes, so no future caller can forget.
 */
export function persistChats(chats: Conversation[]): void {
  if (typeof localStorage === 'undefined') return;
  try {
    const keep = chats.filter((c) => !c.temporary);
    localStorage.setItem(STORE_KEY, JSON.stringify(stripImagesForPersist(keep).slice(0, MAX_STORED_CHATS)));
  } catch {
    /* storage full or blocked — non-fatal */
  }
}

/** Sidebar grouping: pinned first, then by when the chat was last touched.
 *  `q` filters on the title and on message text. */
export function groupChats(chats: Conversation[], q: string, now = Date.now()): Array<[string, Conversation[]]> {
  const query = q.trim().toLowerCase();
  const filtered = query
    ? chats.filter((c) => c.title.toLowerCase().includes(query) || c.messages.some((m) => m.content.toLowerCase().includes(query)))
    : chats;
  const today = new Date(now).setHours(0, 0, 0, 0);
  const groups: Array<[string, Conversation[]]> = [
    ['Pinned', []],
    ['Today', []],
    ['Yesterday', []],
    ['Previous 7 days', []],
    ['Older', []],
  ];
  for (const c of filtered) {
    if (c.pinned) groups[0][1].push(c);
    else if (c.updatedAt >= today) groups[1][1].push(c);
    else if (c.updatedAt >= today - 86_400_000) groups[2][1].push(c);
    else if (c.updatedAt >= today - 7 * 86_400_000) groups[3][1].push(c);
    else groups[4][1].push(c);
  }
  return groups.filter(([, list]) => list.length > 0);
}

export const relTime = (ts: number, now = Date.now()): string => {
  const d = now - ts;
  if (d < 60_000) return 'Just now';
  if (d < 3_600_000) return `${Math.floor(d / 60_000)}m ago`;
  if (d < 86_400_000) return `${Math.floor(d / 3_600_000)}h ago`;
  if (d < 7 * 86_400_000) return `${Math.floor(d / 86_400_000)}d ago`;
  return new Date(ts).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
};

/** "Good morning" / "afternoon" / "evening", by the device clock. */
export const timeOfDay = (now = new Date()): 'morning' | 'afternoon' | 'evening' => {
  const h = now.getHours();
  return h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening';
};

/** The listener's first name from the name they gave at onboarding. */
export function firstName(full: string): string {
  const first = full.trim().split(/\s+/)[0] ?? '';
  return first.slice(0, 24);
}

/* ---------- export ---------- */

export const chatToMarkdown = (c: Conversation): string =>
  `# ${c.title}\n\n` +
  c.messages.map((m) => (m.role === 'user' ? `**You:** ${m.content}` : `**VinaX AI:**\n\n${m.content}`)).join('\n\n---\n\n');

export const chatToText = (c: Conversation): string =>
  c.messages.map((m) => `${m.role === 'user' ? 'You' : 'VinaX AI'}: ${m.content}`).join('\n\n');

const esc = (t: string): string => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export const chatToPrintHtml = (c: Conversation): string =>
  `<html><head><title>${esc(c.title)}</title><style>body{font-family:-apple-system,system-ui,sans-serif;max-width:720px;margin:2rem auto;padding:0 1rem;line-height:1.6}h1{font-size:1.4rem}.u{font-weight:700;margin-top:1.2rem}.a{white-space:pre-wrap;margin-top:.4rem}</style></head><body><h1>${esc(c.title)}</h1>` +
  c.messages.map((m) => (m.role === 'user' ? `<p class="u">You: ${esc(m.content)}</p>` : `<div class="a">${esc(m.content)}</div>`)).join('') +
  '</body></html>';

export function downloadFile(name: string, text: string, mime: string): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: mime }));
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

export function exportChat(c: Conversation, kind: 'txt' | 'md' | 'pdf'): void {
  const stem = c.title.replace(/[^a-z0-9]+/gi, '-').toLowerCase() || 'chat';
  if (kind === 'md') return downloadFile(`${stem}.md`, chatToMarkdown(c), 'text/markdown');
  if (kind === 'txt') return downloadFile(`${stem}.txt`, chatToText(c), 'text/plain');
  const w = window.open('', '_blank');
  if (!w) return;
  w.document.write(chatToPrintHtml(c));
  w.document.close();
  // Some browsers race the print dialog against document.close(): scheduling
  // print() a tick later lets the new window actually render first.
  setTimeout(() => {
    try {
      w.print();
    } catch {
      /* window closed before we could print */
    }
  }, 100);
}

/** 9.1.0 — a temporary chat is not part of an export, by the same rule. */
export const exportAllChats = (chats: Conversation[]): void =>
  downloadFile('vinax-ai-chats.json', JSON.stringify(chats.filter((c) => !c.temporary), null, 2), 'application/json');

/* ---------- import ---------- */

const MAX_IMPORT_MESSAGES = 400;
const MAX_IMPORT_TEXT = 60_000;

function reviveMsg(raw: unknown): Msg | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if ((r.role !== 'user' && r.role !== 'assistant') || typeof r.content !== 'string') return null;
  const m: Msg = { role: r.role, content: r.content.slice(0, MAX_IMPORT_TEXT) };
  if (Array.isArray(r.images)) {
    // Only inline pictures the chat itself produced; '' is the placeholder a
    // stored chat keeps where an image used to be.
    const imgs = r.images
      .filter((u): u is string => typeof u === 'string' && (u === '' || (u.startsWith('data:image/') && u.length < 6_000_000)))
      .slice(0, 6);
    if (imgs.length) m.images = imgs;
  }
  if (typeof r.engine === 'string') m.engine = r.engine.slice(0, 60);
  // 10.3 — a created picture or clip comes back as its placeholder only.
  const media = r.media as Record<string, unknown> | null | undefined;
  if (media && typeof media === 'object' && (media.kind === 'image' || media.kind === 'music') && typeof media.model === 'string') {
    m.media = {
      kind: media.kind,
      src: '',
      model: media.model.slice(0, 120),
      ...(isProviderId(media.provider) ? { provider: media.provider } : {}),
      prompt: typeof media.prompt === 'string' ? media.prompt.slice(0, 2000) : '',
    };
  }
  if (r.player === true) m.player = true;
  if (r.rating === 'up' || r.rating === 'down') m.rating = r.rating;
  if (r.pinned === true) m.pinned = true;
  if (r.failed === true) m.failed = true;
  if (r.needsEdit === true) m.needsEdit = true;
  if (r.unavailable === true) m.unavailable = true;
  if (Array.isArray(r.followups)) {
    const f = r.followups.filter((t): t is string => typeof t === 'string').map((t) => t.slice(0, 200)).slice(0, 3);
    if (f.length) m.followups = f;
  }
  return m;
}

/** Read a chats export back in. Everything is validated field by field — an
 *  import is a file from anywhere — and merged by id: a chat already on the
 *  device is left alone, new ones are added on top. */
export function importChats(text: string, existing: Conversation[]): { chats: Conversation[]; added: number } | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;
  const have = new Set(existing.map((c) => c.id));
  const incoming: Conversation[] = [];
  for (const raw of parsed.slice(0, 200)) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    if (!Array.isArray(r.messages)) continue;
    const messages = r.messages.slice(0, MAX_IMPORT_MESSAGES).map(reviveMsg).filter((m): m is Msg => m !== null);
    if (!messages.length) continue;
    const id = typeof r.id === 'string' && r.id && r.id.length <= 80 ? r.id : uid();
    if (have.has(id)) continue;
    have.add(id);
    incoming.push({
      id,
      title: (typeof r.title === 'string' && r.title.trim() ? r.title.trim() : 'Imported chat').slice(0, 80),
      messages,
      updatedAt: typeof r.updatedAt === 'number' && Number.isFinite(r.updatedAt) ? r.updatedAt : Date.now(),
      ...(r.pinned === true ? { pinned: true } : {}),
    });
  }
  if (!incoming.length) return { chats: existing, added: 0 };
  const merged = [...incoming, ...existing].sort((a, b) => b.updatedAt - a.updatedAt);
  return { chats: merged, added: incoming.length };
}

/* ---------- storage used ---------- */

/** Bytes the chat keeps on this device (chats + its preferences), estimated
 *  at two bytes per UTF-16 unit the way browsers count the quota. */
export function storageUsedBytes(): number {
  if (typeof localStorage === 'undefined') return 0;
  let total = 0;
  try {
    for (let i = 0; i < localStorage.length; i += 1) {
      const k = localStorage.key(i);
      if (!k || !(k === STORE_KEY || k.startsWith('vinax.ai'))) continue;
      total += (k.length + (localStorage.getItem(k)?.length ?? 0)) * 2;
    }
  } catch {
    return 0;
  }
  return total;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/* ---------- small preferences ---------- */

export function readPref(key: string, fallback: string): string {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}
export function writePref(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* private mode */
  }
}
export const readFlag = (key: string, fallback: boolean): boolean => readPref(key, fallback ? '1' : '0') === '1';
export const writeFlag = (key: string, on: boolean): void => writePref(key, on ? '1' : '0');

/** 10.2 — preference keys no build reads any more: "Start in Agent mode"
 *  went with Agent mode (its only engines browsed the web). Removed from the
 *  device when the chat opens, so a stale stored "on" can never come back.
 *  10.3 — the per-catalogue model pick went with the catalogue seats (a pick
 *  is now one provider + model, stored with the last-used choice). */
export const RETIRED_PREF_KEYS = ['vinax.aiAgentStart', 'vinax.aiCatalogModels'] as const;

export function dropRetiredPrefs(): void {
  for (const key of RETIRED_PREF_KEYS) {
    try {
      localStorage.removeItem(key);
    } catch {
      /* private mode */
    }
  }
}

/** Preference keys. The first six predate v7.1 and keep their exact names. */
export const PREF = {
  profile: 'vinax.aiProfile',
  fontSize: 'vinax.aiFontSize',
  replyLang: 'vinax.aiReplyLang',
  replyStyle: 'vinax.aiReplyStyle',
  voice: 'vinax.aiVoice',
  userName: 'vinax.user-name',
  // v7.1
  sendOnEnter: 'vinax.aiSendOnEnter',
  autoRead: 'vinax.aiAutoRead',
  sidebarCollapsed: 'vinax.aiSidebarCollapsed',
} as const;

/**
 * 11.0 — a chat's title from its first message: one line, cut at a word
 * boundary with an ellipsis (it used to stop mid-word at 42 code units, which
 * could also split a conjunct in an Indian script or an emoji in half).
 * Counted in graphemes — what a reader sees as one character.
 */
export function titleFromMessage(text: string, max = 42): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  // The project's TypeScript library set predates Intl.Segmenter; an engine
  // without it falls back to code points (emoji stay whole, a conjunct may not).
  type Graphemes = new (locale?: string, options?: { granularity: 'grapheme' }) => { segment(text: string): Iterable<{ segment: string }> };
  const Segmenter = typeof Intl !== 'undefined' ? (Intl as { Segmenter?: Graphemes }).Segmenter : undefined;
  const parts = Segmenter
    ? Array.from(new Segmenter(undefined, { granularity: 'grapheme' }).segment(clean), (s) => s.segment)
    : Array.from(clean);
  if (parts.length <= max) return clean;
  let cut = max;
  // Mid-word at the limit: step back to the last space, unless that would
  // throw away more than half the title (one very long word).
  if (parts[max] !== ' ') {
    const space = parts.lastIndexOf(' ', max - 1);
    if (space >= max / 2) cut = space;
  }
  return `${parts.slice(0, cut).join('').replace(/[\s,;:.!?\-–—]+$/, '')}…`;
}
