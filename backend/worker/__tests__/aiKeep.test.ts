/**
 * VinaX AI — POST /api/ai/keep: the page saves the part of a reply it saw
 * when the stream did not end on its own (Stop, a cut-off stream).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { onRequestPost } from '../functions/api/ai/keep';
import { issueSession } from '../functions/_lib/googleAuth';
import { _resetRateLimitsForTests } from '../functions/_lib/ratelimit';
import { DB_ENV, fakeDb } from './helpers/fakeDb';

const ENV = { GOOGLE_CLIENT_ID: 'x.apps.googleusercontent.com', AUTH_SECRET: 'auth-secret', ...DB_ENV };
const CONV = '11111111-1111-4111-8111-111111111111';
const U1 = '22222222-2222-4222-8222-222222222221';
const A1 = '22222222-2222-4222-8222-222222222222';
const A2 = '22222222-2222-4222-8222-222222222223';

const seed = () => fakeDb({
  accounts: [{ id: '1001', name: 'Asha' }, { id: '2002', name: 'Bo' }],
  ai_conversations: [{ id: CONV, account_id: '1001', title: 'Kafka', starred: false, model_pref: 'auto', active_leaf_id: U1, created_at: '2026-11-11T10:00:00Z', updated_at: '2026-11-11T10:00:00Z', deleted_at: null }],
  ai_messages: [{ id: U1, conversation_id: CONV, parent_id: null, role: 'user', content: [{ type: 'text', text: 'Explain Kafka' }], created_at: '2026-11-11T10:00:00Z' }],
}, () => new Response('{}', { status: 500 }));

let ip = 0;
async function keep(body: Record<string, unknown>, sub = '1001'): Promise<Response> {
  const token = await issueSession(ENV as never, sub);
  return onRequestPost({
    request: new Request('https://www.vinaxmusic.online/api/ai/keep', { method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': `198.51.100.${++ip}`, authorization: `Bearer ${token}` }, body: JSON.stringify(body) }),
    env: ENV as never,
  });
}
const body = (extra: Record<string, unknown> = {}) => ({ conversationId: CONV, userMessageId: U1, assistantMessageId: A1, text: 'Kafka splits a topic into partitions', thinking: 'Plan it.', model: 'nvidia:nvidia/nemotron-3.5-lightning-30b-a3b', stopReason: 'error', ...extra });

beforeEach(() => _resetRateLimitsForTests());

describe('POST /api/ai/keep', () => {
  it('saves the partial reply under the question and makes it the active leaf', async () => {
    const fake = seed();
    expect(await (await keep(body())).json()).toEqual({ ok: true, saved: true });
    const reply = fake.rows('ai_messages').find((m) => m.id === A1);
    expect(reply).toMatchObject({ parent_id: U1, role: 'assistant', content: [{ type: 'text', text: 'Kafka splits a topic into partitions' }], thinking: 'Plan it.', stop_reason: 'error', model_id: 'nvidia:nvidia/nemotron-3.5-lightning-30b-a3b', provider: 'nvidia' });
    expect(fake.rows('ai_conversations')[0]).toMatchObject({ active_leaf_id: A1 });
  });

  it('leaves a reply that is already saved alone, and keeps nothing for an empty text', async () => {
    const fake = seed();
    await keep(body());
    expect(await (await keep(body({ text: 'something else' }))).json()).toEqual({ ok: true, saved: false });
    expect(fake.rows('ai_messages').find((m) => m.id === A1)?.content).toEqual([{ type: 'text', text: 'Kafka splits a topic into partitions' }]);
    expect(await (await keep(body({ assistantMessageId: A2, text: '  ' }))).json()).toEqual({ ok: true, saved: false });
    expect(fake.rows('ai_messages').some((m) => m.id === A2)).toBe(false);
  });

  it('a part kept as the page closed gives way to a fuller text or how it really ended, never to less', async () => {
    const fake = seed();
    const reply = () => fake.rows('ai_messages').find((m) => m.id === A1);
    // The keepalive save on pagehide: trimmed, no reasoning.
    await keep(body({ text: 'Kafka splits', thinking: undefined, stopReason: 'aborted' }));
    expect(reply()).toMatchObject({ content: [{ type: 'text', text: 'Kafka splits' }], stop_reason: 'aborted' });
    // A shorter or different text never replaces it.
    expect(await (await keep(body({ text: 'Kafka', stopReason: 'aborted' }))).json()).toEqual({ ok: true, saved: false });
    expect(await (await keep(body({ text: 'Something else that is longer', stopReason: 'aborted' }))).json()).toEqual({ ok: true, saved: false });
    // The draft from the device, the next time the page opens: the whole text.
    expect(await (await keep(body({ stopReason: 'aborted' }))).json()).toEqual({ ok: true, saved: true });
    expect(reply()).toMatchObject({ content: [{ type: 'text', text: 'Kafka splits a topic into partitions' }], thinking: 'Plan it.', stop_reason: 'aborted' });
    // The same text once more with how it ended.
    expect(await (await keep(body({ stopReason: 'end' }))).json()).toEqual({ ok: true, saved: true });
    expect(reply()).toMatchObject({ stop_reason: 'end' });
    // A reply that ended is never replaced, not even by a longer one.
    expect(await (await keep(body({ text: 'Kafka splits a topic into partitions, and more', stopReason: 'aborted' }))).json()).toEqual({ ok: true, saved: false });
    expect(reply()?.content).toEqual([{ type: 'text', text: 'Kafka splits a topic into partitions' }]);
    expect(fake.rows('ai_messages').filter((m) => m.id === A1)).toHaveLength(1);
  });

  it('only for the account\'s own chat and a real question in it', async () => {
    seed();
    expect((await keep(body(), '2002')).status).toBe(404);
    expect((await keep(body({ userMessageId: A2 }))).status).toBe(404);
    expect((await keep(body({ conversationId: 'nope' }))).status).toBe(400);
    expect((await keep(body({ text: 5 }))).status).toBe(400);
  });

  it('an unknown model id is stored as no model', async () => {
    const fake = seed();
    await keep(body({ model: 'evil:model', stopReason: 'aborted' }));
    expect(fake.rows('ai_messages').find((m) => m.id === A1)).toMatchObject({ model_id: null, provider: null, stop_reason: 'aborted' });
  });

  it('saves a reply that ended but was too large for the chat to read again, with how it ended', async () => {
    const fake = seed();
    await keep(body({ stopReason: 'length' }));
    expect(fake.rows('ai_messages').find((m) => m.id === A1)).toMatchObject({ stop_reason: 'length' });
    await keep(body({ assistantMessageId: A2, stopReason: 'end' }));
    expect(fake.rows('ai_messages').find((m) => m.id === A2)).toMatchObject({ stop_reason: 'end' });
  });

  it('a Continue saves the whole reply over the saved part, only when it carries that part on', async () => {
    const fake = seed();
    await keep(body({ text: '<artifact id="a" type="html" title="A"><html>', thinking: 'Plan it.', stopReason: 'length' }));
    const whole = '<artifact id="a" type="html" title="A"><html><body>Hi</body></html>\n</artifact>';
    expect(await (await keep(body({ text: whole, thinking: 'Plan it.\n\nThen finish.', stopReason: 'end', continued: true }))).json()).toEqual({ ok: true, saved: true });
    const reply = fake.rows('ai_messages').find((m) => m.id === A1);
    expect(reply).toMatchObject({ content: [{ type: 'text', text: whole }], thinking: 'Plan it.\n\nThen finish.', stop_reason: 'end' });
    expect((reply?.artifacts as Array<{ id: string }>)[0]).toMatchObject({ id: 'a' });
    // Not a carry-on of what is saved (or nothing new): left alone.
    expect(await (await keep(body({ text: 'Something else entirely, and longer than before', continued: true }))).json()).toEqual({ ok: true, saved: false });
    expect(fake.rows('ai_messages').find((m) => m.id === A1)?.content).toEqual([{ type: 'text', text: whole }]);
    // A Continue of a reply that is not saved at all.
    expect((await keep(body({ assistantMessageId: A2, continued: true }))).status).toBe(404);
  });
});
