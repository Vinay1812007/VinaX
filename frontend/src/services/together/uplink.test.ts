// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A host that knows the server's clock sends `at`, the server moment its
 * position was read at, so how long the push takes to arrive does not
 * matter. Without one (before the host's first poll) the position goes as
 * it is and the server stamps it on arrival. Nothing is guessed from the trip.
 */
describe('updateRoom: a push carries the position as it is, with the server moment when known', () => {
  let sent: Array<Record<string, unknown>>;

  beforeEach(() => {
    vi.resetModules();
    sent = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: { body: string }) => {
      sent.push(JSON.parse(init.body) as Record<string, unknown>);
      return new Response(JSON.stringify({ ok: true, took: 300, stamps: true }), { status: 200 });
    }));
  });
  afterEach(() => vi.unstubAllGlobals());

  const push = async (position: number, playing: boolean, at?: number) => {
    const { updateRoom } = await import('./index');
    return updateRoom('ABC123', null, position, playing, [], [], at);
  };

  it('sends `at` from the very first push, and the position unchanged', async () => {
    expect(await push(10, true, 1_800_000_000_000)).toBe('ok');
    expect(sent[0]).toMatchObject({ action: 'update', position: 10, playing: true, at: 1_800_000_000_000 });
    await push(20, true, 1_800_000_000_123);
    expect(sent[1]).toMatchObject({ position: 20, at: 1_800_000_000_123 });
  });

  it('without a server moment, no `at` and no lead added while playing', async () => {
    await push(10, true);
    await push(20, true);
    expect('at' in sent[1]).toBe(false);
    expect(sent[1].position).toBe(20);
  });

  it('a room that is gone or no longer ours says so', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 404 })));
    expect(await push(1, false)).toBe('gone');
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 403 })));
    expect(await push(1, false)).toBe('forbidden');
  });
});

describe('heartbeat: a member says which app it runs (1.14)', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('sends the app version and the sync protocol, so the room can say whose app is too old', async () => {
    vi.resetModules();
    const sent: Array<Record<string, unknown>> = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: { body: string }) => {
      sent.push(JSON.parse(init.body) as Record<string, unknown>);
      return new Response('{"ok":true}', { status: 200 });
    }));
    const { heartbeat, SYNC_PROTOCOL } = await import('./index');
    await heartbeat('ABC123');
    expect(sent[0]).toMatchObject({ action: 'heartbeat', code: 'ABC123', sync: SYNC_PROTOCOL });
    expect(SYNC_PROTOCOL).toBeGreaterThanOrEqual(2);
  });
});
