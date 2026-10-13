/**
 * 11.9 — "Trending now" on the empty VinaX AI chat: a few current headlines
 * (India news and tech), refreshed by a scheduled job, the same for everyone.
 *
 * Why a job and not a cache on the request: the edge cache is per data centre,
 * so refreshing on request would search once per data centre per refresh and
 * the spend would grow with traffic. The job (POST /api/cron/headlines, every
 * three hours from .github/workflows/headlines.yml) makes exactly one search
 * per topic — at most 16 a day — and stores the result in `vinax_config` key
 * `ai-headlines`; GET /api/ai/headlines only reads that row.
 *
 * Credits: the job runs only while the owner's `web-search` switch and the
 * emergency stop allow it, and only while today's searches are under 75 % of
 * SERPER_DAILY_LIMIT (`capShare`), so listeners' own searches keep priority.
 * A topic whose search fails keeps its previous headlines.
 *
 * Nothing about any listener is sent or stored: the queries are fixed.
 */
import { aiGate } from './ai';
import { serperSearch, type SerperEnv } from './serper';
import { sbSelectResult, sbUpsert, supabaseConfigured } from './supabase';

export const HEADLINES_KEY = 'ai-headlines';
/** Share of the daily search cap the job may use (listeners keep the rest). */
export const HEADLINES_CAP_SHARE = 0.75;
/** Headlines older than this are not shown. */
export const HEADLINES_MAX_AGE_MS = 24 * 60 * 60_000;
const PER_TOPIC = 4;
const READ_TTL_MS = 5 * 60_000;

export interface HeadlineTopic {
  id: 'india' | 'tech';
  label: string;
  query: string;
}
/** Fixed queries — never built from anything a listener sent. */
export const HEADLINE_TOPICS: readonly HeadlineTopic[] = [
  { id: 'india', label: 'India', query: 'India top news today' },
  { id: 'tech', label: 'Tech', query: 'technology news today' },
];

export interface Headline {
  title: string;
  url: string;
  site: string;
  /** 13.1 — when the job FIRST stored this item (ISO). An observation time,
   *  not a publication claim: the search's own "2 hours ago" is relative and
   *  unverifiable, so the strip says when VinaX saw the story instead. Old
   *  stored documents have no `at`; those items read as null. */
  at: string | null;
}
export interface HeadlinesDoc {
  updatedAt: string;
  topics: Array<{ id: HeadlineTopic['id']; label: string; items: Headline[] }>;
}

const hostOf = (url: string): string => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
};

/** One story under two spellings is one story: lower-cased letters and digits only. */
const titleKey = (title: string): string => title.toLowerCase().normalize('NFKC').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/** A stored or received document, validated: known topics, http(s) links,
 *  clipped titles. 13.1 — one story once across the WHOLE strip: the same
 *  url, or the same title under different sites or topics, keeps only its
 *  first appearance (the India list outranks Tech for a shared story).
 *  Null when unusable. */
export function readHeadlinesDoc(raw: unknown): HeadlinesDoc | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as { updatedAt?: unknown; topics?: unknown };
  const at = typeof r.updatedAt === 'string' && Number.isFinite(Date.parse(r.updatedAt)) ? r.updatedAt : null;
  if (!at || !Array.isArray(r.topics)) return null;
  const topics: HeadlinesDoc['topics'] = [];
  const urls = new Set<string>();
  const titles = new Set<string>();
  for (const t of HEADLINE_TOPICS) {
    const found = (r.topics as unknown[]).find((x) => !!x && typeof x === 'object' && (x as { id?: unknown }).id === t.id) as { items?: unknown } | undefined;
    const items: Headline[] = [];
    for (const it of Array.isArray(found?.items) ? found.items : []) {
      const o = (it ?? {}) as { title?: unknown; url?: unknown; at?: unknown };
      const url = typeof o.url === 'string' && /^https?:\/\/\S+$/i.test(o.url) ? o.url : '';
      const title = typeof o.title === 'string' ? o.title.replace(/\s+/g, ' ').trim().slice(0, 160) : '';
      const site = hostOf(url);
      const seen = typeof o.at === 'string' && Number.isFinite(Date.parse(o.at)) ? o.at : null;
      if (!url || !title || !site || urls.has(url) || titles.has(titleKey(title))) continue;
      urls.add(url);
      titles.add(titleKey(title));
      items.push({ title, url, site, at: seen });
      if (items.length >= PER_TOPIC) break;
    }
    topics.push({ id: t.id, label: t.label, items });
  }
  return { updatedAt: at, topics };
}

async function readStored(env: SerperEnv): Promise<HeadlinesDoc | null> {
  const r = await sbSelectResult<{ value: unknown }>(env, 'vinax_config', `key=eq.${HEADLINES_KEY}&select=value&limit=1`);
  return r.ok && r.rows[0] ? readHeadlinesDoc(r.rows[0].value) : null;
}

let readCache: { at: number; doc: HeadlinesDoc | null } | null = null;
/** Tests only. */
export function resetHeadlinesCache(): void {
  readCache = null;
}

/** What the strip shows: the stored headlines, unless switched off, missing
 *  or older than a day. 13.1 — a single item ages out on its own `at` too:
 *  a story a failed refresh carried forward for a day drops even while the
 *  document's own stamp is fresh (an item with no `at` ages with the doc). */
export async function currentHeadlines(env: SerperEnv, now = Date.now()): Promise<HeadlinesDoc | null> {
  if (!supabaseConfigured(env)) return null;
  if (await aiGate(env, 'web-search')) return null;
  if (!readCache || now - readCache.at > READ_TTL_MS) readCache = { at: now, doc: await readStored(env).catch(() => null) };
  const doc = readCache.doc;
  if (!doc || now - Date.parse(doc.updatedAt) > HEADLINES_MAX_AGE_MS) return null;
  const fresh: HeadlinesDoc = {
    updatedAt: doc.updatedAt,
    topics: doc.topics.map((t) => ({ ...t, items: t.items.filter((h) => !h.at || now - Date.parse(h.at) <= HEADLINES_MAX_AGE_MS) })),
  };
  return fresh.topics.some((t) => t.items.length) ? fresh : null;
}

export type RefreshOutcome =
  | { ok: true; topics: Record<string, number>; stored: boolean }
  | { ok: false; reason: 'not_configured' | 'disabled' | 'no_results' | 'store_failed' };

/** The job: one search per topic, then one upsert. A topic that found nothing keeps what it had. */
export async function refreshHeadlines(env: SerperEnv, waitUntil?: (p: Promise<unknown>) => void): Promise<RefreshOutcome> {
  if (!supabaseConfigured(env) || !env.SERPER_API_KEY?.trim()) return { ok: false, reason: 'not_configured' };
  if (await aiGate(env, 'web-search')) return { ok: false, reason: 'disabled' };
  const previous = await readStored(env).catch(() => null);
  const counts: Record<string, number> = {};
  const topics: HeadlinesDoc['topics'] = [];
  const stamp = new Date().toISOString();
  for (const t of HEADLINE_TOPICS) {
    const found = await serperSearch(env, t.query, { news: true, country: 'in', lang: 'en', capShare: HEADLINES_CAP_SHARE, waitUntil });
    counts[t.id] = found.results.length;
    // 13.1 — a story already stored keeps its FIRST observation time; only a
    // story new to the strip gets this run's stamp, so "seen 5h ago" is true.
    const before = new Map((previous?.topics.flatMap((x) => x.items) ?? []).map((h) => [h.url, h.at]));
    const fresh = found.results.slice(0, PER_TOPIC).map((r) => ({ title: r.title, url: r.url, site: hostOf(r.url), at: before.get(r.url) ?? stamp })).filter((h) => h.site);
    const kept = previous?.topics.find((x) => x.id === t.id)?.items ?? [];
    topics.push({ id: t.id, label: t.label, items: fresh.length ? fresh : kept });
  }
  if (!Object.values(counts).some((n) => n > 0)) return { ok: false, reason: 'no_results' };
  const doc = readHeadlinesDoc({ updatedAt: new Date().toISOString(), topics });
  if (!doc) return { ok: false, reason: 'no_results' };
  const stored = await sbUpsert(env, 'vinax_config', { key: HEADLINES_KEY, value: doc, updated_at: doc.updatedAt }, 'key');
  if (!stored) return { ok: false, reason: 'store_failed' };
  readCache = { at: Date.now(), doc };
  return { ok: true, topics: counts, stored };
}
