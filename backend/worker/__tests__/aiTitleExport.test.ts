/** VinaX AI — title cleaning and the chats export route. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanTitle } from '../functions/_lib/ai/title';
import { onRequestGet } from '../functions/api/ai/export';
import { issueSession } from '../functions/_lib/googleAuth';
import { _resetRateLimitsForTests } from '../functions/_lib/ratelimit';
import { DB_ENV, fakeDb } from './helpers/fakeDb';

describe('cleanTitle', () => {
  it.each([
    ['"Raga Yaman Explained."', 'Raga Yaman Explained'],
    ['Title: **Evening ragas**', 'Evening ragas'],
    ['<think>hmm</think>\n\nFixing a React bug', 'Fixing a React bug'],
    ['one two three four five six seven eight nine ten', 'one two three four five six'],
    ['   ', null],
  ])('%s → %s', (raw, want) => {
    expect(cleanTitle(raw)).toBe(want);
  });
});

describe('GET /api/ai/export', () => {
  const ENV = { GOOGLE_CLIENT_ID: 'x.apps.googleusercontent.com', AUTH_SECRET: 'auth-secret', ...DB_ENV };
  beforeEach(() => _resetRateLimitsForTests());
  afterEach(() => vi.unstubAllGlobals());

  it('returns the account\'s chats as a download, from ai_export with the session account', async () => {
    const fake = fakeDb();
    fake.answer('rpc/ai_export', (call) => new Response(JSON.stringify({ format: 'vinax-ai-chats', version: 1, conversations: [], who: (call.body as { p_account: string }).p_account }), { status: 200, headers: { 'content-type': 'application/json' } }));
    const token = await issueSession(ENV, '1001');
    const res = await onRequestGet({ request: new Request('https://www.vinaxmusic.online/api/ai/export', { headers: { authorization: `Bearer ${token}`, 'cf-connecting-ip': '198.51.100.9' } }), env: ENV });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-disposition')).toMatch(/^attachment; filename="vinax-ai-chats-\d{4}-\d{2}-\d{2}\.json"$/);
    expect(await res.json()).toMatchObject({ format: 'vinax-ai-chats', who: '1001' });
  });

  it('401 signed out', async () => {
    fakeDb();
    expect((await onRequestGet({ request: new Request('https://x/api/ai/export', { headers: { 'cf-connecting-ip': '198.51.100.10' } }), env: ENV })).status).toBe(401);
  });
});
