/**
 * VinaX AI — memory across chats: the sensitive filter, reading the
 * learning model's answer, the <memory> block and where it sits in the
 * prompt, the chat route reading and learning (and not, when incognito,
 * switched off or turned off by the owner), the owner-only routes, and
 * shared chats never carrying memory.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import worker from '../index';
import { onRequestPost as chatPost } from '../functions/api/ai/chat';
import { onRequestDelete as forgetAll, onRequestGet as listGet, onRequestPost as addPost } from '../functions/api/ai/memories';
import { onRequestDelete as deleteOne } from '../functions/api/ai/memories/[id]';
import { onRequestGet as prefsGet, onRequestPut as prefsPut } from '../functions/api/ai/memories/prefs';
import { onRequestGet as conversationGet } from '../functions/api/ai/conversations/[id]';
import { onRequestPost as sharePost } from '../functions/api/ai/shares';
import {
  asksToRemember, cleanMemoryText, learnInput, LEARN_EVERY, LEARN_PROMPT, looksSensitive, MEMORY_MAX_CHARS, MEMORY_MAX_ITEMS, memoryBlock,
  ownerAllowsMemory, parseLearnAnswer, replyForLearning, shouldLearn,
} from '../functions/_lib/ai/memory';
import { buildSystemPrompt, type PromptVars } from '../functions/_lib/ai/prompt';
import { MODELS, modelById } from '../functions/_lib/ai/models';
import { issueSession } from '../functions/_lib/googleAuth';
import { resetSettingsMemo } from '../functions/_lib/settings';
import { _resetRateLimitsForTests } from '../functions/_lib/ratelimit';
import { _resetCooldowns } from '../functions/_lib/ai/cooldown';
import { DB_ENV, fakeDb, type FakeDb } from './helpers/fakeDb';
import { openAiSse, readEvents, sseResponse } from './helpers/aiStreams';

const BASE = { GOOGLE_CLIENT_ID: 'x.apps.googleusercontent.com', AUTH_SECRET: 'auth-secret', ...DB_ENV };
const ENV = { ...BASE, GROQ_API_KEY: 'gsk_test', GEMINI_API_KEY: 'gem_test', NVIDIA_API_KEY: 'nv_test' };
const CONV = '11111111-1111-4111-8111-111111111111';
const U1 = '22222222-2222-4222-8222-222222222221';
const A1 = '22222222-2222-4222-8222-222222222222';
const U2 = '22222222-2222-4222-8222-222222222223';
const A2 = '22222222-2222-4222-8222-222222222224';
const N1 = '33333333-3333-4333-8333-333333333331';
const N2 = '33333333-3333-4333-8333-333333333332';
const N3 = '33333333-3333-4333-8333-333333333333';
let ip = 0;
let pending: Array<Promise<unknown>> = [];

const note = (id: string, account: string, text: string, extra: Record<string, unknown> = {}) => ({
  id, account_id: account, text, origin: 'chat', conversation_id: null, created_at: `2026-10-30T10:00:0${id.slice(-1)}Z`, updated_at: '2026-10-30T10:00:00Z', ...extra,
});
const NOTES = [note(N1, '1001', 'Is learning Carnatic vocals'), note(N2, '1001', 'Prefers answers in Telugu', { origin: 'user' }), note(N3, '2002', 'Someone else entirely')];

const conv = (extra: Record<string, unknown> = {}) => ({
  id: CONV, account_id: '1001', title: 'Ragas', starred: false, model_pref: 'auto', active_leaf_id: A2, created_at: '2026-10-30T10:00:00Z', updated_at: '2026-10-30T10:00:00Z', deleted_at: null, ...extra,
});
/** Two finished turns, so the next message is the third. */
const TWO_TURNS = [
  { id: U1, conversation_id: CONV, parent_id: null, role: 'user', content: [{ type: 'text', text: 'I am a backend developer.' }], created_at: '2026-10-30T10:00:00Z' },
  { id: A1, conversation_id: CONV, parent_id: U1, role: 'assistant', content: [{ type: 'text', text: 'Nice.' }], created_at: '2026-10-30T10:00:01Z' },
  { id: U2, conversation_id: CONV, parent_id: A1, role: 'user', content: [{ type: 'text', text: 'What is a raga?' }], created_at: '2026-10-30T10:00:02Z' },
  { id: A2, conversation_id: CONV, parent_id: U2, role: 'assistant', content: [{ type: 'text', text: 'A melodic framework.' }], created_at: '2026-10-30T10:00:03Z' },
];

type Upstream = (url: string, init?: RequestInit) => Response | Promise<Response>;
const isLearn = (init?: RequestInit) => String(init?.body ?? '').includes('You keep VinaX AI');
const isTitle = (init?: RequestInit) => String(init?.body ?? '').includes('You write titles for chats');

interface Seen { chat: Array<{ messages: Array<{ role: string; content: string }> }>; learn: Array<{ messages: Array<{ role: string; content: string }> }> }

function seed(tables: Record<string, Array<Record<string, unknown>>> = {}, opts: { learnAnswer?: string; setting?: unknown } = {}): { fake: FakeDb; seen: Seen } {
  const seen: Seen = { chat: [], learn: [] };
  const upstream: Upstream = (_url, init) => {
    if (isTitle(init)) return sseResponse(openAiSse('Raga talk'));
    const body = JSON.parse(String(init?.body ?? '{}'));
    if (isLearn(init)) {
      seen.learn.push(body);
      return sseResponse(openAiSse(opts.learnAnswer ?? '{"add": [], "remove": []}'));
    }
    seen.chat.push(body);
    return sseResponse(openAiSse('Sure, noted.'));
  };
  const fake = fakeDb({
    accounts: [{ id: '1001', name: 'Asha Rao' }, { id: '2002', name: 'Bo' }],
    settings: [{ key: 'vinax-ai', value: opts.setting ?? { enabled: true }, updated_at: '2026-10-30T00:00:00Z', updated_by: 'owner' }],
    ai_memories: NOTES.map((n) => ({ ...n })),
    ...tables,
  }, upstream);
  return { fake, seen };
}

async function req(path: string, init: RequestInit & { sub?: string | null } = {}): Promise<Request> {
  const sub = init.sub === undefined ? '1001' : init.sub;
  const token = sub ? await issueSession(ENV, sub) : null;
  return new Request(`https://www.vinaxmusic.online${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', 'cf-connecting-ip': `198.51.100.${++ip % 250}`, ...(token ? { authorization: `Bearer ${token}` } : {}) },
  });
}

async function chat(body: Record<string, unknown>, sub = '1001'): Promise<Response> {
  const request = await req('/api/ai/chat', { method: 'POST', body: JSON.stringify({ mode: 'auto', timezone: 'Asia/Kolkata', locale: 'en-IN', ...body }), sub });
  return chatPost({ request, env: ENV as never, waitUntil: (p) => { pending.push(p); } });
}
const ask = (text: string, extra: Record<string, unknown> = {}) => ({ conversationId: null, content: [{ type: 'text', text }], ...extra });
const settle = async () => { await Promise.all(pending); pending = []; };
const systemOf = (seen: Seen) => seen.chat[0].messages[0].content;

beforeEach(() => { resetSettingsMemo(); _resetRateLimitsForTests(); _resetCooldowns(); pending = []; });
afterEach(() => vi.unstubAllGlobals());

describe('what memory keeps', () => {
  it('the sensitive filter catches secrets and contact details, and lets ordinary notes through', () => {
    for (const bad of [
      'Email is asha.rao@example.com', 'Phone +91 98765 43210', 'Card 4111 1111 1111 1111', 'Her OTP was 482913', 'Wi-Fi password is hunter2',
      'API key gsk_abcdefghijklmnop', 'Token ghp_1234567890abcdefABCDEF', 'Aadhaar 1234 5678 9012', 'Uses the PIN 4321 for the bank app', 'Login: q8Zr2kLmN7pX4vB9sT1wY6cD',
    ]) expect(looksSensitive(bad), bad).toBe(true);
    for (const ok of ['Is learning Carnatic vocals', 'Prefers answers in Telugu', 'Works as a backend developer', 'Has played guitar since 2010', 'Loves 90s Tamil film music']) {
      expect(looksSensitive(ok), ok).toBe(false);
    }
  });

  it('notes are plain text of at most 200 characters', () => {
    expect(cleanMemoryText('  - <b>Plays</b>\n the `veena`  ')).toBe('b Plays /b the veena');
    expect(cleanMemoryText('x'.repeat(500))!.length).toBe(MEMORY_MAX_CHARS);
    expect(cleanMemoryText('   ')).toBeNull();
    expect(cleanMemoryText(42)).toBeNull();
  });

  it('reads the learning answer: adds cleaned, deduplicated, filtered and capped; removes matched by id or exact text', () => {
    const current = [{ id: N1, text: 'Is learning Carnatic vocals' }, { id: N2, text: 'Prefers answers in Telugu' }];
    const out = parseLearnAnswer({
      add: ['Works as a backend developer', 'works as a backend developer!', 'Is learning Carnatic vocals', 'Email is a@b.co', 42, '', 'A', 'B', 'C', 'D', 'E'],
      remove: [N2, 'is learning carnatic vocals', 'not-a-note', 7],
    }, current);
    expect(out.remove).toEqual([N2, N1]);
    // Removing the Carnatic note lets it be added again (an update), the duplicate and the email are dropped, five at most.
    expect(out.add).toEqual(['Works as a backend developer', 'Is learning Carnatic vocals', 'A', 'B', 'C']);
    expect(parseLearnAnswer('nonsense', current)).toEqual({ add: [], remove: [] });
    expect(parseLearnAnswer([1, 2], current)).toEqual({ add: [], remove: [] });
  });

  it('learns every third message, and on the turn the user asks to remember or forget', () => {
    expect(LEARN_EVERY).toBe(3);
    expect([1, 2, 3, 4, 5, 6].map((n) => shouldLearn(n, 'hello'))).toEqual([false, false, true, false, false, true]);
    expect(shouldLearn(1, 'Please remember that I sing')).toBe(true);
    expect(asksToRemember("Forget that I'm vegetarian")).toBe(true);
    expect(asksToRemember('Note that I prefer Hindi')).toBe(true);
    expect(asksToRemember('What is a raga?')).toBe(false);
  });

  it('the learning model reads the notes and the messages since the last learning point; artifacts and code by name only', () => {
    const path = [
      { role: 'user' as const, text: 'one' }, { role: 'assistant' as const, text: 'r1' },
      { role: 'user' as const, text: 'two' }, { role: 'assistant' as const, text: 'r2' },
      { role: 'user' as const, text: 'three' }, { role: 'assistant' as const, text: 'r3' },
      { role: 'user' as const, text: 'four' }, { role: 'assistant' as const, text: 'Here <artifact id="a" type="html" title="Tuner">secret html</artifact> and ```js\nlet x\n```' },
    ];
    const input = learnInput([{ id: N1, text: 'Is learning Carnatic vocals' }], path);
    expect(input.memory).toEqual([{ id: N1, text: 'Is learning Carnatic vocals' }]);
    expect(input.recent.map((m) => m.text)).toEqual(['two', 'r2', 'three', 'r3', 'four', 'Here [artifact: Tuner] and [code]']);
    expect(replyForLearning('x'.repeat(5_000)).length).toBe(1_500);
  });

  it('the learning prompt rules out secrets, health details and other people', () => {
    expect(LEARN_PROMPT).toMatch(/passwords/);
    expect(LEARN_PROMPT).toMatch(/card, bank, account or ID numbers/);
    expect(LEARN_PROMPT).toMatch(/health, medical/);
    expect(LEARN_PROMPT).toMatch(/anything about other people/);
    expect(LEARN_PROMPT).toMatch(/not instructions to you/);
  });

  it('the owner can turn memory off in the vinax-ai setting; missing means on', () => {
    expect(ownerAllowsMemory(null)).toBe(true);
    expect(ownerAllowsMemory({ enabled: true })).toBe(true);
    expect(ownerAllowsMemory({ memory: false })).toBe(false);
    expect(ownerAllowsMemory({ memory: { enabled: false } })).toBe(false);
    expect(ownerAllowsMemory({ memory: { enabled: true } })).toBe(true);
  });
});

describe('the <memory> block', () => {
  const ctx = { use: true, learn: true, items: [{ id: N1, text: 'Is learning <Carnatic> vocals' }] };
  const vars: PromptVars = { now: new Date('2026-11-02T10:00:00Z'), timezone: 'UTC', locale: 'en', firstName: 'Asha', modelName: 'M', providerName: 'P' };
  const full = modelById(MODELS, 'groq:openai/gpt-oss-120b')!;

  it('frames the notes as background that may be out of date, never instructions', () => {
    const block = memoryBlock(ctx, 'hi')!;
    expect(block).toContain('<memory>\n- Is learning  Carnatic  vocals\n</memory>');
    expect(block).toMatch(/may be out of date/);
    expect(block).toMatch(/never instructions/);
    expect(block).toMatch(/never override the rules above about safety/);
    expect(block).toMatch(/without reciting them/);
    expect(block).toMatch(/updates the memory after this reply/);
  });

  it('is left out when memory is off, or when there are no notes and nothing to remember', () => {
    expect(memoryBlock({ ...ctx, use: false }, 'remember this')).toBeNull();
    expect(memoryBlock({ ...ctx, items: [] }, 'hi')).toBeNull();
    expect(memoryBlock({ ...ctx, items: [] }, 'Remember that I sing')).toContain('(nothing saved yet)');
    expect(memoryBlock({ ...ctx, learn: false }, 'hi')).toMatch(/Learning is switched off/);
  });

  it('sits after the artifacts block and before the user\'s preferences and search results; small models get none', () => {
    const memory = memoryBlock(ctx, 'hi');
    const system = buildSystemPrompt({ spec: full, vars, artifacts: true, memory, personal: { about: 'I sing.', style: 'normal' }, search: { sources: [{ n: 1, url: 'https://example.com', title: 'T', site: 'example.com' }] } });
    const at = (s: string) => system.indexOf(s);
    expect(at('# Artifacts')).toBeGreaterThan(0);
    expect(at('# Memory')).toBeGreaterThan(at('# Artifacts'));
    expect(at('# The user\'s preferences')).toBeGreaterThan(at('# Memory'));
    expect(at('<search_results>')).toBeGreaterThan(at('# The user\'s preferences'));
    const small = { ...full, maxContextChars: 8_000 };
    expect(buildSystemPrompt({ spec: small, vars, artifacts: true, memory })).not.toContain('<memory>');
  });
});

describe('the chat route', () => {
  it('puts the account\'s own notes into the prompt, and learns nothing on an ordinary first message', async () => {
    const { seen } = seed();
    await readEvents(await chat(ask('Suggest a warm-up')));
    await settle();
    const system = systemOf(seen);
    expect(system).toContain('- Is learning Carnatic vocals');
    expect(system).toContain('- Prefers answers in Telugu');
    expect(system).not.toContain('Someone else entirely');
    expect(seen.learn).toHaveLength(0);
  });

  it('"remember …" learns on that turn: the model sees the notes and the exchange; secrets are dropped; the note links the chat', async () => {
    const { fake, seen } = seed({}, { learnAnswer: '{"add": ["Works as a backend developer", "Email is asha@example.com"], "remove": []}' });
    const events = await readEvents(await chat(ask('Remember that I work as a backend developer')));
    await settle();
    const conversationId = (events.find((e) => e.event === 'meta')!.data as { conversationId: string }).conversationId;
    expect(seen.learn).toHaveLength(1);
    const learnBody = JSON.stringify(seen.learn[0]);
    expect(learnBody).toContain('Is learning Carnatic vocals');
    expect(learnBody).toContain('Remember that I work as a backend developer');
    expect(learnBody).toContain('Sure, noted.');
    expect(learnBody).not.toContain('Someone else entirely');
    const mine = fake.rows('ai_memories').filter((r) => r.account_id === '1001');
    expect(mine.map((r) => r.text)).toEqual(['Is learning Carnatic vocals', 'Prefers answers in Telugu', 'Works as a backend developer']);
    expect(mine[2]).toMatchObject({ origin: 'chat', conversation_id: conversationId });
  });

  it('"forget …" removes the note the model names', async () => {
    const { fake } = seed({}, { learnAnswer: `{"add": [], "remove": ["${N2}", "${N3}"]}` });
    await readEvents(await chat(ask('Forget that I prefer Telugu')));
    await settle();
    // Only the account's own note can go, even when a model names another one.
    expect(fake.rows('ai_memories').map((r) => r.id)).toEqual([N1, N3]);
  });

  it('learns on the third message of a chat, not the second', async () => {
    const { seen } = seed({ ai_conversations: [conv()], ai_messages: TWO_TURNS.map((m) => ({ ...m })) });
    await readEvents(await chat({ ...ask('And Yaman?'), conversationId: CONV }));
    await settle();
    expect(seen.learn).toHaveLength(1);
    expect(JSON.stringify(seen.learn[0])).toContain('I am a backend developer.');

    const two = seed({ ai_conversations: [conv({ active_leaf_id: A1 })], ai_messages: TWO_TURNS.slice(0, 2).map((m) => ({ ...m })) });
    await readEvents(await chat({ ...ask('And Yaman?'), conversationId: CONV }));
    await settle();
    expect(two.seen.learn).toHaveLength(0);
  });

  it('a retry does not learn again', async () => {
    const { seen } = seed({ ai_conversations: [conv()], ai_messages: TWO_TURNS.map((m) => ({ ...m })) });
    await readEvents(await chat({ conversationId: CONV, parentMessageId: U2, content: [] }));
    await settle();
    expect(seen.chat).toHaveLength(1);
    expect(seen.learn).toHaveLength(0);
  });

  it('an incognito chat neither reads nor writes memory, and stays incognito', async () => {
    const { fake, seen } = seed({}, { learnAnswer: '{"add": ["Sings in a choir"], "remove": []}' });
    const events = await readEvents(await chat(ask('Remember that I sing in a choir', { incognito: true })));
    await settle();
    expect(systemOf(seen)).not.toContain('<memory>');
    expect(seen.learn).toHaveLength(0);
    const conversationId = (events.find((e) => e.event === 'meta')!.data as { conversationId: string }).conversationId;
    expect(fake.rows('ai_conversations').find((c) => c.id === conversationId)).toMatchObject({ incognito: true });
    expect(fake.rows('ai_memories')).toHaveLength(3);

    // The next message, without the flag, is still incognito.
    seen.chat.length = 0;
    await readEvents(await chat({ ...ask('Remember that I sing'), conversationId }));
    await settle();
    expect(systemOf(seen)).not.toContain('<memory>');
    expect(seen.learn).toHaveLength(0);

    const got = await conversationGet({ request: await req(`/api/ai/conversations/${conversationId}`), env: ENV as never, params: { id: conversationId } });
    expect(((await got.json()) as { conversation: { incognito?: boolean } }).conversation.incognito).toBe(true);
  });

  it('"Use memory" off: no notes in the prompt and nothing learned', async () => {
    const { seen } = seed({ ai_memory_prefs: [{ account_id: '1001', use_memory: false, learn: true }] });
    await readEvents(await chat(ask('Remember that I sing')));
    await settle();
    expect(systemOf(seen)).not.toContain('<memory>');
    expect(seen.learn).toHaveLength(0);
  });

  it('"Learn from my chats" off: notes are used, nothing is learned, and the model is told to point to settings', async () => {
    const { seen } = seed({ ai_memory_prefs: [{ account_id: '1001', use_memory: true, learn: false }] });
    await readEvents(await chat(ask('Remember that I sing')));
    await settle();
    expect(systemOf(seen)).toContain('- Is learning Carnatic vocals');
    expect(systemOf(seen)).toMatch(/Learning is switched off/);
    expect(seen.learn).toHaveLength(0);
  });

  it('the owner\'s switch turns memory off for everyone', async () => {
    const { seen } = seed({}, { setting: { enabled: true, memory: false } });
    await readEvents(await chat(ask('Remember that I sing')));
    await settle();
    expect(systemOf(seen)).not.toContain('<memory>');
    expect(seen.learn).toHaveLength(0);
  });

  it('a failed memory read fails closed: the reply still comes, without memory', async () => {
    const { fake, seen } = seed();
    fake.answer('ai_memories', () => new Response('{"message":"boom"}', { status: 500 }));
    const events = await readEvents(await chat(ask('Remember that I sing')));
    await settle();
    expect(events.at(-1)!.event).toBe('done');
    expect(systemOf(seen)).not.toContain('<memory>');
    expect(seen.learn).toHaveLength(0);
  });

  it('a shared chat never carries memory', async () => {
    const { fake } = seed();
    const events = await readEvents(await chat(ask('Suggest a warm-up')));
    await settle();
    const conversationId = (events.find((e) => e.event === 'meta')!.data as { conversationId: string }).conversationId;
    const res = await sharePost({ request: await req('/api/ai/shares', { method: 'POST', body: JSON.stringify({ conversationId }) }), env: ENV as never });
    expect(res.status).toBe(201);
    const share = JSON.stringify(fake.rows('ai_shares'));
    expect(share).toContain('Suggest a warm-up');
    expect(share).not.toMatch(/Carnatic|Telugu|<memory>/);
  });
});

describe('the memory routes', () => {
  const get = async (sub?: string | null) => listGet({ request: await req('/api/ai/memories', { sub }), env: ENV as never });
  const add = async (text: unknown, sub?: string) => addPost({ request: await req('/api/ai/memories', { method: 'POST', body: JSON.stringify({ text }), sub }), env: ENV as never });

  it('GET lists the account\'s own notes with the switches (on by default); signed out is 401', async () => {
    seed();
    const res = await get();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { enabled: boolean; prefs: unknown; items: Array<Record<string, unknown>>; max: number };
    expect(body.enabled).toBe(true);
    expect(body.prefs).toEqual({ use: true, learn: true });
    expect(body.max).toBe(MEMORY_MAX_ITEMS);
    expect(body.items.map((i) => i.text)).toEqual(['Is learning Carnatic vocals', 'Prefers answers in Telugu']);
    expect(body.items[1]).toEqual({ id: N2, text: 'Prefers answers in Telugu', origin: 'user', createdAt: expect.any(String) });
    expect(JSON.stringify(body)).not.toContain('account_id');
    expect((await get(null)).status).toBe(401);
  });

  it('POST adds a note (201), the same note again is 200, secrets are 422, empty is 400, past the cap is 409', async () => {
    const { fake } = seed();
    const made = await add('  Plays the <veena>  ');
    expect(made.status).toBe(201);
    expect(((await made.json()) as { item: { text: string; origin: string } }).item).toMatchObject({ text: 'Plays the veena', origin: 'user' });
    expect((await add('plays the veena')).status).toBe(200);
    expect(await (await add('My password is hunter2')).json()).toEqual({ error: 'sensitive' });
    expect((await add('   ')).status).toBe(400);
    expect(fake.rows('ai_memories').filter((r) => r.account_id === '1001')).toHaveLength(3);
    fake.tables.ai_memories = Array.from({ length: MEMORY_MAX_ITEMS }, (_, i) => note(`44444444-4444-4444-8444-${String(i).padStart(12, '0')}`, '1001', `Note ${i}`));
    expect(await (await add('One more')).json()).toEqual({ error: 'full' });
  });

  it('POST is refused while the owner has memory off; seeing and deleting still work', async () => {
    seed({}, { setting: { enabled: true, memory: false } });
    expect(await (await add('Plays the veena')).json()).toEqual({ error: 'memory_off' });
    expect(((await (await get()).json()) as { enabled: boolean }).enabled).toBe(false);
    const del = await deleteOne({ request: await req(`/api/ai/memories/${N1}`, { method: 'DELETE' }), env: ENV as never, params: { id: N1 } });
    expect(del.status).toBe(200);
  });

  it('DELETE one removes only the account\'s own note', async () => {
    const { fake } = seed();
    const del = async (id: string) => deleteOne({ request: await req(`/api/ai/memories/${id}`, { method: 'DELETE' }), env: ENV as never, params: { id } });
    expect((await del(N3)).status).toBe(404);
    expect((await del('nope')).status).toBe(404);
    expect((await del(N1)).status).toBe(200);
    expect(fake.rows('ai_memories').map((r) => r.id)).toEqual([N2, N3]);
  });

  it('DELETE all forgets every note of the account and no one else\'s', async () => {
    const { fake } = seed();
    const res = await forgetAll({ request: await req('/api/ai/memories', { method: 'DELETE' }), env: ENV as never });
    expect(await res.json()).toEqual({ ok: true, removed: 2 });
    expect(fake.rows('ai_memories').map((r) => r.id)).toEqual([N3]);
  });

  it('PUT prefs changes one switch at a time and keeps the other; bad bodies are 400', async () => {
    const { fake } = seed();
    const put = async (body: unknown) => prefsPut({ request: await req('/api/ai/memories/prefs', { method: 'PUT', body: JSON.stringify(body) }), env: ENV as never });
    expect(await (await put({ learn: false })).json()).toEqual({ prefs: { use: true, learn: false } });
    expect(fake.rows('ai_memory_prefs')).toEqual([expect.objectContaining({ account_id: '1001', use_memory: true, learn: false })]);
    expect(await (await put({ use: false })).json()).toEqual({ prefs: { use: false, learn: false } });
    expect((await put({})).status).toBe(400);
    expect((await put({ use: 'yes' })).status).toBe(400);
    expect((await put([true])).status).toBe(400);
    const got = await prefsGet({ request: await req('/api/ai/memories/prefs'), env: ENV as never });
    expect(await got.json()).toEqual({ prefs: { use: false, learn: false } });
  });

  it('the routes are registered in the Worker', async () => {
    seed();
    const env = { ...ENV, ASSETS_HOST: 'vinax.pages.dev' };
    const ctx = { waitUntil: () => undefined };
    for (const [path, method] of [['/api/ai/memories', 'GET'], ['/api/ai/memories/prefs', 'PUT'], [`/api/ai/memories/${N1}`, 'DELETE']] as const) {
      const res = await worker.fetch(new Request(`https://www.vinaxmusic.online${path}`, { method, headers: { 'cf-connecting-ip': `198.51.100.${++ip % 250}` } }), env, ctx);
      expect(res.status, path).toBe(401);
    }
  });
});
