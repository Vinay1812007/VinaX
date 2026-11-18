/**
 * Node stand-ins for the Cloudflare bindings the Worker uses (wrangler.toml):
 *
 *   HANDOFF                 KV namespace   -> fileKv (one JSON file on disk)
 *   RATE_LIMIT_* and
 *   ADMIN_AUTH_FAILS        Rate Limiting  -> fixedWindowLimiter (in memory)
 *   AI                      Workers AI     -> workersAiRest (Cloudflare's REST API)
 *   request.cf              edge metadata  -> cfFromHeaders (Cloudflare's
 *                                             visitor location headers)
 *
 * Each one answers the same calls, in the same shapes, as the binding it
 * replaces, so worker/functions runs unchanged. See README.md (Operations),
 * "Running the API on a server".
 */
import { mkdirSync, readFileSync } from 'node:fs';
import { rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

// ---------------------------------------------------------------------------
// KV

export interface KvLike {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void>;
  delete(key: string): Promise<void>;
}

interface KvEntry {
  v: string;
  /** Expiry, ms since epoch; absent = never. */
  e?: number;
}

/**
 * A tiny KV: every key in one JSON file, rewritten whole on each write
 * (atomically, through a temporary file). HANDOFF holds two small keys (the
 * IndexNow list and the Android push reports), so this is plenty.
 */
export function fileKv(path: string, now: () => number = Date.now): KvLike {
  const map = new Map<string, KvEntry>();
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as Record<string, KvEntry>;
    for (const [k, entry] of Object.entries(raw)) {
      if (entry && typeof entry.v === 'string') map.set(k, entry);
    }
  } catch {
    // No file yet (or unreadable): start empty.
  }
  let chain: Promise<void> = Promise.resolve();
  const save = (): Promise<void> => {
    const snapshot = JSON.stringify(Object.fromEntries(map));
    chain = chain
      .then(async () => {
        mkdirSync(dirname(path), { recursive: true });
        const tmp = `${path}.${process.pid}.tmp`;
        await writeFile(tmp, snapshot, 'utf8');
        await rename(tmp, path);
      })
      .catch((e) => console.error(`[kv] could not save ${path}: ${e instanceof Error ? e.message : String(e)}`));
    return chain;
  };
  const live = (key: string): KvEntry | undefined => {
    const entry = map.get(key);
    if (entry?.e !== undefined && entry.e <= now()) {
      map.delete(key);
      return undefined;
    }
    return entry;
  };
  return {
    async get(key) {
      return live(key)?.v ?? null;
    },
    async put(key, value, opts) {
      const ttl = opts?.expirationTtl;
      map.set(key, typeof ttl === 'number' && ttl > 0 ? { v: String(value), e: now() + ttl * 1000 } : { v: String(value) });
      await save();
    },
    async delete(key) {
      if (map.delete(key)) await save();
    },
  };
}

// ---------------------------------------------------------------------------
// Rate Limiting

export interface RateLimitLike {
  limit(opts: { key: string }): Promise<{ success: boolean }>;
}

/**
 * The Workers Rate Limiting binding's `simple = { limit, period }`: at most
 * `limit` calls per key in each fixed `period`-second window. One process
 * holds every counter, so on a single server the limit is global (on
 * Cloudflare it was per location).
 */
export function fixedWindowLimiter(limit: number, periodSec: number, now: () => number = Date.now, maxKeys = 50_000): RateLimitLike {
  const windows = new Map<string, { start: number; count: number }>();
  const periodMs = periodSec * 1000;
  return {
    async limit({ key }) {
      const t = now();
      let w = windows.get(key);
      if (!w || t - w.start >= periodMs) {
        if (!w && windows.size >= maxKeys) {
          for (const [k, old] of windows) if (t - old.start >= periodMs) windows.delete(k);
          if (windows.size >= maxKeys) windows.clear();
        }
        w = { start: t, count: 0 };
        windows.set(key, w);
      }
      w.count += 1;
      return { success: w.count <= limit };
    },
  };
}

// ---------------------------------------------------------------------------
// Workers AI

export interface AiLike {
  run(model: string, inputs: Record<string, unknown>): Promise<unknown>;
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/**
 * `env.AI.run(model, inputs)` over Cloudflare's REST API
 * (POST /accounts/{id}/ai/run/{model}). It draws on the same free daily
 * neuron pool as the binding did.
 *
 * - `stream: true` answers the SSE body as a ReadableStream, as the binding does.
 * - Otherwise it answers the JSON `result` (FLUX answers `{ image: base64 }`),
 *   or the raw bytes when the model answers a picture directly.
 * - Failures throw an Error whose message carries Cloudflare's code
 *   ("4006: …"), which is what adapters/workersAi.ts workersAiError reads.
 */
export function workersAiRest(accountId: string, token: string, fetchImpl: FetchLike = fetch): AiLike {
  const base = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/ai/run/`;
  return {
    async run(model, inputs) {
      const res = await fetchImpl(base + encodeURI(model), {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify(inputs),
      });
      const type = res.headers.get('content-type') ?? '';
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        let detail = text.slice(0, 300) || `HTTP ${res.status}`;
        try {
          const j = JSON.parse(text) as { errors?: Array<{ code?: number; message?: string }> };
          const first = j.errors?.[0];
          if (first) detail = `${first.code ?? res.status}: ${first.message ?? ''}`;
        } catch {
          // Not JSON: keep the text.
        }
        if (res.status === 429 && !/\b(4006|3036)\b/.test(detail)) detail = `3036: rate limit (${detail})`;
        throw new Error(`Workers AI ${detail}`);
      }
      if (inputs.stream === true && type.includes('text/event-stream')) return res.body;
      if (type.includes('application/json')) {
        const j = (await res.json()) as { result?: unknown; success?: boolean; errors?: Array<{ code?: number; message?: string }> };
        if (j.success === false) {
          const first = j.errors?.[0];
          throw new Error(`Workers AI ${first?.code ?? 'error'}: ${first?.message ?? 'failed'}`);
        }
        return j.result;
      }
      return new Uint8Array(await res.arrayBuffer());
    },
  };
}

// ---------------------------------------------------------------------------
// request.cf

export interface CfLike {
  country?: string;
  region?: string;
  regionCode?: string;
  city?: string;
  postalCode?: string;
  timezone?: string;
  continent?: string;
  latitude?: string;
  longitude?: string;
}

/**
 * Rebuild the parts of `request.cf` the routes read from the headers
 * Cloudflare adds in front of an origin. Country is always there
 * (cf-ipcountry); region, city and timezone need the free Managed Transform
 * "Add visitor location headers" turned on for the zone.
 */
export function cfFromHeaders(h: Headers): CfLike {
  const pick = (name: string): string | undefined => {
    const v = h.get(name)?.trim();
    return v ? v : undefined;
  };
  const cf: CfLike = {
    country: pick('cf-ipcountry'),
    region: pick('cf-region'),
    regionCode: pick('cf-region-code'),
    city: pick('cf-ipcity'),
    postalCode: pick('cf-postal-code'),
    timezone: pick('cf-timezone'),
    continent: pick('cf-ipcontinent'),
    latitude: pick('cf-iplatitude'),
    longitude: pick('cf-iplongitude'),
  };
  for (const k of Object.keys(cf) as Array<keyof CfLike>) if (cf[k] === undefined) delete cf[k];
  return cf;
}
