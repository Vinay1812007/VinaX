/**
 * VinaX AI — Create image: the owner's switch and caps, prompt checks, the
 * FLUX call on the AI binding (mocked), the picture in the private bucket,
 * and the turn saved in the conversation so it shows after a reload.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { onRequestPost as createImage } from '../functions/api/ai/images';
import { onRequestGet as getModels } from '../functions/api/ai/models';
import { onRequestGet as getConversation } from '../functions/api/ai/conversations/[id]';
import {
  checkPrompt, fromBase64, IMAGE_MODEL, IMAGE_MODEL_ID, imageFileName, imageMime, IMAGES_PER_DAY_TOTAL, NEURON_POOL, NEURONS_PER_IMAGE, promptRefused, sanitizeImages,
} from '../functions/_lib/ai/images';
import { sanitizeAiSettings } from '../functions/_lib/ai/config';
import { toBase64 } from '../functions/_lib/ai/attachments';
import { _resetCooldowns } from '../functions/_lib/ai/cooldown';
import { issueSession } from '../functions/_lib/googleAuth';
import { resetSettingsMemo } from '../functions/_lib/settings';
import { _resetRateLimitsForTests } from '../functions/_lib/ratelimit';
import { DB_ENV, fakeDb, type FakeDb } from './helpers/fakeDb';
import { fakeStorage, type FakeStorage } from './helpers/fakeStorage';

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 2, 3]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const CONV = '11111111-1111-4111-8111-111111111111';
const LEAF = '22222222-2222-4222-8222-222222222222';
let ip = 0;
let storage: FakeStorage;
type Run = (model: string, input: Record<string, unknown>) => Promise<unknown>;
let run: ReturnType<typeof vi.fn<Run>>;

const baseEnv = () => ({ GOOGLE_CLIENT_ID: 'x.apps.googleusercontent.com', AUTH_SECRET: 'auth-secret', GROQ_API_KEY: 'gsk', ...DB_ENV, AI: { run } });
let ENV = baseEnv();

function seed(images: unknown = { enabled: true }, extra: Record<string, Array<Record<string, unknown>>> = {}, take: (kind: string) => boolean = () => true): FakeDb {
  storage = fakeStorage();
  const fake = fakeDb({
    accounts: [{ id: '1001', name: 'Asha' }],
    settings: [{ key: 'vinax-ai', value: { enabled: true, images }, updated_at: 'x', updated_by: 'owner' }],
    ai_conversations: [],
    ai_messages: [],
    ai_attachments: [],
    ...extra,
  }, (url, init) => storage.handle(url, init) ?? new Response('{}', { status: 500 }));
  fake.answer('rpc/ai_take_daily', (call) => new Response(String(take((call.body as { p_kind: string }).p_kind)), { status: 200, headers: { 'content-type': 'application/json' } }));
  return fake;
}

async function post(body: unknown, sub: string | null = '1001'): Promise<Response> {
  const token = sub ? await issueSession(ENV, sub) : null;
  const request = new Request('https://www.vinaxmusic.online/api/ai/images', {
    method: 'POST', body: JSON.stringify(body),
    headers: { 'content-type': 'application/json', 'cf-connecting-ip': `198.51.100.${++ip % 250}`, ...(token ? { authorization: `Bearer ${token}` } : {}) },
  });
  return createImage({ request, env: ENV });
}

beforeEach(() => {
  resetSettingsMemo();
  _resetRateLimitsForTests();
  _resetCooldowns();
  run = vi.fn<Run>(async () => ({ image: toBase64(JPEG) }));
  ENV = baseEnv();
});
afterEach(() => vi.unstubAllGlobals());

describe('the pieces', () => {
  it('the owner switch is off unless enabled; the cap is clamped', () => {
    expect(sanitizeImages(undefined)).toEqual({ enabled: false, perDay: 10 });
    expect(sanitizeImages(true)).toEqual({ enabled: true, perDay: 10 });
    expect(sanitizeImages({ enabled: 'yes', perDay: 3 })).toEqual({ enabled: false, perDay: 3 });
    expect(sanitizeImages({ enabled: true, perDay: 999 })).toEqual({ enabled: true, perDay: 50 });
    expect(sanitizeImages({ enabled: true, perDay: 0 })).toEqual({ enabled: true, perDay: 1 });
    expect(sanitizeImages({ enabled: true, perDay: 'x' }).perDay).toBe(10);
    expect(sanitizeAiSettings({ enabled: true }).images).toEqual({ enabled: false, perDay: 10 });
  });

  it('counts neurons high and keeps everyone together well inside the free pool', () => {
    // 4 tiles × 4.8 + 4 steps × 9.6 = 57.6 for a 1024×1024 picture.
    expect(NEURONS_PER_IMAGE).toBeGreaterThanOrEqual(58);
    expect(IMAGES_PER_DAY_TOTAL * NEURONS_PER_IMAGE).toBeLessThanOrEqual(NEURON_POOL / 3);
  });

  it('refuses empty, over-long and unsafe prompts; tidies the rest', () => {
    expect(checkPrompt('   ')).toEqual({ ok: false, error: 'empty_prompt' });
    expect(checkPrompt(undefined)).toEqual({ ok: false, error: 'empty_prompt' });
    expect(checkPrompt(42)).toEqual({ ok: false, error: 'bad_request' });
    expect(checkPrompt('a'.repeat(1_001))).toEqual({ ok: false, error: 'prompt_too_long' });
    expect(checkPrompt('a nude portrait')).toEqual({ ok: false, error: 'prompt_refused' });
    expect(checkPrompt('  a red\u0007 fox\n\nin snow ')).toEqual({ ok: true, prompt: 'a red fox in snow' });
    expect(promptRefused('a child in a gory scene')).toBe(true);
    expect(promptRefused('a child flying a kite')).toBe(false);
  });

  it('recognises pictures by their bytes and names them from the prompt', () => {
    expect(imageMime(JPEG)).toBe('image/jpeg');
    expect(imageMime(PNG)).toBe('image/png');
    expect(imageMime(new Uint8Array([1, 2, 3]))).toBeNull();
    expect([...fromBase64(toBase64(PNG))!]).toEqual([...PNG]);
    expect(fromBase64('not base64!')).toBeNull();
    expect(imageFileName('A red fox, in the snow at dawn today', 'image/jpeg')).toBe('a-red-fox-in-the-snow.jpg');
    expect(imageFileName('☀️', 'image/png')).toBe('vinax-image.png');
  });
});

describe('POST /api/ai/images', () => {
  it('makes a picture in a new chat: stored privately and saved as a turn', async () => {
    const fake = seed();
    const res = await post({ prompt: 'a red fox in snow', conversationId: null });
    expect(res.status).toBe(200);
    expect(run).toHaveBeenCalledWith(IMAGE_MODEL, { prompt: 'a red fox in snow', steps: 4 });
    const body = (await res.json()) as { conversation: { id: string; activeLeafId: string; title: string }; userMessage: { id: string; content: unknown[] }; assistantMessage: { id: string; parentId: string; content: Array<Record<string, unknown>>; model: { id: string; name: string } } };
    expect(body.conversation.title).toBe('a red fox in snow');
    expect(body.userMessage.content).toEqual([{ type: 'text', text: 'Create an image: a red fox in snow' }]);
    expect(body.assistantMessage.parentId).toBe(body.userMessage.id);
    expect(body.assistantMessage.model).toMatchObject({ id: IMAGE_MODEL_ID, name: 'FLUX.1 schnell' });
    const part = body.assistantMessage.content.find((p) => p.type === 'attachment')!;
    expect(part).toMatchObject({ kind: 'image', mime: 'image/jpeg', name: 'a-red-fox-in-snow.jpg', size: JPEG.length });

    const file = fake.rows('ai_attachments')[0];
    expect(file).toMatchObject({ id: part.id, account_id: '1001', conversation_id: body.conversation.id, kind: 'image', storage_path: `1001/${body.conversation.id}/${part.id}` });
    expect([...storage.objects.get(file.storage_path as string)!.bytes]).toEqual([...JPEG]);
    expect(fake.rows('ai_messages').map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(fake.rows('ai_conversations')[0]).toMatchObject({ id: body.conversation.id, active_leaf_id: body.assistantMessage.id });
    // Both caps were taken before the model ran.
    expect(fake.calls.filter((c) => c.table === 'rpc/ai_take_daily').map((c) => c.body)).toEqual([
      { p_kind: 'img:1001', p_limit: 10 }, { p_kind: 'images', p_limit: IMAGES_PER_DAY_TOTAL },
    ]);

    // After a reload the picture is still there, named the same way.
    const token = await issueSession(ENV, '1001');
    const got = await getConversation({ request: new Request(`https://www.vinaxmusic.online/api/ai/conversations/${body.conversation.id}`, { headers: { authorization: `Bearer ${token}`, 'cf-connecting-ip': '203.0.113.9' } }), env: ENV, params: { id: body.conversation.id } });
    const loaded = (await got.json()) as { messages: Array<{ role: string; content: Array<Record<string, unknown>>; model: { name: string } | null }> };
    const reply = loaded.messages.find((m) => m.role === 'assistant')!;
    expect(reply.content.some((p) => p.type === 'attachment' && p.kind === 'image')).toBe(true);
    expect(reply.model?.name).toBe('FLUX.1 schnell');
  });

  it('adds the turn after the active leaf of an existing chat', async () => {
    const fake = seed({ enabled: true }, {
      ai_conversations: [{ id: CONV, account_id: '1001', title: 'Old', active_leaf_id: LEAF, deleted_at: null }],
      ai_messages: [{ id: LEAF, conversation_id: CONV, parent_id: null, role: 'user', content: [{ type: 'text', text: 'hi' }], created_at: '2026-11-01T00:00:00Z' }],
    });
    const res = await post({ prompt: 'a moon', conversationId: CONV });
    expect(res.status).toBe(200);
    const user = fake.rows('ai_messages').find((m) => m.id !== LEAF && m.role === 'user')!;
    expect(user.parent_id).toBe(LEAF);
    expect(fake.rows('ai_conversations')).toHaveLength(1);
  });

  it('is off until the owner switches it on, and signed-in only', async () => {
    seed(false);
    expect((await post({ prompt: 'a moon' })).status).toBe(503);
    expect(run).not.toHaveBeenCalled();
    seed();
    expect((await post({ prompt: 'a moon' }, null)).status).toBe(401);
  });

  it('refuses bad prompts before any cap is taken', async () => {
    const fake = seed();
    const empty = await post({ prompt: ' ' });
    expect(empty.status).toBe(400);
    expect(await empty.json()).toEqual({ error: 'empty_prompt' });
    expect((await post({ prompt: 'x'.repeat(1_001) })).status).toBe(413);
    expect((await post({ prompt: 'nsfw art' })).status).toBe(400);
    expect(fake.calls.some((c) => c.table === 'rpc/ai_take_daily')).toBe(false);
    expect(run).not.toHaveBeenCalled();
  });

  it('holds each person to the owner\'s daily cap', async () => {
    const fake = seed({ enabled: true, perDay: 3 }, {}, (kind) => kind !== 'img:1001');
    const res = await post({ prompt: 'a moon' });
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: 'image_daily_limit', limit: 3 });
    expect(run).not.toHaveBeenCalled();
    expect(fake.rows('ai_conversations')).toHaveLength(0);
  });

  it('says try tomorrow when everyone\'s cap or the free pool is spent', async () => {
    seed({ enabled: true }, {}, (kind) => kind !== 'images');
    expect(await (await post({ prompt: 'a moon' })).json()).toEqual({ error: 'images_busy' });
    expect(run).not.toHaveBeenCalled();

    const fake = seed();
    run.mockRejectedValueOnce(new Error('AiError: 4006: you have used up your daily free allocation of 10,000 neurons'));
    const res = await post({ prompt: 'a moon' });
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: 'images_busy' });
    // Nothing is saved for a picture that was never made.
    expect(fake.rows('ai_conversations')).toHaveLength(0);
    expect(storage.objects.size).toBe(0);
  });

  it('refuses an answer that is not a picture', async () => {
    seed();
    run.mockResolvedValueOnce({ image: toBase64(new Uint8Array([1, 2, 3, 4])) });
    expect((await post({ prompt: 'a moon' })).status).toBe(502);
    run.mockResolvedValueOnce({});
    expect((await post({ prompt: 'a moon' })).status).toBe(502);
  });

  it('cannot reach someone else\'s chat', async () => {
    seed({ enabled: true }, { ai_conversations: [{ id: CONV, account_id: '2002', deleted_at: null }] });
    expect((await post({ prompt: 'a moon', conversationId: CONV })).status).toBe(404);
    expect(run).not.toHaveBeenCalled();
  });
});

describe('GET /api/ai/models', () => {
  it('tells the page whether Create image is on, and its cap', async () => {
    seed({ enabled: true, perDay: 4 });
    const res = await getModels({ request: new Request('https://www.vinaxmusic.online/api/ai/models', { headers: { 'cf-connecting-ip': '203.0.113.7' } }), env: ENV });
    expect(((await res.json()) as { images: unknown }).images).toEqual({ enabled: true, perDay: 4, maxPrompt: 1_000 });
    resetSettingsMemo();
    seed({ enabled: true });
    ENV = { ...baseEnv(), AI: undefined as never };
    const off = await getModels({ request: new Request('https://www.vinaxmusic.online/api/ai/models', { headers: { 'cf-connecting-ip': '203.0.113.8' } }), env: ENV });
    expect(((await off.json()) as { images: { enabled: boolean } }).images.enabled).toBe(false);
  });
});
