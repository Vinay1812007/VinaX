/**
 * Live free-model catalogs for the two aggregator keys (v5.21.0).
 *
 * The other sixteen secrets each sign exactly one pinned model. These two do
 * not: one key opens a whole account catalog, the other a marketplace of
 * hundreds. The owner's requirement is "every model they provide free, with
 * the model name selectable for chat" — so instead of hard-coding a list that
 * rots the week after it ships, VinaX asks each provider for its own /models
 * list at runtime and keeps only what it can honestly offer:
 *
 *   - CHAT-CAPABLE ONLY. Transcription, speech, embedding, moderation and
 *     image-output models ride different endpoints entirely; listing them in
 *     a chat picker would hand the listener an engine that 404s.
 *   - FREE ONLY. On the marketplace host that means the provider prices BOTH
 *     prompt and completion at zero — a paid slug is never selectable, so the
 *     key cannot quietly run up a bill. The other host's catalog is free at
 *     the account tier the key belongs to.
 *
 * Nothing here is invented: an empty list means the provider answered with
 * nothing usable (or the key is missing), and the caller says so plainly
 * rather than falling back to a stale hard-coded menu.
 */
import { LANE_BASE, type AiEnv } from './ai';

/** One selectable model from a provider catalog. */
export interface CatalogModel {
  /** Exact slug to send as `model` — never prettified. */
  id: string;
  /** Display label: the model's own name, vendor prefix stripped. */
  label: string;
  /** Which aggregator key serves it. */
  provider: CatalogProvider;
  /** Provider-reported context window, when it reports one. */
  context: number | null;
}

export type CatalogProvider = 'grq' | 'opr';

/** Which env secret and /models URL each catalog provider uses. */
const SOURCE: Record<CatalogProvider, { env: keyof AiEnv; url: string }> = {
  grq: { env: 'VINAX_GROQ_API_KEY', url: `${LANE_BASE.scholar}/models` },
  opr: { env: 'VINAX_OPENROUTER_API_KEY', url: `${LANE_BASE.router}/models` },
};

/** Slug fragments that mark a model as NOT a chat-completions engine. */
const NON_CHAT = /whisper|tts|text-to-speech|speech|transcri|embed|rerank|moderat|guard|prompt-?shield|image|diffusion|video|sdxl|flux/i;

const TTL_MS = 15 * 60_000;
const cache = new Map<CatalogProvider, { at: number; models: CatalogModel[] }>();

/** "meta-llama/llama-3.3-70b-instruct:free" -> "llama-3.3-70b-instruct".
 *  The vendor prefix and the routing suffix are plumbing, not a model name. */
export function catalogLabel(id: string): string {
  const tail = id.includes('/') ? id.slice(id.lastIndexOf('/') + 1) : id;
  return tail.replace(/:(free|beta|extended|nitro|floor)$/i, '').trim() || id;
}

/** True when the provider prices this model at zero in BOTH directions.
 *  Prices arrive as decimal strings ("0", "0.0000002"); anything that is not
 *  numerically zero counts as paid, and anything unparseable counts as paid
 *  too — an unknown price is never assumed free. */
export function isFreePricing(pricing: unknown): boolean {
  if (!pricing || typeof pricing !== 'object') return false;
  const p = pricing as Record<string, unknown>;
  const zero = (v: unknown): boolean => {
    const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
    return Number.isFinite(n) && n === 0;
  };
  return zero(p.prompt) && zero(p.completion);
}

/** Shape-tolerant parse of an OpenAI-compatible /models body into the chat
 *  models VinaX may offer. Exported for tests — no network, pure. */
export function parseCatalog(provider: CatalogProvider, body: unknown): CatalogModel[] {
  const rows = (body as { data?: unknown } | null)?.data;
  if (!Array.isArray(rows)) return [];
  const out: CatalogModel[] = [];
  const seen = new Set<string>();
  for (const raw of rows) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    const id = typeof r.id === 'string' ? r.id.trim() : '';
    if (!id || seen.has(id)) continue;
    // Retired / disabled rows are still returned by some catalogs.
    if (r.active === false) continue;
    if (NON_CHAT.test(id)) continue;
    // The marketplace host reports modalities and prices; keep text-out
    // models the provider charges nothing for.
    if (provider === 'opr') {
      if (!isFreePricing(r.pricing)) continue;
      const arch = r.architecture as { output_modalities?: unknown } | undefined;
      const outMods = Array.isArray(arch?.output_modalities) ? (arch?.output_modalities as unknown[]) : null;
      if (outMods && !outMods.includes('text')) continue;
    }
    const ctxRaw = r.context_length ?? r.context_window;
    const context = typeof ctxRaw === 'number' && Number.isFinite(ctxRaw) ? Math.round(ctxRaw) : null;
    seen.add(id);
    out.push({ id, label: catalogLabel(id), provider, context });
  }
  return out.sort((a, b) => a.label.localeCompare(b.label));
}

/** One provider's free chat catalog, cached per isolate for 15 minutes.
 *  Returns [] when the key is missing or the provider is unreachable — the
 *  caller reports an empty menu honestly instead of guessing. */
export async function fetchCatalog(env: AiEnv, provider: CatalogProvider): Promise<CatalogModel[]> {
  const hit = cache.get(provider);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.models;
  const { env: envKey, url } = SOURCE[provider];
  const key = env[envKey];
  if (!key) return [];
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 8000);
  try {
    const res = await fetch(url, {
      headers: { authorization: `Bearer ${key}`, accept: 'application/json' },
      signal: abort.signal,
    });
    if (!res.ok) return hit?.models ?? [];
    const models = parseCatalog(provider, await res.json().catch(() => null));
    // Never cache an empty answer over a good one: a blip must not blank the
    // picker for the next quarter of an hour.
    if (!models.length && hit) return hit.models;
    cache.set(provider, { at: Date.now(), models });
    return models;
  } catch {
    return hit?.models ?? [];
  } finally {
    clearTimeout(timer);
  }
}

/** Both catalogs at once — what the engine picker and the admin Lab read. */
export async function fullCatalog(env: AiEnv): Promise<{ grq: CatalogModel[]; opr: CatalogModel[] }> {
  const [grq, opr] = await Promise.all([fetchCatalog(env, 'grq'), fetchCatalog(env, 'opr')]);
  return { grq, opr };
}

/** Guard for a caller-supplied model slug: it must be a model the provider
 *  actually lists right now. A slug that is not in the live free catalog is
 *  refused rather than forwarded, so no request can route a paid or unknown
 *  model onto the key. */
export async function resolveCatalogModel(
  env: AiEnv,
  provider: CatalogProvider,
  wanted: string | null | undefined,
): Promise<string | null> {
  if (!wanted || typeof wanted !== 'string') return null;
  const slug = wanted.trim();
  if (!slug || slug.length > 128 || !/^[\w./:-]+$/.test(slug)) return null;
  const models = await fetchCatalog(env, provider);
  return models.some((m) => m.id === slug) ? slug : null;
}

/** Clear the isolate cache — tests only. */
export function resetCatalogCache(): void {
  cache.clear();
}
