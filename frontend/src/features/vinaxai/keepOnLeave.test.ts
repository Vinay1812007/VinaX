// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { KEYS } from '@/constants/storage-keys';
import type { KeepBody } from './api';
import { _resetFinishForTests, DRAFT_KEY, DRAFT_MAX_AGE_MS, dropDraft, finishDraft, keepaliveBody, saveDraft, sendKeepalive, transcriptKeepaliveBody } from './keepOnLeave';

const signIn = (email = 'asha@example.com') =>
  localStorage.setItem(KEYS.account, JSON.stringify({ session: 'vx1.test', user: { name: 'Asha', email, picture: null, username: 'asha' } }));
const body = (extra: Partial<KeepBody> = {}): KeepBody => ({ conversationId: 'c1', userMessageId: 'u1', assistantMessageId: 'a1', text: 'Kafka splits a topic', thinking: 'Plan it.', model: 'm', stopReason: 'aborted', ...extra });
const drafts = () => JSON.parse(localStorage.getItem(DRAFT_KEY) ?? '[]') as Array<{ body: KeepBody; who: string; at: number }>;
const bytes = (s: string) => new TextEncoder().encode(s).length;

beforeEach(() => {
  localStorage.clear();
  _resetFinishForTests();
});
afterEach(() => vi.unstubAllGlobals());

describe('the keepalive body', () => {
  it('is the whole request when it fits', () => {
    expect(JSON.parse(keepaliveBody(body())!)).toEqual(body());
    expect(keepaliveBody(body({ text: '   ' }))).toBeNull();
  });

  it('drops the reasoning first, then cuts the end of the text, under the limit', () => {
    const lean = JSON.parse(keepaliveBody(body({ thinking: 'x'.repeat(500) }), 300)!) as KeepBody;
    expect(lean.thinking).toBeUndefined();
    expect(lean.text).toBe('Kafka splits a topic');
    const long = body({ text: 'ab'.repeat(40_000), thinking: undefined });
    const wire = keepaliveBody(long)!;
    expect(bytes(wire)).toBeLessThanOrEqual(60_000);
    const cut = JSON.parse(wire) as KeepBody;
    expect(long.text.startsWith(cut.text)).toBe(true);
    expect(cut.text.length).toBeGreaterThan(59_000);
  });

  it('never cuts a character in half', () => {
    const wire = keepaliveBody(body({ text: '🎵'.repeat(400), thinking: undefined }), 400)!;
    const text = (JSON.parse(wire) as KeepBody).text;
    expect(bytes(wire)).toBeLessThanOrEqual(400);
    expect(text).toBe('🎵'.repeat(text.length / 2));
  });

  it('a Live voice transcript keeps its first turns as far as they fit, each cut to what the route keeps', () => {
    const turns = Array.from({ length: 10 }, (_, i) => ({ role: (i % 2 ? 'assistant' : 'user') as 'user' | 'assistant', text: `${i} `.repeat(5_000) }));
    const wire = transcriptKeepaliveBody({ conversationId: null, model: 'live:x', turns })!;
    const sent = JSON.parse(wire) as { turns: Array<{ text: string }> };
    expect(bytes(wire)).toBeLessThanOrEqual(60_000);
    expect(sent.turns.length).toBe(7);
    expect(sent.turns[0].text.length).toBe(8_000);
    expect(sent.turns[0].text.startsWith('0 ')).toBe(true);
    expect(transcriptKeepaliveBody({ conversationId: null, model: 'live:x', turns: [{ role: 'user', text: ' ' }] })).toBeNull();
  });

  it('a long call sends at most the 200 turns the route takes', () => {
    const turns = Array.from({ length: 260 }, (_, i) => ({ role: (i % 2 ? 'assistant' : 'user') as 'user' | 'assistant', text: `t${i}` }));
    const sent = JSON.parse(transcriptKeepaliveBody({ conversationId: null, model: 'live:x', turns })!) as { turns: Array<{ text: string }> };
    expect(sent.turns).toHaveLength(200);
    expect(sent.turns[199].text).toBe('t199');
  });
});

describe('sending with keepalive', () => {
  it('posts with keepalive and the session as a Bearer header, only when signed in', () => {
    const fetchMock = vi.fn(async () => new Response('{}'));
    vi.stubGlobal('fetch', fetchMock);
    expect(sendKeepalive('/keep', '{}')).toBe(false);
    signIn();
    expect(sendKeepalive('/keep', '{"a":1}')).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith('/api/ai/keep', expect.objectContaining({ method: 'POST', keepalive: true, body: '{"a":1}', headers: expect.objectContaining({ authorization: 'Bearer vx1.test' }) }));
  });
});

describe('drafts on the device', () => {
  it('one per reply, newest first, and forgotten once saved', () => {
    signIn();
    saveDraft(body());
    saveDraft(body({ text: 'Kafka splits a topic into partitions' }));
    saveDraft(body({ assistantMessageId: 'a2' }));
    expect(drafts().map((d) => d.body.assistantMessageId)).toEqual(['a2', 'a1']);
    expect(drafts()[1].body.text).toBe('Kafka splits a topic into partitions');
    dropDraft('a2');
    dropDraft('a1');
    expect(localStorage.getItem(DRAFT_KEY)).toBeNull();
  });

  it('the next open sends them; a save that got through or cannot is forgotten, an offline one is kept', async () => {
    signIn();
    saveDraft(body());
    saveDraft(body({ assistantMessageId: 'a2', conversationId: 'c2' }));
    saveDraft(body({ assistantMessageId: 'a3', conversationId: 'c3' }));
    const sent: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      const b = JSON.parse(String(init.body)) as KeepBody;
      sent.push(b.assistantMessageId);
      expect(init.keepalive).toBeUndefined();
      if (b.assistantMessageId === 'a3') return Response.json({ ok: true, saved: true });
      if (b.assistantMessageId === 'a2') return Response.json({ error: 'not_found' }, { status: 404 });
      throw new TypeError('offline');
    }));
    await expect(finishDraft()).resolves.toBe('c3');
    expect(sent).toEqual(['a3', 'a2', 'a1']);
    expect(drafts().map((d) => d.body.assistantMessageId)).toEqual(['a1']);
    // Once per page load.
    await finishDraft();
    expect(sent).toHaveLength(3);
  });

  it('signed out, nothing is sent yet; signing in later in the same page load still sends them', async () => {
    signIn();
    saveDraft(body());
    localStorage.removeItem(KEYS.account);
    const fetchMock = vi.fn(async () => Response.json({ ok: true, saved: true }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(finishDraft()).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(drafts()).toHaveLength(1);
    signIn();
    await expect(finishDraft()).resolves.toBe('c1');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(DRAFT_KEY)).toBeNull();
  });

  it('another account\'s or an old draft is dropped unsent', async () => {
    signIn('bo@example.com');
    saveDraft(body());
    signIn();
    saveDraft(body({ assistantMessageId: 'a2' }));
    const list = drafts();
    list[0].at = Date.now() - DRAFT_MAX_AGE_MS - 1;
    localStorage.setItem(DRAFT_KEY, JSON.stringify(list));
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(finishDraft()).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(localStorage.getItem(DRAFT_KEY)).toBeNull();
  });
});
