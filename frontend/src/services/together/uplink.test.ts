// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A host push carries the position it had when it left the phone, but the
 * server stamps it when it arrives. The host measures that trip and sends
 * the next position that far ahead; otherwise every guest places the host a
 * little behind where it is (the host sounds "a little fast").
 */
describe('updateRoom: a push says where the playhead will be when it lands', () => {
  let sent: Array<{ position: number; playing: boolean }>;

  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    sent = [];
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  /** A server `flightMs` away each way that spends `tookMs` on its database. */
  const server = (flightMs: number, tookMs: number, sayTook = true, stamps = false) =>
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: { body: string }) => {
      sent.push(JSON.parse(init.body) as { position: number; playing: boolean });
      await new Promise((r) => setTimeout(r, flightMs * 2 + tookMs));
      return new Response(JSON.stringify(sayTook ? { ok: true, took: tookMs, ...(stamps ? { stamps: true } : {}) } : { ok: true }), { status: 200 });
    }));

  const push = async (position: number, playing: boolean, at?: number) => {
    const { updateRoom } = await import('./index');
    const p = updateRoom('ABC123', null, position, playing, [], [], at);
    await vi.advanceTimersByTimeAsync(5000);
    return p;
  };

  it('adds the measured trip (round trip minus the server’s time, halved) while playing', async () => {
    server(120, 300);
    expect(await push(10, true)).toBe('ok');
    // Nothing measured yet: sent as it is.
    expect(sent[0].position).toBe(10);
    await push(20, true);
    expect(sent[1].position).toBeCloseTo(20.12, 3);
  });

  it('a paused position is exact', async () => {
    server(120, 300);
    await push(10, true);
    await push(20, false);
    expect(sent[1].position).toBe(20);
  });

  it('once the server says it honours it, a push carries the server moment its position was read at, as it is', async () => {
    server(120, 300, true, true);
    await push(10, true, 1_800_000_000_000);
    // Not yet known to be honoured: sent the old way, without the field.
    expect('at' in sent[0]).toBe(false);
    await push(20, true, 1_800_000_000_123);
    expect(sent[1]).toMatchObject({ position: 20, at: 1_800_000_000_123 });
  });

  it('against a server that does not honour it, the push keeps leading by the measured trip', async () => {
    server(120, 300);
    await push(10, true, 1_800_000_000_000);
    await push(20, true, 1_800_000_000_123);
    expect('at' in sent[1]).toBe(false);
    expect(sent[1].position).toBeCloseTo(20.12, 3);
  });

  it('adds nothing against a server that does not say how long it took', async () => {
    server(120, 300, false);
    await push(10, true);
    await push(20, true);
    expect(sent[1].position).toBe(20);
  });
});
