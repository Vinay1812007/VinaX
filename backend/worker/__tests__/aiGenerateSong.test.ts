/**
 * Music AI — song generation: input validation, the originality rules and
 * the refusal of a prompt that names a real artist or song, the per-device
 * daily quota, the owner's flag, polling a job to the finished song, and the
 * audio route's byte ranges. The music API, the storage and the database are
 * all stand-ins; no key is real.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { onRequestGet as status, onRequestPost as generate } from '../functions/api/ai/generate-song';
import { onRequestGet as poll } from '../functions/api/ai/generate-song/[id]';
import { onRequestGet as audio } from '../functions/api/ai/generate-song/[id]-audio';
import { buildGenerationRequest, checkPromptText, estimatedProgress, GEN_MODELS, readInteraction, sanitizeGenInput, ORIGINALITY_RULES, type KvLike } from '../functions/_lib/ai/songGen';
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

const MUSIC_URL = 'https://generativelanguage.googleapis.com/v1beta/interactions';
const SONG = new Uint8Array(4_096).map((_, i) => i % 251);
const SONG_B64 = Buffer.from(SONG).toString('base64');
let kv: ReturnType<typeof memoryKv>;
let env: Record<string, unknown>;
let providerBodies: Array<Record<string, unknown>>;
let providerStatus: Record<string, unknown>;
/** Per model: what starting a job answers (status, body). */
let startAnswer: (body: Record<string, unknown>) => [number, unknown];
let ip = 0;

const BODY = { mood: 'chill', energy: 0.4, tempo: 92, genre: 'film', language: 'telugu', durationSec: 120, instrumental: false };

const finished = (extra: Record<string, unknown> = {}) => ({
  id: 'i-1',
  status: 'completed',
  steps: [{ type: 'model_output', content: [{ type: 'text', text: JSON.stringify({ title: 'Monsoon Lanterns', sections: ['Verse', 'Chorus'] }) }, { type: 'audio', mime_type: 'audio/mp3', data: SONG_B64 }] }],
  ...extra,
});

function setup(opts: { flag?: boolean; quota?: number; configured?: boolean } = {}): void {
  kv = memoryKv();
  providerBodies = [];
  providerStatus = { id: 'i-1', status: 'in_progress' };
  startAnswer = () => [200, { id: 'i-1', status: 'in_progress' }];
  env = {
    GOOGLE_CLIENT_ID: 'x.apps.googleusercontent.com', AUTH_SECRET: 'auth-secret', ...DB_ENV, HANDOFF: kv,
    ...(opts.configured === false ? {} : { GEMINI_API_KEY: 'music-key' }),
  };
  fakeDb({ settings: [{ key: 'ai-music', value: { generate: { enabled: opts.flag !== false, dailyQuota: opts.quota ?? 5 } }, updated_at: 'x', updated_by: 'owner' }] }, async (url, init) => {
    if (url === MUSIC_URL && init?.method === 'POST') {
      expect((init.headers as Record<string, string>)['x-goog-api-key']).toBe('music-key');
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      providerBodies.push(body);
      const [status, answer] = startAnswer(body);
      return new Response(JSON.stringify(answer), { status });
    }
    if (url === `${MUSIC_URL}/i-1`) return new Response(JSON.stringify(providerStatus), { status: 200 });
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

  it('builds the music model’s brief from the feel and the originality rules, with new lyrics in the language', () => {
    const r = sanitizeGenInput(BODY);
    if (!r.ok) throw new Error('bad input');
    const brief = buildGenerationRequest(r.input);
    expect(brief.model).toBe(GEN_MODELS.full);
    expect(brief.prompt).toContain('original 2-minute film song');
    expect(brief.prompt).toContain('sung in telugu');
    expect(brief.prompt).toMatch(/brand-new lyrics in telugu/);
    expect(brief.prompt).toContain(ORIGINALITY_RULES);
    const inst = buildGenerationRequest({ ...r.input, instrumental: true, durationSec: 30 });
    expect(inst.model).toBe(GEN_MODELS.clip);
    expect(inst.prompt).toContain('Instrumental only, no vocals.');
    expect(inst.prompt).not.toMatch(/lyrics in/);
  });

  it('reads a music interaction in every state', () => {
    expect(readInteraction({ id: 'x', status: 'in_progress' })).toMatchObject({ status: 'running', providerId: 'x', progress: 0 });
    const done = readInteraction(finished());
    expect(done).toMatchObject({ status: 'done', progress: 1, audioBase64: SONG_B64, mime: 'audio/mp3', title: 'Monsoon Lanterns' });
    // Finished with no audio: the model refused the prompt.
    expect(readInteraction({ id: 'x', status: 'completed', steps: [{ type: 'model_output', content: [{ type: 'text', text: 'no' }] }] })).toMatchObject({ status: 'failed' });
    expect(readInteraction({ id: 'x', status: 'failed' })).toMatchObject({ status: 'failed' });
    expect(readInteraction({ id: 'x', status: 'cancelled' })).toMatchObject({ status: 'failed' });
    expect(readInteraction({ status: 'completed', steps: [{ type: 'model_output', content: [{ type: 'audio', uri: 'https://files.test/a.mp3' }] }] })).toMatchObject({ status: 'done', audioUrl: 'https://files.test/a.mp3' });
    expect(readInteraction({ nothing: true })).toBeNull();
  });

  it('estimates progress from a job’s age, never past 90%', () => {
    expect(estimatedProgress(0, 120, 0)).toBe(0.05);
    expect(estimatedProgress(0, 120, 30_000)).toBe(0.5);
    expect(estimatedProgress(0, 30, 600_000)).toBe(0.9);
  });
});

describe('POST /api/ai/generate-song', () => {
  it('starts a job from metadata only and answers with its id', async () => {
    const res = await start({ ...BODY, promptText: 'warm flute' });
    expect(res.status).toBe(202);
    const out = (await res.json()) as { jobId: string; status: string; remaining: number };
    expect(out.jobId).toMatch(/^[0-9a-f-]{36}$/);
    expect(out.remaining).toBe(4);
    expect(Object.keys(providerBodies[0]).sort()).toEqual(['background', 'input', 'model']);
    expect(providerBodies[0]).toMatchObject({ model: GEN_MODELS.full, background: true });
    expect(String(providerBodies[0].input)).toContain('warm flute');
  });

  it('falls back to a 30-second clip when the full-song model refuses', async () => {
    startAnswer = (b) => (b.model === GEN_MODELS.full ? [403, { error: { code: 403 } }] : [200, { id: 'i-1', status: 'in_progress' }]);
    const { jobId } = (await (await start()).json()) as { jobId: string };
    expect(providerBodies.map((b) => b.model)).toEqual([GEN_MODELS.full, GEN_MODELS.clip]);
    const job = await poll({ request: await req(`/api/ai/generate-song/${jobId}`), env: env as never, params: { id: jobId } });
    expect(await job.json()).toMatchObject({ status: 'running', durationSec: 30 });
  });

  it('waits for the song in one call where background jobs are not offered, and keeps nothing at the model', async () => {
    startAnswer = (b) => (b.background ? [400, { error: { code: 400 } }] : [200, finished({ id: undefined })]);
    const res = await start();
    expect(res.status).toBe(202);
    expect(await res.json()).toMatchObject({ status: 'done', progress: 1 });
    expect(providerBodies[1]).toMatchObject({ store: false });
    expect(providerBodies[1].background).toBeUndefined();
  });

  it('answers gen_failed when no model can make the song', async () => {
    startAnswer = () => [429, { error: { code: 429 } }];
    expect((await start()).status).toBe(502);
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

  it('answers "not configured" without the VinaX AI key, and "disabled" while the owner’s flag is off', async () => {
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
    const running = (await (await check()).json()) as { status: string; progress: number };
    expect(running.status).toBe('running');
    expect(running.progress).toBeGreaterThan(0);
    expect(running.progress).toBeLessThan(1);
    // Another account cannot see it.
    expect((await check('2002')).status).toBe(404);

    providerStatus = finished();
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
