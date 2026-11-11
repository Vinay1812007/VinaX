/**
 * Listen Together — the live line (1.13).
 *
 * Until now every phone in a room learned what the others did by asking the
 * server on a timer: a guest every 2 s, the host every 4. So a play, a pause
 * or a chat line waited for the next question, and was heard seconds late.
 *
 * The live line is one WebSocket per phone to Supabase Realtime (its
 * "Broadcast": a message one phone sends on a channel is handed to every
 * other phone on it, usually well inside a quarter of a second). The channel
 * is named after the room code. On it travel the host's play state, chat
 * lines, "typing" and reactions.
 *
 * It is a shortcut, never the truth. Everything that matters is still written
 * to /api/room and every phone still polls it, so a phone that cannot open
 * the socket (a strict network, an older app) behaves exactly as before, and
 * anything said on the line that the server never confirms is put right by
 * the next poll. That also bounds what a prankster holding the room code can
 * do with it: a moment's blip, which the poll undoes.
 *
 * The address and the key come from /api/room (`live`). The key is the
 * project's PUBLIC one: it reads no table.
 *
 * This is the Phoenix channel protocol Realtime speaks, written out: join a
 * topic, keep the socket alive with a heartbeat, send and receive
 * `broadcast` messages. Written by hand because it is 150 lines and the
 * client library is 40 KB the room would have to download first.
 */

export interface LiveConfig {
  url: string;
  key: string;
}

const ADDRESS = /^wss:\/\/[a-z0-9-]+\.supabase\.co\/realtime\/v1$/;

/** The line's address as /api/room gave it, or null when it is not one. */
export function cleanLive(raw: unknown): LiveConfig | null {
  const o = raw as { url?: unknown; key?: unknown } | null;
  if (!o || typeof o.url !== 'string' || typeof o.key !== 'string') return null;
  if (!ADDRESS.test(o.url) || !o.key || o.key.length > 400) return null;
  return { url: o.url, key: o.key };
}

/** The part of a WebSocket the line uses (so a test can stand in for one). */
export interface LiveSocket {
  readyState: number;
  onopen: ((e: unknown) => void) | null;
  onmessage: ((e: { data: unknown }) => void) | null;
  onclose: ((e: unknown) => void) | null;
  onerror: ((e: unknown) => void) | null;
  send(data: string): void;
  close(): void;
}

const HEARTBEAT_MS = 25_000;
/** Waits between tries to reconnect; the last one repeats. */
const RETRY_MS = [1000, 2000, 4000, 8000, 15_000];
/** Messages larger than this are not ours. */
const MAX_FRAME = 16_384;

export class LiveLine {
  private readonly topic: string;
  private ws: LiveSocket | null = null;
  private ref = 0;
  private joinRef = '';
  private joined = false;
  private stopped = false;
  private tries = 0;
  private beat = 0;
  private retry = 0;
  /** A heartbeat the server has not answered yet. */
  private waiting = false;

  constructor(
    private readonly cfg: LiveConfig,
    code: string,
    private readonly onEvent: (event: string, payload: unknown) => void,
    private readonly onStatus: (open: boolean) => void = () => undefined,
    private readonly make: (url: string) => LiveSocket = (url) => new WebSocket(url) as unknown as LiveSocket,
  ) {
    this.topic = `realtime:vx-room-${code}`;
    this.open();
    if (typeof window !== 'undefined') {
      window.addEventListener('online', this.wake);
      document.addEventListener('visibilitychange', this.wake);
    }
  }

  /** True while messages sent now reach the room. */
  get connected(): boolean {
    return this.joined && this.ws?.readyState === 1;
  }

  /** Sends to everyone else in the room. False when the line is not up: the
   *  caller's server call still goes out, and the others hear by polling. */
  send(event: string, payload: unknown): boolean {
    if (!this.connected) return false;
    return this.write({ topic: this.topic, event: 'broadcast', payload: { type: 'broadcast', event, payload }, ref: this.next(), join_ref: this.joinRef });
  }

  close(): void {
    this.stopped = true;
    window.clearInterval(this.beat);
    window.clearTimeout(this.retry);
    if (typeof window !== 'undefined') {
      window.removeEventListener('online', this.wake);
      document.removeEventListener('visibilitychange', this.wake);
    }
    const ws = this.ws;
    this.ws = null;
    this.setJoined(false);
    try {
      ws?.close();
    } catch {
      /* already closed */
    }
  }

  private next(): string {
    this.ref += 1;
    return String(this.ref);
  }

  private write(frame: unknown): boolean {
    try {
      this.ws?.send(JSON.stringify(frame));
      return true;
    } catch {
      return false;
    }
  }

  private setJoined(v: boolean): void {
    if (this.joined === v) return;
    this.joined = v;
    this.onStatus(v);
  }

  /** Back on the network, or back on screen: do not wait out the retry. */
  private readonly wake = (): void => {
    if (this.stopped || this.ws || (typeof document !== 'undefined' && document.visibilityState === 'hidden')) return;
    window.clearTimeout(this.retry);
    this.open();
  };

  private open(): void {
    if (this.stopped || this.ws) return;
    let ws: LiveSocket;
    try {
      ws = this.make(`${this.cfg.url}/websocket?apikey=${encodeURIComponent(this.cfg.key)}&vsn=1.0.0`);
    } catch {
      this.again();
      return;
    }
    this.ws = ws;
    ws.onopen = () => {
      if (this.ws !== ws) return;
      this.joinRef = this.next();
      this.write({
        topic: this.topic,
        event: 'phx_join',
        // Our own messages are not sent back to us; nothing is read from the database.
        payload: { config: { broadcast: { ack: false, self: false }, presence: { key: '' }, postgres_changes: [], private: false } },
        ref: this.joinRef,
        join_ref: this.joinRef,
      });
      this.waiting = false;
      window.clearInterval(this.beat);
      this.beat = window.setInterval(() => {
        // The last heartbeat was never answered: the socket is dead without saying so.
        if (this.waiting) {
          this.drop(ws);
          return;
        }
        this.waiting = true;
        this.write({ topic: 'phoenix', event: 'heartbeat', payload: {}, ref: this.next() });
      }, HEARTBEAT_MS);
    };
    ws.onmessage = (e) => {
      if (this.ws !== ws || typeof e.data !== 'string' || e.data.length > MAX_FRAME) return;
      let m: { topic?: unknown; event?: unknown; payload?: unknown; ref?: unknown };
      try {
        m = JSON.parse(e.data) as typeof m;
      } catch {
        return;
      }
      if (m.topic === 'phoenix') {
        if (m.event === 'phx_reply') this.waiting = false;
        return;
      }
      if (m.topic !== this.topic) return;
      const p = m.payload as { status?: unknown; event?: unknown; payload?: unknown } | null;
      if (m.event === 'phx_reply' && m.ref === this.joinRef) {
        if (p?.status === 'ok') {
          this.tries = 0;
          this.setJoined(true);
        } else {
          this.drop(ws);
        }
      } else if (m.event === 'broadcast' && typeof p?.event === 'string') {
        this.onEvent(p.event, p.payload);
      } else if (m.event === 'phx_error' || m.event === 'phx_close') {
        this.drop(ws);
      }
    };
    ws.onclose = () => this.lost(ws);
    ws.onerror = () => this.lost(ws);
  }

  private drop(ws: LiveSocket): void {
    try {
      ws.close();
    } catch {
      /* already closed */
    }
    this.lost(ws);
  }

  private lost(ws: LiveSocket): void {
    if (this.ws !== ws) return;
    this.ws = null;
    window.clearInterval(this.beat);
    this.setJoined(false);
    this.again();
  }

  private again(): void {
    if (this.stopped) return;
    const wait = RETRY_MS[Math.min(this.tries, RETRY_MS.length - 1)];
    this.tries += 1;
    window.clearTimeout(this.retry);
    // A little spread, so a room does not reconnect in one burst.
    this.retry = window.setTimeout(() => this.open(), wait + Math.random() * 400);
  }
}
