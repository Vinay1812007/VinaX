/**
 * Music AI — song generation: input validation, the originality rules and
 * the refusal of a prompt that names a real artist or song, the per-device
 * daily quota, the owner's flag, polling a job to the finished song, and the
 * audio route's byte ranges. The generator, the storage and the database are
 * all stand-ins; no key is real.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { onRequestGet as status, onRequestPost as generate } from '../functions/api/ai/generate-song';
import { onRequestGet as poll } from '../functions/api/ai/generate-song/[id]';
import { onRequestGet as audio } from '../functions/api/ai/generate-song/[id]-audio';
import { buildGenerationRequest, checkPromptText, readProviderAnswer, sanitizeGenInput, ORIGINALITY_RULES, type KvLike } from '../functions/_lib/ai/songGen';
import { issueSession } from '../functions/_lib/googleAuth';
import { resetSettingsMemo } from '../functions/_lib/settings';
import { _resetRateLimitsForTests } from '../functions/_lib/ratelimit';
import { DB_ENV, fakeDb } from './helpers/fakeDb';

function memoryKv(): KvLike & { rows: Map<string, { value: string | ArrayBuffer; metadata?: unknown }>; getWithMetadata(key: string, type: 'arrayBuffer'): Promise<{ value: ArrayBuffer | null; metadata: unknown }> } {
  const rows = new Map<string, { value: string | ArrayBuffer; metadata?: unknown }>();
  const kv = {
    rows,
    async get(key: string, type: 'json' | 'arrayBuffer') {
      const row = rows.get(key);
      if (!row) return null;
      return type === 'json' ? JSON.parse(String(row.value)) : row.value;
    },
    async put(key: string, value: string | ArrayBuffer, opts?: { metadata?: unknown }) {
      rows.set(key, { value, metadata: opts?.metadata });
    },
    async getWithMetadata(key: string) {
      const row = rows.get(key);
      return { value: (row?.value as ArrayBuffer) ?? null, metadata: row?.metadata ?? null };
    },
  };
  return kv as never;
}

const GEN_URL = 'https://gen.test/v1/jobs';
const SONG = new Uint8Array(4_096).map((_, i) => i % 251);
let kv: ReturnType<typeof memoryKv>;
let env: Record<string, unknown>;
let providerBodies: Array<Record<string, unknown>>;
let providerStatus: Record<string, unknown>;
let ip = 0;

const BODY = { mood: 'chill', energy: 0.4, tempo: 92, genre: 'film', language: 'telugu', durationSec: 120, instrumental: false };

function setup(opts: { flag?: boolean; quota?: number; configured?: boolean } = {}): void {
  kv = memoryKv();
  providerBodies = [];
  providerStatus = { status: 'running', progress: 0.4 };
  env = {
    GOOGLE_CLIENT_ID: 'x.apps.googleusercontent.com', AUTH_SECRET: 'auth-secret', ...DB_ENV, HANDOFF: kv,
    ...(opts.configured === false ? {} : { MUSIC_GEN_API_URL: GEN_URL, MUSIC_GEN_API_KEY: 'gen-key' }),
  };
  fakeDb({ settings: [{ key: 'ai-music', value: { generate: { enabled: opts.flag !== false, dailyQuota: opts.quota ?? 5 } }, updated_at: 'x', updated_by: 'owner' }] }, async (url, init) => {
    if (url === GEN_URL && init?.method === 'POST') {
      expect((init.headers as Record<string, string>).authorization).toBe('Bearer gen-key');
      providerBodies.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify({ id: 'p-1', status: 'queued' }), { status: 200 });
    }
    if (url === `${GEN_URL}/p-1`) return new Response(JSON.stringify(providerStatus), { status: 200 });
    if (url === 'https://cdn.gen.test/p-1.mp3') return new Response(SONG, { status: 200, headers: { 'content-type': 'audio/mpeg' } });
    return new Response('not found', { status: 404 });
  });
}

async function req(path: string, init: RequestInit & { sub?: string | null; device?: string } = {}): Promise<Request> {
  const sub = init.sub === undefined ? '1001' : init.sub;
  const token = sub ? await issueSession(env as never, sub) : null;
  return new Request(`https://www.vinaxmusic.online${path}`, { ...init, headers: { 'content-type': 'application/json', 'cf-connecting-ip': `198.18.0.${++ip % 250}`, 'x-vinax-device': init.device ?? 'device-a', ...(token ? { authorization: `Bearer ${token}` } : {}), ...(init.headers as Record<string, string> | undefined) } });
}

const start = async (body: unknown = BODY, o: { sub?: string | null; device?: string } = {}) => generate({ request: await req('/api/ai/generate-song', { method: 'POST', body: JSON.stringify(body), ...o }), env: env as never });

beforeEach(() => {
  resetSettingsMemo();
  _resetRateLimitsForTests();
  setup();
});

describe('generation input', () => {
  it('takes the feel only, and keeps every value in range', () => {
    const r = sanitizeGenInput({ ...BODY, energy: 7, tempo: 900, genre: 'Film <b>', title: 'Secret Song', artist: 'Secret Singer' });
    expect(r.ok && r.input).toEqual({ mood: 'chill', energy: 1, tempo: 200, genre: 'film b', language: 'telugu', durationSec: 120, instrumental: false, promptText: null, kid: false });
    expect(sanitizeGenInput({ ...BODY, durationSec: 29 })).toEqual({ ok: false, error: 'bad_request' });
    expect(sanitizeGenInput({ ...BODY, durationSec: 181 })).toEqual({ ok: false, error: 'bad_request' });
  });

  it('Kid mode: instrumental only, gentle moods only', () => {
    const r = sanitizeGenInput({ ...BODY, kid: true, mood: 'melancholy', instrumental: false });
    expect(r.ok && r.input.instrumental).toBe(true);
    expect(r.ok && r.input.mood).toBe('neutral');
    expect(checkPromptText('happy party songs with drugs', true)).toEqual({ ok: false, error: 'prompt_not_allowed' });
  });

  it.each([
    ['in the style of Asha Rao', 'prompt_names_artist'],
    ['something that sounds like the Night Owls', 'prompt_names_artist'],
    ['a song like Ravi Varma', 'prompt_names_artist'],
    ['a cover of “Silver Monsoon”', 'prompt_names_artist'],
    ['feat. a famous rapper', 'prompt_names_artist'],
    ['see https://example.com/track', 'prompt_names_artist'],
    ['x'.repeat(201), 'prompt_too_long'],
  ])('refuses a prompt that names a real artist or song: %s', (text, error) => {
    expect(checkPromptText(text, false)).toEqual({ ok: false, error });
  });

  it('lets an everyday description through', () => {
    expect(checkPromptText('Late Night Drive with soft rain', false)).toEqual({ ok: true, text: 'Late Night Drive with soft rain' });
    expect(checkPromptText('warm flute and a slow beat', false)).toEqual({ ok: true, text: 'warm flute and a slow beat' });
  });

  it('builds the generator’s brief from the feel and the originality rules, with new lyrics in the language', () => {
    const r = sanitizeGenInput(BODY);
    if (!r.ok) throw new Error('bad input');
    const brief = buildGenerationRequest(r.input);
    expect(brief.prompt).toContain('original film song');
    expect(brief.prompt).toContain('telugu');
    expect(brief.prompt).toContain(ORIGINALITY_RULES);
    expect(brief.lyrics).toMatch(/brand-new lyrics in telugu/);
    const inst = buildGenerationRequest({ ...r.input, instrumental: true });
    expect(inst.lyrics).toBe('');
  });

  it('reads the usual provider answer shapes', () => {
    expect(readProviderAnswer({ id: 'x', status: 'queued' })).toMatchObject({ status: 'queued', providerId: 'x' });
    expect(readProviderAnswer({ data: { status: 'processing', progress: 40 } , id: 'y' })).toMatchObject({ status: 'running', progress: 0.4 });
    expect(readProviderAnswer({ status: 'succeeded', output: ['https://cdn.test/a.mp3'] })).toMatchObject({ status: 'done', audioUrl: 'https://cdn.test/a.mp3' });
    expect(readProviderAnswer({ status: 'failed' })).toMatchObject({ status: 'failed' });
    expect(readProviderAnswer({ nothing: true })).toBeNull();
  });
});

describe('POST /api/ai/generate-song', () => {
  it('starts a job from metadata only and answers with its id', async () => {
    const res = await start({ ...BODY, promptText: 'warm flute' });
    expect(res.status).toBe(202);
    const out = (await res.json()) as { jobId: string; status: string; remaining: number };
    expect(out.jobId).toMatch(/^[0-9a-f-]{36}$/);
    expect(out.remaining).toBe(4);
    const sent = JSON.stringify(providerBodies[0]);
    expect(Object.keys(providerBodies[0]).sort()).toEqual(['duration', 'instrumental', 'lyrics', 'prompt']);
    expect(sent).toContain('warm flute');
  });

  it('refuses a prompt naming a real artist before the generator sees it', async () => {
    const res = await start({ ...BODY, promptText: 'in the style of Asha Rao' });
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: 'prompt_names_artist' });
    expect(providerBodies).toHaveLength(0);
  });

  it('keeps to the daily quota per device', async () => {
    setup({ quota: 2 });
    expect((await start()).status).toBe(202);
    expect((await start()).status).toBe(202);
    const third = await start();
    expect(third.status).toBe(429);
    expect(await third.json()).toMatchObject({ error: 'quota_exceeded', limit: 2 });
    // Another device of the same account has its own quota.
    expect((await start(BODY, { device: 'device-b' })).status).toBe(202);
  });

  it('answers "not configured" without a generator, and "disabled" while the owner’s flag is off', async () => {
    setup({ configured: false });
    expect((await start()).status).toBe(503);
    const s = await status({ request: await req('/api/ai/generate-song'), env: env as never });
    expect(await s.json()).toMatchObject({ available: false, reason: 'gen_not_configured' });
    setup({ flag: false });
    resetSettingsMemo();
    const off = await start();
    expect(off.status).toBe(503);
    expect(await off.json()).toEqual({ error: 'ai_disabled' });
  });

  it('needs a session', async () => {
    expect((await start(BODY, { sub: null })).status).toBe(401);
  });
});

describe('a job, start to finish', () => {
  it('reports progress, then the stored song, which the audio route serves with ranges', async () => {
    const { jobId } = (await (await start()).json()) as { jobId: string };
    const check = async (sub = '1001') => poll({ request: await req(`/api/ai/generate-song/${jobId}`, { sub }), env: env as never, params: { id: jobId } });
    expect(await (await check()).json()).toMatchObject({ status: 'running', progress: 0.4 });
    // Another account cannot see it.
    expect((await check('2002')).status).toBe(404);

    providerStatus = { status: 'succeeded', audio_url: 'https://cdn.gen.test/p-1.mp3', title: 'Monsoon Lanterns' };
    const done = (await (await check()).json()) as { status: string; audioUrl: string; title: string };
    expect(done).toMatchObject({ status: 'done', title: 'Monsoon Lanterns', audioUrl: `/api/ai/generate-song/${jobId}/audio` });

    const full = await audio({ request: new Request(`https://www.vinaxmusic.online${done.audioUrl}`), env: env as never, params: { id: jobId } });
    expect(full.status).toBe(200);
    expect(full.headers.get('content-type')).toBe('audio/mpeg');
    expect((await full.arrayBuffer()).byteLength).toBe(SONG.length);
    const part = await audio({ request: new Request(`https://www.vinaxmusic.online${done.audioUrl}`, { headers: { range: 'bytes=100-199' } }), env: env as never, params: { id: jobId } });
    expect(part.status).toBe(206);
    expect(part.headers.get('content-range')).toBe(`bytes 100-199/${SONG.length}`);
    expect(new Uint8Array(await part.arrayBuffer())[0]).toBe(SONG[100]);
  });

  it('a malformed or unknown job id is not found', async () => {
    const res = await poll({ request: await req('/api/ai/generate-song/../../x'), env: env as never, params: { id: '../../x' } });
    expect(res.status).toBe(404);
    expect((await audio({ request: new Request('https://x/a'), env: env as never, params: { id: '00000000-0000-4000-8000-000000000000' } })).status).toBe(404);
  });
});
