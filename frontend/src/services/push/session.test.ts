// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { pushAuthHeaders, sessionTag } from './session';
import { reportOpened, uploadFcmToken } from './nativePush';

/** Console rebuild — push registrations carry the session; taps are counted by id. */
describe('push session', () => {
  beforeEach(() => localStorage.clear());

  it('no session, no header', () => {
    expect(pushAuthHeaders()).toEqual({});
    expect(sessionTag()).toBe('');
  });

  it('a signed-in listener registers with the session', async () => {
    localStorage.setItem('vinax.account.v1', JSON.stringify({ session: 'vx1.abc.def123456789', user: {} }));
    expect(pushAuthHeaders()).toEqual({ authorization: 'Bearer vx1.abc.def123456789' });
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    expect(await uploadFcmToken('t'.repeat(40), fetchImpl as unknown as typeof fetch)).toBe(true);
    const init = (fetchImpl.mock.calls[0] as unknown[])[1] as RequestInit;
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer vx1.abc.def123456789');
  });

  it('a tap reports only the notification id', () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 204 }));
    reportOpened('42', fetchImpl as unknown as typeof fetch);
    reportOpened('nope', fetchImpl as unknown as typeof fetch);
    reportOpened(undefined, fetchImpl as unknown as typeof fetch);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://www.vinaxmusic.online/api/push/opened');
    expect(JSON.parse(String(init.body))).toEqual({ id: 42 });
  });
});
