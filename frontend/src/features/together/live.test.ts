// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanLive, LiveLine, type LiveSocket } from './live';

/** A WebSocket as the line sees one: what it was sent, and a way to answer. */
class FakeSocket implements LiveSocket {
  readyState = 0;
  onopen: ((e: unknown) => void) | null = null;
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onclose: ((e: unknown) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  sent: Array<Record<string, unknown>> = [];
  constructor(readonly url: string) {}
  send(data: string): void {
    this.sent.push(JSON.parse(data) as Record<string, unknown>);
  }
  close(): void {
    this.readyState = 3;
  }
  open(): void {
    this.readyState = 1;
    this.onopen?.({});
  }
  say(frame: unknown): void {
    this.onmessage?.({ data: typeof frame === 'string' ? frame : JSON.stringify(frame) });
  }
  /** Open, and accept the join. */
  join(): void {
    this.open();
    const join = this.sent.find((f) => f.event === 'phx_join')!;
    this.say({ topic: join.topic, event: 'phx_reply', payload: { status: 'ok', response: {} }, ref: join.ref });
  }
}

const CFG = { url: 'wss://abcdefgh.supabase.co/realtime/v1', key: 'sb_publishable_test' };
const TOPIC = 'realtime:vx-room-ABC123';

let sockets: FakeSocket[];
const make = (url: string): FakeSocket => {
  const s = new FakeSocket(url);
  sockets.push(s);
  return s;
};
const line = (onEvent = vi.fn(), onStatus = vi.fn()) => ({ l: new LiveLine(CFG, 'ABC123', onEvent, onStatus, make), onEvent, onStatus });

beforeEach(() => {
  vi.useFakeTimers();
  sockets = [];
});
afterEach(() => vi.useRealTimers());

describe('the live line', () => {
  it('opens one socket with the public key and joins the room’s own channel', () => {
    const { l, onStatus } = line();
    expect(sockets).toHaveLength(1);
    expect(sockets[0].url).toBe('wss://abcdefgh.supabase.co/realtime/v1/websocket?apikey=sb_publishable_test&vsn=1.0.0');
    expect(l.connected).toBe(false);
    sockets[0].open();
    const join = sockets[0].sent[0];
    expect(join).toMatchObject({ topic: TOPIC, event: 'phx_join' });
    // Our own messages are not echoed back, and nothing is read from the database.
    expect(join.payload).toMatchObject({ config: { broadcast: { self: false }, postgres_changes: [], private: false } });
    expect(l.connected).toBe(false);
    sockets[0].say({ topic: TOPIC, event: 'phx_reply', payload: { status: 'ok' }, ref: join.ref });
    expect(l.connected).toBe(true);
    expect(onStatus).toHaveBeenLastCalledWith(true);
    l.close();
  });

  it('sends to the room only once it is in, and says so when it is not', () => {
    const { l } = line();
    expect(l.send('chat', { text: 'early' })).toBe(false);
    sockets[0].join();
    expect(l.send('chat', { text: 'hello' })).toBe(true);
    expect(sockets[0].sent[sockets[0].sent.length - 1]).toMatchObject({ topic: TOPIC, event: 'broadcast', payload: { type: 'broadcast', event: 'chat', payload: { text: 'hello' } } });
    l.close();
    expect(l.send('chat', { text: 'late' })).toBe(false);
  });

  it('hands over what the room says, and nothing that is not the room’s', () => {
    const { l, onEvent } = line();
    sockets[0].join();
    sockets[0].say({ topic: TOPIC, event: 'broadcast', payload: { type: 'broadcast', event: 'state', payload: { playing: false } } });
    expect(onEvent).toHaveBeenCalledWith('state', { playing: false });
    onEvent.mockClear();
    sockets[0].say({ topic: 'realtime:vx-room-OTHER1', event: 'broadcast', payload: { event: 'state', payload: {} } });
    sockets[0].say('not json at all');
    sockets[0].say({ topic: TOPIC, event: 'broadcast', payload: { event: 42 } });
    sockets[0].say(JSON.stringify({ topic: TOPIC, event: 'broadcast', payload: { event: 'chat', payload: { text: 'x'.repeat(20_000) } } }));
    sockets[0].say({ topic: TOPIC, event: 'presence_state', payload: {} });
    expect(onEvent).not.toHaveBeenCalled();
    l.close();
  });

  it('comes back by itself after the socket drops, waiting longer each time', () => {
    const { l, onStatus } = line();
    sockets[0].join();
    sockets[0].onclose?.({});
    expect(l.connected).toBe(false);
    expect(onStatus).toHaveBeenLastCalledWith(false);
    vi.advanceTimersByTime(1500);
    expect(sockets).toHaveLength(2);
    // The second try fails before it opens: the next wait is longer.
    sockets[1].onerror?.({});
    vi.advanceTimersByTime(1500);
    expect(sockets).toHaveLength(2);
    vi.advanceTimersByTime(1000);
    expect(sockets).toHaveLength(3);
    sockets[2].join();
    expect(l.connected).toBe(true);
    l.close();
  });

  it('a join the server refuses is dropped and tried again', () => {
    const { l } = line();
    sockets[0].open();
    sockets[0].say({ topic: TOPIC, event: 'phx_reply', payload: { status: 'error' }, ref: sockets[0].sent[0].ref });
    expect(l.connected).toBe(false);
    vi.advanceTimersByTime(1500);
    expect(sockets).toHaveLength(2);
    l.close();
  });

  it('keeps the socket alive, and replaces one that has gone silent', () => {
    const { l } = line();
    sockets[0].join();
    vi.advanceTimersByTime(25_000);
    const beat = sockets[0].sent[sockets[0].sent.length - 1];
    expect(beat).toMatchObject({ topic: 'phoenix', event: 'heartbeat' });
    sockets[0].say({ topic: 'phoenix', event: 'phx_reply', payload: { status: 'ok' }, ref: beat.ref });
    vi.advanceTimersByTime(25_000);
    expect(l.connected).toBe(true);
    // This heartbeat is never answered: by the next one the socket is given up.
    vi.advanceTimersByTime(25_000);
    expect(l.connected).toBe(false);
    vi.advanceTimersByTime(1500);
    expect(sockets).toHaveLength(2);
    l.close();
  });

  it('closing it is final: no retry, no heartbeat', () => {
    const { l } = line();
    sockets[0].join();
    l.close();
    sockets[0].onclose?.({});
    vi.advanceTimersByTime(120_000);
    expect(sockets).toHaveLength(1);
    expect(sockets[0].readyState).toBe(3);
  });

  it('takes an address only if it is Supabase Realtime over TLS', () => {
    expect(cleanLive(CFG)).toEqual(CFG);
    expect(cleanLive({ url: 'wss://evil.example/realtime/v1', key: 'k' })).toBeNull();
    expect(cleanLive({ url: 'ws://abcdefgh.supabase.co/realtime/v1', key: 'k' })).toBeNull();
    expect(cleanLive({ url: CFG.url })).toBeNull();
    expect(cleanLive({ url: CFG.url, key: '' })).toBeNull();
    expect(cleanLive(undefined)).toBeNull();
    expect(cleanLive('wss://abcdefgh.supabase.co/realtime/v1')).toBeNull();
  });
});
