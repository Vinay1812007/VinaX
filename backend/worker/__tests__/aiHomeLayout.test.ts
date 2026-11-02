/**
 * Music AI — POST /api/ai/home-layout: the AI chooses structure and words
 * only. Its answer is checked against what the device sent: allowed shelf
 * types only, each once, never an avoided one, a "right now" shelf with a
 * plain query or a seed the device offered, the shortcuts first and the feed
 * last. Every provider is mocked; no key is real.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { cleanQuery, onRequestPost as homeLayout, sanitizeHomeInput, validateHomeLayout, HOME_BLOCKS } from '../functions/api/ai/home-layout';
import { issueSession } from '../functions/_lib/googleAuth';
import { resetSettingsMemo } from '../functions/_lib/settings';
import { _resetRateLimitsForTests } from '../functions/_lib/ratelimit';
import { _resetCooldowns } from '../functions/_lib/ai/cooldown';
import { DB_ENV, fakeDb } from './helpers/fakeDb';
import { openAiSse, sseResponse } from './helpers/aiStreams';

const ENV = { GOOGLE_CLIENT_ID: 'x.apps.googleusercontent.com', AUTH_SECRET: 'auth-secret', GROQ_API_KEY: 'gsk-test', ...DB_ENV };
const ALLOWED = ['quick', 'personal', 'discovery', 'charts', 'moods', 'loved', 'feed', 'rightnow'];
const BODY = {
  generation: 7,
  taste: { languages: ['telugu', 'hindi'], artists: ['Singer A'], moods: ['chill'], energyByHour: [0.2, 0.6, 0.6, 0.4], discovery: 'balanced', skipStreak: 0, hour: 22, weekday: 5 },
  intent: { mood: 'chill' },
  allowed: [...ALLOWED, 'not-a-shelf'],
  avoid: ['charts'],
  seeds: [{ key: 's0', language: 'telugu', mood: 'chill', genre: 'film', leadArtist: 'Singer A' }, { key: 'bad key' }],
};
let ip = 0;

async function call(body: unknown, sub: string | null = '1001'): Promise<Response> {
  const token = sub ? await issueSession(ENV, sub) : null;
  return homeLayout({
    request: new Request('https://www.vinaxmusic.online/api/ai/home-layout', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json', 'cf-connecting-ip': `192.0.2.${++ip % 250}`, ...(token ? { authorization: `Bearer ${token}` } : {}) } }),
    env: ENV as never,
  });
}

const answers = (text: string, music: Record<string, unknown> | null = null): { prompts: string[] } => {
  const prompts: string[] = [];
  fakeDb({ settings: music ? [{ key: 'ai-music', value: music, updated_at: 'x', updated_by: 'owner' }] : [] }, (_u, init) => {
    prompts.push(String(init?.body));
    return sseResponse(openAiSse(text));
  });
  return { prompts };
};

beforeEach(() => {
  resetSettingsMemo();
  _resetRateLimitsForTests();
  _resetCooldowns();
});

describe('POST /api/ai/home-layout', () => {
  it('returns a checked layout for the generation it was asked for', async () => {
    const { prompts } = answers(JSON.stringify({
      blocks: [
        { type: 'personal', title: 'Your evening mixes', reason: 'Built from what you love at night' },
        { type: 'quick', title: 'Jump back in', reason: 'Your recent favourites' },
        { type: 'charts', title: 'Charts', reason: 'You said not interested' },
        { type: 'made-up', title: 'Nope', reason: 'Not a shelf' },
        { type: 'feed', title: 'Keep going', reason: 'Endless music' },
        { type: 'rightnow', title: 'Rainy evening melodies', reason: 'Soft songs for a slow night', query: 'Rainy evening melodies!', mood: 'chill', language: 'telugu', seedIds: ['s0', 's9'] },
        { type: 'personal', title: 'Again', reason: 'Twice' },
        { type: 'loved', title: 'Your favourites', reason: 'Songs you keep coming back to' },
      ],
    }));
    const res = await call(BODY);
    expect(res.status).toBe(200);
    const { layout } = (await res.json()) as { layout: { generation: number; blocks: Array<Record<string, unknown>> } };
    expect(layout.generation).toBe(7);
    expect(layout.blocks.map((b) => b.type)).toEqual(['quick', 'personal', 'rightnow', 'loved', 'feed']);
    expect(layout.blocks[2]).toEqual({ type: 'rightnow', title: 'Rainy evening melodies', reason: 'Soft songs for a slow night', query: 'rainy evening melodies', mood: 'chill', language: 'telugu', seedIds: ['s0'] });
    // The prompt carries the Worker's own description of each shelf, and no avoided one.
    expect(prompts[0]).toContain('Made for right now');
    expect(prompts[0]).not.toContain('"type":"charts"');
  });

  it('answers 502 when fewer than four usable shelves come back', async () => {
    answers('{"blocks":[{"type":"quick","title":"A","reason":"B"},{"type":"charts","title":"C","reason":"D"}]}');
    expect((await call(BODY)).status).toBe(502);
  });

  it('refuses a body without a generation or with too few allowed shelves', async () => {
    answers('{}');
    expect((await call({ ...BODY, generation: 'x' })).status).toBe(400);
    expect((await call({ ...BODY, allowed: ['quick', 'feed'] })).status).toBe(400);
  });

  it('needs a session and the owner’s home switch', async () => {
    answers('{}', { home: false });
    expect((await call(BODY, null)).status).toBe(401);
    expect((await call(BODY)).status).toBe(503);
  });
});

describe('home layout checks', () => {
  it('keeps the input to known shelf types and well-formed seeds', () => {
    const input = sanitizeHomeInput(BODY as unknown as Record<string, unknown>)!;
    expect(input.allowed).toEqual(ALLOWED.filter((t) => t !== 'charts'));
    expect(input.avoid).toEqual(['charts']);
    expect(input.seeds.map((s) => s.key)).toEqual(['s0']);
    expect(Object.keys(HOME_BLOCKS)).toEqual(expect.arrayContaining([...ALLOWED, 'generated']));
  });

  it('accepts only plain search phrases of two to five words', () => {
    expect(cleanQuery('Rainy, evening melodies!')).toBe('rainy evening melodies');
    expect(cleanQuery('lofi')).toBeNull();
    expect(cleanQuery('one two three four five six')).toBeNull();
    expect(cleanQuery('late night drive')).toBe('late night drive');
  });

  it('drops a "right now" shelf with nothing to feed it', () => {
    const input = { generation: 1, allowed: ALLOWED, avoid: [], seeds: [], languages: ['telugu'] };
    const four = ['quick', 'personal', 'loved', 'feed'].map((type) => ({ type, title: 'T', reason: 'R' }));
    expect(validateHomeLayout({ blocks: [...four, { type: 'rightnow', title: 'X', reason: 'Y', language: 'tamil' }] }, input)!.map((b) => b.type)).toEqual(['quick', 'personal', 'loved', 'feed']);
  });
});
