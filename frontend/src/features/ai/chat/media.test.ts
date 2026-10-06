// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CODE_TOOL,
  NO_FEATURES,
  buildModelMenu,
  canRunCode,
  mediaGroups,
  parseCatalogResponse,
  parseFeatures,
} from './models';
import {
  createFailureLine,
  createMedia,
  createRequestBody,
  dataUrlToBlob,
  loadMediaPick,
  mediaAttribution,
  mediaFileName,
  readCreateResponse,
  resolveMediaPick,
  saveMediaPick,
  transcribe,
  transcribeRequestBody,
} from './media';
import { stripImagesForPersist } from './storage';
import type { Conversation } from './types';

/** GET /api/aimodels as the 10.3 server answers it, media and tools included. */
const BODY = {
  features: { image: true, speech: true, transcription: true, music: false, code: true },
  providers: [
    {
      id: 'nvidia',
      configured: true,
      models: [
        { id: 'lab/alpha-70b', name: 'Alpha 70B', maker: 'Lab One', context: 131072, vision: false },
        { id: 'lab/beta-8b', name: 'Beta 8B', maker: 'Lab One', context: 8192, vision: false },
      ],
      media: [
        { id: 'lab/pixel-1', name: 'Pixel One', maker: 'Lab One', kind: 'image' },
        { id: 'lab/embed-1', name: 'Embed One', maker: 'Lab One', kind: 'embedding' },
        { id: 'bad slug!', name: 'Broken', kind: 'image' },
        { id: 'lab/odd', name: 'Odd', kind: 'video' },
      ],
      tools: [
        { id: 'code_execution', name: 'Code execution', models: ['lab/alpha-70b'] },
        { id: 'web_search', name: 'Search', models: ['lab/alpha-70b'] },
      ],
    },
    {
      id: 'groq',
      configured: true,
      models: [{ id: 'small-8b', name: 'Small 8B', maker: null, context: 8192, vision: false }],
      media: [
        { id: 'voice-1', name: 'Voice One', maker: 'Maker', kind: 'speech', voices: ['autumn', 'troy', 'autumn', 7] },
        { id: 'ears-1', name: 'Ears One', maker: 'Maker', kind: 'transcription' },
        { id: 'pixel-2', name: 'Pixel Two', maker: null, kind: 'image' },
      ],
    },
    { id: 'gemini', configured: false, models: [], media: [{ id: 'g/pic', name: 'G Pic', kind: 'image' }] },
  ],
};

beforeEach(() => localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

describe('the catalogue: media, tools and features (10.3)', () => {
  const providers = parseCatalogResponse(BODY);

  it('keeps media rows it can trust, with voices de-duplicated', () => {
    expect(providers[0].media?.map((m) => `${m.kind}:${m.id}`)).toEqual(['image:lab/pixel-1', 'embedding:lab/embed-1']);
    expect(providers[2].media?.[0]).toMatchObject({ kind: 'speech', voices: ['autumn', 'troy'] });
  });

  it('keeps only the code tool — never a web tool', () => {
    expect(providers[0].tools).toEqual([{ id: CODE_TOOL, name: 'Code execution', models: ['lab/alpha-70b'] }]);
    expect(canRunCode(providers, 'nvidia', 'lab/alpha-70b')).toBe(true);
    expect(canRunCode(providers, 'nvidia', 'lab/beta-8b')).toBe(false);
  });

  it('reads features, and an older server without them as all off', () => {
    expect(parseFeatures(BODY)).toEqual({ image: true, speech: true, transcription: true, music: false, code: true });
    expect(parseFeatures({ providers: [] })).toEqual(NO_FEATURES);
    expect(parseFeatures(null)).toEqual(NO_FEATURES);
    // An older body: no media or tools on any provider, nothing crashes.
    const old = parseCatalogResponse({ providers: [{ id: 'nvidia', configured: true, models: [] }] });
    expect(old[0]).toMatchObject({ media: [], tools: [] });
  });

  it('groups a kind by provider, in menu order, skipping providers without a key', () => {
    expect(mediaGroups(providers, 'image').map((g) => [g.provider, g.models.map((m) => m.name)])).toEqual([
      ['nvidia', ['Pixel One']],
      ['groq', ['Pixel Two']],
    ]);
    expect(mediaGroups(providers, 'music')).toEqual([]);
  });

  it('tags chat models that can run code, and "runs code" finds them', () => {
    const rows = buildModelMenu({ providers, state: 'ready', query: '', recents: [] }).flatMap((s) => s.rows);
    expect(rows.filter((r) => r.code).map((r) => r.label)).toEqual(['Alpha 70B']);
    const found = buildModelMenu({ providers, state: 'ready', query: 'runs code', recents: [] }).flatMap((s) => s.rows);
    expect(found.map((r) => r.label)).toEqual(['Alpha 70B']);
  });
});

describe('create image / music — picks, bodies, responses', () => {
  const providers = parseCatalogResponse(BODY);

  it('starts on the first model available, or on the saved one while it is listed', () => {
    expect(resolveMediaPick(providers, 'image', null)).toEqual({ provider: 'nvidia', model: 'lab/pixel-1', name: 'Pixel One' });
    expect(resolveMediaPick(providers, 'image', { provider: 'groq', model: 'pixel-2' })).toEqual({ provider: 'groq', model: 'pixel-2', name: 'Pixel Two' });
    // A pick the server no longer lists falls back to the first one.
    expect(resolveMediaPick(providers, 'image', { provider: 'groq', model: 'gone' })?.model).toBe('lab/pixel-1');
    expect(resolveMediaPick(providers, 'music', null)).toBeNull();
  });

  it('stores a pick per kind and revives only valid ones', () => {
    saveMediaPick('music', { provider: 'gemini', model: 'g/tune', name: 'Tune' });
    expect(loadMediaPick('music')).toEqual({ provider: 'gemini', model: 'g/tune', name: 'Tune' });
    localStorage.setItem('vinax.aiImageModel', JSON.stringify({ provider: 'elsewhere', model: 'x' }));
    expect(loadMediaPick('image')).toBeNull();
    saveMediaPick('music', null);
    expect(localStorage.getItem('vinax.aiMusicModel')).toBeNull();
  });

  it('builds { prompt, provider, model } for /api/image and /api/music', () => {
    expect(createRequestBody('  a red kite  ', { provider: 'nvidia', model: 'lab/pixel-1' })).toEqual({ prompt: 'a red kite', provider: 'nvidia', model: 'lab/pixel-1' });
    expect(createRequestBody('a red kite', null)).toEqual({ prompt: 'a red kite' });
  });

  it('reads a picture and a clip, and refuses anything that is not one', () => {
    const img = readCreateResponse('image', { image: 'data:image/png;base64,AAAA', model: 'Pixel One', modelId: 'lab/pixel-1', provider: 'nvidia' }, 'kite', null);
    expect(img).toEqual({ kind: 'image', src: 'data:image/png;base64,AAAA', model: 'Pixel One', provider: 'nvidia', prompt: 'kite' });
    const clip = readCreateResponse('music', { audio: 'data:audio/wav;base64,UklG', mime: 'audio/wav', model: 'Tune', provider: 'gemini' }, 'sitar', null);
    expect(clip).toMatchObject({ kind: 'music', mime: 'audio/wav', model: 'Tune', provider: 'gemini' });
    expect(readCreateResponse('image', { image: 'https://example.invalid/x.png' }, 'kite', null)).toBeNull();
    expect(readCreateResponse('music', { audio: 'data:image/png;base64,AAAA' }, 'kite', null)).toBeNull();
    expect(readCreateResponse('image', null, 'kite', null)).toBeNull();
  });

  it('names who made it and offers a sensible file name', () => {
    expect(mediaAttribution({ model: 'Pixel One', provider: 'nvidia' })).toBe('Pixel One · NVIDIA');
    expect(mediaFileName({ kind: 'image', src: 'data:image/jpeg;base64,AA', prompt: 'A red kite!' })).toBe('vinax-a-red-kite.jpg');
    expect(mediaFileName({ kind: 'music', src: 'data:audio/wav;base64,AA', mime: 'audio/wav', prompt: '' })).toBe('vinax-clip.wav');
  });

  it('says plainly why a create failed', () => {
    expect(createFailureLine('image', 503, 'ai_disabled')).toMatch(/switched off/);
    expect(createFailureLine('image', 503, 'ai_over_budget')).toMatch(/today’s limit/);
    expect(createFailureLine('music', 400, 'unknown_model')).toMatch(/pick another one/);
    expect(createFailureLine('music', 429, null)).toMatch(/Too many requests/);
    expect(createFailureLine('image', 503, null)).toMatch(/image model didn’t answer/);
  });

  it('posts the body and returns the media, or a line — never throws', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ image: 'data:image/png;base64,AAAA', model: 'Pixel One', provider: 'nvidia' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const ok = await createMedia('image', 'kite', { provider: 'nvidia', model: 'lab/pixel-1' });
    expect(ok.ok && ok.media.model).toBe('Pixel One');
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(/\/api\/image$/);
    expect(JSON.parse(init.body as string)).toEqual({ prompt: 'kite', provider: 'nvidia', model: 'lab/pixel-1' });

    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'ai_over_budget' }), { status: 503 })));
    const no = await createMedia('music', 'sitar', null);
    expect(no).toEqual({ ok: false, line: createFailureLine('music', 503, 'ai_over_budget') });

    const musicFetch = vi.fn(async () => new Response(JSON.stringify({ audio: 'data:audio/wav;base64,UklG', mime: 'audio/wav', model: 'Tune' }), { status: 200 }));
    vi.stubGlobal('fetch', musicFetch);
    await createMedia('music', 'sitar', { provider: 'gemini', model: 'g/tune' });
    expect((musicFetch.mock.calls[0] as unknown as [string])[0]).toMatch(/\/api\/music$/);

    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new Error('offline'))));
    expect((await createMedia('image', 'kite', null)).ok).toBe(false);
  });

  it('turns a data URL into a playable blob (the policy allows blob: audio only)', async () => {
    const b = dataUrlToBlob('data:audio/wav;base64,UklGRg==');
    expect(b?.type).toBe('audio/wav');
    expect(b?.size).toBe(4);
    expect(dataUrlToBlob('not a data url')).toBeNull();
  });
});

describe('media is never kept on the device', () => {
  it('empties a created picture or clip before saving, keeping who made it', () => {
    const chats: Conversation[] = [
      {
        id: 'c',
        title: 't',
        updatedAt: 1,
        messages: [{ role: 'assistant', content: 'Made a picture for: kite', media: { kind: 'image', src: 'data:image/png;base64,AAAA', model: 'Pixel One', provider: 'nvidia', prompt: 'kite' } }],
      },
    ];
    const out = stripImagesForPersist(chats);
    expect(out[0].messages[0].media).toEqual({ kind: 'image', src: '', model: 'Pixel One', provider: 'nvidia', prompt: 'kite' });
    // The live chat is untouched.
    expect(chats[0].messages[0].media?.src).toMatch(/^data:/);
  });
});

describe('transcribe (server dictation)', () => {
  it('builds { audio, mime, provider, model, language? }', () => {
    expect(transcribeRequestBody('data:audio/webm;base64,AA', 'audio/webm', { provider: 'groq', model: 'ears-1' })).toEqual({
      audio: 'data:audio/webm;base64,AA',
      mime: 'audio/webm',
      provider: 'groq',
      model: 'ears-1',
    });
    expect(transcribeRequestBody('x', 'audio/webm', { provider: 'groq', model: 'ears-1' }, 'te')).toMatchObject({ language: 'te' });
  });

  it('posts the recording and returns the text; any failure is null', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ text: ' hello there ', model: 'Ears One', provider: 'groq' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const blob = new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/webm;codecs=opus' });
    expect(await transcribe(blob, { provider: 'groq', model: 'ears-1' })).toBe('hello there');
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(/\/api\/transcribe$/);
    const sent = JSON.parse(init.body as string) as Record<string, string>;
    expect(sent).toMatchObject({ mime: 'audio/webm', provider: 'groq', model: 'ears-1' });
    expect(sent.audio).toMatch(/^data:audio\/webm/);

    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'unknown_model' }), { status: 400 })));
    expect(await transcribe(blob, { provider: 'groq', model: 'ears-1' })).toBeNull();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ text: '' }), { status: 200 })));
    expect(await transcribe(blob, { provider: 'groq', model: 'ears-1' })).toBeNull();
    expect(await transcribe(new Blob([]), { provider: 'groq', model: 'ears-1' })).toBeNull();
  });
});
