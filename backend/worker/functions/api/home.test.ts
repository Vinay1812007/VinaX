/** Locks the home-builder reliability fix (v3.5.1): the curate step rides the
 * FAST dj engine (nemotron-3.5-lightning since v5.4.0) instead of the
 * slow/flaky 550B ULTRA, and — no matter what the upstream engines do —
 * /api/home ALWAYS answers 200 with a usable, on-language shelf set. When the
 * AI curate + idea gather both come up empty, deterministic fallbackSections()
 * ships instead of the old 500. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { onRequestPost, parseSections, fallbackSections } from './home';

describe('parseSections — robust extraction', () => {
  it('parses a plain JSON object', () => {
    const out = parseSections('{"sections":[{"title":"A","query":"telugu hits"}]}');
    expect(out).toEqual([{ title: 'A', query: 'telugu hits' }]);
  });

  it('strips ```json fences before parsing', () => {
    const out = parseSections('```json\n{"sections":[{"title":"Fresh","query":"latest hindi songs"}]}\n```');
    expect(out).toEqual([{ title: 'Fresh', query: 'latest hindi songs' }]);
  });

  it('recovers JSON from a reasoning preamble', () => {
    const out = parseSections('Sure — here is the front page:\n{"sections":[{"title":"Late-night","query":"telugu melodies"}]} hope this helps');
    expect(out).toEqual([{ title: 'Late-night', query: 'telugu melodies' }]);
  });

  it('drops entries with non-string or blank title/query and caps at six', () => {
    const raw = {
      sections: [
        { title: 'Keep', query: 'q1' },
        { title: ' ', query: 'q2' }, // blank title
        { title: 'NoQuery', query: '' }, // blank query
        { title: 'Bad', query: 5 }, // non-string query
        { title: 'A', query: 'a' },
        { title: 'B', query: 'b' },
        { title: 'C', query: 'c' },
        { title: 'D', query: 'd' },
        { title: 'E', query: 'e' },
        { title: 'F', query: 'f' }, // 7th valid -> trimmed off by the cap
      ],
    };
    const out = parseSections(JSON.stringify(raw));
    expect(out).toHaveLength(6);
    expect(out.map((s) => s.title)).toEqual(['Keep', 'A', 'B', 'C', 'D', 'E']);
  });

  it('returns [] for junk / non-JSON', () => {
    expect(parseSections('the model said no')).toEqual([]);
    expect(parseSections(null)).toEqual([]);
  });
});

describe('fallbackSections — deterministic, on-taste, always usable', () => {
  it('always yields 4-6 sections, each with a non-empty title and query', () => {
    const out = fallbackSections({ preferredLanguages: ['telugu'] });
    expect(out.length).toBeGreaterThanOrEqual(4);
    expect(out.length).toBeLessThanOrEqual(6);
    for (const s of out) {
      expect(typeof s.title).toBe('string');
      expect(s.title.length).toBeGreaterThan(0);
      expect(s.query.length).toBeGreaterThan(0);
    }
  });

  it('names the primary language in every base query (STRICT LANGUAGE RULE)', () => {
    const out = fallbackSections({ preferredLanguages: ['telugu', 'hindi'] });
    // The four base shelves are always the primary language.
    for (const s of out.slice(0, 4)) expect(s.query).toContain('telugu');
    // A bilingual listener gets a second-language shelf too.
    expect(out.some((s) => s.query.includes('hindi'))).toBe(true);
  });

  it('prefers preferredLanguages over topLanguages', () => {
    const out = fallbackSections({ preferredLanguages: ['tamil'], topLanguages: ['hindi'] });
    expect(out[0].query).toContain('tamil');
    expect(out.every((s) => !s.query.includes('hindi'))).toBe(true);
  });

  it('falls back to topLanguages, then to a sane default, on a thin context', () => {
    expect(fallbackSections({ topLanguages: ['kannada'] })[0].query).toContain('kannada');
    expect(fallbackSections({})[0].query).toContain('hindi');
  });

  it('adds an artist deep-dive shelf when a top artist is known', () => {
    const out = fallbackSections({ preferredLanguages: ['telugu'], topArtists: ['A.R. Rahman'] });
    expect(out.some((s) => s.title.includes('A.R. Rahman'))).toBe(true);
  });

  // v3.6.0: the AI-cold fallback must not re-serve identical shelves every open.
  it('rotates its shelf phrasing/order by the varietySeed (fresh even when AI is cold)', () => {
    const ctx = { preferredLanguages: ['telugu'], topArtists: ['Anirudh'], timeOfDay: 'evening' };
    const shapes = new Set(
      Array.from({ length: 8 }, (_, i) =>
        fallbackSections(ctx, `nonce-${i}-${i * 7919} · IST 2026-07-27 0${i}h`)
          .map((s) => s.query)
          .join('|'),
      ),
    );
    // A fixed-string fallback would collapse to a single shape here.
    expect(shapes.size).toBeGreaterThan(1);
    // Still on-language regardless of which seed picked the phrasing.
    for (let i = 0; i < 8; i += 1) {
      const out = fallbackSections(ctx, `seed-${i}`);
      expect(out.slice(0, 4).every((s) => s.query.includes('telugu'))).toBe(true);
    }
  });
});

describe('onRequestPost — always-usable /api/home envelope', () => {
  afterEach(() => vi.unstubAllGlobals());

  let ip = 0;
  const KEYS = {
    // v5.4.0: the dj lane rides its own lightning key now.
    VINAX_NEMOTRON_3_5_LIGHTNING_30B_A3B: 'dj-key',
    VINAX_GROQ_API_KEY: 'scholar-key',
    VINAX_DEEPSEEK_V4_FLASH: 'chat-key',
    VINAX_NEMOTRON_ULTRA: 'ultra-key',
  };
  const post = (body: unknown): Promise<Response> =>
    onRequestPost({
      request: new Request('http://localhost/api/home', {
        method: 'POST',
        // Unique IP per call so the per-isolate rate limiter never trips the suite.
        headers: { 'content-type': 'application/json', 'cf-connecting-ip': `10.0.0.${ip++}` },
        body: JSON.stringify(body),
      }),
      env: KEYS,
    });

  const CTX = {
    context: {
      topArtists: ['A.R. Rahman', 'Ilaiyaraaja'],
      topLanguages: ['telugu', 'hindi'],
      preferredLanguages: ['Telugu', 'Hindi'],
      timeOfDay: 'afternoon',
      recentlyPlayed: ['Naatu Naatu — Rahul Sipligunj'],
    },
  };

  /** Stub every upstream chat-completions call; capture outbound payloads. */
  function stubUpstream(reply: (payload: { model: string; system: string }) => Response): Array<{ model: string; system: string }> {
    const calls: Array<{ model: string; system: string }> = [];
    vi.stubGlobal('fetch', async (_url: unknown, init?: { body?: string }) => {
      const payload = JSON.parse(init?.body ?? '{}') as { model: string; messages: Array<{ role: string; content: string }> };
      const rec = { model: payload.model, system: payload.messages[0]?.content ?? '' };
      calls.push(rec);
      return reply(rec);
    });
    return calls;
  }

  const sectionsReply = (): Response =>
    new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                sections: [
                  { title: 'Late-night Telugu', query: 'telugu late night melodies' },
                  { title: 'Because you love Rahman', query: 'a.r. rahman telugu hits' },
                  { title: 'Fresh Hindi Energy', query: 'latest hindi songs 2026' },
                  { title: 'Telugu Throwbacks', query: 'telugu 2000s classic songs' },
                ],
              }),
            },
          },
        ],
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );

  it('curates on the fast dj engine (nemotron-3.5-lightning), not the 550B ULTRA', async () => {
    const calls = stubUpstream(() => sectionsReply());
    const res = await post(CTX);
    expect(res.status).toBe(200);
    const data = (await res.json()) as { sections: unknown[]; model: string };
    expect(data.sections.length).toBeGreaterThanOrEqual(4);
    // The curate call is the one carrying the front-page composer system prompt.
    const curate = calls.find((c) => c.system.startsWith('You compose the home screen'));
    expect(curate).toBeDefined();
    // v5.4.0: dj lane re-pinned to nemotron-3.5-lightning (probed 0.8s warm);
    // still the fast dj lane, still NOT the slow 550B ULTRA — Home builds stay quick.
    expect(curate!.model).toBe('nvidia/nemotron-3.5-lightning-30b-a3b'); // dj lane, not nemotron-3-ultra
    expect(data.model).toBe('nvidia/nemotron-3.5-lightning-30b-a3b');
  });

  it('ships deterministic fallback sections (200, never 500) when every engine fails', async () => {
    stubUpstream(() => new Response('upstream down', { status: 500 }));
    const res = await post(CTX);
    expect(res.status).toBe(200);
    const data = (await res.json()) as { sections: Array<{ title: string; query: string }>; model: string };
    expect(data.model).toBe('fallback');
    expect(data.sections.length).toBeGreaterThanOrEqual(4);
    // On-language and usable — every fallback query names a preferred language.
    for (const s of data.sections) {
      expect(s.title.length).toBeGreaterThan(0);
      expect(s.query.length).toBeGreaterThan(0);
    }
    expect(data.sections.slice(0, 4).every((s) => s.query.includes('telugu'))).toBe(true);
  });

  it('falls back when engines answer 200 but with unusable (non-section) output', async () => {
    stubUpstream(() =>
      new Response(JSON.stringify({ choices: [{ message: { content: 'I could not build a home page today.' } }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const res = await post(CTX);
    expect(res.status).toBe(200);
    const data = (await res.json()) as { sections: unknown[]; model: string };
    expect(data.model).toBe('fallback');
    expect(data.sections.length).toBeGreaterThanOrEqual(4);
  });

  it('rejects an empty context cheaply with 400 (no model spend)', async () => {
    const calls = stubUpstream(() => sectionsReply());
    const res = await post({ context: {} });
    expect(res.status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it('503s only when the AI is wholly unconfigured (no keys at all)', async () => {
    stubUpstream(() => sectionsReply());
    const res = await onRequestPost({
      request: new Request('http://localhost/api/home', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'cf-connecting-ip': `10.0.1.${ip++}` },
        body: JSON.stringify(CTX),
      }),
      env: {},
    });
    expect(res.status).toBe(503);
  });

  // Locks the Home variety fix (v3.6.0): a fresh per-request varietySeed rides
  // the curate prompt so two consecutive visits with an IDENTICAL taste body
  // still design visibly different shelves.
  it('injects a fresh varietySeed nonce into the curate prompt, different every request', async () => {
    const users: string[] = [];
    vi.stubGlobal('fetch', async (_url: unknown, init?: { body?: string }) => {
      const payload = JSON.parse(init?.body ?? '{}') as { messages: Array<{ role: string; content: string }> };
      if ((payload.messages[0]?.content ?? '').startsWith('You compose the home screen')) {
        users.push(payload.messages[1]?.content ?? '');
      }
      return sectionsReply();
    });
    await post(CTX);
    await post(CTX);
    expect(users).toHaveLength(2);
    for (const u of users) expect(u).toMatch(/varietySeed: "[0-9a-f]{8} · IST \d{4}-\d{2}-\d{2} \d{2}h"/);
    const nonce = (u: string): string | undefined => /varietySeed: "([0-9a-f]{8})/.exec(u)?.[1];
    expect(nonce(users[0])).toBeDefined();
    expect(nonce(users[0])).not.toBe(nonce(users[1]));
  });
});
