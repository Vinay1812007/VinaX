/**
 * 11.9 — the "Trending now" headlines on the empty chat (GET /api/ai/headlines).
 * The server refreshes them on a schedule, the same for everyone; this side
 * only reads them, at most once per ten minutes per tab, and validates what
 * arrives (http(s) links, clipped titles, known topics). Nothing is sent.
 */
import { HEADLINES_ENDPOINT } from './endpoints';

export interface Headline {
  topic: string;
  title: string;
  url: string;
  site: string;
  /** 13.1 — when the server first saw the story (ISO), or null on older documents. */
  at: string | null;
}

const TOPICS = new Set(['india', 'tech']);
const TTL_MS = 10 * 60_000;

/** The server's answer → at most 8 headlines, alternating topics. Pure; exported for tests. */
export function readHeadlines(raw: unknown): Headline[] {
  if (!raw || typeof raw !== 'object' || !Array.isArray((raw as { topics?: unknown }).topics)) return [];
  const lists: Headline[][] = [];
  for (const t of (raw as { topics: unknown[] }).topics) {
    const o = (t ?? {}) as { id?: unknown; label?: unknown; items?: unknown };
    if (typeof o.id !== 'string' || !TOPICS.has(o.id)) continue;
    const topic = typeof o.label === 'string' && o.label.trim() ? o.label.trim().slice(0, 20) : o.id;
    const list: Headline[] = [];
    for (const it of Array.isArray(o.items) ? o.items : []) {
      const x = (it ?? {}) as { title?: unknown; url?: unknown; site?: unknown; at?: unknown };
      const url = typeof x.url === 'string' && /^https?:\/\/\S+$/i.test(x.url) ? x.url : '';
      const title = typeof x.title === 'string' ? x.title.replace(/\s+/g, ' ').trim().slice(0, 160) : '';
      const site = typeof x.site === 'string' && /^[a-z0-9.-]{1,100}$/i.test(x.site) ? x.site : '';
      const at = typeof x.at === 'string' && Number.isFinite(Date.parse(x.at)) ? x.at : null;
      if (url && title && site && list.length < 4) list.push({ topic, title, url, site, at });
    }
    lists.push(list);
  }
  const out: Headline[] = [];
  for (let i = 0; out.length < 8 && lists.some((l) => l[i]); i++) for (const l of lists) if (l[i] && out.length < 8) out.push(l[i]);
  return out;
}

let cache: { at: number; items: Headline[] } | null = null;
let inflight: Promise<Headline[]> | null = null;

/** Tests only. */
export function resetHeadlines(): void {
  cache = null;
  inflight = null;
}

/** The current headlines; [] when there are none or the request fails. Never throws. */
export function loadHeadlines(now = Date.now()): Promise<Headline[]> {
  if (cache && now - cache.at < TTL_MS) return Promise.resolve(cache.items);
  if (!inflight) {
    inflight = fetch(HEADLINES_ENDPOINT, { headers: { accept: 'application/json' } })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: unknown) => readHeadlines(j))
      .catch(() => [] as Headline[])
      .then((items) => {
        cache = { at: Date.now(), items };
        inflight = null;
        return items;
      });
  }
  return inflight;
}

/** What tapping a headline asks: about this story, now (so the chat searches for it). */
export const headlinePrompt = (h: Pick<Headline, 'title'>): string => `What's the latest news on this: "${h.title}"?`;

/** "2h ago" / "just now" for a story's observation time; '' when unknown or in the future. */
export function seenAgo(at: string | null, now = Date.now()): string {
  if (!at) return '';
  const ms = now - Date.parse(at);
  if (!Number.isFinite(ms) || ms < 0) return '';
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 5) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
