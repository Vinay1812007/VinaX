/**
 * VinaX AI — shared chat links: only the owner makes, lists, updates and
 * stops them; anyone reads one by its id (no session, never indexed); the
 * snapshot is the active branch without reasoning or file contents; deleting
 * the chat removes its link; a signed-in reader can continue in a new chat.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import worker from '../index';
import { onRequestGet as listGet, onRequestPost as createPost } from '../functions/api/ai/shares';
import { onRequestDelete as shareDelete, onRequestGet as shareGet } from '../functions/api/ai/shares/[id]';
import { onRequestPost as continuePost } from '../functions/api/ai/shares/[id]-continue';
import { onRequestDelete as conversationDelete } from '../functions/api/ai/conversations/[id]';
import { issueSession } from '../functions/_lib/googleAuth';
import { resetSettingsMemo } from '../functions/_lib/settings';
import { _resetRateLimitsForTests } from '../functions/_lib/ratelimit';
import { MAX_SHARE_BYTES, newShareId, SHARE_ID, snapshotOf } from '../functions/_lib/ai/shares';
import type { MessageRow } from '../functions/_lib/ai/store';
import { DB_ENV, fakeDb } from './helpers/fakeDb';

const ENV = { GOOGLE_CLIENT_ID: 'x.apps.googleusercontent.com', AUTH_SECRET: 'auth-secret', ...DB_ENV };
const C1 = '11111111-1111-4111-8111-111111111111';
const C2 = '11111111-1111-4111-8111-111111111112';
const M1 = '22222222-2222-4222-8222-222222222221';
const M2 = '22222222-2222-4222-8222-222222222222';
const M3 = '22222222-2222-4222-8222-222222222223';
const M4 = '22222222-2222-4222-8222-222222222224';
let ip = 0;

const conv = (id: string, account: string, extra: Record<string, unknown> = {}) => ({
  id, account_id: account, title: 'Ragas', starred: false, model_pref: 'auto', active_leaf_id: M2, created_at: '2026-10-30T10:00:00Z', updated_at: '2026-10-30T10:05:00Z', deleted_at: null, ...extra,
});

const MESSAGES = [
  { id: M1, conversation_id: C1, parent_id: null, role: 'user', content: [{ type: 'text', text: 'What is a raga?' }, { type: 'attachment', id: 'a1', name: 'notes.pdf', kind: 'pdf', mime: 'application/pdf', size: 900 }], created_at: '2026-10-30T10:00:00Z' },
  {
    id: M2, conversation_id: C1, parent_id: M1, role: 'assistant', content: [{ type: 'text', text: 'A framework [1].\n\n<artifact id="scale" type="code" title="Scale">sa re ga</artifact>' }],
    thinking: 'secret reasoning', thinking_ms: 900, sources: { via: 'search', items: [{ n: 1, url: 'https://example.com/raga', title: 'Raga', site: 'example.com' }, { n: 2, url: 'javascript:alert(1)', title: 'x', site: 'x' }], queries: ['raga'] },
    model_id: 'acme:model-x', provider: 'acme', stop_reason: 'end', usage: { input: 5, output: 9 }, created_at: '2026-10-30T10:00:01Z',
  },
  // Another version of the answer: not on the active branch.
  { id: M3, conversation_id: C1, parent_id: M1, role: 'assistant', content: [{ type: 'text', text: 'An older answer.' }], created_at: '2026-10-30T10:00:02Z' },
];

const seed = (extra: Record<string, Array<Record<string, unknown>>> = {}) => fakeDb({
  ai_conversations: [conv(C1, '1001'), conv(C2, '2002', { title: 'Not yours' })],
  ai_messages: MESSAGES.map((m) => ({ ...m })),
  ...extra,
});

async function req(path: string, init: RequestInit & { sub?: string | null } = {}): Promise<Request> {
  const sub = init.sub === undefined ? '1001' : init.sub;
  const token = sub ? await issueSession(ENV, sub) : null;
  return new Request(`https://www.vinaxmusic.online${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', 'cf-connecting-ip': `198.51.100.${++ip % 250}`, ...(token ? { authorization: `Bearer ${token}` } : {}) },
  });
}

const create = async (conversationId: unknown, sub?: string | null) =>
  createPost({ request: await req('/api/ai/shares', { method: 'POST', body: JSON.stringify({ conversationId }), sub }), env: ENV });

beforeEach(() => { _resetRateLimitsForTests(); resetSettingsMemo(); });
afterEach(() => vi.unstubAllGlobals());

describe('the snapshot', () => {
  it('is the active branch: text and artifacts kept, reasoning and model left out, files by name only, unsafe sources dropped', () => {
    const snap = snapshotOf({ active_leaf_id: M2 }, MESSAGES as unknown as MessageRow[]);
    expect(snap).toHaveLength(2);
    expect(snap[0]).toEqual({ role: 'user', text: 'What is a raga?', files: [{ name: 'notes.pdf', kind: 'pdf' }], createdAt: '2026-10-30T10:00:00Z' });
    expect(snap[1].text).toContain('<artifact id="scale"');
    expect(snap[1].sources).toEqual({ via: 'search', items: [{ n: 1, url: 'https://example.com/raga', title: 'Raga', site: 'example.com' }] });
    const raw = JSON.stringify(snap);
    expect(raw).not.toMatch(/secret reasoning|model-x|acme|a1|application\/pdf|usage|queries/);
  });

  it('follows the newest leaf when no branch was saved, and skips empty replies', () => {
    const rows = [...MESSAGES, { id: M4, conversation_id: C1, parent_id: M3, role: 'user', content: [{ type: 'text', text: '' }], created_at: '2026-10-30T10:00:03Z' }];
    const snap = snapshotOf({ active_leaf_id: null }, rows as unknown as MessageRow[]);
    expect(snap.map((m) => m.text)).toEqual(['What is a raga?', 'An older answer.']);
  });

  it('ids are 22 base64url characters and differ', () => {
    const a = newShareId();
    expect(a).toMatch(SHARE_ID);
    expect(newShareId()).not.toBe(a);
  });
});

describe('POST /api/ai/shares', () => {
  it('makes a link for the owner\'s chat (201), then the same link with a new snapshot (200)', async () => {
    const fake = seed();
    const first = await create(C1);
    expect(first.status).toBe(201);
    const { share } = (await first.json()) as { share: { id: string; conversationId: string; title: string; messageCount: number } };
    expect(share).toMatchObject({ conversationId: C1, title: 'Ragas', messageCount: 2 });
    expect(share.id).toMatch(SHARE_ID);
    expect(share).not.toHaveProperty('account_id');
    const row = fake.rows('ai_shares')[0];
    expect(row).toMatchObject({ account_id: '1001', conversation_id: C1, message_count: 2 });

    fake.rows('ai_messages').push({ id: M4, conversation_id: C1, parent_id: M2, role: 'user', content: [{ type: 'text', text: 'And Yaman?' }], created_at: '2026-10-30T10:01:00Z' });
    fake.rows('ai_conversations')[0].active_leaf_id = M4;
    const again = await create(C1);
    expect(again.status).toBe(200);
    expect(((await again.json()) as { share: { id: string; messageCount: number } }).share).toMatchObject({ id: share.id, messageCount: 3 });
    expect(fake.rows('ai_shares')).toHaveLength(1);
  });

  it('someone else\'s chat, a deleted one or a bad id is 404; signed out is 401', async () => {
    const fake = seed();
    expect((await create(C2)).status).toBe(404);
    expect((await create('nope')).status).toBe(404);
    expect((await create(C1, null)).status).toBe(401);
    fake.rows('ai_conversations')[0].deleted_at = '2026-10-30T11:00:00Z';
    expect((await create(C1)).status).toBe(404);
    expect(fake.rows('ai_shares')).toHaveLength(0);
  });

  it('an empty chat is 422 and a chat past the size cap is 413', async () => {
    const fake = seed();
    fake.rows('ai_messages').length = 0;
    expect((await create(C1)).status).toBe(422);
    fake.rows('ai_messages').push({ id: M1, conversation_id: C1, parent_id: null, role: 'user', content: [{ type: 'text', text: 'x'.repeat(MAX_SHARE_BYTES + 10) }], created_at: '2026-10-30T10:00:00Z' });
    fake.rows('ai_conversations')[0].active_leaf_id = M1;
    expect((await create(C1)).status).toBe(413);
    expect(fake.rows('ai_shares')).toHaveLength(0);
  });
});

describe('GET /api/ai/shares (the owner\'s links)', () => {
  it('lists only the account\'s links, optionally for one chat', async () => {
    seed({
      ai_shares: [
        { id: 'AAAAAAAAAAAAAAAAAAAAAA', account_id: '1001', conversation_id: C1, title: 'Ragas', messages: [], message_count: 2, bytes: 10, created_at: 'x', updated_at: 'y' },
        { id: 'BBBBBBBBBBBBBBBBBBBBBB', account_id: '2002', conversation_id: C2, title: 'Not yours', messages: [], message_count: 1, bytes: 10, created_at: 'x', updated_at: 'y' },
      ],
    });
    const body = (await (await listGet({ request: await req('/api/ai/shares'), env: ENV })).json()) as { items: Array<{ id: string }> };
    expect(body.items.map((s) => s.id)).toEqual(['AAAAAAAAAAAAAAAAAAAAAA']);
    const one = (await (await listGet({ request: await req(`/api/ai/shares?conversation=${C2}`), env: ENV })).json()) as { items: unknown[] };
    expect(one.items).toEqual([]);
    expect((await listGet({ request: await req('/api/ai/shares', { sub: null }), env: ENV })).status).toBe(401);
  });
});

describe('/api/ai/shares/:id', () => {
  const SID = 'AAAAAAAAAAAAAAAAAAAAAA';
  const shareRow = () => ({ id: SID, account_id: '1001', conversation_id: C1, title: 'Ragas', messages: snapshotOf({ active_leaf_id: M2 }, MESSAGES as unknown as MessageRow[]), message_count: 2, bytes: 10, created_at: '2026-10-30T10:06:00Z', updated_at: '2026-10-30T10:06:00Z' });

  it('anyone reads it without a session: public cache, noindex, no account or chat id', async () => {
    seed({ ai_shares: [shareRow()] });
    const res = await shareGet({ request: await req(`/api/ai/shares/${SID}`, { sub: null }), env: ENV, params: { id: SID } });
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('public, max-age=60');
    expect(res.headers.get('x-robots-tag')).toMatch(/noindex/);
    const body = (await res.json()) as { share: Record<string, unknown> & { messages: unknown[] } };
    expect(body.share).toMatchObject({ id: SID, title: 'Ragas', createdAt: '2026-10-30T10:06:00Z' });
    expect(body.share.messages).toHaveLength(2);
    expect(JSON.stringify(body)).not.toMatch(/1001|11111111-1111/);
  });

  it('an unknown or malformed id is 404, not cached', async () => {
    seed();
    const miss = await shareGet({ request: await req('/api/ai/shares/ZZZZZZZZZZZZZZZZZZZZZZ', { sub: null }), env: ENV, params: { id: 'ZZZZZZZZZZZZZZZZZZZZZZ' } });
    expect(miss.status).toBe(404);
    expect(miss.headers.get('cache-control')).toBe('no-store');
    expect((await shareGet({ request: await req('/api/ai/shares/x', { sub: null }), env: ENV, params: { id: '../x' } })).status).toBe(404);
  });

  it('only the owner stops sharing', async () => {
    const fake = seed({ ai_shares: [shareRow()] });
    expect((await shareDelete({ request: await req(`/api/ai/shares/${SID}`, { method: 'DELETE', sub: null }), env: ENV, params: { id: SID } })).status).toBe(401);
    expect((await shareDelete({ request: await req(`/api/ai/shares/${SID}`, { method: 'DELETE', sub: '2002' }), env: ENV, params: { id: SID } })).status).toBe(404);
    expect(fake.rows('ai_shares')).toHaveLength(1);
    expect((await shareDelete({ request: await req(`/api/ai/shares/${SID}`, { method: 'DELETE' }), env: ENV, params: { id: SID } })).status).toBe(200);
    expect(fake.tables.ai_shares).toHaveLength(0);
    expect((await shareGet({ request: await req(`/api/ai/shares/${SID}`, { sub: null }), env: ENV, params: { id: SID } })).status).toBe(404);
  });

  it('a link to a deleted chat reads as not found even before its row is gone', async () => {
    const fake = seed({ ai_shares: [shareRow()] });
    fake.rows('ai_conversations')[0].deleted_at = '2026-10-30T11:00:00Z';
    expect((await shareGet({ request: await req(`/api/ai/shares/${SID}`, { sub: null }), env: ENV, params: { id: SID } })).status).toBe(404);
  });

  it('deleting the chat removes its link at once', async () => {
    const fake = seed({ ai_shares: [shareRow()] });
    expect((await conversationDelete({ request: await req(`/api/ai/conversations/${C1}`, { method: 'DELETE' }), env: ENV, params: { id: C1 } })).status).toBe(200);
    expect(fake.tables.ai_shares).toHaveLength(0);
  });

  it('continue makes a new chat for the reader from the snapshot, while VinaX AI is open', async () => {
    const fake = seed({ ai_shares: [shareRow()] });
    expect((await continuePost({ request: await req(`/api/ai/shares/${SID}/continue`, { method: 'POST', sub: '2002' }), env: ENV, params: { id: SID } })).status).toBe(503);
    fake.rows('settings').push({ key: 'vinax-ai', value: { enabled: true }, updated_at: 'x', updated_by: 'owner' });
    resetSettingsMemo();
    expect((await continuePost({ request: await req(`/api/ai/shares/${SID}/continue`, { method: 'POST', sub: null }), env: ENV, params: { id: SID } })).status).toBe(401);
    expect((await continuePost({ request: await req('/api/ai/shares/x/continue', { method: 'POST', sub: '2002' }), env: ENV, params: { id: 'x' } })).status).toBe(404);
    const res = await continuePost({ request: await req(`/api/ai/shares/${SID}/continue`, { method: 'POST', sub: '2002' }), env: ENV, params: { id: SID } });
    expect(res.status).toBe(200);
    const { conversationId } = (await res.json()) as { conversationId: string };
    const made = fake.rows('ai_conversations').find((c) => c.id === conversationId);
    expect(made).toMatchObject({ account_id: '2002', title: 'Ragas' });
    const msgs = fake.rows('ai_messages').filter((m) => m.conversation_id === conversationId);
    expect(msgs.map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(msgs[1].parent_id).toBe(msgs[0].id);
    expect((msgs[0].content as Array<{ text: string }>)[0].text).toBe('What is a raga?\n\n[file: notes.pdf]');
    expect(made?.active_leaf_id).toBe(msgs[1].id);
    // The sharer's chat is untouched.
    expect(fake.rows('ai_messages').filter((m) => m.conversation_id === C1)).toHaveLength(3);
  });
});

describe('the Worker routes the share paths', () => {
  it('GET /api/ai/shares/:id reaches the public handler; /continue reaches its own', async () => {
    seed();
    const env = { ...ENV, ASSETS_HOST: 'vinax.pages.dev' };
    const ctx = { waitUntil: () => undefined };
    const read = await worker.fetch(new Request('https://www.vinaxmusic.online/api/ai/shares/ZZZZZZZZZZZZZZZZZZZZZZ', { headers: { 'cf-connecting-ip': '198.51.100.251' } }), env, ctx);
    expect(read.status).toBe(404);
    expect(read.headers.get('x-robots-tag')).toMatch(/noindex/);
    const cont = await worker.fetch(new Request('https://www.vinaxmusic.online/api/ai/shares/ZZZZZZZZZZZZZZZZZZZZZZ/continue', { method: 'POST', headers: { 'cf-connecting-ip': '198.51.100.252' } }), env, ctx);
    expect(cont.status).toBe(401);
  });
});
