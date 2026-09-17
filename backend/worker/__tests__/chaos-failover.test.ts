/**
 * Chaos suite (audit §6) — sabotage the AI upstreams and prove the failover
 * ladder holds. This drives the REAL /api/vinaxai handler (no re-implementation
 * of the ladder), with global fetch replaced per scenario:
 *
 *   healthy    → OpenAI-style SSE with content deltas
 *   reject     → network throw (covers the same catch path as a hang/abort,
 *                without waiting out the 18s leash — the timer path itself
 *                needs wall-clock and is deliberately out of unit scope)
 *   degraded   → instant HTTP 400 (a dead/revoked key)
 *   empty      → 200 SSE that ends with zero content (observed live)
 *
 * Every scenario asserts CLIENT-VISIBLE outcomes: which upstreams were tried,
 * what streamed, which engine the meta frames credit.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { onRequestPost } from '../functions/api/vinaxai';

type FetchPlan = (url: string, init?: RequestInit) => Response | Promise<Response>;

const calls: Array<{ url: string; body: Record<string, unknown> | null }> = [];

function sse(chunks: string[]): string {
  return (
    chunks.map((c) => `data: ${JSON.stringify({ choices: [{ delta: { content: c } }] })}\n\n`).join('') +
    'data: [DONE]\n\n'
  );
}

function healthy(chunks: string[]): Response {
  return new Response(sse(chunks), { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

function installFetch(plan: FetchPlan): void {
  calls.length = 0;
  vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    let body: Record<string, unknown> | null;
    try {
      body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null;
    } catch {
      body = null;
    }
    calls.push({ url, body });
    return Promise.resolve(plan(url, init));
  });
}

// Two-lane env: chat (primary for 'muse') + dj (first ladder hop). Keeping the
// key set small makes the attempt order deterministic for assertions.
const ENV = {
  // The chat/dj key plus the fast lane's own key (the first ladder hop after
  // a lane's own pair) — v5.21.0 names.
  VINAX_NVD_NEMOTRON_3_5_LIGHTNING_30B_A3B: 'test-key-chat',
  VINAX_OAI_GPT_OSS_20B: 'test-key-fast',
};

let ipSeq = 0;
function chatRequest(content = 'hello there'): Request {
  ipSeq += 1;
  return new Request('https://example.test/api/vinaxai', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      // Unique IP per call so the in-memory rate limiter never trips a test.
      'cf-connecting-ip': `10.0.${Math.floor(ipSeq / 250)}.${ipSeq % 250}`,
    },
    body: JSON.stringify({ messages: [{ role: 'user', content }], mode: 'muse' }),
  });
}

interface Frame {
  delta?: string;
  done?: boolean;
  truncated?: boolean;
  meta?: { model?: string; web?: string };
  error?: string;
}

async function drive(request: Request): Promise<{ status: number; frames: Frame[]; text: string }> {
  const res = await onRequestPost({ request, env: ENV });
  const raw = await res.text();
  const frames = raw
    .split('\n\n')
    .filter((l) => l.startsWith('data: '))
    .map((l) => JSON.parse(l.slice(6)) as Frame);
  const text = frames.map((f) => f.delta ?? '').join('');
  return { status: res.status, frames, text };
}

/** URLs of LLM chat-completion calls only (excludes search providers). */
const llmCalls = (): typeof calls => calls.filter((c) => c.url.includes('/chat/completions'));

beforeEach(() => {
  vi.unstubAllGlobals();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('AI lane failover — chaos scenarios', () => {
  it('healthy primary: streams its answer, one upstream call', async () => {
    installFetch(() => healthy(['Hello ', 'listener!']));
    const { status, frames, text } = await drive(chatRequest());
    expect(status).toBe(200);
    expect(text).toBe('Hello listener!');
    expect(llmCalls()).toHaveLength(1);
    expect(frames.some((f) => f.done)).toBe(true);
  });

  it('primary network-dead: the ladder hop serves, transparently', async () => {
    installFetch(() => {
      // First attempt (chat lane's primary model) explodes; anything after answers.
      if (llmCalls().length === 1) throw new Error('ECONNRESET');
      return healthy(['rescued']);
    });
    const { status, text } = await drive(chatRequest());
    expect(status).toBe(200);
    expect(text).toBe('rescued');
    expect(llmCalls().length).toBeGreaterThanOrEqual(2);
  });

  it('primary degraded (400): hops without leaking the failure to the client', async () => {
    installFetch(() => {
      if (llmCalls().length === 1) return new Response('bad model', { status: 400 });
      return healthy(['still here']);
    });
    const { status, frames, text } = await drive(chatRequest());
    expect(status).toBe(200);
    expect(text).toBe('still here');
    expect(frames.some((f) => f.error)).toBe(false);
  });

  it('empty stream (200, no content): the rescue re-asks a sibling and re-credits meta', async () => {
    installFetch(() => {
      if (llmCalls().length === 1) return healthy([]); // 200 OK, zero deltas
      return healthy(['second engine answer']);
    });
    const { status, frames, text } = await drive(chatRequest());
    expect(status).toBe(200);
    expect(text).toBe('second engine answer');
    // Two meta frames: the optimistic first credit, then the rescuer.
    expect(frames.filter((f) => f.meta).length).toBeGreaterThanOrEqual(2);
  });

  it('every lane dead: an honest engine_unreachable, never a hang or a 500 leak', async () => {
    installFetch(() => {
      throw new Error('total outage');
    });
    const res = await onRequestPost({ request: chatRequest(), env: ENV });
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBe('engine_unreachable');
  });

  it('B3 under chaos: a FETCH marker with dead search providers still ends in an answer', async () => {
    installFetch((url) => {
      if (!url.includes('/chat/completions')) return new Response('', { status: 500 }); // search providers down
      if (llmCalls().length === 1) return healthy(['[[FETCH: latest cricket scores]]']);
      return healthy(['Answering from memory — may be dated.']);
    });
    const { status, frames, text } = await drive(chatRequest('who won the match today?'));
    expect(status).toBe(200);
    expect(text).toBe('Answering from memory — may be dated.');
    // The marker itself must never reach the client.
    expect(text).not.toContain('FETCH');
    // The restart prompt must carry the honest search-failure instruction.
    const second = llmCalls()[1];
    const sys = (second?.body?.messages as Array<{ content: string }> | undefined)?.[0]?.content ?? '';
    expect(sys).toContain('LIVE WEB SEARCH FAILED');
    // And the client saw the web status flip to failed in a meta update.
    expect(frames.filter((f) => f.meta).length).toBeGreaterThanOrEqual(2);
  });
});

/**
 * The per-attempt leash covers TIME TO RESPONSE HEADERS only. It used to be a
 * never-cleared timeout signal, so it kept ticking into the body and cut long
 * answers off at 18 s — presented to the client as a complete reply. These run
 * on fake timers; the upstream body honours the request's abort signal exactly
 * as a real fetch does, so a leaked leash would error the stream.
 */
describe('stream leash vs. stream body', () => {
  const frame = (c: string): Uint8Array =>
    new TextEncoder().encode(`data: ${JSON.stringify({ choices: [{ delta: { content: c } }] })}\n\n`);

  /** Headers arrive at once; `script` then feeds the body over (fake) time. */
  function slowBody(init: RequestInit | undefined, script: (c: ReadableStreamDefaultController<Uint8Array>) => void): Response {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        init?.signal?.addEventListener('abort', () => {
          try {
            controller.error(new DOMException('aborted', 'AbortError'));
          } catch {
            /* already closed */
          }
        });
        script(controller);
      },
    });
    return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
  }

  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('a body that outlives the 18s header leash is NOT aborted and ends as a complete reply', async () => {
    installFetch((_url, init) =>
      slowBody(init, (c) => {
        c.enqueue(frame('first half, '));
        setTimeout(() => {
          c.enqueue(frame('second half.'));
          c.close();
        }, 40_000);
      }),
    );
    const pending = drive(chatRequest());
    await vi.advanceTimersByTimeAsync(45_000);
    const { status, frames, text } = await pending;
    expect(status).toBe(200);
    expect(text).toBe('first half, second half.');
    expect(llmCalls()).toHaveLength(1);
    const last = frames[frames.length - 1];
    expect(last.done).toBe(true);
    expect(last.truncated).toBeUndefined();
  });

  it('a stream stuck past the overall budget is cut and flagged truncated, not complete', async () => {
    installFetch((_url, init) =>
      slowBody(init, (c) => {
        c.enqueue(frame('partial answer'));
        // …and then the upstream never sends another byte.
      }),
    );
    const pending = drive(chatRequest());
    await vi.advanceTimersByTimeAsync(95_000);
    const { frames, text } = await pending;
    expect(text).toBe('partial answer');
    expect(llmCalls()).toHaveLength(1); // partial output is never re-asked
    expect(frames[frames.length - 1]).toEqual({ done: true, truncated: true });
  });

  it('a mid-stream upstream error after partial output is flagged truncated', async () => {
    installFetch((_url, init) =>
      slowBody(init, (c) => {
        c.enqueue(frame('half an '));
        setTimeout(() => c.error(new Error('ECONNRESET')), 5_000);
      }),
    );
    const pending = drive(chatRequest());
    await vi.advanceTimersByTimeAsync(6_000);
    const { frames, text } = await pending;
    expect(text).toBe('half an ');
    expect(frames[frames.length - 1]).toEqual({ done: true, truncated: true });
  });
});
