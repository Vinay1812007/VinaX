/** Locks the playlist-variety fix (v3.3.1): every request carries a fresh
 * varietySeed nonce, the client's avoidTitles reach the model prompt AND get
 * hard-enforced on the output, and the endpoint rides the healthy dj lane
 * (nemotron-3.5-lightning since v5.4.0) at a hot temperature instead of the
 * degraded chat lane — the trio that broke "AI always generates the same
 * playlist". */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { filterAvoided, onRequestPost, titleKey, varietySeed } from './playlist';

describe('varietySeed', () => {
  it('emits a hex nonce plus an IST date-hour stamp', () => {
    expect(varietySeed()).toMatch(/^[0-9a-f]{8} · IST \d{4}-\d{2}-\d{2} \d{2}h$/);
  });

  it('differs between consecutive requests', () => {
    const seeds = new Set([varietySeed(), varietySeed(), varietySeed()]);
    expect(seeds.size).toBe(3);
  });
});

describe('filterAvoided', () => {
  const songs = [
    { title: 'Samajavaragamana', artist: 'Sid Sriram' },
    { title: 'Butta Bomma', artist: 'Armaan Malik' },
    { title: 'Inkem Inkem Inkem Kaavaale', artist: 'Sid Sriram' },
  ];

  it('drops avoid-listed titles, punctuation- and case-insensitively', () => {
    const out = filterAvoided(songs, ['samajavaragamana (from "ala vaikunthapurramuloo")', 'BUTTA BOMMA'], 'telugu melodies');
    expect(out.map((s) => s.title)).toEqual(['Inkem Inkem Inkem Kaavaale']);
  });

  it('keeps an avoid-listed song the listener explicitly asked for', () => {
    const out = filterAvoided(songs, ['Butta Bomma'], 'party set around Butta Bomma please');
    expect(out.map((s) => s.title)).toContain('Butta Bomma');
  });

  it('passes everything through when the avoid list is empty', () => {
    expect(filterAvoided(songs, [], 'anything')).toEqual(songs);
  });
});

describe('titleKey', () => {
  it('matches decorated catalog titles to their plain form', () => {
    expect(titleKey('Samajavaragamana (From "Ala Vaikunthapurramuloo")')).toContain(titleKey('Samajavaragamana'));
  });
});

describe('onRequestPost — variety plumbing end to end', () => {
  afterEach(() => vi.unstubAllGlobals());

  const MODEL_REPLY = {
    name: 'Test Mix',
    description: 'For the test suite',
    songs: [
      { title: 'Fresh Pick', artist: 'New Artist' },
      { title: 'Old Repeat', artist: 'Same Artist' },
    ],
  };

  /** Stub upstream chat-completions; capture every outbound payload. */
  function stubUpstream(): Array<{ model: string; temperature: number; user: string; system: string }> {
    const calls: Array<{ model: string; temperature: number; user: string; system: string }> = [];
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
        JSON.stringify({ choices: [{ message: { content: JSON.stringify(MODEL_REPLY) } }] }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    });
    return calls;
  }

  const post = (body: unknown): Promise<Response> =>
    onRequestPost({
      request: new Request('http://localhost/api/playlist', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }),
      // v5.4.0: the dj lane rides its own lightning key now.
      env: { VINAX_NEMOTRON_3_5_LIGHTNING_30B_A3B: 'test-key' },
    });

  it('pins the dj engine at temp 0.95 and injects nonce + avoidTitles into the prompt', async () => {
    const calls = stubUpstream();
    const res = await post({ prompt: 'rainy telugu melodies', languages: ['telugu'], avoidTitles: ['Old Repeat'] });
    expect(res.status).toBe(200);
    const curate = calls.find((c) => c.system.startsWith('You build playlists'));
    expect(curate).toBeDefined();
    // v5.4.0: dj lane re-pinned to nemotron-3.5-lightning (probed on its key).
    expect(curate!.model).toBe('nvidia/nemotron-3.5-lightning-30b-a3b');
    expect(curate!.temperature).toBe(0.95);
    expect(curate!.user).toMatch(/varietySeed: "[0-9a-f]{8} · IST /);
    expect(curate!.user).toContain('avoidTitles: ["Old Repeat"]');
  });

  it('hard-filters avoid-listed titles out of the response (belt and braces)', async () => {
    stubUpstream();
    const res = await post({ prompt: 'rainy telugu melodies', avoidTitles: ['old repeat'] });
    const data = (await res.json()) as { songs: Array<{ title: string }> };
    const titles = data.songs.map((s) => s.title);
    expect(titles).toContain('Fresh Pick');
    expect(titles).not.toContain('Old Repeat');
  });

  it('generates a different nonce on every request', async () => {
    const calls = stubUpstream();
    await post({ prompt: 'gym set' });
    await post({ prompt: 'gym set' });
    const nonces = calls
      .filter((c) => c.system.startsWith('You build playlists'))
      .map((c) => /varietySeed: "([0-9a-f]{8})/.exec(c.user)?.[1]);
    expect(nonces).toHaveLength(2);
    expect(nonces[0]).toBeDefined();
    expect(nonces[0]).not.toBe(nonces[1]);
  });
});
