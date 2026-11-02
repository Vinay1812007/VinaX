/**
 * VinaX AI — the artifacts gallery: the list is the signed-in account's own
 * artifacts (newest version per id per chat, deleted chats left out), by kind,
 * by title and in pages; one artifact comes with every version's content, only
 * for its owner. The list's SQL (ai_artifact_list) is proven in check.sql;
 * here the fake database answers it with the same rules, from its tables.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import worker from '../index';
import { onRequestGet as listGet } from '../functions/api/ai/artifacts';
import { onRequestGet as oneGet } from '../functions/api/ai/artifacts/[id]';
import { issueSession } from '../functions/_lib/googleAuth';
import { resetSettingsMemo } from '../functions/_lib/settings';
import { _resetRateLimitsForTests } from '../functions/_lib/ratelimit';
import { decodeCursor, encodeCursor } from '../functions/_lib/ai/gallery';
import { DB_ENV, fakeDb, type DbCall, type FakeDb } from './helpers/fakeDb';

const ENV = { GOOGLE_CLIENT_ID: 'x.apps.googleusercontent.com', AUTH_SECRET: 'auth-secret', ...DB_ENV };
const C1 = '11111111-1111-4111-8111-111111111111';
const C2 = '11111111-1111-4111-8111-111111111112';
const C3 = '11111111-1111-4111-8111-111111111113';
const C4 = '11111111-1111-4111-8111-111111111114';
const M = (n: number) => `22222222-2222-4222-8222-22222222222${n}`;
let ip = 0;

const conv = (id: string, account: string, title: string, deleted: string | null = null) => ({
  id, account_id: account, title, starred: false, model_pref: 'auto', active_leaf_id: null, created_at: '2026-10-30T10:00:00Z', updated_at: '2026-10-30T10:05:00Z', deleted_at: deleted,
});
const art = (id: string, type: string, title: string, content: string, extra: Record<string, unknown> = {}) => ({ id, type, title, language: null, content, incomplete: false, ...extra });
const reply = (id: string, conversation: string, at: string, artifacts: unknown) => ({ id, conversation_id: conversation, parent_id: null, role: 'assistant', content: [{ type: 'text', text: 'x' }], artifacts, created_at: at });

const MESSAGES = [
  reply(M(1), C1, '2026-10-30T10:00:01Z', [art('page', 'html', 'Landing page', '<h1>v1</h1>')]),
  reply(M(2), C1, '2026-10-30T10:00:02Z', null),
  reply(M(3), C1, '2026-10-30T10:00:03Z', [art('page', 'html', 'Landing page', '<h1>v2</h1>'), art('sort', 'code', 'Quick sort', 'def sort(): pass', { language: 'python' })]),
  reply(M(4), C2, '2026-10-30T10:00:04Z', [art('flow', 'mermaid', 'Login flow', 'graph TD; A-->B')]),
  reply(M(5), C3, '2026-10-30T10:00:05Z', [art('gone', 'svg', 'Deleted logo', '<svg/>')]),
  reply(M(6), C4, '2026-10-30T10:00:06Z', [art('theirs', 'react', 'Not yours', 'export default () => null')]),
];

/** The fake database's answer to ai_artifact_list: the same rules as the SQL in schema.sql. */
function answerList(fake: FakeDb) {
  fake.answer('rpc/ai_artifact_list', (call: DbCall) => {
    const a = call.body as { p_account: string; p_kind: string | null; p_query: string | null; p_before: string | null; p_before_key: string | null; p_limit: number };
    const convs = fake.rows('ai_conversations').filter((c) => c.account_id === a.p_account && c.deleted_at == null);
    const latest = new Map<string, Record<string, unknown>>();
    const counts = new Map<string, number>();
    for (const m of [...fake.rows('ai_messages')].sort((x, y) => String(x.created_at).localeCompare(String(y.created_at)))) {
      const c = convs.find((x) => x.id === m.conversation_id);
      if (!c || !Array.isArray(m.artifacts)) continue;
      for (const x of m.artifacts as Array<Record<string, unknown>>) {
        const key = `${c.id}/${x.id}`;
        counts.set(key, (counts.get(key) ?? 0) + 1);
        latest.set(key, { conversation_id: c.id, conversation_title: c.title, artifact_id: x.id, message_id: m.id, kind: x.type, title: x.title, language: x.language, incomplete: x.incomplete, created_at: m.created_at, key });
      }
    }
    const rows = [...latest.values()]
      .map((r): Record<string, unknown> => ({ ...r, versions: counts.get(String(r.key)) }))
      .filter((r) => !a.p_kind || r.kind === a.p_kind)
      .filter((r) => !a.p_query || String(r.title).toLowerCase().includes(a.p_query.toLowerCase()))
      .sort((x, y) => `${y.created_at}${y.key}`.localeCompare(`${x.created_at}${x.key}`))
      .filter((r) => !a.p_before || `${r.created_at}${r.key}` < `${a.p_before}${a.p_before_key}`)
      .slice(0, a.p_limit);
    return new Response(JSON.stringify(rows), { status: 200, headers: { 'content-type': 'application/json' } });
  });
}

const seed = () => {
  const fake = fakeDb({
    ai_conversations: [conv(C1, '1001', 'Website'), conv(C2, '1001', 'Auth'), conv(C3, '1001', 'Old', '2026-10-30T11:00:00Z'), conv(C4, '2002', 'Someone else')],
    ai_messages: MESSAGES.map((m) => ({ ...m })),
  });
  answerList(fake);
  return fake;
};

async function req(path: string, sub: string | null = '1001'): Promise<Request> {
  const token = sub ? await issueSession(ENV, sub) : null;
  return new Request(`https://www.vinaxmusic.online${path}`, {
    headers: { 'cf-connecting-ip': `198.51.100.${++ip % 250}`, ...(token ? { authorization: `Bearer ${token}` } : {}) },
  });
}

type Item = { conversationId: string; artifactId: string; messageId: string; kind: string; title: string; language: string | null; versions: number; conversationTitle: string };
const list = async (qs = '', sub?: string | null) => listGet({ request: await req(`/api/ai/artifacts${qs}`, sub), env: ENV });
const items = async (qs = '') => ((await (await list(qs)).json()) as { items: Item[]; nextCursor: string | null });

beforeEach(() => { _resetRateLimitsForTests(); resetSettingsMemo(); });
afterEach(() => vi.unstubAllGlobals());

describe('GET /api/ai/artifacts', () => {
  it('lists the account\'s artifacts newest first, one per artifact per chat, metadata only', async () => {
    const fake = seed();
    const body = await items();
    expect(body.items.map((i) => i.artifactId)).toEqual(['flow', 'sort', 'page']);
    const page = body.items.find((i) => i.artifactId === 'page')!;
    expect(page).toMatchObject({ conversationId: C1, conversationTitle: 'Website', messageId: M(3), kind: 'html', title: 'Landing page', versions: 2 });
    expect(body.items.find((i) => i.artifactId === 'sort')).toMatchObject({ kind: 'code', language: 'python', versions: 1 });
    expect(JSON.stringify(body)).not.toMatch(/<h1>|def sort|graph TD|account/);
    expect(body.nextCursor).toBeNull();
    // The account comes from the session, never from the request.
    const call = fake.calls.find((c) => c.table === 'rpc/ai_artifact_list')!;
    expect(call.body).toMatchObject({ p_account: '1001', p_kind: null, p_query: null, p_before: null });
  });

  it('leaves out deleted chats and other accounts\' chats', async () => {
    seed();
    const ids = (await items()).items.map((i) => i.artifactId);
    expect(ids).not.toContain('gone');
    expect(ids).not.toContain('theirs');
    const other = (await (await list('', '2002')).json()) as { items: Item[] };
    expect(other.items.map((i) => i.artifactId)).toEqual(['theirs']);
  });

  it('filters by kind and searches titles', async () => {
    const fake = seed();
    expect((await items('?kind=mermaid')).items.map((i) => i.artifactId)).toEqual(['flow']);
    expect((await items('?q=%20%20quick%20')).items.map((i) => i.artifactId)).toEqual(['sort']);
    expect((await items('?kind=html&q=landing')).items.map((i) => i.artifactId)).toEqual(['page']);
    expect((await items('?q=nothing')).items).toEqual([]);
    expect(fake.calls.filter((c) => c.table === 'rpc/ai_artifact_list').map((c) => (c.body as { p_query: string | null }).p_query)).toEqual([null, 'quick', 'landing', 'nothing']);
    expect((await list('?kind=video')).status).toBe(400);
  });

  it('pages with a cursor until the end', async () => {
    const { GALLERY_PAGE } = await import('../functions/_lib/ai/gallery');
    const many = Array.from({ length: GALLERY_PAGE + 5 }, (_, i) =>
      reply(`33333333-3333-4333-8333-${String(i).padStart(12, '0')}`, C2, `2026-10-31T10:00:${String(i % 60).padStart(2, '0')}.${String(i).padStart(3, '0')}Z`, [art(`chart-${i}`, 'svg', `Chart ${i}`, '<svg/>')]));
    const fake = seed();
    fake.rows('ai_messages').push(...many);
    const first = await items();
    expect(first.items).toHaveLength(GALLERY_PAGE);
    expect(first.nextCursor).toBeTruthy();
    const second = await items(`?cursor=${encodeURIComponent(first.nextCursor!)}`);
    expect(second.nextCursor).toBeNull();
    const all = [...first.items, ...second.items].map((i) => `${i.conversationId}/${i.artifactId}`);
    expect(new Set(all).size).toBe(all.length);
    expect(all).toHaveLength(GALLERY_PAGE + 5 + 3);
    expect((await list('?cursor=nonsense')).status).toBe(400);
  });

  it('signed out is 401; a database that fails is 503', async () => {
    seed();
    expect((await list('', null)).status).toBe(401);
    const fake = seed();
    fake.answer('rpc/ai_artifact_list', () => new Response('{"message":"down"}', { status: 503 }));
    expect((await list()).status).toBe(503);
  });
});

describe('the cursor', () => {
  it('round-trips and refuses anything else', () => {
    const c = encodeCursor('2026-10-30T10:00:03.123456+00:00', `${C1}/page`);
    expect(decodeCursor(c)).toEqual({ at: '2026-10-30T10:00:03.123456+00:00', key: `${C1}/page` });
    for (const bad of ['', 'x~y', `nope~${C1}/page`, `2026-10-30T10:00:03Z~${C1}`, `2026-10-30T10:00:03Z~${C1}/Bad Id`, `2026-10-30T10:00:03Z~${C1}/a/b`]) expect(decodeCursor(bad)).toBeNull();
  });
});

describe('GET /api/ai/artifacts/:conversationId/:artifactId', () => {
  const one = async (key: string, sub?: string | null) => oneGet({ request: await req(`/api/ai/artifacts/${key}`, sub), env: ENV, params: { id: key } });

  it('gives every version with its content, oldest first', async () => {
    seed();
    const res = await one(`${C1}/page`);
    expect(res.status).toBe(200);
    const { artifact } = (await res.json()) as { artifact: { conversationId: string; conversationTitle: string; artifactId: string; versions: Array<{ messageId: string; content: string; type: string; title: string }> } };
    expect(artifact).toMatchObject({ conversationId: C1, conversationTitle: 'Website', artifactId: 'page' });
    expect(artifact.versions.map((v) => [v.messageId, v.content])).toEqual([[M(1), '<h1>v1</h1>'], [M(3), '<h1>v2</h1>']]);
    expect(artifact.versions[0]).toMatchObject({ type: 'html', title: 'Landing page' });
  });

  it('someone else\'s chat, a deleted chat, an unknown artifact or a bad key is 404; signed out is 401', async () => {
    seed();
    expect((await one(`${C4}/theirs`)).status).toBe(404);
    expect((await one(`${C3}/gone`)).status).toBe(404);
    expect((await one(`${C1}/nope`)).status).toBe(404);
    expect((await one(`not-a-uuid/page`)).status).toBe(404);
    expect((await one(`${C1}/Bad Id`)).status).toBe(404);
    expect((await one(`${C1}`)).status).toBe(404);
    expect((await one(`${C1}/page`, null)).status).toBe(401);
  });

  it('the Worker routes both ids to it, and the list path to the list', async () => {
    seed();
    const ctx = { waitUntil: () => undefined };
    const env = { ...ENV, ASSETS_HOST: 'vinax.pages.dev' };
    const res = await worker.fetch(await req(`/api/ai/artifacts/${C1}/sort`), env, ctx);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { artifact: { versions: Array<{ content: string; language: string }> } }).artifact.versions).toEqual([
      expect.objectContaining({ content: 'def sort(): pass', language: 'python' }),
    ]);
    const all = await worker.fetch(await req('/api/ai/artifacts?kind=code'), env, ctx);
    expect(((await all.json()) as { items: Item[] }).items.map((i) => i.artifactId)).toEqual(['sort']);
  });
});
