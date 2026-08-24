/** Locks the AI DJ variety fix (v3.6.0): every /api/dj request injects a fresh
 *  varietySeed (nonce + IST date-hour) into the curate prompt — so consecutive
 *  "Play"/radio starts from the same seed build different queues — and the
 *  server still hard-filters any avoidSongs the client already surfaced. Same
 *  pattern the AI Playlist got in v3.3.1. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { onRequestPost } from './dj';

describe('onRequestPost — DJ variety + anti-repeat plumbing', () => {
  afterEach(() => vi.unstubAllGlobals());

  /** Stub upstream chat-completions; capture every outbound payload. */
  function stubUpstream(
    songs: Array<{ title: string; artist: string; reason?: string }>,
  ): Array<{ model: string; temperature: number; system: string; user: string }> {
    const calls: Array<{ model: string; temperature: number; system: string; user: string }> = [];
    vi.stubGlobal('fetch', async (_url: unknown, init?: { body?: string }) => {
      const payload = JSON.parse(init?.body ?? '{}') as {
        model: string;
        temperature: number;
        messages: Array<{ role: string; content: string }>;
      };
      calls.push({
        model: payload.model,
        temperature: payload.temperature,
        system: payload.messages[0]?.content ?? '',
        user: payload.messages[1]?.content ?? '',
      });
      return new Response(
        JSON.stringify({ choices: [{ message: { content: JSON.stringify({ songs }) } }] }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    });
    return calls;
  }

  const post = (body: unknown): Promise<Response> =>
    onRequestPost({
      request: new Request('http://localhost/api/dj', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }),
      // Only the dj key: gather (fast lane) has no key and is skipped, so the
      // sole outbound call is the curate on the dj engine.
      env: { VINAX_CHATGPT_120_B: 'dj-key' },
    });

  const eightFresh = Array.from({ length: 8 }, (_, i) => ({
    title: `Fresh ${i}`,
    artist: `Artist ${i}`,
    reason: 'flows on',
  }));

  it('pins the dj engine at temp 0.9 and injects a varietySeed nonce into the curate prompt', async () => {
    const calls = stubUpstream(eightFresh);
    const res = await post({ context: { seedSong: 'Butta Bomma', currentLanguage: 'telugu' } });
    expect(res.status).toBe(200);
    const curate = calls.find((c) => c.system.startsWith('You are the AI DJ'));
    expect(curate).toBeDefined();
    // v3.7.0: dj lane re-pinned to gpt-oss-20b (NVIDIA gpt-oss-120b hung >25s; the
    // fast same-family sibling keeps the curate quick + JSON-clean on the same key).
    expect(curate!.model).toBe('openai/gpt-oss-20b');
    expect(curate!.temperature).toBe(0.9);
    expect(curate!.user).toMatch(/varietySeed: "[0-9a-f]{8} · IST \d{4}-\d{2}-\d{2} \d{2}h"/);
  });

  it('generates a different nonce on every request (same seed → different queues)', async () => {
    const calls = stubUpstream(eightFresh);
    await post({ context: { seedSong: 'Butta Bomma' } });
    await post({ context: { seedSong: 'Butta Bomma' } });
    const nonces = calls
      .filter((c) => c.system.startsWith('You are the AI DJ'))
      .map((c) => /varietySeed: "([0-9a-f]{8})/.exec(c.user)?.[1]);
    expect(nonces).toHaveLength(2);
    expect(nonces[0]).toBeDefined();
    expect(nonces[0]).not.toBe(nonces[1]);
  });

  it('hard-filters avoidSongs out of the returned queue (belt and braces)', async () => {
    stubUpstream([...eightFresh, { title: 'Old Pick', artist: 'Repeat Artist', reason: 're-served' }]);
    const res = await post({
      context: { seedSong: 'Butta Bomma', avoidSongs: ['Old Pick — Repeat Artist (telugu)'] },
    });
    const data = (await res.json()) as { songs: Array<{ title: string }> };
    const titles = data.songs.map((s) => s.title);
    expect(titles).toContain('Fresh 0');
    expect(titles).not.toContain('Old Pick');
  });
});
