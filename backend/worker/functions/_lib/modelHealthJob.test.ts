import { beforeEach, describe, expect, it, vi } from 'vitest';

const catalog = vi.hoisted(() => ({
  chat: { nvidia: [{ id: 'n-good' }, { id: 'n-gone' }], openrouter: [], groq: [{ id: 'g-good' }], gemini: [], cloudflare: [] } as Record<string, Array<{ id: string }>>,
  media: {
    nvidia: [{ id: 'flux', kind: 'image' }, { id: 'embed', kind: 'embedding' }],
    openrouter: [],
    groq: [{ id: 'orpheus', kind: 'speech' }, { id: 'whisper', kind: 'transcription' }],
    gemini: [],
    cloudflare: [],
  } as Record<string, Array<{ id: string; kind: string }>>,
}));
const saved = vi.hoisted(() => ({ maps: [] as unknown[], stored: null as unknown }));

vi.mock('./catalog', () => ({
  fullCatalog: async () => catalog.chat,
  fullMedia: async () => catalog.media,
}));
vi.mock('./media', () => ({
  generateImage: async () => ({ ok: false, status: 0, reason: 'engine_unreachable', body: '' }),
  speak: async () => ({ ok: true, value: { body: new Uint8Array(5000), type: 'audio/wav' } }),
  transcribe: async (_e: unknown, _p: unknown, _m: unknown, audio: Uint8Array) => ({ ok: true, value: audio.length ? 'VinaX plays your favourite songs.' : '' }),
}));
vi.mock('./modelHealth', async (orig) => {
  const actual = await orig<typeof import('./modelHealth')>();
  return {
    ...actual,
    readHealth: async () => saved.stored,
    writeHealth: async (_env: unknown, map: unknown) => {
      saved.maps.push(JSON.parse(JSON.stringify(map)));
      saved.stored = map;
      return true;
    },
  };
});

import { answerText, dueTargets, pacing, RECHECK_MS, recheckAfter, runModelHealth, type Target } from './modelHealthJob';
import { healthKey, type HealthMap } from './modelHealth';

const env = { NVIDIA_API_KEY: 'n', GROQ_API_KEY: 'g', SUPABASE_URL: 'https://db.example', SUPABASE_SERVICE_ROLE_KEY: 'k' };

beforeEach(() => {
  pacing.gapMs = 0;
  saved.maps = [];
  saved.stored = null;
  vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
    const model = JSON.parse(String(init.body)).model as string;
    if (model.endsWith('gone')) return new Response('{"error":"not found"}', { status: 404 });
    return new Response(JSON.stringify({ choices: [{ message: { content: 'OK' } }] }), { status: 200 });
  });
});

describe('answerText', () => {
  it('takes the reply, or a reasoning model’s thinking, and nothing else', () => {
    expect(answerText('{"choices":[{"message":{"content":"OK"}}]}')).toBe('OK');
    expect(answerText('{"choices":[{"message":{"content":"","reasoning_content":"The user wants"}}]}')).toBe('The user wants');
    expect(answerText('{"choices":[{"message":{"content":"  "}}]}')).toBe('');
    expect(answerText('<html>')).toBe('');
  });
});

describe('dueTargets', () => {
  const t = (kind: Target['kind'], id: string): Target => ({ kind, provider: 'nvidia', id });
  it('checks new models first, then the longest unchecked, skipping fresh ones, one image per run', () => {
    const now = 10 * 24 * 3_600_000;
    const map: HealthMap = {
      v: 1, checkedAt: now, fullPassAt: null,
      models: {
        [healthKey('chat', 'nvidia', 'fresh')]: { ok: true, reason: null, at: now - 60_000, fails: 0 },
        [healthKey('chat', 'nvidia', 'old')]: { ok: true, reason: null, at: now - RECHECK_MS.chat - 1, fails: 0 },
      },
    };
    const due = dueTargets([t('chat', 'fresh'), t('chat', 'old'), t('chat', 'new'), t('image', 'i1'), t('image', 'i2')], map, now);
    expect(due.map((x) => x.id)).toEqual(['new', 'i1', 'old']);
    expect(dueTargets([t('chat', 'a'), t('chat', 'b'), t('chat', 'c')], null, now, 2)).toHaveLength(2);
  });
});

describe('recheckAfter', () => {
  const e = (ok: boolean, reason: string | null) => ({ ok, reason, at: 0, fails: ok ? 0 : 1 }) as never;
  it('asks dead models once a day, OpenRouter twice a day, the rest on the usual beat', () => {
    expect(recheckAfter({ kind: 'chat', provider: 'nvidia', id: 'x' }, e(false, 'gone'))).toBe(24 * 3_600_000);
    expect(recheckAfter({ kind: 'chat', provider: 'nvidia', id: 'x' }, e(false, 'down'))).toBe(RECHECK_MS.chat);
    expect(recheckAfter({ kind: 'chat', provider: 'openrouter', id: 'x' }, e(true, null))).toBe(12 * 3_600_000);
    expect(recheckAfter({ kind: 'chat', provider: 'groq', id: 'x' }, undefined)).toBe(RECHECK_MS.chat);
    expect(recheckAfter({ kind: 'image', provider: 'nvidia', id: 'x' }, e(false, 'not_free'))).toBe(24 * 3_600_000);
  });
});

describe('runModelHealth', () => {
  it('checks every listed model and stores who answered', async () => {
    const summary = await runModelHealth(env as never, Date.now());
    const map = saved.stored as HealthMap;
    const ok = (k: string) => map.models[k]?.ok;
    expect(ok(healthKey('chat', 'nvidia', 'n-good'))).toBe(true);
    expect(map.models[healthKey('chat', 'nvidia', 'n-gone')]).toMatchObject({ ok: false, reason: 'gone' });
    expect(ok(healthKey('chat', 'groq', 'g-good'))).toBe(true);
    expect(ok(healthKey('speech', 'groq', 'orpheus'))).toBe(true);
    // The voice's audio is what the transcription check heard.
    expect(ok(healthKey('transcription', 'groq', 'whisper'))).toBe(true);
    expect(map.models[healthKey('image', 'nvidia', 'flux')]).toMatchObject({ ok: false, reason: 'down' });
    // Embeddings are not on the page and are not checked.
    expect(map.models[healthKey('embedding' as never, 'nvidia', 'embed')]).toBeUndefined();
    expect(map.fullPassAt).not.toBeNull();
    expect(summary).toMatchObject({ checked: 6, listed: 6, usable: 4, fullPass: true });
  });

  it('forgets models that are no longer listed', async () => {
    saved.stored = { v: 1, checkedAt: Date.now(), fullPassAt: Date.now(), models: { [healthKey('chat', 'groq', 'retired')]: { ok: true, reason: null, at: Date.now(), fails: 0 } } };
    await runModelHealth(env as never, Date.now());
    expect((saved.stored as HealthMap).models[healthKey('chat', 'groq', 'retired')]).toBeUndefined();
  });
});
