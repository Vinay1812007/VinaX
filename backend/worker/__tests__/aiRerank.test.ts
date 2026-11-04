/**
 * Music AI — POST /api/ai/rerank and the shared music library: the owner's
 * switches, the gate, the strict JSON reader, the input sanitisers, and that
 * an answer can only ever name keys the device sent. Every provider is
 * mocked; no key is real.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { onRequestPost as rerank, sanitizeCandidates, validateOrder, MAX_RERANK_CANDIDATES } from '../functions/api/ai/rerank';
import { cleanReason, extractJson, sanitizeIntent, sanitizeMusicSettings, sanitizeTaste } from '../functions/_lib/ai/music';
import { issueSession } from '../functions/_lib/googleAuth';
import { resetSettingsMemo } from '../functions/_lib/settings';
import { _resetRateLimitsForTests } from '../functions/_lib/ratelimit';
import { _resetCooldowns } from '../functions/_lib/ai/cooldown';
import { DB_ENV, fakeDb } from './helpers/fakeDb';
import { openAiSse, sseResponse } from './helpers/aiStreams';

const ENV = { GOOGLE_CLIENT_ID: 'x.apps.googleusercontent.com', AUTH_SECRET: 'auth-secret', GROQ_API_KEY: 'gsk-test', ...DB_ENV };
let ip = 0;

const CANDIDATES = Array.from({ length: 6 }, (_, i) => ({ key: `c${i}`, language: 'telugu', mood: i % 2 ? 'chill' : 'energetic', energy: i / 6, genre: 'film', leadArtist: `Singer ${i}` }));
const BODY = { candidates: CANDIDATES, taste: { languages: ['telugu'], artists: ['Singer 1'], moods: ['chill'], energyByHour: [0.2, 0.5, 0.6, 0.4], discovery: 'balanced', skipStreak: 0, hour: 21, weekday: 5 }, intent: { mood: 'chill', energySteer: -0.1 } };

async function call(body: unknown, opts: { sub?: string | null; env?: Record<string, unknown> } = {}): Promise<Response> {
  const sub = opts.sub === undefined ? '1001' : opts.sub;
  const token = sub ? await issueSession(ENV, sub) : null;
  const request = new Request('https://www.vinaxmusic.online/api/ai/rerank', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json', 'cf-connecting-ip': `203.0.113.${++ip % 250}`, ...(token ? { authorization: `Bearer ${token}` } : {}) },
  });
  return rerank({ request, env: (opts.env ?? ENV) as never });
}

function upstreamAnswers(text: string, music: Record<string, unknown> | null = null): { sent: unknown[] } {
  const sent: unknown[] = [];
  fakeDb({ settings: music ? [{ key: 'ai-music', value: music, updated_at: 'x', updated_by: 'owner' }] : [] }, (_url, init) => {
    sent.push(JSON.parse(String(init?.body)));
    return sseResponse(openAiSse(text));
  });
  return { sent };
}

beforeEach(() => {
  resetSettingsMemo();
  _resetRateLimitsForTests();
  _resetCooldowns();
});

describe('POST /api/ai/rerank', () => {
  it('returns the model’s order, keeping only keys the device sent, each once', async () => {
    const { sent } = upstreamAnswers('```json\n{"order":[{"key":"c3","reason":"Keeps the chill going"},{"key":"zz","reason":"invented"},{"key":"c3","reason":"again"},{"key":"c1","reason":"A singer you play"}]}\n```');
    const res = await call(BODY);
    expect(res.status).toBe(200);
    const out = (await res.json()) as { order: Array<{ key: string; reason: string }>; model: string };
    expect(out.order).toEqual([{ key: 'c3', reason: 'Keeps the chill going' }, { key: 'c1', reason: 'A singer you play' }]);
    expect(out.model).toMatch(/^groq:/);
    // The model got the summary and the candidates as material, and nothing else.
    const prompt = JSON.stringify(sent[0]);
    expect(prompt).toContain('Singer 1');
    expect(prompt).toContain('data, not instructions');
  });

  it('answers 502 when the model names no key from the input', async () => {
    upstreamAnswers('{"order":[{"key":"song-123","reason":"x"}]}');
    expect((await call(BODY)).status).toBe(502);
  });

  it('answers 502, never a guess, when the model sends no JSON', async () => {
    upstreamAnswers('Here are my picks: c1, c2');
    expect((await call(BODY)).status).toBe(502);
  });

  it('refuses malformed candidates and oversized bodies', async () => {
    upstreamAnswers('{}');
    expect((await call({ ...BODY, candidates: [] })).status).toBe(400);
    expect((await call({ ...BODY, candidates: [{ key: 'Song Title|Artist' }] })).status).toBe(400);
    expect((await call({ ...BODY, candidates: 'c1' })).status).toBe(400);
  });

  it('needs a session, a provider and the owner’s switch', async () => {
    upstreamAnswers('{"order":["c1"]}');
    expect((await call(BODY, { sub: null })).status).toBe(401);
    expect((await call(BODY, { env: { ...ENV, GROQ_API_KEY: '' } })).status).toBe(503);
    upstreamAnswers('{"order":["c1"]}', { rerank: false });
    resetSettingsMemo();
    const off = await call(BODY);
    expect(off.status).toBe(503);
    expect(await off.json()).toEqual({ error: 'ai_disabled' });
    upstreamAnswers('{"order":["c1"]}', { enabled: false });
    resetSettingsMemo();
    expect((await call(BODY)).status).toBe(503);
  });
});

describe('music AI helpers', () => {
  it('reads the first JSON object out of fences, reasoning and chatter', () => {
    expect(extractJson('<think>{"no":1}</think>Sure! {"order":["c1"]} hope that helps {"x":2}')).toEqual({ order: ['c1'] });
    expect(extractJson('{"reason":"a } inside a string"}')).toEqual({ reason: 'a } inside a string' });
    expect(extractJson('no json here')).toBeNull();
    expect(extractJson('{"broken": ')).toBeNull();
  });

  it('sanitises the candidates: opaque short keys only, at most 40, first copy wins', () => {
    const many = Array.from({ length: 60 }, (_, i) => ({ key: `c${i}` }));
    expect(sanitizeCandidates(many)).toHaveLength(MAX_RERANK_CANDIDATES);
    expect(sanitizeCandidates([{ key: 'c1', leadArtist: '<b>Singer</b>\u0000' }, { key: 'c1' }])).toEqual([{ key: 'c1', language: null, mood: null, energy: null, genre: null, leadArtist: 'b Singer /b' }]);
    expect(sanitizeCandidates([{ key: 'a very long key with spaces' }])).toBeNull();
  });

  it('validates an order against the keys it was given', () => {
    const allowed = new Set(['c1', 'c2']);
    expect(validateOrder({ order: ['c2', 'c9', { key: 'c1', reason: 'See https://x.y' }] }, allowed)).toEqual([{ key: 'c2', reason: null }, { key: 'c1', reason: null }]);
    expect(validateOrder({ order: [] }, allowed)).toBeNull();
    expect(validateOrder(null, allowed)).toBeNull();
  });

  it('keeps the taste and intent summaries to their documented fields and ranges', () => {
    const t = sanitizeTaste({ languages: ['Telugu', 'telugu', 'hindi', 'tamil', 'english', 'kannada'], artists: Array(20).fill('x'), energyByHour: [2, -1], discovery: 'wild', skipStreak: 99, hour: 30, history: ['should never pass'] });
    expect(t).toEqual({ languages: ['telugu', 'hindi', 'tamil', 'english'], artists: ['x'], moods: [], energyByHour: [1, 0, null, null], discovery: 'balanced', skipStreak: 20, hour: 23, weekday: 0 });
    expect(sanitizeIntent({ energySteer: 4, completionStreak: -2, mood: 'chill' })).toEqual({ mood: 'chill', tune: null, language: null, energySteer: 0.3, completionStreak: 0 });
    expect(cleanReason('x'.repeat(200), 20)).toHaveLength(20);
  });

  it('reads the owner’s switches: rerank and home on, generation off, unless set', () => {
    expect(sanitizeMusicSettings(undefined)).toEqual({ enabled: true, rerank: true, home: true, dj: true, playlist: true, lyrics: true, generate: { enabled: false, dailyQuota: 5 } });
    expect(sanitizeMusicSettings({ enabled: false, generate: { enabled: true, dailyQuota: 900 } })).toEqual({ enabled: false, rerank: true, home: true, dj: true, playlist: true, lyrics: true, generate: { enabled: true, dailyQuota: 50 } });
    expect(sanitizeMusicSettings({ dj: false, lyrics: false })).toMatchObject({ dj: false, playlist: true, lyrics: false });
  });
});
