/**
 * Embeddings for the personal engine. One model (config.embedModel) defines
 * the space; a song's row names the model its vector came from, and a page
 * only compares vectors of one model. Two providers are known:
 *
 *   cloudflare:<model>   the Worker's AI binding, `{ text: string[] }` in, `{ data: number[][] }` out
 *   gemini:<model>       the Gemini batch embedding endpoint, GEMINI_API_KEY, asked for EMBED_DIMENSIONS
 *
 * Every vector is unit-normalised before it is stored. A song is embedded
 * from its title, artists, album, language, year and facets — the words the
 * catalogue has — so songs by the same artists, from the same films, in the
 * same language and era, sit near each other; what listeners actually do
 * with them comes in through co-listening and the taste model's affinities.
 */
import { db, q, type DbEnv } from '../db';
import type { AiKeysEnv, WorkersAiBinding } from '../ai/types';
import { catalogueSongs } from './catalogue';
import { EMBED_DIMENSIONS } from './config';
import { touchSongs } from './songs';
import type { SongFacts, SongRow } from './types';

type CatalogueEnv = { CATALOG_UPSTREAMS?: string; CATALOG_DIRECT_URL?: string };

export type EmbedEnv = DbEnv & Pick<AiKeysEnv, 'AI' | 'GEMINI_API_KEY'>;

export const EMBED_BATCH = 50;

/** The text that stands for a song in the embedding space. */
export function songText(s: SongFacts | SongRow): string {
  const artists = 'artists' in s && Array.isArray(s.artists) && s.artists.length ? s.artists.map((a) => a.name).join(', ') : s.artist;
  const parts = [`${s.title} — ${artists}`];
  if (s.album && s.album !== s.title) parts.push(`Album: ${s.album}`);
  if (s.language) parts.push(`Language: ${s.language}`);
  if (s.year) parts.push(`Year: ${s.year}`);
  const f = s.facets ?? {};
  const tags = [f.mood, f.genre, f.vibe].filter((t): t is string => typeof t === 'string' && !!t);
  if (tags.length) parts.push(`Style: ${tags.join(', ')}`);
  return parts.join('. ');
}

export function normalise(v: number[]): number[] {
  let sum = 0;
  for (const x of v) sum += x * x;
  const n = Math.sqrt(sum);
  return n > 0 ? v.map((x) => x / n) : v;
}

const isVector = (v: unknown): v is number[] => Array.isArray(v) && v.length === EMBED_DIMENSIONS && v.every((x) => typeof x === 'number' && Number.isFinite(x));

export function providerOf(model: string): { provider: 'cloudflare' | 'gemini'; upstream: string } | null {
  const i = model.indexOf(':');
  if (i < 1) return null;
  const provider = model.slice(0, i);
  const upstream = model.slice(i + 1);
  return (provider === 'cloudflare' || provider === 'gemini') && upstream ? { provider, upstream } : null;
}

/** Can this Worker embed with `model` right now? */
export function embedConfigured(env: EmbedEnv, model: string): boolean {
  const p = providerOf(model);
  if (!p) return false;
  if (p.provider === 'cloudflare') return typeof (env.AI as WorkersAiBinding | undefined)?.run === 'function';
  return !!env.GEMINI_API_KEY?.trim();
}

async function embedWorkersAi(ai: WorkersAiBinding, upstream: string, texts: string[]): Promise<number[][]> {
  const out = (await ai.run(upstream, { text: texts })) as { data?: unknown } | null;
  const data = out && Array.isArray(out.data) ? out.data : null;
  if (!data || data.length !== texts.length || !data.every(isVector)) throw new Error('embedding: unexpected answer shape');
  return data;
}

async function embedGemini(key: string, upstream: string, texts: string[], fetchImpl: typeof fetch): Promise<number[][]> {
  const res = await fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(upstream)}:batchEmbedContents`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({
      requests: texts.map((text) => ({ model: `models/${upstream}`, content: { parts: [{ text }] }, taskType: 'SEMANTIC_SIMILARITY', outputDimensionality: EMBED_DIMENSIONS })),
    }),
  });
  if (!res.ok) throw new Error(`embedding: upstream ${res.status}`);
  const body = (await res.json().catch(() => null)) as { embeddings?: Array<{ values?: unknown }> } | null;
  const data = body?.embeddings?.map((e) => e.values) ?? [];
  if (data.length !== texts.length || !data.every(isVector)) throw new Error('embedding: unexpected answer shape');
  return data as number[][];
}

/** Vectors for `texts`, unit-normalised, in order. Throws when the provider fails. */
export async function embedTexts(env: EmbedEnv, model: string, texts: string[], fetchImpl: typeof fetch = fetch): Promise<number[][]> {
  if (!texts.length) return [];
  const p = providerOf(model);
  if (!p) throw new Error('embedding: unknown model');
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += EMBED_BATCH) {
    const slice = texts.slice(i, i + EMBED_BATCH);
    const vectors = p.provider === 'cloudflare'
      ? await embedWorkersAi(env.AI as WorkersAiBinding, p.upstream, slice)
      : await embedGemini(env.GEMINI_API_KEY!.trim(), p.upstream, slice, fetchImpl);
    for (const v of vectors) out.push(normalise(v));
  }
  return out;
}

/** The database's text form of a vector. */
export const vectorLiteral = (v: number[]): string => `[${v.map((x) => (Math.abs(x) < 1e-7 ? 0 : Number(x.toFixed(7)))).join(',')}]`;

/**
 * Embed rows and write their vectors. Answers how many were written; a
 * provider failure writes nothing and answers 0 (the backlog job returns to
 * them). Rows already embedded in this model are skipped.
 */
export async function embedSongs(env: EmbedEnv, model: string, rows: readonly (SongFacts | SongRow)[], fetchImpl: typeof fetch = fetch): Promise<number> {
  const todo = rows.filter((r) => !('embed_model' in r) || r.embed_model !== model);
  if (!todo.length || !embedConfigured(env, model)) return 0;
  let vectors: number[][];
  try {
    vectors = await embedTexts(env, model, todo.map(songText), fetchImpl);
  } catch (e) {
    console.log(JSON.stringify({ route: 'personal-embed', ok: false, n: todo.length, error: e instanceof Error ? e.message.slice(0, 120) : 'failed' }));
    return 0;
  }
  let written = 0;
  for (let i = 0; i < todo.length; i += EMBED_BATCH) {
    const rows: Record<string, string> = {};
    todo.slice(i, i + EMBED_BATCH).forEach((row, j) => { rows[row.id] = vectorLiteral(vectors[i + j]); });
    const r = await db.rpc<number>(env, 'personal_set_embeddings', { p_model: model, p_rows: rows }, { timeoutMs: 20_000 });
    if (r.ok && typeof r.value === 'number') written += r.value;
  }
  return written;
}

/** The backlog job: embed up to `limit` verified songs that have no vector in this model's space. */
export async function runEmbedBacklog(env: EmbedEnv, model: string, limit = 200): Promise<{ embedded: number; backlog: number }> {
  if (!embedConfigured(env, model)) return { embedded: 0, backlog: -1 };
  const r = await db.rpc<SongRow[]>(env, 'personal_embed_backlog', { p_limit: limit, p_model: model });
  if (!r.ok || !Array.isArray(r.value)) return { embedded: 0, backlog: -1 };
  const embedded = await embedSongs(env, model, r.value);
  return { embedded, backlog: r.value.length - embedded };
}

/**
 * Confirm device-asserted songs against the catalogue: a song the catalogue
 * knows is rewritten with the catalogue's facts and verified; a song it does
 * not know is removed (it never reached a page). `limit` bounds the catalogue
 * calls one run makes.
 */
export async function runVerifyBacklog(env: EmbedEnv & CatalogueEnv, limit = 25): Promise<{ verified: number; dropped: number; left: number }> {
  const r = await db.rpc<SongRow[]>(env, 'personal_unverified', { p_limit: limit });
  if (!r.ok || !Array.isArray(r.value) || !r.value.length) return { verified: 0, dropped: 0, left: 0 };
  const found = await catalogueSongs(env, r.value.map((s) => s.id), limit);
  const known = new Set(found.map((f) => f.id));
  if (found.length) await touchSongs(env, found, true);
  const missing = r.value.map((s) => s.id).filter((id) => !known.has(id));
  if (missing.length) await db.remove(env, 'personal_songs', q().in('id', missing).eq('verified', 'false'));
  return { verified: found.length, dropped: missing.length, left: r.value.length === limit ? -1 : 0 };
}
