/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * SEO URL corpus — the "infinite catalog" feed (4.15.0).
 *
 * Google can only index URLs it can DISCOVER. The live-search sitemaps top out
 * at a few thousand URLs, so the site looked like ~1 page in search. This
 * module grows a persistent corpus (vinax_seo_urls) with every catalog entity
 * we ever learn about:
 *
 *   - the seo-crawl cron walks artists page-by-page into their full
 *     song/album lists (the big multiplier — thousands of URLs per artist),
 *   - every entity page render harvests the entity + everything it links to,
 *   - every live-search sitemap rebuild contributes its finds.
 *
 * The corpus is then served back as paginated /sitemaps/<type>-<n>.xml files
 * (10k URLs each, unbounded page count) via the /sitemap.xml index. Rows are
 * PUBLIC catalog metadata only. Everything here is fail-silent: no Supabase,
 * no harm — the legacy sitemaps keep working exactly as before.
 */
import { sbInsertIgnore, supabaseConfigured, type SupabaseEnv } from './supabase';

export type SeoType = 'song' | 'album' | 'artist' | 'playlist';

export interface SeoRow {
  key: string;
  type: SeoType;
  entity_id: string;
  slug: string;
  title: string;
  /** Always present (null when unknown): PostgREST bulk inserts REQUIRE every
   *  row in a batch to have identical keys (PGRST102) — a mixed batch where
   *  only some rows carried `lang` failed wholesale (4.15.0 bootstrap bug:
   *  "seen":1028, "inserted":0). */
  lang: string | null;
}

/** Sitemap page size. MUST be ≤ Supabase's PostgREST max-rows (default 1000):
 *  a larger `limit=` is SILENTLY truncated to 1000, so with 10k pages the
 *  rows between 1000 and 9999 of every page were invisible to Google (found
 *  via GSC showing exactly 1,000 discovered per corpus sitemap, 4.16.3). */
export const SEO_PAGE_SIZE = 1000;

/** Plural page-name ↔ entity type (sitemap files read /sitemaps/songs-N.xml). */
export const SEO_TYPES: Record<string, SeoType> = {
  songs: 'song',
  albums: 'album',
  artists: 'artist',
  playlists: 'playlist',
};

export function slugify(text: unknown): string {
  return (
    String(text ?? '')
      .toLowerCase()
      .normalize('NFKD')
      // HTML entities from the catalog (&quot; &amp; …) must never become
      // slug words ('-quot-') — strip entity patterns before the collapse.
      .replace(/&[a-z]+;|&#x?[0-9a-f]+;/gi, ' ')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'x'
  );
}

/** Strict allow-list for catalog ids (audit M-SRV-7 — ids end up inside XML). */
export function safeId(id: unknown): string {
  return String(id ?? '').replace(/[^\w-]/g, '');
}

/** Build a corpus row; null when the entity has no usable id or name. */
export function seoRow(type: SeoType, id: unknown, name: unknown, lang?: unknown): SeoRow | null {
  const eid = safeId(id);
  const title = String(name ?? '').trim();
  if (!eid || !title) return null;
  return {
    key: `${type}:${eid}`,
    type,
    entity_id: eid,
    slug: slugify(title),
    title: title.slice(0, 200),
    lang: typeof lang === 'string' && lang ? lang.toLowerCase().slice(0, 24) : null,
  };
}

/** Primary artists of an upstream song/album object → rows. */
export function artistRows(a: any): SeoRow[] {
  const prim = a?.primary ?? a?.all ?? (Array.isArray(a) ? a : []);
  if (!Array.isArray(prim)) return [];
  return prim.map((x: any) => seoRow('artist', x?.id, x?.name)).filter((r): r is SeoRow => !!r);
}

/** One upstream song object → its row + linked album/artist rows. */
export function songRowsDeep(s: any): SeoRow[] {
  const rows: SeoRow[] = [];
  const song = seoRow('song', s?.id, s?.name ?? s?.title, s?.language);
  if (song) rows.push(song);
  const album = seoRow('album', s?.album?.id, s?.album?.name, s?.language);
  if (album) rows.push(album);
  rows.push(...artistRows(s?.artists));
  return rows;
}

/** Upstream list payloads come in several shapes — accept all of them. */
export function parseResults(j: any): any[] {
  const d = j?.data ?? j;
  const arr = d?.results ?? d?.songs ?? d?.albums ?? d?.playlists ?? (Array.isArray(d) ? d : []);
  return Array.isArray(arr) ? arr : [];
}

/** De-dupe rows by key (batches often re-discover the same entity). */
export function dedupeRows(rows: Array<SeoRow | null | undefined>): SeoRow[] {
  const seen = new Set<string>();
  const out: SeoRow[] = [];
  for (const r of rows) {
    if (!r || seen.has(r.key)) continue;
    seen.add(r.key);
    out.push(r);
  }
  return out;
}

/**
 * Persist discovered rows (ignore-duplicates on key: existing rows keep their
 * added_at/frontier state). One batched POST regardless of row count.
 * Returns how many rows were actually NEW (best-effort; -1 = not configured).
 */
export async function harvest(env: SupabaseEnv, rows: Array<SeoRow | null | undefined>): Promise<number> {
  if (!supabaseConfigured(env)) return -1;
  const batch = dedupeRows(rows);
  if (!batch.length) return 0;
  const inserted = await sbInsertIgnore<{ key: string }>(env, 'vinax_seo_urls', batch, 'key');
  return inserted ? inserted.length : 0;
}

/**
 * Fire-and-forget harvest for request paths (entity renders, sitemaps):
 * runs after the response via waitUntil when available, never throws.
 */
export function harvestSoon(
  env: SupabaseEnv,
  rows: Array<SeoRow | null | undefined>,
  waitUntil?: (p: Promise<unknown>) => void,
): void {
  const p = harvest(env, rows).catch(() => -1);
  try {
    waitUntil?.(p);
  } catch {
    /* no execution context — the promise still runs */
  }
}
