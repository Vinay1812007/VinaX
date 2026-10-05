/**
 * Listen Together 10.0 — the two server halves of the sync fix, driven
 * through the REAL handlers:
 *  - every poll carries the server clock (`now`), so followers project the
 *    host's playhead from one clock instead of comparing two devices';
 *  - a guest's song request still lands when the database lacks the
 *    vinax_room_append_request function (it used to fail every time while
 *    the guest was told "Sent").
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { onRequestGet, onRequestPost } from '../functions/api/room';

const ENV = { SUPABASE_URL: 'https://sb.test', SUPABASE_SERVICE_ROLE_KEY: 'srk' };
let ip = 0;
const headers = () => ({ 'content-type': 'application/json', 'cf-connecting-ip': `10.9.${(ip += 1) % 250}.1` });

afterEach(() => vi.unstubAllGlobals());

describe('room poll', () => {
  it('answers with the server clock next to updated_at', async () => {
    const updated = new Date(Date.now() - 3000).toISOString();
    vi.stubGlobal('fetch', (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('vinax_rooms')) {
        return Promise.resolve(new Response(JSON.stringify([{ host_name: 'Asha', song: null, position: 12, playing: true, updated_at: updated, host_token: 't' }])));
      }
      return Promise.resolve(new Response('[]'));
    });
    const before = Date.now();
    const res = await onRequestGet({ request: new Request('https://app.test/api/room?code=ABC123', { headers: headers() }), env: ENV });
    const body = (await res.json()) as { now: number; room: { updated_at: string; host_token?: string } };
    expect(body.now).toBeGreaterThanOrEqual(before);
    expect(body.now - Date.parse(body.room.updated_at)).toBeGreaterThanOrEqual(3000);
    expect(body.room.host_token).toBeUndefined();
  });

  it('a houseful of polls from one address is not rate-limited', async () => {
    vi.stubGlobal('fetch', () => Promise.resolve(new Response('[]')));
    const same = { 'cf-connecting-ip': '10.200.0.7' };
    // Host every 4 s + three guests every 2 s for one minute = 105 polls.
    let limited = 0;
    for (let i = 0; i < 105; i += 1) {
      const res = await onRequestGet({ request: new Request('https://app.test/api/room?code=ABC123', { headers: same }), env: ENV });
      if (res.status === 429) limited += 1;
    }
    expect(limited).toBe(0);
  });
});

describe('song request', () => {
  it('falls back to a direct write when the append function is missing', async () => {
    const writes: unknown[] = [];
    vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/rpc/')) return Promise.resolve(new Response('{"message":"function does not exist"}', { status: 404 }));
      if ((init?.method ?? 'GET') === 'POST') {
        writes.push(JSON.parse(String(init?.body)));
        return Promise.resolve(new Response(null, { status: 201 }));
      }
      return Promise.resolve(
        new Response(JSON.stringify([{ song: { v: 2, current: { id: 'h1' }, queue: [], requests: [] } }])),
      );
    });
    const res = await onRequestPost({
      request: new Request('https://app.test/api/room', {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({ action: 'request', code: 'ABC123', by: 'Ravi', song: { id: 'g1', title: 'Requested', subtitle: '', image: '' } }),
      }),
      env: ENV,
    });
    expect(res.status).toBe(200);
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({
      code: 'ABC123',
      song: { v: 2, current: { id: 'h1' }, requests: [{ song: { id: 'g1' }, by: 'Ravi' }] },
    });
  });

  it('still says not_found for a room that does not exist', async () => {
    vi.stubGlobal('fetch', (input: RequestInfo | URL) =>
      Promise.resolve(String(input).includes('/rpc/') ? new Response('{}', { status: 400 }) : new Response('[]')),
    );
    const res = await onRequestPost({
      request: new Request('https://app.test/api/room', {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({ action: 'request', code: 'NOPE99', song: { id: 'g1' } }),
      }),
      env: ENV,
    });
    expect(res.status).toBe(404);
  });
});
