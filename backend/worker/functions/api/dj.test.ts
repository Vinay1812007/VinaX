/**
 * AI DJ contract: picks come ONLY from the client's pool, in the model's
 * order, without repeats; a missing key is an honest 503; junk is 400.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const chatMock = vi.fn();
const gatherMock = vi.fn(async (): Promise<string[]> => []);
vi.mock('../_lib/ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../_lib/ai')>();
  return { ...actual, chat: (...args: unknown[]) => chatMock(...args), gather: (...args: unknown[]) => gatherMock(...(args as [])), logAiEvent: () => Promise.resolve() };
});

import { canonKey, onRequestPost, parseCandidates, parsePicks } from './dj';

const pool = [
  { id: 'p1', title: 'Samajavaragamana', artist: 'Sid Sriram', language: 'telugu' },
  { id: 'p2', title: 'Butta Bomma', artist: 'Armaan Malik', language: 'telugu' },
  { id: 'p3', title: 'Inkem Inkem Inkem Kaavaale', artist: 'Sid Sriram', language: 'telugu' },
  { id: 'p4', title: 'Ramuloo Ramulaa', artist: 'Anurag Kulkarni', language: 'telugu' },
];
const env = { VINAX_NVD_NEMOTRON_3_5_LIGHTNING_30B_A3B: 'k' };
let ip = 0;
const post = async (body: unknown) => {
  ip += 1;
  const req = new Request('https://x.test/api/dj', { method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': `10.0.0.${ip}` }, body: JSON.stringify(body) });
  const res = await onRequestPost({ request: req, env });
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
};

beforeEach(() => { chatMock.mockReset(); gatherMock.mockReset(); gatherMock.mockResolvedValue([]); });

describe('parsePicks', () => {
  it('keeps only pool songs, in model order, without repeats, with clipped notes', () => {
    const out = parsePicks(
      JSON.stringify({
        intro: 'Here we go',
        songs: [
          { title: 'Butta Bomma', artist: 'Armaan Malik', reason: 'bright opener', segue: 'Kicking off with Butta Bomma' },
          { title: 'Invented Song', artist: 'Nobody', reason: 'x', segue: 'y' },
          { title: 'samajavaragamana (from ala vaikunthapurramuloo)', artist: 'Sid Sriram, Others', reason: 'melody', segue: 'And now' },
          { title: 'Butta Bomma', artist: 'Armaan Malik' },
        ],
      }),
      pool,
      8,
    );
    expect(out.intro).toBe('Here we go');
    expect(out.songs.map((s) => s.title)).toEqual(['Butta Bomma', 'Samajavaragamana']);
    expect(out.songs[1].segue).toBe('And now');
    expect(out.songs.map((s) => s.songId)).toEqual(['p2', 'p1']);
    expect(out.songs[0].confidence).toBe(0.5); // none given → neutral
  });
  it('matches by pool id first and never trusts an id outside the pool', () => {
    const out = parsePicks(
      JSON.stringify({ songs: [{ songId: 'p4', title: 'wrong title', artist: 'wrong', reason: 'id wins', confidence: 0.9 }, { songId: 'not-in-pool', title: 'Butta Bomma', artist: 'Armaan Malik', confidence: 1.4 }, { songId: 'ghost', title: 'Ghost', artist: 'Nobody' }] }),
      pool,
      8,
    );
    expect(out.songs.map((s) => [s.songId, s.title, s.confidence])).toEqual([['p4', 'Ramuloo Ramulaa', 0.9], ['p2', 'Butta Bomma', 1]]);
  });
  it('canonKey ignores version tags, punctuation and extra credits', () => {
    expect(canonKey('Kesariya (From "Brahmastra")', 'Arijit Singh, Pritam')).toBe(canonKey('Kesariya', 'Arijit Singh'));
  });
});

describe('POST /api/dj', () => {
  it('rejects an empty context and a tiny pool', async () => {
    expect((await post({ context: {}, pool })).status).toBe(400);
    expect((await post({ context: { seedSong: 'x' }, pool: pool.slice(0, 2) })).status).toBe(400);
    expect(chatMock).not.toHaveBeenCalled();
  });
  it('returns pool-only picks in order with intro and notes', async () => {
    chatMock.mockResolvedValue({
      content: JSON.stringify({ intro: 'Settling in.', songs: [{ title: 'Ramuloo Ramulaa', artist: 'Anurag Kulkarni', reason: 'folk lift', segue: 'Time for a folk lift' }, { title: 'Made Up', artist: 'X' }, { title: 'Inkem Inkem Inkem Kaavaale', artist: 'Sid Sriram', reason: 'soft landing', segue: 'Easing down' }] }),
      model: 'm', keyRole: 'dj', status: 200, error: null,
    });
    const { status, json } = await post({ context: { seedSong: 'Butta Bomma — Armaan Malik', currentLanguage: 'telugu' }, pool, count: 8 });
    expect(status).toBe(200);
    expect(json.intro).toBe('Settling in.');
    expect((json.songs as Array<{ title: string }>).map((s) => s.title)).toEqual(['Ramuloo Ramulaa', 'Inkem Inkem Inkem Kaavaale']);
    // The pool travels in the user message; the fast scholar lane leads and
    // the DJ engine is the first failover (v6.5.2, measured live).
    const [, messages, opts] = chatMock.mock.calls[0] as [unknown, Array<{ content: string }>, { lane: string; ladder: string[]; skipSecondary?: boolean }];
    expect(messages[1].content).toContain('Ramuloo Ramulaa');
    expect(opts.lane).toBe('scholar');
    expect(opts.ladder[0]).toBe('dj');
    expect(opts.skipSecondary).toBe(true);
  });
  it('a fromPool pick can only ever carry a pool id — a forged id with fromPool:true is dropped or re-keyed', async () => {
    chatMock.mockResolvedValue({
      content: JSON.stringify({ songs: [
        { songId: 'forged-id', title: 'Not In Pool', artist: 'Nobody', fromPool: true },
        { songId: 'forged-id-2', title: 'Butta Bomma', artist: 'Armaan Malik', fromPool: true },
        { songId: 'p4', title: 'wrong title', artist: 'wrong artist', fromPool: true },
      ] }),
      model: 'm', keyRole: 'dj', status: 200, error: null,
    });
    const { status, json } = await post({ context: { seedSong: 'x' }, pool, count: 8, discover: true, maxDiscover: 0 });
    expect(status).toBe(200);
    const picks = json.songs as Array<{ songId: string | null; title: string; fromPool: boolean }>;
    const poolIds = new Set(pool.map((p) => p.id));
    expect(picks.map((s) => s.songId)).toEqual(['p2', 'p4']);
    for (const s of picks) if (s.fromPool) expect(poolIds.has(s.songId ?? '')).toBe(true);
    // The pool's own title wins over whatever the model wrote beside the id.
    expect(picks[1].title).toBe('Ramuloo Ramulaa');
  });

  it('answers 503 when no engine is configured and 500 when the model returns nothing usable', async () => {
    chatMock.mockResolvedValue({ content: null, error: 'not_configured' });
    expect((await post({ context: { seedSong: 'x' }, pool })).status).toBe(503);
    chatMock.mockResolvedValue({ content: '{"songs":[{"title":"Nope","artist":"Nobody"}]}', model: 'm', status: 200, error: null });
    expect((await post({ context: { seedSong: 'x' }, pool })).status).toBe(500);
  });
});

describe('v6.5.0 — discoveries (off-pool proposals)', () => {
  const answer = JSON.stringify({
    intro: 'Fresh round',
    songs: [
      { songId: 'p2', title: 'Butta Bomma', artist: 'Armaan Malik', reason: 'opener', fromPool: true },
      { songId: '', title: 'Ninnu Kori', artist: 'Sid Sriram', reason: 'new voice', segue: 'Something new', confidence: 0.6, fromPool: false },
      { title: 'Samajavaragamana', artist: 'Sid Sriram', reason: 'back to the pool' },
      { title: 'Second Discovery', artist: 'Someone' },
      { title: 'Third Discovery', artist: 'Someone Else' },
      { title: 'Recently Heard Song', artist: 'X' },
    ],
  });

  it('parsePicks keeps proposals only when allowed, capped, flagged and never one the listener just heard', () => {
    const strict = parsePicks(answer, pool, 8);
    expect(strict.songs.map((s) => s.title)).toEqual(['Butta Bomma', 'Samajavaragamana']);
    expect(strict.songs.every((s) => s.fromPool)).toBe(true);
    const open = parsePicks(answer, pool, 8, 2, 'recently heard song — x');
    expect(open.songs.map((s) => [s.title, s.fromPool])).toEqual([['Butta Bomma', true], ['Ninnu Kori', false], ['Samajavaragamana', true], ['Second Discovery', false]]);
    expect(open.songs[1]).toMatchObject({ songId: null, reason: 'new voice', segue: 'Something new', confidence: 0.6 });
  });

  it('parseCandidates reads a gather answer and drops junk', () => {
    expect(parseCandidates(JSON.stringify({ candidates: [{ title: 'A', artist: 'B' }, { title: '', artist: 'C' }, 'x', { title: 'D' }] }))).toEqual([{ title: 'A', artist: 'B' }]);
    expect(parseCandidates('not json')).toEqual([]);
  });

  it('the route returns flagged proposals only for discover requests and gathers candidates for a thin pool', async () => {
    chatMock.mockResolvedValue({ content: answer, model: 'm', keyRole: 'dj' });
    gatherMock.mockResolvedValue([JSON.stringify({ candidates: [{ title: 'Gathered One', artist: 'G' }, { title: 'Butta Bomma', artist: 'Armaan Malik' }] })]);
    const plain = await post({ context: { seedSong: 'x' }, pool, count: 6 });
    expect(plain.status).toBe(200);
    expect((plain.json.songs as Array<{ fromPool: boolean }>).every((s) => s.fromPool)).toBe(true);
    expect(gatherMock).not.toHaveBeenCalled();
    const open = await post({ context: { seedSong: 'x', avoidSongs: ['Recently Heard Song — X'] }, pool, count: 6, discover: true, maxDiscover: 2 });
    expect(open.status).toBe(200);
    const songs = open.json.songs as Array<{ title: string; fromPool: boolean; songId: string | null }>;
    expect(songs.filter((s) => !s.fromPool).map((s) => s.title)).toEqual(['Ninnu Kori', 'Second Discovery']);
    expect(songs.find((s) => !s.fromPool)?.songId).toBeNull();
    expect(gatherMock).toHaveBeenCalledOnce();
    const prompt = (chatMock.mock.calls[1] as unknown as [unknown, Array<{ content: string }>])[1][1].content;
    expect(prompt).toContain('DISCOVERIES ALLOWED');
    expect(prompt).toContain('Gathered One');
    expect(prompt).not.toContain('SUPPLEMENTARY CANDIDATES from a music expert — real songs, use them as discoveries only when they fit (JSON):\n[{"title":"Butta Bomma"');
  });
});
