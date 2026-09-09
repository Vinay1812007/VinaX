/**
 * Free-model catalog (v5.21.0) — the two aggregator keys open whole catalogs
 * instead of one pinned engine, so the filters that decide what a listener
 * may select are the safety boundary: a paid slug must never reach the
 * marketplace key, and a non-chat model must never reach a chat picker.
 */
import { describe, expect, it, beforeEach, vi, afterEach } from 'vitest';
import {
  catalogLabel,
  fetchCatalog,
  isFreePricing,
  parseCatalog,
  resetCatalogCache,
  resolveCatalogModel,
} from '../functions/_lib/catalog';

beforeEach(() => resetCatalogCache());
afterEach(() => vi.unstubAllGlobals());

describe('catalogLabel', () => {
  it('drops the vendor prefix and the routing suffix', () => {
    expect(catalogLabel('meta-llama/llama-3.3-70b-instruct:free')).toBe('llama-3.3-70b-instruct');
    expect(catalogLabel('llama-3.3-70b-versatile')).toBe('llama-3.3-70b-versatile');
  });
});

describe('isFreePricing', () => {
  it('accepts zero in both directions, in either numeric shape', () => {
    expect(isFreePricing({ prompt: '0', completion: '0' })).toBe(true);
    expect(isFreePricing({ prompt: 0, completion: 0 })).toBe(true);
  });

  it('rejects anything priced, half-priced, missing or unparseable', () => {
    expect(isFreePricing({ prompt: '0', completion: '0.0000002' })).toBe(false);
    expect(isFreePricing({ prompt: '0' })).toBe(false);
    expect(isFreePricing({ prompt: 'free', completion: 'free' })).toBe(false);
    expect(isFreePricing(null)).toBe(false);
  });
});

describe('parseCatalog', () => {
  it('keeps chat models and drops the endpoints a chat picker cannot call', () => {
    const models = parseCatalog('grq', {
      data: [
        { id: 'llama-3.3-70b-versatile', context_window: 131072 },
        { id: 'llama-3.1-8b-instant' },
        { id: 'whisper-large-v3' },
        { id: 'playai-tts' },
        { id: 'llama-guard-4-12b' },
        { id: 'retired-model', active: false },
      ],
    });
    expect(models.map((m) => m.id)).toEqual(['llama-3.1-8b-instant', 'llama-3.3-70b-versatile']);
    expect(models.find((m) => m.id === 'llama-3.3-70b-versatile')?.context).toBe(131072);
  });

  it('keeps only zero-cost text models on the marketplace, whatever the slug says', () => {
    const models = parseCatalog('opr', {
      data: [
        { id: 'vendor/free-chat:free', pricing: { prompt: '0', completion: '0' } },
        { id: 'vendor/paid-chat', pricing: { prompt: '0.000001', completion: '0.000002' } },
        // Priced at zero but emits pictures — not a chat engine.
        { id: 'vendor/free-image', pricing: { prompt: '0', completion: '0' }, architecture: { output_modalities: ['image'] } },
        // No price block at all: unknown cost is never assumed free.
        { id: 'vendor/unknown-price' },
      ],
    });
    expect(models.map((m) => m.id)).toEqual(['vendor/free-chat:free']);
    expect(models[0].label).toBe('free-chat');
  });

  it('returns an empty list for a malformed body instead of guessing', () => {
    expect(parseCatalog('grq', null)).toEqual([]);
    expect(parseCatalog('grq', { data: 'nope' })).toEqual([]);
  });
});

describe('fetchCatalog', () => {
  it('returns nothing when the key is not configured — and makes no call', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    return fetchCatalog({}, 'opr').then((models) => {
      expect(models).toEqual([]);
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  it('caches per isolate so a picker repaint does not re-hit the provider', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(new Response(JSON.stringify({ data: [{ id: 'llama-3.1-8b-instant' }] }), { status: 200 })),
    );
    vi.stubGlobal('fetch', fetchMock);
    const env = { VINAX_GROQ_API_KEY: 'k' };
    expect(await fetchCatalog(env, 'grq')).toHaveLength(1);
    expect(await fetchCatalog(env, 'grq')).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('reports an unreachable provider as an empty menu, never a stale invention', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('network'))));
    expect(await fetchCatalog({ VINAX_GROQ_API_KEY: 'k' }, 'grq')).toEqual([]);
  });
});

describe('resolveCatalogModel', () => {
  const env = { VINAX_OPENROUTER_API_KEY: 'k' };
  const stubList = (): void => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              data: [
                { id: 'vendor/free-chat:free', pricing: { prompt: '0', completion: '0' } },
                { id: 'vendor/paid-chat', pricing: { prompt: '1', completion: '1' } },
              ],
            }),
            { status: 200 },
          ),
        ),
      ),
    );
  };

  it('passes through a slug the provider currently lists as free', async () => {
    stubList();
    expect(await resolveCatalogModel(env, 'opr', 'vendor/free-chat:free')).toBe('vendor/free-chat:free');
  });

  it('refuses a paid, unknown or malformed slug so it can never reach the key', async () => {
    stubList();
    expect(await resolveCatalogModel(env, 'opr', 'vendor/paid-chat')).toBeNull();
    expect(await resolveCatalogModel(env, 'opr', 'vendor/made-up')).toBeNull();
    expect(await resolveCatalogModel(env, 'opr', 'not a slug!')).toBeNull();
    expect(await resolveCatalogModel(env, 'opr', '')).toBeNull();
    expect(await resolveCatalogModel(env, 'opr', null)).toBeNull();
  });
});
