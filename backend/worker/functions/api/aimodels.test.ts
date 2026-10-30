import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { HealthMap } from '../_lib/modelHealth';

const health = vi.hoisted(() => ({ map: null as unknown }));
vi.mock('../_lib/catalog', async (orig) => {
  const actual = await orig<typeof import('../_lib/catalog')>();
  const chat = (ids: string[]) => ids.map((id) => ({ id, name: id, maker: null, context: null, vision: false }));
  return {
    ...actual,
    fullCatalog: async () => ({ nvidia: chat(['n-good', 'n-gone']), openrouter: [], groq: chat(['g-good']), gemini: [], cloudflare: [] }),
    fullMedia: async () => ({
      nvidia: [{ id: 'flux', name: 'FLUX', maker: null, kind: 'image' }, { id: 'embed', name: 'Embed', maker: null, kind: 'embedding' }],
      openrouter: [],
      groq: [{ id: 'orpheus', name: 'Orpheus', maker: null, kind: 'speech', voices: ['autumn'] }],
      gemini: [],
      cloudflare: [],
    }),
  };
});
vi.mock('../_lib/modelHealth', async (orig) => {
  const actual = await orig<typeof import('../_lib/modelHealth')>();
  return { ...actual, readHealth: async () => health.map };
});

import { onRequestGet } from './aimodels';
import { healthKey } from '../_lib/modelHealth';

const get = async () => {
  const res = await onRequestGet({ request: new Request('https://www.vinaxmusic.online/api/aimodels', { headers: { 'cf-connecting-ip': `10.9.${Math.floor(Math.random() * 250)}.1` } }), env: {} as never });
  return (await res.json()) as { providers: Array<{ id: string; models: Array<{ id: string }>; media: Array<{ id: string; kind: string }> }>; features: { image: boolean; speech: boolean } };
};
const ids = (body: Awaited<ReturnType<typeof get>>, provider: string) => body.providers.find((p) => p.id === provider)!.models.map((m) => m.id);

beforeEach(() => {
  health.map = null;
});

describe('/api/aimodels — only models that answer (1.2.7)', () => {
  it('lists everything while there is no check record', async () => {
    const body = await get();
    expect(ids(body, 'nvidia')).toEqual(['n-good', 'n-gone']);
    expect(body.features.image).toBe(true);
  });

  it('drops the models whose last check failed, and turns off a feature with no working model', async () => {
    const now = Date.now();
    const pass = { ok: true, reason: null, at: now, fails: 0 };
    const fail = { ok: false, reason: 'gone' as const, at: now, fails: 1 };
    health.map = {
      v: 1, checkedAt: now, fullPassAt: now,
      models: {
        [healthKey('chat', 'nvidia', 'n-good')]: pass,
        [healthKey('chat', 'nvidia', 'n-gone')]: fail,
        [healthKey('chat', 'groq', 'g-good')]: pass,
        [healthKey('image', 'nvidia', 'flux')]: { ...fail, reason: 'down' as const },
        [healthKey('speech', 'groq', 'orpheus')]: pass,
      },
    } satisfies HealthMap;
    const body = await get();
    expect(ids(body, 'nvidia')).toEqual(['n-good']);
    expect(ids(body, 'groq')).toEqual(['g-good']);
    const nvidiaMedia = body.providers.find((p) => p.id === 'nvidia')!.media.map((m) => m.id);
    expect(nvidiaMedia).toEqual(['embed']);
    expect(body.features).toMatchObject({ image: false, speech: true });
  });
});
