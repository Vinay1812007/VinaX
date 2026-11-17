/**
 * VinaX AI — thumbs up and down on replies (POST /api/ai/feedback, schema
 * 24): what a request may say, one rating per reply per account that can be
 * changed or taken back, the model copied from the saved reply (never the
 * page), only the listener's own replies, the ratings coming back with the
 * chat, and the console's per-model score in GET /api/admin/ai.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import worker from '../index';
import { onRequestPost } from '../functions/api/ai/feedback';
import { onRequestGet as conversationGet } from '../functions/api/ai/conversations/[id]';
import { onRequestGet as adminGet } from '../functions/api/admin/ai';
import { FEEDBACK_NOTE_MAX, parseFeedback } from '../functions/_lib/ai/feedback';
import { issueSession } from '../functions/_lib/googleAuth';
import { resetSettingsMemo } from '../functions/_lib/settings';
import { _resetRateLimitsForTests } from '../functions/_lib/ratelimit';
import { _resetCooldowns } from '../functions/_lib/ai/cooldown';
import { DB_ENV, fakeDb } from './helpers/fakeDb';

const ENV = { GOOGLE_CLIENT_ID: 'x.apps.googleusercontent.com', AUTH_SECRET: 'auth-secret', ADMIN_LOGIN_PASSWORD: 'owner-pass', ...DB_ENV };
const C1 = '11111111-1111-4111-8111-111111111111';
const C2 = '11111111-1111-4111-8111-111111111112';
const Q1 = '22222222-2222-4222-8222-222222222221';
const R1 = '22222222-2222-4222-8222-222222222222';
const R2 = '22222222-2222-4222-8222-222222222223';
const GPT = 'groq:openai/gpt-oss-120b';
let ip = 0;

const seed = () => fakeDb({
  ai_conversations: [
    { id: C1, account_id: '1001', title: 'Ragas', starred: false, model_pref: 'auto', active_leaf_id: R1, created_at: 'x', updated_at: 'x', deleted_at: null },
    { id: C2, account_id: '2002', title: 'Not yours', starred: false, model_pref: null, active_leaf_id: R2, created_at: 'x', updated_at: 'x', deleted_at: null },
  ],
  ai_messages: [
    { id: Q1, conversation_id: C1, parent_id: null, role: 'user', content: [{ type: 'text', text: 'What is a raga?' }], created_at: '2026-11-17T10:00:00Z' },
    { id: R1, conversation_id: C1, parent_id: Q1, role: 'assistant', content: [{ type: 'text', text: 'A framework.' }], model_id: GPT, provider: 'groq', stop_reason: 'end', created_at: '2026-11-17T10:00:01Z' },
    { id: R2, conversation_id: C2, parent_id: null, role: 'assistant', content: [{ type: 'text', text: 'Theirs.' }], model_id: GPT, provider: 'groq', stop_reason: 'end', created_at: 'x' },
  ],
});

async function post(body: unknown, sub: string | null = '1001'): Promise<Response> {
  const token = sub ? await issueSession(ENV, sub) : null;
  return onRequestPost({
    request: new Request('https://www.vinaxmusic.online/api/ai/feedback', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'cf-connecting-ip': `198.51.100.${++ip % 250}`, ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body),
    }),
    env: ENV as never,
  });
}

beforeEach(() => { _resetRateLimitsForTests(); resetSettingsMemo(); _resetCooldowns(); });
afterEach(() => vi.unstubAllGlobals());

describe('parseFeedback', () => {
  it('up, down with a reason and a note, or null to take it back', () => {
    expect(parseFeedback({ rating: 'up' })).toEqual({ ok: true, clear: false, rating: 'up', reason: null, note: null });
    expect(parseFeedback({ rating: 'down', reason: 'too_slow', note: '  took\nages  ' })).toEqual({ ok: true, clear: false, rating: 'down', reason: 'too_slow', note: 'took ages' });
    expect(parseFeedback({ rating: null })).toEqual({ ok: true, clear: true });
  });

  it('a thumbs up carries no reason or note', () => {
    expect(parseFeedback({ rating: 'up', reason: 'wrong', note: 'x' })).toMatchObject({ rating: 'up', reason: null, note: null });
  });

  it('refuses anything else', () => {
    for (const b of [{}, { rating: 'meh' }, { rating: 1 }, { rating: 'down', reason: 'rude' }, { rating: 'down', note: 5 }, { rating: 'down', note: 'x'.repeat(FEEDBACK_NOTE_MAX + 1) }]) {
      expect(parseFeedback(b as Record<string, unknown>), JSON.stringify(b).slice(0, 40)).toBeNull();
    }
    expect(parseFeedback({ rating: 'down', note: 'x'.repeat(FEEDBACK_NOTE_MAX) })).not.toBeNull();
  });
});

describe('POST /api/ai/feedback', () => {
  it('saves one rating per reply, with the saved reply’s model, and changes it', async () => {
    const fake = seed();
    const up = await post({ conversationId: C1, messageId: R1, rating: 'up', model: 'evil:made-up' });
    expect(up.status).toBe(200);
    expect(await up.json()).toEqual({ ok: true, feedback: { rating: 'up' } });
    expect(fake.rows('ai_feedback')).toHaveLength(1);
    expect(fake.rows('ai_feedback')[0]).toMatchObject({ message_id: R1, conversation_id: C1, account_id: '1001', model_id: GPT, provider: 'groq', rating: 'up', reason: null, note: null });
    const write = fake.calls.find((c) => c.table === 'ai_feedback' && c.method === 'POST')!;
    expect(write.query).toContain('on_conflict=message_id%2Caccount_id');
    expect(write.prefer).toContain('merge-duplicates');

    const down = await post({ conversationId: C1, messageId: R1, rating: 'down', reason: 'wrong', note: 'Yaman is not a Carnatic raga' });
    expect(await down.json()).toEqual({ ok: true, feedback: { rating: 'down', reason: 'wrong', note: 'Yaman is not a Carnatic raga' } });
    expect(fake.rows('ai_feedback')).toHaveLength(1);
    expect(fake.rows('ai_feedback')[0]).toMatchObject({ rating: 'down', reason: 'wrong' });

    const back = await post({ conversationId: C1, messageId: R1, rating: null });
    expect(await back.json()).toEqual({ ok: true, feedback: null });
    expect(fake.rows('ai_feedback')).toHaveLength(0);
  });

  it('only the listener’s own replies: not a question, not someone else’s chat, not a message of another chat', async () => {
    const fake = seed();
    expect((await post({ conversationId: C1, messageId: Q1, rating: 'up' })).status).toBe(404);
    expect((await post({ conversationId: C2, messageId: R2, rating: 'up' })).status).toBe(404);
    expect((await post({ conversationId: C1, messageId: R2, rating: 'up' })).status).toBe(404);
    expect(fake.rows('ai_feedback')).toHaveLength(0);
  });

  it('signed out, bad ids or a bad rating', async () => {
    seed();
    expect((await post({ conversationId: C1, messageId: R1, rating: 'up' }, null)).status).toBe(401);
    expect((await post({ conversationId: 'x', messageId: R1, rating: 'up' })).status).toBe(400);
    expect((await post({ conversationId: C1, messageId: R1, rating: 'great' })).status).toBe(400);
    expect((await post({ conversationId: C1, messageId: R1, rating: 'down', note: 'x'.repeat(301) })).status).toBe(400);
  });

  it('is rate limited like the other AI routes', async () => {
    seed();
    const token = await issueSession(ENV, '1001');
    const send = () => onRequestPost({
      request: new Request('https://www.vinaxmusic.online/api/ai/feedback', {
        method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.77', authorization: `Bearer ${token}` },
        body: JSON.stringify({ conversationId: C1, messageId: R1, rating: 'up' }),
      }),
      env: ENV as never,
    });
    const codes: number[] = [];
    for (let i = 0; i < 32; i++) codes.push((await send()).status);
    expect(codes.slice(0, 30).every((c) => c === 200)).toBe(true);
    expect(codes.at(-1)).toBe(429);
  });

  it('reaches its handler through the Worker’s router', async () => {
    seed();
    const token = await issueSession(ENV, '1001');
    const res = await worker.fetch(new Request('https://www.vinaxmusic.online/api/ai/feedback', {
      method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': '198.51.100.9', authorization: `Bearer ${token}` },
      body: JSON.stringify({ conversationId: C1, messageId: R1, rating: 'up' }),
    }), { ...ENV, ASSETS_HOST: 'vinax.pages.dev' } as never, { waitUntil: () => undefined });
    expect(res.status).toBe(200);
  });
});

describe('the ratings come back with the chat', () => {
  it('GET /api/ai/conversations/<id> puts the listener’s own rating on each rated reply', async () => {
    const fake = seed();
    fake.tables.ai_feedback = [
      { message_id: R1, conversation_id: C1, account_id: '1001', model_id: GPT, provider: 'groq', rating: 'down', reason: 'too_slow', note: null },
      { message_id: R1, conversation_id: C1, account_id: '2002', model_id: GPT, provider: 'groq', rating: 'up', reason: null, note: null },
    ];
    const token = await issueSession(ENV, '1001');
    const res = await conversationGet({
      request: new Request(`https://www.vinaxmusic.online/api/ai/conversations/${C1}`, { headers: { authorization: `Bearer ${token}`, 'cf-connecting-ip': `198.51.100.${++ip % 250}` } }),
      env: ENV as never,
      params: { id: C1 },
    });
    const body = await res.json() as { messages: Array<{ id: string; feedback?: unknown }> };
    expect(body.messages.find((m) => m.id === R1)?.feedback).toEqual({ rating: 'down', reason: 'too_slow' });
    expect(body.messages.find((m) => m.id === Q1)).not.toHaveProperty('feedback');
  });

  it('a database without the table still opens the chat', async () => {
    const fake = seed();
    fake.answer('ai_feedback', () => new Response('{"code":"42P01","message":"relation does not exist"}', { status: 404, headers: { 'content-type': 'application/json' } }));
    const token = await issueSession(ENV, '1001');
    const res = await conversationGet({
      request: new Request(`https://www.vinaxmusic.online/api/ai/conversations/${C1}`, { headers: { authorization: `Bearer ${token}`, 'cf-connecting-ip': `198.51.100.${++ip % 250}` } }),
      env: ENV as never,
      params: { id: C1 },
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { messages: unknown[] }).messages).toHaveLength(2);
  });
});

describe('the console’s per-model score', () => {
  const adminReq = () => new Request('https://www.vinaxmusic.online/api/admin/ai', { headers: { 'x-admin-token': 'owner-pass', 'cf-connecting-ip': `203.0.113.${++ip % 250}` } });

  it('GET /api/admin/ai carries each model’s thumbs over 30 days', async () => {
    const fake = seed();
    fake.answer('rpc/ai_feedback_stats', () => Response.json([{ model: GPT, up: 7, down: 3, reasons: { wrong: 1 } }, { model: null, up: 1, down: 0 }, { model: 'x', up: 'junk', down: -2 }]));
    const body = await (await adminGet({ request: adminReq(), env: ENV as never })).json() as { feedback: unknown };
    expect(body.feedback).toEqual({ days: 30, models: { [GPT]: { up: 7, down: 3 }, x: { up: 0, down: 0 } } });
    expect(fake.calls.find((c) => c.table === 'rpc/ai_feedback_stats')?.body).toEqual({ p_days: 30 });
  });

  it('null when the database cannot say', async () => {
    const fake = seed();
    fake.answer('rpc/ai_feedback_stats', () => new Response('{"message":"no function"}', { status: 404, headers: { 'content-type': 'application/json' } }));
    const body = await (await adminGet({ request: adminReq(), env: ENV as never })).json() as { feedback: unknown };
    expect(body.feedback).toBeNull();
  });
});
