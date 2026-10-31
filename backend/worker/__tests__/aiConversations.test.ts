/**
 * VinaX AI — the conversation routes (list, search, read, rename, star,
 * switch branch, delete), always scoped to the session's account; the
 * public model list; and PATCH / DELETE reaching their handlers through the
 * Worker's router.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import worker from '../index';
import { onRequestGet as listGet } from '../functions/api/ai/conversations';
import { onRequestDelete, onRequestGet, onRequestPatch } from '../functions/api/ai/conversations/[id]';
import { onRequestGet as modelsGet } from '../functions/api/ai/models';
import { issueSession } from '../functions/_lib/googleAuth';
import { resetSettingsMemo } from '../functions/_lib/settings';
import { _resetRateLimitsForTests } from '../functions/_lib/ratelimit';
import { _resetCooldowns, noteFailure } from '../functions/_lib/ai/cooldown';
import { ProviderError } from '../functions/_lib/ai/errors';
import { MODELS, modelById } from '../functions/_lib/ai/models';
import { DB_ENV, fakeDb } from './helpers/fakeDb';

const ENV = { GOOGLE_CLIENT_ID: 'x.apps.googleusercontent.com', AUTH_SECRET: 'auth-secret', ...DB_ENV };
const C1 = '11111111-1111-4111-8111-111111111111';
const C2 = '11111111-1111-4111-8111-111111111112';
const M1 = '22222222-2222-4222-8222-222222222221';
const M2 = '22222222-2222-4222-8222-222222222222';
let ip = 0;

const seed = () => fakeDb({
  ai_conversations: [
    { id: C1, account_id: '1001', title: 'Ragas', starred: false, model_pref: 'auto', active_leaf_id: M2, created_at: '2026-10-30T10:00:00Z', updated_at: '2026-10-30T10:05:00Z', deleted_at: null },
    { id: C2, account_id: '2002', title: 'Not yours', starred: false, model_pref: null, active_leaf_id: null, created_at: '2026-10-30T10:00:00Z', updated_at: '2026-10-30T10:00:00Z', deleted_at: null },
  ],
  ai_messages: [
    { id: M1, conversation_id: C1, parent_id: null, role: 'user', content: [{ type: 'text', text: 'What is a raga?' }], created_at: '2026-10-30T10:00:00Z' },
    { id: M2, conversation_id: C1, parent_id: M1, role: 'assistant', content: [{ type: 'text', text: 'A framework.' }], model_id: 'groq:openai/gpt-oss-120b', provider: 'groq', stop_reason: 'end', created_at: '2026-10-30T10:00:01Z' },
  ],
});

async function req(path: string, init: RequestInit & { sub?: string | null } = {}): Promise<Request> {
  const sub = init.sub === undefined ? '1001' : init.sub;
  const token = sub ? await issueSession(ENV, sub) : null;
  return new Request(`https://www.vinaxmusic.online${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', 'cf-connecting-ip': `198.51.100.${++ip % 250}`, ...(token ? { authorization: `Bearer ${token}` } : {}) },
  });
}

beforeEach(() => { _resetRateLimitsForTests(); resetSettingsMemo(); _resetCooldowns(); });
afterEach(() => vi.unstubAllGlobals());

describe('GET /api/ai/conversations', () => {
  it('lists only the account\'s own conversations, newest first, without account ids', async () => {
    seed();
    const res = await listGet({ request: await req('/api/ai/conversations'), env: ENV });
    const body = (await res.json()) as { items: Array<Record<string, unknown>>; nextCursor: string | null };
    expect(body.items.map((c) => c.id)).toEqual([C1]);
    expect(body.items[0]).not.toHaveProperty('account_id');
    expect(body.nextCursor).toBeNull();
  });

  it('a search goes through ai_conversation_search with the account and the text', async () => {
    const fake = seed();
    fake.answer('rpc/ai_conversation_search', () => new Response(JSON.stringify([]), { status: 200, headers: { 'content-type': 'application/json' } }));
    await listGet({ request: await req('/api/ai/conversations?q=%20raga%25%20'), env: ENV });
    const call = fake.calls.find((c) => c.table === 'rpc/ai_conversation_search');
    expect(call?.body).toEqual({ p_account: '1001', p_query: 'raga%', p_before: null, p_limit: 30 });
  });

  it('401 signed out', async () => {
    seed();
    expect((await listGet({ request: await req('/api/ai/conversations', { sub: null }), env: ENV })).status).toBe(401);
  });
});

describe('/api/ai/conversations/:id', () => {
  it('GET returns the whole tree with model labels', async () => {
    seed();
    const res = await onRequestGet({ request: await req(`/api/ai/conversations/${C1}`), env: ENV, params: { id: C1 } });
    const body = (await res.json()) as { conversation: { activeLeafId: string }; messages: Array<{ id: string; parentId: string | null; model: unknown }> };
    expect(body.conversation.activeLeafId).toBe(M2);
    expect(body.messages.map((m) => [m.id, m.parentId])).toEqual([[M1, null], [M2, M1]]);
    expect(body.messages[1].model).toEqual({ id: 'groq:openai/gpt-oss-120b', name: 'GPT-OSS 120B', provider: 'Groq' });
  });

  it('someone else\'s, a deleted one, or a malformed id is 404', async () => {
    const fake = seed();
    expect((await onRequestGet({ request: await req(`/api/ai/conversations/${C2}`), env: ENV, params: { id: C2 } })).status).toBe(404);
    expect((await onRequestGet({ request: await req('/api/ai/conversations/x'), env: ENV, params: { id: 'x' } })).status).toBe(404);
    fake.rows('ai_conversations')[0].deleted_at = '2026-10-30T11:00:00Z';
    expect((await onRequestGet({ request: await req(`/api/ai/conversations/${C1}`), env: ENV, params: { id: C1 } })).status).toBe(404);
  });

  it('PATCH renames, stars and switches the active branch', async () => {
    const fake = seed();
    const res = await onRequestPatch({ request: await req(`/api/ai/conversations/${C1}`, { method: 'PATCH', body: JSON.stringify({ title: '  Evening   ragas ', starred: true, activeLeafId: M1 }) }), env: ENV, params: { id: C1 } });
    expect(res.status).toBe(200);
    expect(fake.rows('ai_conversations')[0]).toMatchObject({ title: 'Evening ragas', starred: true, active_leaf_id: M1 });
  });

  it('PATCH refuses a branch from another conversation, an empty title or nothing to change', async () => {
    seed();
    const patch = async (body: unknown) => (await onRequestPatch({ request: await req(`/api/ai/conversations/${C1}`, { method: 'PATCH', body: JSON.stringify(body) }), env: ENV, params: { id: C1 } })).status;
    expect(await patch({ activeLeafId: '33333333-3333-4333-8333-333333333333' })).toBe(404);
    expect(await patch({ title: '   ' })).toBe(400);
    expect(await patch({ starred: 'yes' })).toBe(400);
    expect(await patch({})).toBe(400);
  });

  it('DELETE hides the conversation; another account cannot delete it', async () => {
    const fake = seed();
    expect((await onRequestDelete({ request: await req(`/api/ai/conversations/${C1}`, { method: 'DELETE', sub: '2002' }), env: ENV, params: { id: C1 } })).status).toBe(404);
    expect(fake.rows('ai_conversations')[0].deleted_at).toBeNull();
    expect((await onRequestDelete({ request: await req(`/api/ai/conversations/${C1}`, { method: 'DELETE' }), env: ENV, params: { id: C1 } })).status).toBe(200);
    expect(fake.rows('ai_conversations')[0].deleted_at).toEqual(expect.any(String));
  });
});

describe('the Worker routes PATCH and DELETE to their handlers', () => {
  it.each(['PATCH', 'DELETE'])('%s /api/ai/conversations/:id answers from the handler, not 405', async (method) => {
    seed();
    const res = await worker.fetch(new Request(`https://www.vinaxmusic.online/api/ai/conversations/${C1}`, { method, headers: { 'cf-connecting-ip': '198.51.100.250' } }), { ...ENV, ASSETS_HOST: 'vinax.pages.dev' }, { waitUntil: () => undefined });
    expect(res.status).toBe(401);
  });
});

describe('GET /api/ai/models', () => {
  it('lists picker models with availability, never hosts or keys; enabled follows the switch', async () => {
    fakeDb({ settings: [{ key: 'vinax-ai', value: { enabled: false, testers: ['1001'] }, updated_at: 'x', updated_by: 'owner' }] });
    noteFailure(modelById(MODELS, 'groq:openai/gpt-oss-20b')!, new ProviderError('rate'));
    const env = { ...ENV, GROQ_API_KEY: 'gsk_test' };
    const anon = (await (await modelsGet({ request: await req('/api/ai/models', { sub: null }), env })).json()) as { enabled: boolean; configured: boolean; models: Array<{ id: string; group: string; available: boolean; reason?: string; provider: string }> };
    expect(anon.enabled).toBe(false);
    expect(anon.configured).toBe(true);
    expect(anon.models.every((m) => m.group)).toBe(true);
    const by = Object.fromEntries(anon.models.map((m) => [m.id, m]));
    expect(by['groq:openai/gpt-oss-120b']).toMatchObject({ available: true, provider: 'Groq' });
    expect(by['groq:openai/gpt-oss-20b']).toMatchObject({ available: false, reason: 'busy' });
    expect(by['gemini:gemini-3.5-flash']).toMatchObject({ available: false, reason: 'not_configured' });
    expect(JSON.stringify(anon)).not.toMatch(/gsk_test|api\.groq\.com|failover/);
    resetSettingsMemo();
    const tester = (await (await modelsGet({ request: await req('/api/ai/models'), env })).json()) as { enabled: boolean };
    expect(tester.enabled).toBe(true);
  });
});
