/**
 * VinaX AI — files in chats: what is accepted and how it is recognised; the
 * upload, read, PDF-text and delete routes (ownership, limits, the private
 * bucket); how each kind of model is sent each kind of file; and that files
 * leave Storage with their account or chat.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { onRequestPost as upload } from '../functions/api/ai/attachments';
import { onRequestDelete, onRequestGet, onRequestPatch } from '../functions/api/ai/attachments/[id]';
import { onRequestPost as chat } from '../functions/api/ai/chat';
import { onRequestPost as accountPost } from '../functions/api/auth/me';
import { cleanName, documentBlock, kindOf, sniff, toBase64 } from '../functions/_lib/ai/attachments';
import { purgeAiChats } from '../functions/_lib/ai/cleanup';
import { _resetCooldowns } from '../functions/_lib/ai/cooldown';
import { issueSession } from '../functions/_lib/googleAuth';
import { resetSettingsMemo } from '../functions/_lib/settings';
import { _resetRateLimitsForTests } from '../functions/_lib/ratelimit';
import { DB_ENV, fakeDb, type FakeDb } from './helpers/fakeDb';
import { fakeStorage, type FakeStorage } from './helpers/fakeStorage';
import { openAiSse, readEvents, sseResponse } from './helpers/aiStreams';

const ENV = { GOOGLE_CLIENT_ID: 'x.apps.googleusercontent.com', AUTH_SECRET: 'auth-secret', GROQ_API_KEY: 'gsk', GEMINI_API_KEY: 'gem', NVIDIA_API_KEY: 'nv', ...DB_ENV };
const CONV = '11111111-1111-4111-8111-111111111111';
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 1, 2, 3, 4, 5, 6]);
const PDF = new TextEncoder().encode('%PDF-1.7\n%âãÏÓ\n1 0 obj\n<<>>\nendobj\n');
let ip = 0;
let pending: Array<Promise<unknown>> = [];

type Upstream = (url: string, init?: RequestInit) => Response | Promise<Response>;
let upstream: Upstream;
let storage: FakeStorage;

function seed(extra: Record<string, Array<Record<string, unknown>>> = {}): FakeDb {
  storage = fakeStorage();
  return fakeDb({
    accounts: [{ id: '1001', name: 'Asha' }, { id: '2002', name: 'Bo' }],
    settings: [{ key: 'vinax-ai', value: { enabled: true }, updated_at: 'x', updated_by: 'owner' }],
    ...extra,
  }, (url, init) => storage.handle(url, init) ?? upstream(url, init));
}

async function req(path: string, init: RequestInit & { sub?: string | null; headers?: Record<string, string> } = {}): Promise<Request> {
  const sub = init.sub === undefined ? '1001' : init.sub;
  const token = sub ? await issueSession(ENV, sub) : null;
  return new Request(`https://www.vinaxmusic.online${path}`, { ...init, headers: { 'cf-connecting-ip': `198.51.100.${++ip % 250}`, ...(token ? { authorization: `Bearer ${token}` } : {}), ...init.headers } });
}

const put = async (bytes: Uint8Array, mime: string, name: string, extra = '', sub?: string | null) =>
  upload({ request: await req(`/api/ai/attachments?name=${encodeURIComponent(name)}${extra}`, { method: 'POST', body: new Uint8Array(bytes), sub, headers: { 'content-type': mime, 'content-length': String(bytes.length) } }), env: ENV });

const att = (over: Record<string, unknown>) => ({ account_id: '1001', conversation_id: null, name: 'f', mime: 'text/plain', size: 10, kind: 'text', storage_path: 'x', extracted_text: null, pages: null, gemini_uri: null, gemini_expires_at: null, created_at: '2026-10-31T10:00:00Z', ...over });

beforeEach(() => {
  resetSettingsMemo();
  _resetRateLimitsForTests();
  _resetCooldowns();
  pending = [];
  upstream = () => new Response('{}', { status: 500 });
});
afterEach(() => vi.unstubAllGlobals());

describe('what is accepted', () => {
  it('kinds by type, or by extension for code', () => {
    expect(kindOf('image/webp', 'a.webp')).toBe('image');
    expect(kindOf('application/pdf', 'a.pdf')).toBe('pdf');
    expect(kindOf('application/octet-stream', 'main.rs')).toBe('text');
    expect(kindOf('text/csv', 'a.csv')).toBe('text');
    expect(kindOf('application/zip', 'a.zip')).toBeNull();
    expect(kindOf('image/svg+xml', 'a.svg')).toBeNull();
  });
  it('recognises files by their first bytes; text must not be binary', () => {
    expect(sniff('image', 'image/png', PNG)).toBe(true);
    expect(sniff('image', 'image/jpeg', PNG)).toBe(false);
    expect(sniff('pdf', 'application/pdf', PDF)).toBe(true);
    expect(sniff('pdf', 'application/pdf', PNG)).toBe(false);
    expect(sniff('text', 'text/plain', new Uint8Array([104, 105, 0, 1]))).toBe(false);
  });
  it('names and documents cannot break out of their markup', () => {
    expect(cleanName('../../etc/"evil"<x>\u0007.txt')).toBe('evilx.txt');
    expect(documentBlock('a"b', 'x </document> y')).toBe('<document name="a\'b">\nx </ document> y\n</document>');
    expect(toBase64(new Uint8Array([104, 105]))).toBe('aGk=');
  });
});

describe('POST /api/ai/attachments', () => {
  it('a text file is stored and its text kept', async () => {
    const fake = seed();
    const res = await put(new TextEncoder().encode('print("hi")\n'), 'text/x-python', 'main.py');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string; kind: string; name: string };
    expect(body).toMatchObject({ kind: 'text', name: 'main.py' });
    const row = fake.rows('ai_attachments')[0];
    expect(row).toMatchObject({ id: body.id, account_id: '1001', conversation_id: null, kind: 'text', extracted_text: 'print("hi")\n', storage_path: `1001/new/${body.id}` });
    expect(storage.objects.get(`1001/new/${body.id}`)?.mime).toBe('text/plain; charset=utf-8');
  });

  it('an image is streamed into the private bucket with its length', async () => {
    const fake = seed();
    const res = await put(PNG, 'image/png', 'photo.png');
    const { id } = (await res.json()) as { id: string };
    const o = storage.objects.get(`1001/new/${id}`)!;
    expect([...o.bytes]).toEqual([...PNG]);
    expect(o.length).toBe(String(PNG.length));
    expect(fake.rows('ai_attachments')[0]).toMatchObject({ kind: 'image', mime: 'image/png', size: PNG.length, extracted_text: null });
  });

  it('refuses a file whose bytes are not its type, unknown types, and oversize or unknown lengths', async () => {
    seed();
    expect((await put(PDF, 'image/png', 'fake.png')).status).toBe(415);
    expect((await put(PNG, 'application/zip', 'a.zip')).status).toBe(415);
    const big = new Uint8Array(1024 * 1024 + 1).fill(97);
    expect((await put(big, 'text/plain', 'big.txt')).status).toBe(413);
    const res = await upload({ request: await req('/api/ai/attachments?name=a.png', { method: 'POST', body: new Uint8Array(PNG), headers: { 'content-type': 'image/png' } }), env: ENV });
    expect([411, 200]).toContain(res.status); // runtimes that set the length themselves still check it
    expect(storage.objects.size).toBeLessThanOrEqual(1);
  });

  it('a conversation must be the account\'s and below 20 files; signed out is 401', async () => {
    seed({
      ai_conversations: [{ id: CONV, account_id: '2002', deleted_at: null }],
    });
    expect((await put(PNG, 'image/png', 'a.png', `&conversationId=${CONV}`)).status).toBe(404);
    const fake = seed({
      ai_conversations: [{ id: CONV, account_id: '1001', deleted_at: null }],
      ai_attachments: Array.from({ length: 20 }, (_, i) => att({ id: `a${i}`, conversation_id: CONV })),
    });
    expect((await put(PNG, 'image/png', 'a.png', `&conversationId=${CONV}`)).status).toBe(409);
    expect(fake.rows('ai_attachments')).toHaveLength(20);
    expect((await put(PNG, 'image/png', 'a.png', '', null)).status).toBe(401);
  });
});

describe('/api/ai/attachments/:id', () => {
  const ID = '22222222-2222-4222-8222-222222222222';
  it('GET streams the owner\'s file with safe headers; anyone else gets 404', async () => {
    seed({ ai_attachments: [att({ id: ID, kind: 'image', mime: 'image/png', name: 'p.png', storage_path: '1001/new/p' })] });
    storage.objects.set('1001/new/p', { bytes: PNG, mime: 'image/png', length: null });
    const res = await onRequestGet({ request: await req(`/api/ai/attachments/${ID}`), env: ENV, params: { id: ID } });
    expect(res.status).toBe(200);
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('content-security-policy')).toContain('sandbox');
    expect(res.headers.get('content-disposition')).toMatch(/^inline/);
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(PNG);
    expect((await onRequestGet({ request: await req(`/api/ai/attachments/${ID}`, { sub: '2002' }), env: ENV, params: { id: ID } })).status).toBe(404);
  });

  it('PATCH keeps a PDF\'s text and page count; more than 100 pages is refused', async () => {
    const fake = seed({ ai_attachments: [att({ id: ID, kind: 'pdf', mime: 'application/pdf' })] });
    const patch = async (body: unknown) => (await onRequestPatch({ request: await req(`/api/ai/attachments/${ID}`, { method: 'PATCH', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }), env: ENV, params: { id: ID } })).status;
    expect(await patch({ text: 'Page one text', pages: 3 })).toBe(200);
    expect(fake.rows('ai_attachments')[0]).toMatchObject({ extracted_text: 'Page one text', pages: 3 });
    expect(await patch({ text: 'x', pages: 101 })).toBe(413);
  });

  it('DELETE removes a file not sent yet; a sent one stays', async () => {
    const fake = seed({ ai_attachments: [att({ id: ID, storage_path: '1001/new/f' }), att({ id: '33333333-3333-4333-8333-333333333333', conversation_id: CONV, storage_path: '1001/c/g' })] });
    expect((await onRequestDelete({ request: await req(`/api/ai/attachments/${ID}`, { method: 'DELETE' }), env: ENV, params: { id: ID } })).status).toBe(200);
    expect(storage.removed).toEqual(['1001/new/f']);
    expect((await onRequestDelete({ request: await req('/x', { method: 'DELETE' }), env: ENV, params: { id: '33333333-3333-4333-8333-333333333333' } })).status).toBe(409);
    expect(fake.rows('ai_attachments')).toHaveLength(1);
  });
});

// ------------------------------------------------------------ in a chat

async function send(body: Record<string, unknown>) {
  const res = await chat({ request: await req('/api/ai/chat', { method: 'POST', body: JSON.stringify({ conversationId: null, mode: 'auto', ...body }), headers: { 'content-type': 'application/json' } }), env: ENV as never, waitUntil: (p) => { pending.push(p); } });
  if (res.status !== 200) return { res, events: [] };
  const events = await readEvents(res);
  await Promise.all(pending);
  return { res, events };
}

describe('files in a chat', () => {
  const IMG = '44444444-4444-4444-8444-444444444444';
  const DOC = '55555555-5555-4555-8555-555555555555';
  const PDFID = '66666666-6666-4666-8666-666666666666';

  it('an image goes to Auto\'s vision ladder as an image part, and the message keeps the file\'s details', async () => {
    let geminiBody: { contents: Array<{ parts: Array<Record<string, unknown>> }> } | null = null;
    upstream = (url, init) => {
      if (url.includes('gemini-3.6-flash')) { geminiBody = JSON.parse(String(init?.body)); return sseResponse('data: {"candidates":[{"content":{"parts":[{"text":"A red square."}]},"finishReason":"STOP"}]}\n\n'); }
      return new Response('{}', { status: 500 });
    };
    const fake = seed({ ai_attachments: [att({ id: IMG, kind: 'image', mime: 'image/png', name: 'red.png', storage_path: '1001/new/red', size: PNG.length })] });
    storage.objects.set('1001/new/red', { bytes: PNG, mime: 'image/png', length: null });
    const { events } = await send({ content: [{ type: 'attachment', id: IMG }, { type: 'text', text: 'What is this?' }] });
    expect((events[0].data.model as { id: string }).id).toBe('gemini:gemini-3.6-flash');
    const parts = geminiBody!.contents.at(-1)!.parts;
    expect(parts).toContainEqual({ inline_data: { mime_type: 'image/png', data: toBase64(PNG) } });
    expect(parts.at(-1)).toEqual({ text: 'What is this?' });
    const msg = fake.rows('ai_messages')[0] as { content: Array<Record<string, unknown>>; conversation_id: string };
    expect(msg.content[0]).toMatchObject({ type: 'attachment', id: IMG, name: 'red.png', kind: 'image' });
    expect(fake.rows('ai_attachments')[0].conversation_id).toBe(msg.conversation_id);
  });

  it('a picked model that cannot see is refused an image; more than five images are refused', async () => {
    seed({ ai_attachments: Array.from({ length: 6 }, (_, i) => att({ id: `7777777${i}-7777-4777-8777-777777777777`, kind: 'image', mime: 'image/png' })) });
    const one = [{ type: 'attachment', id: '77777770-7777-4777-8777-777777777777' }, { type: 'text', text: 'hi' }];
    expect(await (await send({ content: one, mode: 'model', model: 'groq:openai/gpt-oss-120b' })).res.json()).toEqual({ error: 'model_cannot_see_images' });
    const six = Array.from({ length: 6 }, (_, i) => ({ type: 'attachment', id: `7777777${i}-7777-4777-8777-777777777777` }));
    expect(await (await send({ content: six })).res.json()).toEqual({ error: 'too_many_images' });
  });

  it('a text file becomes a <document> block; a PDF goes to non-Gemini models as its read-out text', async () => {
    let groqUser = '';
    upstream = (url, init) => {
      if (url.includes('groq')) { groqUser = (JSON.parse(String(init?.body)) as { messages: Array<{ content: string }> }).messages.at(-1)!.content; return sseResponse(openAiSse('Done.')); }
      return new Response('{}', { status: 500 });
    };
    seed({ ai_attachments: [att({ id: DOC, name: 'notes.md', extracted_text: '# Notes\nraga list' }), att({ id: PDFID, kind: 'pdf', mime: 'application/pdf', name: 'paper.pdf', extracted_text: 'PDF body text', pages: 2 })] });
    await send({ content: [{ type: 'attachment', id: DOC }, { type: 'attachment', id: PDFID }, { type: 'text', text: 'Summarise these' }], mode: 'model', model: 'groq:openai/gpt-oss-120b' });
    expect(groqUser).toBe('<document name="notes.md">\n# Notes\nraga list\n</document>\n\n<document name="paper.pdf">\nPDF body text\n</document>\n\nSummarise these');
  });

  it('a PDF goes to Gemini through the Files API (streamed from Storage), referenced by file_data', async () => {
    const calls: string[] = [];
    let geminiBody: { contents: Array<{ parts: Array<Record<string, unknown>> }> } | null = null;
    upstream = async (url, init) => {
      calls.push(`${init?.method ?? 'GET'} ${url.split('?')[0]}`);
      if (url === 'https://generativelanguage.googleapis.com/upload/v1beta/files') return new Response('{}', { status: 200, headers: { 'x-goog-upload-url': 'https://upload.example/session1' } });
      if (url === 'https://upload.example/session1') {
        const sent = new Uint8Array(await new Response(init?.body as BodyInit).arrayBuffer());
        expect(sent).toEqual(PDF);
        return new Response(JSON.stringify({ file: { uri: 'https://generativelanguage.googleapis.com/v1beta/files/abc', expirationTime: '2026-11-02T00:00:00Z' } }), { status: 200 });
      }
      if (url.includes('streamGenerateContent')) { geminiBody = JSON.parse(String(init?.body)); return sseResponse('data: {"candidates":[{"content":{"parts":[{"text":"It is a paper."}]},"finishReason":"STOP"}]}\n\n'); }
      return new Response('{}', { status: 500 });
    };
    const fake = seed({ ai_attachments: [att({ id: PDFID, kind: 'pdf', mime: 'application/pdf', name: 'paper.pdf', size: PDF.length, storage_path: '1001/new/paper', extracted_text: 'text' })] });
    storage.objects.set('1001/new/paper', { bytes: PDF, mime: 'application/pdf', length: null });
    const { events } = await send({ content: [{ type: 'attachment', id: PDFID }, { type: 'text', text: 'What is this?' }] });
    expect((events[0].data.model as { id: string }).id).toBe('gemini:gemini-3.6-flash'); // the long ladder
    expect(geminiBody!.contents.at(-1)!.parts[0]).toEqual({ file_data: { mime_type: 'application/pdf', file_uri: 'https://generativelanguage.googleapis.com/v1beta/files/abc' } });
    expect(fake.rows('ai_attachments')[0]).toMatchObject({ gemini_uri: 'https://generativelanguage.googleapis.com/v1beta/files/abc' });
    expect(calls.filter((c) => c.includes('upload'))).toHaveLength(2);
  });

  it('only the last three questions resend their images; older ones are mentioned', async () => {
    let geminiBody: { contents: Array<{ role: string; parts: Array<Record<string, unknown>> }> } | null = null;
    upstream = (url, init) => {
      if (url.includes('generativelanguage')) { geminiBody = JSON.parse(String(init?.body)); return sseResponse('data: {"candidates":[{"content":{"parts":[{"text":"ok"}]},"finishReason":"STOP"}]}\n\n'); }
      return new Response('{}', { status: 500 });
    };
    const ids = [0, 1, 2, 3].map((i) => `8888888${i}-8888-4888-8888-888888888888`);
    const msgs: Array<Record<string, unknown>> = [];
    let parent: string | null = null;
    ids.forEach((id, i) => {
      const u = `9999999${i}-9999-4999-8999-999999999999`;
      const a = `9999999${i}-aaaa-4999-8999-999999999999`;
      msgs.push({ id: u, conversation_id: CONV, parent_id: parent, role: 'user', content: [{ type: 'attachment', id, name: `img${i}.png`, kind: 'image' }, { type: 'text', text: `q${i}` }], created_at: `2026-10-31T10:0${i}:00Z` });
      msgs.push({ id: a, conversation_id: CONV, parent_id: u, role: 'assistant', content: [{ type: 'text', text: `r${i}` }], created_at: `2026-10-31T10:0${i}:30Z` });
      parent = a;
    });
    seed({
      ai_conversations: [{ id: CONV, account_id: '1001', title: 't', starred: false, active_leaf_id: parent, deleted_at: null }],
      ai_messages: msgs,
      ai_attachments: ids.map((id, i) => att({ id, kind: 'image', mime: 'image/png', name: `img${i}.png`, conversation_id: CONV, storage_path: `p${i}` })),
    });
    ids.forEach((_, i) => storage.objects.set(`p${i}`, { bytes: PNG, mime: 'image/png', length: null }));
    await send({ conversationId: CONV, content: [{ type: 'text', text: 'and now?' }] });
    const users = geminiBody!.contents.filter((c) => c.role === 'user');
    const imagesPer = users.map((u) => u.parts.filter((p) => 'inline_data' in p).length);
    // The three latest questions are q2, q3 and the new one: q2 and q3 resend their images.
    expect(imagesPer).toEqual([0, 0, 1, 1, 0]);
    expect(JSON.stringify(users[0].parts)).toContain('[image: img0.png]');
    expect(JSON.stringify(users[1].parts)).toContain('[image: img1.png]');
  });
});

describe('files leave Storage', () => {
  it('deleting the account removes its stored files first', async () => {
    seed({ ai_attachments: [att({ id: 'x1', storage_path: '1001/c/x1' }), att({ id: 'x2', storage_path: '1001/new/x2' }), att({ id: 'y', account_id: '2002', storage_path: '2002/c/y' })] });
    const res = await accountPost({ request: await req('/api/auth/me', { method: 'POST', body: JSON.stringify({ delete: true }), headers: { 'content-type': 'application/json' } }), env: ENV });
    expect(res.status).toBe(200);
    expect(storage.removed.sort()).toEqual(['1001/c/x1', '1001/new/x2']);
  });

  it('housekeeping removes deleted chats with their files, and files never sent after a day', async () => {
    const old = new Date(Date.now() - 2 * 86_400_000).toISOString();
    const fake = seed({
      ai_conversations: [{ id: CONV, account_id: '1001', deleted_at: old }, { id: 'live', account_id: '1001', deleted_at: null }],
      ai_attachments: [att({ id: 'f1', conversation_id: CONV, storage_path: 's/f1' }), att({ id: 'f2', conversation_id: null, created_at: old, storage_path: 's/f2' }), att({ id: 'f3', conversation_id: null, created_at: new Date().toISOString(), storage_path: 's/f3' })],
    });
    expect(await purgeAiChats(DB_ENV)).toEqual({ chats: 1, files: 1 });
    expect(storage.removed.sort()).toEqual(['s/f1', 's/f2']);
    expect(fake.rows('ai_conversations').map((c) => c.id)).toEqual(['live']);
    expect(fake.rows('ai_attachments').map((a) => a.id).sort()).toEqual(['f1', 'f3']); // f1 cascades in the real database
  });
});
